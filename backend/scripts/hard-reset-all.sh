#!/usr/bin/env bash
# Unified orchestrator: stop everything cleanly, then start everything again
# Modules: Agent Zero (a0), CRM (crm), WhatsApp (official preferred; legacy gateway/stub fallback),
# Actual Server, Sales Chart Messenger, (optional) instagrapi (vendorizado em social/instagram)
#
# Usage examples:
#   scripts/hard-reset-all.sh                 # default: restart all with sane defaults
#   scripts/hard-reset-all.sh --stop          # only stop
#   scripts/hard-reset-all.sh --start         # only start
#   INSTANCES=1,2 scripts/hard-reset-all.sh   # restart WA instances 1 and 2 (ports 3001/3002)
#   CRM_PORT=5173 CRM_API_PORT=8099 scripts/hard-reset-all.sh
#
# Notes:
# - Uses existing module scripts when available; falls back to best-effort process/port stops.
# - Avoids long-running foreground processes; starts services in background where applicable.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
. "$ROOT_DIR/backend/scripts/env.sh"
CRM_DIR="$ROOT_DIR/crm/console"
A0_DIR="$ROOT_DIR/backend/apps/agent-zero"
IG_DIR="$ROOT_DIR/social/instagram/instagrapi"
IG_MODULE_DIR="$ROOT_DIR/social/instagram/module"

WA_OFFICIAL_DIR="$ROOT_DIR/messaging/channels/whatsapp/official-module"
WA_LEGACY_DIR="$ROOT_DIR/messaging/channels/whatsapp/gateway"
WA_STUB_DIR="$ROOT_DIR/messaging/channels/whatsapp/stub"
ACTUAL_DIR="$ROOT_DIR/backend/apps/actual-server"

# Config via env or defaults
CRM_PORT=${CRM_PORT:-5173}
CRM_API_PORT=${CRM_API_PORT:-8099}
INSTANCES_CSV=${INSTANCES:-1} # WhatsApp instances (comma-separated)
ACTUAL_PORT=${ACTUAL_PORT:-5006}
INSTAGRAM_PORT=${INSTAGRAM_PORT:-3103}

# Prefer official module unless explicitly disabled
USE_OFFICIAL=${USE_OFFICIAL:-}
if [[ -z "${USE_OFFICIAL}" ]]; then
  if [[ -d "$WA_OFFICIAL_DIR" ]]; then USE_OFFICIAL=1; else USE_OFFICIAL=0; fi
fi

ACTION="restart"

color() { local c="$1"; shift; printf "\033[%sm%s\033[0m\n" "$c" "$*"; }
log() { color "1;34" "[all] $*"; }
warn() { color "1;33" "[all] WARN: $*"; }
err() { color "1;31" "[all] ERROR: $*"; }

usage() {
  cat <<EOF
Usage: $(basename "$0") [--stop|--start|--restart] [--instances 1,2] [--crm-port N] [--crm-api-port N]

Environment variables:
  INSTANCES      Comma-separated WA instances (default: 1)
  CRM_PORT       CRM Frontend port (default: 5173)
  CRM_API_PORT   CRM API port (default: 8099)
  USE_OFFICIAL   1 = force official module, 0 = force legacy gateway/stub (default: auto)

Examples:
  $(basename "$0") --restart
  INSTANCES=1,2 $(basename "$0")
  CRM_PORT=5174 CRM_API_PORT=8098 $(basename "$0") --start
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stop) ACTION="stop" ;;
    --start) ACTION="start" ;;
    --restart) ACTION="restart" ;;
    --instances) shift; INSTANCES_CSV="${1:-1}" ;;
    --crm-port) shift; CRM_PORT="${1:-$CRM_PORT}" ;;
    --crm-api-port) shift; CRM_API_PORT="${1:-$CRM_API_PORT}" ;;
    -h|--help) usage; exit 0 ;;
    *) err "Unknown option: $1"; usage; exit 1 ;;
  esac
  shift || true
done

IFS=',' read -r -a WA_INSTANCES <<<"$INSTANCES_CSV"

has() { command -v "$1" >/dev/null 2>&1; }
kill_port() {
  local p="$1"
  if lsof -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
    # shellcheck disable=SC2046
    kill -9 $(lsof -ti tcp:"$p") 2>/dev/null || true
  fi
}

safe_kill_pidfile() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  local real="$f"
  if [[ -L "$f" ]]; then
    real="$(readlink "$f" 2>/dev/null || echo "$f")"
    if [[ "$real" != /* ]]; then
      real="$(cd "$(dirname "$f")" && cd "$(dirname "$real")" >/dev/null 2>&1 || true; pwd)/$(basename "$real")"
    fi
  fi
  local pid
  pid="$(cat "$f" 2>/dev/null || true)"
  if [[ -n "$pid" && "$pid" =~ ^[0-9]+$ ]]; then
    if kill -0 "$pid" 2>/dev/null; then kill "$pid" 2>/dev/null || true; fi
  fi
  rm -f "$f" 2>/dev/null || true
  [[ "$real" != "$f" ]] && rm -f "$real" 2>/dev/null || true
}

stop_whatsapp() {
  log "Stopping WhatsApp instances: ${WA_INSTANCES[*]} (ports 3000+N)"
  for i in "${WA_INSTANCES[@]}"; do
    local port=$((3000 + i))
    safe_kill_pidfile "$WA_OFFICIAL_DIR/.local_official_${i}.pid"
    safe_kill_pidfile "$WA_LEGACY_DIR/.local_instance_${i}.pid"
    safe_kill_pidfile "$WA_STUB_DIR/.local_instance_${i}.pid"
    kill_port "$port"
    # Remove stale Chrome SingletonLock for legacy gateway/stub profiles
    local profile_dir="$WA_LEGACY_DIR/.chrome_profile_${port}"
    if [[ -f "$profile_dir/SingletonLock" ]]; then rm -f "$profile_dir/SingletonLock" || true; fi
    local stub_profile_dir="$WA_STUB_DIR/.chrome_profile_${port}"
    if [[ -f "$stub_profile_dir/SingletonLock" ]]; then rm -f "$stub_profile_dir/SingletonLock" || true; fi
  done
}

start_whatsapp() {
  log "Starting WhatsApp instances: ${WA_INSTANCES[*]} (USE_OFFICIAL=$USE_OFFICIAL)"
  local official_script="$ROOT_DIR/backend/scripts/dev.sh"
  local legacy_script="$ROOT_DIR/backend/scripts/dev.sh"

  if [[ "$USE_OFFICIAL" == "1" && -d "$WA_OFFICIAL_DIR" && -x "$official_script" ]]; then
    for i in "${WA_INSTANCES[@]}"; do
      "$official_script" official --instance "$i" --quiet || true
    done
    return 0
  fi

  if [[ -x "$legacy_script" ]]; then
    for i in "${WA_INSTANCES[@]}"; do
      "$legacy_script" gateway --instance "$i" --quiet || true
    done
    return 0
  fi

  warn "No WhatsApp start script found (expected $official_script or $legacy_script)"
}

stop_crm() {
  log "Stopping CRM (ports :$CRM_PORT :$CRM_API_PORT)"
  kill_port "$CRM_PORT"
  kill_port "$CRM_API_PORT"
  pkill -f "vite.*\\bcrm\\b" 2>/dev/null || true
  pkill -f "nodemon.*\\bcrm\\b" 2>/dev/null || true
}

start_crm() {
  log "Starting CRM (FE+API watch)"
  local s="$CRM_DIR/restart_crm.sh"
  if [[ -x "$s" ]]; then
    mkdir -p "$CRM_DIR/logs" 2>/dev/null || true
    nohup "$s" --watch-full --crm-port "$CRM_PORT" --crm-api-port "$CRM_API_PORT" \
      >>"$CRM_DIR/logs/orchestrator_crm.out" 2>&1 &
  else
    warn "CRM restart script not found at $s"
  fi
}

stop_agent() {
  log "Stopping Agent Zero (best-effort via PID files)"
  safe_kill_pidfile "$VAR_DIR/pids/agent-zero.pid"
  for pf in "$A0_DIR/worker.pid" "$A0_DIR/daemon.pid" "$A0_DIR/ui_test.pid" "$A0_DIR/gw.pid" "$A0_DIR/worker_only.pid"; do
    safe_kill_pidfile "$pf"
  done
  pkill -f "python.*a0/run_ui.py" 2>/dev/null || true
  pkill -f "python.*a0/webhook_server.py" 2>/dev/null || true
  pkill -f "python.*apps/agent-zero/run_ui.py" 2>/dev/null || true
  pkill -f "python.*apps/agent-zero/webhook_server.py" 2>/dev/null || true
}

stop_actual_server() {
  if [[ ! -d "$ACTUAL_DIR" ]]; then
    return 0
  fi
  log "Stopping Actual Server (port :$ACTUAL_PORT)"
  safe_kill_pidfile "$VAR_DIR/pids/actual-server.pid"
  kill_port "$ACTUAL_PORT"
  pkill -f "backend/apps/actual-server" 2>/dev/null || true
}

start_actual_server() {
  if [[ ! -d "$ACTUAL_DIR" ]]; then
    warn "Actual Server not found at $ACTUAL_DIR"
    return 0
  fi

  log "Starting Actual Server (port :$ACTUAL_PORT)"

  local out="$VAR_DIR/logs/actual-server/actual_server.out"
  local pidfile="$VAR_DIR/pids/actual-server.pid"
  mkdir -p "$(dirname "$out")" >/dev/null 2>&1 || true

  kill_port "$ACTUAL_PORT"
  safe_kill_pidfile "$pidfile"

  local server_files_repo="$ACTUAL_DIR/server-files"
  local server_files_var="$VAR_DIR/actual-server/server-files"
  local server_files="$server_files_var"
  if [[ -d "$server_files_repo" ]]; then
    if ls -A "$server_files_repo" >/dev/null 2>&1; then
      server_files="$server_files_repo"
    fi
  fi
  mkdir -p "$server_files" >/dev/null 2>&1 || true

  (
    cd "$ACTUAL_DIR"
    export ACTUAL_PORT="$ACTUAL_PORT"
    export ACTUAL_HOSTNAME="${ACTUAL_HOSTNAME:-0.0.0.0}"
    export ACTUAL_SERVER_FILES="${ACTUAL_SERVER_FILES:-$server_files}"
    nohup bash ./start-actual-budget.sh >"$out" 2>&1 &
    echo $! > "$pidfile"
  )
}

start_agent() {
  local agent_port="${AGENT_ZERO_PORT:-${WEB_UI_PORT:-50001}}"
  log "Starting Agent Zero (UI) on :$agent_port"

  local out="$VAR_DIR/logs/agent-zero/agent_ui.out"
  local pidfile="$VAR_DIR/pids/agent-zero.pid"
  mkdir -p "$(dirname "$out")" >/dev/null 2>&1 || true

  safe_kill_pidfile "$pidfile"
  kill_port "$agent_port"

  local py="python"
  if has python3; then py="python3"; fi
  if ! [[ -f "$A0_DIR/run_ui.py" ]]; then
    warn "Agent Zero entrypoint not found at $A0_DIR/run_ui.py"
    return 0
  fi

  export WHATSAPP_BASE_URL="${WHATSAPP_BASE_URL:-http://localhost:3001}"
  nohup "$py" "$A0_DIR/run_ui.py" --port "$agent_port" >"$out" 2>&1 &
  echo $! > "$pidfile"
}

stop_sales_chart_messenger() {
  log "Stopping Sales Chart Messenger (best-effort)"
  safe_kill_pidfile "$VAR_DIR/pids/sales_chart_messenger.pid"
  safe_kill_pidfile "$VAR_DIR/pids/sales_chart_messenger_stub.pid"
  pkill -f "python.*-m apps\\.automations\\.sales_chart_messenger" 2>/dev/null || true
}

start_sales_chart_messenger() {
  log "Starting Sales Chart Messenger"
  local out="$VAR_DIR/logs/whatsapp/sales_chart_messenger/sales_chart_messenger.out"
  local pidfile="$VAR_DIR/pids/sales_chart_messenger.pid"
  mkdir -p "$(dirname "$out")" >/dev/null 2>&1 || true

  if [[ -x "$ROOT_DIR/backend/apps/automations/sales_chart_messenger/scripts/run.sh" ]]; then
    nohup bash "$ROOT_DIR/backend/apps/automations/sales_chart_messenger/scripts/run.sh" diagnose >"$out" 2>&1 &
    echo $! > "$pidfile"
    return 0
  fi

  local py="python"
  if has python3; then py="python3"; fi
  if has "$py"; then
    nohup "$py" -m apps.automations.sales_chart_messenger --mode diagnose >"$out" 2>&1 &
    echo $! > "$pidfile"
    return 0
  fi

  warn "Sales Chart Messenger entrypoint not found (expected backend/apps/automations/sales_chart_messenger/scripts/run.sh)"
}

stop_instagram_module() {
  if [[ ! -d "$IG_MODULE_DIR" ]]; then
    return 0
  fi
  log "Stopping Instagram Module (port :$INSTAGRAM_PORT)"
  safe_kill_pidfile "$VAR_DIR/pids/instagram-module.pid"
  kill_port "$INSTAGRAM_PORT"
  pkill -f "instagram_api_server\\.js" 2>/dev/null || true
}

start_instagram_module() {
  if [[ ! -d "$IG_MODULE_DIR" ]]; then
    warn "Instagram Module not found at $IG_MODULE_DIR"
    return 0
  fi
  if [[ ! -f "$IG_MODULE_DIR/instagram_api_server.js" ]]; then
    warn "Instagram Module entrypoint not found at $IG_MODULE_DIR/instagram_api_server.js"
    return 0
  fi
  if [[ ! -f "$IG_MODULE_DIR/package.json" ]]; then
    warn "Instagram Module package.json not found at $IG_MODULE_DIR/package.json"
    return 0
  fi

  log "Starting Instagram Module (port :$INSTAGRAM_PORT)"

  local out="$VAR_DIR/logs/instagram-module/instagram_module.out"
  local pidfile="$VAR_DIR/pids/instagram-module.pid"
  mkdir -p "$(dirname "$out")" >/dev/null 2>&1 || true

  kill_port "$INSTAGRAM_PORT"
  safe_kill_pidfile "$pidfile"

  if [[ ! -d "$IG_MODULE_DIR/node_modules" ]]; then
    warn "Instagram Module deps not installed; running bootstrap..."
    bash "$ROOT_DIR/backend/scripts/bootstrap.sh" --module instagram-module >/dev/null 2>&1 || true
  fi

  (
    cd "$IG_MODULE_DIR"
    export INSTAGRAM_PORT="$INSTAGRAM_PORT"
    nohup node "$IG_MODULE_DIR/instagram_api_server.js" >"$out" 2>&1 &
    echo $! > "$pidfile"
  )
}

stop_instagrapi() {
  stop_instagram_module
}

start_instagrapi() { :; }

verify_tools() {
  log "Verifying local tools (node, npm, python3)"
  for t in node npm python3; do
    if ! has "$t"; then warn "$t not found in PATH"; fi
  done
}

print_summary() {
  echo ""
  color "1;32" "Done: $ACTION completed"
  echo "- CRM FE: http://localhost:$CRM_PORT (if started)"
  echo "- CRM API: http://localhost:$CRM_API_PORT (if started)"
  for i in "${WA_INSTANCES[@]}"; do echo "- WA[$i]: http://localhost:$((3000 + i))"; done
  echo "- Agent Zero: http://localhost:${AGENT_ZERO_PORT:-${WEB_UI_PORT:-50001}}"
  echo "- Actual: http://localhost:$ACTUAL_PORT"
  echo "- Instagram Module: http://localhost:$INSTAGRAM_PORT"
}

main() {
  verify_tools || true
  case "$ACTION" in
    stop)
      stop_whatsapp; stop_crm; stop_agent; stop_actual_server; stop_sales_chart_messenger; stop_instagram_module ;;
    start)
      start_agent; start_crm; start_whatsapp; start_actual_server; start_sales_chart_messenger; start_instagram_module ;;
    restart)
      stop_whatsapp; stop_crm; stop_agent; stop_actual_server; stop_sales_chart_messenger; stop_instagram_module
      sleep 0.5
      start_agent; start_crm; start_whatsapp; start_actual_server; start_sales_chart_messenger; start_instagram_module ;;
  esac
  print_summary
}

main "$@"
