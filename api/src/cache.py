"""Result cache for ML inference — Redis primary, DB fallback.

Same image + same model + same endpoint = cache hit, no inference re-run.

Tiers (mirrors ratelimit.py):
  1. Redis (if REDIS_URL set) — fast, TTL-based (CACHE_TTL_DAYS)
  2. DB (detection_cache table) — durable fallback
  3. Disabled — if CACHE_ENABLED=false, everything no-ops

Key format: "detection:{sha256_hex}:{model_version}:{endpoint}"

Usage is still logged on cache hit — customers pay for the result, we save compute.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Optional

from .config import CACHE_ENABLED, CACHE_TTL_SECONDS

logger = logging.getLogger("api.cache")

REDIS_URL = os.getenv("REDIS_URL", "")
_redis = None
_redis_available = False
_redis_init_attempted = False


# ── Hashing ─────────────────────────────────────────────────────────────────


def hash_image(data: bytes) -> str:
    """Return sha256 hex digest of the raw image bytes."""
    return hashlib.sha256(data).hexdigest()


# ── Redis connection ────────────────────────────────────────────────────────


def _init_redis() -> None:
    global _redis, _redis_available, _redis_init_attempted
    _redis_init_attempted = True
    if not REDIS_URL:
        logger.info("Cache: no REDIS_URL — DB fallback only")
        return
    try:
        import redis
        _redis = redis.from_url(REDIS_URL, decode_responses=True)
        _redis.ping()
        _redis_available = True
        logger.info("Cache: Redis connected (%s)", REDIS_URL)
    except Exception as e:
        logger.warning("Cache: Redis unavailable (%s) — DB fallback", e)
        _redis = None
        _redis_available = False


def _try_redis():
    """Return Redis client if reachable, else None. Lazy-init on first use."""
    global _redis, _redis_available
    if not _redis_init_attempted:
        _init_redis()
    if not REDIS_URL:
        return None
    if _redis_available and _redis:
        try:
            _redis.ping()
            return _redis
        except Exception:
            logger.warning("Cache: Redis connection lost, falling back to DB")
            _redis_available = False
    return None


def _redis_key(image_hash: str, model_version: str, endpoint: str) -> str:
    return f"detection:{image_hash}:{model_version}:{endpoint}"


# ── Public API ──────────────────────────────────────────────────────────────


async def get_cached(
    image_hash: str,
    model_version: str,
    endpoint: str,
) -> Optional[dict[str, Any]]:
    """Return cached result dict or None. Redis first, DB fallback."""
    if not CACHE_ENABLED:
        return None

    # Redis
    r = _try_redis()
    if r:
        try:
            raw = r.get(_redis_key(image_hash, model_version, endpoint))
            if raw:
                return json.loads(raw)
        except Exception as e:
            logger.warning("Cache: Redis GET failed: %s", e)

    # DB fallback
    try:
        from sqlalchemy import select
        from db.src.database import async_session
        from .models_db import DetectionCache

        async with async_session() as session:
            stmt = select(DetectionCache).where(
                DetectionCache.hash == image_hash,
                DetectionCache.model_version == model_version,
                DetectionCache.endpoint == endpoint,
            )
            row = (await session.execute(stmt)).scalar_one_or_none()
            if row is None:
                return None
            # TTL enforcement for DB tier (Redis handles its own)
            age = (datetime.now(timezone.utc) - row.created_at).total_seconds()
            if age > CACHE_TTL_SECONDS:
                return None
            result = json.loads(row.result_json)
            # Warm Redis on DB hit
            if r:
                try:
                    r.setex(
                        _redis_key(image_hash, model_version, endpoint),
                        CACHE_TTL_SECONDS,
                        row.result_json,
                    )
                except Exception:
                    pass
            return result
    except Exception as e:
        logger.warning("Cache: DB GET failed: %s", e)
        return None


async def set_cached(
    image_hash: str,
    model_version: str,
    endpoint: str,
    result: dict[str, Any],
) -> None:
    """Store result in Redis (primary) and DB (durable fallback)."""
    if not CACHE_ENABLED:
        return

    try:
        payload = json.dumps(result, default=str)
    except Exception as e:
        logger.warning("Cache: result not JSON-serializable, skipping store: %s", e)
        return

    # Redis
    r = _try_redis()
    if r:
        try:
            r.setex(_redis_key(image_hash, model_version, endpoint), CACHE_TTL_SECONDS, payload)
        except Exception as e:
            logger.warning("Cache: Redis SET failed: %s", e)

    # DB
    try:
        from sqlalchemy import select
        from sqlalchemy.exc import IntegrityError
        from db.src.database import async_session
        from .models_db import DetectionCache

        async with async_session() as session:
            stmt = select(DetectionCache).where(
                DetectionCache.hash == image_hash,
                DetectionCache.model_version == model_version,
                DetectionCache.endpoint == endpoint,
            )
            row = (await session.execute(stmt)).scalar_one_or_none()
            if row is None:
                row = DetectionCache(
                    hash=image_hash,
                    model_version=model_version,
                    endpoint=endpoint,
                    result_json=payload,
                )
                session.add(row)
            else:
                row.result_json = payload
                row.created_at = datetime.now(timezone.utc)
            try:
                await session.commit()
            except IntegrityError:
                await session.rollback()  # concurrent insert — accept
    except Exception as e:
        logger.warning("Cache: DB SET failed: %s", e)
