"""Trusted endpoint construction for the appointment synchronization client."""

from __future__ import annotations

import os
import re
from urllib.parse import urlsplit

CANONICAL_AGENDA_SYNC_HOST = "espacofacial.com"
AGENDA_SYNC_PATH = "/api/agenda/sync"
_HOSTNAME = re.compile(
    r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}"
)


class AgendaSyncEndpointError(ValueError):
    """Raised when the private sync endpoint violates the outbound policy."""


def _normalize_allowed_host(value: str) -> str:
    host = value.strip().lower().rstrip(".")
    if not host or not _HOSTNAME.fullmatch(host):
        raise AgendaSyncEndpointError("invalid allowed host")
    return host


def allowed_agenda_sync_hosts(raw: str | None = None) -> frozenset[str]:
    """Return the production host plus explicitly configured staging hosts.

    The setting intentionally accepts hostnames only. Schemes, paths, ports and
    wildcards would make this boundary less precise and are rejected.
    """

    hosts = {CANONICAL_AGENDA_SYNC_HOST}
    configured = os.getenv("EF_AGENDA_SYNC_ALLOWED_HOSTS", "") if raw is None else raw
    for item in configured.replace(";", ",").split(","):
        if item.strip():
            hosts.add(_normalize_allowed_host(item))
    return frozenset(hosts)


def normalize_agenda_sync_endpoint(endpoint: str, *, allowed_hosts: str | None = None) -> str:
    """Validate and reconstruct the only endpoint allowed to receive agenda data."""

    raw = (endpoint or "").strip()
    if not raw:
        raise AgendaSyncEndpointError("missing endpoint")

    try:
        parsed = urlsplit(raw)
        port = parsed.port
    except ValueError as exc:
        raise AgendaSyncEndpointError("invalid endpoint") from exc

    if parsed.scheme.lower() != "https":
        raise AgendaSyncEndpointError("https is required")
    if parsed.username is not None or parsed.password is not None:
        raise AgendaSyncEndpointError("endpoint credentials are not allowed")
    if port not in {None, 443}:
        raise AgendaSyncEndpointError("non-standard port is not allowed")
    if parsed.query or parsed.fragment:
        raise AgendaSyncEndpointError("query and fragment are not allowed")
    if parsed.path != AGENDA_SYNC_PATH:
        raise AgendaSyncEndpointError("invalid endpoint path")

    host = (parsed.hostname or "").lower().rstrip(".")
    if host not in allowed_agenda_sync_hosts(allowed_hosts):
        raise AgendaSyncEndpointError("endpoint host is not allowed")

    # Reconstruct from validated components so the network client never consumes
    # the original environment string.
    return f"https://{host}{AGENDA_SYNC_PATH}"
