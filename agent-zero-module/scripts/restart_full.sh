#!/usr/bin/env bash
set -euo pipefail

# Restart Agent Zero (embedded) + WhatsApp Gateway + CRM (API + Frontend)
# Usage: ./scripts/restart_full.sh [--no-clean] [--no-gateway] [--no-crm] [--crm-port PORT] [--crm-api-port PORT]

CLEAN_PROFILE=1
START_GATEWAY=1
START_CRM=1
CRM_PORT=${CRM_PORT:-5173}
CRM_API_PORT=${CRM_API_PORT:-3100}
for a in "$@"; do
  case "$a" in
    --no-clean) CLEAN_PROFILE=0 ;;
    --no-gateway) START_GATEWAY=0 ;;
    --no-crm) START_CRM=0 ;;
    --crm-port)
      shift; CRM_PORT="$1" ;;
    --crm-api-port)
      shift; CRM_API_PORT="$1" ;;
  esac
  shift || true
done

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GATEWAY_DIR="$ROOT_DIR/whatsapp-gateway"
LOG_DIR="$ROOT_DIR"
CRM_DIR="$ROOT_DIR/comprehensive-crm-so"
CRM_LOCAL_SCRIPT="$CRM_DIR/scripts/restart_crm.sh"
CRM_LOG_DIR="$CRM_DIR/logs"
mkdir -p "$CRM_LOG_DIR"

printf "[restart] Stopping old processes...\n"
pkill -f run_ui.py 2>/dev/null || true
pkill -f az_daemon.py 2>/dev/null || true
pkill -f webhook_server.py 2>/dev/null || true
pkill -f message_worker 2>/dev/null || true
pkill -f bot_com_api.js 2>/dev/null || true
# Kill generic node processes last (after specific) to avoid over‑killing unrelated dev tools
pkill -f "src/api/server.js" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
pkill -f node 2>/dev/null || true

if [[ $CLEAN_PROFILE -eq 1 ]]; then
  printf "[restart] Cleaning Chrome temporary profiles...\n"
  rm -rf /tmp/chrome-user-data /private/tmp/chrome-user-data || true
fi

printf "[restart] Activating virtualenv (if exists)...\n"
if [[ -f "$ROOT_DIR/.venv/bin/activate" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.venv/bin/activate"
fi

# Guard: evitar arquivo queue.py local que quebra urllib3 (shadow da stdlib 'queue')
if [[ -f "$ROOT_DIR/queue.py" ]]; then
  TS="$(date +%s)"
  echo "[restart][guard] Encontrado $ROOT_DIR/queue.py (shadow da stdlib). Movendo para queue_shadowed.$TS.disabled"
  mv "$ROOT_DIR/queue.py" "$ROOT_DIR/queue_shadowed.$TS.disabled" || echo "[restart][guard] Falha ao mover, remova manualmente."
fi

export WEBHOOK_EMBEDDED=1
export QUEUE_BACKEND=redis
export REDIS_URL=${REDIS_URL:-redis://localhost:6379/1}
export DISABLE_WEBHOOK_API_KEY=1
export WHATSAPP_WEBHOOK_SECRET=${WHATSAPP_WEBHOOK_SECRET:-AGZ_SECRET_123}
export WHATSAPP_BASE_URL=${WHATSAPP_BASE_URL:-http://localhost:3001}
# Porta da UI Flask (Agent Zero host). Usar WEB_UI_PORT pois run_ui.py não lê AGENT_ZERO_PORT.
export WEB_UI_PORT=${WEB_UI_PORT:-50001}
AGENT_ZERO_PORT="$WEB_UI_PORT"  # manter variável para reutilizar no webhook URL

# Ativar integração direta WhatsApp -> Agent Zero
export AGZ_INTERNAL_ENABLE_DIRECT=1
export AGZ_INTERNAL_BASE="http://localhost:$WEB_UI_PORT"
export AUTH_LOGIN=${AUTH_LOGIN:-admin}
export AUTH_PASSWORD=${AUTH_PASSWORD:-admin}

printf "[restart] Starting Agent Zero (embedded) on port $AGENT_ZERO_PORT ...\n"
python "$ROOT_DIR/run_ui.py" --port "$WEB_UI_PORT" > "$LOG_DIR/ui_embed.out" 2>&1 &
UI_PID=$!

sleep 5
curl -sf "http://localhost:$WEB_UI_PORT/agent-zero/debug/ping" >/dev/null && echo "[restart] Agent Zero ping OK (port $WEB_UI_PORT)" || echo "[restart] WARN: Agent Zero ping failed on port $WEB_UI_PORT"

# Esperar readiness completo (init_a0 finalizado)
printf "[restart] Waiting for Agent Zero readiness (init) ...\n"
READY_WAIT=0
until curl -s "http://localhost:$WEB_UI_PORT/ready" | grep -q '"ready": *true'; do
  sleep 1
  READY_WAIT=$((READY_WAIT+1))
  if [ $READY_WAIT -ge 90 ]; then
    echo "[restart] WARN: readiness timeout após 90s (seguindo mesmo assim)"
    break
  fi
done
if [ $READY_WAIT -lt 90 ]; then
  echo "[restart] Agent Zero READY em ${READY_WAIT}s"
fi

if [[ $START_GATEWAY -eq 1 ]]; then
  printf "[restart] Starting WhatsApp Gateway...\n"
  export AGZ_WEBHOOK_URL="http://localhost:$WEB_UI_PORT/agent-zero/webhooks/whatsapp"
  export WHATSAPP_WEBHOOK_SECRET
  export AGZ_INTERNAL_ENABLE_DIRECT
  export AGZ_INTERNAL_BASE
  export AUTH_LOGIN
  export AUTH_PASSWORD
  ( cd "$GATEWAY_DIR" && node bot_com_api.js > "$LOG_DIR/gw.out" 2>&1 & )
  GW_PID=$!
  sleep 6
  curl -s http://localhost:3001/v1/webhooks | grep -q agent-zero && echo "[restart] Webhook registered (maybe)" || echo "[restart] Webhook not yet registered"
else
  echo "[restart] Skipped starting gateway (--no-gateway)"
fi

if [[ $START_CRM -eq 1 ]]; then
  echo "[restart] Starting CRM (API + Frontend) ..."
  if [[ -d "$CRM_DIR" ]]; then
    if [[ -x "$CRM_LOCAL_SCRIPT" ]]; then
      "$CRM_LOCAL_SCRIPT" --crm-port "$CRM_PORT" --crm-api-port "$CRM_API_PORT" --tail || true
    else
      # Fallback antigo (caso script local não exista)
      if [[ ! -d "$CRM_DIR/node_modules" ]]; then
        echo "[restart][crm] Installing CRM dependencies (first run)..."
        ( cd "$CRM_DIR" && npm install --no-audit --no-fund >/dev/null 2>&1 ) || echo "[restart][crm] WARN: npm install failed"
      fi
      PORT="$CRM_API_PORT" node "$CRM_DIR/src/api/server.js" > "$CRM_LOG_DIR/crm_api.out" 2>&1 &
      CRM_API_PID=$!
      ( cd "$CRM_DIR" && npx vite --port "$CRM_PORT" --strictPort > "$CRM_LOG_DIR/crm_web.out" 2>&1 & )
      CRM_WEB_PID=$!
      sleep 3
      curl -sf "http://localhost:$CRM_API_PORT/api/conversations" >/dev/null 2>&1 && echo "[restart][crm] API up on :$CRM_API_PORT" || echo "[restart][crm] WARN: CRM API not responding on :$CRM_API_PORT"
      curl -sf "http://localhost:$CRM_PORT" >/dev/null 2>&1 && echo "[restart][crm] Frontend up on :$CRM_PORT" || echo "[restart][crm] WARN: CRM Frontend not responding on :$CRM_PORT"
    fi
  else
    echo "[restart][crm] Directory not found: $CRM_DIR (skipping)"
  fi
else
  echo "[restart] Skipped CRM (--no-crm)"
fi

printf "[restart] PIDs -> UI:$UI_PID GW:${GW_PID:-skip} CRM_API:${CRM_API_PID:-skip} CRM_WEB:${CRM_WEB_PID:-skip}\n"

echo "[restart] Tail logs: tail -f ui_embed.out gw.out $CRM_LOG_DIR/crm_api.out $CRM_LOG_DIR/crm_web.out"
