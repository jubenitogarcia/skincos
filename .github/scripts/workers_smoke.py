#!/usr/bin/env python3
"""Smoke-check the public API and Inventory Workers after a deployment."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.request
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse


def normalize_base_url(value: str) -> str:
    parsed = urlparse(value.strip())
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path not in ("", "/")
    ):
        raise ValueError("API base URL must be an HTTPS origin without a path, query, fragment, or credentials")
    return f"https://{parsed.netloc}"


def fetch_json(base_url: str, path: str, timeout: int, user_agent: str) -> dict:
    request = urllib.request.Request(f"{base_url}{path}", headers={"User-Agent": user_agent})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8", "strict"))
    except HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        raise RuntimeError(f"{path} returned HTTP {exc.code}: {body[:500]}") from exc
    except (URLError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"{path} did not return a valid JSON response") from exc


def require_worker_health(payload: dict, *, service: str, require_ready: bool = False) -> None:
    if payload.get("ok") is not True:
        raise RuntimeError(f"{service} health ok=false: {payload}")
    if payload.get("service") != service:
        raise RuntimeError(f"{service} health returned unexpected service: {payload}")
    if require_ready and payload.get("ready") is not True:
        raise RuntimeError(f"{service} health ready=false: {payload}")


def check_once(args: argparse.Namespace) -> None:
    api = fetch_json(args.api_base_url, "/health", args.timeout, args.user_agent)
    require_worker_health(api, service="api")

    inventory = fetch_json(args.api_base_url, "/insumos/health", args.timeout, args.user_agent)
    require_worker_health(inventory, service="insumos", require_ready=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run public API and Inventory Worker smoke checks")
    parser.add_argument("--api-base-url", default=os.environ.get("API_BASE_URL", "https://api.skincos.com.br"))
    parser.add_argument("--attempts", type=int, default=5)
    parser.add_argument("--sleep-seconds", type=int, default=6)
    parser.add_argument("--timeout", type=int, default=15)
    parser.add_argument("--user-agent", default="Mozilla/5.0 (compatible; WorkersAfterAutomergeSmoke/1.0)")
    args = parser.parse_args()
    args.api_base_url = normalize_base_url(args.api_base_url)
    return args


def main() -> int:
    args = parse_args()
    for attempt in range(1, max(1, args.attempts) + 1):
        try:
            check_once(args)
            print("API and Inventory Worker smoke check OK")
            return 0
        except Exception as exc:
            print(f"Attempt {attempt} failed: {exc}", file=sys.stderr)
            if attempt >= max(1, args.attempts):
                return 1
            time.sleep(max(0, args.sleep_seconds))
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
