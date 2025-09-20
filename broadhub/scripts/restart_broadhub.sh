#!/usr/bin/env bash
set -euo pipefail

# BroadHub stub service script
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BROADHUB_PORT=${BROADHUB_PORT:-3200}

echo "[BroadHub] Starting BroadHub on port $BROADHUB_PORT"

# Kill existing process on this port
if lsof -iTCP:"$BROADHUB_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[BroadHub] Killing existing process on port $BROADHUB_PORT"
  kill -9 $(lsof -ti tcp:"$BROADHUB_PORT") 2>/dev/null || true
  sleep 0.2
fi

# Start BroadHub server
node -e "
const express = require('express');
const app = express();
const port = $BROADHUB_PORT;

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'broadhub', port: port, status: 'running' });
});

app.get('/status', (req, res) => {
  res.json({ 
    status: 'active',
    service: 'broadhub-stub', 
    version: '1.0.0-stub',
    uptime: process.uptime()
  });
});

app.post('/broadcast', (req, res) => {
  console.log('Mock broadcast request:', req.body);
  res.json({ 
    success: true, 
    broadcastId: 'mock_' + Date.now(),
    message: 'Broadcast would be sent in production environment',
    recipients: req.body.recipients || []
  });
});

app.listen(port, 'localhost', () => {
  console.log(\`BroadHub server running on http://localhost:\${port}\`);
});
" &

BROADHUB_PID=$!
echo $BROADHUB_PID > "$ROOT_DIR/.broadhub.pid"

echo "[BroadHub] Started BroadHub (PID: $BROADHUB_PID) on port $BROADHUB_PORT"
echo "[BroadHub] Health check: http://localhost:$BROADHUB_PORT/health"