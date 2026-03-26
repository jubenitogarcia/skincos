#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WEBSITE_DIR="$ROOT_DIR/website"
WEBSITE_HOST="${WEBSITE_HOST:-0.0.0.0}"
WEBSITE_PORT="${WEBSITE_PORT:-3000}"
WEBSITE_ROUTE="${1:-${WEBSITE_ROUTE:-/}}"
PID_FILE="$ROOT_DIR/.website-local-dev.pid"

case "$WEBSITE_ROUTE" in
  /*) ;;
  *) WEBSITE_ROUTE="/$WEBSITE_ROUTE" ;;
esac

DEFAULT_URL="http://localhost:${WEBSITE_PORT}${WEBSITE_ROUTE}"
NETWORK_URL="http://${WEBSITE_HOST}:${WEBSITE_PORT}${WEBSITE_ROUTE}"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm não encontrado no PATH."
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl não encontrado no PATH."
  exit 1
fi

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

stop_existing_site() {
  local found_existing=0
  local existing_pid
  local listening_pid

  if [ -f "$PID_FILE" ]; then
    existing_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$existing_pid" ] && kill -0 "$existing_pid" >/dev/null 2>&1; then
      found_existing=1
      echo "Instância anterior detectada (PID $existing_pid). Finalizando..."
      terminate_pid "$existing_pid"
    fi
    rm -f "$PID_FILE"
  fi

  if command -v lsof >/dev/null 2>&1; then
    while IFS= read -r listening_pid; do
      [ -n "$listening_pid" ] || continue
      found_existing=1
      echo "Processo escutando na porta $WEBSITE_PORT detectado (PID $listening_pid). Finalizando..."
      terminate_pid "$listening_pid"
    done < <(lsof -tiTCP:"$WEBSITE_PORT" -sTCP:LISTEN 2>/dev/null || true)
  fi

  if [ "$found_existing" -eq 1 ]; then
    echo "Reinicialização completa concluída. Subindo ambiente novamente..."
    echo ""
  fi
}

cd "$ROOT_DIR"

if [ ! -d "$WEBSITE_DIR/node_modules" ]; then
  echo "Dependências do website não encontradas. Instalando..."
  npm --prefix "$WEBSITE_DIR" install
fi

wait_for_site() {
  local retries=90
  while [ "$retries" -gt 0 ]; do
    if curl -fsS "$DEFAULT_URL" >/dev/null 2>&1; then
      return 0
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

echo ""
echo "SKINCOS • Website local"
echo "Iniciando ambiente local em $DEFAULT_URL"
echo "Host: $WEBSITE_HOST"
echo "Porta: $WEBSITE_PORT"
echo ""
echo "URLs:"
echo "  Local  : $DEFAULT_URL"
echo "  Rede   : $NETWORK_URL"
echo ""

stop_existing_site

if [ "${OPEN_BROWSER:-1}" = "1" ]; then
  (
    if wait_for_site; then
      open_browser
    else
      echo "O site não respondeu em $DEFAULT_URL dentro do tempo esperado."
    fi
  ) &
fi

npm --prefix "$WEBSITE_DIR" run dev -- --hostname "$WEBSITE_HOST" --port "$WEBSITE_PORT" &
SERVER_PID=$!

echo "$SERVER_PID" > "$PID_FILE"

cleanup() {
  if [ -f "$PID_FILE" ]; then
    local tracked_pid
    tracked_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ "$tracked_pid" = "$SERVER_PID" ]; then
      rm -f "$PID_FILE"
    fi
  fi
}

trap cleanup EXIT INT TERM

wait "$SERVER_PID"
