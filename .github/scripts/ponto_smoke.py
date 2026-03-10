#!/usr/bin/env python3
"""Shared Ponto smoke check for GitHub Actions workflows."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.request
from urllib.error import HTTPError


def fetch_json(base_url: str, path: str, timeout: int, user_agent: str) -> dict:
    url = f"{base_url}{path}"
    headers = {"User-Agent": user_agent}
    cid = os.environ.get("CF_ACCESS_CLIENT_ID", "").strip()
    csec = os.environ.get("CF_ACCESS_CLIENT_SECRET", "").strip()
    if cid and csec:
        headers["CF-Access-Client-Id"] = cid
        headers["CF-Access-Client-Secret"] = csec

    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = resp.read().decode("utf-8", "ignore")
            return json.loads(data)
    except HTTPError as err:
        body = err.read().decode("utf-8", "ignore")
        try:
            data = json.loads(body)
        except Exception as exc:  # pragma: no cover - defensive branch
            raise RuntimeError(f"HTTP {err.code} {path} with non-JSON body") from exc
        data["__http_status"] = err.code
        return data


def require_true(payload: dict, key: str, context: str) -> None:
    if payload.get(key):
        return
    raise RuntimeError(f"{context} {key}=false: {payload}")


def check_once(args: argparse.Namespace) -> str:
    proxy = fetch_json(args.base_url, "/api/ponto/_proxy-status", args.timeout, args.user_agent)
    require_true(proxy, "ok", "proxy-status")
    require_true(proxy, "targetConfigured", "proxy-status")
    require_true(proxy, "adminTokenConfigured", "proxy-status")

    if args.require_proxy_token_configured:
        require_true(proxy, "proxyTokenConfigured", "proxy-status")
    if args.require_actor_key_configured:
        require_true(proxy, "actorKeyConfigured", "proxy-status")

    health = fetch_json(args.base_url, "/api/ponto/health", args.timeout, args.user_agent)
    if (
        args.allow_ponto_disabled
        and health.get("__http_status") == 410
        and health.get("error") == "PONTO_DISABLED"
    ):
        return "SKIP"

    require_true(health, "ok", "health")
    if args.require_crypto_templates:
        require_true(health, "cryptoTemplates", "health")
    return "OK"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Ponto smoke checks")
    parser.add_argument("--base-url", default=os.environ.get("BASE_URL", "").rstrip("/"))
    parser.add_argument("--attempts", type=int, default=5)
    parser.add_argument("--sleep-seconds", type=int, default=6)
    parser.add_argument("--timeout", type=int, default=15)
    parser.add_argument("--user-agent", default="Mozilla/5.0 (compatible; PontoSmoke/1.0)")
    parser.add_argument("--allow-ponto-disabled", action="store_true")
    parser.add_argument("--require-proxy-token-configured", action="store_true")
    parser.add_argument("--require-actor-key-configured", action="store_true")
    parser.add_argument("--no-require-crypto-templates", dest="require_crypto_templates", action="store_false")
    parser.set_defaults(require_crypto_templates=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.base_url:
        print("BASE_URL not set", file=sys.stderr)
        return 2

    attempts = max(1, int(args.attempts))
    for idx in range(1, attempts + 1):
        try:
            result = check_once(args)
            if result == "SKIP":
                print("Ponto disabled in target environment; smoke assertions skipped.")
                return 0
            print("Ponto smoke check OK")
            return 0
        except Exception as exc:
            print(f"Attempt {idx} failed: {exc}")
            if idx >= attempts:
                return 1
            time.sleep(max(0, int(args.sleep_seconds)))

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
