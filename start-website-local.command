#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

if [[ "$(uname -s)" == "Darwin" ]]; then
  exec python3 "$ROOT_DIR/scripts/mac-local-preview.py" start --project-root "$ROOT_DIR" --route "${1:-/}"
fi

export OPEN_BROWSER="${OPEN_BROWSER:-1}"

exec ./scripts/run-local-website.sh "${1:-/}"
