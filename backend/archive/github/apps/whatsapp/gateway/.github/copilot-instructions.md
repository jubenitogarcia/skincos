# WhatsApp Enterprise Monorepo

This is a WhatsApp Enterprise API monorepo built with pnpm workspaces and Turborepo, featuring Docker deployment, enterprise-grade security, and automated CI/CD. The main application is a Node.js-based WhatsApp API service using Puppeteer for browser automation.

Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

## Working Effectively

### Bootstrap, Build, and Test the Repository

#### Prerequisites and Initial Setup
```bash
# Install Node.js (if not available) - takes 1-2 minutes
./tools/scripts/setup.sh node --verbose
# NEVER CANCEL: Node.js setup takes up to 2 minutes. Set timeout to 5+ minutes.

# Or setup everything (recommended for fresh environments) - takes 3-5 minutes
./tools/scripts/setup.sh all --verbose  
# NEVER CANCEL: Complete setup takes up to 5 minutes. Set timeout to 10+ minutes.
```

#### Build Process
```bash
# Build all packages - takes 1-2 seconds (very fast, pure JS)
pnpm build
# Timeout: 2+ minutes (though typically completes in seconds)

# Build with Turbo cache info
pnpm build --verbose
```

#### Testing
```bash
# Run all tests - takes 10-15 seconds but FAILS without WhatsApp connection
pnpm test
# NEVER CANCEL: Tests take up to 15 seconds. Set timeout to 30+ minutes.
# NOTE: Tests will FAIL without active WhatsApp connection - this is expected

# Run specific test types
./tools/scripts/test.sh unit --timeout 120           # Unit tests only
./tools/scripts/test.sh connectivity --timeout 60   # Network connectivity 
./tools/scripts/test.sh api --timeout 120          # API integration tests

# Test with coverage
pnpm test:coverage
# NEVER CANCEL: Coverage generation takes up to 20 seconds. Set timeout to 30+ minutes.
```

### Development Workflow

#### Start Development Environment
```bash
# Option 1: Start main WhatsApp bot directly (RECOMMENDED)
node bot_com_api.js
# NEVER CANCEL: Bot startup takes 10-15 seconds, then runs persistently. Set timeout to 10+ minutes.
# Starts server on port 3001 with QR code display

# Option 2: Start with pnpm (monorepo orchestration) 
pnpm dev
# NEVER CANCEL: Dev server startup takes 30-60 seconds. Set timeout to 10+ minutes.

# Option 3: Start WhatsApp API package directly 
cd apps/whatsapp-api
node src/index.js

# Option 4: Use nodemon for hot reload
cd apps/whatsapp-api  
pnpm dev
```

#### Docker Development (if Docker is available)
```bash
# Start development with Docker
npm run deploy:dev

# Start with specific profiles
./tools/scripts/deploy.sh local --env dev --profile tools

# Quick Docker validation
docker-compose -f docker-compose.base.yml config
```

### WhatsApp API Operations

#### Get QR Code for Authentication
```bash
# Generate QR code for WhatsApp authentication
./get_qr.sh
# Scan the displayed QR code with WhatsApp mobile app
```

#### Test API Endpoints
```bash
# Check API status
curl http://localhost:3001/status

# Send test message (requires authenticated WhatsApp)
curl -X POST http://localhost:3001/send \
  -H "Content-Type: application/json" \
  -d '{
    "number": "5551999999999",
    "type": "text", 
    "message": "Hello from WhatsApp API!"
  }'

# Get chat list
curl http://localhost:3001/chats
```

## Validation

### Manual Validation Requirements
- **ALWAYS run through at least one complete end-to-end scenario after making changes**

#### Complete Validation Scenario:
```bash
# 1. Start the main WhatsApp bot (validates core functionality)
node bot_com_api.js
# Should start server on port 3001 and display QR code in terminal
# NEVER CANCEL: Startup takes 10-15 seconds. Set timeout to 5+ minutes.

# 2. In another terminal, test API endpoints
curl http://localhost:3001/status
curl http://localhost:3001/qr.html   # Should return QR page
curl http://localhost:3001/          # Should return main API interface

# 3. Test send endpoint (will fail without WhatsApp auth - this is expected)
curl -X POST http://localhost:3001/send \
  -H "Content-Type: application/json" \
  -d '{"number": "5551999999999", "type": "text", "message": "test"}'
```

#### Expected Successful Behavior:
- Server starts with "🚀 Servidor iniciado na porta 3001" message
- QR code displays in terminal (ASCII art format)
- Status endpoint returns JSON response
- QR HTML page loads properly
- **Expected failures are OK**: Send messages fail without WhatsApp authentication, tests fail without WhatsApp connection

### Code Quality Checks
```bash
# Format code (has configuration issues but should be attempted)
cd apps/whatsapp-api
pnpm format

# Lint code (has configuration issues in some packages)
cd apps/whatsapp-api
pnpm lint

# ALWAYS run build before committing (even though it's fast)
pnpm build
```

### CI/CD Validation
```bash
# Validate all Docker configurations
docker-compose -f docker-compose.base.yml config
docker-compose -f docker-compose.dev.yml config  
docker-compose -f docker-compose.prod.yml config

# Test containerization (if Docker available)
./test-containerization.sh
```

## Critical Information

### Timeout Values and Timing Expectations
- **Setup Commands**: 2-10 minutes - NEVER CANCEL during dependency installation
- **Build Process**: 1-5 seconds (very fast) - Timeout: 5+ minutes  
- **Test Suite**: 10-15 seconds - NEVER CANCEL - Timeout: 30+ minutes
- **Coverage Generation**: 15-20 seconds - NEVER CANCEL - Timeout: 30+ minutes
- **Dev Server Startup**: 30-60 seconds - NEVER CANCEL - Timeout: 10+ minutes
- **Docker Build**: 5-10 minutes - NEVER CANCEL - Timeout: 30+ minutes
- **Chromium Setup**: 2-5 minutes - NEVER CANCEL - Timeout: 15+ minutes

### Known Issues and Workarounds
- **Test Failures**: Tests WILL fail without active WhatsApp Web connection - this is expected
- **Lint Configuration**: ESLint configuration has issues in `packages/shared-utils` - lint individual packages
- **Format Configuration**: Prettier configuration errors exist - format individual packages when possible
- **Docker Dependency**: Docker commands will fail in environments without Docker installed
- **Chromium Installation**: May fail due to package dependencies in some environments

### Package Structure
```
WhatsApp/
├── apps/
│   └── whatsapp-api/          # Main WhatsApp API service (Node.js + Puppeteer)
├── packages/
│   ├── shared-utils/          # Common utilities
│   └── shared-types/          # TypeScript definitions  
├── tools/
│   ├── scripts/               # Setup, test, deploy scripts
│   └── configs/               # Shared configurations
├── package.json               # Root package with workspace configuration
├── turbo.json                # Turborepo pipeline configuration
└── pnpm-workspace.yaml       # pnpm workspace definition
```

## Common Tasks

### Quick Command Reference
```bash
# Complete setup
./tools/scripts/setup.sh all

# Development
pnpm dev                    # Start development servers
pnpm build                  # Build all packages  
pnpm test                   # Run all tests (expect failures without WhatsApp)

# Testing specific areas
./tools/scripts/test.sh connectivity
./tools/scripts/test.sh unit
./tools/scripts/test.sh api

# WhatsApp operations
./get_qr.sh                 # Get QR code for authentication
node bot_com_api.js         # Start main WhatsApp bot
curl http://localhost:3001/status  # Check API status

# Docker operations (if available)
npm run deploy:dev          # Start development environment
npm run services:status     # Check service status
npm run services:logs       # View service logs
```

### Repository Root Files
Key files at repository root:
- `package.json` - Root package with monorepo scripts
- `pnpm-workspace.yaml` - Workspace configuration
- `turbo.json` - Build pipeline configuration  
- `bot_com_api.js` - Main WhatsApp bot entry point
- `start.sh` - Docker container startup script
- `get_qr.sh` - QR code generation script
- Various Docker Compose files for different environments

### Main Application Entry Points
- **WhatsApp API Library**: `apps/whatsapp-api/src/index.js`
- **Main Bot**: `bot_com_api.js` (root directory)
- **Development Server**: `apps/whatsapp-api/src/index.js` via `pnpm dev`

### Environment Variables
Copy example environment files and configure:
```bash
cp apps/whatsapp-api/.env.example apps/whatsapp-api/.env
# Edit .env file with your configuration
```

---

*Always refer to these instructions before exploring the repository or running commands. The monorepo structure and scripts are designed to handle complex WhatsApp automation scenarios with enterprise-grade reliability.*