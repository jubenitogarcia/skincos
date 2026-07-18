#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/crm/console"
CRM_API_DIR="$ROOT_DIR/crm/api"

CRM_HOST="${CRM_HOST:-127.0.0.1}"
if [[ -n "${CRM_API_PORT+x}" ]]; then
  CRM_API_PORT_EXPLICIT=1
else
  CRM_API_PORT_EXPLICIT=0
fi
CRM_API_PORT="${CRM_API_PORT:-8100}"
if [[ -n "${FRONTEND_PORT+x}" ]]; then
  FRONTEND_PORT_EXPLICIT=1
else
  FRONTEND_PORT_EXPLICIT=0
fi
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
CRM_ROUTE="${CRM_ROUTE:-/?module=atendimento}"
if [[ -n "${CRM_OPEN_BROWSER+x}" ]]; then
  CRM_OPEN_BROWSER_EXPLICIT=1
else
  CRM_OPEN_BROWSER_EXPLICIT=0
fi
is_codex_app_shell() {
  [[ "${CODEX_SHELL:-}" == "1" || "${CODEX_CI:-}" == "1" || "${CODEX_INTERNAL_ORIGINATOR_OVERRIDE:-}" == "Codex Desktop" ]]
}

if [[ "$CRM_OPEN_BROWSER_EXPLICIT" == "0" ]] && is_codex_app_shell; then
  CRM_OPEN_BROWSER=0
else
  CRM_OPEN_BROWSER="${CRM_OPEN_BROWSER:-1}"
fi
CRM_SMOKE="${CRM_SMOKE:-0}"
CRM_SMOKE_HEADED="${CRM_SMOKE_HEADED:-${HEADED:-0}}"
CRM_EXIT_AFTER_SMOKE="${CRM_EXIT_AFTER_SMOKE:-0}"
CRM_BUILD_BEFORE_START="${CRM_BUILD_BEFORE_START:-0}"
PID_FILE="${CRM_PID_FILE:-$ROOT_DIR/.crm-atendimento-local.pid}"
LOG_FILE="${CRM_LOG_FILE:-$ROOT_DIR/.crm-atendimento-local.log}"
CRM_OPERATOR_RUNTIME_ROOT="${CRM_OPERATOR_RUNTIME_ROOT:-/mnt/c/CodexRuntime/operator/admin/skincos}"
CRM_PLAYWRIGHT_BROWSERS_PATH="${CRM_PLAYWRIGHT_BROWSERS_PATH:-${PLAYWRIGHT_BROWSERS_PATH:-$CRM_OPERATOR_RUNTIME_ROOT/playwright-browsers}}"

usage() {
  cat <<EOF
SKINCOS • Testar CRM Atendimento local

Uso:
  $(basename "$0") [opções]

Opções:
  --crm-host HOST           Host do Vite (default: 127.0.0.1)
  --frontend-port PORT      Porta do frontend Vite (default: 5173)
  --api-port PORT           Porta do crm-api local (default: 8100)
  --build                   Roda build do frontend antes de subir
  --skip-build              Não roda build do frontend antes de subir
  --smoke                   Roda smoke Playwright do módulo após subir
  --exit-after-smoke        Encerra o CRM local depois da smoke
  --headed-smoke            Roda a smoke com janela visível
  CRM_PLAYWRIGHT_BROWSERS_PATH
                            Cache privado dos navegadores Playwright
  --browser                 Abre o navegador automaticamente
  --no-browser              Não abre o navegador automaticamente
  --stop                    Encerra a instância atual e sai
  -h, --help                Mostrar ajuda

Exemplos:
  ./scripts/run-local-atendimento.sh
  ./scripts/run-local-atendimento.sh --build
  ./scripts/run-local-atendimento.sh --smoke --exit-after-smoke
EOF
}

STOP_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --crm-host) shift; CRM_HOST="$1" ;;
    --frontend-port) shift; FRONTEND_PORT="$1"; FRONTEND_PORT_EXPLICIT=1 ;;
    --api-port) shift; CRM_API_PORT="$1"; CRM_API_PORT_EXPLICIT=1 ;;
    --build) CRM_BUILD_BEFORE_START=1 ;;
    --skip-build) CRM_BUILD_BEFORE_START=0 ;;
    --smoke) CRM_SMOKE=1 ;;
    --exit-after-smoke) CRM_EXIT_AFTER_SMOKE=1 ;;
    --headed-smoke) CRM_SMOKE_HEADED=1 ;;
    --browser) CRM_OPEN_BROWSER=1; CRM_OPEN_BROWSER_EXPLICIT=1 ;;
    --no-browser) CRM_OPEN_BROWSER=0; CRM_OPEN_BROWSER_EXPLICIT=1 ;;
    --stop) STOP_ONLY=1 ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "Opcao desconhecida: $1" >&2
      usage
      exit 1
      ;;
  esac
  shift || true
done

if [[ "$CRM_EXIT_AFTER_SMOKE" == "1" ]]; then
  CRM_SMOKE=1
fi

if [[ "$CRM_SMOKE" == "1" && "$CRM_OPEN_BROWSER_EXPLICIT" == "0" ]]; then
  CRM_OPEN_BROWSER=0
fi

DEFAULT_URL="http://localhost:${FRONTEND_PORT}${CRM_ROUTE}"

wait_for_http() {
  local url="$1"
  local timeout="${2:-60}"
  local start
  start="$(date +%s)"
  while true; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    if (( $(date +%s) - start >= timeout )); then
      return 1
    fi
    sleep 1
  done
}

load_env_file() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    return 0
  fi
  local line key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*$ || "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ ! "$line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      echo "[atendimento-local] Ignorando linha inválida em $(basename "$file")." >&2
      continue
    fi
    key="${BASH_REMATCH[2]}"
    value="${BASH_REMATCH[3]}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    if [[ ${#value} -ge 2 ]] && { [[ "${value:0:1}" == '"' && "${value: -1}" == '"' ]] || [[ "${value:0:1}" == "'" && "${value: -1}" == "'" ]]; }; then
      value="${value:1:${#value}-2}"
    fi
    printf -v "$key" '%s' "$value"
    export "$key"
  done < "$file"
}

load_local_env() {
  load_env_file "$ROOT_DIR/backend/config/workspace.local.env"
  load_env_file "$CRM_API_DIR/.env"
  load_env_file "$ROOT_DIR/.env"
}

assert_port_free() {
  local port="$1"
  local label="$2"
  local pids
  pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "[atendimento-local] Porta $port ocupada por $label (pid: $pids)." >&2
    echo "[atendimento-local] Rode: ./scripts/run-local-atendimento.sh --stop" >&2
    exit 1
  fi
}

is_port_free() {
  local port="$1"
  [[ -z "$(lsof -ti tcp:"$port" 2>/dev/null || true)" ]]
}

pick_available_port() {
  local preferred="$1"
  local label="$2"
  local explicit="$3"
  if is_port_free "$preferred"; then
    printf '%s' "$preferred"
    return 0
  fi
  if [[ "$explicit" == "1" ]]; then
    assert_port_free "$preferred" "$label"
  fi
  local port="$preferred"
  while (( port < preferred + 50 )); do
    port=$((port + 1))
    if is_port_free "$port"; then
      echo "[atendimento-local] Porta $preferred ocupada por $label; usando $port." >&2
      printf '%s' "$port"
      return 0
    fi
  done
  echo "[atendimento-local] Nenhuma porta livre encontrada para $label a partir de $preferred." >&2
  exit 1
}

stop_existing() {
  if [[ ! -f "$PID_FILE" ]]; then
    return 0
  fi
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
    if process_belongs_to_checkout "$pid"; then
      echo "[atendimento-local] Encerrando instancia anterior (pid: $pid)"
      terminate_tree "$pid"
      sleep 1
    else
      echo "[atendimento-local] PID $pid do estado anterior não pertence a este checkout; preservado." >&2
    fi
  fi
  rm -f "$PID_FILE"
}

process_belongs_to_checkout() {
  local pid="$1"
  local args
  args="$(ps -p "$pid" -o args= 2>/dev/null || true)"
  [[ -n "$args" && "$args" == *"$ROOT_DIR"* ]]
}

stop_owned_port_listener() {
  local port="$1"
  local label="$2"
  local pids
  pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
  if [[ -z "$pids" ]]; then
    return 0
  fi
  local pid
  for pid in $pids; do
    local args
    args="$(ps -p "$pid" -o args= 2>/dev/null || true)"
    if [[ "$args" == *"$ROOT_DIR"* ]]; then
      if [[ "$args" == *"vite"* || "$args" == *"crm/api/server.js"* || "$args" == *"npm run dev"* ]]; then
        echo "[atendimento-local] Encerrando $label preso na porta $port (pid: $pid)"
        terminate_tree "$pid"
      fi
    fi
  done
}

open_browser() {
  # Launch a URL as an argument, never through cmd.exe /c, so query strings
  # cannot be interpreted as Windows shell syntax.
  if command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -NoProfile -NonInteractive -Command 'Start-Process -FilePath $args[0]' -- "$DEFAULT_URL" >/dev/null 2>&1 && return 0
  fi
  if command -v open >/dev/null 2>&1; then
    open "$DEFAULT_URL" >/dev/null 2>&1 &
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$DEFAULT_URL" >/dev/null 2>&1 &
  fi
}

cleanup() {
  if [[ -n "${FRONTEND_PID:-}" ]]; then
    terminate_tree "$FRONTEND_PID"
  fi
  if [[ -n "${CRM_API_PID:-}" ]]; then
    terminate_tree "$CRM_API_PID"
  fi
  if [[ -f "$PID_FILE" ]]; then
    local tracked_pid
    tracked_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ "$tracked_pid" == "$$" ]]; then
      rm -f "$PID_FILE"
    fi
  fi
}
trap cleanup EXIT INT TERM

terminate_tree() {
  local pid="$1"
  if [[ -z "$pid" ]] || ! kill -0 "$pid" >/dev/null 2>&1; then
    return 0
  fi
  local child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    terminate_tree "$child"
  done
  kill "$pid" >/dev/null 2>&1 || true
}

remove_controlled_shutdown_noise() {
  if [[ -f "$LOG_FILE" ]]; then
    sed -i '/ELIFECYCLE.*Command failed\.$/d' "$LOG_FILE"
  fi
}

if [[ "$STOP_ONLY" == "1" ]]; then
  stop_existing
  stop_owned_port_listener "$CRM_API_PORT" "crm-api"
  stop_owned_port_listener "$FRONTEND_PORT" "vite"
  remove_controlled_shutdown_noise
  echo "CRM Atendimento local finalizado."
  exit 0
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm nao encontrado no PATH." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl nao encontrado no PATH." >&2
  exit 1
fi

ensure_playwright_browser_ready() {
  local playwright_bin="$FRONTEND_DIR/node_modules/.bin/playwright"
  local browsers_manifest="$FRONTEND_DIR/node_modules/playwright-core/browsers.json"
  local chromium_revision
  local headless_revision
  local ffmpeg_revision
  if [[ ! -x "$playwright_bin" || ! -f "$browsers_manifest" ]]; then
    echo "[atendimento-local] Playwright não está instalado em $FRONTEND_DIR." >&2
    exit 1
  fi
  mkdir -p "$CRM_PLAYWRIGHT_BROWSERS_PATH"
  read -r chromium_revision headless_revision ffmpeg_revision < <(
    node - "$browsers_manifest" <<'NODE'
const manifest = require(process.argv[2])
const revision = (name) => manifest.browsers.find((entry) => entry.name === name)?.revision || ''
process.stdout.write(`${revision('chromium')} ${revision('chromium-headless-shell')} ${revision('ffmpeg')}\n`)
NODE
  )
  if [[ -n "$chromium_revision" && -n "$headless_revision" && -n "$ffmpeg_revision" ]] &&
    [[ -x "$CRM_PLAYWRIGHT_BROWSERS_PATH/chromium-$chromium_revision/chrome-linux64/chrome" ]] &&
    [[ -x "$CRM_PLAYWRIGHT_BROWSERS_PATH/chromium_headless_shell-$headless_revision/chrome-headless-shell-linux64/chrome-headless-shell" ]] &&
    [[ -x "$CRM_PLAYWRIGHT_BROWSERS_PATH/ffmpeg-$ffmpeg_revision/ffmpeg-linux" ]]; then
    echo "[atendimento-local] Chromium headless $headless_revision pronto."
    return 0
  fi
  if ! PLAYWRIGHT_BROWSERS_PATH="$CRM_PLAYWRIGHT_BROWSERS_PATH" "$playwright_bin" install chromium; then
    echo "[atendimento-local] Não foi possível provisionar o Chromium em $CRM_PLAYWRIGHT_BROWSERS_PATH." >&2
    exit 1
  fi
}

mkdir -p "$(dirname "$PID_FILE")" "$(dirname "$LOG_FILE")"
: > "$LOG_FILE"
load_local_env

stop_existing
CRM_API_PORT="$(pick_available_port "$CRM_API_PORT" "crm-api" "$CRM_API_PORT_EXPLICIT")"
FRONTEND_PORT="$(pick_available_port "$FRONTEND_PORT" "vite" "$FRONTEND_PORT_EXPLICIT")"
DEFAULT_URL="http://localhost:${FRONTEND_PORT}${CRM_ROUTE}"

echo ""
echo "SKINCOS • Testar CRM Atendimento local"
echo "Modulo inicial: atendimento"
echo "URLs:"
echo "  Frontend : $DEFAULT_URL"
echo "  CRM API  : http://127.0.0.1:${CRM_API_PORT}/api/atendimento/health"
echo "Log: $LOG_FILE"
echo ""

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[atendimento-local] DATABASE_URL nao configurado." >&2
  echo "[atendimento-local] Defina DATABASE_URL no shell ou em backend/config/workspace.local.env antes de abrir o modulo." >&2
  exit 1
fi

echo "[atendimento-local] Aplicando migration local segura do Atendimento..."
DATABASE_URL="$DATABASE_URL" node "$CRM_API_DIR/scripts/migrate-atendimento-write-safety.mjs" --apply

if [[ "$CRM_BUILD_BEFORE_START" == "1" ]]; then
  echo "[atendimento-local] Gerando build do frontend..."
  npm --prefix "$FRONTEND_DIR" run build
fi

(
  cd "$ROOT_DIR"
  export CRM_API_PORT
  export PORT="$CRM_API_PORT"
  export NO_AUTH=true
  export CRM_LOCAL_NO_AUTH=true
  export CRM_BASIC_AUTH=""
  export DEV_AUTH_EMAIL="${DEV_AUTH_EMAIL:-dev@local.test}"
  export DEV_AUTH_ROLE="${DEV_AUTH_ROLE:-GESTOR}"
  export DEV_AUTH_ALLOWED_MODULES="${DEV_AUTH_ALLOWED_MODULES:-atendimento,faturamento,procedimentos,ponto,status,users}"
  export NODE_ENV=development
  export CRM_LOG_LEVEL="${CRM_LOG_LEVEL:-warn}"
  node "$CRM_API_DIR/server.js"
) >>"$LOG_FILE" 2>&1 &
CRM_API_PID=$!

if ! wait_for_http "http://127.0.0.1:${CRM_API_PORT}/api/auth/me" 120; then
  echo "[atendimento-local] crm-api nao respondeu em tempo habil. Veja $LOG_FILE" >&2
  exit 1
fi

(
  cd "$FRONTEND_DIR"
  export API_PROXY_TARGET="http://127.0.0.1:${CRM_API_PORT}"
  export VITE_API_PROXY_TARGET="http://127.0.0.1:${CRM_API_PORT}"
  export LOCAL_AUTH_BYPASS=false
  export VITE_LOCAL_AUTH_BYPASS=false
  export VITE_LOCAL_CRM_FOCUS_MODULE=atendimento
  npm run dev -- --host "$CRM_HOST" --port "$FRONTEND_PORT"
) >>"$LOG_FILE" 2>&1 &
FRONTEND_PID=$!

echo "$$" > "$PID_FILE"

if [[ "$CRM_OPEN_BROWSER" == "1" ]]; then
  (
    if wait_for_http "$DEFAULT_URL" 90; then
      open_browser
    else
      echo "[atendimento-local] O CRM nao respondeu em $DEFAULT_URL dentro do tempo esperado."
    fi
  ) &
fi

if [[ "$CRM_SMOKE" == "1" ]]; then
  ensure_playwright_browser_ready
  if ! wait_for_http "$DEFAULT_URL" 90; then
    echo "[atendimento-local] O CRM nao respondeu para a smoke em tempo habil." >&2
    exit 1
  fi
  echo "[atendimento-local] Rodando smoke local do Atendimento..."
  (
    cd "$FRONTEND_DIR"
    PLAYWRIGHT_BROWSERS_PATH="$CRM_PLAYWRIGHT_BROWSERS_PATH" CRM_URL="$DEFAULT_URL" HEADED="$CRM_SMOKE_HEADED" npm run smoke:atendimento:local
  )
  if [[ "$CRM_EXIT_AFTER_SMOKE" == "1" ]]; then
    echo "[atendimento-local] Smoke concluida; encerrando CRM local."
    exit 0
  fi
fi

echo "Notas:"
echo "  - O backend local roda com NO_AUTH=true e modulo atendimento liberado."
echo "  - DATABASE_URL foi carregado do ambiente local."
echo ""

wait "$FRONTEND_PID"
