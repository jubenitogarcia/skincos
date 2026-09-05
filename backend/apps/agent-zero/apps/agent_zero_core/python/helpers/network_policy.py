"""Outbound network policy for user-supplied document URLs."""

import ipaddress
import os
import socket
from dataclasses import dataclass
from urllib.parse import urlparse


@dataclass(frozen=True)
class RemoteDocumentTarget:
    """A URL together with the public addresses approved for one request."""

    uri: str
    hostname: str
    port: int
    addresses: tuple[str, ...]


def _normalized_hostname(hostname: str) -> str:
    return hostname.rstrip(".").lower()


def _resolve_public_addresses(hostname: str, port: int) -> tuple[str, ...]:
    try:
        addresses = tuple(
            dict.fromkeys(
                result[4][0]
                for result in socket.getaddrinfo(
                    hostname,
                    port,
                    type=socket.SOCK_STREAM,
                )
            )
        )
    except OSError as exc:
        raise ValueError("Remote document host could not be resolved") from exc

    if not addresses or any(
        not ipaddress.ip_address(address.split("%", 1)[0]).is_global
        for address in addresses
    ):
        raise ValueError("Remote document host resolves to a non-public address")
    return addresses


def resolve_remote_document_target(document_uri: str) -> RemoteDocumentTarget:
    """Validate a URL and capture the public addresses used by its transport.

    The returned address set is intentionally immutable. Callers must pass it
    to :class:`PinnedResolver` instead of handing the original hostname to a
    second DNS lookup, which would re-open a DNS-rebinding window.
    """
    parsed = urlparse(document_uri)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Remote document URL must use http(s) with a hostname")
    if parsed.username or parsed.password:
        raise ValueError("Remote document URL must not contain credentials")

    try:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
    except ValueError as exc:
        raise ValueError("Remote document URL has an invalid port") from exc
    if not 1 <= port <= 65535:
        raise ValueError("Remote document URL has an invalid port")

    hostname = _normalized_hostname(parsed.hostname)
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

    return RemoteDocumentTarget(
        uri=document_uri,
        hostname=hostname,
        port=port,
        addresses=_resolve_public_addresses(hostname, port),
    )


class PinnedResolver:
    """aiohttp resolver that never performs a second DNS lookup."""

    def __init__(self, target: RemoteDocumentTarget):
        self._hostname = target.hostname
        self._port = target.port
        self._addresses = target.addresses

    async def resolve(
        self,
        host: str,
        port: int = 0,
        family: int = socket.AF_UNSPEC,
    ):
        if _normalized_hostname(host) != self._hostname or int(port) != self._port:
            raise OSError("Remote document resolver target changed")

        resolved = []
        for address in self._addresses:
            ip = ipaddress.ip_address(address.split("%", 1)[0])
            address_family = socket.AF_INET if ip.version == 4 else socket.AF_INET6
            if family not in {socket.AF_UNSPEC, address_family}:
                continue
            resolved.append(
                {
                    "hostname": self._hostname,
                    "host": address,
                    "port": self._port,
                    "family": address_family,
                    "proto": socket.IPPROTO_TCP,
                    "flags": socket.AI_NUMERICHOST,
                }
            )
        if not resolved:
            raise OSError("Remote document host has no compatible public address")
        return resolved

    async def close(self):
        return None


def validate_remote_document_url(document_uri: str) -> str:
    """Validate a URL while preserving the public compatibility API."""
    resolve_remote_document_target(document_uri)
    return document_uri
