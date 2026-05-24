"""Health and model info endpoints."""

from __future__ import annotations

from fastapi import APIRouter

from ..models import MODELS_INFO, _erax_model, _nudenet_detector
from ..schemas import HealthResponse, ModelsResponse
from ..worker_pool import pool_status

router = APIRouter()


@router.get("/health", response_model=HealthResponse, tags=["System"])
async def health():
    """Check API health and loaded model status.

    Returns the service status, which ML models are loaded (NudeNet, EraX),
    and the current worker pool configuration (pool size, active workers).
    """
    return {
        "status": "ok",
        "models": {
            "nudenet": _nudenet_detector is not None,
            "erax": _erax_model is not None,
        },
        "workers": pool_status(),
    }


@router.get("/models", response_model=ModelsResponse, tags=["System"])
async def list_models():
    """List all available ML models with their capabilities.

    Returns metadata for each detection model including its ID, name,
    description, supported detection labels, and default censor label set.
    """
    return {"models": MODELS_INFO}
