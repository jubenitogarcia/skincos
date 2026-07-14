#!/usr/bin/env bash
set -euo pipefail

# restart_crm.sh (local ao módulo crm)
# Reinicia SOMENTE o CRM (API Express + Frontend Vite) para desenvolvimento rápido da interface.
# NÃO toca em Agent Zero nem no gateway de WhatsApp.
#
# Uso:
#   ./restart_crm.sh [opções]
# Opções:
#   --crm-port PORT        Porta do frontend (Vite) (default 5173 ou $CRM_PORT)
#   --crm-api-port PORT    Porta da API Express (default 8099 ou $CRM_API_PORT)
#   --crm-host HOST        Host bind do frontend (default 127.0.0.1 ou $CRM_HOST)
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
#   ./restart_crm.sh --tail
#   ./restart_crm.sh --crm-port 5174 --no-api
#   ./restart_crm.sh --kill-only
#   CRM_PORT=5199 ./restart_crm.sh --quick

CRM_PORT=${CRM_PORT:-5173}
CRM_API_PORT=${CRM_API_PORT:-8099}
CRM_HOST=${CRM_HOST:-127.0.0.1}
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
    --crm-host) shift; CRM_HOST="$1" ;;
    --no-frontend) START_FRONTEND=0 ;;
    --no-api) START_API=0 ;;
    --no-install|--quick) DO_INSTALL=0 ;;
    --tail) DO_TAIL=1 ;;
    --kill-only) KILL_ONLY=1 ;;
    --watch) WATCH_MODE=1 ;;
    --watch-full) WATCH_MODE=1; WATCH_FULL=1 ;;
    --env-file) shift; ENV_FILE="$1" ;;
    -h|--help)
      awk '
        BEGIN { started=0 }
        /^# restart_crm\.sh/ { started=1 }
        {
          if (!started) next
          if ($0 ~ /^#/) { sub(/^# ?/, "", $0); print; next }
          if ($0 ~ /^$/) { print ""; next }
          exit
        }
      ' "$0"
      exit 0 ;;
    *) echo "[restart_crm] Opção desconhecida: $1" >&2; exit 1 ;;
  esac
  shift || true
done

if [[ $START_FRONTEND -eq 0 && $START_API -eq 0 && $KILL_ONLY -eq 0 ]]; then
  echo "[restart_crm] Nada para iniciar (frontend e api desativados). Use --kill-only ou remova flags."
  exit 1
fi

# Diretórios
CRM_DIR="$(cd "$(dirname "$0")" && pwd)"                # modules/crm/web/
ROOT_DIR="$CRM_DIR"

resolve_skincos_root() {
  local base="$1"
  local candidate
  for candidate in "$base" "$base/.." "$base/../.." "$base/../../.."; do
    if [[ -d "$candidate/modules/crm/api" && -d "$candidate/modules/crm/web" && -f "$candidate/modules/crm/web/package.json" ]]; then
      (cd "$candidate" && pwd)
      return 0
    fi
  done
  (cd "$base/../.." && pwd)
}

SKINCOS_ROOT="$(resolve_skincos_root "$ROOT_DIR")"
API_DIR="$SKINCOS_ROOT/modules/crm/api"
if [[ -f "$SKINCOS_ROOT/backend/scripts/env.sh" ]]; then
  # shellcheck disable=SC1090
  source "$SKINCOS_ROOT/backend/scripts/env.sh"
  export WA_INSTANCES_FILE="${WA_INSTANCES_FILE:-$VAR_DIR/core/whatsapp_instances.json}"
  export CRM_WA_INSTANCES_META="${CRM_WA_INSTANCES_META:-$VAR_DIR/core/wa_instances_meta.json}"
  export SKINCOS_CAPABILITIES_FILE="${SKINCOS_CAPABILITIES_FILE:-$SKINCOS_ROOT/backend/capabilities.json}"
  export CRM_UI_DIR="${CRM_UI_DIR:-$CRM_DIR}"
  mkdir -p "$(dirname "$WA_INSTANCES_FILE")" >/dev/null 2>&1 || true
  mkdir -p "$(dirname "$CRM_WA_INSTANCES_META")" >/dev/null 2>&1 || true

  # Create runtime state files if missing (keep repo clean: examples live in config/templates/examples)
  if [[ ! -f "$WA_INSTANCES_FILE" ]]; then
    if [[ -f "$SKINCOS_ROOT/backend/config/templates/examples/whatsapp_instances.example.json" ]]; then
      cp "$SKINCOS_ROOT/backend/config/templates/examples/whatsapp_instances.example.json" "$WA_INSTANCES_FILE" 2>/dev/null || true
    else
      printf '%s\n' '{"instances":[],"lastUpdate":null}' >"$WA_INSTANCES_FILE" 2>/dev/null || true
    fi
  fi
  if [[ ! -f "$CRM_WA_INSTANCES_META" ]]; then
    if [[ -f "$SKINCOS_ROOT/backend/config/templates/examples/wa_instances_meta.example.json" ]]; then
      cp "$SKINCOS_ROOT/backend/config/templates/examples/wa_instances_meta.example.json" "$CRM_WA_INSTANCES_META" 2>/dev/null || true
    else
      printf '%s\n' '{"instances":{}}' >"$CRM_WA_INSTANCES_META" 2>/dev/null || true
    fi
  fi
fi

if [[ -n "${VAR_DIR:-}" ]]; then
  LOG_DIR="${CRM_LOG_DIR:-$VAR_DIR/logs/crm}"
else
  LOG_DIR="${CRM_LOG_DIR:-$ROOT_DIR/logs}"
fi
mkdir -p "$LOG_DIR" >/dev/null 2>&1 || true

API_LOG="$LOG_DIR/crm_api.out"
WEB_LOG="$LOG_DIR/crm_web.out"

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
  # Best-effort: kill by port first (covers processes started outside this script, e.g. `node server.js`)
  if command -v lsof >/dev/null 2>&1; then
    for p in "$CRM_API_PORT" "$CRM_PORT"; do
      if lsof -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
        echo "[restart_crm] Matando processos na porta :$p..."
        # shellcheck disable=SC2046
        kill -9 $(lsof -ti tcp:"$p") 2>/dev/null || true
        sleep 0.2
      fi
    done
  fi
  # API do CRM
  pkill -f "${API_DIR}/server.js" 2>/dev/null || true
  # Vite do CRM (melhor esforço por porta)
  pkill -f "vite --port $CRM_PORT" 2>/dev/null || true
  # Fallback por nome do arquivo (path canônico)
  pkill -f "modules/crm/api/server.js" 2>/dev/null || true
}

kill_procs

if [[ $KILL_ONLY -eq 1 ]]; then
  echo "[restart_crm] Somente kill executado (--kill-only)."; exit 0
fi

if [[ ! -d "$CRM_DIR" ]]; then
  echo "[restart_crm] Diretório CRM inexistente: $CRM_DIR" >&2; exit 1
fi

if [[ $DO_INSTALL -eq 1 ]]; then
  # Frontend deps only if needed
  if [[ $START_FRONTEND -eq 1 ]]; then
    frontend_needs_install=0
    if [[ ! -x "$CRM_DIR/node_modules/.bin/vite" ]]; then
      frontend_needs_install=1
    fi
    # Ensure Tailwind v4 Vite plugin is present (used by vite.config.ts)
    if [[ ! -d "$CRM_DIR/node_modules/@tailwindcss/vite" ]]; then
      frontend_needs_install=1
    fi

    if [[ $frontend_needs_install -eq 1 ]]; then
    echo "[restart_crm] Instalando dependências do frontend (vite)..."
    (cd "$CRM_DIR" && npm install --no-audit --no-fund ) || echo "[restart_crm] WARN: npm install (frontend) falhou"
    fi
  fi

# API deps are isolated in modules/crm/api for faster installs
if [[ $START_API -eq 1 ]]; then
    if [[ ! -f "$API_DIR/package.json" ]]; then
      echo "[restart_crm] WARN: package.json não encontrado em $API_DIR; API pode falhar por deps ausentes" >&2
    else
      api_needs_install=0
      if [[ ! -d "$API_DIR/node_modules" ]]; then
        api_needs_install=1
      else
        for dep in express cors http-proxy-middleware axios; do
          if [[ ! -d "$API_DIR/node_modules/$dep" ]]; then
            api_needs_install=1
            break
          fi
        done
      fi

      if [[ $api_needs_install -eq 1 ]]; then
        echo "[restart_crm] Instalando dependências da API (isoladas em modules/crm/api)..."
        (
          if command -v pnpm >/dev/null 2>&1; then
            cd "$API_DIR" && pnpm install
          elif command -v corepack >/dev/null 2>&1; then
            cd "$API_DIR" && corepack pnpm install
          else
            cd "$API_DIR" && npm install --no-audit --no-fund
          fi
        ) || echo "[restart_crm] WARN: install deps (api) falhou"
      fi
    fi
  fi
fi

# Garantir nodemon se modo watch solicitado (preferir o nodemon do API_DIR)
if [[ $WATCH_MODE -eq 1 && -f "$API_DIR/package.json" && ! -x "$API_DIR/node_modules/.bin/nodemon" ]]; then
  echo "[restart_crm] Instalando nodemon (API) para watch..."
  (
    if command -v pnpm >/dev/null 2>&1; then
      cd "$API_DIR" && pnpm add -D nodemon
    elif command -v corepack >/dev/null 2>&1; then
      cd "$API_DIR" && corepack pnpm add -D nodemon
    else
      cd "$API_DIR" && npm install --no-audit --no-fund -D nodemon
    fi
  ) || echo "[restart_crm] WARN: instalação nodemon (api) falhou"
fi

# Função para checar porta ocupada (macOS / Linux)
port_in_use() { lsof -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

if port_in_use "$CRM_API_PORT"; then echo "[restart_crm] AVISO: porta API $CRM_API_PORT já em uso"; fi
if port_in_use "$CRM_PORT"; then echo "[restart_crm] AVISO: porta Frontend $CRM_PORT já em uso"; fi

API_PID=""; WEB_PID=""

start_api() {
  if [[ $START_API -eq 1 ]]; then
    # Prefer Evolution orchestrator locally when an Evolution .env with API key is available.
    if [[ -z "${WA_ORCHESTRATOR_PROVIDER:-}" ]]; then
      EVOLUTION_ENV_CANDIDATES=(
        "$SKINCOS_ROOT/modules/whatsapp/whatsapp/evolution-api/.env"
        "$HOME/Automation/n8n/evolution-api/.env"
      )
      EVOLUTION_ENV_FILE=""
      for candidate in "${EVOLUTION_ENV_CANDIDATES[@]}"; do
        if [[ -f "$candidate" ]]; then
          EVOLUTION_ENV_FILE="$candidate"
          break
        fi
      done
      if [[ -n "$EVOLUTION_ENV_FILE" ]]; then
        EVOLUTION_KEY_RAW="$(/usr/bin/grep -E '^AUTHENTICATION_API_KEY=' "$EVOLUTION_ENV_FILE" | head -n1 | cut -d= -f2- | tr -d '\r')"
        EVOLUTION_KEY="${EVOLUTION_KEY_RAW%\"}"
        EVOLUTION_KEY="${EVOLUTION_KEY#\"}"
        EVOLUTION_KEY="${EVOLUTION_KEY%\'}"
        EVOLUTION_KEY="${EVOLUTION_KEY#\'}"
        if [[ -n "$EVOLUTION_KEY" ]]; then
          export WA_ORCHESTRATOR_PROVIDER="evolution"
          export EVOLUTION_API_URL="${EVOLUTION_API_URL:-http://127.0.0.1:8080}"
          export EVOLUTION_API_KEY="${EVOLUTION_API_KEY:-$EVOLUTION_KEY}"
          echo "[restart_crm] Evolution local autodetect ativo ($EVOLUTION_ENV_FILE)"
        fi
      fi
    fi

    echo "[restart_crm] Iniciando API (porta $CRM_API_PORT)${WATCH_MODE:+ [watch]}..."
    export CRM_API_PORT
    export PORT="$CRM_API_PORT"
    if [[ $WATCH_MODE -eq 1 ]]; then
      NODEMON_BIN="$API_DIR/node_modules/.bin/nodemon"
      if [[ -x "$NODEMON_BIN" ]]; then
        (cd "$API_DIR" && "$NODEMON_BIN" --quiet --watch . --ext js,mjs,cjs,json server.js >"$API_LOG" 2>&1 ) &
      else
        (cd "$API_DIR" && npx nodemon --quiet --watch . --ext js,mjs,cjs,json server.js >"$API_LOG" 2>&1 ) &
      fi
      API_PID=$!
    else
      (cd "$API_DIR" && node server.js >"$API_LOG" 2>&1 ) &
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
  (cd "$CRM_DIR" && npx vite --host "$CRM_HOST" --port "$CRM_PORT" --strictPort >"$WEB_LOG" 2>&1 ) &
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
