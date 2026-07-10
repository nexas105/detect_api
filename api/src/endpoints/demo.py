"""Demo endpoints — no auth, IP rate limited, images stored under demo account."""

from __future__ import annotations

import logging

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile

from ..auth import KeyInfo, get_http_client, log_usage_bg, save_detection_bg
from ..batch import extract_images_from_archive, validate_image
from ..config import AUTH_SERVICE_URL
from ..demo import demo_limiter
from ..models import ModelName, get_ext, preprocess, run_detection_async, store_image_async, validate_upload
from ..schemas import DemoAdminUsageResponse, DemoBatchResponse, DemoClassifyResponse, DemoLimits

logger = logging.getLogger("api.demo")
router = APIRouter(prefix="/demo")

# Cached demo key info (fetched from auth on first use)
_demo_key_info: KeyInfo | None = None


async def _get_demo_key() -> KeyInfo:
    """Fetch the demo system API key from auth service (cached)."""
    global _demo_key_info
    if _demo_key_info:
        return _demo_key_info
    try:
        client = await get_http_client()
        resp = await client.get(f"{AUTH_SERVICE_URL}/demo/key")
        if resp.status_code == 200:
            raw_key = resp.json()["key"]
            # Validate to get full key info
            resp2 = await client.post(
                f"{AUTH_SERVICE_URL}/validate-key",
                headers={"Authorization": f"Bearer {raw_key}"},
            )
            if resp2.status_code == 200:
                _demo_key_info = KeyInfo(resp2.json(), raw_key)
                logger.info("Demo key loaded: %s", raw_key[:8])
                return _demo_key_info
    except Exception as e:
        logger.warning("Could not fetch demo key: %s", e)
    raise HTTPException(503, "Demo service not ready")


@router.post("/classify", response_model=DemoClassifyResponse, tags=["Demo"])
async def demo_classify(
    request: Request,
    file: UploadFile = File(...),
    model: ModelName = Query(ModelName.nudenet),
):
    """Demo NSFW classification with no authentication required.

    Same detection as /classify but without CLIP analysis, with IP-based rate
    limiting (10 images/hour), and a 10MB file size cap. Results are stored
    under the demo system account.
    """
    await demo_limiter.check_image(request)
    data = await file.read()
    validate_upload(data, max_size=10 * 1024 * 1024)

    img, scale = preprocess(data)
    detections = await run_detection_async(img, model, scale)

    # Store under demo account
    key_info = await _get_demo_key()
    image_id, orig_path = await store_image_async(data, get_ext(file.filename), "originals")
    log_usage_bg(key_info, "/demo/classify", "POST", 200)
    save_detection_bg(key_info, image_id, "demo", model.value, detections, original_path=orig_path)

    return {
        "model": model.value, "detections": detections, "image_id": image_id,
        "demo": True, "limits": await demo_limiter.get_remaining(request),
    }


@router.post("/batch", response_model=DemoBatchResponse, tags=["Demo"])
async def demo_batch(
    request: Request,
    file: UploadFile = File(...),
    model: ModelName = Query(ModelName.nudenet),
):
    """Demo batch archive processing with no authentication required.

    Same as /batch but with demo limits: max 10 images per archive,
    1 archive per hour per IP, and 50MB file size cap.
    """
    await demo_limiter.check_archive(request)
    data = await file.read()
    validate_upload(data, max_size=50 * 1024 * 1024)

    try:
        images = extract_images_from_archive(data, file.filename or "archive.zip")
    except ValueError as e:
        raise HTTPException(400, str(e))

    if not images:
        raise HTTPException(400, "No images found in archive")
    if len(images) > 10:
        raise HTTPException(400, f"Demo limit: max 10 images per archive (found {len(images)})")

    key_info = await _get_demo_key()
    results = []
    for img_name, img_data in images:
        if not validate_image(img_data):
            results.append({"filename": img_name, "error": "Invalid image", "detections": []})
            continue
        try:
            img, scale = preprocess(img_data)
            detections = await run_detection_async(img, model, scale)
            image_id, orig_path = await store_image_async(img_data, get_ext(img_name), "originals")
            save_detection_bg(key_info, image_id, "demo", model.value, detections, original_path=orig_path)
            results.append({"filename": img_name, "image_id": image_id, "detections": detections})
        except Exception as e:
            results.append({"filename": img_name, "error": str(e), "detections": []})

    processed = sum(1 for r in results if "error" not in r)
    log_usage_bg(key_info, "/demo/batch", "POST", 200)

    return {
        "model": model.value, "total": len(images),
        "processed": processed,
        "results": results, "demo": True,
        "limits": await demo_limiter.get_remaining(request),
    }


@router.get("/limits", response_model=DemoLimits, tags=["Demo"])
async def demo_limits(request: Request):
    """Check remaining demo rate limits for the current IP.

    Returns the number of remaining image and archive requests, plus the
    time until the rate limit window resets (3600 seconds).
    """
    return await demo_limiter.get_remaining(request)


@router.get("/admin/usage", response_model=DemoAdminUsageResponse, tags=["System"])
async def demo_admin_usage():
    """View live demo usage statistics from memory (super admin only).

    Returns per-IP usage data for all active demo users including request
    counts and timestamps.
    """
    return {"demo_users": await demo_limiter.get_all_usage()}
