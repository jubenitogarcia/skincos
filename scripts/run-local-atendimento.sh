#!/bin/zsh
set -euo pipefail

ROOT_DIR="/Users/jubenitogarcia/Automation/skincos"
EVOLUTION_ENV="/Users/jubenitogarcia/Automation/n8n/evolution-api/.env"
CRM_API_PORT="${CRM_API_PORT:-8099}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

free_port() {
  local port="$1"
  local pids=""
  pids="$(/usr/sbin/lsof -ti tcp:"$port" 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "[local-atendimento] Stopping process on port $port (pid: $pids)"
    /bin/kill -9 $pids 2>/dev/null || true
  fi
}

stop_launchd_crm_api() {
  if /bin/launchctl list | /usr/bin/grep -q "com.skincos.crm-api"; then
    echo "[local-atendimento] Stopping launchd CRM API (com.skincos.crm-api)"
    /bin/launchctl stop com.skincos.crm-api 2>/dev/null || true
    /bin/launchctl bootout "gui/$(/usr/bin/id -u)/com.skincos.crm-api" 2>/dev/null || true
  fi
}

if [[ ! -f "$EVOLUTION_ENV" ]]; then
  echo "[local-atendimento] Missing Evolution env at $EVOLUTION_ENV" >&2
  exit 1
fi

EVOLUTION_API_KEY="$(/usr/bin/grep -E '^AUTHENTICATION_API_KEY=' "$EVOLUTION_ENV" | head -n1 | cut -d= -f2- | tr -d '\r')"
if [[ -z "${EVOLUTION_API_KEY}" ]]; then
  echo "[local-atendimento] Missing AUTHENTICATION_API_KEY in $EVOLUTION_ENV" >&2
  exit 1
fi

cleanup() {
  if [[ -n "${CRM_API_PID:-}" ]]; then
    kill "$CRM_API_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "[local-atendimento] Starting CRM API on :$CRM_API_PORT (Evolution provider)"
stop_launchd_crm_api
free_port "$CRM_API_PORT"
free_port "$FRONTEND_PORT"
(
  cd "$ROOT_DIR"
  export WA_ORCHESTRATOR_PROVIDER="evolution"
  export EVOLUTION_API_URL="http://localhost:8080"
  export EVOLUTION_API_KEY="$EVOLUTION_API_KEY"
  export CRM_PUBLIC_URL="http://localhost:$FRONTEND_PORT"
  export CRM_API_PORT
  export PORT="$CRM_API_PORT"
  export NO_AUTH="true"
  export CRM_BASIC_AUTH=""
  export CRM_LOCAL_NO_AUTH="true"
  export WA_DEBUG_QR="true"
  export NODE_ENV="development"
  export CRM_LOG_LEVEL="warn"
  export INSUMOS_API_TARGET="${INSUMOS_API_TARGET:-https://api.skincos.com.br}"
  node backend/apps/crm-api/server.js
) &
CRM_API_PID=$!

echo "[local-atendimento] Starting Frontend on :$FRONTEND_PORT"
cd "$ROOT_DIR/frontend"
npm run dev -- --host 0.0.0.0 --port "$FRONTEND_PORT"
