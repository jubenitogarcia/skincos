#!/usr/bin/env bash
set -euo pipefail
# Start CRM API (nodemon) + CRM FE (Vite HMR) + whatsapp-gateway (nodemon) together
# Useful for local dev with hot-reload across modules.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CRM_DIR="$ROOT_DIR/comprehensive-crm-so"

CRM_PORT=${CRM_PORT:-5173}
CRM_API_PORT=${CRM_API_PORT:-3100}
GW_INSTANCE=${GW_INSTANCE:-1}

# Start CRM with watch-full (API nodemon + FE)
"$CRM_DIR/scripts/restart_crm.sh" --watch-full --crm-port "$CRM_PORT" --crm-api-port "$CRM_API_PORT" --quick &
CRM_PID=$!

# Start gateway instance with nodemon
"$ROOT_DIR/scripts/dev-gateway-watch.sh" --instance "$GW_INSTANCE" &
GW_PID=$!

sleep 1

echo "[dev-all] Started: CRM_PID=$CRM_PID ; GW_PID=$GW_PID"
echo "[dev-all] FE: http://localhost:$CRM_PORT  |  API: http://localhost:$CRM_API_PORT  |  GW: http://localhost:$((3000 + GW_INSTANCE))"

echo "[dev-all] Tailing a few seconds of latest CRM logs..."
( sleep 2; tail -n 50 "$CRM_DIR/logs/crm_web.out" || true ) &

wait
