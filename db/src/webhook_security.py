"""Validation for customer-controlled outbound webhook targets."""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from urllib.parse import urlsplit


def _is_public_address(address: str) -> bool:
    ip = ipaddress.ip_address(address)
    # Judge the embedded IPv4 for ::ffff:x mapped addresses, else e.g.
    # ::ffff:127.0.0.1 could slip past IPv6-only checks.
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    # is_global alone lets IPv6 multicast (ff02::1) through, so reject every
    # non-routable category explicitly (loopback, link-local incl.
    # 169.254.169.254, private, unspecified, reserved, multicast).
    return ip.is_global and not (
        ip.is_loopback
        or ip.is_link_local
        or ip.is_private
        or ip.is_unspecified
        or ip.is_reserved
        or ip.is_multicast
    )


def _resolve_host(hostname: str, port: int) -> set[str]:
    return {
        item[4][0]
        for item in socket.getaddrinfo(
            hostname,
            port,
            type=socket.SOCK_STREAM,
            proto=socket.IPPROTO_TCP,
        )
    }


async def validate_webhook_url(url: str) -> str:
    """Return a normalized URL if every resolved target address is public.

    Validation is deliberately repeated immediately before each delivery. HTTP
    redirects remain disabled by the callers, preventing a public endpoint from
    redirecting the request into a private network.
    """
    try:
        parsed = urlsplit(url)
        port = parsed.port
    except ValueError as exc:
        raise ValueError("Invalid webhook URL") from exc

    if parsed.scheme not in {"http", "https"}:
        raise ValueError("Webhook URL must use http or https")
    if not parsed.hostname:
        raise ValueError("Webhook URL must include a hostname")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("Webhook URL must not include credentials")
    if parsed.fragment:
        raise ValueError("Webhook URL must not include a fragment")

    effective_port = port or (443 if parsed.scheme == "https" else 80)
    try:
        addresses = await asyncio.to_thread(_resolve_host, parsed.hostname, effective_port)
    except socket.gaierror as exc:
        raise ValueError("Webhook hostname could not be resolved") from exc

    if not addresses:
        raise ValueError("Webhook hostname did not resolve to an address")
    if any(not _is_public_address(address) for address in addresses):
        raise ValueError("Webhook target must not resolve to a private or reserved address")

    return url
