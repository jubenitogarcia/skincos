# WhatsApp Unified System Architecture

## Overview

The WhatsApp Unified System is a robust, production-ready WhatsApp communication module that provides **single-instance management** with comprehensive session persistence, webhook support, and seamless CRM integration. This architecture replaces the previous multi-channel approach with a consolidated, reliable, and scalable solution running on **port 3003**.

## System Components

### 1. Core Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    CRM Frontend (Port 5000)                │
│                WhatsApp Management Interface               │
└─────────────────┬───────────────────────────────────────────┘
                  │ HTTP/API
┌─────────────────┴───────────────────────────────────────────┐
│                 CRM Backend API (Port 8099)                │
│            WhatsApp Service Integration Layer              │
└─────────────────┬───────────────────────────────────────────┘
                  │ REST API/Webhooks
┌─────────────────┴───────────────────────────────────────────┐
│              WhatsApp Official Module (Port 3003)          │
│    Single Unified Instance with Session Persistence        │
└─────────────────┬───────────────────────────────────────────┘
                  │ whatsapp-web.js
┌─────────────────┴───────────────────────────────────────────┐
│                      WhatsApp Web                          │
│            Chromium Browser with LocalAuth                 │
└─────────────────────────────────────────────────────────────┘
```

### 2. Module Configuration

| Component | Value | Description |
|-----------|-------|-------------|
| **Port** | 3003 | Single port for all WhatsApp communication |
| **Client ID** | `whatsapp-official-replit` | Fixed identifier for session persistence |
| **Auth Strategy** | LocalAuth | Persistent session storage with recovery |
| **Status Types** | `disconnected`, `initializing`, `qr`, `ready`, `error` | Lifecycle states |

### 3. Key Services

#### WhatsApp Official Module (`official-whatsapp.js`)
- **Purpose**: Core WhatsApp communication service with unified session management
- **Location**: `whatsapp-official-module/official-whatsapp.js`
- **Key Features**:
  - Single persistent WhatsApp session with automatic recovery
  - Comprehensive error handling and graceful shutdown procedures
  - Real-time QR code generation and status tracking
  - Full REST API with webhook support
  - Production-ready security with HMAC signature verification

#### Session Management System
- **Strategy**: LocalAuth with fixed CLIENT_ID for consistency
- **Persistence**: File-based session storage with automatic cleanup
- **Recovery**: Automatic reconnection and session restoration
- **Security**: File-based session data with secure browser profile management (encryption recommended for production)

#### Webhook Integration System
- **Features**: Complete webhook delivery system with retry logic
- **Security**: HMAC SHA-256 signature verification for all webhook payloads
- **Reliability**: Configurable retry attempts with exponential backoff
- **Monitoring**: Comprehensive delivery tracking and error reporting

## System Lifecycle States

### State Transitions

```
[disconnected] ──initialize──► [initializing] ──browser ready──► [qr]
      ▲                                                          │
      │                                                          │ QR scanned
      │                                                          ▼
 [disconnect] ◄──error──── [ready] ◄──authenticated──── [authenticating]
      │                      │
      │ process exit          │ send messages
      ▼                      ▼
[disconnected]           [operational]
```

### State Descriptions

1. **disconnected**: Module is offline and ready to be initialized
2. **initializing**: WhatsApp client is starting up and browser is launching
3. **qr**: Waiting for QR code to be scanned for authentication
4. **authenticating**: Processing authentication after QR code scan
5. **ready**: Successfully authenticated and ready for full operation
6. **operational**: Actively sending/receiving messages
7. **error**: Encountered an error and attempting recovery

## Data Flow

### 1. Initialization Flow
```
System Start → Module Init → Browser Launch → QR Generation → User Scan → Authentication → Ready State
```

### 2. Message Flow
```
API Request → Validation → WhatsApp Client → Message Delivery → Webhook Dispatch → Response
```

### 3. Status Monitoring
```
WhatsApp Events → Status Update → CRM Integration → Frontend Display → User Notification
```

## Configuration

### Environment Variables
- `WHATSAPP_PORT`: Service port (default: 3003)
- `WHATSAPP_CLIENT_ID`: Fixed client identifier (default: 'whatsapp-official-replit')
- `WHATSAPP_DATA_PATH`: Session storage path
- `CHROMIUM_EXECUTABLE_PATH`: Replit-optimized Chromium path
- `WHATSAPP_USER_DATA_DIR`: Browser profile directory

### Port Configuration
- **WhatsApp Service**: Port 3003 (unified communication)
- **CRM Backend**: Port 8099 (API integration)
- **CRM Frontend**: Port 5000 (user interface)
- **Agent Zero**: Port 6800 (AI integration)

### Browser Configuration
```javascript
{
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-crash-reporter',
    '--no-first-run',
    '--disable-gpu'
  ],
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH
}
```

### Authentication Configuration
```javascript
{
  authStrategy: new LocalAuth({
    clientId: 'whatsapp-official-replit',
    dataPath: './sessions/session-whatsapp-official-replit'
  }),
  puppeteer: puppeteerConfig
}
```

## API Endpoints

### Core API Routes

#### Status and Health
- `GET /api/status` - Get current WhatsApp connection status
- `GET /api/health` - Health check endpoint
- `GET /api/qr` - Retrieve current QR code for authentication

#### Messaging Operations
- `POST /api/send-message` - Send text/media messages
- `POST /api/send-media` - Send media files with captions
- `POST /api/send-location` - Send location messages

#### Contact and Chat Management
- `GET /api/contacts` - Retrieve contact list
- `GET /api/chats` - Get chat conversations
- `GET /api/groups` - List group chats
- `POST /api/create-group` - Create new group chat

#### System Operations
- `POST /api/restart` - Restart WhatsApp client
- `POST /api/logout` - Logout and clear session
- `GET /api/client-info` - Get authenticated client information

### Legacy Compatibility
- `POST /send` - Legacy message sending endpoint
- `GET /chats` - Legacy chat listing endpoint

## Webhook System

### Webhook Events
- `message` - Incoming messages (text, media, location)
- `message_ack` - Message acknowledgment updates
- `qr` - QR code generation events
- `ready` - Client ready for operations
- `auth_failure` - Authentication failures
- `disconnected` - Client disconnection events

### Webhook Security
```javascript
{
  signature: 'sha256=' + hmac_sha256(webhook_secret, payload),
  headers: {
    'X-Webhook-Id': webhook.id,
    'X-Signature': signature,
    'X-Event-Id': event.id,
    'X-Event-Type': event.type,
    'X-Event-Version': '1'
  }
}
```

### Webhook Reliability
- **Max Attempts**: 3 retry attempts per webhook
- **Retry Logic**: Exponential backoff (1s, 2s, 4s)
- **Timeout**: 10-second timeout per webhook delivery
- **Tracking**: Complete delivery status tracking and logging

## Performance Characteristics

### System Capacity
- **Concurrent Sessions**: Single optimized session
- **Response Times**: Sub-second for most operations
- **Memory Usage**: ~100-150MB for single instance
- **CPU Usage**: Low during idle, moderate during message processing

### Monitoring Metrics
- Connection uptime and stability
- Message delivery success rates
- QR authentication success rates
- API response times
- Webhook delivery success rates

## Security Features

### Process Security
- Independent Node.js process with crash protection
- Graceful shutdown handling with cleanup procedures
- Automatic recovery from unexpected terminations

### Data Protection
- File-based session storage with automatic expiry (encryption recommended for production)
- Secure browser profile management
- Temporary QR code storage with automatic cleanup
- No persistent storage of sensitive message content

### Network Security
- Local-only communication between services
- CORS configured for frontend-backend communication
- Basic rate limiting capabilities (enhanced rate limiting recommended for production)
- HTTPS enforcement for webhook deliveries

## Integration Points

### CRM System Integration
- **Database**: PostgreSQL for conversation history
- **Authentication**: Replit Auth integration
- **Real-time Updates**: WebSocket/SSE for live status updates
- **API Gateway**: Unified API access through CRM backend

### Agent Zero Integration
- **Port**: 6800
- **Purpose**: AI-powered conversation handling
- **Communication**: HTTP API calls for message processing
- **Intelligence**: Automated response generation and conversation analysis

### External Webhook Integration
- **Flexibility**: Support for multiple webhook endpoints
- **Security**: HMAC signature verification
- **Reliability**: Retry logic and delivery confirmation
- **Monitoring**: Complete delivery tracking and error reporting

## Operational Procedures

### Authentication Process
1. **Initialize Module**: Start WhatsApp service on port 3003
2. **QR Generation**: Browser opens and generates QR code
3. **User Scan**: User scans QR code with WhatsApp mobile app
4. **Authentication**: System validates and stores session
5. **Ready State**: Service becomes operational for message handling

### Session Management
- **Persistence**: Sessions persist across service restarts
- **Recovery**: Automatic session restoration on startup
- **Cleanup**: Automatic cleanup of invalid/expired sessions
- **Monitoring**: Real-time session health monitoring

### Error Recovery
- **Auto-Restart**: Automatic client restart on connection failures
- **Session Recovery**: Attempt to restore existing session before QR generation
- **Fallback**: Generate new QR code if session recovery fails
- **Logging**: Comprehensive error logging for troubleshooting

## Production Security Recommendations

### Authentication Security
- **NO_AUTH Mode**: Disable for production environments
- **Session Encryption**: Enable session data encryption
- **Access Control**: Implement API key-based access control
- **Rate Limiting**: Configure aggressive rate limiting for public endpoints

### Webhook Security
- **Secret Management**: Use strong, randomly generated webhook secrets
- **Signature Verification**: Always verify HMAC signatures
- **HTTPS Only**: Enforce HTTPS for all webhook deliveries
- **IP Whitelisting**: Restrict webhook sources to known IPs

### System Security
- **Process Isolation**: Run in isolated container/environment
- **Resource Limits**: Configure memory and CPU limits
- **Network Security**: Use firewall rules to restrict access
- **Monitoring**: Implement comprehensive security monitoring

## Troubleshooting Guide

### Common Issues

#### QR Code Not Generating
- Check Chromium executable path configuration
- Verify browser directory permissions
- Review process logs for browser startup errors

#### Session Not Persisting
- Verify CLIENT_ID consistency across restarts
- Check session directory write permissions
- Review LocalAuth configuration settings

#### Message Delivery Failures
- Confirm WhatsApp client is in 'ready' state
- Verify recipient phone number format
- Check API endpoint authentication

#### Webhook Delivery Issues
- Verify webhook URL accessibility
- Check HMAC signature verification
- Review webhook endpoint response codes

### Monitoring Commands

```bash
# Check service status
curl http://localhost:3003/api/status

# Monitor process logs
tail -f whatsapp-official-module/logs/whatsapp.log

# Test webhook delivery
curl -X POST http://localhost:3003/api/test-webhook

# Restart service
curl -X POST http://localhost:3003/api/restart
```

## Future Enhancements

### Scalability Improvements
- Multi-instance support with load balancing
- Distributed session management
- Horizontal scaling capabilities
- Performance optimization for high-volume scenarios

### Feature Enhancements
- Advanced message filtering and routing
- Conversation analytics and insights
- Multi-language support
- Enhanced media handling capabilities

### Security Enhancements
- End-to-end encryption for stored sessions
- Advanced authentication methods
- Comprehensive audit logging
- Security compliance certifications