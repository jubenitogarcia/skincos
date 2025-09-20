# WhatsApp Channel-Based System - Troubleshooting Guide

## Overview
This guide provides comprehensive troubleshooting procedures for the WhatsApp Channel-Based System, covering common issues, diagnostic methods, and recovery procedures.

## 📋 Environmental Prerequisites

### System Requirements
- **Node.js**: Version 18+ with ESM support
- **System Memory**: Minimum 4GB RAM for stable operation  
- **Network**: Stable internet connection to WhatsApp servers
- **Disk Space**: 2GB free space for session data and logs
- **Operating System**: Linux/macOS with bash support

### Required Diagnostic Tools
Troubleshooting procedures require these CLI tools:

```bash
# Verify diagnostic tools are available
which curl || echo "❌ curl required for API diagnostics"
which jq || echo "❌ jq required for JSON analysis"
which lsof || echo "❌ lsof required for port conflict detection"
which netstat || echo "❌ netstat required for network diagnostics"
which ps || echo "❌ ps required for process monitoring"
which grep || echo "❌ grep required for log analysis"
```

**Installation Commands:**
```bash
# Ubuntu/Debian
sudo apt-get update && sudo apt-get install curl jq lsof net-tools procps grep

# macOS (Homebrew)  
brew install curl jq

# CentOS/RHEL
sudo yum install curl jq lsof net-tools procps-ng grep
```

**Cloud/Container Environment Alternatives:**
```bash
# Instead of: lsof -i :3001
curl -s --connect-timeout 1 http://localhost:3001 && echo "Port in use" || echo "Port free"

# Instead of: netstat -tuln | grep 3001
ss -tuln | grep 3001 || echo "Port not listening"

# Instead of: jq processing
curl -s http://localhost:8099/api/wa-orchestrator/status | python3 -m json.tool
```

### Security Considerations
- **Log Security**: Ensure logs don't contain sensitive data (QR codes, session tokens)
- **Access Control**: Limit troubleshooting access to authorized personnel
- **Production Safety**: Always test fixes in staging before production
- **Audit Trail**: Document all troubleshooting actions performed

## 🔍 Diagnostic Tools

### 1. System Health Check Commands
```bash
# Check all running processes
ps aux | grep -E "(node|whatsapp)" | grep -v grep

# Check port usage (should show 3001-3009 for active channels)
netstat -tuln | grep -E "300[1-9]"

# Check CRM backend status
curl -s http://localhost:8099/api/wa-orchestrator/status

# Check frontend accessibility
curl -s http://localhost:5000

# Check individual channel status
curl -s http://localhost:8099/api/wa-orchestrator/channels/1
```

### 2. Log Analysis Commands
```bash
# Check CRM backend logs
tail -f comprehensive-crm-so/logs/backend.log

# Check WhatsApp process logs for specific port
tail -f comprehensive-crm-so/logs/whatsapp-3001.log

# Search for errors across all logs
grep -r "ERROR\|FAILED\|TIMEOUT" comprehensive-crm-so/logs/

# Monitor QR generation (based on current system behavior)
grep "QR RECEIVED\|QR Code generated" comprehensive-crm-so/logs/backend.log
```

### 3. Real-Time Monitoring
```bash
# Monitor orchestrator events via SSE
curl -N "http://localhost:8099/api/wa-orchestrator/events"

# Watch system resource usage
watch -n 2 "ps aux | grep -E '(node|whatsapp)' | grep -v grep"
```

## ⚠️ Common Issues & Solutions

### 1. Channels Stuck in QR Generation Loop

**Problem:** Logs showing continuous QR generation without authentication
```
[WhatsApp 3001] QR RECEIVED [REDACTED_FOR_SECURITY]
[WhatsApp 3001] QR Code generated (239 chars) - ready for scanning
```

**Root Causes:**
- QR code not being scanned within timeout period (typically 45 seconds)
- WhatsApp mobile app not responding to QR scan
- Network connectivity issues between WhatsApp process and servers
- Session corruption requiring cleanup

**Solutions:**

**Step 1: Check Channel Status**
```bash
curl http://localhost:8099/api/wa-orchestrator/channels/1
```

**Step 2: Force Clean and Restart (using workaround)**
```bash
# Force clean the session (workaround - endpoint not yet implemented)
curl -X POST "http://localhost:8099/api/wa-orchestrator/instances/3001/stop"
sleep 3
curl -X POST "http://localhost:8099/api/wa-orchestrator/instances/3001/start"

# Alternative: Restart the channel
curl -X POST "http://localhost:8099/api/wa-orchestrator/channels/1/restart"
```

**Step 3: Manual QR Scan Process**
1. Access the frontend: `http://localhost:5000`
2. Navigate to WhatsApp tab
3. Select the problematic channel
4. Ensure QR code is displayed clearly
5. Scan with WhatsApp mobile app within 30 seconds
6. Monitor for authentication success

**Step 4: Alternative Channel**
If the issue persists, use a different channel:
```bash
# Get next available channel
curl http://localhost:8099/api/wa-orchestrator/next-channel

# Start on alternative channel
curl -X POST "http://localhost:8099/api/wa-orchestrator/channels/2/start" \
  -H "Content-Type: application/json" \
  -d '{"name": "Backup Channel"}'
```

### 2. Port Conflicts

**Problem:** Channels failing to start due to port conflicts
```
Error: EADDRINUSE: address already in use :::3001
```

**Diagnostic Steps:**
```bash
# Check what's using the port
lsof -i :3001

# Check all WhatsApp-related ports
lsof -i :3001-3009
```

**Solutions:**

**Option A: Kill Conflicting Process**
```bash
# Find and kill the process
sudo kill -9 $(lsof -t -i :3001)

# Restart the channel
curl -X POST http://localhost:8099/api/wa-orchestrator/channels/1/restart
```

**Option B: Use Alternative Channel**
```bash
# Find free channel
curl http://localhost:8099/api/wa-orchestrator/free-port

# Start on free channel
curl -X POST "http://localhost:8099/api/wa-orchestrator/channels/3/start"
```

**Option C: System-Wide Reset**
```bash
# Stop all channels
for i in {1..9}; do
  curl -X POST "http://localhost:8099/api/wa-orchestrator/channels/$i/stop"
done

# Wait 10 seconds
sleep 10

# Start needed channels
curl -X POST "http://localhost:8099/api/wa-orchestrator/channels/1/start"
```

### 3. Authentication Timeouts

**Problem:** Channels failing to authenticate after QR scan
```
[WhatsApp 3001] QR scanned but authentication timeout
```

**Solutions:**

**Step 1: Verify Mobile App Connection**
- Ensure WhatsApp mobile app has internet connectivity
- Check if WhatsApp Web is working in browser
- Verify phone has sufficient battery and is unlocked

**Step 2: Clear Session and Retry (using workaround)**
```bash
# Force clean session (workaround - endpoint not yet implemented)
curl -X POST "http://localhost:8099/api/wa-orchestrator/instances/3001/stop"
sleep 3  
curl -X POST "http://localhost:8099/api/wa-orchestrator/instances/3001/start"

# Alternative: Restart with extended timeout
curl -X POST "http://localhost:8099/api/wa-orchestrator/channels/1/restart"
```

**Step 3: Check Network Configuration**
```bash
# Test WhatsApp connectivity
curl -s https://web.whatsapp.com/check

# Check DNS resolution
nslookup web.whatsapp.com
```

### 4. Backend API Unresponsive

**Problem:** API endpoints returning 500 errors or timeouts

**Diagnostic Steps:**
```bash
# Check if CRM backend is running
ps aux | grep "server.js" | grep -v grep

# Check backend logs
tail -n 50 comprehensive-crm-so/logs/backend.log

# Test basic connectivity
curl -v http://localhost:8099/api/health
```

**Solutions:**

**Step 1: Restart CRM Backend**
```bash
# Navigate to CRM directory
cd comprehensive-crm-so

# Stop current process
pkill -f "src/api/server.js"

# Restart backend
NODE_ENV=development node src/api/server.js &
```

**Step 2: Check Dependencies**
```bash
# Verify database connection
curl http://localhost:8099/api/health

# Check WhatsApp Orchestrator initialization
curl http://localhost:8099/api/wa-orchestrator/status
```

### 5. Frontend Interface Issues

**Problem:** WhatsApp interface not loading or showing errors

**Solutions:**

**Step 1: Check Frontend Service**
```bash
# Verify frontend is running
curl -s http://localhost:5000

# Check frontend logs
tail -f comprehensive-crm-so/logs/frontend.log
```

**Step 2: Clear Browser Cache**
1. Open browser developer tools (F12)
2. Right-click refresh button → "Empty Cache and Hard Reload"
3. Or use Ctrl+Shift+R (Chrome/Firefox)

**Step 3: Restart Frontend**
```bash
cd comprehensive-crm-so
npm run dev -- --host 0.0.0.0 --port 5000
```

### 6. High Memory Usage

**Problem:** System consuming excessive memory (>2GB)

**Diagnostic Steps:**
```bash
# Check memory usage by process
ps aux --sort=-%mem | head -20

# Monitor memory usage over time
watch -n 5 "free -h && echo '---' && ps aux --sort=-%mem | head -10"
```

**Solutions:**

**Step 1: Restart High-Memory Processes**
```bash
# Identify high-memory WhatsApp processes
ps aux | grep whatsapp | sort -k4 -nr

# Restart specific channel (example: channel 1)
curl -X POST http://localhost:8099/api/wa-orchestrator/channels/1/restart
```

**Step 2: System-Wide Memory Cleanup**
```bash
# Stop all channels
for i in {1..9}; do
  curl -X POST "http://localhost:8099/api/wa-orchestrator/channels/$i/stop"
done

# Wait for cleanup
sleep 30

# Restart only needed channels
curl -X POST "http://localhost:8099/api/wa-orchestrator/channels/1/start"
```

## 🚨 Emergency Recovery Procedures

### Complete System Reset

**When to Use:** Multiple channels failed, system unresponsive, or corrupted state

**Procedure:**
```bash
# 1. Stop all services
pkill -f "server.js"
pkill -f "whatsapp"
pkill -f "node.*300"

# 2. Clean port bindings
for port in {3001..3009}; do
  sudo kill -9 $(lsof -t -i :$port) 2>/dev/null || true
done

# 3. Clean instance files
rm -f comprehensive-crm-so/whatsapp_instances.json
rm -f comprehensive-crm-so/sessions/session-*

# 4. Restart CRM Backend
cd comprehensive-crm-so
NODE_ENV=development node src/api/server.js &

# 5. Wait for initialization
sleep 10

# 6. Verify system status
curl http://localhost:8099/api/wa-orchestrator/status

# 7. Start primary channel
curl -X POST "http://localhost:8099/api/wa-orchestrator/channels/1/start"
```

### Database Recovery

**When to Use:** Conversation data corruption or database connectivity issues

**Procedure:**
```bash
# 1. Backup current data
cp comprehensive-crm-so/conversations_store.json conversations_backup.json
cp comprehensive-crm-so/messages_store.json messages_backup.json

# 2. Check database connectivity
curl http://localhost:8099/api/conversations

# 3. If database issues persist, restart with clean slate
# (Only in development environments)
rm comprehensive-crm-so/conversations_store.json
rm comprehensive-crm-so/messages_store.json

# 4. Restart backend
pkill -f "server.js"
cd comprehensive-crm-so
NODE_ENV=development node src/api/server.js &
```

## 📊 Performance Troubleshooting

### Slow Response Times

**Problem:** API responses taking >5 seconds

**Diagnostic Steps:**
```bash
# Test response times
time curl http://localhost:8099/api/wa-orchestrator/status

# Check system load
uptime
top -n 1
```

**Solutions:**
1. **Reduce Polling Frequency:**
   - Frontend polls every 5 seconds by default
   - Consider increasing to 10 seconds during high load

2. **Optimize Memory Usage:**
   - Restart channels with high memory consumption
   - Limit concurrent QR generation attempts

3. **Database Optimization:**
   - Clear old conversation history
   - Vacuum message storage files

### Network Connectivity Issues

**Problem:** WhatsApp authentication failures due to network issues

**Diagnostic Steps:**
```bash
# Test external connectivity
curl -s https://web.whatsapp.com/check
ping -c 4 web.whatsapp.com

# Check local network configuration
ip route show
cat /etc/resolv.conf
```

**Solutions:**
1. **DNS Configuration:**
   ```bash
   # Use Google DNS
   echo "nameserver 8.8.8.8" | sudo tee /etc/resolv.conf
   ```

2. **Firewall Rules:**
   ```bash
   # Allow WhatsApp ports
   sudo ufw allow out 443/tcp
   sudo ufw allow out 80/tcp
   ```

## 🔧 Advanced Troubleshooting

### Channel State Corruption

**Problem:** Channel stuck in invalid state (e.g., "starting" for >5 minutes)

**Solution:**
```bash
# Force state reset
curl -X PUT "http://localhost:8099/api/wa-orchestrator/channels/1/metadata" \
  -H "Content-Type: application/json" \
  -d '{"metadata": {"forceReset": true}}'

# Then restart
curl -X POST http://localhost:8099/api/wa-orchestrator/channels/1/restart
```

### Process Zombie Detection

**Problem:** Dead WhatsApp processes consuming resources

**Diagnostic:**
```bash
# Find zombie processes
ps aux | grep -E "(whatsapp|3001|3002)" | grep -v grep

# Check for defunct processes
ps aux | grep defunct
```

**Solution:**
```bash
# Kill zombie processes
sudo kill -9 $(ps aux | grep -E "300[1-9]" | grep -v grep | awk '{print $2}')

# Restart all channels (workaround - endpoint not yet implemented)
for ch in {1..9}; do
  echo "Restarting channel $ch"
  curl -X POST "http://localhost:8099/api/wa-orchestrator/channels/$ch/restart"
done
```

## 📝 Logging and Monitoring

### Log Levels and Interpretation

**DEBUG Level:**
- Normal operation logs
- Process start/stop events
- QR generation notifications

**INFO Level:**
- Successful authentications
- Channel state changes
- API request completions

**WARN Level:**
- QR timeout warnings
- Retry attempts
- Performance degradation

**ERROR Level:**
- Process crashes
- Authentication failures
- Network connectivity issues

### Custom Monitoring Setup

**Create monitoring script:**
```bash
#!/bin/bash
# monitor_whatsapp.sh

while true; do
  echo "=== WhatsApp Channel Status $(date) ==="
  curl -s http://localhost:8099/api/wa-orchestrator/channels | jq '.channels[] | {channel: .channel, status: .status, port: .port}'
  
  echo -e "\n=== Memory Usage ==="
  ps aux | grep -E "(whatsapp|300)" | grep -v grep | awk '{print $2, $4, $11}' | head -10
  
  echo -e "\n=== Network Connections ==="
  netstat -tuln | grep -E "300[1-9]"
  
  sleep 60
done
```

**Run monitoring:**
```bash
chmod +x monitor_whatsapp.sh
./monitor_whatsapp.sh > monitoring.log 2>&1 &
```

## 🆘 Getting Help

### Support Checklist
When reporting issues, provide:

1. **System Information:**
   ```bash
   uname -a
   node --version
   curl http://localhost:8099/api/wa-orchestrator/status
   ```

2. **Error Logs:**
   ```bash
   tail -n 100 comprehensive-crm-so/logs/backend.log
   ```

3. **Channel States:**
   ```bash
   curl -s http://localhost:8099/api/wa-orchestrator/channels | jq '.'
   ```

4. **Process Information:**
   ```bash
   ps aux | grep -E "(node|whatsapp)" | grep -v grep
   netstat -tuln | grep -E "300[1-9]|8099|5000"
   ```

### Escalation Procedure
1. **Level 1:** Basic troubleshooting (restart channels, clear cache)
2. **Level 2:** System reset and recovery procedures
3. **Level 3:** Database recovery and advanced diagnostics
4. **Level 4:** Architecture review and system redesign

### Emergency Contacts
- **System Administrator:** [Contact Information]
- **Development Team:** [Contact Information]
- **Infrastructure Team:** [Contact Information]

## 📋 Maintenance Schedule

### Daily Tasks
- Monitor channel status and availability
- Check log files for errors
- Verify QR authentication success rates

### Weekly Tasks
- Clear old log files
- Restart channels with high error counts
- Update system documentation

### Monthly Tasks
- Performance analysis and optimization
- Security audit and updates
- Backup configuration and conversation data

### Quarterly Tasks
- System architecture review
- Capacity planning analysis
- Disaster recovery testing