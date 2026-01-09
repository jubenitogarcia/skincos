#!/bin/bash

# 🔧 Unified Setup Script for WhatsApp Monorepo  
# Consolidates setup_cloudflare_tunnel.sh, setup_ngrok.sh, setup_ffmpeg.sh, etc.

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
    echo "🔧 WhatsApp Monorepo Setup Script"
    echo ""
    echo "Usage: $0 [OPTIONS] COMPONENT"
    echo ""
    echo "COMPONENTS:"
    echo "  all           Setup everything (recommended)"
    echo "  dependencies  Install system dependencies"
    echo "  node          Setup Node.js and pnpm"
    echo "  chromium      Install Chromium for Puppeteer"
    echo "  ffmpeg        Install FFmpeg for media processing"
    echo "  cloudflare    Setup Cloudflare tunnel"
    echo "  ngrok         Setup ngrok tunnel"
    echo "  docker        Setup Docker environment"
    echo "  monorepo      Setup monorepo structure"
    echo ""
    echo "OPTIONS:"
    echo "  -h, --help    Show this help message"
    echo "  -v, --verbose Enable verbose output"
    echo "  -f, --force   Force reinstall"
    echo "  --skip-deps   Skip dependency checks"
    echo ""
    echo "EXAMPLES:"
    echo "  $0 all                # Setup everything"
    echo "  $0 node --verbose     # Setup Node.js with verbose output"
    echo "  $0 chromium --force   # Force reinstall Chromium"
    echo ""
}

# Default values
COMPONENT=""
VERBOSE=false
FORCE=false
SKIP_DEPS=false

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
        -f|--force)
            FORCE=true
            shift
            ;;
        --skip-deps)
            SKIP_DEPS=true
            shift
            ;;
        all|dependencies|node|chromium|ffmpeg|cloudflare|ngrok|docker|monorepo)
            COMPONENT="$1"
            shift
            ;;
        *)
            error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Check if component is specified
if [[ -z "$COMPONENT" ]]; then
    error "Component not specified"
    show_help
    exit 1
fi

# Detect OS
detect_os() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if command -v apt-get >/dev/null 2>&1; then
            OS="ubuntu"
        elif command -v yum >/dev/null 2>&1; then
            OS="centos"
        else
            OS="linux"
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
    elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "win32" ]]; then
        OS="windows"
    else
        OS="unknown"
    fi
    
    [[ "$VERBOSE" == true ]] && log "🖥️  Detected OS: $OS"
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Install system dependencies
setup_dependencies() {
    log "📦 Installing system dependencies..."
    
    case $OS in
        ubuntu)
            sudo apt-get update
            sudo apt-get install -y \
                curl \
                wget \
                git \
                build-essential \
                ca-certificates \
                gnupg \
                lsb-release
            ;;
        macos)
            if ! command_exists brew; then
                log "Installing Homebrew..."
                /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
            fi
            brew update
            brew install curl wget git
            ;;
        windows)
            warn "Windows detected. Please install dependencies manually:"
            echo "  - Git: https://git-scm.com/download/win"
            echo "  - Node.js: https://nodejs.org/"
            echo "  - Docker: https://docker.com/get-started"
            ;;
        *)
            warn "Unknown OS. Please install dependencies manually."
            ;;
    esac
    
    success "✅ System dependencies installed"
}

# Setup Node.js and pnpm
setup_node() {
    log "🟢 Setting up Node.js and pnpm..."
    
    # Check if Node.js is installed
    if ! command_exists node || [[ "$FORCE" == true ]]; then
        log "Installing Node.js..."
        
        case $OS in
            ubuntu)
                curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
                sudo apt-get install -y nodejs
                ;;
            macos)
                brew install node@18
                ;;
            *)
                warn "Please install Node.js 18+ manually"
                ;;
        esac
    else
        info "Node.js already installed: $(node --version)"
    fi
    
    # Install pnpm
    if ! command_exists pnpm || [[ "$FORCE" == true ]]; then
        log "Installing pnpm..."
        npm install -g pnpm
    else
        info "pnpm already installed: $(pnpm --version)"
    fi
    
    # Install workspace dependencies
    if [[ -f "package.json" ]]; then
        log "Installing monorepo dependencies..."
        pnpm install
    fi
    
    success "✅ Node.js and pnpm setup complete"
}

# Setup Chromium for Puppeteer
setup_chromium() {
    log "🌐 Setting up Chromium for Puppeteer..."
    
    case $OS in
        ubuntu)
            sudo apt-get update
            sudo apt-get install -y \
                chromium-browser \
                fonts-liberation \
                libappindicator3-1 \
                libasound2 \
                libatk-bridge2.0-0 \
                libdrm2 \
                libgtk-3-0 \
                libnspr4 \
                libnss3 \
                libxss1 \
                libxtst6 \
                xdg-utils \
                libu2f-udev \
                libvulkan1
            
            # Set environment variable
            echo "export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser" >> ~/.bashrc
            ;;
        macos)
            brew install --cask chromium
            echo "export PUPPETEER_EXECUTABLE_PATH=/Applications/Chromium.app/Contents/MacOS/Chromium" >> ~/.zshrc
            ;;
        *)
            warn "Please install Chromium manually for your OS"
            ;;
    esac
    
    # Skip Puppeteer download
    echo "export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true" >> ~/.bashrc
    
    success "✅ Chromium setup complete"
}

# Setup FFmpeg for media processing
setup_ffmpeg() {
    log "🎬 Setting up FFmpeg..."
    
    if command_exists ffmpeg && [[ "$FORCE" != true ]]; then
        info "FFmpeg already installed: $(ffmpeg -version | head -n1)"
        return
    fi
    
    case $OS in
        ubuntu)
            sudo apt-get update
            sudo apt-get install -y ffmpeg
            ;;
        macos)
            brew install ffmpeg
            ;;
        *)
            warn "Please install FFmpeg manually for your OS"
            echo "  Ubuntu: sudo apt-get install ffmpeg"
            echo "  CentOS: sudo yum install ffmpeg"
            echo "  Windows: Download from https://ffmpeg.org/"
            ;;
    esac
    
    success "✅ FFmpeg setup complete"
}

# Setup Cloudflare tunnel
setup_cloudflare() {
    log "☁️  Setting up Cloudflare tunnel..."
    
    if command_exists cloudflared && [[ "$FORCE" != true ]]; then
        info "Cloudflared already installed: $(cloudflared --version)"
    else
        case $OS in
            ubuntu)
                wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
                sudo dpkg -i cloudflared-linux-amd64.deb
                rm cloudflared-linux-amd64.deb
                ;;
            macos)
                brew install cloudflared
                ;;
            *)
                warn "Please install cloudflared manually for your OS"
                echo "  Download from: https://github.com/cloudflare/cloudflared/releases"
                ;;
        esac
    fi
    
    # Create tunnel configuration
    if [[ ! -f "cloudflare-config.yml" ]]; then
        log "Creating Cloudflare tunnel configuration..."
        cat > cloudflare-config.yml << 'EOF'
tunnel: whatsapp-tunnel
credentials-file: /home/.cloudflared/cert.pem

ingress:
  - hostname: whatsapp.your-domain.com
    service: http://localhost:3001
  - service: http_status:404
EOF
        info "Created cloudflare-config.yml - Please update with your domain"
    fi
    
    success "✅ Cloudflare tunnel setup complete"
    info "Next steps:"
    echo "  1. Run: cloudflared tunnel login"
    echo "  2. Run: cloudflared tunnel create whatsapp-tunnel"
    echo "  3. Update cloudflare-config.yml with your domain"
    echo "  4. Run: cloudflared tunnel run whatsapp-tunnel"
}

# Setup ngrok tunnel
setup_ngrok() {
    log "🚇 Setting up ngrok tunnel..."
    
    if command_exists ngrok && [[ "$FORCE" != true ]]; then
        info "ngrok already installed: $(ngrok version)"
    else
        case $OS in
            ubuntu)
                wget -q https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz
                tar xzf ngrok-v3-stable-linux-amd64.tgz
                sudo mv ngrok /usr/local/bin/
                rm ngrok-v3-stable-linux-amd64.tgz
                ;;
            macos)
                brew install ngrok/ngrok/ngrok
                ;;
            *)
                warn "Please install ngrok manually for your OS"
                echo "  Download from: https://ngrok.com/download"
                ;;
        esac
    fi
    
    # Create ngrok configuration
    if [[ ! -f "$HOME/.ngrok2/ngrok.yml" ]]; then
        mkdir -p "$HOME/.ngrok2"
        cat > "$HOME/.ngrok2/ngrok.yml" << 'EOF'
version: "2"
authtoken: YOUR_NGROK_AUTH_TOKEN
tunnels:
  whatsapp:
    addr: 3001
    proto: http
    bind_tls: true
EOF
        info "Created ngrok config - Please add your auth token"
    fi
    
    success "✅ ngrok setup complete"
    info "Next steps:"
    echo "  1. Get auth token from: https://dashboard.ngrok.com/get-started/your-authtoken"
    echo "  2. Run: ngrok config add-authtoken YOUR_TOKEN"
    echo "  3. Run: ngrok http 3001"
}

# Setup Docker environment
setup_docker() {
    log "🐳 Setting up Docker environment..."
    
    if command_exists docker && [[ "$FORCE" != true ]]; then
        info "Docker already installed: $(docker --version)"
    else
        case $OS in
            ubuntu)
                # Install Docker
                curl -fsSL https://get.docker.com -o get-docker.sh
                sudo sh get-docker.sh
                sudo usermod -aG docker $USER
                rm get-docker.sh
                
                # Install Docker Compose
                sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
                sudo chmod +x /usr/local/bin/docker-compose
                ;;
            macos)
                warn "Please install Docker Desktop from: https://docker.com/get-started"
                ;;
            *)
                warn "Please install Docker manually for your OS"
                ;;
        esac
    fi
    
    # Test Docker installation
    if command_exists docker; then
        log "Testing Docker installation..."
        if docker run --rm hello-world >/dev/null 2>&1; then
            success "✅ Docker is working correctly"
        else
            warn "Docker is installed but not working correctly"
        fi
    fi
}

# Setup monorepo structure
setup_monorepo() {
    log "🏗️  Setting up monorepo structure..."
    
    # Install dependencies
    if [[ -f "package.json" ]]; then
        pnpm install
    fi
    
    # Create necessary directories
    mkdir -p logs storage media temp
    
    # Set permissions
    chmod +x tools/scripts/*.sh 2>/dev/null || true
    
    # Create development environment file
    if [[ ! -f "apps/whatsapp-api/.env" && -f "apps/whatsapp-api/.env.example" ]]; then
        log "Creating development environment file..."
        cp apps/whatsapp-api/.env.example apps/whatsapp-api/.env
        info "Please edit apps/whatsapp-api/.env with your configuration"
    fi
    
    success "✅ Monorepo structure setup complete"
}

# Main setup function
main() {
    echo "🔧 WhatsApp Monorepo Setup"
    echo "=========================="
    echo ""
    
    log "🎯 Component: $COMPONENT"
    [[ "$VERBOSE" == true ]] && log "🔍 Verbose mode enabled"
    [[ "$FORCE" == true ]] && log "💪 Force mode enabled"
    echo ""
    
    detect_os
    
    case $COMPONENT in
        all)
            log "🚀 Setting up everything..."
            setup_dependencies
            setup_node
            setup_chromium
            setup_ffmpeg
            setup_docker
            setup_monorepo
            ;;
        dependencies)
            setup_dependencies
            ;;
        node)
            setup_node
            ;;
        chromium)
            setup_chromium
            ;;
        ffmpeg)
            setup_ffmpeg
            ;;
        cloudflare)
            setup_cloudflare
            ;;
        ngrok)
            setup_ngrok
            ;;
        docker)
            setup_docker
            ;;
        monorepo)
            setup_monorepo
            ;;
        *)
            error "Unknown component: $COMPONENT"
            exit 1
            ;;
    esac
    
    success "🎉 Setup completed successfully!"
    
    if [[ "$COMPONENT" == "all" ]]; then
        echo ""
        info "🚀 Next steps:"
        echo "  1. Configure environment: edit apps/whatsapp-api/.env"
        echo "  2. Start development: pnpm dev"
        echo "  3. Run tests: pnpm test"
        echo "  4. Deploy: tools/scripts/deploy.sh local"
    fi
}

# Run main function
main "$@"