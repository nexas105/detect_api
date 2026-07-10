"""Tenant-scoped async job status and output endpoints."""

from __future__ import annotations

import mimetypes

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from ..auth import KeyInfo, validate_api_key
from ..jobs import get_job_for_tenant, serialize_job
from ..schemas import JobStatusResponse
from ..storage import storage

router = APIRouter()


@router.get("/jobs/{job_id}", response_model=JobStatusResponse, tags=["Jobs"])
async def get_job(job_id: str, key_info: KeyInfo = Depends(validate_api_key)):
    """Return current state and result metadata for an asynchronous job."""
    job = await get_job_for_tenant(job_id, key_info.tenant_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    return serialize_job(job)


@router.get(
    "/jobs/{job_id}/output",
    tags=["Jobs"],
    responses={200: {"content": {"application/octet-stream": {}}}},
)
async def get_job_output(job_id: str, key_info: KeyInfo = Depends(validate_api_key)):
    """Download the binary output of a completed video job."""
    job = await get_job_for_tenant(job_id, key_info.tenant_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    if job.status != "succeeded":
        raise HTTPException(409, f"Job is {job.status}")
    if not job.output_path:
        raise HTTPException(404, "Job has no binary output")
    if not storage.exists(job.output_path):
        raise HTTPException(410, "Job output is no longer available")
    content_type, _ = mimetypes.guess_type(job.output_path)
    return Response(
        content=await storage.get_bytes_async(job.output_path),
        media_type=content_type or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{job_id}{mimetypes.guess_extension(content_type or "") or ""}"'},
    )
