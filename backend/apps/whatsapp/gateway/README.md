# 🤖 WhatsApp API Monorepo - Enterprise Automation

A comprehensive WhatsApp API solution built with a modern monorepo architecture, featuring Docker deployment, enterprise-grade security, and automated CI/CD.

## 🎯 **Features**

- ✅ **Complete WhatsApp API**: Send/receive messages, media, and manage contacts
- ✅ **Monorepo Architecture**: Scalable, maintainable codebase with Turborepo
- ✅ **Docker Ready**: Containerized deployment with multi-environment support
- ✅ **Enterprise Security**: Rate limiting, authentication, SSL/TLS encryption
- ✅ **Agent-Zero Integration**: AI-powered automation capabilities
- ✅ **Production Ready**: SSL certificates, backup, monitoring, and health checks

## 🚀 **Quick Start**

### Prerequisites
- Node.js >= 18.0.0
- Docker >= 20.0.0  
- Git

### 1. Clone and Setup
```bash
git clone https://github.com/jubenitogarcia/WhatsApp.git
cd WhatsApp

# Automated setup (installs dependencies, configures environment)
npm run setup:all
```

### 2. Start Development Environment
```bash
# Start in development mode with hot reload
npm run deploy:dev

# Or start with development tools (Redis Insight, etc.)
./tools/scripts/deploy.sh local --env dev --profile tools
```

### 3. Authenticate WhatsApp
```bash
# Get QR Code for WhatsApp authentication
./get_qr.sh

# Scan the QR code with WhatsApp mobile app
```

### 4. Test the API
```bash
# Check API status
curl http://localhost:3001/status

# Send test message
curl -X POST http://localhost:3001/send \
  -H "Content-Type: application/json" \
  -d '{
    "number": "5551999999999",
    "type": "text", 
    "message": "Hello from WhatsApp API!"
  }'
```

## 📊 **Production Status**
- 🌐 **Live API**: https://wa.skincos.com.br
- 🐳 **Docker**: Optimized containers with multi-stage builds
- 🔒 **SSL**: Automatic Let's Encrypt certificates via Traefik
- 💾 **Backup**: Persistent volumes with automated backups

## 📡 **API Usage Examples**

### Basic Operations
```bash
# Check API status
curl http://localhost:3001/status

# Send text message
curl -X POST http://localhost:3001/send \
  -H "Content-Type: application/json" \
  -d '{
    "number": "5551999999999",
    "type": "text", 
    "message": "Hello from WhatsApp API!"
  }'

# Send image with caption
curl -X POST http://localhost:3001/send \
  -H "Content-Type: application/json" \
  -d '{
    "number": "5551999999999",
    "type": "image",
    "url": "https://picsum.photos/400/300",
    "message": "Image sent via API"
  }'

# Get chat list
curl http://localhost:3001/chats
```

### Advanced Features
```bash
# Search messages
curl "http://localhost:3001/v1/messages/search?query=hello&limit=10"

# Get contact info
curl http://localhost:3001/v1/contacts/5551999999999

# Get analytics
curl http://localhost:3001/v1/analytics/summary
```

## 🤖 **Integração Agent-Zero**

```python
import requests

BASE_URL = "https://wa.skincos.com.br"

def verificar_whatsapp():
    response = requests.get(f"{BASE_URL}/status")
    return response.json().get("ready", False)

def enviar_mensagem(numero, mensagem):
    payload = {"number": numero, "type": "text", "message": mensagem}
    response = requests.post(f"{BASE_URL}/send", json=payload)
    return response.json()

# Uso
if verificar_whatsapp():
    resultado = enviar_mensagem("5551999999999", "Olá do Agent-Zero!")
    print(resultado)
```

## 🛠️ **Development Commands**

### Setup and Installation
```bash
npm run setup:all              # Complete setup (recommended)
npm run setup:node             # Node.js and dependencies only
npm run setup:docker           # Docker environment only
npm run setup:chromium         # Chromium for Puppeteer
```

### Development
```bash
npm run dev                    # Start development server
npm run deploy:dev             # Start development environment with Docker
npm run build                  # Build all packages
npm run test:all               # Run all tests
npm run lint                   # Check code quality
```

### Testing
```bash
npm run test:unit              # Unit tests
npm run test:api               # API integration tests
npm run test:connectivity      # Network connectivity tests
npm run test:security          # Security tests
```

### Production Deployment
```bash
npm run deploy:prod            # Production deployment
npm run deploy:railway         # Deploy to Railway
npm run deploy:infrastructure  # Full infrastructure deployment
```

### Service Management
```bash
npm run services:start         # Start all services
npm run services:stop          # Stop all services
npm run services:restart       # Restart all services
npm run services:status        # Check service status
npm run services:logs          # View service logs
```

## 📊 **Available Endpoints**

| Method | Endpoint | Description | Version |
|--------|----------|-------------|---------|
| `GET` | `/status` | API status and health | v1 |
| `GET` | `/chats` | List all chats | v1 |
| `POST` | `/send` | Send media (text, image, video, audio, document, location) | v1 |
| `GET` | `/v1/messages` | Get messages with pagination | v1 |
| `GET` | `/v1/messages/search` | Search messages | v1 |
| `POST` | `/v1/messages/:id/annotations` | Add AI annotations | v1 |
| `GET` | `/v1/contacts` | List contacts | v1 |
| `GET` | `/v1/contacts/:id` | Get contact details | v1 |
| `GET` | `/v1/analytics/summary` | Analytics summary | v1 |
| `POST` | `/v1/webhooks` | Webhook management | v1 |

## 🎯 **Enterprise Features**

- **Rate Limiting**: Token bucket algorithm with configurable limits
- **Authentication**: JWT-based API authentication
- **Webhooks**: HMAC-secured webhook delivery
- **Analytics**: Message and contact analytics
- **AI Integration**: Message annotations and insights
- **Monitoring**: Health checks and Prometheus metrics
- **Security**: CORS, Helmet, input validation

## 📱 **Supported Media Types**

- **text**: Text messages with emoji support
- **image**: JPG, PNG, GIF, WebP (max 5MB)
- **video**: MP4, AVI, MOV (max 25MB) with FFmpeg optimization
- **audio**: MP3, AAC, AMR, OGG (max 16MB)
- **document**: PDF, DOC, XLS, and other formats (max 100MB)
- **location**: GPS coordinates with optional address
- **contact**: vCard contact sharing

## 🚨 **Troubleshooting**

### Common Issues

**WhatsApp Authentication:**
```bash
# Get new QR code
./get_qr.sh

# Check connection status
curl http://localhost:3001/status

# View authentication logs
npm run services:logs whatsapp-api
```

**API Not Responding:**
```bash
# Restart API service
npm run services:restart

# Check service status
npm run services:status

# View error logs
docker-compose logs whatsapp-api | grep ERROR
```

**Docker Issues:**
```bash
# Clean Docker system
docker system prune -a

# Rebuild containers
npm run deploy:dev --no-cache

# Check Docker resources
docker stats
```

**Network Connectivity:**
```bash
# Test network connectivity
npm run test:connectivity

# Check port availability
lsof -i :3001

# Test external access
curl http://your-server-ip:3001/status
```

## 🏗️ **Architecture**

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Traefik       │    │  WhatsApp API   │    │     Redis       │
│  (Reverse Proxy)│◄──►│   (Node.js)     │◄──►│   (Cache)       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Let's Encrypt  │    │   Puppeteer     │    │   File Storage  │
│  (SSL Certs)    │    │  (WhatsApp Web) │    │   (Volumes)     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 📚 **Documentation**

### Core Documentation
- **[README](README.md)** - Project overview and quick start guide
- **[Development Guide](DEVELOPMENT.md)** - Complete development setup and workflow
- **[Contributing Guide](CONTRIBUTING.md)** - How to contribute to the project
- **[Security Policy](SECURITY.md)** - Security guidelines and vulnerability reporting
- **[Code of Conduct](CODE_OF_CONDUCT.md)** - Community guidelines and standards

### Technical Documentation
- **[API Documentation](DOCUMENTACAO_FINAL_WHATSAPP_API.md)** - Complete API reference
- **[Docker Setup](DOCKER_SETUP_COMPLETE.md)** - Docker configuration details
- **[Script Consolidation](SCRIPT_CONSOLIDATION.md)** - Unified scripts overview
- **[Docker Consolidation](DOCKER_CONSOLIDATION.md)** - Docker architecture details

### Specialized Guides
- **[Multiple Instances](MULTIPLE_INSTANCES.md)** - Running multiple WhatsApp instances
- **[Enterprise Spec](API_WHATSAPP_ENTERPRISE_SPEC.md)** - Enterprise API specifications

## 🤝 **Contributing**

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm run test:all`
5. Submit a pull request

## 🔒 **Security**

For security concerns, please review our [Security Policy](SECURITY.md) and report vulnerabilities responsibly.

## 📄 **License**

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

---

**WhatsApp API Monorepo v2.0** - Enterprise-ready WhatsApp automation with modern DevOps practices
