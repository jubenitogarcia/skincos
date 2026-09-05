import asyncio
import os
import sys
from pathlib import Path
from unittest.mock import patch


CORE_ROOT = Path(__file__).resolve().parents[1] / "apps" / "agent_zero_core"
sys.path.insert(0, str(CORE_ROOT))

from python.helpers.network_policy import (
    PinnedResolver,
    resolve_remote_document_target,
    validate_remote_document_url,
)


def _dns_result(address: str):
    return [(None, None, None, None, (address, 0))]


def test_remote_document_policy_rejects_private_and_metadata_addresses():
    for address in ("127.0.0.1", "10.0.0.8", "169.254.169.254", "::1"):
        with patch("python.helpers.network_policy.socket.getaddrinfo", return_value=_dns_result(address)):
            try:
                validate_remote_document_url("https://public.example/document")
            except ValueError as exc:
                assert "non-public" in str(exc)
            else:
                raise AssertionError(f"address {address} was not rejected")


def test_remote_document_policy_accepts_global_host_and_enforces_allowlist():
    with patch(
        "python.helpers.network_policy.socket.getaddrinfo",
        return_value=_dns_result("93.184.216.34"),
    ), patch.dict(os.environ, {"AGZ_DOCUMENT_ALLOWED_HOSTS": ""}):
        assert validate_remote_document_url("https://public.example/document")

        with patch.dict(os.environ, {"AGZ_DOCUMENT_ALLOWED_HOSTS": "allowed.example"}):
            try:
                validate_remote_document_url("https://public.example/document")
            except ValueError as exc:
                assert "AGZ_DOCUMENT_ALLOWED_HOSTS" in str(exc)
            else:
                raise AssertionError("host outside the allowlist was accepted")


def test_remote_document_policy_rejects_credentials_and_local_names():
    for url in (
        "https://user:pass@public.example/document",
        "https://localhost/document",
        "https://service.internal/document",
    ):
        try:
            validate_remote_document_url(url)
        except ValueError:
            pass
        else:
            raise AssertionError(f"unsafe URL was accepted: {url}")


def test_pinned_resolver_does_not_re_resolve_after_public_preflight():
    """A DNS answer cannot change between validation and the socket connect."""
    with patch(
        "python.helpers.network_policy.socket.getaddrinfo",
        side_effect=[_dns_result("93.184.216.34"), _dns_result("10.0.0.8")],
    ) as getaddrinfo:
        target = resolve_remote_document_target("https://public.example/document")
        resolved = asyncio.run(PinnedResolver(target).resolve("public.example", 443))

    assert resolved[0]["host"] == "93.184.216.34"
    assert getaddrinfo.call_count == 1


def test_pinned_resolver_rejects_host_or_port_changes():
    with patch(
        "python.helpers.network_policy.socket.getaddrinfo",
        return_value=_dns_result("93.184.216.34"),
    ):
        resolver = PinnedResolver(
            resolve_remote_document_target("https://public.example/document")
        )

    for host, port in (("attacker.example", 443), ("public.example", 8443)):
        try:
            asyncio.run(resolver.resolve(host, port))
        except OSError as exc:
            assert "target changed" in str(exc)
        else:
            raise AssertionError("resolver accepted a changed destination")
