"""Batch processing endpoint."""

from __future__ import annotations

import asyncio
import logging

# ponytail: fixed cap; inference is lock-serialized in models.py, so this only
# overlaps decode + S3 store I/O. Bump if store latency dominates.
_ITEM_CONCURRENCY = 4

from fastapi import APIRouter, BackgroundTasks, Depends, File, Query, UploadFile
from fastapi.responses import JSONResponse

from ..auth import KeyInfo, log_usage_bg, save_detection_bg, validate_api_key
from ..batch import extract_images_from_archive, validate_image
from ..models import ModelName, get_ext, preprocess, run_detection_async, store_image_async, validate_upload
from ..jobs import JobResult, create_job, run_job
from ..schemas import BatchResponse, JobAcceptedResponse

logger = logging.getLogger("api.batch")
router = APIRouter()


async def _process_batch(
    data: bytes,
    filename: str,
    model: ModelName,
    key_info: KeyInfo,
) -> dict:
    """Core archive processing shared by synchronous and async requests."""
    from fastapi import HTTPException

    try:
        images = extract_images_from_archive(data, filename)
    except ValueError as e:
        raise HTTPException(400, str(e))

    if not images:
        raise HTTPException(400, "No images found in archive")

    sem = asyncio.Semaphore(_ITEM_CONCURRENCY)

    async def _process_item(img_name: str, img_data: bytes) -> dict:
        if not validate_image(img_data):
            return {"filename": img_name, "error": "Invalid image", "detections": []}
        try:
            img, scale = preprocess(img_data)
            detections = await run_detection_async(img, model, scale)
            image_id, orig_path = await store_image_async(img_data, get_ext(img_name), "originals")
            save_detection_bg(key_info, image_id, "batch", model.value, detections, original_path=orig_path)
            return {"filename": img_name, "image_id": image_id, "detections": detections}
        except Exception as e:
            logger.warning("Batch item %s failed: %s", img_name, e)
            return {"filename": img_name, "error": str(e), "detections": []}

    async def _bounded(img_name: str, img_data: bytes) -> dict:
        async with sem:
            return await _process_item(img_name, img_data)

    # gather preserves input order → results stay stable
    results = list(await asyncio.gather(*(_bounded(n, d) for n, d in images)))

    return {
        "model": model.value,
        "total": len(images),
        "processed": sum(1 for r in results if "image_id" in r),
        "errors": sum(1 for r in results if "error" in r),
        "results": results,
    }


@router.post(
    "/batch",
    response_model=BatchResponse | JobAcceptedResponse,
    tags=["Detection"],
    responses={202: {"model": JobAcceptedResponse, "description": "Async job accepted"}},
)
async def batch_process(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    model: ModelName = Query(ModelName.nudenet),
    async_mode: bool = Query(False, alias="async", description="Return a job_id immediately"),
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
    filename = file.filename or "archive.zip"

    if async_mode:
        job = await create_job(key_info, "batch", filename, data)

        async def worker(job_data: bytes) -> JobResult:
            result = await _process_batch(job_data, filename, model, key_info)
            return JobResult(data=result)

        background_tasks.add_task(run_job, job.id, key_info.raw_key, worker)
        log_usage_bg(key_info, "/batch?async=true", "POST", 202)
        return JSONResponse(
            status_code=202,
            content={"job_id": job.id, "status": "queued", "status_url": f"/jobs/{job.id}"},
        )

    result = await _process_batch(data, filename, model, key_info)
    log_usage_bg(key_info, "/batch", "POST", 200)
    return result
