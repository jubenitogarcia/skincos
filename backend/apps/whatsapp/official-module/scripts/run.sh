#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../../.." && pwd)"
. "$ROOT_DIR/backend/scripts/env.sh"

usage() {
  cat <<EOF
Usage: $(basename "$0") <start|watch|health> [--instance N]

Commands:
  start         Run official module (node official-whatsapp.js)
  watch         Run with monorepo watcher (nodemon + VAR_DIR): backend/scripts/dev.sh official --instance N
  health        Curl /health for the instance

Examples:
  $(basename "$0") watch --instance 1
  $(basename "$0") start --instance 1
  $(basename "$0") health --instance 1
EOF
}

cmd=${1:-}
shift || true

INSTANCE=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --instance) shift; INSTANCE="${1:-1}" ;;
    -h|--help|help|"") usage; exit 0 ;;
    *) echo "[official-module] Unknown option: $1" >&2; usage; exit 1 ;;
  esac
  shift || true
done

if ! [[ "$INSTANCE" =~ ^[1-9]$ ]]; then
  echo "[official-module] Invalid --instance: $INSTANCE (must be 1..9)" >&2
  exit 1
fi

OFFICIAL_DIR="$ROOT_DIR/backend/apps/whatsapp/official-module"
PORT=$((3000 + INSTANCE))

case "$cmd" in
  watch)
    exec bash "$ROOT_DIR/backend/scripts/dev.sh" official --instance "$INSTANCE"
    ;;
  start)
    cd "$OFFICIAL_DIR"
    WA_VAR="$VAR_DIR/whatsapp/official/instance-$INSTANCE"
    mkdir -p "$WA_VAR" >/dev/null 2>&1 || true
    export WHATSAPP_CLIENT_ID="${WHATSAPP_CLIENT_ID:-whatsapp-official-$INSTANCE}"
    export WHATSAPP_DATA_PATH="${WHATSAPP_DATA_PATH:-$WA_VAR/auth}"
    export WHATSAPP_USER_DATA_DIR="${WHATSAPP_USER_DATA_DIR:-$WA_VAR/chrome}"
    export WHATSAPP_MASTER_KEY_FILE="${WHATSAPP_MASTER_KEY_FILE:-$WA_VAR/master-key}"
    export PORT="$PORT"
    export WHATSAPP_PORT="$PORT"
    export NODE_ENV="${NODE_ENV:-development}"
    export NO_AUTH=true
    exec node official-whatsapp.js
    ;;
  health)
    if command -v curl >/dev/null 2>&1; then
      exec curl -sf "http://localhost:${PORT}/health"
    fi
    echo "[official-module] curl not found" >&2
    exit 2
    ;;
  -h|--help|help|"")
    usage
    ;;
  *)
    echo "[official-module] Unknown command: $cmd" >&2
    usage
    exit 1
    ;;
esac
