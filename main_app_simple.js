const express = require('express');
const fs = require('fs');
const path = require('path');

// Global error handlers to prevent crashes
process.on('uncaughtException', (error) => {
  console.error('🚨 Uncaught Exception (non-fatal):', error.message);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 Unhandled Rejection (non-fatal):', reason);
});

const app = express();
const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

console.log('🚀 Starting SKINCOS AI Enterprise System (Simplified Mode)...');

// Basic middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Basic CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  next();
});

// Serve static files
try {
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/whatsapp', express.static(path.join(__dirname, 'whatsapp-official-module/public')));
} catch (e) {
  console.warn('⚠️ Static file serving disabled:', e.message);
}

// Basic health check
app.get('/v1/health', (req, res) => {
  res.json({
    success: true,
    system: 'SKINCOS AI Enterprise System v2.0 (Simplified)',
    status: 'running',
    mode: 'simplified',
    components: {
      server: { status: 'running', port: PORT },
      database: { status: 'disabled', message: 'Running in memory mode' },
      redis: { status: 'disabled', message: 'Memory fallback' }
    },
    timestamp: new Date().toISOString()
  });
});

// Basic admin page
app.get('/admin', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>SKINCOS AI - Simplified Mode</title>
  <style>
    body { font-family: system-ui; margin: 40px; background: #f5f5f5; }
    .card { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .status { color: #22c55e; font-weight: bold; }
    .warning { color: #f59e0b; font-weight: bold; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🚀 SKINCOS AI System</h1>
    <p class="status">✅ Server Running (Simplified Mode)</p>
    <p class="warning">⚠️ Some enterprise features are disabled</p>
    
    <h3>Available Services:</h3>
    <ul>
      <li>✅ Basic Web Server</li>
      <li>✅ Health Check API</li>
      <li>⚠️ Enterprise API (limited)</li>
      <li>⚠️ Database Features (disabled)</li>
    </ul>
    
    <h3>Quick Links:</h3>
    <ul>
      <li><a href="/v1/health" target="_blank">System Health</a></li>
      <li><a href="/">Main Dashboard</a></li>
    </ul>
    
    <p><small>Server started at: ${new Date().toISOString()}</small></p>
  </div>
</body>
</html>
  `);
});

// Root fallback
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>SKINCOS AI - Dashboard</title>
  <style>
    body { font-family: system-ui; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; }
    .container { max-width: 1200px; margin: 0 auto; padding: 40px 20px; }
    .header { text-align: center; margin-bottom: 50px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
    .card { background: rgba(255,255,255,0.1); padding: 25px; border-radius: 10px; text-align: center; }
    .card h3 { margin: 0 0 15px 0; font-size: 1.5rem; }
    .status { background: rgba(34, 197, 94, 0.2); padding: 10px; border-radius: 5px; margin: 10px 0; }
    .btn { background: rgba(255,255,255,0.2); color: white; padding: 10px 20px; border: none; border-radius: 25px; text-decoration: none; display: inline-block; margin: 5px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎯 SKINCOS AI System</h1>
      <p>Sistema Integrado de Gestão Empresarial</p>
      <div class="status">✅ Sistema Funcionando em Modo Simplificado</div>
    </div>
    
    <div class="grid">
      <div class="card">
        <h3>📊 Dashboard</h3>
        <p>Painel principal do sistema</p>
        <a href="/admin" class="btn">Abrir Dashboard</a>
      </div>
      
      <div class="card">
        <h3>🔍 Status do Sistema</h3>
        <p>Verificar saúde dos serviços</p>
        <a href="/v1/health" class="btn">Ver Status</a>
      </div>
      
      <div class="card">
        <h3>📱 WhatsApp</h3>
        <p>Central de atendimento</p>
        <span style="opacity: 0.7;">Em manutenção</span>
      </div>
      
      <div class="card">
        <h3>👥 CRM</h3>
        <p>Gestão de clientes</p>
        <span style="opacity: 0.7;">Em manutenção</span>
      </div>
    </div>
    
    <div style="text-align: center; margin-top: 40px; opacity: 0.8;">
      <p>Servidor iniciado em: ${new Date().toISOString()}</p>
    </div>
  </div>
</body>
</html>
  `);
});

// Catch-all for other routes (avoid wildcard issues)
app.use((req, res) => {
  res.status(200).json({
    message: 'SKINCOS AI System - Simplified Mode',
    status: 'running',
    method: req.method,
    path: req.path,
    timestamp: new Date().toISOString(),
    available_endpoints: [
      'GET /',
      'GET /admin',
      'GET /v1/health'
    ]
  });
});

// Start server immediately
console.log(`📡 Binding to port ${PORT}...`);

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('✅ SKINCOS AI Enterprise System started successfully!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🎯 SKINCOS AI System: http://0.0.0.0:${PORT}`);
  console.log(`📊 Main Dashboard: http://0.0.0.0:${PORT}`);
  console.log(`🔐 Admin Panel: http://0.0.0.0:${PORT}/admin`);
  console.log(`🔗 System Health: http://0.0.0.0:${PORT}/v1/health`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🌍 Environment: ${NODE_ENV}`);
  console.log(`🔒 Mode: Simplified (Enterprise features disabled)`);
  console.log(`📊 Status: Server listening on port ${PORT} ✅`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  // Try to load enterprise modules in background (non-blocking)
  setTimeout(() => {
    console.log('🔄 Attempting to load enterprise modules in background...');
    try {
      // Try to load and initialize enterprise features if available
      loadEnterpriseModulesInBackground();
    } catch (error) {
      console.warn('⚠️ Enterprise modules unavailable (system continues normally):', error.message);
    }
  }, 2000); // 2-second delay to ensure server is fully running
});

// Add server error handler
server.on('error', (error) => {
  console.error('🚨 Server error:', error.message);
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use`);
    process.exit(1); // Only exit for port conflicts
  }
});

// Non-blocking enterprise module loader
async function loadEnterpriseModulesInBackground() {
  try {
    console.log('🔧 Loading enterprise API routes...');
    
    // Try to require enterprise modules
    const { router: enterpriseRouter } = require('./routes/enterprise-api');
    
    // Mount enterprise routes if successful
    app.use('/v1', enterpriseRouter);
    console.log('✅ Enterprise API routes loaded successfully');
    
  } catch (error) {
    console.warn('⚠️ Enterprise API routes failed to load:', error.message);
    
    // Create basic fallback routes
    app.use('/v1', express.Router()
      .get('/status', (req, res) => {
        res.json({ status: 'basic_mode', message: 'Enterprise features unavailable' });
      })
      .get('*', (req, res) => {
        res.status(503).json({ error: 'Enterprise API unavailable', mode: 'simplified' });
      })
    );
    console.log('✅ Fallback API routes configured');
  }
}

console.log('🎬 SKINCOS AI System initialization complete');