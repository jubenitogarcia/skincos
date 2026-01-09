# WhatsApp Channel System - Comprehensive Testing Guide

## 🎯 Overview
This guide covers the complete testing framework for the WhatsApp Channel-Based System, including automated testing, manual verification procedures, and comprehensive result analysis.

## 📋 Testing Prerequisites

### Environment Requirements
- **Operating System**: Linux/macOS with bash support
- **Node.js**: Version 18+ with ESM support
- **System Resources**: Minimum 4GB RAM, 2GB free disk space
- **Network**: Stable internet connection to WhatsApp servers

### Required CLI Tools
The testing framework requires these system utilities:

```bash
# Verify required tools are available
which curl || echo "❌ curl required for API calls"
which jq || echo "❌ jq required for JSON processing"
which lsof || echo "❌ lsof required for port conflict detection"
which netstat || echo "❌ netstat required for network status"
which node || echo "❌ Node.js required for test execution"
```

**Installation Commands:**
```bash
# Ubuntu/Debian
sudo apt-get update && sudo apt-get install curl jq lsof net-tools

# macOS (Homebrew)
brew install curl jq

# CentOS/RHEL
sudo yum install curl jq lsof net-tools
```

**Docker/Container Alternative:**
If CLI tools aren't available, use curl-only alternatives:
```bash
# Instead of: lsof -i :3001
curl -s --connect-timeout 1 http://localhost:3001 && echo "Port in use" || echo "Port free"

# Instead of: jq processing
curl -s http://localhost:8099/api/wa-orchestrator/status | python3 -m json.tool
```

## 🧪 Testing Framework Architecture

### Core Components

#### 1. Enhanced Test Runner (`whatsapp_channels_enhanced_comprehensive_test.js`)
- **Location**: `backend/tools/scripts/whatsapp/whatsapp_channels_enhanced_comprehensive_test.js`
- **Purpose**: Complete lifecycle testing of all 9 WhatsApp channels
- **Features**:
  - Parallel and sequential test execution
  - Comprehensive pairing simulation
  - Visual evidence collection
  - Performance metrics tracking
  - Failure scenario testing

#### 2. Evidence Collection System
- **Directory**: `backend/var/whatsapp/testing/evidence/` (default)
- **Override**: set `WHATSAPP_TEST_EVIDENCE_DIR` to change the output directory
- **Screenshots**: `backend/var/whatsapp/testing/evidence/screenshots/`
- **Logs**: `backend/var/whatsapp/testing/evidence/*.json`
- **Reports**: Automated test reports with timestamps

#### 3. State Monitoring
- **Real-time**: Channel status transitions
- **Performance**: Response times and resource usage
- **Health**: System diagnostics and warnings

## 🚀 Running Tests

### Quick Start
```bash
# Navigate to repo root
cd <repo-root>

# Ensure system is running
curl -f http://localhost:8099/api/health || {
    echo "Starting CRM backend..."
    NODE_ENV=development node backend/apps/crm-api/server.js &
    sleep 15
}

# Run comprehensive tests
node backend/tools/scripts/whatsapp/whatsapp_channels_enhanced_comprehensive_test.js
```

### Test Execution Modes

#### 1. Full Comprehensive Test (Default)
Tests all 9 channels sequentially with complete lifecycle validation.

```bash
node backend/tools/scripts/whatsapp/whatsapp_channels_enhanced_comprehensive_test.js
```

**Expected Duration**: 15-20 minutes
**Output**: Complete test evidence in `backend/var/whatsapp/testing/evidence/` (or `WHATSAPP_TEST_EVIDENCE_DIR`)

#### 2. Single Channel Test
Test specific channels for targeted debugging.

```javascript
// Edit CONFIG.CHANNELS in test file
const CONFIG = {
    CHANNELS: [1, 2], // Test only channels 1 and 2
    // ... other config
}
```

#### 3. Parallel Testing (Advanced)
Enable concurrent testing for faster execution (higher resource usage).

```javascript
// Edit CONFIG.CONCURRENT_TESTS in test file
const CONFIG = {
    CONCURRENT_TESTS: true,
    // ... other config
}
```

**⚠️ Warning**: Parallel testing may cause resource conflicts and false failures.

## 📊 Test Phases and Expected States

### Phase 1: System Health Check
**Duration**: 30 seconds
**Purpose**: Verify orchestrator and system readiness

**Expected Results**:
```json
{
  "orchestratorHealth": { "success": true },
  "orchestratorStatus": { "success": true },
  "availableChannels": { "success": true },
  "overallHealth": true
}
```

**Failure Indicators**:
- API endpoints not responding
- No available channels
- System resource constraints

### Phase 2: Channel Lifecycle Testing
For each channel (1-9), the test executes this sequence:

#### 2.1 Channel Start
**Duration**: 10-15 seconds
**API Call**: `POST /api/wa-orchestrator/channels/{channel}/start`

**Expected State Transitions**:
```
free → starting → qr_pending
```

**Success Criteria**:
- HTTP 200 response
- `result.success === true`
- Channel status changes to "starting" or "qr_pending"

**Evidence Collected**:
- `channel_{N}_started.json` - Start response data
- Process information and network status

#### 2.2 QR Code Generation
**Duration**: 5-10 seconds  
**API Call**: `GET /api/wa-orchestrator/channels/{channel}/qr`

**Expected Results**:
```json
{
  "success": true,
  "qr": "2@4HKj8N5nP...", 
  "status": "qr_pending",
  "channel": 1,
  "port": 3001
}
```

**Success Criteria**:
- QR string length > 200 characters
- Status indicates QR is available
- No timeout errors

**Evidence Collected**:
- `channel_{N}_qr_generated.json` - QR response (first 50 chars for security)
- QR generation timing metrics

#### 2.3 Pairing Simulation
**Duration**: 15-20 seconds
**Purpose**: Simulate complete WhatsApp authentication flow

**Simulated Steps**:
1. **QR Validation** - Verify QR code is properly formatted
2. **Scanning Simulation** - Mock user scanning QR with mobile app
3. **Authentication Monitoring** - Watch for status changes indicating pairing
4. **Ready State Verification** - Confirm channel reaches operational state
5. **Basic Functionality Test** - Verify API responses are consistent

**Expected State Progression**:
```
qr_pending → authenticating → connected/authenticated → ready
```

**⚠️ Important**: Without actual device pairing, channels typically remain in `qr_pending` state. This is expected and not a failure.

**Success Criteria**:
- All simulation steps complete without errors
- QR code remains valid during simulation period
- API continues responding to status requests
- No process crashes or memory leaks

**Evidence Collected**:
- `pairing_flow_channel_{N}.json` - Complete simulation log
- State transition screenshots
- Performance metrics during simulation

### Phase 3: Status Verification
**Duration**: 5 seconds
**API Call**: `GET /api/wa-orchestrator/channels/{channel}`

**Expected Response Format**:
```json
{
  "success": true,
  "status": "qr_pending",
  "channel": 1,
  "port": 3001,
  "instance": {
    "id": "wa-instance-3001",
    "status": "qr_pending",
    "metadata": { ... }
  }
}
```

### Phase 4: Channel Stop
**Duration**: 8-10 seconds
**API Call**: `POST /api/wa-orchestrator/channels/{channel}/stop`

**Expected State Transition**:
```
qr_pending → stopping → free
```

### Phase 5: Restart Testing  
**Duration**: 15-20 seconds
**API Calls**: 
- `POST /api/wa-orchestrator/channels/{channel}/restart`
- `GET /api/wa-orchestrator/channels/{channel}/qr`

**Expected Behavior**:
- Clean restart with fresh QR generation
- No port conflicts or session corruption
- Faster startup time (cached resources)

## 📈 Results Interpretation

### Success Metrics

#### Overall Test Results
```json
{
  "summary": {
    "totalChannels": 9,
    "testedChannels": 9,
    "successfulChannels": 8,     // 88% success rate acceptable
    "failedChannels": 1,
    "partialChannels": 0,
    "averageTestTime": 45000,    // ms per channel
    "averageResponseTime": 250   // ms API response
  }
}
```

**Acceptable Thresholds**:
- ✅ **Success Rate**: ≥80% (7+ channels successful)
- ✅ **Response Time**: ≤500ms average API response  
- ✅ **Test Duration**: ≤60 seconds per channel
- ✅ **Memory Usage**: No memory leaks (consistent usage)

#### Individual Channel Results
```json
{
  "channels": {
    "1": {
      "success": true,
      "phases": {
        "start": "success",
        "qr": "success", 
        "pairing": "simulated",
        "status": "success",
        "stop": "success",
        "restart": "success"
      },
      "timing": {
        "total": 42000,
        "start": 3200,
        "qr": 2100,
        "pairing": 15000
      }
    }
  }
}
```

### Common Failure Patterns

#### 1. Port Conflicts
**Symptoms**:
- `EADDRINUSE` errors in evidence logs
- Start phase failures
- Inconsistent channel availability

**Analysis Commands**:
```bash
# Check evidence for port conflicts
grep -r "EADDRINUSE" backend/var/whatsapp/testing/evidence/
grep -r "port.*already.*use" backend/var/whatsapp/testing/evidence/

# Live port diagnosis  
lsof -i :3001-3009
```

**Resolution**:
- Kill conflicting processes
- Restart tests after cleanup
- Check for Instagram module conflicts (port 3003)

#### 2. QR Generation Timeouts
**Symptoms**:
- QR phase failures after multiple attempts
- `QR_TIMEOUT` in evidence files
- Long response times (>10s)

**Analysis**:
```bash
# Check QR timing patterns
jq '.timing.qr' backend/var/whatsapp/testing/evidence/channel_*_complete_results.json

# Look for timeout patterns
grep -r "timeout" backend/var/whatsapp/testing/evidence/ | grep -i qr
```

**Possible Causes**:
- Network connectivity issues to WhatsApp servers
- System resource constraints
- WhatsApp rate limiting

#### 3. API Responsiveness Issues
**Symptoms**:
- HTTP 5xx errors
- Slow response times (>1000ms)
- Failed health checks

**Analysis**:
```bash
# Check response time distribution
jq '.responseTime' backend/var/whatsapp/testing/evidence/detailed_logs.json | sort -n

# Look for server errors
grep -r "50[0-9]" backend/var/whatsapp/testing/evidence/
```

### Evidence Analysis

#### Test Artifacts Structure
```
backend/var/whatsapp/testing/evidence/
├── enhanced_test_results.json          # Main results file
├── health_check_results.json           # Pre-test health status
├── detailed_logs.json                  # Comprehensive log entries
├── pairing_flow_channel_1.json         # Per-channel pairing simulation
├── channel_1_complete_results.json     # Per-channel full results
├── screenshots/
│   ├── channel_1_started.json          # State captures
│   ├── channel_1_qr_generated.json     # QR generation state
│   ├── channel_1_status_qr_pending.json # Status transitions
│   └── ...
└── failure_scenarios_complete.json     # Failure-scenario validation output
```

#### Key Files Analysis

**1. Main Results (`enhanced_test_results.json`)**
```bash
# Quick success summary
jq '.summary' backend/var/whatsapp/testing/evidence/enhanced_test_results.json

# Channel-by-channel breakdown
jq '.channels' backend/var/whatsapp/testing/evidence/enhanced_test_results.json

# Performance overview
jq '.summary | {averageTestTime, averageResponseTime}' backend/var/whatsapp/testing/evidence/enhanced_test_results.json
```

**2. Detailed Logs (`detailed_logs.json`)**
```bash
# Filter errors only
jq '.[] | select(.level == "ERROR")' backend/var/whatsapp/testing/evidence/detailed_logs.json

# Show pairing simulation steps
jq '.[] | select(.test | contains("pairing"))' backend/var/whatsapp/testing/evidence/detailed_logs.json

# Response time analysis
jq '.[] | select(.data.responseTime) | {timestamp, responseTime: .data.responseTime}' backend/var/whatsapp/testing/evidence/detailed_logs.json
```

**3. Screenshots/State Captures**
Each state capture contains:
- System process information
- Network connection status  
- Memory usage snapshots
- API response data

```bash
# View specific state capture
jq '.' backend/var/whatsapp/testing/evidence/screenshots/channel_1_started.json

# Check for process conflicts
jq '.systemInfo.processes[]' backend/var/whatsapp/testing/evidence/screenshots/channel_*_started.json
```

## 🔧 Custom Testing Scenarios

### Testing Specific Failure Scenarios

#### Port Conflict Testing
```bash
# Create intentional port conflict
node -e "require('http').createServer().listen(3001)" &
CONFLICT_PID=$!

# Run test (should handle gracefully)
node backend/tools/scripts/whatsapp/whatsapp_channels_enhanced_comprehensive_test.js

# Cleanup
kill $CONFLICT_PID
```

#### Resource Stress Testing  
```bash
# Test under memory pressure
node --max-old-space-size=512 backend/tools/scripts/whatsapp/whatsapp_channels_enhanced_comprehensive_test.js
```

#### Network Simulation
```bash
# Test with simulated network delays (Linux)
sudo tc qdisc add dev lo root handle 1: netem delay 100ms

# Run tests
node backend/tools/scripts/whatsapp/whatsapp_channels_enhanced_comprehensive_test.js

# Remove delay
sudo tc qdisc del dev lo root
```

### Performance Benchmarking

#### Response Time Benchmarking
```bash
# Extract response times for analysis
jq -r '.evidence.detailedLogs[] | select(.data.responseTime) | "\(.timestamp) \(.data.responseTime)"' \
   backend/var/whatsapp/testing/evidence/enhanced_test_results.json > response_times.tsv

# Calculate percentiles
sort -k2 -n response_times.tsv | \
awk '{times[NR]=$2} END {
    p50=times[int(NR*0.5)]; 
    p95=times[int(NR*0.95)]; 
    p99=times[int(NR*0.99)]; 
    print "P50:", p50, "P95:", p95, "P99:", p99
}'
```

#### Resource Usage Analysis
```bash
# Memory usage progression
jq -r '.evidence.stateCaptures[] | "\(.timestamp) \(.systemInfo.memoryUsage.heapUsed)"' \
   backend/var/whatsapp/testing/evidence/enhanced_test_results.json

# Process count over time
jq -r '.evidence.stateCaptures[] | "\(.timestamp) \(.systemInfo.processes | length)"' \
   backend/var/whatsapp/testing/evidence/enhanced_test_results.json
```

## 🛠 Troubleshooting Test Issues

### Test Framework Won't Start
**Check Prerequisites**:
```bash
# Verify Node.js version
node --version  # Should be 18+

# Check file permissions
ls -la backend/tools/scripts/whatsapp/whatsapp_channels_enhanced_comprehensive_test.js

# Verify CRM backend is running
curl -f http://localhost:8099/api/health
```

### All Channels Fail Immediately
**Possible Causes**:
1. **Backend not running**: Start CRM backend first
2. **Port conflicts**: Check `lsof -i :8099` 
3. **Authentication issues**: Check `CRM_BASIC_AUTH` environment variable
4. **Network issues**: Verify localhost connectivity

### Inconsistent Results
**Debugging Steps**:
```bash
# Run single channel test for debugging
sed -i 's/CHANNELS: Array.from.*/CHANNELS: [1],/' backend/tools/scripts/whatsapp/whatsapp_channels_enhanced_comprehensive_test.js
node backend/tools/scripts/whatsapp/whatsapp_channels_enhanced_comprehensive_test.js

# Compare multiple runs
for i in {1..3}; do
    echo "Run $i:"
    node backend/tools/scripts/whatsapp/whatsapp_channels_enhanced_comprehensive_test.js 2>&1 | grep "SUCCESS\|ERROR" | wc -l
done
```

### Test Evidence Missing
**Common Issues**:
- Insufficient disk space: Check `df -h`
- Permission issues: Check write access to `backend/var/whatsapp/testing/evidence/` (or `WHATSAPP_TEST_EVIDENCE_DIR`)
- Test interrupted: Look for partial evidence files

## 📅 Testing Best Practices

### Pre-Production Testing
1. **Full System Test**: Run complete 9-channel test
2. **Load Testing**: Multiple concurrent test runs
3. **Environment Validation**: Test in production-like environment
4. **Network Validation**: Test with realistic network conditions

### Continuous Integration
```yaml
# Example CI pipeline step
- name: WhatsApp Channel Tests
  run: |
    # Start services
    NODE_ENV=test node backend/apps/crm-api/server.js &
    sleep 15
    
    # Run tests
	    node backend/tools/scripts/whatsapp/whatsapp_channels_enhanced_comprehensive_test.js
    
    # Archive evidence
    tar -czf test-evidence-${{ github.sha }}.tar.gz backend/var/whatsapp/testing/evidence/
  
  artifacts:
    paths:
      - test-evidence-*.tar.gz
    expire_in: 7 days
```

### Performance Regression Detection
```bash
#!/bin/bash
# performance_regression_check.sh

# Run baseline test
node backend/tools/scripts/whatsapp/whatsapp_channels_enhanced_comprehensive_test.js
BASELINE_TIME=$(jq '.summary.averageTestTime' backend/var/whatsapp/testing/evidence/enhanced_test_results.json)
BASELINE_RESPONSE=$(jq '.summary.averageResponseTime' backend/var/whatsapp/testing/evidence/enhanced_test_results.json)

# Move baseline results
mv backend/var/whatsapp/testing/evidence backend/var/whatsapp/testing/baseline_evidence

# Run comparison test  
node backend/tools/scripts/whatsapp/whatsapp_channels_enhanced_comprehensive_test.js
CURRENT_TIME=$(jq '.summary.averageTestTime' backend/var/whatsapp/testing/evidence/enhanced_test_results.json)
CURRENT_RESPONSE=$(jq '.summary.averageResponseTime' backend/var/whatsapp/testing/evidence/enhanced_test_results.json)

# Calculate regression thresholds (20% slowdown = regression)
REGRESSION_THRESHOLD=1.2

if (( $(echo "$CURRENT_TIME > $BASELINE_TIME * $REGRESSION_THRESHOLD" | bc -l) )); then
    echo "⚠️ Performance regression detected in test execution time"
    echo "Baseline: ${BASELINE_TIME}ms, Current: ${CURRENT_TIME}ms"
fi

if (( $(echo "$CURRENT_RESPONSE > $BASELINE_RESPONSE * $REGRESSION_THRESHOLD" | bc -l) )); then
    echo "⚠️ Performance regression detected in API response time"
    echo "Baseline: ${BASELINE_RESPONSE}ms, Current: ${CURRENT_RESPONSE}ms"
fi
```

## 🔐 Security Considerations

### Test Environment Security
- **Isolation**: Run tests in isolated development environment
- **Data**: Use test data only, never production conversations
- **Credentials**: Use separate test credentials if authentication enabled
- **Network**: Ensure test traffic doesn't leak to production

### Evidence Data Protection
- **QR Codes**: Test framework redacts QR codes in evidence files
- **Sensitive Data**: No real phone numbers or conversation data in tests
- **Cleanup**: Automatically clean test sessions after completion

## 📋 Test Reporting

### Automated Reporting
The test framework generates comprehensive reports suitable for:
- **Operations Teams**: Pass/fail status with actionable recommendations
- **Development Teams**: Detailed timing and performance metrics
- **Management**: High-level success rates and trends

### Custom Report Generation
```bash
#!/bin/bash
# generate_test_report.sh

TEST_FILE="backend/var/whatsapp/testing/evidence/enhanced_test_results.json"

echo "# WhatsApp Channel Test Report - $(date)"
echo 
echo "## Summary"
jq -r '.summary | "- Total Channels: \(.totalChannels)\n- Successful: \(.successfulChannels)\n- Failed: \(.failedChannels)\n- Success Rate: \((.successfulChannels / .totalChannels * 100) | floor)%"' $TEST_FILE

echo
echo "## Performance"
jq -r '.summary | "- Average Test Time: \(.averageTestTime)ms\n- Average Response Time: \(.averageResponseTime)ms"' $TEST_FILE

echo
echo "## Failed Channels"
jq -r '.channels | to_entries[] | select(.value.success == false) | "- Channel \(.key): \(.value.error // "Unknown error")"' $TEST_FILE

echo 
echo "## Recommendations"
FAILED_COUNT=$(jq '.summary.failedChannels' $TEST_FILE)
if [ "$FAILED_COUNT" -gt 2 ]; then
    echo "- ⚠️ High failure rate detected. Check system health."
fi

AVG_RESPONSE=$(jq '.summary.averageResponseTime' $TEST_FILE)
if (( $(echo "$AVG_RESPONSE > 500" | bc -l) )); then
    echo "- ⚠️ Slow API responses. Monitor system resources."
fi

echo
echo "## Evidence Location"
echo "- Test Results: \`backend/var/whatsapp/testing/evidence/enhanced_test_results.json\`"
echo "- Detailed Logs: \`backend/var/whatsapp/testing/evidence/detailed_logs.json\`"  
echo "- State Captures: \`backend/var/whatsapp/testing/evidence/screenshots/\`"
```

This comprehensive testing guide ensures reliable validation of the WhatsApp Channel System with clear procedures for execution, analysis, and troubleshooting.
