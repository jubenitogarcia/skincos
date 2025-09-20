#!/usr/bin/env bash
set -euo pipefail
# Unified gateway dev entry: delegate to dev-gateway-watch.sh (hot-reload by default)
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEV_WATCH="$ROOT_DIR/scripts/dev-gateway-watch.sh"
if [[ -x "$DEV_WATCH" ]]; then
  exec "$DEV_WATCH" "$@"
fi
echo "[gateway-dev] Missing $DEV_WATCH" >&2
exit 1
