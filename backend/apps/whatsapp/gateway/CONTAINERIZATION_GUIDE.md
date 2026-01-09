# 🐳 WhatsApp API Containerization Guide

This document provides comprehensive instructions for using the containerized WhatsApp API with Docker and Docker Compose.

## 🏗️ Architecture

The project uses a **multi-stage Dockerfile** with the following targets:
- `development` - Hot reload, debugging tools
- `test` - Testing environment with mocks
- `production` - Optimized production build

**Environment-specific Docker Compose** files with profiles:
- `docker-compose.base.yml` - Core services (API + Redis)
- `docker-compose.dev.yml` - Development tools + hot reload
- `docker-compose.prod.yml` - Production optimizations + monitoring
- `docker-compose.test.yml` - Testing tools + mock services

## 🚀 Quick Start

### Development Environment
```bash
# Basic development setup
docker compose -f docker-compose.base.yml -f docker-compose.dev.yml up

# With development tools (Redis Insight, Mailhog)
docker compose -f docker-compose.base.yml -f docker-compose.dev.yml --profile tools up
```

### Production Environment
```bash
# Production deployment
docker compose -f docker-compose.base.yml -f docker-compose.prod.yml up -d

# With reverse proxy (Traefik)
docker compose -f docker-compose.base.yml -f docker-compose.prod.yml --profile proxy up -d

# With monitoring tools
docker compose -f docker-compose.base.yml -f docker-compose.prod.yml --profile monitoring up -d
```

### Testing Environment
```bash
# Test deployment with mocks
docker compose -f docker-compose.base.yml -f docker-compose.test.yml --profile test up
```

## 📋 Available Profiles

### Development Profiles
- `tools` - Adds Redis Insight (port 8001) and Mailhog (ports 1025, 8025)

### Production Profiles
- `proxy` - Adds Traefik reverse proxy with SSL/TLS support
- `monitoring` - Adds Watchtower for automatic updates

### Test Profiles
- `test` - Adds PostgreSQL test database and mock services

## 🔧 Environment Configuration

Create these environment files:

### `.env.dev` (Development)
```bash
NODE_ENV=development
PORT=3001
REDIS_MAX_MEMORY=256mb
DEBUG=whatsapp:*
```

### `.env.prod` (Production)
```bash
NODE_ENV=production
PORT=3001
REDIS_MAX_MEMORY=512mb
ACME_EMAIL=admin@yourdomain.com
MEMORY_LIMIT=2G
NOTIFICATION_EMAIL=admin@yourdomain.com
SMTP_SERVER=smtp.yourdomain.com
```

### `.env.test` (Testing)
```bash
NODE_ENV=test
PORT=3001
REDIS_MAX_MEMORY=128mb
POSTGRES_DB=whatsapp_test
```

## 🔒 Security Features

- ✅ **Non-root user execution** - Runs as `whatsapp` user
- ✅ **Tini process manager** - Proper signal handling and zombie reaping
- ✅ **Health checks** - Automatic container health monitoring
- ✅ **Resource limits** - Memory and CPU constraints
- ✅ **Network isolation** - Custom bridge network

## 📦 Build Targets

### Development Build
```bash
docker build -f apps/whatsapp-api/Dockerfile --target development -t whatsapp-api:dev apps/whatsapp-api
```

### Production Build
```bash
docker build -f apps/whatsapp-api/Dockerfile --target production -t whatsapp-api:prod apps/whatsapp-api
```

### Test Build
```bash
docker build -f apps/whatsapp-api/Dockerfile --target test -t whatsapp-api:test apps/whatsapp-api
```

## 🔍 Monitoring & Logs

### View logs
```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f whatsapp-api

# With timestamps
docker compose logs -f -t whatsapp-api
```

### Health checks
```bash
# Check container health
docker compose ps

# Inspect health status
docker inspect whatsapp-api --format='{{.State.Health.Status}}'
```

## 🛠️ Development Workflow

### Hot Reload Development
```bash
# Start with source code mounting
docker compose -f docker-compose.base.yml -f docker-compose.dev.yml up

# Code changes in ./apps/whatsapp-api/src are automatically reflected
```

### Testing
```bash
# Run tests in container
docker compose -f docker-compose.base.yml -f docker-compose.test.yml --profile test run whatsapp-api npm test

# Run with coverage
docker compose -f docker-compose.base.yml -f docker-compose.test.yml --profile test run whatsapp-api npm run test:coverage
```

## 📁 Volume Management

### Persistent Data
- `whatsapp_auth_data` - WhatsApp session authentication
- `whatsapp_cache_data` - Browser cache and temporary files
- `whatsapp_logs_data` - Application logs
- `redis_data` - Redis persistence

### Backup Data
```bash
# Backup WhatsApp session data
docker run --rm -v whatsapp_whatsapp_auth_data:/data -v $(pwd):/backup alpine tar czf /backup/whatsapp-auth-backup.tar.gz -C /data .

# Restore session data
docker run --rm -v whatsapp_whatsapp_auth_data:/data -v $(pwd):/backup alpine tar xzf /backup/whatsapp-auth-backup.tar.gz -C /data
```

## 🚨 Troubleshooting

### Common Issues

1. **Container fails to start**
   ```bash
   # Check logs
   docker compose logs whatsapp-api
   
   # Verify health
   docker compose ps
   ```

2. **WhatsApp authentication issues**
   ```bash
   # Clear session data
   docker volume rm whatsapp_whatsapp_auth_data
   ```

3. **Memory issues**
   ```bash
   # Check resource usage
   docker stats
   
   # Increase memory limits in compose file
   ```

### Validation Script
Run the included validation script to test the entire setup:
```bash
./test-containerization.sh
```

## 📝 Best Practices

1. **Use profiles** for environment-specific services
2. **Set resource limits** in production
3. **Monitor health checks** for automatic restarts
4. **Backup session data** regularly
5. **Use environment files** for configuration
6. **Update base images** regularly for security

## 🔄 Updates & Maintenance

### Update containers
```bash
# Pull latest images
docker compose pull

# Recreate containers
docker compose up -d --force-recreate
```

### Clean up
```bash
# Remove unused images
docker image prune

# Remove unused volumes
docker volume prune

# Full cleanup
docker system prune -a
```