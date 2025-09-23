#!/usr/bin/env bash#!/usr/bin/env bash

set -euo pipefailset -euo pipefail

# Dev helper: run WhatsApp official module with nodemon (hot-reload)# Dev helper: run whatsapp official module (official-module/official-whatsapp.js) with nodemon (hot-reload)



ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

OFFICIAL_DIR="$ROOT_DIR/whatsapp/official-module"OFFICIAL_DIR="$ROOT_DIR/whatsapp/official-module"



INSTANCE=1INSTANCE=1

QUIET=0QUIET=0



usage() {usage() {

  cat <<EOF  cat <<EOF

Usage: $(basename "$0") [--instance N] [--quiet]Usage: $(basename "$0") [--instance N] [--quiet]

  --instance N   Instance number 1..9 (maps to port 3000+N). Default: 1  --instance N   Instance number 1..9 (maps to port 3000+N). Default: 1

  --quiet        Reduce logs from nodemon  --quiet        Reduce logs from nodemon

Examples:Examples:

  $(basename "$0") --instance 1  $(basename "$0") --instance 1

  $(basename "$0") --instance 2 --quiet  $(basename "$0") --instance 2 --quiet

EOFEOF

}}



while [[ $# -gt 0 ]]; dowhile [[ $# -gt 0 ]]; do

  case "$1" in  case "$1" in

    --instance) shift; INSTANCE="${1:-1}" ;;    --instance) shift; INSTANCE="${1:-1}" ;;

    --quiet) QUIET=1 ;;    --quiet) QUIET=1 ;;

    -h|--help) usage; exit 0 ;;    -h|--help) usage; exit 0 ;;

    *) echo "[dev-official] Unknown option: $1" >&2; usage; exit 1 ;;    *) echo "[dev-official] Unknown option: $1" >&2; usage; exit 1 ;;

  esac  esac

  shift || true  shift || true

donedone



if ! [[ "$INSTANCE" =~ ^[1-9]$ ]]; thenif ! [[ "$INSTANCE" =~ ^[1-9]$ ]]; then

  echo "[dev-official] Invalid --instance: $INSTANCE (must be 1..9)" >&2; exit 1  echo "[dev-official] Invalid --instance: $INSTANCE (must be 1..9)" >&2; exit 1

fifi



if [[ ! -d "$OFFICIAL_DIR" ]]; thenif [[ ! -d "$OFFICIAL_DIR" ]]; then

  echo "[dev-official] Official module not found at $OFFICIAL_DIR" >&2  echo "[dev-official] Official module not found at $OFFICIAL_DIR" >&2

  exit 1  exit 1

fifi



PORT=$((3000 + INSTANCE))PORT=$((3000 + INSTANCE))

PID_FILE="$OFFICIAL_DIR/.local_official_${INSTANCE}.pid"PID_FILE="$OFFICIAL_DIR/.local_official_${INSTANCE}.pid"

LOG_FILE="$OFFICIAL_DIR/local_official_${INSTANCE}.out"LOG_FILE="$OFFICIAL_DIR/local_official_${INSTANCE}.out"



# Kill any process bound to the target port to avoid conflicts# Kill any process bound to the target port to avoid conflicts

if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; thenif lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then

  echo "[dev-official] Port :$PORT in use, attempting to kill..."  echo "[dev-official] Port :$PORT in use, attempting to kill..."

  # shellcheck disable=SC2046  # shellcheck disable=SC2046

  kill -9 $(lsof -ti tcp:"$PORT") 2>/dev/null || true  kill -9 $(lsof -ti tcp:"$PORT") 2>/dev/null || true

  sleep 0.2  sleep 0.2

fifi



# Stop previous nodemon (if we created it)# Stop previous nodemon (if we created it)

if [[ -f "$PID_FILE" ]]; thenif [[ -f "$PID_FILE" ]]; then

  OLD_PID=$(cat "$PID_FILE" || true)  OLD_PID=$(cat "$PID_FILE" || true)

  if [[ -n "${OLD_PID:-}" ]] && ps -p "$OLD_PID" >/dev/null 2>&1; then  if [[ -n "${OLD_PID:-}" ]] && ps -p "$OLD_PID" >/dev/null 2>&1; then

    echo "[dev-official] Stopping previous process (pid $OLD_PID)"    echo "[dev-official] Stopping previous process (pid $OLD_PID)"

    kill "$OLD_PID" 2>/dev/null || true    kill "$OLD_PID" 2>/dev/null || true

    sleep 0.2    sleep 0.2

  fi  fi

  rm -f "$PID_FILE"  rm -f "$PID_FILE"

fifi



cd "$OFFICIAL_DIR"cd "$OFFICIAL_DIR"



# Ensure dependencies# Ensure dependencies

if [[ ! -d node_modules ]]; thenif [[ ! -d node_modules ]]; then

  echo "[dev-official] Installing dependencies (official-module)..."  echo "[dev-official] Installing dependencies (official-module)..."

  npm install --no-audit --no-fund >/dev/null 2>&1 || true  npm install --no-audit --no-fund >/dev/null 2>&1 || true

fifi



# Ensure nodemon is available locally# Ensure nodemon is available locally

if ! npx --yes nodemon --version >/dev/null 2>&1; thenif ! npx --yes nodemon --version >/dev/null 2>&1; then

  echo "[dev-official] Installing nodemon locally..."  echo "[dev-official] Installing nodemon locally..."

  npm install -D nodemon --no-audit --no-fund >/dev/null 2>&1 || true  npm install -D nodemon --no-audit --no-fund >/dev/null 2>&1 || true

fifi



NODEMON_FLAGS=(NODEMON_FLAGS=(

  --watch official-whatsapp.js  --watch official-whatsapp.js

  --watch extensions  --watch extensions

  --watch middleware  --watch middleware

  --ext js,json  --ext js,json

))

[[ $QUIET -eq 1 ]] && NODEMON_FLAGS=(--quiet "${NODEMON_FLAGS[@]}")[[ $QUIET -eq 1 ]] && NODEMON_FLAGS=(--quiet "${NODEMON_FLAGS[@]}")



# Try to find a working Chromium/Chrome executable for Puppeteer on macOS/Linuxecho "[dev-official] Starting WhatsApp OFFICIAL module (instance $INSTANCE) on :$PORT with nodemon..."

find_chrome() {

  if [[ -n "${CHROMIUM_EXECUTABLE_PATH:-}" && -x "${CHROMIUM_EXECUTABLE_PATH}" ]]; then echo "$CHROMIUM_EXECUTABLE_PATH"; return 0; fi# Try to find a working Chromium/Chrome executable for Puppeteer on macOS/Linux

  local mac_chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"find_chrome() {

  if [[ -x "$mac_chrome" ]]; then echo "$mac_chrome"; return 0; fi  # Prefer explicit environment variable if already set

  for bin in chromium chromium-browser google-chrome google-chrome-stable chrome; do  if [[ -n "${CHROMIUM_EXECUTABLE_PATH:-}" && -x "${CHROMIUM_EXECUTABLE_PATH}" ]]; then

    if command -v "$bin" >/dev/null 2>&1; then command -v "$bin"; return 0; fi    echo "$CHROMIUM_EXECUTABLE_PATH"; return 0

  done  fi

  return 1  # Common macOS path

}  local mac_chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

  if [[ -x "$mac_chrome" ]]; then echo "$mac_chrome"; return 0; fi

CHROME_BIN=""  # Try common binaries in PATH

if CHROME_BIN=$(find_chrome); then  for bin in chromium chromium-browser google-chrome google-chrome-stable chrome; do

  export CHROMIUM_EXECUTABLE_PATH="$CHROME_BIN"    if command -v "$bin" >/dev/null 2>&1; then

  echo "[dev-official] Using Chromium executable: $CHROME_BIN"      command -v "$bin"; return 0

else    fi

  echo "[dev-official] WARN: Could not auto-detect Chrome/Chromium. Puppeteer may fail to launch."  done

fi  return 1

}

(

  export PORT="$PORT"CHROME_BIN=""

  export WHATSAPP_PORT="$PORT"if CHROME_BIN=$(find_chrome); then

  export NODE_ENV="development"  export CHROMIUM_EXECUTABLE_PATH="$CHROME_BIN"

  export NO_AUTH=true  echo "[dev-official] Using Chromium executable: $CHROME_BIN"

  npx nodemon "${NODEMON_FLAGS[@]}" official-whatsapp.js >"$LOG_FILE" 2>&1 &else

  echo $! > "$PID_FILE"  echo "[dev-official] WARN: Could not auto-detect Chrome/Chromium. Puppeteer may fail to launch."

)fi



sleep 1(

if curl -sf "http://localhost:$PORT/health" >/dev/null 2>&1; then  export PORT="$PORT"

  echo "[dev-official] OK: http://localhost:$PORT"  export WHATSAPP_PORT="$PORT"

else  # These can be customized by env file if needed

  echo "[dev-official] WARN: official module not responding yet on :$PORT"  export NODE_ENV="development"

fi  # Allow the official module to bypass authentication in dev if needed (CSP already relaxed)

  export NO_AUTH=true

echo "[dev-official] PID: $(cat "$PID_FILE" 2>/dev/null || echo "?") | Logs: $LOG_FILE"  npx nodemon "${NODEMON_FLAGS[@]}" official-whatsapp.js >"$LOG_FILE" 2>&1 &

  echo $! > "$PID_FILE"
)

sleep 1
if curl -sf "http://localhost:$PORT/health" >/dev/null 2>&1; then
  echo "[dev-official] OK: http://localhost:$PORT"
else
  echo "[dev-official] WARN: official module not responding yet on :$PORT"
fi

echo "[dev-official] PID: $(cat "$PID_FILE" 2>/dev/null || echo "?") | Logs: $LOG_FILE"
