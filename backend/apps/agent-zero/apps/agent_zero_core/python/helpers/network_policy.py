"""Outbound network policy for user-supplied document URLs."""

import ipaddress
import os
import socket
from urllib.parse import urlparse


def validate_remote_document_url(document_uri: str) -> str:
    """Reject local-network targets before any document loader performs I/O.

    Every resolved address must be globally routable. An optional host
    allowlist can further narrow egress for deployments that do not need
    arbitrary public documents.
    """
    parsed = urlparse(document_uri)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Remote document URL must use http(s) with a hostname")
    if parsed.username or parsed.password:
        raise ValueError("Remote document URL must not contain credentials")

    hostname = parsed.hostname.rstrip(".").lower()
    blocked_suffixes = (".localhost", ".local", ".internal", ".intranet")
    if hostname in {"localhost", "localhost.localdomain"} or hostname.endswith(
        blocked_suffixes
    ):
        raise ValueError("Remote document host is not publicly routable")

    allowlist = {
        item.strip().lower().rstrip(".")
        for item in os.getenv("AGZ_DOCUMENT_ALLOWED_HOSTS", "").split(",")
        if item.strip()
    }
    if allowlist and hostname not in allowlist:
        raise ValueError("Remote document host is not in AGZ_DOCUMENT_ALLOWED_HOSTS")

    try:
        addresses = {
            result[4][0]
            for result in socket.getaddrinfo(
                hostname,
                parsed.port or (443 if parsed.scheme == "https" else 80),
                type=socket.SOCK_STREAM,
            )
        }
    except OSError as exc:
        raise ValueError("Remote document host could not be resolved") from exc

    if not addresses or any(
        not ipaddress.ip_address(address).is_global for address in addresses
    ):
        raise ValueError("Remote document host resolves to a non-public address")

    return document_uri
