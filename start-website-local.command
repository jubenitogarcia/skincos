#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

export OPEN_BROWSER="${OPEN_BROWSER:-1}"

if [[ "$(uname -s)" == "Darwin" ]]; then
  set +e
  preview_output="$(python3 "$ROOT_DIR/scripts/mac-local-preview.py" start --project-root "$ROOT_DIR" --route "${1:-/}")"
  preview_status=$?
  set -e
  if [[ "$preview_status" -ne 0 ]]; then
    printf '%s\n' "$preview_output" >&2
    exit "$preview_status"
  fi
  printf '%s\n' "$preview_output"
  if [[ "$OPEN_BROWSER" != "0" ]]; then
    set +e
    preview_url="$(printf '%s\n' "$preview_output" | python3 -c '
import json
import sys
from urllib.parse import urlsplit

try:
    value = json.load(sys.stdin)
    url = value.get("url") if isinstance(value, dict) else None
    if not isinstance(url, str):
        raise ValueError("invalid local preview URL")
    parsed = urlsplit(url)
    if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or
            parsed.username or parsed.password or parsed.query or parsed.fragment or not parsed.path.startswith("/") or
            parsed.port is None or not 1 <= parsed.port <= 65535 or any(ord(character) < 32 for character in url)):
        raise ValueError("invalid local preview URL")
except (TypeError, ValueError, json.JSONDecodeError):
    raise SystemExit(2)
print(url)
')"
    preview_url_status=$?
    set -e
    if [[ "$preview_url_status" -ne 0 ]]; then
      echo "The local preview runner did not return a valid loopback URL." >&2
      exit "$preview_url_status"
    fi
    open "$preview_url"
  fi
  exit 0
fi

exec ./scripts/run-local-website.sh "${1:-/}"
