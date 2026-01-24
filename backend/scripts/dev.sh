#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
. "$ROOT_DIR/backend/scripts/env.sh"
. "$ROOT_DIR/backend/scripts/node_pkg.sh"
RESET="$ROOT_DIR/backend/scripts/hard-reset-all.sh"
E2E="$ROOT_DIR/backend/scripts/e2e.sh"

usage() {
  cat <<EOF
SKINCOS dev helper

Usage: $(basename "$0") <command> [args]

Commands:
  restart           Stop everything and start again (default)
  start             Start all modules
  stop              Stop all modules
  watch             Start CRM + WhatsApp + Actual + Agent + Instagram (foreground)
  crm               Start only CRM (frontend+api)
  insumos            Insumos (Cloudflare Worker) helper
  cloudflare-workers Cloudflare Workers deploy helper
  gateway           Start WhatsApp gateway watcher
  official          Start WhatsApp official watcher
  agent             Start Agent Zero (webui)
  sales-chart-messenger Run Sales Chart Messenger (default: diagnose)
  sales-chart-messenger-stub Start Sales Chart Messenger stub service
  instagram-module  Start Instagram Module API (start|stop|logs)
  scraper           Run Scraper module
  sprinta           Run Sprinta (legacy|v2)
  scheduled-posting Run scheduled posting automation
  xiaomi-token      Run Xiaomi Token Extractor
  actual-server     Start Actual Server helper (menu|start)
  e2e smoke         Run smoke checks (real gateway instances)
  e2e ci-smoke      Run CI mock smoke checks
  e2e health        Run repo health checks

Environment variables (forwarded when applicable):
  INSTANCES         Comma-separated WhatsApp instances, e.g., 1,2 (default: 1)
  CRM_PORT          CRM FE port (default: 5173)
  CRM_API_PORT      CRM API port (default: 8099)
  USE_OFFICIAL      1 = force official module, 0 = force legacy gateway/stub (default: auto)

Examples:
  $(basename "$0")                       # restart all
  INSTANCES=1,2 $(basename "$0") restart
  $(basename "$0") watch
  $(basename "$0") crm --watch-full
  $(basename "$0") official --instance 1
  $(basename "$0") e2e smoke
EOF
}

kill_port() {
  local p="$1"
  if command -v lsof >/dev/null 2>&1; then
    if lsof -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "[dev] Killing processes on :$p..."
      # shellcheck disable=SC2046
      kill -9 $(lsof -ti tcp:"$p") 2>/dev/null || true
      sleep 0.2
    fi
  fi
}

find_chrome() {
  if [[ -n "${CHROMIUM_EXECUTABLE_PATH:-}" && -x "${CHROMIUM_EXECUTABLE_PATH}" ]]; then
    echo "$CHROMIUM_EXECUTABLE_PATH"
    return 0
  fi
  local mac_chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  if [[ -x "$mac_chrome" ]]; then
    echo "$mac_chrome"
    return 0
  fi
  for bin in chromium chromium-browser google-chrome google-chrome-stable chrome; do
    if command -v "$bin" >/dev/null 2>&1; then
      command -v "$bin"
      return 0
    fi
  done
  return 1
}

maybe_open_url() {
  local url="$1"
  local enabled="${OPEN_BROWSER:-${SKINCOS_OPEN_BROWSER:-1}}"
  if [[ "${enabled}" != "1" && "${enabled}" != "true" && "${enabled}" != "yes" ]]; then
    return 0
  fi
  if command -v open >/dev/null 2>&1; then
    open "$url" >/dev/null 2>&1 || true
    return 0
  fi
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 || true
    return 0
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 -m webbrowser "$url" >/dev/null 2>&1 || true
    return 0
  fi
  return 0
}

start_whatsapp_official() {
  local instance="$1"
  local quiet="${2:-0}"

  local OFFICIAL_DIR="$ROOT_DIR/backend/apps/whatsapp/official-module"
  local WEBJS_DIR="$ROOT_DIR/backend/apps/whatsapp/official"

  if [[ ! -d "$OFFICIAL_DIR" ]]; then
    echo "[official] Official module not found at $OFFICIAL_DIR" >&2
    return 1
  fi
  if ! [[ "$instance" =~ ^[1-9]$ ]]; then
    echo "[official] Invalid instance: $instance (must be 1..9)" >&2
    return 1
  fi

  local port=$((3000 + instance))
  local pid_file="$VAR_DIR/pids/whatsapp_official_${instance}.pid"
  local log_dir="$VAR_DIR/logs/whatsapp/official/instance-$instance"
  mkdir -p "$log_dir" >/dev/null 2>&1 || true
  local log_file="$log_dir/local_official_${instance}.out"

  kill_port "$port"
  if [[ -f "$pid_file" ]]; then
    local old_pid
    old_pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ -n "${old_pid:-}" ]] && ps -p "$old_pid" >/dev/null 2>&1; then
      echo "[official] Stopping previous process (pid $old_pid)"
      kill "$old_pid" 2>/dev/null || true
      sleep 0.2
    fi
    rm -f "$pid_file" 2>/dev/null || true
  fi

  (
    cd "$OFFICIAL_DIR"

    if [[ ! -d node_modules ]]; then
      echo "[official] Installing deps (official-module)..."
      install_node_deps "$OFFICIAL_DIR" install >/dev/null 2>&1 || true
    fi

    if [[ -d "$WEBJS_DIR" && -f "$WEBJS_DIR/package.json" ]]; then
      if [[ ! -d "$WEBJS_DIR/node_modules/puppeteer" ]]; then
        echo "[official] Installing deps (whatsapp/official, PUPPETEER_SKIP_DOWNLOAD=1)..."
        (
          cd "$WEBJS_DIR"
          export PUPPETEER_SKIP_DOWNLOAD=1
          install_node_deps "$WEBJS_DIR" install >/dev/null 2>&1 || true
        )
      fi
    fi

    if CHROME_BIN=$(find_chrome); then
      export CHROMIUM_EXECUTABLE_PATH="$CHROME_BIN"
      echo "[official] Using Chromium executable: $CHROME_BIN"
    else
      echo "[official] WARN: Could not auto-detect Chrome/Chromium. Puppeteer may fail to launch."
    fi

    local -a nodemon_cmd
    nodemon_cmd=(run_pnpm exec nodemon)
    if ! run_pnpm exec nodemon --version >/dev/null 2>&1; then
      nodemon_cmd=(run_pnpm dlx nodemon)
    fi

    local -a nodemon_flags=(
      --watch official-whatsapp.js
      --watch extensions
      --watch middleware
      --ext js,json
    )
    [[ "$quiet" == "1" ]] && nodemon_flags=(--quiet "${nodemon_flags[@]}")

    echo "[official] Starting (instance $instance) on :$port..."
    local wa_var="$VAR_DIR/whatsapp/official/instance-$instance"
    mkdir -p "$wa_var" >/dev/null 2>&1 || true

    export WHATSAPP_CLIENT_ID="${WHATSAPP_CLIENT_ID:-whatsapp-official-$instance}"
    export WHATSAPP_DATA_PATH="${WHATSAPP_DATA_PATH:-$wa_var/auth}"
    export WHATSAPP_USER_DATA_DIR="${WHATSAPP_USER_DATA_DIR:-$wa_var/chrome}"
    export WHATSAPP_MASTER_KEY_FILE="${WHATSAPP_MASTER_KEY_FILE:-$wa_var/master-key}"
    export VAR_DIR

    export PORT="$port"
    export WHATSAPP_PORT="$port"
    export NODE_ENV="development"
    export NO_AUTH=true
    "${nodemon_cmd[@]}" "${nodemon_flags[@]}" official-whatsapp.js >"$log_file" 2>&1 &
    echo $! > "$pid_file"
  )

  sleep 1
  if command -v curl >/dev/null 2>&1; then
    if curl -sf "http://localhost:$port/health" >/dev/null 2>&1; then
      echo "[official] OK: http://localhost:$port"
    else
      echo "[official] WARN: not responding yet on :$port"
    fi
  fi
  echo "[official] PID: $(cat "$pid_file" 2>/dev/null || echo "?") | Logs: $log_file"
}

start_whatsapp_gateway() {
  local instance="$1"
  local quiet="${2:-0}"

  local GW_DIR="$ROOT_DIR/backend/apps/whatsapp/gateway"
  local STUB_DIR="$ROOT_DIR/backend/apps/whatsapp/stub"

  if ! [[ "$instance" =~ ^[1-9]$ ]]; then
    echo "[gateway] Invalid instance: $instance (must be 1..9)" >&2
    return 1
  fi

  local port=$((3000 + instance))
  local pid_file="$VAR_DIR/pids/whatsapp_gateway_${instance}.pid"
  local log_dir="$VAR_DIR/logs/whatsapp/gateway/instance-$instance"
  mkdir -p "$log_dir" >/dev/null 2>&1 || true
  local log_file="$log_dir/local_${instance}.out"
  local wa_var="$VAR_DIR/whatsapp/gateway/instance-$instance"
  local profile_dir_repo="$GW_DIR/.chrome_profile_${port}"
  local profile_dir_var="${WWJS_PROFILE_DIR:-$wa_var/chrome-profile}"

  local use_stub=0
  if [[ ! -d "$GW_DIR" ]]; then
    echo "[gateway] WhatsApp gateway not found at $GW_DIR"
    if [[ -f "$STUB_DIR/bot_com_api.js" ]]; then
      echo "[gateway] Falling back to stub gateway at $STUB_DIR/bot_com_api.js"
      use_stub=1
    else
      echo "[gateway] No stub available either. Exiting." >&2
      return 1
    fi
  fi

  kill_port "$port"
  if [[ -f "$pid_file" ]]; then
    local old_pid
    old_pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ -n "${old_pid:-}" ]] && ps -p "$old_pid" >/dev/null 2>&1; then
      echo "[gateway] Stopping previous process (pid $old_pid)"
      kill "$old_pid" 2>/dev/null || true
      sleep 0.2
    fi
    rm -f "$pid_file" 2>/dev/null || true
  fi

  if [[ $use_stub -eq 1 ]]; then
    pid_file="$VAR_DIR/pids/whatsapp_stub_${instance}.pid"
    log_dir="$VAR_DIR/logs/whatsapp/stub/instance-$instance"
    mkdir -p "$log_dir" >/dev/null 2>&1 || true
    log_file="$log_dir/local_${instance}.out"
    wa_var="$VAR_DIR/whatsapp/stub/instance-$instance"
    profile_dir_repo="$STUB_DIR/.chrome_profile_${port}"
    profile_dir_var="${WWJS_PROFILE_DIR:-$wa_var/chrome-profile}"
    cd "$STUB_DIR"
  else
    cd "$GW_DIR"
  fi

  if [[ $use_stub -eq 0 ]]; then
    if [[ ! -d "$GW_DIR/node_modules" ]]; then
      echo "[gateway] Installing gateway deps (pnpm)..."
      install_node_deps "$GW_DIR" install >/dev/null 2>&1 || true
    fi
  fi

  for profile in "$profile_dir_var" "$profile_dir_repo"; do
    if [[ -d "$profile" && -f "$profile/SingletonLock" ]]; then
      echo "[gateway] Removing stale Chrome SingletonLock at $profile/SingletonLock"
      rm -f "$profile/SingletonLock" 2>/dev/null || true
    fi
  done

  local -a nodemon_flags=(
    --watch bot_com_api.js
    --watch storage
    --watch utils
    --watch media_helper.js
    --watch video_optimizer.js
    --ext js,json
  )
  [[ "$quiet" == "1" ]] && nodemon_flags=(--quiet "${nodemon_flags[@]}")

  (
    mkdir -p "$wa_var" >/dev/null 2>&1 || true

    export PORT="$port"
    export ACCOUNT_ID="$port"
    export WWJS_AUTH_PATH="${WWJS_AUTH_PATH:-$wa_var/auth}"
    export WWJS_PROFILE_DIR="${WWJS_PROFILE_DIR:-$wa_var/chrome-profile}"
    export PERSIST_DIR="${PERSIST_DIR:-$wa_var/storage}"
    export WA_CONTEXT_STORE_PATH="${WA_CONTEXT_STORE_PATH:-$wa_var/context_store.json}"

    if [[ $use_stub -eq 1 ]]; then
      echo "[gateway] Starting STUB (instance $instance) on :$port..."
      npx --yes nodemon --quiet bot_com_api.js >"$log_file" 2>&1 &
      echo $! > "$pid_file"
    else
      echo "[gateway] Starting (instance $instance) on :$port..."
      local -a nodemon_cmd
      nodemon_cmd=(run_pnpm exec nodemon)
      if ! run_pnpm exec nodemon --version >/dev/null 2>&1; then
        nodemon_cmd=(run_pnpm dlx nodemon)
      fi
      "${nodemon_cmd[@]}" "${nodemon_flags[@]}" bot_com_api.js >"$log_file" 2>&1 &
      echo $! > "$pid_file"
    fi
  )

  sleep 1
  if command -v curl >/dev/null 2>&1; then
    if curl -sf "http://localhost:$port/health" >/dev/null 2>&1; then
      echo "[gateway] OK: http://localhost:$port"
    else
      echo "[gateway] WARN: not responding yet on :$port"
    fi
  fi
  echo "[gateway] PID: $(cat "$pid_file" 2>/dev/null || echo "?") | Logs: $log_file"
}

cmd_watch() {
  local crm_dir="$ROOT_DIR/frontend"
  local crm_port="${CRM_PORT:-5173}"
  local crm_api_port="${CRM_API_PORT:-8099}"
  local instances="${INSTANCES:-${GW_INSTANCE:-1}}"
  local actual_port="${ACTUAL_PORT:-5006}"
  local agent_port="${AGENT_ZERO_PORT:-${WEB_UI_PORT:-50001}}"
  local instagram_port="${INSTAGRAM_PORT:-3103}"

  local use_official="${USE_OFFICIAL:-}"
  local official_dir="$ROOT_DIR/backend/apps/whatsapp/official-module"
  if [[ -z "${use_official}" ]]; then
    [[ -d "$official_dir" ]] && use_official=1 || use_official=0
  fi

  echo "[dev] Pre-clean: killing common dev ports (safe best-effort)"
  kill_port "$crm_port"
  kill_port "$crm_api_port"
  kill_port "$actual_port"
  kill_port "$agent_port"
  kill_port "$instagram_port"
  for p in 3001 3002 3003 3004 3005 3006 3007 3008 3009; do kill_port "$p"; done
  pkill -f "backend/apps/crm-api/server.js" 2>/dev/null || true
  pkill -f "vite --port $crm_port" 2>/dev/null || true

  echo "[dev] Starting CRM (API+FE) in watch-full mode..."
  WA_INSTANCES_FILE="${WA_INSTANCES_FILE:-$VAR_DIR/core/whatsapp_instances.json}" \
  CRM_WA_INSTANCES_META="${CRM_WA_INSTANCES_META:-$VAR_DIR/core/wa_instances_meta.json}" \
  NO_AUTH=true \
    "$crm_dir/restart_crm.sh" --watch-full --crm-port "$crm_port" --crm-api-port "$crm_api_port" &
  local crm_pid=$!

  # Start Actual Server in background (active module)
  local actual_dir="$ROOT_DIR/backend/apps/actual-server"
  if [[ -d "$actual_dir" ]]; then
    local pid_file="$VAR_DIR/pids/actual-server.pid"
    local log_dir="$VAR_DIR/logs/actual-server"
    mkdir -p "$log_dir" >/dev/null 2>&1 || true
    local log_file="$log_dir/actual_server_watch.out"
    if [[ -f "$pid_file" ]]; then
      local old_pid
      old_pid="$(cat "$pid_file" 2>/dev/null || true)"
      if [[ -n "${old_pid:-}" ]] && ps -p "$old_pid" >/dev/null 2>&1; then
        echo "[actual-server] Stopping previous process (pid $old_pid)"
        kill "$old_pid" 2>/dev/null || true
        sleep 0.2
      fi
      rm -f "$pid_file" 2>/dev/null || true
    fi

    local server_files_repo="$actual_dir/server-files"
    local server_files_var="$VAR_DIR/actual-server/server-files"
    local server_files="$server_files_var"
    if [[ -d "$server_files_repo" ]]; then
      if ls -A "$server_files_repo" >/dev/null 2>&1; then
        server_files="$server_files_repo"
      fi
    fi
    mkdir -p "$server_files" >/dev/null 2>&1 || true

    (
      cd "$actual_dir"
      export ACTUAL_PORT="$actual_port"
      export ACTUAL_HOSTNAME="${ACTUAL_HOSTNAME:-0.0.0.0}"
      export ACTUAL_SERVER_FILES="${ACTUAL_SERVER_FILES:-$server_files}"
      nohup bash ./start-actual-budget.sh >"$log_file" 2>&1 &
      echo $! > "$pid_file"
    )
    local actual_pid
    actual_pid="$(cat "$pid_file" 2>/dev/null || echo "?")"
    echo "[actual-server] Started: http://localhost:$actual_port | PID: $actual_pid | Logs: $log_file"
  else
    echo "[actual-server] Not found at $actual_dir (skipping)"
  fi

  echo "[dev] Starting WhatsApp watchers (instances: $instances)..."
  IFS=',' read -r -a arr <<<"$instances"
  for inst in "${arr[@]}"; do
    inst="${inst//[[:space:]]/}"
    [[ -n "$inst" ]] || continue
    if [[ "$use_official" == "1" ]]; then
      start_whatsapp_official "$inst" 0 || true
    else
      start_whatsapp_gateway "$inst" 0 || true
    fi
  done

  # Start Agent Zero in background (active module)
  local agent_dir="$ROOT_DIR/backend/apps/agent-zero"
  if [[ -d "$agent_dir" && -f "$agent_dir/run_ui.py" ]]; then
    local pid_file="$VAR_DIR/pids/agent-zero.pid"
    local log_dir="$VAR_DIR/logs/agent-zero"
    mkdir -p "$log_dir" >/dev/null 2>&1 || true
    local log_file="$log_dir/agent_zero_watch.out"

    if [[ -f "$pid_file" ]]; then
      local old_pid
      old_pid="$(cat "$pid_file" 2>/dev/null || true)"
      if [[ -n "${old_pid:-}" ]] && ps -p "$old_pid" >/dev/null 2>&1; then
        echo "[agent-zero] Stopping previous process (pid $old_pid)"
        kill "$old_pid" 2>/dev/null || true
        sleep 0.2
      fi
      rm -f "$pid_file" 2>/dev/null || true
    fi

    export WHATSAPP_BASE_URL="${WHATSAPP_BASE_URL:-http://localhost:3001}"
    if command -v python3 >/dev/null 2>&1; then
      nohup python3 "$agent_dir/run_ui.py" --port "$agent_port" >"$log_file" 2>&1 &
    else
      nohup python "$agent_dir/run_ui.py" --port "$agent_port" >"$log_file" 2>&1 &
    fi
    echo $! > "$pid_file"
    local agent_pid
    agent_pid="$(cat "$pid_file" 2>/dev/null || echo "?")"
    echo "[agent-zero] Started: http://localhost:$agent_port | PID: $agent_pid | Logs: $log_file"
  else
    echo "[agent-zero] Not found at $agent_dir (skipping)"
  fi

  # Start Instagram Module API in background (active module)
  local ig_dir="$ROOT_DIR/backend/apps/instagram/module"
  if [[ -d "$ig_dir" && -f "$ig_dir/instagram_api_server.js" ]]; then
    local pid_file="$VAR_DIR/pids/instagram-module.pid"
    local log_dir="$VAR_DIR/logs/instagram-module"
    mkdir -p "$log_dir" >/dev/null 2>&1 || true
    local log_file="$log_dir/instagram_module_watch.out"

    if [[ -f "$pid_file" ]]; then
      local old_pid
      old_pid="$(cat "$pid_file" 2>/dev/null || true)"
      if [[ -n "${old_pid:-}" ]] && ps -p "$old_pid" >/dev/null 2>&1; then
        echo "[instagram] Stopping previous process (pid $old_pid)"
        kill "$old_pid" 2>/dev/null || true
        sleep 0.2
      fi
      rm -f "$pid_file" 2>/dev/null || true
    fi

    kill_port "$instagram_port"

    if [[ -f "$ig_dir/package.json" && ! -d "$ig_dir/node_modules" ]]; then
      echo "[instagram] Installing deps (auto)..."
      install_node_deps "$ig_dir" install >/dev/null 2>&1 || true
    fi

    (
      cd "$ig_dir"
      export INSTAGRAM_PORT="$instagram_port"
      nohup node "$ig_dir/instagram_api_server.js" >"$log_file" 2>&1 &
      echo $! > "$pid_file"
    )

    local ig_pid
    ig_pid="$(cat "$pid_file" 2>/dev/null || echo "?")"
    echo "[instagram] Started: http://localhost:$instagram_port | PID: $ig_pid | Logs: $log_file"
  else
    echo "[instagram] Not found at $ig_dir (skipping)"
  fi

  echo "[dev] Started: CRM_PID=$crm_pid | FE: http://localhost:$crm_port | API: http://localhost:$crm_api_port"
  ( sleep 1; maybe_open_url "http://localhost:$crm_port/?module=capabilities" ) &
  echo "[dev] Tailing a few seconds of latest CRM logs..."
  local crm_web_log="$VAR_DIR/logs/crm/crm_web.out"
  if [[ -f "$crm_dir/logs/crm_web.out" ]]; then
    crm_web_log="$crm_dir/logs/crm_web.out"
  fi
  ( sleep 2; tail -n 50 "$crm_web_log" || true ) &

  wait "$crm_pid"
}

cmd=${1:-restart}
shift || true

case "$cmd" in
  restart)
    exec "$RESET" --restart "$@" ;;
  start)
    exec "$RESET" --start "$@" ;;
  stop)
    exec "$RESET" --stop "$@" ;;
  watch)
    cmd_watch "$@" ;;
  crm)
    exec "$ROOT_DIR/frontend/restart_crm.sh" "$@" ;;
  insumos)
    exec "$ROOT_DIR/backend/scripts/insumos.sh" "$@" ;;
  cloudflare-workers|workers)
    exec "$ROOT_DIR/backend/scripts/cloudflare-workers.sh" "$@" ;;
  gateway)
    instance=1
    quiet=0
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --instance) shift; instance="${1:-1}" ;;
        --quiet) quiet=1 ;;
        -h|--help|help)
          echo "Usage: $(basename "$0") gateway [--instance N] [--quiet]"
          exit 0 ;;
        *) echo "[gateway] Unknown option: $1" >&2; exit 1 ;;
      esac
      shift || true
    done
    start_whatsapp_gateway "$instance" "$quiet"
    ;;
  official)
    instance=1
    quiet=0
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --instance) shift; instance="${1:-1}" ;;
        --quiet) quiet=1 ;;
        -h|--help|help)
          echo "Usage: $(basename "$0") official [--instance N] [--quiet]"
          exit 0 ;;
        *) echo "[official] Unknown option: $1" >&2; exit 1 ;;
      esac
      shift || true
    done
    start_whatsapp_official "$instance" "$quiet"
    ;;
  agent)
    AGENT_DIR="$ROOT_DIR/backend/apps/agent-zero"
    [[ -d "$AGENT_DIR" ]] || { echo "[agent-zero] Not found at $AGENT_DIR" >&2; exit 1; }
    [[ -f "$AGENT_DIR/run_ui.py" ]] || { echo "[agent-zero] run_ui.py not found at $AGENT_DIR/run_ui.py" >&2; exit 1; }

    sub=${1:-start}
    shift || true

    AGENT_PORT=${AGENT_ZERO_PORT:-${WEB_UI_PORT:-50001}}
    PID_FILE="$VAR_DIR/pids/agent-zero.pid"
    LOG_DIR="$VAR_DIR/logs/agent-zero"
    mkdir -p "$LOG_DIR" >/dev/null 2>&1 || true
    LOG_FILE="$LOG_DIR/agent_zero.out"

    case "$sub" in
      start)
        if [[ -f "$PID_FILE" ]]; then
          old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
          if [[ -n "${old_pid:-}" ]] && ps -p "$old_pid" >/dev/null 2>&1; then
            echo "[agent-zero] Already running (pid $old_pid) on :$AGENT_PORT"
            exit 0
          fi
          rm -f "$PID_FILE" 2>/dev/null || true
        fi
        kill_port "$AGENT_PORT"
        export WHATSAPP_BASE_URL="${WHATSAPP_BASE_URL:-http://localhost:3001}"
        cd "$AGENT_DIR"
        if command -v python3 >/dev/null 2>&1; then
          nohup python3 "$AGENT_DIR/run_ui.py" --port "$AGENT_PORT" >"$LOG_FILE" 2>&1 &
        else
          nohup python "$AGENT_DIR/run_ui.py" --port "$AGENT_PORT" >"$LOG_FILE" 2>&1 &
        fi
        echo $! > "$PID_FILE"
        agent_pid="$(cat "$PID_FILE" 2>/dev/null || echo "?")"
        echo "[agent-zero] Started: http://localhost:$AGENT_PORT | PID: $agent_pid | Logs: $LOG_FILE"
        ;;
      stop)
        if [[ -f "$PID_FILE" ]]; then
          old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
          if [[ -n "${old_pid:-}" ]] && ps -p "$old_pid" >/dev/null 2>&1; then
            echo "[agent-zero] Stopping (pid $old_pid)"
            kill "$old_pid" 2>/dev/null || true
            sleep 0.2
          fi
          rm -f "$PID_FILE" 2>/dev/null || true
        fi
        kill_port "$AGENT_PORT"
        ;;
      logs)
        exec tail -n 200 -f "$LOG_FILE"
        ;;
      -h|--help|help)
        cat <<EOF
Usage: $(basename "$0") agent <start|stop|logs>

Env:
  AGENT_ZERO_PORT / WEB_UI_PORT  (default: 50001)
EOF
        ;;
      *)
        echo "[agent-zero] Unknown command: $sub" >&2
        exit 1 ;;
    esac ;;
  instagram-module)
    IG_DIR="$ROOT_DIR/backend/apps/instagram/module"
    [[ -d "$IG_DIR" ]] || { echo "[instagram] Not found at $IG_DIR" >&2; exit 1; }
    [[ -f "$IG_DIR/instagram_api_server.js" ]] || { echo "[instagram] instagram_api_server.js not found at $IG_DIR" >&2; exit 1; }
    [[ -f "$IG_DIR/package.json" ]] || { echo "[instagram] package.json not found at $IG_DIR" >&2; exit 1; }

    sub=${1:-start}
    shift || true

    IG_PORT=${INSTAGRAM_PORT:-3103}
    PID_FILE="$VAR_DIR/pids/instagram-module.pid"
    LOG_DIR="$VAR_DIR/logs/instagram-module"
    mkdir -p "$LOG_DIR" >/dev/null 2>&1 || true
    LOG_FILE="$LOG_DIR/instagram_module.out"

    case "$sub" in
      start)
        if [[ -f "$PID_FILE" ]]; then
          old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
          if [[ -n "${old_pid:-}" ]] && ps -p "$old_pid" >/dev/null 2>&1; then
            echo "[instagram] Already running (pid $old_pid) on :$IG_PORT"
            exit 0
          fi
          rm -f "$PID_FILE" 2>/dev/null || true
        fi
        kill_port "$IG_PORT"
        if [[ ! -d "$IG_DIR/node_modules" ]]; then
          echo "[instagram] Installing deps (auto)..."
          install_node_deps "$IG_DIR" install >/dev/null 2>&1 || true
        fi
        cd "$IG_DIR"
        export INSTAGRAM_PORT="$IG_PORT"
        nohup node "$IG_DIR/instagram_api_server.js" >"$LOG_FILE" 2>&1 &
        echo $! > "$PID_FILE"
        ig_pid="$(cat "$PID_FILE" 2>/dev/null || echo "?")"
        echo "[instagram] Started: http://localhost:$IG_PORT | PID: $ig_pid | Logs: $LOG_FILE"
        ;;
      stop)
        if [[ -f "$PID_FILE" ]]; then
          old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
          if [[ -n "${old_pid:-}" ]] && ps -p "$old_pid" >/dev/null 2>&1; then
            echo "[instagram] Stopping (pid $old_pid)"
            kill "$old_pid" 2>/dev/null || true
            sleep 0.2
          fi
          rm -f "$PID_FILE" 2>/dev/null || true
        fi
        kill_port "$IG_PORT"
        ;;
      logs)
        exec tail -n 200 -f "$LOG_FILE"
        ;;
      -h|--help|help)
        cat <<EOF
Usage: $(basename "$0") instagram-module <start|stop|logs>

Env:
  INSTAGRAM_PORT  (default: 3103)
EOF
        ;;
      *)
        echo "[instagram] Unknown command: $sub" >&2
        exit 1 ;;
    esac ;;
  sales-chart-messenger)
    if [[ $# -eq 0 ]]; then
      set -- diagnose
    fi
    RUNNER="$ROOT_DIR/backend/apps/automations/sales_chart_messenger/scripts/run.sh"
    if [[ -x "$RUNNER" ]]; then
      exec "$RUNNER" "$@"
    fi
    if command -v python3 >/dev/null 2>&1; then
      cd "$ROOT_DIR/backend"
      exec python3 -m apps.automations.sales_chart_messenger --mode "$1" "${@:2}"
    fi
    echo "[dev] Could not find sales-chart-messenger runner at $RUNNER" >&2
    exit 1 ;;
  sales-chart-messenger-stub)
    SALES_CHART_MESSENGER_PORT=${SALES_CHART_MESSENGER_PORT:-3200}
    echo "[sales-chart-messenger-stub] Starting on port $SALES_CHART_MESSENGER_PORT"
    if command -v lsof >/dev/null 2>&1; then
      if lsof -iTCP:"$SALES_CHART_MESSENGER_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
        # shellcheck disable=SC2046
        kill -9 $(lsof -ti tcp:"$SALES_CHART_MESSENGER_PORT") 2>/dev/null || true
        sleep 0.2
      fi
    fi
    node -e "
const http = require('http');
const { URL } = require('url');
const port = $SALES_CHART_MESSENGER_PORT;

function json(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'));

  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, { ok: true, service: 'sales-chart-messenger', port, status: 'running' });
  }

  if (req.method === 'GET' && url.pathname === '/status') {
    return json(res, 200, { status: 'active', service: 'sales-chart-messenger-stub', version: '1.0.0-stub', uptime: process.uptime() });
  }

  if (req.method === 'POST' && url.pathname === '/broadcast') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      let parsed = {};
      try {
        parsed = body ? JSON.parse(body) : {};
      } catch (err) {
        return json(res, 400, { success: false, error: 'invalid_json' });
      }
      console.log('Mock broadcast request:', parsed);
      return json(res, 200, {
        success: true,
        broadcastId: 'mock_' + Date.now(),
        message: 'Broadcast would be sent in production environment',
        recipients: parsed.recipients || [],
      });
    });
    return;
  }

  return json(res, 404, { ok: false, error: 'not_found' });
});

server.listen(port, '127.0.0.1', () => console.log(\`Sales Chart Messenger server running on http://127.0.0.1:\${port}\`));
" &
    mkdir -p "$VAR_DIR/pids" >/dev/null 2>&1 || true
    echo $! > "$VAR_DIR/pids/sales_chart_messenger_stub.pid"
    echo "[sales-chart-messenger-stub] PID: $(cat "$VAR_DIR/pids/sales_chart_messenger_stub.pid" 2>/dev/null || echo '')"
    echo "[sales-chart-messenger-stub] Health: http://localhost:$SALES_CHART_MESSENGER_PORT/health"
    ;;
  scraper)
    SCRAPER_DIR="$ROOT_DIR/backend/apps/automations/scraper"
    [[ -d "$SCRAPER_DIR" ]] || { echo "[scraper] Module not found at $SCRAPER_DIR" >&2; exit 1; }
    cd "$SCRAPER_DIR"
    if [[ -x "./run.sh" ]]; then exec bash "./run.sh" "$@"; fi
    if [[ -f "./main.py" ]]; then
      if command -v python3 >/dev/null 2>&1; then exec python3 "./main.py" "$@"; fi
      exec python "./main.py" "$@"
    fi
    echo "[scraper] Could not find run.sh or main.py in $SCRAPER_DIR" >&2
    exit 1 ;;
  sprinta)
    SPRINTA_ROOT="$ROOT_DIR/backend/apps/automations/sprinta"
    LEGACY_DIR="$SPRINTA_ROOT/legacy"
    V2_DIR="$SPRINTA_ROOT/v2"
    ensure_env_link() {
      local module_env="$1"
      local var_env="$2"
      [[ -e "$module_env" ]] && return 0
      [[ -f "$var_env" ]] || return 0
      ln -sf "$var_env" "$module_env" 2>/dev/null || true
    }
    mode=${1:-}
    shift || true
    case "$mode" in
      legacy)
        [[ -d "$LEGACY_DIR" ]] || { echo "[sprinta] legacy dir not found at $LEGACY_DIR" >&2; exit 1; }
        ensure_env_link "$LEGACY_DIR/.env" "${VAR_DIR}/sprinta/legacy/.env"
        cd "$LEGACY_DIR"
        if [[ -f "sprinta_automation.py" ]]; then
          if command -v python3 >/dev/null 2>&1; then exec python3 sprinta_automation.py "$@"; fi
          exec python sprinta_automation.py "$@"
        fi
        echo "[sprinta] legacy entrypoint sprinta_automation.py not found" >&2
        exit 1 ;;
      v2)
        [[ -d "$V2_DIR" ]] || { echo "[sprinta] v2 dir not found at $V2_DIR" >&2; exit 1; }
        ensure_env_link "$V2_DIR/.env" "${VAR_DIR}/sprinta/v2/.env"
        cd "$V2_DIR"
        if [[ -f "src/__main__.py" ]]; then
          if command -v python3 >/dev/null 2>&1; then exec python3 -m src "$@"; fi
          exec python -m src "$@"
        fi
        echo "[sprinta] v2 entrypoint python -m src not found" >&2
        exit 1 ;;
      -h|--help|help|"")
        cat <<EOF
Usage: $(basename "$0") sprinta <legacy|v2> [args...]

Examples:
  $(basename "$0") sprinta legacy inscricoes/participantes.csv --debug
  $(basename "$0") sprinta v2 --csv data/participantes.csv --headless
EOF
        ;;
      *)
        echo "[sprinta] Unknown mode: $mode" >&2
        exit 1 ;;
    esac
    ;;
  scheduled-posting)
    RUNNER="$ROOT_DIR/backend/apps/automations/scheduled_posting/scripts/run.sh"
    [[ -x "$RUNNER" ]] || { echo "[scheduled-posting] Runner not found at $RUNNER" >&2; exit 1; }
    exec bash "$RUNNER" "$@" ;;
  xiaomi-token)
    XIAOMI_DIR="$ROOT_DIR/backend/tools/scripts/xiaomi"
    [[ -d "$XIAOMI_DIR" ]] || { echo "[xiaomi-token] Module not found at $XIAOMI_DIR" >&2; exit 1; }
    cd "$XIAOMI_DIR"
    if [[ -x "./run.sh" ]]; then exec bash "./run.sh" "$@"; fi
    if [[ -f "./token_extractor.py" ]]; then
      if command -v python3 >/dev/null 2>&1; then exec python3 "./token_extractor.py" "$@"; fi
      exec python "./token_extractor.py" "$@"
    fi
    echo "[xiaomi-token] Could not find run.sh or token_extractor.py in $XIAOMI_DIR" >&2
    exit 1 ;;
  actual-server)
    ACTUAL_DIR="$ROOT_DIR/backend/apps/actual-server"
    [[ -d "$ACTUAL_DIR" ]] || { echo "[actual-server] Not found at $ACTUAL_DIR" >&2; exit 1; }
    cd "$ACTUAL_DIR"
    sub=${1:-menu}
    shift || true
    case "$sub" in
      menu) exec bash ./manage-actual-budget.sh ;;
      start) exec bash ./start-actual-budget.sh ;;
      -h|--help|help)
        cat <<EOF
Usage: $(basename "$0") actual-server [menu|start]
EOF
        ;;
      *)
        echo "[actual-server] Unknown command: $sub" >&2
        exit 1 ;;
    esac ;;
  e2e)
    sub=${1:-health}; shift || true
    exec "$E2E" "$sub" "$@" ;;
  -h|--help|help)
    usage ;;
  *)
    echo "Unknown command: $cmd" >&2
    usage
    exit 1 ;;
esac
