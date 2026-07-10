"""Shared async Redis client — one connection pool for cache, ratelimit, demo.

redis>=4.2 ships ``redis.asyncio`` (we pin redis>=5.0), so no new dependency.

Lazy singleton. No ``ping()`` in the hot path — health is proven by use.
When an operation raises, the caller invokes ``reset()`` and the next
``get_redis()`` reconnects. Periodic health checks live in the callers.
"""

from __future__ import annotations

import logging
import os

logger = logging.getLogger("api.redis")

REDIS_URL = os.getenv("REDIS_URL", "")
_client = None


def get_redis():
    """Return the shared async Redis client, or None if REDIS_URL is unset.

    Lazy singleton over one connection pool. Does not ping — call ``reset()``
    after an operation fails so the next call reconnects.
    """
    global _client
    if not REDIS_URL:
        return None
    if _client is None:
        from redis.asyncio import from_url

        _client = from_url(REDIS_URL, decode_responses=True)
        logger.info("Redis: connected (%s)", REDIS_URL)
    return _client


def reset() -> None:
    """Drop the cached client so the next ``get_redis()`` reconnects."""
    global _client
    _client = None
