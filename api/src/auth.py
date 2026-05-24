"""API key validation against auth service + rate limiting."""

from __future__ import annotations

import asyncio
import logging
import os
import time
from threading import Lock

import httpx
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import AUTH_SERVICE_URL
from .ratelimit import rate_limiter

logger = logging.getLogger("api.auth")

_bearer = HTTPBearer()

# ── API-Key validation cache ───────────────────────────────────────────────
# TTL-based in-memory cache to avoid an HTTP round-trip on every request.
# Keys become invalid after at most _KEY_CACHE_TTL seconds upon revocation.

_key_cache: dict[str, tuple[dict, float]] = {}  # raw_key -> (response_data, monotonic_ts)
_key_cache_lock = Lock()
_KEY_CACHE_TTL = 30  # seconds
_KEY_CACHE_MAX = 1000  # max entries


def _get_cached_key(raw_key: str) -> dict | None:
    """Return cached validation result if fresh, else None."""
    with _key_cache_lock:
        entry = _key_cache.get(raw_key)
        if entry is None:
            return None
        data, ts = entry
        if time.monotonic() - ts > _KEY_CACHE_TTL:
            del _key_cache[raw_key]
            return None
        return data


def _set_cached_key(raw_key: str, data: dict) -> None:
    """Cache a validation result."""
    with _key_cache_lock:
        # Evict oldest if at capacity
        if len(_key_cache) >= _KEY_CACHE_MAX and raw_key not in _key_cache:
            oldest_key = min(_key_cache, key=lambda k: _key_cache[k][1])
            del _key_cache[oldest_key]
        _key_cache[raw_key] = (data, time.monotonic())


def invalidate_key_cache(raw_key: str | None = None) -> None:
    """Invalidate a specific key or clear entire cache."""
    with _key_cache_lock:
        if raw_key:
            _key_cache.pop(raw_key, None)
        else:
            _key_cache.clear()


# Shared secret used by the auth service to gate internal endpoints
# (validate-key, usage/log, detections POST, demo/key, webhooks/by-key,
# webhooks/deliveries, usage/rate-state, demo/log). Must match the
# auth service's INTERNAL_AUTH_SECRET.
INTERNAL_AUTH_SECRET = os.getenv("INTERNAL_AUTH_SECRET", "")
if not INTERNAL_AUTH_SECRET:
    raise RuntimeError(
        "INTERNAL_AUTH_SECRET must be set — shared secret between the "
        "API service and the auth service."
    )

# Strong references to in-flight fire-and-forget tasks so the event loop
# doesn't GC them mid-run. Tasks remove themselves via done-callback.
_background_tasks: set[asyncio.Task] = set()


def _spawn_background(coro) -> asyncio.Task:
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task

# ── Shared HTTP client ──────────────────────────────────────────────────────

_http_client: httpx.AsyncClient | None = None
_webhook_http_client: httpx.AsyncClient | None = None


async def get_webhook_http_client() -> httpx.AsyncClient:
    """Separate httpx client for outbound webhook deliveries.

    Does NOT carry the X-Internal-Token header — webhook targets are
    third-party URLs that must not receive our internal shared secret.
    """
    global _webhook_http_client
    if _webhook_http_client is None or _webhook_http_client.is_closed:
        _webhook_http_client = httpx.AsyncClient(timeout=10)
    return _webhook_http_client


async def get_http_client() -> httpx.AsyncClient:
    """Shared httpx client used for all auth-service calls.

    Pre-configured with X-Internal-Token so every auth-service request
    authenticates as the API service. Outbound webhook dispatch reuses
    the same client — extra header is ignored by third-party webhook
    targets but keeps us from needing two pools.
    """
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=10,
            headers={"X-Internal-Token": INTERNAL_AUTH_SECRET},
        )
    return _http_client


async def close_http_client():
    global _http_client, _webhook_http_client
    if _http_client and not _http_client.is_closed:
        await _http_client.aclose()
    if _webhook_http_client and not _webhook_http_client.is_closed:
        await _webhook_http_client.aclose()


# ── Key Info ────────────────────────────────────────────────────────────────


class KeyInfo:
    """Validated API key info from auth service."""
    __slots__ = ("tenant_id", "tenant_name", "key_name", "is_master", "rate_limit", "raw_key")

    def __init__(self, data: dict, raw_key: str):
        self.tenant_id = data["tenant_id"]
        self.tenant_name = data.get("tenant_name")
        self.key_name = data["key_name"]
        self.is_master = data.get("is_master", False)
        self.rate_limit = data.get("rate_limit", 0)
        self.raw_key = raw_key


# ── Validation ──────────────────────────────────────────────────────────────


async def validate_api_key(creds: HTTPAuthorizationCredentials = Depends(_bearer)) -> KeyInfo:
    """Validate API key against auth service + enforce rate limit."""
    raw_key = creds.credentials

    # Check cache first
    cached = _get_cached_key(raw_key)
    if cached is not None:
        logger.debug("Key cache hit for %s…", raw_key[:8])
        key_info = KeyInfo(cached, raw_key)
    else:
        client = await get_http_client()

        try:
            resp = await client.post(
                f"{AUTH_SERVICE_URL}/validate-key",
                headers={"Authorization": f"Bearer {raw_key}"},
            )
        except httpx.HTTPError as e:
            logger.error("Auth service error: %s", e)
            raise HTTPException(503, "Auth service unavailable")

        if resp.status_code == 401:
            raise HTTPException(401, "Invalid or revoked API key")
        if resp.status_code != 200:
            logger.error("Auth service returned %d: %s", resp.status_code, resp.text)
            raise HTTPException(502, "Auth service error")

        data = resp.json()
        _set_cached_key(raw_key, data)
        key_info = KeyInfo(data, raw_key)

    # Enforce rate limit
    allowed, remaining = rate_limiter.check(raw_key, key_info.rate_limit)
    if not allowed:
        raise HTTPException(
            429,
            f"Rate limit exceeded ({key_info.rate_limit} requests/hour). "
            "Upgrade your plan for higher limits.",
        )

    return key_info


# ── Fire-and-forget logging ─────────────────────────────────────────────────


def log_usage_bg(key_info: KeyInfo, endpoint: str, method: str, status_code: int):
    """Fire-and-forget usage logging."""
    _spawn_background(_log_usage(key_info, endpoint, method, status_code))


async def _log_usage(key_info: KeyInfo, endpoint: str, method: str, status_code: int):
    try:
        client = await get_http_client()
        await client.post(
            f"{AUTH_SERVICE_URL}/usage/log",
            json={"api_key": key_info.raw_key, "endpoint": endpoint, "method": method, "status_code": status_code},
        )
    except Exception as e:
        logger.warning("Failed to log usage: %s", e)


def save_detection_bg(
    key_info: KeyInfo, image_id: str, endpoint: str, model_name: str,
    detections: list[dict], original_path: str | None = None, censored_path: str | None = None,
):
    """Fire-and-forget detection result saving."""
    _spawn_background(_save_detection(key_info, image_id, endpoint, model_name, detections, original_path, censored_path))


async def _save_detection(
    key_info: KeyInfo, image_id: str, endpoint: str, model_name: str,
    detections: list[dict], original_path: str | None = None, censored_path: str | None = None,
):
    try:
        client = await get_http_client()
        await client.post(
            f"{AUTH_SERVICE_URL}/detections",
            json={
                "api_key": key_info.raw_key, "image_id": image_id, "endpoint": endpoint,
                "model_name": model_name, "detections": detections,
                "original_path": original_path, "censored_path": censored_path,
            },
        )
    except Exception as e:
        logger.warning("Failed to save detection: %s", e)
