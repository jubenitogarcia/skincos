#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
. "$ROOT_DIR/backend/scripts/env.sh"
CRM_API_DIR="$ROOT_DIR/modules/crm/api"

CRM_PORT="${CRM_PORT:-5173}"
CRM_API_PORT="${CRM_API_PORT:-8099}"

um_curl_headers() {
  UM_CURL_HEADERS=()
  local token="${CRM_UNIT_MONITOR_PROXY_TOKEN:-}"

  # Actor headers are required in gateway mode (requests must come from the CRM proxy).
  # For local gateway scripts, we sign using the same shared secret (proxy token).
  local actor_json='{"id":"gateway-script","name":"Unit Monitor Script","email":"gateway@local"}'
  local ts
  ts="$(python3 - <<'PY' 2>/dev/null || true
import time
print(int(time.time() * 1000))
PY
)"
  if [[ -z "${ts:-}" ]]; then ts="$(date +%s)000"; fi

  local actor_b64
  actor_b64="$(ACTOR_JSON="$actor_json" python3 - <<'PY' 2>/dev/null || true
import base64, os
raw=os.environ.get("ACTOR_JSON","")
print(base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii").rstrip("="))
PY
)"
  if [[ -z "${actor_b64:-}" ]]; then
    actor_b64="$(echo -n "$actor_json" | openssl base64 -A | tr '+/' '-_' | tr -d '=')"
  fi

  UM_CURL_HEADERS+=(-H "x-skincos-actor: $actor_b64" -H "x-skincos-actor-ts: $ts")

  if [[ -n "${token:-}" ]]; then
    local sig
    sig="$(TOKEN="$token" TS="$ts" ACTOR_B64="$actor_b64" python3 - <<'PY' 2>/dev/null || true
import base64, hashlib, hmac, os
token=os.environ.get("TOKEN","")
ts=os.environ.get("TS","")
actor=os.environ.get("ACTOR_B64","")
msg=(ts+"."+actor).encode("utf-8")
digest=hmac.new(token.encode("utf-8"), msg, hashlib.sha256).digest()
print(base64.urlsafe_b64encode(digest).decode("ascii").rstrip("="))
PY
)"
    if [[ -z "${sig:-}" ]]; then
      sig="$(printf '%s' "${ts}.${actor_b64}" | openssl dgst -sha256 -hmac "$token" -binary | openssl base64 -A | tr '+/' '-_' | tr -d '=')"
    fi
    UM_CURL_HEADERS+=(-H "x-unit-monitor-proxy-token: $token" -H "x-skincos-actor-sig: $sig")
  fi
}

usage() {
  cat <<EOF
Usage: $(basename "$0") <dev|api|fe|diagnostics|start-streaming|tunnel|gateway|check> [options]

Commands:
  dev             Start CRM frontend (Vite) + CRM API (nodemon) for Unit Monitor
  api             Start only CRM API (Node)
  fe              Start only CRM frontend (Vite)
  diagnostics     Curl Unit Monitor diagnostics from CRM API
  start-streaming POST /api/unit-monitor/streaming/start (requires cameras configured)
  tunnel          Run cloudflared tunnel (requires token)
  gateway         Start API + streaming + tunnel (edge gateway)
  check           Check gateway prerequisites (binaries)

Options:
  --crm-port N        Frontend port (default: $CRM_PORT)
  --crm-api-port N    API port (default: $CRM_API_PORT)

Tunnel (optional):
  Set CLOUDFLARE_TUNNEL_TOKEN or pass --token <TOKEN> to:
    cloudflared tunnel run --token <TOKEN>

Examples:
  $(basename "$0") dev --crm-port 5173 --crm-api-port 8099
  $(basename "$0") api
  $(basename "$0") diagnostics
  $(basename "$0") check
  CLOUDFLARE_TUNNEL_TOKEN=... $(basename "$0") gateway --crm-api-port 8099
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
  (cd "$CRM_API_DIR" && CRM_API_PORT="$CRM_API_PORT" PORT="$CRM_API_PORT" ./scripts/run.sh watch) &
  echo $!
}

start_api() {
  (cd "$CRM_API_DIR" && CRM_API_PORT="$CRM_API_PORT" PORT="$CRM_API_PORT" SKINCOS_GATEWAY=1 ./scripts/run.sh start) &
  echo $!
}

start_fe() {
  (cd "$ROOT_DIR/modules/crm/web" && npm -s run dev -- --port "$CRM_PORT") &
  echo $!
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[unit-monitor] Missing dependency: $cmd" >&2
    return 1
  fi
  return 0
}

wait_for_api() {
  local port="$1"
  local tries="${2:-40}"
  local delay_ms="${3:-250}"
  for ((i=1; i<=tries; i++)); do
    if curl -fsS "http://localhost:${port}/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep "0.${delay_ms}"
  done
  return 1
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
    exec "$CRM_API_DIR/scripts/run.sh" start --port "$CRM_API_PORT"
    ;;
  fe)
    echo "[unit-monitor] Starting CRM frontend on :$CRM_PORT"
    exec npm -s --prefix "$ROOT_DIR/modules/crm/web" run dev -- --port "$CRM_PORT"
    ;;
  diagnostics)
    um_curl_headers
    exec curl -fsS "${UM_CURL_HEADERS[@]}" "http://localhost:${CRM_API_PORT}/api/unit-monitor/diagnostics" | head -c 4000
    ;;
  start-streaming)
    um_curl_headers
    exec curl -fsS -X POST "${UM_CURL_HEADERS[@]}" "http://localhost:${CRM_API_PORT}/api/unit-monitor/streaming/start" | head -c 4000
    ;;
  tunnel)
    if [[ -z "${tunnel_token:-}" ]]; then
      echo "[unit-monitor] Missing token. Set CLOUDFLARE_TUNNEL_TOKEN or pass --token." >&2
      exit 2
    fi
    exec cloudflared tunnel run --token "$tunnel_token"
    ;;
  check)
    missing=0
    require_cmd node || missing=1
    require_cmd curl || missing=1
    require_cmd ffmpeg || missing=1
    require_cmd ffprobe || missing=1
    require_cmd mediamtx || missing=1
    require_cmd cloudflared || missing=1
    if [[ "$missing" -ne 0 ]]; then
      echo "[unit-monitor] One or more dependencies are missing." >&2
      exit 2
    fi
    echo "[unit-monitor] OK: node curl ffmpeg ffprobe mediamtx cloudflared"
    ;;
  gateway)
    if [[ -z "${tunnel_token:-}" ]]; then
      echo "[unit-monitor] Missing token. Set CLOUDFLARE_TUNNEL_TOKEN or pass --token." >&2
      exit 2
    fi

    echo "[unit-monitor] Checking dependencies..."
    "$0" check >/dev/null

    echo "[unit-monitor] Starting CRM API on :$CRM_API_PORT"
    api_pid="$(start_api)"
    echo "[unit-monitor] API PID: $api_pid"

    cleanup() {
      echo "[unit-monitor] Stopping..."
      um_curl_headers
      curl -fsS -X POST "${UM_CURL_HEADERS[@]}" "http://localhost:${CRM_API_PORT}/api/unit-monitor/streaming/stop" >/dev/null 2>&1 || true
      kill "$api_pid" >/dev/null 2>&1 || true
    }
    trap cleanup EXIT INT TERM

    echo "[unit-monitor] Waiting for API health..."
    if ! wait_for_api "$CRM_API_PORT" 60 250; then
      echo "[unit-monitor] API did not become healthy on :$CRM_API_PORT" >&2
      exit 2
    fi

    echo "[unit-monitor] Starting streaming gateway (MediaMTX)..."
    um_curl_headers
    curl -fsS -X POST "${UM_CURL_HEADERS[@]}" "http://localhost:${CRM_API_PORT}/api/unit-monitor/streaming/start" >/dev/null 2>&1 || {
      echo "[unit-monitor] WARN: failed to start streaming. You can retry in the CRM UI." >&2
    }

    echo "[unit-monitor] Starting Cloudflare Tunnel..."
    echo "[unit-monitor] Tip: point UNIT_MONITOR_API_TARGET to your tunnel public URL (e.g. https://unit-monitor-gw.seudominio.com)."
    cloudflared tunnel run --token "$tunnel_token"
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
