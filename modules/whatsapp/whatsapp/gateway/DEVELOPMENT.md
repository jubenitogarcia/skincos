# Development Guide

## 🚀 Development Setup

This guide provides comprehensive instructions for setting up and developing the WhatsApp API Monorepo.

## 📋 Prerequisites

### System Requirements
- **Node.js**: >= 18.0.0 (LTS recommended)
- **pnpm**: >= 8.0.0 (package manager)
- **Docker**: >= 20.0.0 (for containerization)
- **Git**: Latest version
- **OS**: Linux, macOS, or Windows with WSL2

### Optional Tools
- **Docker Compose**: >= 2.0.0 (for multi-container setup)
- **Chromium/Chrome**: For Puppeteer (auto-installed)
- **FFmpeg**: For media processing (auto-installed)

## 🔧 Quick Setup

### 1. Clone and Install
```bash
# Clone the repository
git clone https://github.com/jubenitogarcia/WhatsApp.git
cd WhatsApp

# Install dependencies (automated setup)
npm run setup:all
```

### 2. Environment Configuration
```bash
# Copy environment files
cp .env.dev .env

# Edit configuration as needed
nano .env
```

### 3. Start Development Environment
```bash
# Start in development mode
npm run deploy:dev

# Or manually with Docker Compose
docker-compose -f docker-compose.base.yml -f docker-compose.dev.yml up
```

## 🏗️ Project Structure

```
WhatsApp/
├── apps/                       # Applications
│   └── whatsapp-api/          # Main WhatsApp API service
│       ├── src/               # Source code
│       │   ├── controllers/   # API controllers
│       │   ├── services/      # Business logic
│       │   ├── utils/         # Utility functions
│       │   ├── middleware/    # Express middleware
│       │   └── config/        # Configuration files
│       ├── tests/             # Test files
│       ├── Dockerfile         # Docker configuration
│       └── package.json       # Package dependencies
├── packages/                   # Shared packages (future)
│   ├── shared-utils/          # Common utilities
│   └── shared-types/          # Type definitions
├── tools/                     # Development tools
│   ├── scripts/              # Unified scripts
│   │   ├── deploy.sh         # Deployment script
│   │   ├── test.sh           # Testing script
│   │   ├── setup.sh          # Setup script
│   │   └── manage.sh         # Management script
│   └── configs/              # Shared configurations
├── docs/                      # Documentation
├── .github/                   # GitHub workflows
└── docker-compose.*.yml      # Docker compositions
```

## 🛠️ Development Workflow

### Branch Strategy
```bash
# Main branches
main            # Production-ready code
develop         # Integration branch

# Feature branches
feature/new-feature      # New features
fix/bug-description      # Bug fixes
docs/documentation      # Documentation updates
chore/maintenance       # Maintenance tasks
```

### Creating a New Feature
```bash
# 1. Create feature branch
git checkout -b feature/message-scheduling

# 2. Make changes and test
npm run test
npm run lint

# 3. Commit with conventional format
git commit -m "feat(api): add message scheduling functionality"

# 4. Push and create PR
git push origin feature/message-scheduling
```

## 🧪 Testing

### Test Commands
```bash
# Run all tests
npm run test:all

# Run specific test types
npm run test:unit          # Unit tests
npm run test:api           # API integration tests
npm run test:connectivity  # Network connectivity tests

# Run tests with coverage
npm run test:unit -- --coverage

# Run tests in watch mode
npm run test:unit -- --watch
```

### Test Structure
```javascript
// Example test file: tests/api/send-message.test.js
const { expect } = require('chai');
const request = require('supertest');
const app = require('../../src/app');

describe('POST /send', () => {
  it('should send text message successfully', async () => {
    const response = await request(app)
      .post('/send')
      .send({
        number: '5551999999999',
        type: 'text',
        message: 'Test message'
      })
      .expect(200);

    expect(response.body).to.have.property('success', true);
    expect(response.body).to.have.property('messageId');
  });
});
```

### Writing Tests
- **Unit Tests**: Test individual functions and modules
- **Integration Tests**: Test API endpoints and services
- **E2E Tests**: Test complete user workflows
- **Security Tests**: Test authentication and authorization

## 🐳 Docker Development

### Development Environment
```bash
# Start development environment
npm run deploy:dev

# With development tools (Redis Insight, etc.)
./tools/scripts/deploy.sh local --env dev --profile tools

# View logs
docker-compose logs -f whatsapp-api
```

### Docker Commands
```bash
# Build and start
docker-compose up --build

# Start in background
docker-compose up -d

# Stop services
docker-compose down

# View service status
docker-compose ps

# Execute commands in container
docker-compose exec whatsapp-api bash
```

### Multi-Stage Dockerfile
Our Dockerfile uses multi-stage builds for optimization:
```dockerfile
# Development stage
FROM node:18-bullseye-slim AS development
# ... development dependencies and tools

# Production stage  
FROM node:18-bullseye-slim AS production
# ... optimized for production
```

## 🔍 Debugging

### Local Debugging
```bash
# Start with debug mode
NODE_ENV=development DEBUG=* npm start

# Debug specific modules
DEBUG=whatsapp:* npm start

# Use Node.js inspector
node --inspect src/server.js
```

### Docker Debugging
```bash
# Access container shell
docker-compose exec whatsapp-api bash

# View container logs
docker-compose logs whatsapp-api

# Debug with VS Code
# Use Docker extension and attach to running container
```

### Common Issues

**WhatsApp Connection Issues:**
```bash
# Get QR code for authentication
./get_qr.sh

# Check WhatsApp session status
curl http://localhost:3001/status
```

**Port Conflicts:**
```bash
# Check what's using the port
lsof -i :3001

# Kill process using port
kill -9 $(lsof -t -i:3001)
```

**Docker Issues:**
```bash
# Clean Docker system
docker system prune -a

# Rebuild without cache
docker-compose build --no-cache
```

## 📊 Monitoring & Logging

### Application Logs
```bash
# View application logs
npm run services:logs

# Follow logs in real-time
docker-compose logs -f whatsapp-api

# Filter logs by level
docker-compose logs whatsapp-api | grep ERROR
```

### Health Monitoring
```bash
# Check service health
npm run services:health

# Manual health check
curl http://localhost:3001/health

# Check all services status
npm run services:status
```

### Performance Monitoring
- **Metrics**: Built-in Prometheus metrics at `/metrics`
- **Health Checks**: Regular health endpoint monitoring
- **Resource Usage**: Docker stats monitoring

## 🔧 Configuration

### Environment Variables
```bash
# Development (.env.dev)
NODE_ENV=development
PORT=3001
LOG_LEVEL=debug
REDIS_URL=redis://localhost:6379

# Production (.env.prod)
NODE_ENV=production
PORT=3001
LOG_LEVEL=info
REDIS_URL=redis://redis:6379
SSL_CERT_EMAIL=admin@yourdomain.com
```

### Configuration Files
- `.env.dev` - Development configuration
- `.env.prod` - Production configuration  
- `.env.test` - Testing configuration
- `turbo.json` - Turborepo configuration
- `docker-compose.*.yml` - Docker configurations

## 🚀 Deployment

### Local Deployment
```bash
# Development environment
npm run deploy:dev

# Production-like environment
npm run deploy:prod

# Testing environment
npm run deploy:test
```

### Production Deployment
```bash
# Deploy to production server
npm run deploy:prod

# Deploy with custom configuration
./tools/scripts/deploy.sh local --env prod --profile monitoring
```

### CI/CD Pipeline
The project includes GitHub Actions workflows for:
- **Automated Testing**: Run tests on every PR
- **Security Scanning**: Dependency and code security scans
- **Docker Building**: Automated image building
- **Deployment**: Automated deployment to production

## 📈 Performance Optimization

### Development Tips
- Use `npm run dev` for hot reloading
- Enable Node.js debugging for better insights
- Use Docker's development profiles for faster iterations
- Leverage turbo for efficient monorepo builds

### Production Optimization
- Multi-stage Docker builds for smaller images
- Redis caching for improved performance
- Gzip compression for API responses
- Rate limiting to prevent abuse

## 🛡️ Security in Development

### Best Practices
- Never commit secrets to version control
- Use environment variables for configuration
- Regularly update dependencies
- Run security audits: `npm audit`
- Use HTTPS in production environments

### Security Tools
```bash
# Run security audit
npm audit

# Fix security issues
npm audit fix

# Scan Docker images
docker run --rm aquasec/trivy image whatsapp-api
```

## 🤝 Code Style & Quality

### Linting & Formatting
```bash
# Check code style
npm run lint

# Fix linting issues
npm run lint:fix

# Format code
npm run format

# Type checking (if using TypeScript)
npm run typecheck
```

### Code Quality Standards
- **ESLint**: JavaScript/TypeScript linting
- **Prettier**: Code formatting
- **Husky**: Git hooks for quality checks
- **Conventional Commits**: Commit message standards

## 📚 API Development

### Adding New Endpoints
1. Create controller in `apps/whatsapp-api/src/controllers/`
2. Add route in `apps/whatsapp-api/src/routes/`
3. Write tests in `apps/whatsapp-api/tests/`
4. Update API documentation

### API Standards
- RESTful design principles
- Consistent error handling
- Input validation with Joi
- Rate limiting implementation
- Comprehensive logging

## 🔄 Continuous Integration

### GitHub Actions
- **Test Pipeline**: Runs on every push/PR
- **Security Scan**: Weekly dependency scans
- **Build Pipeline**: Automated Docker builds
- **Deploy Pipeline**: Production deployments

### Local CI Simulation
```bash
# Run full CI pipeline locally
npm run ci:local

# Individual CI steps
npm run lint
npm run test
npm run build
npm run security:check
```

## 📞 Getting Help

### Resources
- **[README](README.md)** - Project overview and quick start
- **[Contributing Guide](CONTRIBUTING.md)** - How to contribute
- **[Security Policy](SECURITY.md)** - Security guidelines
- **Documentation**: Check `docs/` directory
- **Issues**: [GitHub Issues](https://github.com/jubenitogarcia/WhatsApp/issues)
- **Discussions**: [GitHub Discussions](https://github.com/jubenitogarcia/WhatsApp/discussions)

### Common Commands Reference
```bash
# Setup and installation
npm run setup:all              # Complete setup
npm run setup:node             # Node.js setup only
npm run setup:docker           # Docker setup only

# Development
npm run dev                    # Start development server
npm run build                  # Build all packages
npm run test                   # Run all tests
npm run lint                   # Check code style

# Deployment
npm run deploy:dev             # Deploy development
npm run deploy:prod            # Deploy production
npm run deploy:test            # Deploy testing

# Services management
npm run services:start         # Start all services
npm run services:stop          # Stop all services
npm run services:restart       # Restart all services
npm run services:status        # Check service status
```

---

*This development guide is continuously updated to reflect current best practices and project evolution.*