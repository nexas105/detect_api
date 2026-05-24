"""Shared config and state for the API service."""

from __future__ import annotations

import os
from pathlib import Path

AUTH_SERVICE_URL = os.getenv("AUTH_SERVICE_URL", "http://localhost:8001")

# Storage backend: "local" (filesystem) or "s3" (S3-compatible, e.g. MinIO)
STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "local").lower()
STORAGE_DIR = Path(os.getenv("STORAGE_DIR", "/app/storage"))
if STORAGE_BACKEND == "local":
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)

# S3 / MinIO settings (used when STORAGE_BACKEND=s3)
S3_ENDPOINT = os.getenv("S3_ENDPOINT", "").rstrip("/")
S3_BUCKET = os.getenv("S3_BUCKET", "")
S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY", "")
S3_SECRET_KEY = os.getenv("S3_SECRET_KEY", "")
S3_REGION = os.getenv("S3_REGION", "us-east-1")
# When true, /storage/{cat}/{file} redirects to a presigned URL instead of proxying bytes.
S3_USE_PRESIGNED_URLS = os.getenv("S3_USE_PRESIGNED_URLS", "true").lower() in ("1", "true", "yes", "on")
S3_PRESIGN_EXPIRES = int(os.getenv("S3_PRESIGN_EXPIRES", "3600"))

MODEL_DIR = Path(os.getenv("MODEL_DIR", os.path.expanduser("~/.nudenet_api/models")))
MODEL_DIR.mkdir(parents=True, exist_ok=True)
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
CORS_ORIGIN_REGEX = os.getenv("CORS_ORIGIN_REGEX", "").strip() or None
MAX_UPLOAD_SIZE = int(os.getenv("MAX_UPLOAD_SIZE", str(50 * 1024 * 1024)))
MAX_VIDEO_SIZE = int(os.getenv("MAX_VIDEO_SIZE", str(200 * 1024 * 1024)))  # 200MB
MAX_VIDEO_DURATION = int(os.getenv("MAX_VIDEO_DURATION", "300"))  # 5 min
MAX_DETECT_SIZE = 1280

# Result cache — sha256(image) -> cached ML result
CACHE_ENABLED = os.getenv("CACHE_ENABLED", "true").lower() in ("1", "true", "yes", "on")
CACHE_TTL_DAYS = int(os.getenv("CACHE_TTL_DAYS", "30"))
CACHE_TTL_SECONDS = CACHE_TTL_DAYS * 86400
