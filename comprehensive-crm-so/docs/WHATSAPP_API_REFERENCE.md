# WhatsApp Orchestrator API Reference

## Base URL
All API endpoints are available at: `http://localhost:8099/api/wa-orchestrator`

## Authentication
- **Type**: Basic Authentication (optional)
- **Environment Variable**: `CRM_BASIC_AUTH="username:password"`
- **SSE Support**: Query parameter authentication `?auth=BASE64(username:password)`

## Channel Management Endpoints

### Get All Channels Status
Get the current status of all 9 WhatsApp channels.

```http
GET /api/wa-orchestrator/channels
```

**Response:**
```json
{
  "success": true,
  "channels": [
    {
      "channel": 1,
      "port": 3001,
      "status": "free",
      "name": null,
      "metadata": {
        "errorCount": 0,
        "restartCount": 0,
        "lastActivity": "2024-01-15T10:30:00.000Z"
      },
      "updatedAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "summary": {
    "totalChannels": 9,
    "availableChannels": 9,
    "freeInstances": 8,
    "connectedInstances": 1,
    "errorInstances": 0,
    "startingInstances": 0
  }
}
```

### Start Channel
Start a WhatsApp instance on a specific channel (1-9).

```http
POST /api/wa-orchestrator/channels/{channel}/start
Content-Type: application/json

{
  "name": "Optional instance name"
}
```

**Parameters:**
- `channel` (path): Channel number (1-9)
- `name` (body, optional): Custom name for the instance

**Success Response (200):**
```json
{
  "success": true,
  "instance": {
    "id": "wa-instance-3001",
    "port": 3001,
    "channel": 1,
    "status": "starting",
    "name": "My WhatsApp Instance",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  },
  "channel": 1,
  "port": 3001,
  "suggestions": null
}
```

**Error Response (400):**
```json
{
  "success": false,
  "error": "Channel 1 is already in use",
  "suggestions": [
    "Available channels: 2, 3, 4",
    "Consider stopping unused instances",
    "Try restarting if channel is in error state"
  ]
}
```

### Get Channel Status
Get detailed status of a specific channel.

```http
GET /api/wa-orchestrator/channels/{channel}
```

**Success Response (200):**
```json
{
  "success": true,
  "status": "connected",
  "channel": 1,
  "port": 3001,
  "instance": {
    "id": "wa-instance-3001",
    "status": "connected",
    "metadata": {
      "phoneNumber": "+5511999887766",
      "lastActivity": "2024-01-15T10:30:00.000Z",
      "errorCount": 0
    }
  },
  "liveData": {
    "isReady": true,
    "connectionStatus": "CONNECTED",
    "batteryLevel": 85
  },
  "warning": null
}
```

### Get Channel QR Code
Retrieve QR code for channel authentication.

```http
GET /api/wa-orchestrator/channels/{channel}/qr
```

**Success Response (200):**
```json
{
  "success": true,
  "qr": "2@4HKj8N5nP...",
  "status": "qr_pending",
  "channel": 1,
  "port": 3001,
  "cached": false,
  "generated": true,
  "message": "QR code fetched successfully"
}
```

**Error Response (404):**
```json
{
  "success": false,
  "error": "QR code not available",
  "channel": 1,
  "port": 3001,
  "suggestion": "Start the channel first to generate QR code"
}
```

### Stop Channel
Stop a WhatsApp instance on a specific channel.

```http
POST /api/wa-orchestrator/channels/{channel}/stop
```

**Success Response (200):**
```json
{
  "success": true,
  "channel": 1,
  "port": 3001,
  "message": "Channel stopped successfully"
}
```

### Restart Channel
Restart a WhatsApp instance on a specific channel.

```http
POST /api/wa-orchestrator/channels/{channel}/restart
```

**Success Response (200):**
```json
{
  "success": true,
  "instance": {
    "id": "wa-instance-3001",
    "port": 3001,
    "status": "starting"
  },
  "channel": 1,
  "port": 3001,
  "suggestions": [
    "New QR code will be generated shortly",
    "Monitor status for successful restart"
  ]
}
```

### Update Channel Metadata
Update metadata for a specific channel.

```http
PUT /api/wa-orchestrator/channels/{channel}/metadata
Content-Type: application/json

{
  "metadata": {
    "customField": "value",
    "lastContact": "2024-01-15T10:30:00.000Z"
  }
}
```

**Success Response (200):**
```json
{
  "success": true,
  "channel": 1,
  "port": 3001
}
```

## Instance Management Endpoints (Port-Based)

### Start Instance by Port
Start a WhatsApp instance on a specific port (3001-3009).

```http
POST /api/wa-orchestrator/instances/{port}/start
Content-Type: application/json

{
  "name": "Optional instance name"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "instance": {
    "id": "wa-instance-3001",
    "port": 3001,
    "channel": 1,
    "status": "starting",
    "name": "My WhatsApp Instance",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  },
  "channel": 1,
  "port": 3001,
  "suggestions": null
}
```

**Error Response (400):**
```json
{
  "success": false,
  "error": "Port 3001 is already in use",
  "suggestions": [
    "Available ports: 3002, 3003, 3004",
    "Consider stopping unused instances"
  ]
}
```

### Stop Instance by Port
```http
POST /api/wa-orchestrator/instances/{port}/stop
```

**Success Response (200):**
```json
{
  "success": true,
  "channel": 1,
  "port": 3001,
  "message": "Instance stopped successfully"
}
```

### Restart Instance by Port
```http
POST /api/wa-orchestrator/instances/{port}/restart
```

**Success Response (200):**
```json
{
  "success": true,
  "instance": {
    "id": "wa-instance-3001",
    "port": 3001,
    "status": "starting"
  },
  "channel": 1,
  "port": 3001,
  "suggestions": [
    "New QR code will be generated shortly",
    "Monitor status for successful restart"
  ]
}
```

### Get Instance Status by Port
```http
GET /api/wa-orchestrator/instances/{port}
```

**Success Response (200):**
```json
{
  "success": true,
  "status": "connected",
  "channel": 1,
  "port": 3001,
  "instance": {
    "id": "wa-instance-3001",
    "status": "connected",
    "metadata": {
      "phoneNumber": "+5511999887766",
      "lastActivity": "2024-01-15T10:30:00.000Z",
      "errorCount": 0
    }
  },
  "liveData": {
    "isReady": true,
    "connectionStatus": "CONNECTED"
  },
  "warning": null
}
```

### Get Instance QR by Port
```http
GET /api/wa-orchestrator/instances/{port}/qr
```

**Success Response (200):**
```json
{
  "success": true,
  "qr": "2@4HKj8N5nP...",
  "status": "qr_pending",
  "channel": 1,
  "port": 3001,
  "cached": false,
  "generated": true,
  "message": "QR code fetched successfully"
}
```

**Error Response (404):**
```json
{
  "success": false,
  "error": "QR code not available",
  "channel": 1,
  "port": 3001,
  "suggestion": "Start the instance first to generate QR code"
}
```

### Update Instance Metadata by Port
```http
PUT /api/wa-orchestrator/instances/{port}/metadata
Content-Type: application/json

{
  "metadata": {
    "key": "value"
  }
}
```

### Force Clean Instance
⚠️ **Not Yet Implemented**

This endpoint is referenced in documentation but not currently implemented in the system.

**Planned Endpoint:**
```http
POST /api/wa-orchestrator/instances/{port}/force-clean
```

**Current Workaround:**
```bash
# Stop instance and manually clean session
curl -X POST "http://localhost:8099/api/wa-orchestrator/instances/{port}/stop"
# Then restart to get fresh session
curl -X POST "http://localhost:8099/api/wa-orchestrator/instances/{port}/start"
```

## Utility Endpoints

### Get Orchestrator Status
Get overall system status and statistics.

```http
GET /api/wa-orchestrator/status
```

**Response:**
```json
{
  "success": true,
  "totalInstances": 9,
  "totalChannels": 9,
  "availableChannels": 9,
  "freeInstances": 7,
  "connectedInstances": 2,
  "errorInstances": 0,
  "startingInstances": 0,
  "instances": [...],
  "channels": [...],
  "suggestions": [
    "7 channels available for new connections",
    "System operating normally"
  ]
}
```

### Get Next Available Channel
Find the next available channel for connection.

```http
GET /api/wa-orchestrator/next-channel
```

**Success Response (200):**
```json
{
  "success": true,
  "channel": 3,
  "port": 3003,
  "message": "Channel 3 (port 3003) is available"
}
```

**No Available Channels (409):**
```json
{
  "success": false,
  "error": "No available channels",
  "status": {
    "totalChannels": 9,
    "freeInstances": 0,
    "connectedInstances": 9
  }
}
```

### Get Free Port
Get the next free port for allocation.

```http
GET /api/wa-orchestrator/free-port
```

**Response:**
```json
{
  "success": true,
  "port": 3002,
  "channel": 2,
  "message": "Channel 2 (port 3002) is available"
}
```

## Real-Time Events (Server-Sent Events)

### Subscribe to Orchestrator Events
⚠️ **Not Yet Implemented**

Real-time events for WhatsApp orchestrator are not currently implemented.

**Planned Endpoint:**
```http
GET /api/wa-orchestrator/events
Accept: text/event-stream
```

**Available Alternative - AI Suppression Events:**
```http
GET /api/ai-suppression/events
Accept: text/event-stream
```

**Available Alternative - Conversation Events:**
```http
GET /api/conversations/events
Accept: text/event-stream
```

**Polling Workaround:**
```bash
# Poll status every 5 seconds instead of SSE
watch -n 5 'curl -s http://localhost:8099/api/wa-orchestrator/status | jq .'
```

## Bulk Operations

### Restart All Failed Channels
⚠️ **Not Yet Implemented**

This operation is referenced in troubleshooting documentation but not currently implemented.

**Planned Endpoint:**
```http
POST /api/wa-orchestrator/restart-all
```

**Current Workaround:**
```bash
# Get failed channels and restart individually
curl -s http://localhost:8099/api/wa-orchestrator/channels | \
  jq -r '.channels[] | select(.status=="error") | .channel' | \
  while read ch; do 
    curl -X POST "http://localhost:8099/api/wa-orchestrator/channels/$ch/restart"
  done
```

### Restart Failed Instances
⚠️ **Not Yet Implemented**

This operation is referenced in operational procedures but not currently implemented.

**Planned Endpoint:**
```http
POST /api/wa-orchestrator/restart-failed
```

**Current Workaround:**
```bash
# Identify and restart failed instances individually
for ch in {1..9}; do
  status=$(curl -s http://localhost:8099/api/wa-orchestrator/channels/$ch | jq -r '.status // "unknown"')
  if [ "$status" = "error" ]; then
    echo "Restarting failed channel $ch"
    curl -X POST "http://localhost:8099/api/wa-orchestrator/channels/$ch/restart"
  fi
done
```

## Environmental Prerequisites

### System Requirements
- **Node.js**: Version 18+ with ESM support
- **System Memory**: Minimum 4GB RAM for stable operation
- **Network**: Stable internet connection to WhatsApp servers
- **Disk Space**: 2GB free space for session data and logs

### Required CLI Tools
The system procedures require these tools:

```bash
# Verify tool availability
which curl || echo "❌ curl required for API calls"
which jq || echo "❌ jq required for JSON processing"
which lsof || echo "❌ lsof required for port conflict detection"
which netstat || echo "❌ netstat required for network status"
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

**Alternatives for Docker/Cloud Environments:**
```bash
# Instead of: lsof -i :3001
curl -s --connect-timeout 1 http://localhost:3001 && echo "Port in use" || echo "Port free"

# Instead of: jq processing
curl -s http://localhost:8099/api/wa-orchestrator/status | python3 -m json.tool
```

### Production Security Notes
- **HTTPS Required**: Use HTTPS in production environments
- **Authentication**: Always configure `CRM_BASIC_AUTH` with strong credentials
- **Firewall**: Restrict API access to authorized networks only
- **Rate Limiting**: Monitor and enforce rate limits to prevent abuse
- **Audit Logging**: Enable comprehensive logging for security monitoring

## Error Handling

### HTTP Status Codes
- `200`: Success
- `400`: Bad Request (invalid parameters)
- `401`: Unauthorized (authentication required)
- `404`: Not Found (channel/instance not found)
- `409`: Conflict (resource already in use)
- `500`: Internal Server Error

### Error Response Format
```json
{
  "success": false,
  "error": "Descriptive error message",
  "code": "ERROR_CODE",
  "suggestions": [
    "Actionable suggestion 1",
    "Actionable suggestion 2"
  ],
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### Common Error Codes
- `CHANNEL_IN_USE`: Channel is already running
- `INVALID_CHANNEL`: Channel number out of range (1-9)
- `INVALID_PORT`: Port number out of range (3001-3009)
- `PROCESS_START_FAILED`: Unable to start WhatsApp process
- `QR_TIMEOUT`: QR code generation timeout
- `AUTH_TIMEOUT`: Authentication timeout
- `INSTANCE_NOT_FOUND`: Instance doesn't exist

## Rate Limiting

### Limits
- **Channel Operations**: 10 requests per minute per channel
- **Status Checks**: 60 requests per minute
- **QR Requests**: 20 requests per minute per channel

### Rate Limit Headers
```http
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 7
X-RateLimit-Reset: 1642248600
```

## SDK Examples

### JavaScript/Node.js
```javascript
class WhatsAppOrchestratorClient {
  constructor(baseUrl = 'http://localhost:8099') {
    this.baseUrl = baseUrl;
  }

  async startChannel(channel, name = null) {
    const response = await fetch(`${this.baseUrl}/api/wa-orchestrator/channels/${channel}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    return response.json();
  }

  async getChannelStatus(channel) {
    const response = await fetch(`${this.baseUrl}/api/wa-orchestrator/channels/${channel}`);
    return response.json();
  }

  async getQRCode(channel) {
    const response = await fetch(`${this.baseUrl}/api/wa-orchestrator/channels/${channel}/qr`);
    return response.json();
  }
}

// Usage
const client = new WhatsAppOrchestratorClient();
const result = await client.startChannel(1, 'My Instance');
console.log(result);
```

### Python
```python
import requests
import json

class WhatsAppOrchestratorClient:
    def __init__(self, base_url='http://localhost:8099'):
        self.base_url = base_url
    
    def start_channel(self, channel, name=None):
        url = f"{self.base_url}/api/wa-orchestrator/channels/{channel}/start"
        payload = {}
        if name:
            payload['name'] = name
        
        response = requests.post(url, json=payload)
        return response.json()
    
    def get_channel_status(self, channel):
        url = f"{self.base_url}/api/wa-orchestrator/channels/{channel}"
        response = requests.get(url)
        return response.json()

# Usage
client = WhatsAppOrchestratorClient()
result = client.start_channel(1, 'My Instance')
print(result)
```

### cURL Examples

**Start a channel:**
```bash
curl -X POST "http://localhost:8099/api/wa-orchestrator/channels/1/start" \
  -H "Content-Type: application/json" \
  -d '{"name": "Production Instance"}'
```

**Get QR code:**
```bash
curl "http://localhost:8099/api/wa-orchestrator/channels/1/qr"
```

**Subscribe to events:**
```bash
curl -N "http://localhost:8099/api/wa-orchestrator/events"
```

## Webhook Integration

The system supports webhook notifications for external integrations:

### Webhook Configuration
```javascript
// Environment variables
WEBHOOK_URL=https://your-app.com/webhook
WEBHOOK_SECRET=your-secret-key
```

### Webhook Events
- Channel status changes
- QR code generation
- Authentication success/failure
- Error notifications

### Webhook Payload
```json
{
  "event": "channel-status-change",
  "channel": 1,
  "port": 3001,
  "status": "connected",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "signature": "sha256=..."
}
```