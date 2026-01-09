#!/bin/bash

# 🚀 Unified Deploy Script for WhatsApp Monorepo
# Consolidates deploy.sh, deploy_infrastructure.sh, setup_railway_deploy.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Functions for colored output
log() { echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $1"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] WARNING:${NC} $1"; }
error() { echo -e "${RED}[$(date '+%H:%M:%S')] ERROR:${NC} $1"; }
info() { echo -e "${BLUE}[$(date '+%H:%M:%S')] INFO:${NC} $1"; }
success() { echo -e "${GREEN}[$(date '+%H:%M:%S')] SUCCESS:${NC} $1"; }

# Help function
show_help() {
    echo "🚀 WhatsApp Monorepo Deploy Script"
    echo ""
    echo "Usage: $0 [OPTIONS] TARGET"
    echo ""
    echo "TARGETS:"
    echo "  local         Deploy locally with Docker"
    echo "  railway       Deploy to Railway (recommended)"
    echo "  docker        Build and start Docker containers"
    echo "  infrastructure Deploy full infrastructure stack"
    echo ""
    echo "OPTIONS:"
    echo "  -h, --help    Show this help message"
    echo "  -v, --verbose Enable verbose output"
    echo "  -c, --clean   Clean build before deploy"
    echo "  -p, --prod    Production deployment"
    echo "  -e, --env ENV Environment (dev|test|prod)"
    echo "  --no-cache    Disable Docker cache"
    echo "  --profile PROFILE Docker compose profile"
    echo ""
    echo "EXAMPLES:"
    echo "  $0 local                     # Deploy locally (dev env)"
    echo "  $0 local --env prod          # Deploy locally (prod env)"
    echo "  $0 local --profile tools     # Deploy with dev tools"
    echo "  $0 railway --prod            # Production deploy to Railway"
    echo "  $0 docker --clean            # Clean Docker deploy"
    echo ""
}

# Default values
TARGET=""
VERBOSE=false
CLEAN=false
PRODUCTION=false
NO_CACHE=false
ENVIRONMENT=""
PROFILE=""

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
        -c|--clean)
            CLEAN=true
            shift
            ;;
        -p|--prod)
            PRODUCTION=true
            ENVIRONMENT="prod"
            shift
            ;;
        -e|--env)
            ENVIRONMENT="$2"
            shift 2
            ;;
        --no-cache)
            NO_CACHE=true
            shift
            ;;
        --profile)
            PROFILE="$2"
            shift 2
            ;;
        local|railway|docker|infrastructure)
            TARGET=$1
            shift
            ;;
        *)
            error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Check if target is specified
if [[ -z "$TARGET" ]]; then
    error "Target not specified"
    show_help
    exit 1
fi

# Check dependencies
check_dependencies() {
    local missing_deps=()
    
    case $TARGET in
        local|docker|infrastructure)
            command -v docker >/dev/null 2>&1 || missing_deps+=("docker")
            command -v docker-compose >/dev/null 2>&1 || missing_deps+=("docker-compose")
            ;;
        railway)
            command -v git >/dev/null 2>&1 || missing_deps+=("git")
            ;;
    esac
    
    if [[ ${#missing_deps[@]} -ne 0 ]]; then
        error "Missing dependencies: ${missing_deps[*]}"
        exit 1
    fi
}

# Clean build artifacts
clean_build() {
    if [[ "$CLEAN" == true ]]; then
        log "🧹 Cleaning build artifacts..."
        
        # Stop containers
        docker-compose down --remove-orphans 2>/dev/null || true
        
        # Remove images if no-cache is specified
        if [[ "$NO_CACHE" == true ]]; then
            log "🗑️  Removing Docker images..."
            docker system prune -af
            docker volume prune -f
        fi
        
        # Clean node modules cache
        if command -v pnpm >/dev/null 2>&1; then
            pnpm store prune || true
        fi
    fi
}

# Local deployment
deploy_local() {
    log "🏠 Starting local deployment..."
    
    local env=${ENVIRONMENT:-dev}
    local compose_files="docker-compose.base.yml -f docker-compose.${env}.yml"
    
    # Load environment variables
    if [[ -f ".env.${env}" ]]; then
        log "📝 Loading environment: .env.${env}"
        export $(cat .env.${env} | grep -v '^#' | xargs)
    fi
    
    log "📦 Building containers..."
    docker-compose -f $compose_files build $([ "$NO_CACHE" == true ] && echo "--no-cache")
    
    log "🚀 Starting services..."
    if [[ "$DETACH" == true ]] || [[ "$BACKGROUND" == true ]]; then
        docker-compose -f $compose_files up -d
    else
        docker-compose -f $compose_files up
    fi
    
    if [[ "$DETACH" == true ]] || [[ "$BACKGROUND" == true ]]; then
        log "⏳ Waiting for services to start..."
        sleep 30
        
        log "🏥 Checking service health..."
        docker-compose -f $compose_files ps
        
        success "✅ Local deployment complete!"
        info "📱 WhatsApp API: http://localhost:${PORT:-3001}"
        info "📊 Redis: localhost:${REDIS_PORT:-6379}"
        
        if [[ "$env" == "dev" ]]; then
            info "🔧 Development tools:"
            echo "   • Redis Insight: http://localhost:8001 (run with --profile tools)"
            echo "   • Mailhog: http://localhost:8025 (run with --profile tools)"
        fi
    fi
}

# Railway deployment 
deploy_railway() {
    log "☁️  Starting Railway deployment..."
    
    # Check if in git repository
    if [[ ! -d ".git" ]]; then
        error "Not in a git repository"
        exit 1
    fi
    
    # Ensure we're in WhatsApp API directory for Railway
    cd apps/whatsapp-api
    
    # Create Railway-optimized files if they don't exist
    if [[ ! -f "package.json" ]]; then
        error "WhatsApp API package.json not found"
        exit 1
    fi
    
    log "📝 Railway deployment files ready"
    
    success "✅ Railway preparation complete!"
    warn "🔗 Next steps:"
    echo "   1. Go to https://railway.app"
    echo "   2. Connect GitHub account"
    echo "   3. Deploy from GitHub repo"
    echo "   4. Select apps/whatsapp-api directory"
    echo "   5. Set environment variables"
    
    cd ../..
}

# Docker deployment
deploy_docker() {
    log "🐳 Starting Docker deployment..."
    
    # Build specific service
    log "🔨 Building WhatsApp API..."
    cd apps/whatsapp-api
    docker build $([ "$NO_CACHE" == true ] && echo "--no-cache") -t whatsapp-api .
    cd ../..
    
    success "✅ Docker build complete!"
}

# Infrastructure deployment
deploy_infrastructure() {
    log "🏗️  Starting infrastructure deployment..."
    
    # Use full infrastructure compose
    COMPOSE_FILE="docker-compose.monorepo.yml"
    
    log "🌐 Creating networks..."
    docker network create traefik 2>/dev/null || true
    
    log "💾 Backing up configuration..."
    if [[ -f "$COMPOSE_FILE" ]]; then
        cp "$COMPOSE_FILE" "${COMPOSE_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
    fi
    
    log "🔨 Building services..."
    docker-compose -f "$COMPOSE_FILE" build $([ "$NO_CACHE" == true ] && echo "--no-cache")
    
    log "🚀 Starting infrastructure..."
    docker-compose -f "$COMPOSE_FILE" up -d
    
    log "⏳ Waiting for services..."
    sleep 45
    
    log "📊 Service status:"
    docker-compose -f "$COMPOSE_FILE" ps
    
    success "✅ Infrastructure deployment complete!"
    info "📍 Services available:"
    echo "   • WhatsApp API: http://localhost:3001"
    echo "   • Traefik Dashboard: http://localhost:8080"  
    echo "   • Redis: localhost:6379"
}

# Main execution
main() {
    echo "🚀 WhatsApp Monorepo Deploy"
    echo "============================"
    echo ""
    
    log "🎯 Target: $TARGET"
    [[ "$PRODUCTION" == true ]] && log "🏭 Environment: Production"
    [[ "$VERBOSE" == true ]] && log "🔍 Verbose mode enabled"
    echo ""
    
    check_dependencies
    clean_build
    
    case $TARGET in
        local)
            deploy_local
            ;;
        railway)
            deploy_railway
            ;;
        docker)
            deploy_docker
            ;;
        infrastructure)
            deploy_infrastructure
            ;;
        *)
            error "Unknown target: $TARGET"
            exit 1
            ;;
    esac
    
    success "🎉 Deployment completed successfully!"
}

# Run main function
main "$@"