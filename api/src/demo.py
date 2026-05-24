"""Demo endpoint — no auth, IP-based rate limiting.

Behind a reverse proxy (Traefik/nginx/Coolify), ``request.client.host``
is the proxy's IP, so every demo visitor would share one rate-limit
bucket. We resolve the real client IP from ``X-Forwarded-For`` (leftmost
entry is the originating client).

Set ``TRUSTED_PROXIES`` (comma-separated CIDRs or IPs) to restrict which
upstream hops are allowed to set this header. If unset, all upstreams
are trusted — fine for local dev, not for production.
"""

from __future__ import annotations

import ipaddress
import logging
import os
import time
from collections import defaultdict
from threading import Lock

from fastapi import HTTPException, Request

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


_TRUSTED_PROXIES_RAW = os.getenv("TRUSTED_PROXIES", "").strip()
_TRUSTED_PROXIES = _parse_trusted_proxies(_TRUSTED_PROXIES_RAW)
_TRUST_ALL_PROXIES = not _TRUSTED_PROXIES_RAW


def _peer_is_trusted(peer: str | None) -> bool:
    if _TRUST_ALL_PROXIES:
        return True
    if not peer:
        return False
    try:
        addr = ipaddress.ip_address(peer)
    except ValueError:
        return False
    return any(addr in net for net in _TRUSTED_PROXIES)


def resolve_client_ip(request: Request) -> str:
    """Resolve the originating client IP, honouring X-Forwarded-For.

    Only honours the header when the direct peer is a trusted proxy
    (or TRUSTED_PROXIES is unset → dev mode). Falls back to the direct
    peer address. Returns ``"unknown"`` if no address is available.
    """
    peer = request.client.host if request.client else None
    xff = request.headers.get("x-forwarded-for")
    if xff and _peer_is_trusted(peer):
        # Leftmost entry is the original client
        candidate = xff.split(",")[0].strip()
        if candidate:
            return candidate
    return peer or "unknown"


class IPRateLimiter:
    """Simple in-memory IP rate limiter."""

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

    def check_image(self, request: Request):
        ip = resolve_client_ip(request)
        now = time.time()
        with self._lock:
            self._image_counts[ip] = self._cleanup(self._image_counts[ip], now)
            if len(self._image_counts[ip]) >= self.max_images:
                raise HTTPException(
                    429,
                    f"Demo limit: {self.max_images} images per hour. Create a free account for more.",
                )
            self._image_counts[ip].append(now)

    def check_archive(self, request: Request):
        ip = resolve_client_ip(request)
        now = time.time()
        with self._lock:
            self._archive_counts[ip] = self._cleanup(self._archive_counts[ip], now)
            if len(self._archive_counts[ip]) >= self.max_archives:
                raise HTTPException(
                    429,
                    f"Demo limit: {self.max_archives} archive per hour. Create a free account for more.",
                )
            self._archive_counts[ip].append(now)

    def get_remaining(self, request: Request) -> dict:
        ip = resolve_client_ip(request)
        now = time.time()
        with self._lock:
            imgs = self._cleanup(self._image_counts.get(ip, []), now)
            archs = self._cleanup(self._archive_counts.get(ip, []), now)
        return {
            "images_remaining": max(0, self.max_images - len(imgs)),
            "archives_remaining": max(0, self.max_archives - len(archs)),
            "reset_seconds": self.window,
        }

    def get_all_usage(self) -> list[dict]:
        """Get all demo usage (for super admin)."""
        now = time.time()
        result = []
        with self._lock:
            all_ips = set(self._image_counts.keys()) | set(self._archive_counts.keys())
            for ip in all_ips:
                imgs = self._cleanup(self._image_counts.get(ip, []), now)
                archs = self._cleanup(self._archive_counts.get(ip, []), now)
                if imgs or archs:
                    result.append({
                        "ip": ip,
                        "images_used": len(imgs),
                        "archives_used": len(archs),
                        "images_remaining": max(0, self.max_images - len(imgs)),
                        "archives_remaining": max(0, self.max_archives - len(archs)),
                    })
        return result


# Global rate limiter instance
demo_limiter = IPRateLimiter()
