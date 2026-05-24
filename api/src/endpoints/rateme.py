"""Rate-Me endpoint — multi-factor sexiness/attractiveness scoring.

Factors (weighted):
  40% CLIP Sexiness — AI perception of attractiveness, pose, seductiveness
  30% Eroticism — combined NudeNet + EraX detections, bundled labels
  12% Image Quality — sharpness, resolution, brightness, contrast
  10% Composition — face present, body framing, pose heuristic
   8% Aesthetics — color harmony, saturation, noise level

If CLIP unavailable: its 40% weight shifts to eroticism (70% total).
"""

from __future__ import annotations

import math

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image, ImageFilter, ImageStat

from ..auth import KeyInfo, log_usage_bg, save_detection_bg, validate_api_key
from ..cache import get_cached, hash_image, set_cached
from ..clip_scorer import full_analysis_async
from ..demo import demo_limiter
from ..webhooks import dispatch_event_bg
from ..models import (
    ModelName, get_ext, model_version_for, preprocess, preprocess_full,
    run_detection_async, store_image_async, validate_upload,
)
from ..schemas import DemoRateMeResponse, RateMeResponse

router = APIRouter()


# ── Label Bundles ───────────────────────────────────────────────────────────
# Merge NudeNet (18 labels) + EraX (5 labels) into logical groups

LABEL_BUNDLES = {
    "breasts": {
        "labels": {"FEMALE_BREAST_EXPOSED", "NIPPLE"},
        "exposed_weight": 0.75,
    },
    "breasts_covered": {
        "labels": {"FEMALE_BREAST_COVERED"},
        "exposed_weight": 0.25,
    },
    "genitalia_female": {
        "labels": {"FEMALE_GENITALIA_EXPOSED", "VAGINA"},
        "exposed_weight": 0.95,
    },
    "genitalia_female_covered": {
        "labels": {"FEMALE_GENITALIA_COVERED"},
        "exposed_weight": 0.30,
    },
    "genitalia_male": {
        "labels": {"MALE_GENITALIA_EXPOSED", "PENIS"},
        "exposed_weight": 0.90,
    },
    "genitalia_male_covered": {
        "labels": {"MALE_GENITALIA_COVERED"},
        "exposed_weight": 0.25,
    },
    "buttocks": {
        "labels": {"BUTTOCKS_EXPOSED"},
        "exposed_weight": 0.60,
    },
    "buttocks_covered": {
        "labels": {"BUTTOCKS_COVERED"},
        "exposed_weight": 0.20,
    },
    "anus": {
        "labels": {"ANUS_EXPOSED", "ANUS"},
        "exposed_weight": 0.85,
    },
    "anus_covered": {
        "labels": {"ANUS_COVERED"},
        "exposed_weight": 0.20,
    },
    "sexual_act": {
        "labels": {"MAKE_LOVE"},
        "exposed_weight": 1.0,
    },
    "body": {
        "labels": {"BELLY_EXPOSED", "ARMPITS_EXPOSED", "FEET_EXPOSED"},
        "exposed_weight": 0.10,
    },
    "body_covered": {
        "labels": {"BELLY_COVERED", "ARMPITS_COVERED", "FEET_COVERED"},
        "exposed_weight": 0.03,
    },
    "face": {
        "labels": {"FACE_FEMALE", "FACE_MALE"},
        "exposed_weight": 0.0,  # face doesn't contribute to eroticism directly
    },
}

CATEGORIES = [
    (0.0, 0.10, "safe", "No sexual or suggestive content"),
    (0.10, 0.25, "mild", "Slightly suggestive"),
    (0.25, 0.45, "suggestive", "Moderately suggestive"),
    (0.45, 0.65, "sensual", "Sensual content"),
    (0.65, 0.80, "erotic", "Erotic content"),
    (0.80, 0.92, "explicit", "Highly explicit"),
    (0.92, 1.01, "extreme", "Extremely explicit"),
]


# ── Eroticism Score (60%) ───────────────────────────────────────────────────


def _merge_detections(nudenet_dets: list[dict], erax_dets: list[dict]) -> list[dict]:
    """Merge detections from both models, dedup by IoU overlap."""
    all_dets = nudenet_dets + erax_dets
    if len(all_dets) <= 1:
        return all_dets

    # Simple dedup: if two detections have same label family and high IoU, keep higher confidence
    merged = []
    used = set()
    for i, d1 in enumerate(all_dets):
        if i in used:
            continue
        best = d1
        for j, d2 in enumerate(all_dets[i + 1:], i + 1):
            if j in used:
                continue
            # Check if same label bundle
            b1 = _get_bundle(d1["label"])
            b2 = _get_bundle(d2["label"])
            if b1 and b2 and b1 == b2 and _iou(d1["box"], d2["box"]) > 0.3:
                used.add(j)
                if d2["score"] > best["score"]:
                    best = d2
        merged.append(best)
    return merged


def _get_bundle(label: str) -> str | None:
    for name, bundle in LABEL_BUNDLES.items():
        if label in bundle["labels"]:
            return name
    return None


def _iou(box1: list[int], box2: list[int]) -> float:
    """Intersection over Union for xywh boxes."""
    x1, y1, w1, h1 = box1
    x2, y2, w2, h2 = box2
    xa = max(x1, x2)
    ya = max(y1, y2)
    xb = min(x1 + w1, x2 + w2)
    yb = min(y1 + h1, y2 + h2)
    inter = max(0, xb - xa) * max(0, yb - ya)
    union = w1 * h1 + w2 * h2 - inter
    return inter / union if union > 0 else 0


def _score_eroticism(detections: list[dict]) -> dict:
    """Score eroticism from merged detections using bundled labels."""
    if not detections:
        return {"score": 0.0, "bundles": {}, "breakdown": []}

    # Score per bundle (best detection per bundle)
    bundle_scores: dict[str, dict] = {}
    breakdown = []

    for d in detections:
        bundle_name = _get_bundle(d["label"])
        if not bundle_name:
            continue
        bundle = LABEL_BUNDLES[bundle_name]
        weight = bundle["exposed_weight"]
        contribution = weight * d["score"]

        if bundle_name not in bundle_scores or contribution > bundle_scores[bundle_name]["contribution"]:
            bundle_scores[bundle_name] = {
                "label": d["label"],
                "confidence": d["score"],
                "weight": weight,
                "contribution": round(contribution, 4),
            }

    if not bundle_scores:
        return {"score": 0.0, "bundles": {}, "breakdown": []}

    # Composite from top bundles
    contributions = sorted([b["contribution"] for b in bundle_scores.values()], reverse=True)
    top3 = contributions[:3]
    primary = sum(top3) / len(top3)
    density = min(0.12, len(contributions) * 0.025)
    rest = sum(contributions[3:]) * 0.08

    score = round(min(1.0, max(0.0, primary + density + rest)), 4)

    return {
        "score": score,
        "bundles": bundle_scores,
        "breakdown": sorted(bundle_scores.values(), key=lambda x: x["contribution"], reverse=True),
    }


# ── Pose Heuristic ──────────────────────────────────────────────────────────


def _score_pose(detections: list[dict], img_w: int, img_h: int) -> dict:
    """Estimate pose sexiness from detection positions and sizes."""
    if not detections:
        return {"score": 0.0, "details": "No body parts detected"}

    img_area = img_w * img_h
    has_face = any(d["label"] in {"FACE_FEMALE", "FACE_MALE"} for d in detections)
    body_parts = [d for d in detections if d["label"] not in {"FACE_FEMALE", "FACE_MALE"}]

    if not body_parts:
        return {"score": 0.1 if has_face else 0.0, "details": "Face only" if has_face else "No body"}

    # Body coverage — more visible body = more revealing pose
    total_body_area = sum(d["box"][2] * d["box"][3] for d in body_parts)
    coverage = min(1.0, total_body_area / img_area * 3)  # normalize

    # Vertical spread — detections across full body height = full body pose
    y_positions = [(d["box"][1] + d["box"][3] / 2) / img_h for d in body_parts]
    y_spread = max(y_positions) - min(y_positions) if len(y_positions) > 1 else 0

    # Variety — more different body regions = more exposed pose
    unique_bundles = len(set(_get_bundle(d["label"]) for d in body_parts if _get_bundle(d["label"])))
    variety = min(1.0, unique_bundles / 4)

    # Face + body = personal/intimate
    intimacy = 0.15 if has_face and body_parts else 0.0

    score = round(min(1.0, coverage * 0.35 + y_spread * 0.25 + variety * 0.25 + intimacy), 4)

    return {
        "score": score,
        "details": f"coverage={coverage:.2f}, spread={y_spread:.2f}, variety={variety:.2f}, face={'yes' if has_face else 'no'}",
    }


# ── Image Quality (20%) ────────────────────────────────────────────────────


def _score_image_quality(img: Image.Image) -> dict:
    """Score image quality from technical properties."""
    w, h = img.size

    # Resolution score (0-1): 1080p+ is ideal
    megapixels = (w * h) / 1_000_000
    resolution = min(1.0, megapixels / 2.0)  # 2MP = perfect

    # Sharpness (Laplacian variance)
    gray = img.convert("L")
    edges = gray.filter(ImageFilter.FIND_EDGES)
    edge_stat = ImageStat.Stat(edges)
    sharpness = min(1.0, edge_stat.stddev[0] / 50)  # normalize

    # Brightness — neither too dark nor too bright is best
    stat = ImageStat.Stat(img)
    avg_brightness = sum(stat.mean[:3]) / 3 / 255
    brightness = 1.0 - abs(avg_brightness - 0.5) * 2  # 0.5 is ideal

    # Contrast
    contrast = min(1.0, sum(stat.stddev[:3]) / 3 / 80)

    score = round(resolution * 0.3 + sharpness * 0.35 + brightness * 0.2 + contrast * 0.15, 4)

    return {
        "score": min(1.0, score),
        "resolution": round(resolution, 3),
        "sharpness": round(sharpness, 3),
        "brightness": round(brightness, 3),
        "contrast": round(contrast, 3),
    }


# ── Aesthetics (10%) ───────────────────────────────────────────────────────


def _score_aesthetics(img: Image.Image) -> dict:
    """Score aesthetic quality: color harmony, saturation, noise."""
    stat = ImageStat.Stat(img)

    # Color saturation (HSV)
    hsv = img.convert("HSV")
    hsv_stat = ImageStat.Stat(hsv)
    saturation = hsv_stat.mean[1] / 255  # 0-1
    sat_score = min(1.0, saturation * 2)  # moderate saturation is good

    # Color variety (stddev across channels = more interesting)
    color_variety = min(1.0, sum(stat.stddev[:3]) / 3 / 60)

    # Noise estimate (difference between original and blurred)
    blurred = img.filter(ImageFilter.GaussianBlur(2))
    diff_stat = ImageStat.Stat(Image.blend(img, blurred, 0.5))
    noise = 1.0 - min(1.0, sum(diff_stat.stddev[:3]) / 3 / 30)  # less noise = better

    score = round(sat_score * 0.35 + color_variety * 0.35 + noise * 0.3, 4)

    return {
        "score": min(1.0, score),
        "saturation": round(sat_score, 3),
        "color_variety": round(color_variety, 3),
        "noise_level": round(1 - noise, 3),  # show noise level, not cleanliness
    }


# ── Composition (10%) ──────────────────────────────────────────────────────


def _score_composition(detections: list[dict], img_w: int, img_h: int) -> dict:
    """Score composition: face presence, framing, aspect ratio."""
    has_face = any(d["label"] in {"FACE_FEMALE", "FACE_MALE"} for d in detections)

    # Face bonus
    face_score = 0.4 if has_face else 0.0

    # Aspect ratio — portrait orientation is better for people
    ratio = img_w / img_h if img_h > 0 else 1
    if 0.6 <= ratio <= 0.8:  # portrait
        ratio_score = 1.0
    elif 0.8 < ratio <= 1.2:  # square-ish
        ratio_score = 0.7
    elif 1.2 < ratio <= 1.8:  # landscape
        ratio_score = 0.5
    else:
        ratio_score = 0.3

    # Subject centering — are detections centered in frame?
    if detections:
        centers_x = [(d["box"][0] + d["box"][2] / 2) / img_w for d in detections]
        centers_y = [(d["box"][1] + d["box"][3] / 2) / img_h for d in detections]
        avg_x = sum(centers_x) / len(centers_x)
        avg_y = sum(centers_y) / len(centers_y)
        centering = 1.0 - math.sqrt((avg_x - 0.5) ** 2 + (avg_y - 0.5) ** 2)
    else:
        centering = 0.5

    # Pose heuristic (integrated)
    pose = _score_pose(detections, img_w, img_h)

    score = round(face_score + ratio_score * 0.2 + centering * 0.15 + pose["score"] * 0.25, 4)

    return {
        "score": min(1.0, score),
        "has_face": has_face,
        "aspect_ratio": round(ratio, 2),
        "centering": round(centering, 3),
        "pose": pose,
    }


# ── Combined Rating ────────────────────────────────────────────────────────

WEIGHTS = {
    "clip_sexiness": 0.38,
    "eroticism": 0.27,
    "image_quality": 0.12,
    "composition": 0.10,
    "aesthetics": 0.08,
    "age_attractiveness": 0.05,
}


def _score_age_attractiveness(age_data: dict) -> dict:
    """Score age attractiveness — peak at 18-30, falls off outside."""
    if not age_data.get("available") or age_data.get("estimated_age") is None:
        return {"score": 0.5, "available": False}

    age = age_data["estimated_age"]

    # Minor = 0 score (safety)
    if age < 18:
        return {"score": 0.0, "is_minor": True, "estimated_age": age, "available": True}

    # Peak attractiveness 20-28, falls off gradually
    if 20 <= age <= 28:
        score = 1.0
    elif 18 <= age < 20:
        score = 0.7 + (age - 18) * 0.15
    elif 28 < age <= 35:
        score = 1.0 - (age - 28) * 0.05
    elif 35 < age <= 45:
        score = 0.65 - (age - 35) * 0.03
    else:
        score = max(0.1, 0.35 - (age - 45) * 0.02)

    return {"score": round(min(1.0, max(0.0, score)), 4), "estimated_age": age, "available": True}


async def compute_rating(detections: list[dict], img: Image.Image) -> dict:
    """Compute multi-factor rating with full CLIP analysis (sexiness, age, deepfake, clothing)."""
    w, h = img.size

    eroticism = _score_eroticism(detections)
    clip_all = await full_analysis_async(img)  # single CLIP pass for all
    quality = _score_image_quality(img)
    composition = _score_composition(detections, w, h)
    aesthetics = _score_aesthetics(img)

    clip_sex = clip_all.get("sexiness", {"score": 0.0, "available": False})
    clip_age = clip_all.get("age", {"estimated_age": None, "available": False})
    clip_deepfake = clip_all.get("deepfake", {"fake_probability": 0.0, "available": False})
    clip_clothing = clip_all.get("clothing", {"clothing": "unknown", "available": False})

    age_attr = _score_age_attractiveness(clip_age)

    # If CLIP unavailable, redistribute its weight to eroticism
    clip_weight = WEIGHTS["clip_sexiness"]
    eroticism_weight = WEIGHTS["eroticism"]
    age_weight = WEIGHTS["age_attractiveness"]
    if not clip_sex.get("available", False):
        eroticism_weight += clip_weight + age_weight
        clip_weight = 0
        age_weight = 0

    # Safety: if minor detected, cap score
    is_minor = clip_age.get("is_minor_risk", False) or age_attr.get("is_minor", False)

    # Weighted composite
    raw = (
        clip_sex["score"] * clip_weight
        + eroticism["score"] * eroticism_weight
        + quality["score"] * WEIGHTS["image_quality"]
        + composition["score"] * WEIGHTS["composition"]
        + aesthetics["score"] * WEIGHTS["aesthetics"]
        + age_attr["score"] * age_weight
    )
    score = round(min(1.0, max(0.0, raw)), 4)

    # Minor safety: force low score
    if is_minor:
        score = 0.0

    # Categorize
    category, description = "safe", "No sexual or suggestive content"
    for low, high, cat, desc in CATEGORIES:
        if low <= score < high:
            category, description = cat, desc
            break

    if is_minor:
        category = "blocked"
        description = "Minor detected — scoring disabled"

    factors = {
        "clip_sexiness": {"score": clip_sex["score"], "weight": clip_weight, "available": clip_sex.get("available", False)},
        "eroticism": {"score": eroticism["score"], "weight": eroticism_weight, "breakdown": eroticism["breakdown"]},
        "image_quality": {"score": quality["score"], "weight": WEIGHTS["image_quality"], **{k: v for k, v in quality.items() if k != "score"}},
        "composition": {"score": composition["score"], "weight": WEIGHTS["composition"], **{k: v for k, v in composition.items() if k != "score"}},
        "aesthetics": {"score": aesthetics["score"], "weight": WEIGHTS["aesthetics"], **{k: v for k, v in aesthetics.items() if k != "score"}},
        "age_attractiveness": {"score": age_attr["score"], "weight": age_weight, **{k: v for k, v in age_attr.items() if k != "score"}},
    }

    return {
        "score": score,
        "category": category,
        "description": description,
        "factors": factors,
        "age": clip_age,
        "deepfake": clip_deepfake,
        "clothing": clip_clothing,
    }


# ── Endpoints ──────────────────────────────────────────────────────────────


@router.post("/rateme", response_model=RateMeResponse, tags=["Rating"])
async def rate_me(
    file: UploadFile = File(...),
    no_cache: int = Query(0, description="Set to 1 to bypass the result cache"),
    key_info: KeyInfo = Depends(validate_api_key),
):
    """Rate an image for sexiness/attractiveness using multi-factor AI scoring.

    Runs NudeNet + EraX + CLIP in parallel for comprehensive analysis across
    six weighted factors:

    - **38% CLIP Sexiness** -- AI perception of attractiveness, pose, seductiveness
    - **27% Eroticism** -- combined NudeNet + EraX detections with bundled labels
    - **12% Image Quality** -- sharpness, resolution, lighting, contrast
    - **10% Composition** -- face presence, framing, pose heuristic, centering
    - **8% Aesthetics** -- color harmony, saturation, noise level
    - **5% Age Attractiveness** -- peak scoring at 20-28, minor safety enforced

    Returns a 0-1 score with category (safe/mild/suggestive/sensual/erotic/explicit/extreme/blocked),
    per-factor breakdowns, and all raw detections. If CLIP is unavailable, its weight
    shifts to eroticism. Minor detection forces score to 0 and category to "blocked".
    """
    data = await file.read()
    validate_upload(data)

    image_hash = hash_image(data)
    # Cache key spans all three models used here
    cache_version = (
        f"{model_version_for(ModelName.nudenet)}"
        f"+{model_version_for(ModelName.erax)}"
        f"+{model_version_for('clip')}"
    )
    cache_endpoint = "rateme"

    if not no_cache:
        cached = await get_cached(image_hash, cache_version, cache_endpoint)
        if cached is not None:
            log_usage_bg(key_info, "/rateme", "POST", 200)
            return JSONResponse(content=cached, headers={"X-Cache": "HIT"})

    detect_img, scale, full_img = preprocess_full(data)

    # Run BOTH models and merge
    nudenet_dets = await run_detection_async(detect_img, ModelName.nudenet, scale)
    erax_dets = await run_detection_async(detect_img, ModelName.erax, scale)
    detections = _merge_detections(nudenet_dets, erax_dets)

    rating = await compute_rating(detections, full_img)

    image_id, orig_path = await store_image_async(data, get_ext(file.filename), "originals")
    log_usage_bg(key_info, "/rateme", "POST", 200)
    save_detection_bg(key_info, image_id, "rateme", "nudenet+erax", detections, original_path=orig_path)

    result = {
        "image_id": image_id,
        "models": ["nudenet", "erax"],
        "rating": rating,
        "detections": detections,
    }

    if not no_cache:
        await set_cached(image_hash, cache_version, cache_endpoint, result)

    # Fire webhooks — fire-and-forget, never blocks the response
    dispatch_event_bg(key_info.raw_key, "rateme", {**result, "image_hash": image_hash})

    return JSONResponse(content=result, headers={"X-Cache": "MISS"})


@router.post("/demo/rateme", response_model=DemoRateMeResponse, tags=["Demo"])
async def demo_rate_me(
    request: Request,
    file: UploadFile = File(...),
):
    """Demo rate-me endpoint with no authentication required.

    Same multi-factor scoring as /rateme but with IP-based rate limiting
    (10 images/hour) and a 10MB file size cap. Results are stored under
    the demo system account.
    """
    from ..auth import get_http_client, KeyInfo, log_usage_bg, save_detection_bg
    from ..config import AUTH_SERVICE_URL

    demo_limiter.check_image(request)
    data = await file.read()
    validate_upload(data, max_size=10 * 1024 * 1024)

    detect_img, scale, full_img = preprocess_full(data)
    nudenet_dets = await run_detection_async(detect_img, ModelName.nudenet, scale)
    erax_dets = await run_detection_async(detect_img, ModelName.erax, scale)
    detections = _merge_detections(nudenet_dets, erax_dets)

    rating = await compute_rating(detections, full_img)

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
                log_usage_bg(key_info, "/demo/rateme", "POST", 200)
                save_detection_bg(key_info, image_id, "demo-rateme", "nudenet+erax", detections, original_path=orig_path)
    except Exception:
        pass  # non-critical

    return {
        "models": ["nudenet", "erax"],
        "rating": rating,
        "detections": detections,
        "demo": True,
        "limits": demo_limiter.get_remaining(request),
    }
