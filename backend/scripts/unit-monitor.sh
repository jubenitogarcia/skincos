#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
. "$ROOT_DIR/backend/scripts/env.sh"

CRM_PORT="${CRM_PORT:-5173}"
CRM_API_PORT="${CRM_API_PORT:-8099}"

usage() {
  cat <<EOF
Usage: $(basename "$0") <dev|api|fe|diagnostics|start-streaming|tunnel> [options]

Commands:
  dev             Start CRM frontend (Vite) + CRM API (nodemon) for Unit Monitor
  api             Start only CRM API (Node)
  fe              Start only CRM frontend (Vite)
  diagnostics     Curl Unit Monitor diagnostics from CRM API
  start-streaming POST /api/unit-monitor/streaming/start (requires cameras configured)
  tunnel          Run cloudflared tunnel (requires token)

Options:
  --crm-port N        Frontend port (default: $CRM_PORT)
  --crm-api-port N    API port (default: $CRM_API_PORT)

Tunnel (optional):
  Set CLOUDLFARE_TUNNEL_TOKEN or pass --token <TOKEN> to:
    cloudflared tunnel run --token <TOKEN>

Examples:
  $(basename "$0") dev --crm-port 5173 --crm-api-port 8099
  $(basename "$0") api
  $(basename "$0") diagnostics
EOF
}

cmd="${1:-}"
shift || true

tunnel_token="${CLOUDFLARE_TUNNEL_TOKEN:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --crm-port) shift; CRM_PORT="${1:-$CRM_PORT}" ;;
    --crm-api-port) shift; CRM_API_PORT="${1:-$CRM_API_PORT}" ;;
    --token) shift; tunnel_token="${1:-$tunnel_token}" ;;
    -h|--help|help|"") usage; exit 0 ;;
    *) echo "[unit-monitor] Unknown option: $1" >&2; usage; exit 1 ;;
  esac
  shift || true
done

start_api_watch() {
  (cd "$ROOT_DIR/backend/apps/crm-api" && CRM_API_PORT="$CRM_API_PORT" PORT="$CRM_API_PORT" ./scripts/run.sh watch) &
  echo $!
}

start_api() {
  (cd "$ROOT_DIR/backend/apps/crm-api" && CRM_API_PORT="$CRM_API_PORT" PORT="$CRM_API_PORT" ./scripts/run.sh start) &
  echo $!
}

start_fe() {
  (cd "$ROOT_DIR/frontend" && npm -s run dev -- --port "$CRM_PORT") &
  echo $!
}

case "$cmd" in
  dev)
    echo "[unit-monitor] Starting CRM API (watch) on :$CRM_API_PORT"
    api_pid="$(start_api_watch)"
    echo "[unit-monitor] API PID: $api_pid"

    echo "[unit-monitor] Starting CRM frontend (Vite) on :$CRM_PORT"
    fe_pid="$(start_fe)"
    echo "[unit-monitor] FE PID: $fe_pid"

    cleanup() {
      echo "[unit-monitor] Stopping..."
      kill "$fe_pid" >/dev/null 2>&1 || true
      kill "$api_pid" >/dev/null 2>&1 || true
    }
    trap cleanup EXIT INT TERM
    wait
    ;;
  api)
    echo "[unit-monitor] Starting CRM API on :$CRM_API_PORT"
    exec "$ROOT_DIR/backend/apps/crm-api/scripts/run.sh" start --port "$CRM_API_PORT"
    ;;
  fe)
    echo "[unit-monitor] Starting CRM frontend on :$CRM_PORT"
    exec npm -s --prefix "$ROOT_DIR/frontend" run dev -- --port "$CRM_PORT"
    ;;
  diagnostics)
    exec curl -fsS "http://localhost:${CRM_API_PORT}/api/unit-monitor/diagnostics" | head -c 4000
    ;;
  start-streaming)
    exec curl -fsS -X POST "http://localhost:${CRM_API_PORT}/api/unit-monitor/streaming/start" | head -c 4000
    ;;
  tunnel)
    if [[ -z "${tunnel_token:-}" ]]; then
      echo "[unit-monitor] Missing token. Set CLOUDFLARE_TUNNEL_TOKEN or pass --token." >&2
      exit 2
    fi
    exec cloudflared tunnel run --token "$tunnel_token"
    ;;
  -h|--help|help|"")
    usage
    ;;
  *)
    echo "[unit-monitor] Unknown command: $cmd" >&2
    usage
    exit 1
    ;;
esac
