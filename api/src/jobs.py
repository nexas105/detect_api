"""Persistent metadata and in-process execution for asynchronous media jobs."""

from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Awaitable, Callable

import anyio
from sqlalchemy import select

from db.src.database import async_session

from .auth import KeyInfo
from .models_db import AsyncJob
from .storage import storage
from .webhooks import dispatch_job_event_bg

logger = logging.getLogger("api.jobs")


@dataclass
class JobResult:
    """Result returned by an async job worker."""

    data: dict
    output_bytes: bytes | None = None
    output_suffix: str = ".bin"
    output_content_type: str = "application/octet-stream"


JobWorker = Callable[[bytes], Awaitable[JobResult]]


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def create_job(
    key_info: KeyInfo,
    endpoint: str,
    filename: str,
    data: bytes,
) -> AsyncJob:
    """Persist a queued job and its input before returning 202 to the client."""
    job_id = str(uuid.uuid4())
    suffix = Path(filename).suffix.lower() or ".bin"
    input_path = f"jobs/{job_id}/input{suffix}"
    await storage.put_bytes_async(input_path, data)

    job = AsyncJob(
        id=job_id,
        tenant_id=key_info.tenant_id,
        endpoint=endpoint,
        status="queued",
        progress=0,
        input_path=input_path,
    )
    try:
        async with async_session() as session:
            session.add(job)
            await session.commit()
            await session.refresh(job)
    except Exception:
        await anyio.to_thread.run_sync(storage.delete, input_path)
        raise
    return job


async def _set_running(job_id: str) -> None:
    async with async_session() as session:
        job = await session.get(AsyncJob, job_id)
        if job is None:
            raise RuntimeError(f"Async job {job_id} disappeared")
        job.status = "running"
        job.progress = 10
        job.started_at = _now()
        await session.commit()


async def _set_succeeded(job_id: str, result: JobResult) -> AsyncJob:
    output_path: str | None = None
    if result.output_bytes is not None:
        output_path = f"jobs/{job_id}/output{result.output_suffix}"
        await storage.put_bytes_async(
            output_path, result.output_bytes, content_type=result.output_content_type
        )

    async with async_session() as session:
        job = await session.get(AsyncJob, job_id)
        if job is None:
            raise RuntimeError(f"Async job {job_id} disappeared")
        job.status = "succeeded"
        job.progress = 100
        job.result_json = json.dumps(result.data, default=str)
        job.output_path = output_path
        job.completed_at = _now()
        await session.commit()
        await session.refresh(job)
        return job


async def _set_failed(job_id: str, error: str) -> AsyncJob | None:
    async with async_session() as session:
        job = await session.get(AsyncJob, job_id)
        if job is None:
            return None
        job.status = "failed"
        job.progress = 100
        job.error = error[:4000]
        job.completed_at = _now()
        await session.commit()
        await session.refresh(job)
        return job


async def run_job(job_id: str, api_key: str, worker: JobWorker) -> None:
    """Execute a queued job and dispatch its terminal webhook event."""
    input_path: str | None = None
    try:
        await _set_running(job_id)
        async with async_session() as session:
            job = await session.get(AsyncJob, job_id)
            if job is None:
                raise RuntimeError(f"Async job {job_id} not found")
            input_path = job.input_path

        data = await anyio.to_thread.run_sync(storage.get_bytes, input_path)
        result = await worker(data)
        job = await _set_succeeded(job_id, result)
        payload = serialize_job(job)
        dispatch_job_event_bg(api_key, "completed", payload)
    except Exception as exc:
        logger.exception("Async job %s failed", job_id)
        job = await _set_failed(job_id, str(exc))
        if job is not None:
            dispatch_job_event_bg(api_key, "failed", serialize_job(job))
    finally:
        if input_path:
            try:
                await anyio.to_thread.run_sync(storage.delete, input_path)
            except Exception:
                logger.warning("Could not delete input for async job %s", job_id)


async def get_job_for_tenant(job_id: str, tenant_id: str) -> AsyncJob | None:
    async with async_session() as session:
        stmt = select(AsyncJob).where(
            AsyncJob.id == job_id,
            AsyncJob.tenant_id == tenant_id,
        )
        return (await session.execute(stmt)).scalar_one_or_none()


async def fail_interrupted_jobs() -> int:
    """Fail jobs orphaned by a previous API process.

    BackgroundTasks cannot be resumed after a process restart. Keeping those
    rows in ``queued``/``running`` forever is worse than a clear terminal state:
    clients can retry the request and operators can alert on the failure.
    """
    async with async_session() as session:
        result = await session.execute(
            select(AsyncJob).where(AsyncJob.status.in_(("queued", "running")))
        )
        jobs = list(result.scalars().all())
        if not jobs:
            return 0

        completed_at = _now()
        for job in jobs:
            job.status = "failed"
            job.progress = 100
            job.error = "API process restarted before this job completed; submit it again"
            job.completed_at = completed_at
        await session.commit()

    for job in jobs:
        try:
            await anyio.to_thread.run_sync(storage.delete, job.input_path)
        except Exception:
            logger.warning("Could not delete input for interrupted job %s", job.id)

    logger.warning("Marked %d interrupted async job(s) as failed", len(jobs))
    return len(jobs)


def serialize_job(job: AsyncJob) -> dict:
    result = json.loads(job.result_json) if job.result_json else None
    return {
        "job_id": job.id,
        "endpoint": job.endpoint,
        "status": job.status,
        "progress": job.progress,
        "result": result,
        "error": job.error,
        "status_url": f"/jobs/{job.id}",
        "output_url": f"/jobs/{job.id}/output" if job.output_path else None,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
    }
