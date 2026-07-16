#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
. "$ROOT_DIR/backend/scripts/env.sh"

APP_DIR="$ROOT_DIR/crm/api"

usage() {
  cat <<EOF
Usage: $(basename "$0") <start|watch|health> [--port N]

Commands:
  start         Run with node (server.js)
  watch         Run with nodemon (requires deps installed)
  health        Curl /health on the configured port

Env:
  CRM_API_PORT / PORT    Default port (fallback 8099)

Examples:
  $(basename "$0") start --port 8099
  $(basename "$0") watch
  $(basename "$0") health
EOF
}

cmd=${1:-}
shift || true

PORT="${CRM_API_PORT:-${PORT:-8099}}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) shift; PORT="${1:-$PORT}" ;;
    -h|--help|help|"") usage; exit 0 ;;
    *) echo "[crm-api] Unknown option: $1" >&2; usage; exit 1 ;;
  esac
  shift || true
done

cd "$APP_DIR"
export CRM_API_PORT="$PORT"
export PORT="$PORT"

ensure_dependencies() {
  if [[ "${CRM_API_SKIP_DEP_INSTALL:-false}" == "true" ]]; then
    return 0
  fi

  if [[ -d "$APP_DIR/node_modules/express" && -d "$APP_DIR/node_modules/http-proxy-middleware" ]]; then
    return 0
  fi

  echo "[crm-api] Installing production dependencies in $APP_DIR" >&2
  npm install --omit=dev --no-audit --no-fund
}

case "$cmd" in
  start)
    ensure_dependencies
    exec node server.js
    ;;
  watch)
    ensure_dependencies
    if [[ -x "$APP_DIR/node_modules/.bin/nodemon" ]]; then
      exec "$APP_DIR/node_modules/.bin/nodemon" --quiet --watch . --ext js,mjs,cjs,json server.js
    fi
    if command -v pnpm >/dev/null 2>&1; then
      exec pnpm exec nodemon --quiet --watch . --ext js,mjs,cjs,json server.js
    fi
    if command -v corepack >/dev/null 2>&1; then
      exec corepack pnpm exec nodemon --quiet --watch . --ext js,mjs,cjs,json server.js
    fi
    echo "[crm-api] nodemon not available. Install deps (pnpm) or run: $(basename "$0") start" >&2
    exit 2
    ;;
  health)
    if command -v curl >/dev/null 2>&1; then
      exec curl -sf "http://localhost:${PORT}/health"
    fi
    echo "[crm-api] curl not found" >&2
    exit 2
    ;;
  -h|--help|help|"")
    usage
    ;;
  *)
    echo "[crm-api] Unknown command: $cmd" >&2
    usage
    exit 1
    ;;
esac
