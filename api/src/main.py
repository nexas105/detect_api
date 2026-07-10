"""NSFW Detection API v2 — app setup, middleware, error handling."""

from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from .auth import close_http_client
from .config import AUTH_SERVICE_URL, CORS_ORIGINS, CORS_ORIGIN_REGEX
from .models import get_nudenet
from .jobs import fail_interrupted_jobs
from .ratelimit import rate_limiter
from .worker_pool import init_pool, shutdown_pool

logger = logging.getLogger("api")


# ── Lifespan ────────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_pool()  # ML worker pool (if ML_WORKERS > 0)
    get_nudenet()  # warmup main process models
    await fail_interrupted_jobs()
    await rate_limiter.init(AUTH_SERVICE_URL)
    logger.info("API ready")
    yield
    shutdown_pool()
    await rate_limiter.shutdown()
    await close_http_client()
    logger.info("API shutdown")


# ── App ─────────────────────────────────────────────────────────────────────

tags_metadata = [
    {"name": "Detection", "description": "NSFW detection and censoring for images"},
    {"name": "Rating", "description": "Multi-factor sexiness/attractiveness scoring"},
    {"name": "Moderation", "description": "All-in-one content moderation with action recommendations"},
    {"name": "CLIP", "description": "CLIP-based image analysis: embeddings, comparison, zero-shot tagging"},
    {"name": "Face & Pose", "description": "Face detection, anonymization, and body pose estimation"},
    {"name": "Video", "description": "Video frame analysis, censoring, and scene extraction"},
    {"name": "Demo", "description": "Free demo endpoints with IP-based rate limiting (no API key required)"},
    {"name": "System", "description": "Health checks and model information"},
    {"name": "Storage", "description": "Image storage and retrieval"},
    {"name": "Jobs", "description": "Asynchronous batch and video job status"},
]

app = FastAPI(
    title="EroHub NSFW Detection API",
    description="Multi-model NSFW detection, content moderation, and image analysis API. "
    "Supports NudeNet, EraX, and CLIP models for detection, censoring, rating, "
    "embeddings, face anonymization, pose estimation, and video analysis.",
    version="2.0.0",
    openapi_tags=tags_metadata,
    lifespan=lifespan,
)


# ── CORS ────────────────────────────────────────────────────────────────────

from fastapi.middleware.cors import CORSMiddleware

# CORS. If explicit origins/regex are configured, reflect only those and allow
# credentials. With nothing configured we fall back to a wildcard for open demo
# use — but credentials MUST be off then, since "*" + credentials is unsafe
# (and rejected by browsers). In production set CORS_ORIGINS to the Studio domain(s).
_cors_configured = bool(CORS_ORIGINS or CORS_ORIGIN_REGEX)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS if _cors_configured else ["*"],
    allow_origin_regex=CORS_ORIGIN_REGEX,
    allow_credentials=_cors_configured,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request-ID Middleware ───────────────────────────────────────────────────


from starlette.middleware.base import BaseHTTPMiddleware


class RequestIDMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-ID", uuid.uuid4().hex[:12])
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response


app.add_middleware(RequestIDMiddleware)


# ── Error Handling ──────────────────────────────────────────────────────────


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": True,
            "status": exc.status_code,
            "detail": exc.detail,
            "path": str(request.url.path),
            "request_id": getattr(request.state, "request_id", None),
        },
    )


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    rid = getattr(request.state, "request_id", "unknown")
    logger.exception("Unhandled error [%s] %s %s", rid, request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={
            "error": True,
            "status": 500,
            "detail": "Internal server error",
            "path": str(request.url.path),
            "request_id": rid,
        },
    )


# ── Register Routers ───────────────────────────────────────────────────────

from .endpoints.classify import router as classify_router
from .endpoints.batch import router as batch_router
from .endpoints.images import router as images_router
from .endpoints.demo import router as demo_router
from .endpoints.health import router as health_router
from .endpoints.rateme import router as rateme_router
from .endpoints.video import router as video_router
from .endpoints.clip import router as clip_router, demo_router as clip_demo_router
from .endpoints.moderate import router as moderate_router
from .endpoints.face_pose import router as face_pose_router
from .endpoints.jobs import router as jobs_router

app.include_router(classify_router)
app.include_router(batch_router)
app.include_router(images_router)
app.include_router(demo_router)
app.include_router(health_router)
app.include_router(rateme_router)
app.include_router(video_router)
app.include_router(clip_router)
app.include_router(clip_demo_router)
app.include_router(moderate_router)
app.include_router(face_pose_router)
app.include_router(jobs_router)
