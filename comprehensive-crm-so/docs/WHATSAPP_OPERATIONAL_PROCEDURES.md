# WhatsApp Unified System - Operational Procedures

## 🎯 Overview
This document provides step-by-step operational procedures for managing the WhatsApp Unified System in production environments. The system provides single-instance WhatsApp communication with persistent session management and comprehensive CRM integration.

## 📋 Environmental Prerequisites

### System Requirements
- **Node.js**: Version 18+ with ESM support
- **System Memory**: Minimum 2GB RAM for stable operation (4GB recommended)
- **Network**: Stable internet connection to WhatsApp servers
- **Disk Space**: 1GB free space for session data and logs
- **Operating System**: Linux/macOS with bash support
- **Browser**: Chromium/Chrome executable for WhatsApp Web automation

### Required CLI Tools
The operational procedures require these tools:

```bash
# Verify tool availability
which curl || echo "❌ curl required for API calls"
which jq || echo "❌ jq required for JSON processing"  
which lsof || echo "❌ lsof required for port conflict detection"
which ps || echo "❌ ps required for process monitoring"
```

**Installation Commands:**
```bash
# Ubuntu/Debian
sudo apt-get update && sudo apt-get install curl jq lsof procps

# macOS (Homebrew)
brew install curl jq

# CentOS/RHEL/Fedora
sudo yum install curl jq lsof procps-ng
# or with dnf: sudo dnf install curl jq lsof procps-ng
```

**Cloud/Container Alternatives:**
```bash
# Instead of: lsof -i :3003
curl -s --connect-timeout 1 http://localhost:3003/api/health && echo "Port in use" || echo "Port free"

# Instead of: jq processing
curl -s http://localhost:3003/api/status | python3 -m json.tool
```

### Production Security Requirements
- **HTTPS**: Configure SSL/TLS certificates for production API access
- **Authentication**: Implement API key-based authentication for production
- **Firewall**: Restrict API access to authorized networks only
- **Monitoring**: Enable comprehensive logging and alerting
- **Backups**: Regular backup of session data and configurations
- **Secrets**: Secure management of webhook secrets and API keys

## 🚀 System Startup Procedures

### 1. Cold Start (Complete System Initialization)

**Prerequisites:**
- Ensure WhatsApp service is stopped
- Verify system resources (minimum 2GB RAM, 1GB disk space)
- Check network connectivity to WhatsApp servers
- Confirm Chromium executable availability

**Startup Sequence:**
```bash
# Step 1: Navigate to WhatsApp module directory
cd whatsapp-official-module

# Step 2: Verify environment configuration
echo "Checking environment..."
echo "WHATSAPP_PORT: ${WHATSAPP_PORT:-3003}"
echo "WHATSAPP_CLIENT_ID: ${WHATSAPP_CLIENT_ID:-whatsapp-official-replit}"
echo "NODE_ENV: ${NODE_ENV:-development}"

# Step 3: Check Chromium availability
ls -la /nix/store/*/bin/chromium 2>/dev/null || echo "⚠️ Chromium executable not found"

# Step 4: Clean previous browser data (recommended for fresh start)
rm -rf /tmp/whatsapp-chromium-${WHATSAPP_CLIENT_ID:-whatsapp-official-replit}

# Step 5: Start WhatsApp Official Module
echo "🚀 Starting WhatsApp Official Module..."
node official-whatsapp.js &
WHATSAPP_PID=$!
echo $WHATSAPP_PID > whatsapp.pid

# Step 6: Wait for service initialization
echo "⏳ Waiting for service to initialize..."
for i in {1..30}; do
    if curl -s http://localhost:3003/api/health >/dev/null 2>&1; then
        echo "✅ Service is running and healthy"
        break
    fi
    echo "Waiting... ($i/30)"
    sleep 2
done

# Step 7: Check initial status
echo "📊 Initial status check:"
curl -s http://localhost:3003/api/status | jq '{status, clientId, needsAuth: (.status == "qr")}'
```

### 2. Warm Start (Service Restart with Session Recovery)

**Use Case**: When service needs restart but session should be preserved

```bash
# Step 1: Check if service is running
if curl -s http://localhost:3003/api/health >/dev/null 2>&1; then
    echo "🔄 Service is running, performing graceful restart..."
    curl -X POST http://localhost:3003/api/restart
else
    echo "🚀 Service not running, performing cold start..."
    cd whatsapp-official-module
    node official-whatsapp.js &
    echo $! > whatsapp.pid
fi

# Step 2: Monitor restart process
echo "⏳ Monitoring restart process..."
for i in {1..20}; do
    STATUS=$(curl -s http://localhost:3003/api/status 2>/dev/null | jq -r '.status // "unknown"')
    echo "Status: $STATUS ($i/20)"
    
    if [ "$STATUS" = "ready" ]; then
        echo "✅ Service restarted successfully with existing session"
        break
    elif [ "$STATUS" = "qr" ]; then
        echo "🔑 QR authentication required"
        break
    fi
    sleep 3
done
```

## 🔐 Authentication Procedures

### 1. QR Code Authentication (First Time Setup)

**When Needed**: New installation or after session expiry

```bash
# Step 1: Verify service status
STATUS=$(curl -s http://localhost:3003/api/status | jq -r '.status')
echo "Current status: $STATUS"

if [ "$STATUS" != "qr" ]; then
    echo "❌ QR authentication not available. Status: $STATUS"
    echo "Try restarting the service if status is 'error'"
    exit 1
fi

# Step 2: Display QR code options
echo "🔑 QR Code Authentication Required"
echo ""
echo "Option 1: Web Interface (Recommended)"
echo "Open in browser: http://localhost:3003"
echo ""
echo "Option 2: Terminal Display"
QR_CODE=$(curl -s http://localhost:3003/api/qr | jq -r '.qr // "No QR code available"')
if [ "$QR_CODE" != "No QR code available" ]; then
    echo "$QR_CODE"
else
    echo "❌ QR code not available via API"
fi

# Step 3: Monitor authentication process
echo ""
echo "⏳ Waiting for QR code scan..."
echo "Instructions:"
echo "1. Open WhatsApp on your phone"
echo "2. Tap Menu (3 dots) → Settings → Connected Devices"
echo "3. Tap 'Connect Device' and scan the QR code"

for i in {1..60}; do
    STATUS=$(curl -s http://localhost:3003/api/status | jq -r '.status // "unknown"')
    case $STATUS in
        "ready")
            echo "✅ Authentication successful! WhatsApp is ready."
            CLIENT_INFO=$(curl -s http://localhost:3003/api/client-info | jq -r '.info.pushname // "Unknown"')
            echo "Connected as: $CLIENT_INFO"
            break
            ;;
        "qr")
            echo "Still waiting for QR scan... ($i/60)"
            ;;
        "error")
            echo "❌ Authentication error. Check logs and restart service."
            break
            ;;
        *)
            echo "Status: $STATUS ($i/60)"
            ;;
    esac
    sleep 5
done
```

### 2. Session Validation and Recovery

**Use Case**: Verify existing session is valid and working

```bash
# Step 1: Check session status
echo "🔍 Validating WhatsApp session..."
STATUS=$(curl -s http://localhost:3003/api/status | jq -r '.status // "unknown"')
CLIENT_ID=$(curl -s http://localhost:3003/api/status | jq -r '.clientId // "unknown"')

echo "Status: $STATUS"
echo "Client ID: $CLIENT_ID"

# Step 2: Validate session health
case $STATUS in
    "ready")
        echo "✅ Session is healthy and ready"
        CLIENT_INFO=$(curl -s http://localhost:3003/api/client-info 2>/dev/null | jq -r '.info.pushname // "Connection info not available"')
        echo "Connected as: $CLIENT_INFO"
        ;;
    "qr")
        echo "🔑 QR authentication required (session expired or not found)"
        echo "Run QR authentication procedure"
        ;;
    "initializing")
        echo "⏳ Service is starting up, please wait..."
        ;;
    "error")
        echo "❌ Session error detected"
        echo "Consider session cleanup and restart"
        ;;
    *)
        echo "⚠️ Unknown status: $STATUS"
        echo "Check service logs for details"
        ;;
esac

# Step 3: Test basic functionality (if ready)
if [ "$STATUS" = "ready" ]; then
    echo ""
    echo "🧪 Testing basic functionality..."
    
    # Test API responsiveness
    if curl -s http://localhost:3003/api/contacts >/dev/null 2>&1; then
        echo "✅ API endpoints responding"
    else
        echo "❌ API endpoints not responding properly"
    fi
    
    # Get basic stats
    CONTACT_COUNT=$(curl -s http://localhost:3003/api/contacts 2>/dev/null | jq '.contacts | length // 0')
    CHAT_COUNT=$(curl -s http://localhost:3003/api/chats 2>/dev/null | jq '.chats | length // 0')
    echo "Contacts: $CONTACT_COUNT, Chats: $CHAT_COUNT"
fi
```

## 📊 System Monitoring Procedures

### 1. Health Check Routine

**Frequency**: Every 5 minutes in production

```bash
#!/bin/bash
# health_check.sh - WhatsApp system health monitoring

echo "=== WhatsApp System Health Check ==="
echo "Timestamp: $(date)"

# Basic connectivity
if curl -s --connect-timeout 5 http://localhost:3003/api/health >/dev/null; then
    echo "✅ Service: HEALTHY"
    
    # Detailed status
    STATUS_JSON=$(curl -s http://localhost:3003/api/status)
    STATUS=$(echo "$STATUS_JSON" | jq -r '.status // "unknown"')
    UPTIME=$(echo "$STATUS_JSON" | jq -r '.uptime // "unknown"')
    
    echo "📊 Status: $STATUS"
    echo "⏱️ Uptime: $UPTIME"
    
    # Performance metrics
    RESPONSE_TIME=$(curl -w "%{time_total}" -s -o /dev/null http://localhost:3003/api/status)
    echo "⚡ Response Time: ${RESPONSE_TIME}s"
    
    # Process health
    PID=$(pgrep -f "official-whatsapp.js" | head -1)
    if [ -n "$PID" ]; then
        MEM_USAGE=$(ps -o pid,ppid,cmd,%mem --no-headers -p "$PID" | awk '{print $4}')
        echo "💾 Memory Usage: ${MEM_USAGE}%"
    fi
    
    # Session health
    case $STATUS in
        "ready")
            echo "🔐 Session: AUTHENTICATED"
            ;;
        "qr")
            echo "🔑 Session: NEEDS_AUTH"
            ;;
        "error")
            echo "❌ Session: ERROR"
            ;;
        *)
            echo "⚠️ Session: $STATUS"
            ;;
    esac
    
else
    echo "❌ Service: DOWN"
    echo "🔧 Action Required: Check service status and restart if needed"
fi

echo "================================"
```

### 2. Performance Monitoring

**Use Case**: Monitor system performance and resource usage

```bash
# performance_monitor.sh - Performance monitoring script

echo "=== WhatsApp Performance Monitor ==="

# Service response time test
echo "🚀 Testing API Performance..."
for endpoint in "/api/health" "/api/status" "/api/contacts"; do
    RESPONSE_TIME=$(curl -w "%{time_total}" -s -o /dev/null "http://localhost:3003$endpoint")
    echo "  $endpoint: ${RESPONSE_TIME}s"
done

# Resource usage
echo ""
echo "💾 Resource Usage:"
PID=$(pgrep -f "official-whatsapp.js" | head -1)
if [ -n "$PID" ]; then
    ps -o pid,ppid,cmd,%mem,%cpu --no-headers -p "$PID"
    
    # Memory details
    if [ -r "/proc/$PID/status" ]; then
        MEM_MB=$(grep VmRSS /proc/$PID/status | awk '{print int($2/1024)}')
        echo "Memory Usage: ${MEM_MB} MB"
    fi
else
    echo "❌ WhatsApp process not found"
fi

# Disk usage (session data)
echo ""
echo "💽 Disk Usage:"
du -sh whatsapp-official-module/sessions/ 2>/dev/null || echo "No session data found"
du -sh /tmp/whatsapp-chromium-* 2>/dev/null || echo "No browser cache data found"

# Network connectivity
echo ""
echo "🌐 Network Connectivity:"
if curl -s -I https://web.whatsapp.com/ >/dev/null; then
    echo "✅ WhatsApp servers: REACHABLE"
else
    echo "❌ WhatsApp servers: UNREACHABLE"
fi
```

## 🔄 Maintenance Procedures

### 1. Daily Maintenance

**Schedule**: Run daily at low-traffic hours

```bash
#!/bin/bash
# daily_maintenance.sh - Daily maintenance routine

echo "=== Daily WhatsApp Maintenance ==="
echo "Started at: $(date)"

# 1. Health validation
echo "🔍 Health Check..."
if ! curl -s http://localhost:3003/api/health >/dev/null; then
    echo "⚠️ Service unhealthy, attempting restart..."
    curl -X POST http://localhost:3003/api/restart
    sleep 10
fi

# 2. Session validation
STATUS=$(curl -s http://localhost:3003/api/status | jq -r '.status // "unknown"')
echo "📊 Current Status: $STATUS"

if [ "$STATUS" = "error" ]; then
    echo "🔧 Error status detected, performing recovery..."
    curl -X POST http://localhost:3003/api/restart
fi

# 3. Cleanup temporary files
echo "🧹 Cleaning temporary files..."
find /tmp -name "whatsapp-*" -type d -mtime +7 -exec rm -rf {} \; 2>/dev/null
echo "✅ Cleanup completed"

# 4. Resource usage report
echo "📊 Resource Usage Report:"
PID=$(pgrep -f "official-whatsapp.js" | head -1)
if [ -n "$PID" ]; then
    ps -o pid,ppid,cmd,%mem,%cpu --no-headers -p "$PID"
fi

echo "Maintenance completed at: $(date)"
```

### 2. Weekly Maintenance

**Schedule**: Run weekly during maintenance window

```bash
#!/bin/bash
# weekly_maintenance.sh - Weekly maintenance routine

echo "=== Weekly WhatsApp Maintenance ==="

# 1. Extended health check
echo "🔍 Extended Health Check..."
./health_check.sh

# 2. Performance baseline
echo "⚡ Performance Baseline..."
./performance_monitor.sh > "performance_$(date +%Y%m%d).log"

# 3. Session data backup (if needed)
echo "💾 Session Data Backup..."
if [ -d "whatsapp-official-module/sessions" ]; then
    tar -czf "session_backup_$(date +%Y%m%d).tar.gz" whatsapp-official-module/sessions/
    echo "✅ Session backup created"
fi

# 4. Log rotation (if logging enabled)
echo "📋 Log Management..."
if [ -d "whatsapp-official-module/logs" ]; then
    find whatsapp-official-module/logs -name "*.log" -mtime +30 -delete
    echo "✅ Old logs cleaned up"
fi

# 5. Update check reminder
echo "🔄 System Update Check..."
echo "Consider checking for updates to:"
echo "  - Node.js runtime"
echo "  - whatsapp-web.js library"
echo "  - System dependencies"

echo "Weekly maintenance completed"
```

## 🚨 Emergency Procedures

### 1. Service Recovery

**Use Case**: Complete service failure or unresponsive state

```bash
#!/bin/bash
# emergency_recovery.sh - Emergency service recovery

echo "🚨 EMERGENCY RECOVERY PROCEDURE"
echo "Started at: $(date)"

# Step 1: Check current state
echo "🔍 Assessing current state..."
PID=$(pgrep -f "official-whatsapp.js" | head -1)
if [ -n "$PID" ]; then
    echo "Process found (PID: $PID), attempting graceful shutdown..."
    kill -TERM "$PID"
    sleep 5
    
    if kill -0 "$PID" 2>/dev/null; then
        echo "⚠️ Graceful shutdown failed, forcing termination..."
        kill -KILL "$PID"
    fi
else
    echo "No running process found"
fi

# Step 2: Clean up resources
echo "🧹 Cleaning up resources..."
rm -rf /tmp/whatsapp-chromium-whatsapp-official-replit
pkill -f chromium.*whatsapp 2>/dev/null || true
rm -f whatsapp-official-module/whatsapp.pid

# Step 3: Restart service
echo "🚀 Restarting service..."
cd whatsapp-official-module
node official-whatsapp.js &
NEW_PID=$!
echo $NEW_PID > whatsapp.pid

# Step 4: Verify recovery
echo "⏳ Verifying recovery..."
for i in {1..30}; do
    if curl -s http://localhost:3003/api/health >/dev/null 2>&1; then
        echo "✅ Service recovered successfully"
        STATUS=$(curl -s http://localhost:3003/api/status | jq -r '.status')
        echo "Current status: $STATUS"
        break
    fi
    echo "Waiting for service... ($i/30)"
    sleep 2
done

echo "Recovery procedure completed at: $(date)"
```

### 2. Session Reset

**Use Case**: Corrupted session or persistent authentication issues

```bash
#!/bin/bash
# session_reset.sh - Complete session reset

echo "🚨 SESSION RESET PROCEDURE"
echo "⚠️ This will require QR code re-authentication"
echo ""

read -p "Continue with session reset? (y/N): " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "Session reset cancelled"
    exit 0
fi

echo "🔄 Starting session reset..."

# Step 1: Logout current session
echo "📤 Logging out current session..."
curl -X POST http://localhost:3003/api/logout 2>/dev/null || true
sleep 3

# Step 2: Remove session files
echo "🗑️ Removing session data..."
rm -rf whatsapp-official-module/sessions/session-whatsapp-official-replit
rm -rf /tmp/whatsapp-chromium-whatsapp-official-replit

# Step 3: Restart service
echo "🚀 Restarting service..."
curl -X POST http://localhost:3003/api/restart 2>/dev/null || {
    # If restart API fails, do manual restart
    PID=$(pgrep -f "official-whatsapp.js")
    if [ -n "$PID" ]; then
        kill -TERM "$PID"
        sleep 3
    fi
    cd whatsapp-official-module
    node official-whatsapp.js &
    echo $! > whatsapp.pid
}

# Step 4: Wait for QR code
echo "⏳ Waiting for QR code generation..."
for i in {1..30}; do
    STATUS=$(curl -s http://localhost:3003/api/status 2>/dev/null | jq -r '.status // "unknown"')
    if [ "$STATUS" = "qr" ]; then
        echo "✅ QR code ready for authentication"
        echo "🔗 Open: http://localhost:3003"
        break
    fi
    echo "Status: $STATUS ($i/30)"
    sleep 2
done

echo "Session reset completed - QR authentication required"
```

## 📋 Production Deployment Guidelines

### 1. Production Environment Setup

```bash
# production_setup.sh - Production environment configuration

# Environment variables for production
export NODE_ENV=production
export WHATSAPP_PORT=3003
export WHATSAPP_CLIENT_ID=whatsapp-production-$(date +%s)  # Unique for each deployment
export NO_AUTH=false  # Always false in production
export WEBHOOK_SECRET=$(openssl rand -hex 32)  # Generate secure secret

# Security hardening
echo "🔒 Production Security Setup..."

# Create dedicated user (if not exists)
if ! id whatsapp >/dev/null 2>&1; then
    useradd -r -s /bin/false whatsapp
fi

# Set proper file permissions
chown -R whatsapp:whatsapp whatsapp-official-module/
chmod 750 whatsapp-official-module/
chmod 600 whatsapp-official-module/sessions/ 2>/dev/null || true

# Configure systemd service
cat > /etc/systemd/system/whatsapp-official.service << EOF
[Unit]
Description=WhatsApp Official Module
After=network.target

[Service]
Type=simple
User=whatsapp
WorkingDirectory=/path/to/whatsapp-official-module
ExecStart=/usr/bin/node official-whatsapp.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=WHATSAPP_PORT=3003

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable whatsapp-official
systemctl start whatsapp-official

echo "✅ Production setup completed"
```

### 2. Production Monitoring Setup

```bash
# production_monitoring.sh - Production monitoring setup

# Health check endpoint for load balancer
cat > /etc/nginx/sites-available/whatsapp-health << 'EOF'
server {
    listen 80;
    server_name whatsapp-health.internal;
    
    location /health {
        proxy_pass http://localhost:3003/api/health;
        proxy_set_header Host $host;
        access_log off;
    }
}
EOF

# Monitoring script for production
cat > /usr/local/bin/whatsapp-monitor << 'EOF'
#!/bin/bash
# Production monitoring script

LOG_FILE="/var/log/whatsapp-monitor.log"
ALERT_EMAIL="admin@company.com"

if ! curl -s --max-time 10 http://localhost:3003/api/health >/dev/null; then
    echo "$(date): WhatsApp service DOWN" >> "$LOG_FILE"
    echo "WhatsApp service is DOWN" | mail -s "ALERT: WhatsApp Service Down" "$ALERT_EMAIL"
    
    # Attempt automatic recovery
    systemctl restart whatsapp-official
fi
EOF

chmod +x /usr/local/bin/whatsapp-monitor

# Add to cron for regular monitoring
echo "*/5 * * * * /usr/local/bin/whatsapp-monitor" | crontab -

echo "✅ Production monitoring configured"
```

## 📞 Support and Escalation

### Incident Response Levels

**Level 1 - Service Degradation**
- Response time > 2 seconds
- Memory usage > 80%
- Authentication issues
- **Action**: Run health check and performance monitor

**Level 2 - Service Interruption**  
- API endpoints returning errors
- QR authentication failures
- Session corruption
- **Action**: Execute recovery procedures

**Level 3 - Complete Outage**
- Service completely unresponsive
- Process crashes
- Critical system errors
- **Action**: Execute emergency recovery, escalate to technical lead

### Contact Information
- **Operations Team**: ops@company.com
- **Development Team**: dev@company.com  
- **Emergency Escalation**: +1-XXX-XXX-XXXX

---

**Document Version**: 2.0 (Unified Architecture)  
**Last Updated**: September 2025  
**Next Review**: October 2025