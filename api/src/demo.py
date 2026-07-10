"""Demo endpoint — no auth, IP-based rate limiting.

Behind a reverse proxy (Traefik/nginx/Coolify), ``request.client.host``
is the proxy's IP, so every demo visitor would share one rate-limit
bucket. We resolve the real client IP from ``X-Forwarded-For``.

``X-Forwarded-For`` is client-controlled: the leftmost entries can be
forged by the caller to spoof an IP and dodge the limit. We therefore
read the chain from the *right* (appended by our own proxies), skip
hops that are in ``TRUSTED_PROXIES``, and take the first untrusted
address — that is the genuine client. If ``TRUSTED_PROXIES`` is unset
we do not trust the header at all and use ``request.client.host``.
"""

from __future__ import annotations

import ipaddress
import logging
import time
from collections import defaultdict
from threading import Lock

from fastapi import HTTPException, Request

from . import redis_backend
from .config import TRUSTED_PROXIES as _TRUSTED_PROXIES_RAW

logger = logging.getLogger("api.demo")


def _parse_trusted_proxies(raw: str) -> list[ipaddress._BaseNetwork]:
    nets: list[ipaddress._BaseNetwork] = []
    for item in raw.split(","):
        item = item.strip()
        if not item:
            continue
        try:
            nets.append(ipaddress.ip_network(item, strict=False))
        except ValueError:
            logger.warning("Invalid TRUSTED_PROXIES entry: %s", item)
    return nets


_TRUSTED_PROXIES = _parse_trusted_proxies(_TRUSTED_PROXIES_RAW)


def _ip_is_trusted(ip: str | None) -> bool:
    if not ip:
        return False
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(addr in net for net in _TRUSTED_PROXIES)


def resolve_client_ip(request: Request) -> str:
    """Resolve the originating client IP, honouring X-Forwarded-For safely.

    Walks the XFF chain right→left, skipping trusted proxy hops; the first
    untrusted address is the real client. Only trusts the header when
    TRUSTED_PROXIES is configured and the direct peer is itself trusted —
    otherwise XFF is forgeable, so we fall back to the direct peer address.
    Returns ``"unknown"`` if no address is available.
    """
    peer = request.client.host if request.client else None

    # No trusted proxies configured, or the direct peer isn't one → the
    # XFF header cannot be trusted (it's client-controlled).
    if not _TRUSTED_PROXIES or not _ip_is_trusted(peer):
        return peer or "unknown"

    xff = request.headers.get("x-forwarded-for")
    if xff:
        for hop in reversed([h.strip() for h in xff.split(",")]):
            if hop and not _ip_is_trusted(hop):
                return hop
    # Whole chain trusted (or empty) → nearest real address is the peer.
    return peer or "unknown"


class IPRateLimiter:
    """IP rate limiter — Redis-backed (shared across workers) with in-memory fallback.

    When REDIS_URL is set, counts live in Redis sorted sets keyed
    ``demo:img:{ip}`` / ``demo:arc:{ip}`` so all workers/replicas share one
    bucket. Without Redis (or if it drops) we fall back to process-local memory.
    """

    def __init__(self, max_images: int = 10, max_archives: int = 1, window_seconds: int = 3600):
        self.max_images = max_images
        self.max_archives = max_archives
        self.window = window_seconds
        self._image_counts: dict[str, list[float]] = defaultdict(list)
        self._archive_counts: dict[str, list[float]] = defaultdict(list)
        self._lock = Lock()

    def _cleanup(self, timestamps: list[float], now: float) -> list[float]:
        cutoff = now - self.window
        return [t for t in timestamps if t > cutoff]

    # ── Redis sliding window ─────────────────────────────────────────────────

    async def _redis_used(self, r, rkey: str) -> int:
        """Return current count in the window, pruning expired entries."""
        now = time.time()
        pipe = r.pipeline()
        pipe.zremrangebyscore(rkey, 0, now - self.window)
        pipe.zcard(rkey)
        return (await pipe.execute())[1]

    async def _redis_add(self, r, rkey: str) -> None:
        now = time.time()
        pipe = r.pipeline()
        pipe.zadd(rkey, {str(now): now})
        pipe.expire(rkey, self.window)
        await pipe.execute()

    # ── Checks ───────────────────────────────────────────────────────────────

    async def _check(self, counts: dict, rkey: str, limit: int, unit: str):
        r = redis_backend.get_redis()
        if r:
            try:
                used = await self._redis_used(r, rkey)
                if used >= limit:
                    raise HTTPException(
                        429,
                        f"Demo limit: {limit} {unit} per hour. Create a free account for more.",
                    )
                await self._redis_add(r, rkey)
                return
            except HTTPException:
                raise
            except Exception as e:
                logger.warning("Demo: Redis check failed (%s) — memory fallback", e)
                redis_backend.reset()
        # ponytail: memory fallback is per-process only; on Redis outage the demo
        # limit degrades to per-worker. Acceptable for an unauthenticated demo.
        ip = rkey.split(":", 2)[2]
        now = time.time()
        with self._lock:
            counts[ip] = self._cleanup(counts[ip], now)
            if len(counts[ip]) >= limit:
                raise HTTPException(
                    429,
                    f"Demo limit: {limit} {unit} per hour. Create a free account for more.",
                )
            counts[ip].append(now)

    async def check_image(self, request: Request):
        ip = resolve_client_ip(request)
        await self._check(self._image_counts, f"demo:img:{ip}", self.max_images, "images")

    async def check_archive(self, request: Request):
        ip = resolve_client_ip(request)
        await self._check(self._archive_counts, f"demo:arc:{ip}", self.max_archives, "archive")

    async def get_remaining(self, request: Request) -> dict:
        ip = resolve_client_ip(request)
        r = redis_backend.get_redis()
        if r:
            try:
                imgs = await self._redis_used(r, f"demo:img:{ip}")
                archs = await self._redis_used(r, f"demo:arc:{ip}")
                return {
                    "images_remaining": max(0, self.max_images - imgs),
                    "archives_remaining": max(0, self.max_archives - archs),
                    "reset_seconds": self.window,
                }
            except Exception as e:
                logger.warning("Demo: Redis get_remaining failed (%s) — memory fallback", e)
                redis_backend.reset()
        now = time.time()
        with self._lock:
            imgs = self._cleanup(self._image_counts.get(ip, []), now)
            archs = self._cleanup(self._archive_counts.get(ip, []), now)
        return {
            "images_remaining": max(0, self.max_images - len(imgs)),
            "archives_remaining": max(0, self.max_archives - len(archs)),
            "reset_seconds": self.window,
        }

    async def get_all_usage(self) -> list[dict]:
        """Get all demo usage (for super admin)."""
        r = redis_backend.get_redis()
        if r:
            try:
                return await self._all_usage_redis(r)
            except Exception as e:
                logger.warning("Demo: Redis get_all_usage failed (%s) — memory fallback", e)
                redis_backend.reset()
        now = time.time()
        result = []
        with self._lock:
            all_ips = set(self._image_counts.keys()) | set(self._archive_counts.keys())
            for ip in all_ips:
                imgs = self._cleanup(self._image_counts.get(ip, []), now)
                archs = self._cleanup(self._archive_counts.get(ip, []), now)
                if imgs or archs:
                    result.append(self._usage_row(ip, len(imgs), len(archs)))
        return result

    async def _all_usage_redis(self, r) -> list[dict]:
        by_ip: dict[str, list[int]] = defaultdict(lambda: [0, 0])
        for kind, idx in (("img", 0), ("arc", 1)):
            async for rkey in r.scan_iter(match=f"demo:{kind}:*"):
                ip = rkey.split(":", 2)[2]
                by_ip[ip][idx] = await self._redis_used(r, rkey)
        return [
            self._usage_row(ip, imgs, archs)
            for ip, (imgs, archs) in by_ip.items()
            if imgs or archs
        ]

    def _usage_row(self, ip: str, imgs: int, archs: int) -> dict:
        return {
            "ip": ip,
            "images_used": imgs,
            "archives_used": archs,
            "images_remaining": max(0, self.max_images - imgs),
            "archives_remaining": max(0, self.max_archives - archs),
        }


# Global rate limiter instance
demo_limiter = IPRateLimiter()
