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

# EraX publishes YOLO11 nano/small/medium weights. Medium has the best reported
# accuracy; smaller variants remain useful for memory-constrained deployments.
ERAX_MODEL_SIZE = os.getenv("ERAX_MODEL_SIZE", "m").strip().lower()
if ERAX_MODEL_SIZE not in {"n", "s", "m"}:
    raise ValueError("ERAX_MODEL_SIZE must be one of: n, s, m")
ERAX_MODEL_REVISION = os.getenv(
    "ERAX_MODEL_REVISION", "90878ab981060833413ae1a24df72f5e1fff66bc"
).strip()
ERAX_MODEL_FILENAME = f"erax-anti-nsfw-yolo11{ERAX_MODEL_SIZE}-v1.1.pt"
# Comma-separated CIDRs/IPs of proxy hops allowed to set X-Forwarded-For.
# Empty → XFF is not trusted at all (client.host used); set to your reverse
# proxy's address(es) in production so the real client IP can be resolved.
TRUSTED_PROXIES = os.getenv("TRUSTED_PROXIES", "").strip()
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
