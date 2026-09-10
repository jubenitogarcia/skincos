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
  # A native release is an immutable, custody-verified bundle.  Falling back
  # to npm here would turn a restart into an unpinned network mutation and
  # could make a rollback execute different code.  Local development retains
  # the existing install-on-demand convenience.
  if [[ -n "${CRM_NATIVE_RELEASE_ROOT:-}" ]]; then
    mapfile -t native_dependencies < <(
      node -e '
        const fs = require("node:fs");
        const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        for (const dependency of Object.keys(manifest.dependencies || {}).sort()) console.log(dependency);
      ' "$APP_DIR/package.json"
    )
    missing_dependencies=()
    for dependency in "${native_dependencies[@]}"; do
      [[ -d "$APP_DIR/node_modules/$dependency" ]] || missing_dependencies+=("$dependency")
    done
    if [[ ${#missing_dependencies[@]} -eq 0 ]]; then
      return 0
    fi
    echo "[crm-api] Native CRM release is missing locked production dependencies (${missing_dependencies[*]}); refusing npm install" >&2
    exit 78
  fi

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
    # `backend/scripts/env.sh` may load an optional local workspace file.
    # Native custody deliberately wins over every mutable environment layer.
    if [[ -n "${CRM_NATIVE_RELEASE_ROOT:-}" ]]; then
      export PONTO_LEGACY_RUNTIME_MODE='disabled'
    fi
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
