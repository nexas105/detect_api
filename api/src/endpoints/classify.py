"""Classify and censor endpoints — with age, deepfake, and clothing analysis."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import JSONResponse, Response
from PIL import Image

from ..auth import KeyInfo, log_usage_bg, save_detection_bg, validate_api_key
from ..cache import get_cached, hash_image, set_cached
from ..webhooks import dispatch_event_bg
from ..clip_scorer import full_analysis_async
from ..models import (
    DEFAULT_CENSOR, ModelName, apply_censoring, get_ext, model_version_for,
    preprocess_full, run_detection_async, store_image_async, store_image_with_id_async, validate_upload,
)
from ..schemas import ClassifyResponse

router = APIRouter()


async def _run_clip_analysis(img: Image.Image) -> dict:
    """Run CLIP analysis on a pre-decoded PIL Image. Returns empty dict on failure."""
    try:
        return await full_analysis_async(img)
    except Exception:
        return {}


@router.post("/classify", response_model=ClassifyResponse, tags=["Detection"])
async def classify(
    file: UploadFile = File(...),
    model: ModelName = Query(ModelName.nudenet),
    no_cache: int = Query(0, description="Set to 1 to bypass the result cache"),
    key_info: KeyInfo = Depends(validate_api_key),
):
    """Detect NSFW content in an image with optional CLIP analysis.

    Runs the selected detection model (NudeNet or EraX) to find exposed/covered
    body parts, then enriches the result with CLIP-based age estimation, deepfake
    detection, and clothing classification.

    Returns bounding boxes with labels, confidence scores, and CLIP analysis
    results. Supports result caching — pass `no_cache=1` to bypass.
    """
    data = await file.read()
    validate_upload(data)

    # Cache lookup (keyed on image bytes + model + endpoint + clip). CLIP is part of
    # the response shape, so the cache key includes it implicitly via the endpoint tag.
    image_hash = hash_image(data)
    # Cache key: combines detection model + clip version, so upgrading either invalidates
    cache_version = f"{model_version_for(model)}+{model_version_for('clip')}"
    cache_key_endpoint = "classify"

    if not no_cache:
        cached = await get_cached(image_hash, cache_version, cache_key_endpoint)
        if cached is not None:
            # Still log usage — customer pays even on a cache hit
            log_usage_bg(key_info, "/classify", "POST", 200)
            return JSONResponse(content=cached, headers={"X-Cache": "HIT"})

    detect_img, scale, full_img = preprocess_full(data)
    detections = await run_detection_async(detect_img, model, scale)

    # CLIP analysis (age, deepfake, clothing) — reuses already-decoded full_img
    analysis = await _run_clip_analysis(full_img)

    image_id, orig_path = await store_image_async(data, get_ext(file.filename), "originals")
    log_usage_bg(key_info, "/classify", "POST", 200)
    save_detection_bg(key_info, image_id, "classify", model.value, detections, original_path=orig_path)

    result = {"image_id": image_id, "model": model.value, "detections": detections}
    if analysis:
        result["age"] = analysis.get("age")
        result["deepfake"] = analysis.get("deepfake")
        result["clothing"] = analysis.get("clothing")

    # Store in cache (image_id will differ on each upload — that's fine, it's just a
    # pointer to stored bytes; the detection content is what matters for callers)
    if not no_cache:
        # Build a cacheable variant without the per-request image_id so different
        # uploads of the same bytes don't get an outdated id. Callers that need the
        # fresh id should pass ?no_cache=1.
        await set_cached(image_hash, cache_version, cache_key_endpoint, result)

    # Fire webhooks — fire-and-forget, never blocks the response
    dispatch_event_bg(key_info.raw_key, "classify", {**result, "image_hash": image_hash})

    return JSONResponse(content=result, headers={"X-Cache": "MISS"})


@router.post(
    "/censor",
    tags=["Detection"],
    responses={200: {"content": {"image/png": {}}, "description": "Censored PNG image with NSFW regions blurred"}},
)
async def censor(
    file: UploadFile = File(...),
    model: ModelName = Query(ModelName.nudenet),
    labels: Optional[str] = Form(None),
    key_info: KeyInfo = Depends(validate_api_key),
):
    """Censor NSFW regions in an image using Gaussian blur.

    Detects NSFW content with the selected model, then applies Gaussian blur to
    matching regions on the full-resolution original. Returns the censored image
    as PNG. CLIP analysis results (age, deepfake, clothing) are included in
    response headers (X-Estimated-Age, X-Minor-Risk, X-Deepfake-Verdict, X-Clothing).

    Optionally specify which detection labels to censor via the `labels` form field
    (comma-separated). Defaults to the model's standard censor set.
    """
    data = await file.read()
    validate_upload(data)
    detect_img, scale, full_img = preprocess_full(data)
    detections = await run_detection_async(detect_img, model, scale)

    censor_labels = (
        [l.strip() for l in labels.split(",") if l.strip()]
        if labels else DEFAULT_CENSOR[model]
    )

    censored_bytes = apply_censoring(full_img, detections, censor_labels)

    # CLIP analysis — reuses already-decoded full_img
    analysis = await _run_clip_analysis(full_img)

    image_id, orig_path = await store_image_async(data, get_ext(file.filename), "originals")
    censored_path = await store_image_with_id_async(censored_bytes, ".png", "censored", image_id)

    log_usage_bg(key_info, "/censor", "POST", 200)
    save_detection_bg(key_info, image_id, "censor", model.value, detections, original_path=orig_path, censored_path=censored_path)

    headers = {"X-Image-Id": image_id}
    if analysis.get("age", {}).get("available"):
        headers["X-Estimated-Age"] = str(analysis["age"]["estimated_age"])
        headers["X-Minor-Risk"] = str(analysis["age"]["is_minor_risk"])
    if analysis.get("deepfake", {}).get("available"):
        headers["X-Deepfake-Verdict"] = analysis["deepfake"]["verdict"]
    if analysis.get("clothing", {}).get("available"):
        headers["X-Clothing"] = analysis["clothing"]["clothing"]

    return Response(content=censored_bytes, media_type="image/png", headers=headers)
