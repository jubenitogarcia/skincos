#!/usr/bin/env bash
set -euo pipefail

# WhatsApp Gateway stub service script
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
GW_PORT=${PORT:-3001}

echo "[Gateway] Starting WhatsApp Gateway on port $GW_PORT"

# Kill existing process on this port
if lsof -iTCP:"$GW_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[Gateway] Killing existing process on port $GW_PORT"
  kill -9 $(lsof -ti tcp:"$GW_PORT") 2>/dev/null || true
  sleep 0.2
fi

# Start Gateway server
node -e "
const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const port = $GW_PORT;

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'whatsapp-gateway', port: port, status: 'running' });
});

app.get('/instances', (req, res) => {
  try {
    const metaPath = path.join('$ROOT_DIR', '../wa_instances_meta.json');
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      res.json(meta);
    } else {
      res.json({ instances: {}, message: 'No instances metadata found' });
    }
  } catch (error) {
    res.json({ instances: {}, error: error.message });
  }
});

app.get('/status', (req, res) => {
  res.json({ 
    status: 'active',
    service: 'whatsapp-gateway-stub', 
    version: '1.0.0-stub',
    uptime: process.uptime(),
    instanceId: process.env.ACCOUNT_ID || '$GW_PORT'
  });
});

app.post('/send', (req, res) => {
  console.log('Mock send request:', req.body);
  res.json({ 
    success: true, 
    messageId: 'mock_' + Date.now(),
    message: 'Message would be sent in production environment' 
  });
});

app.listen(port, 'localhost', () => {
  console.log(\`WhatsApp Gateway server running on http://localhost:\${port}\`);
});
" &

GW_PID=$!
echo $GW_PID > "$ROOT_DIR/.gateway.pid"

echo "[Gateway] Started WhatsApp Gateway (PID: $GW_PID) on port $GW_PORT"
echo "[Gateway] Health check: http://localhost:$GW_PORT/health"