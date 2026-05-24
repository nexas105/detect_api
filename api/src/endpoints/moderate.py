"""Moderate endpoint — all-in-one content moderation report.

Combines NudeNet + EraX + CLIP + Rate-Me into a single action recommendation.
Actions: "allow" | "flag" | "block" with confidence and reasons.
"""

from __future__ import annotations

import asyncio
import io

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image, ImageOps

from ..auth import KeyInfo, log_usage_bg, save_detection_bg, validate_api_key
from ..cache import get_cached, hash_image, set_cached
from ..clip_scorer import full_analysis_async
from ..demo import demo_limiter
from ..webhooks import dispatch_event_bg
from ..models import (
    ModelName, get_ext, model_version_for, preprocess, run_detection_async,
    store_image_async, validate_upload,
)
from .rateme import _merge_detections, _score_eroticism, compute_rating
from ..schemas import DemoModerateResponse, ModerateResponse

router = APIRouter()

# Labels that indicate sexual activity
SEXUAL_ACT_LABELS = {"MAKE_LOVE"}

# High-nudity exposed labels
HIGH_NUDITY_LABELS = {
    "FEMALE_BREAST_EXPOSED", "FEMALE_GENITALIA_EXPOSED", "MALE_GENITALIA_EXPOSED",
    "BUTTOCKS_EXPOSED", "ANUS_EXPOSED", "NIPPLE", "PENIS", "VAGINA", "ANUS",
}


def _determine_action(
    rating: dict,
    clip_analysis: dict,
    detections: list[dict],
) -> tuple[str, float, list[str]]:
    """Determine moderation action from combined analyses.

    Returns (action, confidence, reasons).
    """
    reasons: list[str] = []
    block_confidence = 0.0
    flag_confidence = 0.0

    category = rating.get("category", "safe")
    score = rating.get("score", 0.0)

    # ── Block conditions ───────────────────────────────────────────────

    # Minor detected
    age_data = clip_analysis.get("age", {})
    if age_data.get("is_minor_risk", False):
        reasons.append("minor risk flagged by age estimation")
        block_confidence = max(block_confidence, 0.95)

    if category == "blocked":
        reasons.append("content blocked by safety system")
        block_confidence = max(block_confidence, 0.95)

    # Extreme category
    if category == "extreme":
        reasons.append("extreme explicit content detected")
        block_confidence = max(block_confidence, 0.90)

    # Sexual act with high confidence
    for d in detections:
        if d["label"] in SEXUAL_ACT_LABELS and d["score"] > 0.7:
            reasons.append(f"sexual act detected (confidence {d['score']:.0%})")
            block_confidence = max(block_confidence, 0.85)
            break

    if block_confidence > 0:
        return "block", round(min(1.0, block_confidence), 4), reasons

    # ── Flag conditions ────────────────────────────────────────────────

    # Erotic or explicit category
    if category in ("erotic", "explicit"):
        reasons.append(f"{category} content detected (score {score:.2f})")
        flag_confidence = max(flag_confidence, 0.7 + score * 0.2)

    # Deepfake likely_fake
    deepfake_data = clip_analysis.get("deepfake", {})
    if deepfake_data.get("verdict") == "likely_fake":
        reasons.append("likely AI-generated or deepfake content")
        flag_confidence = max(flag_confidence, 0.75)

    # High nudity score — count high-confidence exposed detections
    high_nudity_dets = [d for d in detections if d["label"] in HIGH_NUDITY_LABELS and d["score"] > 0.5]
    if len(high_nudity_dets) >= 2:
        avg_conf = sum(d["score"] for d in high_nudity_dets) / len(high_nudity_dets)
        reasons.append(f"significant nudity detected ({len(high_nudity_dets)} regions, avg confidence {avg_conf:.0%})")
        flag_confidence = max(flag_confidence, 0.6 + avg_conf * 0.3)
    elif len(high_nudity_dets) == 1:
        d = high_nudity_dets[0]
        reasons.append(f"nudity detected: {d['label']} (confidence {d['score']:.0%})")
        flag_confidence = max(flag_confidence, 0.5 + d["score"] * 0.3)

    # Suggestive/sensual — light flag
    if category in ("suggestive", "sensual") and flag_confidence == 0:
        reasons.append(f"{category} content detected (score {score:.2f})")
        flag_confidence = max(flag_confidence, 0.4 + score * 0.3)

    if flag_confidence > 0:
        return "flag", round(min(1.0, flag_confidence), 4), reasons

    # ── Allow ──────────────────────────────────────────────────────────

    # Confidence in "allow" is inverse of how close we are to flagging
    allow_confidence = round(min(1.0, max(0.5, 1.0 - score * 1.5)), 4)
    if not reasons:
        reasons.append("no concerning content detected")

    return "allow", allow_confidence, reasons


def _compute_nudity_score(detections: list[dict]) -> float:
    """Compute an overall nudity score 0-1 from detections."""
    if not detections:
        return 0.0

    eroticism = _score_eroticism(detections)
    return round(min(1.0, eroticism["score"]), 4)


@router.post("/moderate", response_model=ModerateResponse, tags=["Moderation"])
async def moderate(
    file: UploadFile = File(...),
    no_cache: int = Query(0, description="Set to 1 to bypass the result cache"),
    key_info: KeyInfo = Depends(validate_api_key),
):
    """All-in-one content moderation with an action recommendation.

    Runs NudeNet + EraX + CLIP analyses in parallel and produces a comprehensive
    moderation report. Returns one of three actions:

    - **allow** -- no concerning content detected
    - **flag** -- suggestive/erotic content or deepfake detected, needs human review
    - **block** -- extreme content, minor risk, or sexual acts detected

    Each action includes a confidence score and human-readable reasons. The response
    also contains the full rating breakdown, CLIP analysis (age, deepfake, clothing),
    raw detections, and a summary with nudity/violence scores. Supports result caching.
    """
    data = await file.read()
    validate_upload(data)

    image_hash = hash_image(data)
    cache_version = (
        f"{model_version_for(ModelName.nudenet)}"
        f"+{model_version_for(ModelName.erax)}"
        f"+{model_version_for('clip')}"
    )
    cache_endpoint = "moderate"

    if not no_cache:
        cached = await get_cached(image_hash, cache_version, cache_endpoint)
        if cached is not None:
            log_usage_bg(key_info, "/moderate", "POST", 200)
            return JSONResponse(content=cached, headers={"X-Cache": "HIT"})

    img, scale = preprocess(data)

    # Full-res image for CLIP + rating quality analysis
    full_img = Image.open(io.BytesIO(data))
    full_img = ImageOps.exif_transpose(full_img)
    if full_img.mode != "RGB":
        full_img = full_img.convert("RGB")

    # Run all analyses in parallel
    nudenet_dets, erax_dets, clip_analysis = await asyncio.gather(
        run_detection_async(img, ModelName.nudenet, scale),
        run_detection_async(img, ModelName.erax, scale),
        full_analysis_async(full_img),
    )

    detections = _merge_detections(nudenet_dets, erax_dets)

    # Compute rating (reuses merged detections + CLIP internally via compute_rating)
    rating = await compute_rating(detections, full_img)

    # Determine action
    action, confidence, reasons = _determine_action(rating, clip_analysis, detections)

    # Nudity score
    nudity_score = _compute_nudity_score(detections)

    # Store image + log
    image_id, orig_path = await store_image_async(data, get_ext(file.filename), "originals")
    log_usage_bg(key_info, "/moderate", "POST", 200)
    save_detection_bg(
        key_info, image_id, "moderate", "nudenet+erax+clip",
        detections, original_path=orig_path,
    )

    result = {
        "image_id": image_id,
        "action": action,
        "confidence": confidence,
        "reasons": reasons,
        "detections": detections,
        "rating": rating,
        "clip_analysis": {
            "sexiness": clip_analysis.get("sexiness", {}),
            "age": clip_analysis.get("age", {}),
            "deepfake": clip_analysis.get("deepfake", {}),
            "clothing": clip_analysis.get("clothing", {}),
        },
        "summary": {
            "nudity_score": nudity_score,
            "violence_score": 0,
            "text_flags": [],
        },
    }

    if not no_cache:
        await set_cached(image_hash, cache_version, cache_endpoint, result)

    dispatch_event_bg(key_info.raw_key, "moderate", {**result, "image_hash": image_hash})

    return JSONResponse(content=result, headers={"X-Cache": "MISS"})


@router.post("/demo/moderate", response_model=DemoModerateResponse, tags=["Demo"])
async def demo_moderate(
    request: Request,
    file: UploadFile = File(...),
):
    """Demo content moderation with no authentication required.

    Same all-in-one moderation as /moderate but with IP-based rate limiting
    (10 images/hour) and a 10MB file size cap. Results are stored under
    the demo system account.
    """
    from ..auth import get_http_client, KeyInfo, log_usage_bg, save_detection_bg
    from ..config import AUTH_SERVICE_URL

    demo_limiter.check_image(request)
    data = await file.read()
    validate_upload(data, max_size=10 * 1024 * 1024)

    img, scale = preprocess(data)

    # Full-res image for CLIP + rating
    full_img = Image.open(io.BytesIO(data))
    full_img = ImageOps.exif_transpose(full_img)
    if full_img.mode != "RGB":
        full_img = full_img.convert("RGB")

    # Run all analyses in parallel
    nudenet_dets, erax_dets, clip_analysis = await asyncio.gather(
        run_detection_async(img, ModelName.nudenet, scale),
        run_detection_async(img, ModelName.erax, scale),
        full_analysis_async(full_img),
    )

    detections = _merge_detections(nudenet_dets, erax_dets)
    rating = await compute_rating(detections, full_img)

    action, confidence, reasons = _determine_action(rating, clip_analysis, detections)
    nudity_score = _compute_nudity_score(detections)

    # Store under demo account
    try:
        client = await get_http_client()
        resp = await client.get(f"{AUTH_SERVICE_URL}/demo/key")
        if resp.status_code == 200:
            raw_key = resp.json()["key"]
            resp2 = await client.post(
                f"{AUTH_SERVICE_URL}/validate-key",
                headers={"Authorization": f"Bearer {raw_key}"},
            )
            if resp2.status_code == 200:
                key_info = KeyInfo(resp2.json(), raw_key)
                image_id, orig_path = await store_image_async(data, get_ext(file.filename), "originals")
                log_usage_bg(key_info, "/demo/moderate", "POST", 200)
                save_detection_bg(
                    key_info, image_id, "demo-moderate", "nudenet+erax+clip",
                    detections, original_path=orig_path,
                )
    except Exception:
        pass  # non-critical

    return {
        "action": action,
        "confidence": confidence,
        "reasons": reasons,
        "detections": detections,
        "rating": rating,
        "clip_analysis": {
            "sexiness": clip_analysis.get("sexiness", {}),
            "age": clip_analysis.get("age", {}),
            "deepfake": clip_analysis.get("deepfake", {}),
            "clothing": clip_analysis.get("clothing", {}),
        },
        "summary": {
            "nudity_score": nudity_score,
            "violence_score": 0,
            "text_flags": [],
        },
        "demo": True,
        "limits": demo_limiter.get_remaining(request),
    }
