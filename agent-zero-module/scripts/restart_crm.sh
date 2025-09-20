#!/usr/bin/env bash
set -euo pipefail

# restart_crm.sh
# Reinicia SOMENTE o CRM (API Express + Frontend Vite) para desenvolvimento rápido da interface.
# NÃO toca em Agent Zero nem no gateway de WhatsApp.
#
# Uso:
#   ./scripts/restart_crm.sh [opções]
# Opções:
#   --crm-port PORT        Porta do frontend (Vite) (default 5173 ou $CRM_PORT)
#   --crm-api-port PORT    Porta da API Express (default 3002 ou $CRM_API_PORT)
#   --no-frontend          Não iniciar frontend (apenas API)
#   --no-api               Não iniciar API (apenas frontend)
#   --no-install | --quick Pular verificação/instalação de dependências
#   --kill-only            Apenas mata processos existentes e sai
#   --tail                 Faz tail dos logs após subir
#   --watch                Usa nodemon para reiniciar API ao salvar (hot reload backend)
#   --watch-full           API com nodemon + frontend simultâneo (ambos) para fluxo completo
#   --env-file FILE        Sourcing extra variáveis antes de iniciar
#   -h | --help            Mostrar ajuda e sair
#
# Exemplos:
#   ./scripts/restart_crm.sh --tail
#   ./scripts/restart_crm.sh --crm-port 5174 --no-api
#   ./scripts/restart_crm.sh --kill-only
#   CRM_PORT=5199 ./scripts/restart_crm.sh --quick

CRM_PORT=${CRM_PORT:-5173}
CRM_API_PORT=${CRM_API_PORT:-3100}
START_FRONTEND=1
START_API=1
DO_INSTALL=1
DO_TAIL=0
KILL_ONLY=0
ENV_FILE=""
WATCH_MODE=0
WATCH_FULL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --crm-port) shift; CRM_PORT="$1" ;;
    --crm-api-port) shift; CRM_API_PORT="$1" ;;
    --no-frontend) START_FRONTEND=0 ;;
    --no-api) START_API=0 ;;
    --no-install|--quick) DO_INSTALL=0 ;;
    --tail) DO_TAIL=1 ;;
  --kill-only) KILL_ONLY=1 ;;
  --watch) WATCH_MODE=1 ;;
  --watch-full) WATCH_MODE=1; WATCH_FULL=1 ;;
    --env-file) shift; ENV_FILE="$1" ;;
    -h|--help)
      sed -n '1,/^$/{p}' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "[restart_crm] Opção desconhecida: $1" >&2; exit 1 ;;
  esac
  shift || true
done

if [[ $START_FRONTEND -eq 0 && $START_API -eq 0 && $KILL_ONLY -eq 0 ]]; then
  echo "[restart_crm] Nada para iniciar (frontend e api desativados). Use --kill-only ou remova flags."
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CRM_DIR="$ROOT_DIR/comprehensive-crm-so"
CRM_LOCAL_SCRIPT="$CRM_DIR/scripts/restart_crm.sh"
LOG_DIR="$ROOT_DIR"
API_LOG="$LOG_DIR/crm_api.out"
WEB_LOG="$LOG_DIR/crm_web.out"

if [[ -x "$CRM_LOCAL_SCRIPT" ]]; then
  echo "[restart_crm] Aviso: este script foi movido para $CRM_LOCAL_SCRIPT. Usando o novo destino..."
  exec "$CRM_LOCAL_SCRIPT" "$@"
fi

if [[ -n "$ENV_FILE" ]]; then
  if [[ -f "$ENV_FILE" ]]; then
    echo "[restart_crm] Carregando env file: $ENV_FILE"
    # shellcheck disable=SC1090
    source "$ENV_FILE"
  else
    echo "[restart_crm] AVISO: env file não encontrado: $ENV_FILE" >&2
  fi
fi

kill_procs() {
  echo "[restart_crm] Matando processos antigos..."
  pkill -f "comprehensive-crm-so/src/api/server.js" 2>/dev/null || true
  # restringir pkill do vite para o diretório do CRM
  pkill -f "vite --port $CRM_PORT" 2>/dev/null || true
  # Fallback: se ainda existir processo node com server.js
  pgrep -fl "src/api/server.js" | grep -q "comprehensive-crm-so" && pkill -f "src/api/server.js" 2>/dev/null || true
}

kill_procs

if [[ $KILL_ONLY -eq 1 ]]; then
  echo "[restart_crm] Somente kill executado (--kill-only)."; exit 0
fi

if [[ ! -d "$CRM_DIR" ]]; then
  echo "[restart_crm] Diretório CRM inexistente: $CRM_DIR" >&2; exit 1
fi

if [[ $DO_INSTALL -eq 1 && ! -d "$CRM_DIR/node_modules" ]]; then
  echo "[restart_crm] Instalando dependências (primeira vez)..."
  (cd "$CRM_DIR" && npm install --no-audit --no-fund ) || echo "[restart_crm] WARN: npm install falhou"
fi

# Garantir nodemon se modo watch solicitado
if [[ $WATCH_MODE -eq 1 && ! -f "$CRM_DIR/node_modules/.bin/nodemon" ]]; then
  echo "[restart_crm] Instalando nodemon para watch..."
  (cd "$CRM_DIR" && npm install --no-audit --no-fund -D nodemon ) || echo "[restart_crm] WARN: instalação nodemon falhou"
fi

# Função para checar porta ocupada (macOS / Linux)
port_in_use() { lsof -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

if port_in_use "$CRM_API_PORT"; then echo "[restart_crm] AVISO: porta API $CRM_API_PORT já em uso"; fi
if port_in_use "$CRM_PORT"; then echo "[restart_crm] AVISO: porta Frontend $CRM_PORT já em uso"; fi

API_PID=""; WEB_PID=""

start_api() {
  if [[ $START_API -eq 1 ]]; then
    echo "[restart_crm] Iniciando API (porta $CRM_API_PORT)${WATCH_MODE:+ [watch]}..."
    export CRM_API_PORT
    export PORT="$CRM_API_PORT"
    if [[ $WATCH_MODE -eq 1 ]]; then
      (cd "$CRM_DIR" && npx nodemon --quiet --watch src/api --ext js,mjs,cjs,json src/api/server.js >"$API_LOG" 2>&1 &)
      API_PID=$!
    else
      node "$CRM_DIR/src/api/server.js" >"$API_LOG" 2>&1 &
      API_PID=$!
    fi
    sleep 2
    if curl -sf "http://localhost:$CRM_API_PORT/api/conversations" >/dev/null 2>&1; then
      echo "[restart_crm] API OK em :$CRM_API_PORT"
    else
      echo "[restart_crm] WARN: API não respondeu ainda em :$CRM_API_PORT"
    fi
  fi
}

start_frontend() {
  if [[ $START_FRONTEND -eq 1 ]]; then
    echo "[restart_crm] Iniciando Frontend Vite (porta $CRM_PORT)..."
    (cd "$CRM_DIR" && npx vite --port "$CRM_PORT" --strictPort >"$WEB_LOG" 2>&1 &)
    WEB_PID=$!
    sleep 2
    if curl -sf "http://localhost:$CRM_PORT" >/dev/null 2>&1; then
      echo "[restart_crm] Frontend OK em :$CRM_PORT"
    else
      echo "[restart_crm] WARN: Frontend não respondeu ainda em :$CRM_PORT"
    fi
  fi
}

if [[ $WATCH_FULL -eq 1 ]]; then
  echo "[restart_crm] Modo watch-full: iniciando API (nodemon) + Frontend..."
  start_api
  start_frontend
else
  start_api
  start_frontend
fi

echo "[restart_crm] PIDs -> API:${API_PID:-skip} WEB:${WEB_PID:-skip}"

echo "[restart_crm] Logs: $API_LOG / $WEB_LOG"

if [[ $DO_TAIL -eq 1 ]]; then
  echo "[restart_crm] Tail (Ctrl+C para sair)"
  tail -f "$API_LOG" "$WEB_LOG"
fi
