#!/usr/bin/env bash
set -euo pipefail
# Dev helper: run whatsapp-gateway bot_com_api.js with nodemon (hot-reload)

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# Prefer centralized path under whatsapp/; fallback to legacy root path
GW_DIR="$ROOT_DIR/whatsapp/gateway"
if [[ ! -d "$GW_DIR" ]]; then
  GW_DIR="$ROOT_DIR/whatsapp-gateway"
fi
STUB_DIR="$ROOT_DIR/whatsapp/backup"

INSTANCE=1
QUIET=0

usage() {
  cat <<EOF
Usage: $(basename "$0") [--instance N] [--quiet]
  --instance N   Instance number 1..9 (maps to port 3000+N). Default: 1
  --quiet        Reduce logs from nodemon
Examples:
  $(basename "$0") --instance 1
  $(basename "$0") --instance 2 --quiet
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --instance) shift; INSTANCE="${1:-1}" ;;
    --quiet) QUIET=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[dev-gateway] Unknown option: $1" >&2; usage; exit 1 ;;
  esac
  shift || true
done

if ! [[ "$INSTANCE" =~ ^[1-9]$ ]]; then
  echo "[dev-gateway] Invalid --instance: $INSTANCE (must be 1..9)" >&2; exit 1
fi

PORT=$((3000 + INSTANCE))
PID_FILE="$GW_DIR/.local_instance_${INSTANCE}.pid"
LOG_FILE="$GW_DIR/local_${INSTANCE}.out"
PROFILE_DIR="$GW_DIR/.chrome_profile_${PORT}"

if [[ ! -d "$GW_DIR" ]]; then
  echo "[dev-gateway] whatsapp-gateway not found at $GW_DIR"
  if [[ -f "$STUB_DIR/bot_com_api.js" ]]; then
    echo "[dev-gateway] Falling back to stub gateway at $STUB_DIR/bot_com_api.js"
    USE_STUB=1
  else
    echo "[dev-gateway] No stub available either. Exiting." >&2; exit 1
  fi
else
  USE_STUB=0
fi

# Kill any process bound to the target port to avoid conflicts
if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[dev-gateway] Port :$PORT in use, attempting to kill..."
  # shellcheck disable=SC2046
  kill -9 $(lsof -ti tcp:"$PORT") 2>/dev/null || true
  sleep 0.2
fi

# Remove stale Chrome profile lock to avoid ProcessSingleton aborts
if [[ -d "$PROFILE_DIR" ]] && [[ -f "$PROFILE_DIR/SingletonLock" ]]; then
  echo "[dev-gateway] Removing stale Chrome SingletonLock at $PROFILE_DIR/SingletonLock"
  rm -f "$PROFILE_DIR/SingletonLock" 2>/dev/null || true
fi

# Stop previous nodemon (if we created it)
if [[ -f "$PID_FILE" ]]; then
  OLD_PID=$(cat "$PID_FILE" || true)
  if [[ -n "${OLD_PID:-}" ]] && ps -p "$OLD_PID" >/dev/null 2>&1; then
    echo "[dev-gateway] Stopping previous process (pid $OLD_PID)"
    kill "$OLD_PID" 2>/dev/null || true
    sleep 0.2
  fi
  rm -f "$PID_FILE"
fi

if [[ $USE_STUB -eq 1 ]]; then
  cd "$STUB_DIR"
else
  cd "$GW_DIR"
fi

# Ensure nodemon is available locally to the gateway module
if ! npx --yes nodemon --version >/dev/null 2>&1; then
  echo "[dev-gateway] Installing nodemon locally..."
  npm install -D nodemon --no-audit --no-fund >/dev/null 2>&1 || true
fi

if [[ $USE_STUB -eq 1 ]]; then
  echo "[dev-gateway] Starting whatsapp-gateway STUB (instance $INSTANCE) on :$PORT with nodemon..."
else
  echo "[dev-gateway] Starting whatsapp-gateway (instance $INSTANCE) on :$PORT with nodemon..."
fi

NODEMON_FLAGS=(
  --watch bot_com_api.js
  --watch storage
  --watch utils
  --watch media_helper.js
  --watch video_optimizer.js
  --ext js,json
)
[[ $QUIET -eq 1 ]] && NODEMON_FLAGS=(--quiet "${NODEMON_FLAGS[@]}")

(
  export PORT="$PORT"
  export ACCOUNT_ID="$PORT"
  # Route logs to local_N.out for consistency with orchestrator
  if [[ $USE_STUB -eq 1 ]]; then
    npx nodemon --quiet bot_com_api.js >"$LOG_FILE" 2>&1 &
  else
    npx nodemon "${NODEMON_FLAGS[@]}" bot_com_api.js >"$LOG_FILE" 2>&1 &
  fi
  echo $! > "$PID_FILE"
)

sleep 1
if curl -sf "http://localhost:$PORT/health" >/dev/null 2>&1; then
  echo "[dev-gateway] OK: http://localhost:$PORT"
else
  echo "[dev-gateway] WARN: gateway not responding yet on :$PORT"
fi

echo "[dev-gateway] PID: $(cat "$PID_FILE" 2>/dev/null || echo "?") | Logs: $LOG_FILE"
