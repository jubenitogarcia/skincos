// WhatsApp Gateway Bot Communication API - Stub Implementation
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
const ACCOUNT_ID = process.env.ACCOUNT_ID || PORT;

app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    ok: true, 
    service: 'whatsapp-gateway', 
    port: PORT,
    accountId: ACCOUNT_ID,
    status: 'running' 
  });
});

// Get instances metadata
app.get('/instances', (req, res) => {
  try {
    const metaPath = path.join(__dirname, '../wa_instances_meta.json');
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

// Status endpoint
app.get('/status', (req, res) => {
  res.json({ 
    status: 'active',
    service: 'whatsapp-gateway-stub', 
    version: '1.0.0-stub',
    uptime: process.uptime(),
    instanceId: ACCOUNT_ID,
    port: PORT
  });
});

// Mock send message endpoint
app.post('/send', (req, res) => {
  console.log('Mock send request:', req.body);
  res.json({ 
    success: true, 
    messageId: 'mock_' + Date.now(),
    message: 'Message would be sent in production environment',
    to: req.body.to,
    content: req.body.content
  });
});

// Mock webhook endpoint
app.post('/webhook', (req, res) => {
  console.log('Webhook received:', req.body);
  res.json({ success: true, processed: true });
});

// Start server
app.listen(PORT, 'localhost', () => {
  console.log(`WhatsApp Gateway Bot API running on http://localhost:${PORT}`);
  console.log(`Account ID: ${ACCOUNT_ID}`);
});