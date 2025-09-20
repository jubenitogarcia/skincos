# Overview

SKINCOS AI is a comprehensive multi-service superproject that integrates four main modules through a centralized dashboard. The system serves as an AI-powered business automation platform combining CRM functionality, WhatsApp communication, agent intelligence, and broadcast capabilities. The architecture follows a microservices approach with a Node.js/Express main application orchestrating various submodules that can operate independently or in coordination.

# User Preferences

Preferred communication style: Simple, everyday language.
Interface preference: Visual navigation with buttons, no manual URL typing required.
User experience priority: Centralized access through main dashboard for all modules.

# System Architecture

## Main Application Structure
- **Central Dashboard**: Express.js application (`main_app.js`) serving as the primary orchestrator on port 5000
- **Unified Interface**: Completely button-driven navigation with integrated dashboard routes for all modules
- **Asset Integration**: WhatsApp Official Module assets served internally
- **Health Monitoring**: Comprehensive health endpoints with intelligent fallback modes
- **Submodule Architecture**: Git submodules containing independent services with their own scripts and configurations
- **Development Environment**: Configured for Replit with stub implementations for rapid prototyping

## Core Service Modules

### CRM System (comprehensive-crm-so)
- **Frontend**: React-based dashboard with Vite build system
- **Backend API**: Express server on port 3100 with health monitoring endpoints
- **Configuration**: YAML-based config management (`crm_config.yml`)
- **Scripts**: Automated restart (`restart_crm.sh`) and backup (`backup_crm.sh`) capabilities

### WhatsApp Official Module (whatsapp-official-module)
- **Communication API**: Single unified WhatsApp module using official whatsapp-web.js library
- **Instance Management**: Single persistent session with fixed CLIENT_ID 'whatsapp-official-replit'
- **Browser Integration**: Optimized Chromium/Puppeteer configuration for Replit environment
- **Configuration**: Persistent LocalAuth strategy with session recovery capabilities
- **Port Configuration**: Runs on port 3003 with full REST API and webhook support
- **Authentication**: QR code-based authentication with automatic session persistence
- **Storage System**: File-based session storage with automatic cleanup and recovery
- **Webhook System**: Comprehensive webhook support with HMAC signature verification
- **Error Handling**: Robust error recovery with graceful shutdown and reconnection logic
- **Status**: Production-ready unified WhatsApp communication system

### Agent Zero (agent-zero-module-integrated)
- **AI Central System**: Node.js-based intelligent agent framework running on port 6800
- **Core Features**: Conversational AI, memory system, multi-module integration, webhook support
- **Configuration**: JSON config with WhatsApp, Instagram, and CRM integration settings
- **Security**: Protected endpoints via admin authentication and CORS restrictions
- **Integration**: Full integration with WhatsApp (3003), Instagram (alternative port), and CRM modules
- **Interface**: Admin dashboard accessible via /admin/agent-zero route
- **API Proxy**: Secure API access through /agent-zero-api proxy with admin authentication
- **Status**: Production-ready and fully operational as central AI system

### BroadHub
- **Broadcasting System**: Communication and transmission capabilities
- **Automation**: Restart scripts for service management
- **Integration**: Coordinated messaging across platforms

### Instagram Integration (instagrapi)
- **Multi-Repository Integration**: Combines functionality from multiple Instagram automation tools
- **Core Components**: API integration, OSINT analysis, content download, automation, analytics
- **Port Configuration**: Instagram module uses alternative port configuration (WhatsApp exclusively uses port 3003)
- **Base Repository**: Subzeroid/instagrapi with extended functionality

## Development and CI/CD Architecture

### AI-Powered Development Workflow
- **Automated Issue Generation**: AI tester scripts scan for code issues and generate GitHub issues
- **Improvement Pipeline**: AI runner processes issues and creates automated fixes
- **Knowledge Management**: Structured documentation in `docs/ai-knowledge/` for continuous learning

### Script Organization
- **Root Scripts**: Wrapper scripts in `scripts/` directory delegate to submodule-specific scripts
- **Development Tools**: Watch mode scripts for hot reloading and multi-instance testing
- **E2E Testing**: Unified testing framework with smoke tests and health checks

### GitHub Actions Integration
- **Workflow Automation**: Auto-next-steps generation based on code changes
- **AI Model Configuration**: Configurable AI endpoints and model selection
- **Failure Analysis**: Automated failure detection and patch application

## Configuration Management
- **Environment Variables**: Port configuration and service toggles
- **YAML Configs**: Service-specific configuration files in each submodule
- **JSON Metadata**: Instance tracking and runtime state management

## Security and Monitoring
- **Health Endpoints**: Each service exposes health check endpoints
- **Instance Isolation**: Separate configurations and ports per service instance
- **Submodule Authentication**: Private repository access with GitHub authentication requirements

# WhatsApp System Consolidation (September 2025)

## Unified Architecture Implementation

The WhatsApp system has been completely consolidated from a multi-channel architecture (ports 3001-3009) to a **single unified module** providing robust, production-ready WhatsApp communication capabilities.

### Key Architectural Changes

1. **Single Module Approach**: Replaced 9-channel system with one unified `whatsapp-official-module`
2. **Fixed Port Configuration**: Consolidated to port 3003 with no port conflicts
3. **Persistent Session Management**: Fixed CLIENT_ID `whatsapp-official-replit` ensures session continuity
4. **Enhanced Error Handling**: Comprehensive crash recovery and graceful shutdown procedures
5. **Production Security**: HMAC webhook signatures, process isolation, and secure authentication

### Current Configuration

```javascript
// Core Configuration
CLIENT_ID: 'whatsapp-official-replit' (fixed for session persistence)
PORT: 3003 (via WHATSAPP_PORT environment variable)
AUTH_STRATEGY: LocalAuth with persistent session storage
CHROMIUM_PATH: Replit-optimized Chromium executable path
```

### Operational Status

- **Module Status**: ✅ Production Ready
- **Authentication**: QR Code-based with automatic session recovery
- **API Endpoints**: Full REST API with webhook support
- **Integration**: Complete CRM and Agent Zero integration
- **Monitoring**: Real-time status tracking with error recovery

### Security Features

- **Process Isolation**: Independent Node.js process with crash protection
- **Session Security**: File-based session storage with automatic cleanup (encryption recommended for production)
- **Webhook Security**: HMAC SHA-256 signature verification for all webhook deliveries
- **Error Boundaries**: Comprehensive error handling preventing system-wide failures

# External Dependencies

## Core Runtime Dependencies
- **Node.js/Express**: Primary runtime for main application and service APIs
- **React/Vite**: Frontend framework for CRM dashboard with hot module replacement
- **Python**: Runtime for Agent Zero and related AI processing

## Development and Build Tools
- **Git Submodules**: Repository management for modular architecture
- **GitHub Actions**: CI/CD pipeline automation and workflow management
- **TypeScript/ESLint**: Code quality and type checking for React components
- **Nodemon**: Development server with file watching capabilities

## AI and Integration Services
- **GitHub Models API**: AI model access for automated code improvement
- **Instagram API**: Private API integration through instagrapi submodule
- **WhatsApp Business API**: Communication gateway for customer interactions

## Infrastructure and Deployment
- **Replit Platform**: Primary development and hosting environment
- **GitHub Repository Management**: Source control with private submodule access
- **Health Monitoring**: Service availability checking across all modules

## Third-Party Libraries
- **Express.js v5.1.0**: Web application framework
- **js-yaml**: YAML configuration parsing
- **Various Instagram Tools**: Integrated through submodules (instaloader, osintgram, toutatis, InstaPy)

# Authentication System

## Replit Auth Integration
- **Implementation**: Full Replit Auth integration with PostgreSQL backend
- **Provider Support**: Google, GitHub, Apple, Email/Password authentication
- **Database**: PostgreSQL with users and sessions tables via Drizzle ORM
- **Backend**: Express server with session management and cookie-based authentication
- **Frontend**: React Query integration with AuthContext for state management
- **Status**: Production-ready with comprehensive error handling

## WhatsApp Unified System Authentication (September 2025)
- **Implementation**: X-API-Key authentication with facade pattern for browser-to-unified communication
- **Security Model**: Browser → CRM Backend → Unified System with credential injection
- **Authentication Flow**: 
  - Browser calls `/api/unified/*` (same origin, no credentials needed)
  - CRM Backend proxies to `localhost:3001/whatsapp/*` with `X-API-Key` header
  - Unified System validates API key and returns 200 OK with data
- **API Keys**: Synchronized between CRM (`CRM_UNIFIED_API_KEY`) and Unified (`UNIFIED_API_KEY`)
- **Security Features**: Rate limiting, HMAC support, NO_AUTH bypass for development
- **Status**: Production-ready with zero 401 authentication errors

## Critical Debugging Solutions Applied

### useContext Error Resolution (September 2025)
**Problem**: `Cannot read properties of null (reading 'useContext')` runtime error
**Root Cause**: Hook naming conflicts and timing issues with React Query initialization

**Solutions Implemented**:

1. **Hook Naming Conflict Resolution**
   - Renamed `hooks/useAuth.ts` → `hooks/useReplitAuth.ts`
   - Updated exported function name to `useReplitAuth()`
   - Eliminated import alias conflicts in AuthContext

2. **Loading Guard Implementation**
   - Added QueryClient readiness check in AuthProvider
   - Prevents useQuery execution before QueryClient initialization
   - Graceful loading screen during context setup

3. **Error Boundary Protection**
   - Created `ContextErrorBoundary` for context-specific errors
   - Targeted detection of useContext timing issues
   - Clear error reporting with technical details

4. **Debug Logging System**
   - Comprehensive initialization tracking in AuthProvider
   - Request/response logging in useReplitAuth hook
   - Provider hierarchy monitoring in main.tsx

**Prevention Guidelines**:
- Never use hooks that depend on Context in providers that execute early
- Always verify dependencies are ready before using context hooks
- Use unique, descriptive names for custom hooks
- Implement loading guards for providers using external dependencies
- Wrap critical providers with specific Error Boundaries

**Provider Hierarchy** (Critical Order):
```
QueryClientProvider
└── ContextErrorBoundary
    └── ErrorBoundary
        └── AuthProvider (with loading guard)
            └── IntegrationsProvider
                └── App
```

This hierarchy ensures proper initialization order and prevents timing-related useContext errors.