# WhatsApp Unified System - Quick Reference Guide

## 🎯 System Overview
- **Single Module**: Unified WhatsApp communication system
- **Port**: 3003 (WhatsApp Official Module)
- **Frontend**: http://localhost:5000 (CRM interface)
- **Client ID**: `whatsapp-official-replit` (fixed for session persistence)
- **Status States**: `disconnected` → `initializing` → `qr` → `ready` → `operational`

## ⚡ Quick Commands

### System Status
```bash
# WhatsApp service status
curl -s http://localhost:3003/api/status | jq '.'

# Health check
curl -s http://localhost:3003/api/health

# Client information (when connected)
curl -s http://localhost:3003/api/client-info | jq '.'

# Current QR code (if needed)
curl -s http://localhost:3003/api/qr | jq '.qr'
```

### Session Management
```bash
# Restart WhatsApp client
curl -X POST http://localhost:3003/api/restart

# Logout and clear session
curl -X POST http://localhost:3003/api/logout

# System information
curl -s http://localhost:3003/api/status | jq '{status: .status, clientId: .clientId}'
```

### Message Operations
```bash
# Send text message
curl -X POST http://localhost:3003/api/send-message \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": "5511999999999@c.us",
    "message": "Hello from WhatsApp Unified System!"
  }'

# Send media with caption
curl -X POST http://localhost:3003/api/send-media \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": "5511999999999@c.us",
    "media": "https://example.com/image.jpg",
    "caption": "Check out this image!"
  }'

# Send location
curl -X POST http://localhost:3003/api/send-location \
  -H "Content-Type: application/json" \
  -d '{
    "chatId": "5511999999999@c.us",
    "latitude": -23.5505,
    "longitude": -46.6333,
    "description": "São Paulo, Brazil"
  }'
```

### Contact and Chat Management
```bash
# Get all contacts
curl -s http://localhost:3003/api/contacts | jq '.contacts[] | {name, number}'

# Get all chats
curl -s http://localhost:3003/api/chats | jq '.chats[] | {name, id, unreadCount}'

# Get group chats
curl -s http://localhost:3003/api/groups | jq '.groups[] | {name, participantCount}'

# Create group
curl -X POST http://localhost:3003/api/create-group \
  -H "Content-Type: application/json" \
  -d '{
    "name": "New Group",
    "participants": ["5511999999999@c.us", "5511888888888@c.us"]
  }'
```

### Legacy Compatibility
```bash
# Legacy send endpoint
curl -X POST http://localhost:3003/send \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "5511999999999",
    "message": "Legacy message format"
  }'

# Legacy chats endpoint
curl -s http://localhost:3003/chats | jq '.chats[] | {name, id}'
```

## 🔧 Common Troubleshooting

### Authentication Issues
**Problem**: Need to authenticate with QR code
```bash
# Check current status
curl -s http://localhost:3003/api/status | jq '{status, needsAuth: (.status == "qr")}'

# Get QR code for scanning
curl -s http://localhost:3003/api/qr | jq -r '.qr // "No QR code available"'

# Web interface for QR display
open http://localhost:3003
```

### Session Problems
**Problem**: Session not persisting or client disconnected
```bash
# Check session status
curl -s http://localhost:3003/api/status | jq '{status, clientId, sessionPath}'

# Restart client to restore session
curl -X POST http://localhost:3003/api/restart

# If session corrupted, logout and re-authenticate
curl -X POST http://localhost:3003/api/logout
```

### Connection Issues
**Problem**: Service not responding or connection refused
```bash
# Check if service is running
curl -s --connect-timeout 5 http://localhost:3003/api/health || echo "❌ Service down"

# Check process status
ps aux | grep "official-whatsapp.js" | grep -v grep

# Check port availability
lsof -i :3003 || echo "❌ Port 3003 not in use"

# Restart service (if using process manager)
# systemctl restart whatsapp-official  # systemd
# pm2 restart whatsapp-official        # PM2
```

### Browser/Chromium Issues
**Problem**: Browser fails to start or QR generation fails
```bash
# Check Chromium path
ls -la /nix/store/*/bin/chromium 2>/dev/null || echo "❌ Chromium not found"

# Clear browser data (service must be stopped first)
rm -rf /tmp/whatsapp-chromium-whatsapp-official-replit

# Check browser process
ps aux | grep chromium | grep -v grep
```

## 📊 Monitoring Commands

### Health Monitoring
```bash
# Complete system health check
echo "=== WhatsApp System Health ==="
curl -s http://localhost:3003/api/health | jq '.'
curl -s http://localhost:3003/api/status | jq '{status, uptime: .uptime}'

# Connection status
curl -s http://localhost:3003/api/status | jq '{
  status,
  isReady: (.status == "ready"),
  needsAuth: (.status == "qr"),
  hasError: (.status == "error")
}'
```

### Performance Monitoring
```bash
# Response time test
time curl -s http://localhost:3003/api/status > /dev/null

# Memory usage (if running locally)
ps -o pid,ppid,cmd,%mem,%cpu -p $(pgrep -f "official-whatsapp.js")

# Log monitoring
tail -f whatsapp-official-module/logs/whatsapp.log 2>/dev/null || echo "No log file found"
```

### Webhook Monitoring
```bash
# Test webhook endpoint (replace with your webhook URL)
curl -X POST http://localhost:3003/api/test-webhook \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-webhook-url.com/webhook"}'

# Check webhook deliveries (if logging enabled)
grep "Webhook delivery" whatsapp-official-module/logs/whatsapp.log | tail -10
```

## 🚨 Emergency Procedures

### Complete System Reset
```bash
# 1. Stop service
curl -X POST http://localhost:3003/api/logout

# 2. Clear all session data
rm -rf whatsapp-official-module/sessions/session-whatsapp-official-replit

# 3. Clear browser data
rm -rf /tmp/whatsapp-chromium-whatsapp-official-replit

# 4. Restart service (method depends on deployment)
# systemctl restart whatsapp-official
# pm2 restart whatsapp-official
# or restart manually: cd whatsapp-official-module && node official-whatsapp.js
```

### Quick Recovery Sequence
```bash
# Standard recovery procedure
echo "Starting WhatsApp recovery sequence..."

# Step 1: Check current status
STATUS=$(curl -s http://localhost:3003/api/status | jq -r '.status // "unknown"')
echo "Current status: $STATUS"

# Step 2: Attempt restart if not ready
if [ "$STATUS" != "ready" ]; then
    echo "Attempting restart..."
    curl -X POST http://localhost:3003/api/restart
    sleep 5
fi

# Step 3: Check if QR needed
STATUS=$(curl -s http://localhost:3003/api/status | jq -r '.status // "unknown"')
if [ "$STATUS" == "qr" ]; then
    echo "QR authentication required - visit http://localhost:3003"
    curl -s http://localhost:3003/api/qr | jq -r '.qr // "No QR available"'
fi

echo "Recovery sequence complete. Status: $STATUS"
```

## 📋 Configuration Quick Reference

### Environment Variables
```bash
# Core configuration
WHATSAPP_PORT=3003
WHATSAPP_CLIENT_ID=whatsapp-official-replit
WHATSAPP_DATA_PATH=./sessions/session-whatsapp-official-replit
CHROMIUM_EXECUTABLE_PATH=/nix/store/.../bin/chromium
WHATSAPP_USER_DATA_DIR=/tmp/whatsapp-chromium-whatsapp-official-replit

# Security (production)
WEBHOOK_SECRET=your-secure-secret-here
NO_AUTH=false  # Set to true only in development
```

### Port Information
```bash
# System ports
WhatsApp Service: 3003
CRM Frontend:     5000  
CRM Backend:      8099
Agent Zero:       6800
Instagram Module: 3003 (shares with WhatsApp in dev)
```

### File Locations
```bash
# Key directories and files
Service:     whatsapp-official-module/official-whatsapp.js
Sessions:    whatsapp-official-module/sessions/
Web UI:      whatsapp-official-module/public/
Extensions:  whatsapp-official-module/extensions/
Logs:        whatsapp-official-module/logs/ (if configured)
```

## 🔍 Debugging Tips

### Log Analysis
```bash
# Real-time logging (if service has logging)
tail -f whatsapp-official-module/logs/whatsapp.log

# Search for specific events
grep -i "error\|qr\|authenticated\|ready" whatsapp-official-module/logs/whatsapp.log

# Check console output (if running manually)
cd whatsapp-official-module && node official-whatsapp.js
```

### Network Debugging
```bash
# Test connectivity to WhatsApp servers
curl -I https://web.whatsapp.com/

# Check local service connectivity
telnet localhost 3003

# Verify DNS resolution
nslookup web.whatsapp.com
```

### Process Debugging
```bash
# Check running processes
ps aux | grep -E "(whatsapp|chromium)" | grep -v grep

# Check port usage
netstat -tulpn | grep :3003

# Memory and CPU usage
top -p $(pgrep -f "official-whatsapp.js")
```

---

## 📞 Support Information

**Service Status**: ✅ Production Ready  
**Documentation**: backend/docs/modules/crm/  
**Version**: 2.0 (Unified Architecture)  
**Last Updated**: September 2025
