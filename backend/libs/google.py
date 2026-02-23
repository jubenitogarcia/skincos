from __future__ import annotations

"""
Google API helpers (Drive/Sheets/Auth).

This module replaces the old nested path `libs.integrations.google.auth`.
"""

from typing import Any, Mapping, Sequence

DEFAULT_DRIVE_SCOPES: Sequence[str] = ("https://www.googleapis.com/auth/drive",)
DEFAULT_SHEETS_READONLY_SCOPES: Sequence[str] = (
    "https://www.googleapis.com/auth/spreadsheets.readonly",
)


def credentials_from_service_account_info(
    service_account_info: Mapping[str, Any],
    scopes: Sequence[str],
):
    from google.oauth2 import service_account

    if not service_account_info:
        raise ValueError("service_account_info ausente")
    normalized = dict(service_account_info)
    private_key = normalized.get("private_key")
    if isinstance(private_key, str):
        if "\\n" in private_key:
            private_key = private_key.replace("\\n", "\n")
        if private_key and not private_key.endswith("\n"):
            private_key += "\n"
        normalized["private_key"] = private_key

    return service_account.Credentials.from_service_account_info(
        normalized, scopes=list(scopes)
    )


def build_service(
    api: str, version: str, credentials, *, cache_discovery: bool = False
):
    from googleapiclient.discovery import build

    return build(api, version, credentials=credentials, cache_discovery=cache_discovery)


def build_drive_service(
    service_account_info: Mapping[str, Any],
    *,
    scopes: Sequence[str] = DEFAULT_DRIVE_SCOPES,
    cache_discovery: bool = False,
):
    credentials = credentials_from_service_account_info(
        service_account_info, scopes=scopes
    )
    return build_service("drive", "v3", credentials, cache_discovery=cache_discovery)


def build_sheets_service(
    service_account_info: Mapping[str, Any],
    *,
    scopes: Sequence[str] = DEFAULT_SHEETS_READONLY_SCOPES,
    cache_discovery: bool = False,
):
    credentials = credentials_from_service_account_info(
        service_account_info, scopes=scopes
    )
    return build_service("sheets", "v4", credentials, cache_discovery=cache_discovery)


__all__ = [
    "DEFAULT_DRIVE_SCOPES",
    "DEFAULT_SHEETS_READONLY_SCOPES",
    "credentials_from_service_account_info",
    "build_service",
    "build_drive_service",
    "build_sheets_service",
]
