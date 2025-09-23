#!/usr/bin/env bash
set -euo pipefail
# Unified dev orchestrator:
# - Kills common dev ports/processes (safe, best-effort)
# - Starts CRM API (nodemon) + CRM FE (Vite HMR)
# - Starts WhatsApp module: official (default) or legacy gateway stub fallback

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CRM_DIR="$ROOT_DIR/comprehensive-crm-so"
OFFICIAL_DIR="$ROOT_DIR/whatsapp/official-module"

CRM_PORT=${CRM_PORT:-5173}
CRM_API_PORT=${CRM_API_PORT:-3100}
GW_INSTANCE=${GW_INSTANCE:-1}

# Prefer official module if present unless explicitly disabled
USE_OFFICIAL=${USE_OFFICIAL:-}
if [[ -z "${USE_OFFICIAL}" ]]; then
	if [[ -d "$OFFICIAL_DIR" ]]; then
		USE_OFFICIAL=1
	else
		USE_OFFICIAL=0
	fi
fi

kill_port() {
	local p="$1"
	if lsof -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
		echo "[dev-all] Killing processes on :$p..."
		# shellcheck disable=SC2046
		kill -9 $(lsof -ti tcp:"$p") 2>/dev/null || true
	fi
}

echo "[dev-all] Pre-clean: killing common dev ports (safe best-effort)"
kill_port "$CRM_PORT"
kill_port "$CRM_API_PORT"
# Kill a small range of WA ports (3001-3009)
for p in 3001 3002 3003 3004 3005 3006 3007 3008 3009; do kill_port "$p"; done

# Extra: stop previous CRM dev processes by pattern (best-effort)
pkill -f "$CRM_DIR/src/api/server.js" 2>/dev/null || true
pkill -f "vite --port $CRM_PORT" 2>/dev/null || true

echo "[dev-all] Starting CRM (API+FE) in watch-full mode..."
WA_INSTANCES_FILE="$CRM_DIR/whatsapp_instances.json" NO_AUTH=true \
	"$CRM_DIR/scripts/restart_crm.sh" --watch-full --crm-port "$CRM_PORT" --crm-api-port "$CRM_API_PORT" --quick &
CRM_PID=$!

echo "[dev-all] Starting WhatsApp module (instance $GW_INSTANCE)..."

# Helper: find Chrome/Chromium
find_chrome() {
	if [[ -n "${CHROMIUM_EXECUTABLE_PATH:-}" && -x "${CHROMIUM_EXECUTABLE_PATH}" ]]; then echo "$CHROMIUM_EXECUTABLE_PATH"; return 0; fi
	local mac_chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
	if [[ -x "$mac_chrome" ]]; then echo "$mac_chrome"; return 0; fi
	for bin in chromium chromium-browser google-chrome google-chrome-stable chrome; do
		if command -v "$bin" >/dev/null 2>&1; then command -v "$bin"; return 0; fi
	done
	return 1
}

PORT=$((3000 + GW_INSTANCE))

if [[ "$USE_OFFICIAL" == "1" && -d "$OFFICIAL_DIR" ]]; then
	echo "[dev-all] Using WhatsApp OFFICIAL module on :$PORT"
	(
		cd "$OFFICIAL_DIR"
		# Ensure deps
		if [[ ! -d node_modules ]]; then
			echo "[dev-all] [official] Installing dependencies..."
			npm install --no-audit --no-fund >/dev/null 2>&1 || true
		fi
		# Ensure nodemon
		if ! npx --yes nodemon --version >/dev/null 2>&1; then
			echo "[dev-all] [official] Installing nodemon..."
			npm install -D nodemon --no-audit --no-fund >/dev/null 2>&1 || true
		fi
		# Chromium detection (best-effort)
		if CHROME_BIN=$(find_chrome); then
			export CHROMIUM_EXECUTABLE_PATH="$CHROME_BIN"
			echo "[dev-all] [official] Using Chromium executable: $CHROME_BIN"
		else
			echo "[dev-all] [official] WARN: Could not auto-detect Chrome/Chromium"
		fi
		export PORT="$PORT"
		export WHATSAPP_PORT="$PORT"
		export NODE_ENV="development"
		export NO_AUTH=true
		# Start with nodemon and log to file
		LOG_FILE="$OFFICIAL_DIR/local_official_${GW_INSTANCE}.out"
		npx nodemon --watch official-whatsapp.js --watch extensions --watch middleware --ext js,json official-whatsapp.js >"$LOG_FILE" 2>&1 &
		echo $! > "$OFFICIAL_DIR/.local_official_${GW_INSTANCE}.pid"
	)
	GW_KIND="official"
	# Assign a surrogate GW_PID by reading pid file if available
	if [[ -f "$OFFICIAL_DIR/.local_official_${GW_INSTANCE}.pid" ]]; then GW_PID=$(cat "$OFFICIAL_DIR/.local_official_${GW_INSTANCE}.pid" 2>/dev/null || echo ""); else GW_PID=""; fi
else
	echo "[dev-all] Using WhatsApp STUB fallback on :$PORT"
	STUB_DIR="$ROOT_DIR/whatsapp/backup"
	(
		cd "$STUB_DIR"
		export PORT="$PORT"
		export ACCOUNT_ID="$PORT"
		node bot_com_api.js >"$STUB_DIR/local_${GW_INSTANCE}.out" 2>&1 &
		echo $! > "$STUB_DIR/.local_instance_${GW_INSTANCE}.pid"
	)
	GW_KIND="gateway"
	if [[ -f "$ROOT_DIR/whatsapp/backup/.local_instance_${GW_INSTANCE}.pid" ]]; then GW_PID=$(cat "$ROOT_DIR/whatsapp/backup/.local_instance_${GW_INSTANCE}.pid" 2>/dev/null || echo ""); else GW_PID=""; fi
fi

sleep 1

echo "[dev-all] Started: CRM_PID=$CRM_PID ; WA_${GW_KIND}_PID=$GW_PID"
echo "[dev-all] FE: http://localhost:$CRM_PORT  |  API: http://localhost:$CRM_API_PORT  |  WA(${GW_KIND}): http://localhost:$((3000 + GW_INSTANCE))"

echo "[dev-all] Tailing a few seconds of latest CRM logs..."
( sleep 2; tail -n 50 "$CRM_DIR/logs/crm_web.out" || true ) &

wait
