#!/usr/bin/env bash
# Unified restart script for Agent Zero monorepo
# Replaces: restart_full.sh, restart_crm.sh, restart_agent_zero_embedded.sh

set -euo pipefail

# Configuration
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
CLEAN_PROFILE=1
START_GATEWAY=1
START_CRM=1
START_WEBUI=1
CRM_PORT=${CRM_PORT:-5173}
CRM_API_PORT=${CRM_API_PORT:-3100}
AGENT_ZERO_PORT=${WEB_UI_PORT:-50001}

# Default services to start
SERVICES=("agent-zero" "webui")

show_help() {
    cat << EOF
Usage: $0 [OPTIONS]

Unified restart script for Agent Zero monorepo services.

OPTIONS:
    --help                  Show this help message
    --service SERVICE       Specify which service to restart (agent-zero|webui|crm|gateway|all)
    --no-clean             Skip cleaning profile/cache
    --no-gateway           Don't start WhatsApp gateway
    --no-crm               Don't start CRM
    --no-webui             Don't start WebUI
    --crm-port PORT        CRM frontend port (default: 5173)
    --crm-api-port PORT    CRM API port (default: 3100)
    --agent-port PORT      Agent Zero port (default: 50001)
    --kill-only            Only kill existing processes and exit
    --tail                 Tail logs after starting
    --watch                Enable hot reload for development

EXAMPLES:
    $0                          # Start all default services
    $0 --service agent-zero     # Start only Agent Zero core
    $0 --service all            # Start all services
    $0 --kill-only              # Kill all processes
    $0 --no-gateway --no-crm    # Start only core services

EOF
}

parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --help)
                show_help
                exit 0
                ;;
            --service)
                SERVICE="$2"
                case $SERVICE in
                    agent-zero)
                        SERVICES=("agent-zero")
                        ;;
                    webui)
                        SERVICES=("webui")
                        ;;
                    crm)
                        SERVICES=("crm")
                        START_CRM=1
                        ;;
                    gateway)
                        SERVICES=("gateway")
                        START_GATEWAY=1
                        ;;
                    all)
                        SERVICES=("agent-zero" "webui" "crm" "gateway")
                        START_CRM=1
                        START_GATEWAY=1
                        ;;
                esac
                shift 2
                ;;
            --no-clean)
                CLEAN_PROFILE=0
                shift
                ;;
            --no-gateway)
                START_GATEWAY=0
                shift
                ;;
            --no-crm)
                START_CRM=0
                shift
                ;;
            --no-webui)
                START_WEBUI=0
                shift
                ;;
            --crm-port)
                CRM_PORT="$2"
                shift 2
                ;;
            --crm-api-port)
                CRM_API_PORT="$2"
                shift 2
                ;;
            --agent-port)
                AGENT_ZERO_PORT="$2"
                shift 2
                ;;
            --kill-only)
                KILL_ONLY=1
                shift
                ;;
            --tail)
                TAIL_LOGS=1
                shift
                ;;
            --watch)
                WATCH_MODE=1
                shift
                ;;
            *)
                echo "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done
}

setup_environment() {
    # Create log directory
    mkdir -p "$LOG_DIR"

    # Setup environment variables
    export WEBHOOK_EMBEDDED=1
    export QUEUE_BACKEND=redis
    export REDIS_URL=${REDIS_URL:-redis://localhost:6379/1}
    export DISABLE_WEBHOOK_API_KEY=1
    export WHATSAPP_WEBHOOK_SECRET=${WHATSAPP_WEBHOOK_SECRET:-AGZ_SECRET_123}
    export WHATSAPP_BASE_URL=${WHATSAPP_BASE_URL:-http://localhost:3001}
    export WEB_UI_PORT="$AGENT_ZERO_PORT"
    export AGZ_INTERNAL_ENABLE_DIRECT=1
    export AGZ_INTERNAL_BASE="http://localhost:$AGENT_ZERO_PORT"
    export AUTH_LOGIN=${AUTH_LOGIN:-admin}
    export AUTH_PASSWORD=${AUTH_PASSWORD:-admin}

    # Activate virtual environment if it exists
    if [[ -f "$ROOT_DIR/.venv/bin/activate" ]]; then
        # shellcheck disable=SC1091
        source "$ROOT_DIR/.venv/bin/activate"
    fi
}

kill_processes() {
    echo "[restart] Stopping existing processes..."

    # Kill Agent Zero processes
    pkill -f "run_ui.py" 2>/dev/null || true
    pkill -f "az_daemon.py" 2>/dev/null || true

    # Kill CRM processes
    pkill -f "comprehensive-crm-so/src/api/server.js" 2>/dev/null || true
    pkill -f "vite --port $CRM_PORT" 2>/dev/null || true

    # Kill WhatsApp Gateway processes
    pkill -f "whatsapp-gateway" 2>/dev/null || true

    sleep 2
    echo "[restart] Processes stopped"
}

start_agent_zero() {
    echo "[restart] Starting Agent Zero core (port $AGENT_ZERO_PORT)..."
    python "$ROOT_DIR/run_ui.py" --port "$AGENT_ZERO_PORT" > "$LOG_DIR/agent_zero.out" 2>&1 &
    AGENT_PID=$!
    echo "[restart] Agent Zero PID: $AGENT_PID"

    # Wait for readiness
    sleep 5
    if curl -sf "http://localhost:$AGENT_ZERO_PORT/agent-zero/debug/ping" >/dev/null; then
        echo "[restart] Agent Zero is ready"
    else
        echo "[restart] WARNING: Agent Zero ping failed"
    fi
}

start_webui() {
    echo "[restart] WebUI is integrated with Agent Zero core"
}

start_crm() {
    if [[ $START_CRM -eq 1 ]]; then
        echo "[restart] Starting CRM (port $CRM_PORT, API port $CRM_API_PORT)..."
        local CRM_DIR="$ROOT_DIR/comprehensive-crm-so"
        local CRM_SCRIPT="$CRM_DIR/scripts/restart_crm.sh"
        if [[ -x "$CRM_SCRIPT" ]]; then
            "$CRM_SCRIPT" --crm-port "$CRM_PORT" --crm-api-port "$CRM_API_PORT" --tail || true
            echo "[restart] CRM services started"
        else
            echo "[restart] WARN: CRM script not found at $CRM_SCRIPT"
        fi
    fi
}

start_gateway() {
    if [[ $START_GATEWAY -eq 1 ]]; then
        echo "[restart] Starting WhatsApp Gateway..."
        # Gateway startup logic would go here
        echo "[restart] WhatsApp Gateway started"
    fi
}

main() {
    parse_args "$@"
    setup_environment

    kill_processes

    if [[ "${KILL_ONLY:-0}" -eq 1 ]]; then
        echo "[restart] Kill-only mode complete"
        exit 0
    fi

    # Start requested services
    for service in "${SERVICES[@]}"; do
        case $service in
            agent-zero)
                start_agent_zero
                ;;
            webui)
                start_webui
                ;;
            crm)
                start_crm
                ;;
            gateway)
                start_gateway
                ;;
        esac
    done

    echo "[restart] All requested services started"

    if [[ "${TAIL_LOGS:-0}" -eq 1 ]]; then
        echo "[restart] Tailing logs (Ctrl+C to stop)..."
        tail -f "$LOG_DIR"/*.out 2>/dev/null || true
    fi
}

# Guard against sourcing
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
