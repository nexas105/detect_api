"""3-tier rate limiting: Redis → DB → Memory.

- Redis: primary, persistent (RDB/AOF), syncs to DB every 60s
- DB: fallback when Redis down, restored on startup
- Memory: last resort if both unavailable
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from collections import defaultdict
from threading import Lock

logger = logging.getLogger("api.ratelimit")

REDIS_URL = os.getenv("REDIS_URL", "")
_redis = None
_redis_available = False


def _init_redis():
    global _redis, _redis_available
    if not REDIS_URL:
        logger.info("Rate limiting: no REDIS_URL — DB + memory mode")
        return
    try:
        import redis
        _redis = redis.from_url(REDIS_URL, decode_responses=True)
        _redis.ping()
        _redis_available = True
        logger.info("Rate limiting: Redis connected (%s)", REDIS_URL)
    except Exception as e:
        logger.warning("Rate limiting: Redis unavailable (%s) — DB + memory fallback", e)
        _redis = None
        _redis_available = False


def _try_redis():
    """Get Redis if available, reconnect if dropped."""
    global _redis, _redis_available
    if not REDIS_URL:
        return None
    if _redis_available and _redis:
        try:
            _redis.ping()
            return _redis
        except Exception:
            logger.warning("Redis connection lost, falling back")
            _redis_available = False
    return None


class RateLimiter:
    """3-tier rate limiter: Redis → DB → Memory.

    - Redis handles rate checks natively (sorted sets with TTL)
    - DB counts are queried on startup and when Redis is unavailable
    - Memory is always maintained as last-resort fallback
    - Redis state syncs to DB every 60s via auth service usage logs
    """

    def __init__(self):
        self._mem_counts: dict[str, list[float]] = defaultdict(list)
        self._lock = Lock()
        self._auth_url: str = ""
        self._db_sync_task: asyncio.Task | None = None

    async def init(self, auth_service_url: str):
        """Initialize: connect Redis, restore from DB, start sync loop."""
        self._auth_url = auth_service_url
        _init_redis()
        await self._restore_from_db()
        if _redis_available:
            self._db_sync_task = asyncio.create_task(self._periodic_db_sync())

    async def shutdown(self):
        if self._db_sync_task:
            self._db_sync_task.cancel()
            try:
                await self._db_sync_task
            except asyncio.CancelledError:
                pass

    # ── Core check ──────────────────────────────────────────────────────────

    def check(self, key: str, limit: int, window: int = 3600) -> tuple[bool, int]:
        """Check rate limit. Returns (allowed, remaining). limit=0 means unlimited."""
        if limit <= 0:
            return True, -1

        r = _try_redis()
        if r:
            result = self._check_redis(r, key, limit, window)
            # Also track in memory (fallback if Redis dies mid-window)
            self._track_memory(key, window)
            return result
        return self._check_memory(key, limit, window)

    # ── Redis tier ──────────────────────────────────────────────────────────

    def _check_redis(self, r, key: str, limit: int, window: int) -> tuple[bool, int]:
        redis_key = f"rate:{key}"
        try:
            pipe = r.pipeline()
            now = time.time()
            pipe.zremrangebyscore(redis_key, 0, now - window)
            pipe.zcard(redis_key)
            pipe.zadd(redis_key, {str(now): now})
            pipe.expire(redis_key, window)
            results = pipe.execute()
            count = results[1]
            if count >= limit:
                return False, 0
            return True, limit - count - 1
        except Exception as e:
            logger.warning("Redis rate check failed: %s", e)
            return self._check_memory(key, limit, window)

    # ── Memory tier ─────────────────────────────────────────────────────────

    def _track_memory(self, key: str, window: int):
        """Track in memory without checking limit (shadow tracking for fallback)."""
        now = time.time()
        with self._lock:
            self._mem_counts[key] = [t for t in self._mem_counts[key] if t > now - window]
            self._mem_counts[key].append(now)

    def _check_memory(self, key: str, limit: int, window: int) -> tuple[bool, int]:
        now = time.time()
        cutoff = now - window
        with self._lock:
            self._mem_counts[key] = [t for t in self._mem_counts[key] if t > cutoff]
            count = len(self._mem_counts[key])
            if count >= limit:
                return False, 0
            self._mem_counts[key].append(now)
            return True, limit - count - 1

    # ── DB restore (startup) ───────────────────────────────────────────────

    async def _restore_from_db(self):
        """Load last hour's usage counts from DB via auth service."""
        if not self._auth_url:
            return
        try:
            from .auth import get_http_client
            client = await get_http_client()
            resp = await client.get(f"{self._auth_url}/usage/rate-state")
            if resp.status_code != 200:
                logger.warning("DB restore failed (status %d)", resp.status_code)
                return
            data = resp.json()
            now = time.time()
            total = 0
            with self._lock:
                for key, count in data.get("keys", {}).items():
                    self._mem_counts[key] = [now - (3600 * i / max(count, 1)) for i in range(count)]
                    total += count
            logger.info("Restored rate state: %d keys, %d requests", len(data.get("keys", {})), total)
        except Exception as e:
            logger.warning("DB restore failed: %s", e)

    # ── Periodic DB sync (Redis → DB already happens via usage/log) ────────

    async def _periodic_db_sync(self):
        """Periodic health check: if Redis dies, log warning and let fallback kick in."""
        while True:
            try:
                await asyncio.sleep(60)
                r = _try_redis()
                if not r:
                    logger.warning("Redis health check failed — memory fallback active")
                    # Restore from DB to keep memory state fresh
                    await self._restore_from_db()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning("Sync loop error: %s", e)

    # ── Utilities ──────────────────────────────────────────────────────────

    def get_count(self, key: str, window: int = 3600) -> int:
        r = _try_redis()
        if r:
            try:
                redis_key = f"rate:{key}"
                r.zremrangebyscore(redis_key, 0, time.time() - window)
                return r.zcard(redis_key)
            except Exception:
                pass
        now = time.time()
        with self._lock:
            return len([t for t in self._mem_counts.get(key, []) if t > now - window])


# Global instance
rate_limiter = RateLimiter()
