#!/bin/bash

# 🎛️ Unified Management Script for WhatsApp Monorepo
# Consolidates bot-manager.sh, iniciar_*.sh, parar_*.sh, status_*.sh

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m'

# Output functions
log() { echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $1"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] WARNING:${NC} $1"; }
error() { echo -e "${RED}[$(date '+%H:%M:%S')] ERROR:${NC} $1"; }
info() { echo -e "${BLUE}[$(date '+%H:%M:%S')] INFO:${NC} $1"; }
success() { echo -e "${GREEN}[$(date '+%H:%M:%S')] SUCCESS:${NC} $1"; }

# Help function
show_help() {
    echo "🎛️ WhatsApp Monorepo Management Script"
    echo ""
    echo "Usage: $0 [OPTIONS] ACTION [SERVICE]"
    echo ""
    echo "ACTIONS:"
    echo "  start         Start services"
    echo "  stop          Stop services"
    echo "  restart       Restart services"
    echo "  status        Show service status"
    echo "  logs          Show service logs"
    echo "  health        Check service health"
    echo ""
    echo "SERVICES:"
    echo "  all           All services (default)"
    echo "  api           WhatsApp API only"
    echo "  redis         Redis cache only"
    echo "  traefik       Traefik proxy only"
    echo ""
    echo "OPTIONS:"
    echo "  -h, --help    Show this help message"
    echo "  -v, --verbose Enable verbose output"
    echo "  -f, --follow  Follow logs (with logs action)"
    echo "  -d, --detach  Run in detached mode"
    echo "  --background  Run in background"
    echo "  --headless    Run in headless mode"
    echo ""
    echo "EXAMPLES:"
    echo "  $0 start              # Start all services"
    echo "  $0 stop api           # Stop WhatsApp API"
    echo "  $0 logs api --follow  # Follow API logs"
    echo "  $0 status             # Show all service status"
    echo ""
}

# Default values
ACTION=""
SERVICE="all"
VERBOSE=false
FOLLOW=false
DETACH=false
BACKGROUND=false
HEADLESS=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -f|--follow)
            FOLLOW=true
            shift
            ;;
        -d|--detach)
            DETACH=true
            shift
            ;;
        --background)
            BACKGROUND=true
            shift
            ;;
        --headless)
            HEADLESS=true
            shift
            ;;
        start|stop|restart|status|logs|health)
            ACTION="$1"
            shift
            ;;
        all|api|redis|traefik)
            SERVICE="$1"
            shift
            ;;
        *)
            error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Check if action is specified
if [[ -z "$ACTION" ]]; then
    error "Action not specified"
    show_help
    exit 1
fi

# Docker compose file
COMPOSE_FILE="docker-compose.monorepo.yml"

# Check dependencies
check_dependencies() {
    local missing_deps=()
    
    command -v docker >/dev/null 2>&1 || missing_deps+=("docker")
    command -v docker-compose >/dev/null 2>&1 || missing_deps+=("docker-compose")
    
    if [[ ${#missing_deps[@]} -ne 0 ]]; then
        error "Missing dependencies: ${missing_deps[*]}"
        exit 1
    fi
    
    if [[ ! -f "$COMPOSE_FILE" ]]; then
        error "Docker compose file not found: $COMPOSE_FILE"
        exit 1
    fi
}

# Get service names
get_service_names() {
    case $SERVICE in
        all)
            echo "whatsapp-api redis traefik"
            ;;
        api)
            echo "whatsapp-api"
            ;;
        redis)
            echo "redis"
            ;;
        traefik)
            echo "traefik"
            ;;
        *)
            error "Unknown service: $SERVICE"
            exit 1
            ;;
    esac
}

# Start services
start_services() {
    log "🚀 Starting services: $SERVICE"
    
    local services=$(get_service_names)
    local compose_cmd="docker-compose -f $COMPOSE_FILE"
    
    # Add detach flag if specified
    if [[ "$DETACH" == true ]] || [[ "$BACKGROUND" == true ]]; then
        compose_cmd="$compose_cmd up -d"
    else
        compose_cmd="$compose_cmd up"
    fi
    
    # Start specific services or all
    if [[ "$SERVICE" != "all" ]]; then
        compose_cmd="$compose_cmd $services"
    fi
    
    [[ "$VERBOSE" == true ]] && log "Executing: $compose_cmd"
    
    if eval "$compose_cmd"; then
        success "✅ Services started successfully"
        
        # Wait for services to be ready
        log "⏳ Waiting for services to be ready..."
        sleep 10
        
        # Show status
        show_service_status
    else
        error "❌ Failed to start services"
        exit 1
    fi
}

# Stop services
stop_services() {
    log "🛑 Stopping services: $SERVICE"
    
    local services=$(get_service_names)
    local compose_cmd="docker-compose -f $COMPOSE_FILE stop"
    
    # Stop specific services or all
    if [[ "$SERVICE" != "all" ]]; then
        compose_cmd="$compose_cmd $services"
    fi
    
    [[ "$VERBOSE" == true ]] && log "Executing: $compose_cmd"
    
    if eval "$compose_cmd"; then
        success "✅ Services stopped successfully"
    else
        error "❌ Failed to stop services"
        exit 1
    fi
}

# Restart services
restart_services() {
    log "🔄 Restarting services: $SERVICE"
    
    stop_services
    sleep 5
    start_services
}

# Show service status
show_service_status() {
    log "📊 Service status:"
    
    # Get container status
    docker-compose -f "$COMPOSE_FILE" ps
    
    echo ""
    
    # Check health of specific services
    local services=$(get_service_names)
    for service in $services; do
        case $service in
            whatsapp-api)
                check_api_health
                ;;
            redis)
                check_redis_health
                ;;
            traefik)
                check_traefik_health
                ;;
        esac
    done
}

# Check API health
check_api_health() {
    info "🔍 Checking WhatsApp API health..."
    
    if curl -f -s http://localhost:3001/status >/dev/null 2>&1; then
        success "✅ WhatsApp API: Healthy"
    else
        warn "❌ WhatsApp API: Not responding"
    fi
}

# Check Redis health
check_redis_health() {
    info "🔍 Checking Redis health..."
    
    if command -v redis-cli >/dev/null 2>&1; then
        if redis-cli -p 6379 ping >/dev/null 2>&1; then
            success "✅ Redis: Healthy"
        else
            warn "❌ Redis: Not responding"
        fi
    else
        if docker exec redis-whatsapp redis-cli ping >/dev/null 2>&1; then
            success "✅ Redis: Healthy"
        else
            warn "❌ Redis: Not responding"
        fi
    fi
}

# Check Traefik health
check_traefik_health() {
    info "🔍 Checking Traefik health..."
    
    if curl -f -s http://localhost:8080/ping >/dev/null 2>&1; then
        success "✅ Traefik: Healthy"
    else
        warn "❌ Traefik: Not responding"
    fi
}

# Show service logs
show_service_logs() {
    log "📝 Showing logs for: $SERVICE"
    
    local services=$(get_service_names)
    local compose_cmd="docker-compose -f $COMPOSE_FILE logs"
    
    # Add follow flag if specified
    if [[ "$FOLLOW" == true ]]; then
        compose_cmd="$compose_cmd -f"
    fi
    
    # Add tail option for readability
    compose_cmd="$compose_cmd --tail=100"
    
    # Show logs for specific services or all
    if [[ "$SERVICE" != "all" ]]; then
        compose_cmd="$compose_cmd $services"
    fi
    
    [[ "$VERBOSE" == true ]] && log "Executing: $compose_cmd"
    
    eval "$compose_cmd"
}

# Health check for all services
health_check() {
    log "🏥 Running health check..."
    
    local failed=0
    
    # Check Docker daemon
    if ! docker info >/dev/null 2>&1; then
        error "❌ Docker daemon not running"
        ((failed++))
    else
        success "✅ Docker daemon: OK"
    fi
    
    # Check containers
    if docker-compose -f "$COMPOSE_FILE" ps | grep -q "Up"; then
        success "✅ Containers: Running"
    else
        warn "❌ Containers: Not running"
        ((failed++))
    fi
    
    # Check individual services
    local services=$(get_service_names)
    for service in $services; do
        case $service in
            whatsapp-api)
                check_api_health || ((failed++))
                ;;
            redis)
                check_redis_health || ((failed++))
                ;;
            traefik)
                check_traefik_health || ((failed++))
                ;;
        esac
    done
    
    # Summary
    echo ""
    if [[ $failed -eq 0 ]]; then
        success "🎉 All health checks passed!"
    else
        error "❌ $failed health check(s) failed"
        exit 1
    fi
}

# Handle process management for background mode
handle_background_mode() {
    if [[ "$BACKGROUND" == true ]]; then
        # Create PID file
        local pid_file="logs/whatsapp-manager.pid"
        mkdir -p logs
        echo $$ > "$pid_file"
        
        # Setup cleanup on exit
        trap "rm -f $pid_file" EXIT
        
        log "🔄 Running in background mode (PID: $$)"
        log "📁 PID file: $pid_file"
    fi
}

# Main execution
main() {
    echo "🎛️ WhatsApp Monorepo Manager"
    echo "============================"
    echo ""
    
    log "🎯 Action: $ACTION"
    log "🔧 Service: $SERVICE"
    [[ "$VERBOSE" == true ]] && log "🔍 Verbose mode enabled"
    [[ "$FOLLOW" == true ]] && log "👀 Follow mode enabled"
    [[ "$DETACH" == true ]] && log "🔌 Detached mode enabled"
    [[ "$BACKGROUND" == true ]] && log "🌙 Background mode enabled"
    [[ "$HEADLESS" == true ]] && log "👻 Headless mode enabled"
    echo ""
    
    check_dependencies
    handle_background_mode
    
    case $ACTION in
        start)
            start_services
            ;;
        stop)
            stop_services
            ;;
        restart)
            restart_services
            ;;
        status)
            show_service_status
            ;;
        logs)
            show_service_logs
            ;;
        health)
            health_check
            ;;
        *)
            error "Unknown action: $ACTION"
            exit 1
            ;;
    esac
}

# Run main function
main "$@"