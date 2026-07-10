"""Classify and censor endpoints — with age, deepfake, and clothing analysis."""

from __future__ import annotations

import asyncio
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import JSONResponse, Response
from PIL import Image

from ..auth import KeyInfo, log_usage_bg, save_detection_bg, validate_api_key
from ..cache import get_cached, hash_image, set_cached
from ..webhooks import dispatch_event_bg
from ..models import (
    DEFAULT_CENSOR, ModelName, apply_censoring, get_ext, model_version_for,
    preprocess_full, store_image_async, store_image_with_id_async, validate_upload,
)
from .rateme import cache_hit_response, cached_clip, cached_detection, persist_result
from ..schemas import ClassifyResponse

router = APIRouter()


async def _run_clip_analysis(image_hash: str, img: Image.Image, no_cache: bool = False) -> dict:
    """Run shared-cached CLIP analysis on a pre-decoded PIL Image. Returns {} on failure."""
    try:
        return await cached_clip(image_hash, img, no_cache)
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
            # Cache contains reusable inference only. Every request gets its own
            # storage record so IDs never leak across users/tenants.
            return await cache_hit_response(data, file.filename, key_info, "classify", model.value, cached)

    detect_img, scale, full_img = preprocess_full(data)
    # Detection and CLIP use independent models, run concurrently; both are
    # shared-cached across endpoints (a prior rateme/moderate warms them).
    detections, analysis = await asyncio.gather(
        cached_detection(image_hash, model, detect_img, scale, bool(no_cache)),
        _run_clip_analysis(image_hash, full_img, bool(no_cache)),
    )

    image_id = await persist_result(data, file.filename, key_info, "classify", model.value, detections)

    result = {"image_id": image_id, "model": model.value, "detections": detections}
    if analysis:
        result["age"] = analysis.get("age")
        result["deepfake"] = analysis.get("deepfake")
        result["clothing"] = analysis.get("clothing")

    # Store reusable inference only; image_id is generated per request, including hits.
    if not no_cache:
        await set_cached(
            image_hash, cache_version, cache_key_endpoint,
            {k: v for k, v in result.items() if k != "image_id"},
        )

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
    image_hash = hash_image(data)
    detect_img, scale, full_img = preprocess_full(data)
    detections = await cached_detection(image_hash, model, detect_img, scale)

    censor_labels = (
        [l.strip() for l in labels.split(",") if l.strip()]
        if labels else DEFAULT_CENSOR[model]
    )

    censored_bytes = apply_censoring(full_img, detections, censor_labels)

    # CLIP analysis — shared-cached, reuses already-decoded full_img
    analysis = await _run_clip_analysis(image_hash, full_img)

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
