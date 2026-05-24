"""Batch processing endpoint."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, File, Query, UploadFile

from ..auth import KeyInfo, log_usage_bg, save_detection_bg, validate_api_key
from ..batch import extract_images_from_archive, validate_image
from ..models import ModelName, get_ext, preprocess, run_detection_async, store_image_async, validate_upload
from ..schemas import BatchResponse

logger = logging.getLogger("api.batch")
router = APIRouter()


@router.post("/batch", response_model=BatchResponse, tags=["Detection"])
async def batch_process(
    file: UploadFile = File(...),
    model: ModelName = Query(ModelName.nudenet),
    key_info: KeyInfo = Depends(validate_api_key),
):
    """Process a ZIP or RAR archive of images for NSFW detection.

    Extracts all images from the uploaded archive, runs detection on each
    using the selected model (NudeNet or EraX), and returns per-file results
    with detections, bounding boxes, and confidence scores. Invalid images
    within the archive are reported with error messages.
    """
    data = await file.read()
    validate_upload(data)

    from fastapi import HTTPException
    try:
        images = extract_images_from_archive(data, file.filename or "archive.zip")
    except ValueError as e:
        raise HTTPException(400, str(e))

    if not images:
        raise HTTPException(400, "No images found in archive")

    results = []
    for img_name, img_data in images:
        if not validate_image(img_data):
            results.append({"filename": img_name, "error": "Invalid image", "detections": []})
            continue
        try:
            img, scale = preprocess(img_data)
            detections = await run_detection_async(img, model, scale)
            image_id, orig_path = await store_image_async(img_data, get_ext(img_name), "originals")
            save_detection_bg(key_info, image_id, "batch", model.value, detections, original_path=orig_path)
            results.append({"filename": img_name, "image_id": image_id, "detections": detections})
        except Exception as e:
            logger.warning("Batch item %s failed: %s", img_name, e)
            results.append({"filename": img_name, "error": str(e), "detections": []})

    log_usage_bg(key_info, "/batch", "POST", 200)

    return {
        "model": model.value,
        "total": len(images),
        "processed": sum(1 for r in results if "image_id" in r),
        "errors": sum(1 for r in results if "error" in r),
        "results": results,
    }
