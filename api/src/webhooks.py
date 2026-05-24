"""Outbound webhook dispatcher.

Fetches webhook endpoints for an API key from the auth service, evaluates trigger
conditions, and dispatches HMAC-signed JSON POSTs with retry (immediate, 1m, 5m, 30m;
max 3 attempts).

Known limitation (v1): retries live in-process via asyncio.create_task. If the API
service restarts mid-retry, pending retries are lost. Accept at-least-once + possible
loss; customers should be idempotent. Upgrade path: persistent queue (Redis/DB).
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import time
from typing import Any

from .auth import _spawn_background, get_http_client, get_webhook_http_client
from .config import AUTH_SERVICE_URL

logger = logging.getLogger("api.webhooks")

# Retry delays in seconds — first is immediate, then exponential backoff
RETRY_DELAYS_S = [0, 60, 300, 1800]  # attempt 1 immediate; 2/3/4 after 1m/5m/30m
MAX_ATTEMPTS = len(RETRY_DELAYS_S)  # one attempt per delay entry

# rateme categories ordered low -> high
RATEME_CATEGORIES = ["safe", "mild", "suggestive", "sensual", "erotic", "explicit", "extreme"]


def _meets_rateme_threshold(category: str, threshold: str) -> bool:
    """Return True if `category` is >= `threshold` in the rateme scale."""
    try:
        return RATEME_CATEGORIES.index(category) >= RATEME_CATEGORIES.index(threshold)
    except ValueError:
        return False


def _trigger_matches(endpoint: str, detection: dict, trigger_endpoint: str, trigger_threshold: str) -> bool:
    """Evaluate whether a detection event should fire the given webhook."""
    if trigger_endpoint not in ("any", endpoint):
        return False

    if endpoint == "rateme":
        category = detection.get("rating", {}).get("category", "safe")
        if trigger_threshold in RATEME_CATEGORIES:
            return _meets_rateme_threshold(category, trigger_threshold)
        # treat unknown thresholds as "any_detection" (fire on anything)
        return True

    if endpoint == "classify":
        dets = detection.get("detections", []) or []
        if trigger_threshold == "any_detection" or not trigger_threshold:
            return len(dets) > 0
        # Otherwise treat threshold as a label name
        return any(d.get("label") == trigger_threshold for d in dets)

    return False


async def _fetch_endpoints(api_key: str) -> tuple[str | None, list[dict]]:
    """Fetch configured webhook endpoints for this API key from the auth service."""
    try:
        client = await get_http_client()
        resp = await client.get(f"{AUTH_SERVICE_URL}/webhooks/by-key/{api_key}")
        if resp.status_code != 200:
            return None, []
        data = resp.json()
        return data.get("tenant_id"), data.get("webhooks", [])
    except Exception as e:
        logger.warning("Failed to fetch webhook endpoints: %s", e)
        return None, []


async def _log_delivery(endpoint_id: str, event_type: str, payload_body: str,
                         response_status: int | None, response_body: str | None,
                         attempt: int, succeeded: bool) -> None:
    try:
        client = await get_http_client()
        await client.post(
            f"{AUTH_SERVICE_URL}/webhooks/deliveries",
            json={
                "endpoint_id": endpoint_id,
                "event_type": event_type,
                "payload_json": payload_body,
                "response_status": response_status,
                "response_body": response_body,
                "attempt": attempt,
                "succeeded": succeeded,
            },
        )
    except Exception as e:
        logger.warning("Failed to log webhook delivery: %s", e)


async def _deliver_one(endpoint: dict, event_type: str, payload: dict) -> None:
    """Deliver a single event to a single endpoint, with retry."""
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    secret = endpoint["secret"].encode()
    url = endpoint["url"]
    endpoint_id = endpoint["id"]

    for attempt in range(1, MAX_ATTEMPTS + 1):
        if attempt > 1:
            delay = RETRY_DELAYS_S[min(attempt - 1, len(RETRY_DELAYS_S) - 1)]
            await asyncio.sleep(delay)

        ts = int(time.time())
        sig = hmac.new(secret, body.encode(), hashlib.sha256).hexdigest()
        headers = {
            "Content-Type": "application/json",
            "X-Webhook-Signature": f"sha256={sig}",
            "X-Webhook-Timestamp": str(ts),
            "X-Webhook-Event": event_type,
        }

        response_status: int | None = None
        response_body: str | None = None
        succeeded = False

        try:
            # Use webhook-specific client so we don't leak X-Internal-Token
            # to third-party webhook targets.
            client = await get_webhook_http_client()
            resp = await client.post(url, content=body, headers=headers, timeout=10)
            response_status = resp.status_code
            response_body = resp.text[:2000]
            succeeded = 200 <= resp.status_code < 300
        except Exception as e:
            response_body = f"error: {e}"[:2000]

        await _log_delivery(endpoint_id, event_type, body, response_status, response_body, attempt, succeeded)

        if succeeded:
            return
        # else: loop for another attempt (if any remaining)

    logger.info("Webhook %s failed after %d attempts", endpoint_id, MAX_ATTEMPTS)


def dispatch_event_bg(api_key: str, endpoint: str, event_payload: dict) -> None:
    """Fire-and-forget: evaluate triggers and dispatch matching webhooks.

    `endpoint` is "classify" or "rateme".
    `event_payload` is the full event dict (contains detections/rating, image_id, etc.).
    Never raises — all errors are logged.
    """
    _spawn_background(_run_dispatch(api_key, endpoint, event_payload))


async def _run_dispatch(api_key: str, endpoint: str, event_payload: dict) -> None:
    try:
        tenant_id, hooks = await _fetch_endpoints(api_key)
        if not hooks:
            return
        event_type = f"detection.{endpoint}"
        for hook in hooks:
            if not _trigger_matches(endpoint, event_payload, hook.get("trigger_endpoint", "any"), hook.get("trigger_threshold", "any_detection")):
                continue
            full_payload: dict[str, Any] = {
                "event": event_type,
                "tenant_id": tenant_id,
                "timestamp": int(time.time()),
                "detection": event_payload,
            }
            # Start independent delivery task per endpoint — retries don't block others
            _spawn_background(_deliver_one(hook, event_type, full_payload))
    except Exception as e:
        logger.warning("Webhook dispatch failed: %s", e)
