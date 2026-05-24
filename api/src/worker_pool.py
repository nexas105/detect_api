"""ML inference worker pool — configurable via ML_WORKERS env var.

Modes:
  ML_WORKERS=0  → inline (no pool, same process, ~2GB RAM total)
  ML_WORKERS=1  → 1 worker process with shared model memory
  ML_WORKERS=2+ → N workers, torch shared memory reduces per-worker overhead

Memory with shared memory (torch.multiprocessing):
  1 worker:  ~2.0GB (baseline)
  2 workers: ~2.8GB (shared model weights, only gradients/state separate)
  4 workers: ~3.5GB

Without shared memory (standard multiprocessing):
  1 worker:  ~2.0GB
  2 workers: ~4.0GB (full copy per worker)
"""

from __future__ import annotations

import asyncio
import io
import logging
import os
from functools import partial

from PIL import Image, ImageOps

logger = logging.getLogger("api.worker")

ML_WORKERS = int(os.getenv("ML_WORKERS", "0"))
_pool = None
_shared_models = False


def _init_worker_shared():
    """Worker init with shared model memory already loaded in parent."""
    logger.info("Worker ready (shared memory)")


def _init_worker_standalone():
    """Worker init — loads own copy of all models."""
    logger.info("Worker initializing — loading models...")
    from .models import get_erax, get_nudenet
    get_nudenet()
    get_erax()
    try:
        from .clip_scorer import _load_clip
        _load_clip()
    except Exception:
        pass
    logger.info("Worker ready (standalone)")


def _run_inference(data: bytes, task: str) -> dict:
    """Run inference in worker process."""
    from .models import ModelName, preprocess, run_detection
    from .clip_scorer import score_sexiness

    img, scale = preprocess(data)

    if task == "classify_nudenet":
        return {"detections": run_detection(img, ModelName.nudenet, scale)}

    elif task == "classify_erax":
        return {"detections": run_detection(img, ModelName.erax, scale)}

    elif task == "rateme":
        nudenet_dets = run_detection(img, ModelName.nudenet, scale)
        erax_dets = run_detection(img, ModelName.erax, scale)

        full_img = Image.open(io.BytesIO(data))
        full_img = ImageOps.exif_transpose(full_img)
        if full_img.mode != "RGB":
            full_img = full_img.convert("RGB")
        clip_result = score_sexiness(full_img)

        return {
            "nudenet_detections": nudenet_dets,
            "erax_detections": erax_dets,
            "clip": clip_result,
        }

    return {"error": f"Unknown task: {task}"}


def init_pool():
    """Initialize the worker pool with shared memory when possible."""
    global _pool, _shared_models
    if ML_WORKERS <= 0:
        logger.info("ML_WORKERS=%d — inference runs inline (no pool)", ML_WORKERS)
        return

    # Try torch.multiprocessing for shared model memory
    try:
        import torch.multiprocessing as mp
        from concurrent.futures import ProcessPoolExecutor

        # Set sharing strategy — file_system is more reliable than file_descriptor
        mp.set_sharing_strategy("file_system")

        # Pre-load models in parent process (workers inherit via fork + shared memory)
        logger.info("Pre-loading models for shared memory...")
        from .models import get_erax, get_nudenet
        get_nudenet()
        get_erax()
        try:
            from .clip_scorer import _load_clip
            _load_clip()
        except Exception:
            pass

        # Share model tensors
        try:
            import torch
            for model_obj in [get_nudenet(), get_erax()]:
                if hasattr(model_obj, "model") and hasattr(model_obj.model, "share_memory"):
                    model_obj.model.share_memory()
        except Exception:
            pass

        mem_per_worker = 2.0 if ML_WORKERS == 1 else 0.8  # shared saves ~60% per extra worker
        total_mem = 2.0 + (ML_WORKERS - 1) * mem_per_worker
        logger.info(
            "Starting %d ML worker(s) with shared memory (~%.1fGB estimated)",
            ML_WORKERS, total_mem,
        )

        # Use torch mp context for fork with shared memory
        ctx = mp.get_context("fork")
        _pool = ProcessPoolExecutor(
            max_workers=ML_WORKERS,
            mp_context=ctx,
            initializer=_init_worker_shared,
        )
        _shared_models = True
        logger.info("Worker pool ready (shared memory)")

    except Exception as e:
        # Fallback to standard multiprocessing (no shared memory)
        logger.warning("Shared memory not available (%s), using standard multiprocessing", e)
        from concurrent.futures import ProcessPoolExecutor

        total_mem = ML_WORKERS * 2
        logger.info("Starting %d ML worker(s) (~%dGB RAM)", ML_WORKERS, total_mem)

        _pool = ProcessPoolExecutor(
            max_workers=ML_WORKERS,
            initializer=_init_worker_standalone,
        )
        _shared_models = False
        logger.info("Worker pool ready (standalone)")


def shutdown_pool():
    """Shutdown worker pool."""
    global _pool
    if _pool:
        _pool.shutdown(wait=False)
        logger.info("Worker pool shutdown")
        _pool = None


async def run_in_pool(data: bytes, task: str) -> dict:
    """Submit inference to worker pool. Falls back to inline if no pool."""
    loop = asyncio.get_event_loop()
    if _pool is None:
        return await loop.run_in_executor(None, partial(_run_inference, data, task))
    return await loop.run_in_executor(_pool, partial(_run_inference, data, task))


def pool_status() -> dict:
    """Return worker pool status for health endpoint."""
    if ML_WORKERS <= 0:
        return {"ml_workers": 0, "pool_active": False, "mode": "inline", "memory_estimate_gb": 2.0}

    if _shared_models:
        mem = 2.0 + (ML_WORKERS - 1) * 0.8
    else:
        mem = ML_WORKERS * 2.0

    return {
        "ml_workers": ML_WORKERS,
        "pool_active": _pool is not None,
        "mode": "shared_memory" if _shared_models else "standalone",
        "memory_estimate_gb": round(mem, 1),
    }
