#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-}"
shift || true

if [[ -z "$TARGET" || "$TARGET" == */* || "$TARGET" != *.py ]]; then
  echo "Usage: $0 script.py [arguments...]" >&2
  exit 2
fi
if [[ ! -x "$ROOT_DIR/.venv/bin/python" ]]; then
  echo "Scraper venv is missing. Run EF App Setup first." >&2
  exit 1
fi
if [[ ! -f "$ROOT_DIR/$TARGET" ]]; then
  echo "Python task '$TARGET' is not available in the EF integration." >&2
  exit 1
fi

cd "$ROOT_DIR"
exec ./.venv/bin/python "$TARGET" "$@"
