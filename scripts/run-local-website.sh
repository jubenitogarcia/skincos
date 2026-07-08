#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_PATH="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
WEBSITE_DIR="$ROOT_DIR/modules/site-public/website"
WEBSITE_HOST="${WEBSITE_HOST:-0.0.0.0}"
if [[ -n "${WEBSITE_PORT+x}" ]]; then
  WEBSITE_PORT_EXPLICIT=1
else
  WEBSITE_PORT_EXPLICIT=0
fi
WEBSITE_PORT="${WEBSITE_PORT:-3000}"
WEBSITE_STATE_DIR="${WEBSITE_STATE_DIR:-$ROOT_DIR}"
PID_FILE="${WEBSITE_PID_FILE:-$WEBSITE_STATE_DIR/.website-local-dev.pid}"
LOG_FILE="${WEBSITE_LOG_FILE:-$WEBSITE_STATE_DIR/website-local-dev.log}"
PORT_FILE="${WEBSITE_PORT_FILE:-$WEBSITE_STATE_DIR/website-local-dev.port}"
WEBSITE_ROUTE="${WEBSITE_ROUTE:-/}"
WEBSITE_DETACH="${WEBSITE_DETACH:-0}"
WEBSITE_SUPERVISOR_MODE="${WEBSITE_SUPERVISOR_MODE:-0}"
WEBSITE_START_TIMEOUT="${WEBSITE_START_TIMEOUT:-90}"

if [[ -n "${OPEN_BROWSER+x}" ]]; then
  OPEN_BROWSER_EXPLICIT=1
else
  OPEN_BROWSER_EXPLICIT=0
fi

is_codex_app_shell() {
  [[ "${CODEX_SHELL:-}" == "1" || "${CODEX_CI:-}" == "1" || "${CODEX_INTERNAL_ORIGINATOR_OVERRIDE:-}" == "Codex Desktop" ]]
}

if [[ "$OPEN_BROWSER_EXPLICIT" == "0" ]] && is_codex_app_shell; then
  OPEN_BROWSER=0
else
  OPEN_BROWSER="${OPEN_BROWSER:-1}"
fi

STOP_ONLY=0

usage() {
  cat <<EOF
SKINCOS • Website local

Uso:
  $(basename "$0") [rota] [opções]

Opções:
  --browser      Abre navegador automaticamente
  --no-browser   Não abre navegador automaticamente
  --stop         Encerra a instância local rastreada e sai
  -h, --help     Mostrar ajuda
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --browser) OPEN_BROWSER=1; OPEN_BROWSER_EXPLICIT=1 ;;
    --no-browser) OPEN_BROWSER=0; OPEN_BROWSER_EXPLICIT=1 ;;
    --stop) STOP_ONLY=1 ;;
    -h|--help) usage; exit 0 ;;
    *)
      if [[ "$1" == -* ]]; then
        echo "Opção desconhecida: $1" >&2
        usage
        exit 1
      fi
      WEBSITE_ROUTE="$1"
      ;;
  esac
  shift || true
done

case "$WEBSITE_ROUTE" in
  /*) ;;
  *) WEBSITE_ROUTE="/$WEBSITE_ROUTE" ;;
esac

DEFAULT_URL="http://localhost:${WEBSITE_PORT}${WEBSITE_ROUTE}"
NETWORK_URL="http://${WEBSITE_HOST}:${WEBSITE_PORT}${WEBSITE_ROUTE}"

collect_descendants() {
  local parent_pid="$1"
  local child_pid

  if ! command -v pgrep >/dev/null 2>&1; then
    return 0
  fi

  while IFS= read -r child_pid; do
    [ -n "$child_pid" ] || continue
    collect_descendants "$child_pid"
    echo "$child_pid"
  done < <(pgrep -P "$parent_pid" 2>/dev/null || true)
}

terminate_pid() {
  local target_pid="$1"
  local descendant_pids

  if ! kill -0 "$target_pid" >/dev/null 2>&1; then
    return 0
  fi

  descendant_pids="$(collect_descendants "$target_pid" | tr '\n' ' ')"

  if [ -n "$descendant_pids" ]; then
    kill -TERM $descendant_pids >/dev/null 2>&1 || true
  fi
  kill -TERM "$target_pid" >/dev/null 2>&1 || true

  sleep 2

  if [ -n "$descendant_pids" ]; then
    kill -KILL $descendant_pids >/dev/null 2>&1 || true
  fi
  kill -KILL "$target_pid" >/dev/null 2>&1 || true
}

port_listener_pids() {
  local port="$1"

  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
    return 0
  fi

  if command -v ss >/dev/null 2>&1; then
    ss -ltnp "( sport = :$port )" 2>/dev/null |
      sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' |
      sort -u
  fi
}

is_port_free() {
  local port="$1"
  [[ -z "$(port_listener_pids "$port")" ]]
}

is_owned_website_listener() {
  local pid="$1"
  local args
  local cwd

  args="$(ps -p "$pid" -o args= 2>/dev/null || true)"
  cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"

  [[ -n "$args" ]] || return 1
  [[ "$args" == *"next dev"* || "$args" == *"npm run dev"* || "$args" == *"/next/dist/bin/next"* ]] || return 1
  [[ "$cwd" == "$WEBSITE_DIR" || "$cwd" == "$ROOT_DIR" ]] || return 1
}

stop_owned_port_listener() {
  local port="$1"
  local found_existing=1
  local listening_pid

  while IFS= read -r listening_pid; do
    [[ -n "$listening_pid" ]] || continue
    if is_owned_website_listener "$listening_pid"; then
      found_existing=0
      echo "Processo do website local preso na porta $port detectado (PID $listening_pid). Finalizando..."
      terminate_pid "$listening_pid"
    fi
  done < <(port_listener_pids "$port")

  return "$found_existing"
}

resolve_website_port() {
  local preferred_port="$1"
  local port="$preferred_port"

  if is_port_free "$port"; then
    WEBSITE_PORT="$port"
    PORT_SELECTION_NOTE=""
    return 0
  fi

  if [[ "$WEBSITE_PORT_EXPLICIT" == "1" ]]; then
    echo "Porta $port já está em uso. Defina WEBSITE_PORT para outra porta ou finalize o processo atual." >&2
    exit 1
  fi

  while (( port < preferred_port + 50 )); do
    port=$((port + 1))
    if is_port_free "$port"; then
      WEBSITE_PORT="$port"
      PORT_SELECTION_NOTE="Porta $preferred_port ocupada; usando $port."
      return 0
    fi
  done

  echo "Nenhuma porta livre encontrada para o website local a partir de $preferred_port." >&2
  exit 1
}

stop_existing_site() {
  local found_existing=0
  local existing_pid
  local tracked_port

  if [ -f "$PID_FILE" ]; then
    existing_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$existing_pid" ] && kill -0 "$existing_pid" >/dev/null 2>&1; then
      found_existing=1
      echo "Instância anterior detectada (PID $existing_pid). Finalizando..."
      terminate_pid "$existing_pid"
    fi
    rm -f "$PID_FILE"
  fi

  if [ -f "$PORT_FILE" ]; then
    tracked_port="$(cat "$PORT_FILE" 2>/dev/null || true)"
    if [[ -n "$tracked_port" ]] && stop_owned_port_listener "$tracked_port"; then
      found_existing=1
    fi
    rm -f "$PORT_FILE"
  fi

  if [ "$found_existing" -eq 1 ]; then
    echo "Reinicialização completa concluída. Subindo ambiente novamente..."
    echo ""
  fi
}

wait_for_site() {
  local url="$1"
  local retries="${2:-$WEBSITE_START_TIMEOUT}"
  while [ "$retries" -gt 0 ]; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    retries=$((retries - 1))
  done
  return 1
}

wait_for_site_or_supervisor() {
  local url="$1"
  local supervisor_pid="$2"
  local retries="${3:-$WEBSITE_START_TIMEOUT}"

  while [ "$retries" -gt 0 ]; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    if [[ -n "$supervisor_pid" ]] && ! kill -0 "$supervisor_pid" >/dev/null 2>&1; then
      return 2
    fi
    sleep 1
    retries=$((retries - 1))
  done

  return 1
}

open_browser() {
  if command -v open >/dev/null 2>&1; then
    open "$DEFAULT_URL"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$DEFAULT_URL" >/dev/null 2>&1 || true
  fi
}

run_website_supervisor() {
  local server_pid

  if [[ "$WEBSITE_SUPERVISOR_MODE" == "1" ]]; then
    nohup npm --prefix "$WEBSITE_DIR" run dev -- --hostname "$WEBSITE_HOST" --port "$WEBSITE_PORT" >>"$LOG_FILE" 2>&1 < /dev/null &
    server_pid=$!
  else
    npm --prefix "$WEBSITE_DIR" run dev -- --hostname "$WEBSITE_HOST" --port "$WEBSITE_PORT" &
    server_pid=$!
  fi

  echo "$$" > "$PID_FILE"

  cleanup() {
    if [[ -n "${server_pid:-}" ]]; then
      terminate_pid "$server_pid"
    fi
    if [ -f "$PID_FILE" ]; then
      local tracked_pid
      tracked_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
      if [ "$tracked_pid" = "$$" ]; then
        rm -f "$PID_FILE"
        rm -f "$PORT_FILE"
      fi
    fi
  }

  trap cleanup EXIT INT TERM
  wait "$server_pid"
}

start_detached_supervisor() {
  nohup setsid env \
    OPEN_BROWSER=0 \
    WEBSITE_SUPERVISOR_MODE=1 \
    WEBSITE_DETACH=0 \
    WEBSITE_HOST="$WEBSITE_HOST" \
    WEBSITE_PORT="$WEBSITE_PORT" \
    WEBSITE_STATE_DIR="$WEBSITE_STATE_DIR" \
    WEBSITE_PID_FILE="$PID_FILE" \
    WEBSITE_LOG_FILE="$LOG_FILE" \
    WEBSITE_PORT_FILE="$PORT_FILE" \
    WEBSITE_ROUTE="$WEBSITE_ROUTE" \
    bash "$SCRIPT_PATH" >>"$LOG_FILE" 2>&1 < /dev/null &
  DETACHED_SUPERVISOR_PID=$!
}

website_workerd_ready() {
  (
    cd "$WEBSITE_DIR"
    node -e "require('workerd')" >/dev/null 2>&1
  )
}

ensure_website_dependencies() {
  if [ ! -d "$WEBSITE_DIR/node_modules" ]; then
    echo "Dependências do website não encontradas. Instalando..."
    npm --prefix "$WEBSITE_DIR" install
    return 0
  fi

  if ! website_workerd_ready; then
    echo "Dependências do website foram instaladas para outra plataforma. Reinstalando o workerd no WSL..."
    rm -rf "$WEBSITE_DIR/node_modules/workerd" "$WEBSITE_DIR/node_modules"/@cloudflare/workerd-*
    npm --prefix "$WEBSITE_DIR" install --no-save workerd
  fi
}

if ! command -v npm >/dev/null 2>&1; then
  echo "npm não encontrado no PATH."
  exit 1
fi

if [[ "$STOP_ONLY" = "1" ]]; then
  mkdir -p "$(dirname "$PID_FILE")" "$(dirname "$PORT_FILE")"
  stop_existing_site
  echo "Website local encerrado."
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl não encontrado no PATH."
  exit 1
fi

mkdir -p "$(dirname "$PID_FILE")" "$(dirname "$LOG_FILE")" "$(dirname "$PORT_FILE")"
touch "$LOG_FILE"

cd "$ROOT_DIR"

ensure_website_dependencies

if [[ "$WEBSITE_SUPERVISOR_MODE" == "1" ]]; then
  run_website_supervisor
  exit $?
fi

stop_existing_site
resolve_website_port "$WEBSITE_PORT"
DEFAULT_URL="http://localhost:${WEBSITE_PORT}${WEBSITE_ROUTE}"
NETWORK_URL="http://${WEBSITE_HOST}:${WEBSITE_PORT}${WEBSITE_ROUTE}"
echo "$WEBSITE_PORT" > "$PORT_FILE"

echo ""
echo "SKINCOS • Website local"
echo "Iniciando ambiente local em $DEFAULT_URL"
echo "Host: $WEBSITE_HOST"
echo "Porta: $WEBSITE_PORT"
if [[ -n "${PORT_SELECTION_NOTE:-}" ]]; then
  echo "$PORT_SELECTION_NOTE"
fi
echo ""
echo "URLs:"
echo "  Local  : $DEFAULT_URL"
echo "  Rede   : $NETWORK_URL"
echo "Log: $LOG_FILE"
echo "PID: $PID_FILE"
echo "Porta: $PORT_FILE"
echo ""

printf '\n[%s] Starting website local on %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$DEFAULT_URL" >>"$LOG_FILE"

if [[ "$WEBSITE_DETACH" == "1" ]]; then
  startup_status=0
  start_detached_supervisor
  wait_for_site_or_supervisor "$DEFAULT_URL" "${DETACHED_SUPERVISOR_PID:-}" || startup_status=$?
  if [[ "$startup_status" -eq 0 ]]; then
    echo "Website local pronto em $DEFAULT_URL"
    exit 0
  fi
  if [[ "$startup_status" -eq 2 ]]; then
    echo "O processo do website encerrou antes de responder. Veja o log em $LOG_FILE." >&2
  else
    echo "O site não respondeu em $DEFAULT_URL dentro do tempo esperado. Veja o log em $LOG_FILE." >&2
  fi
  stop_existing_site
  exit 1
fi

if [ "$OPEN_BROWSER" = "1" ]; then
  (
    if wait_for_site "$DEFAULT_URL"; then
      open_browser
    else
      echo "O site não respondeu em $DEFAULT_URL dentro do tempo esperado."
    fi
  ) &
fi

run_website_supervisor
