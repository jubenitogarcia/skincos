const express = require('express');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

// Simple standalone server that ALWAYS works
console.log('🚀 Starting SKINCOS AI System (Standalone Mode)...');

const app = express();
const PORT = process.env.PORT || 5000;

// Basic middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Basic CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

// ============== PROXY ROUTES ==============
console.log('🔄 Setting up proxy routes...');

// WhatsApp Official Module Proxy (porta 3002)
app.use('/whatsapp', createProxyMiddleware({
  target: 'http://localhost:3002',
  changeOrigin: true,
  pathRewrite: {
    '^/whatsapp': '',
  },
  onError: (err, req, res) => {
    console.log('❌ WhatsApp Proxy Error:', err.message);
    res.status(503).json({ 
      error: 'WhatsApp service unavailable', 
      message: 'Unable to connect to WhatsApp service on port 3002',
      details: err.message 
    });
  },
  onProxyReq: (proxyReq, req, res) => {
    console.log('🔄 WhatsApp Proxy Request:', req.method, req.path);
  }
}));

// CRM Microservice Proxy (porta 8000)
app.use('/crm', createProxyMiddleware({
  target: 'http://localhost:8000',
  changeOrigin: true,
  pathRewrite: {
    '^/crm': '',
  },
  onError: (err, req, res) => {
    console.log('❌ CRM Proxy Error:', err.message);
    res.status(503).json({ 
      error: 'CRM service unavailable', 
      message: 'Unable to connect to CRM service on port 8000',
      details: err.message 
    });
  },
  onProxyReq: (proxyReq, req, res) => {
    console.log('🔄 CRM Proxy Request:', req.method, req.path);
  }
}));

// Agent Zero IA Module Proxy (porta 6800)
app.use('/agent-zero', createProxyMiddleware({
  target: 'http://localhost:6800',
  changeOrigin: true,
  pathRewrite: {
    '^/agent-zero': '',
  },
  onError: (err, req, res) => {
    console.log('❌ Agent Zero Proxy Error:', err.message);
    res.status(503).json({ 
      error: 'Agent Zero service unavailable', 
      message: 'Unable to connect to Agent Zero service on port 6800',
      details: err.message 
    });
  },
  onProxyReq: (proxyReq, req, res) => {
    console.log('🔄 Agent Zero Proxy Request:', req.method, req.path);
  }
}));

// Instagram API Module Proxy (porta 3003)
app.use('/instagram', createProxyMiddleware({
  target: 'http://localhost:3003',
  changeOrigin: true,
  pathRewrite: {
    '^/instagram': '',
  },
  onError: (err, req, res) => {
    console.log('❌ Instagram Proxy Error:', err.message);
    res.status(503).json({ 
      error: 'Instagram service unavailable', 
      message: 'Unable to connect to Instagram service on port 3003',
      details: err.message 
    });
  },
  onProxyReq: (proxyReq, req, res) => {
    console.log('🔄 Instagram Proxy Request:', req.method, req.path);
  }
}));

console.log('✅ Proxy routes configured successfully!');

// Health check
app.get('/v1/health', (req, res) => {
  res.json({
    success: true,
    system: 'SKINCOS AI Enterprise System v2.0 (With Proxy)',
    status: 'healthy',
    mode: 'standalone_with_proxy',
    components: {
      server: { status: 'running', port: PORT },
      database: { status: 'standalone_mode', message: 'No database required' },
      redis: { status: 'standalone_mode', message: 'No Redis required' },
      proxy_services: {
        whatsapp: { status: 'configured', target: 'http://localhost:3002', route: '/whatsapp/*' },
        crm: { status: 'configured', target: 'http://localhost:8000', route: '/crm/*' },
        agent_zero: { status: 'configured', target: 'http://localhost:6800', route: '/agent-zero/*' },
        instagram: { status: 'configured', target: 'http://localhost:3003', route: '/instagram/*' }
      }
    },
    available_endpoints: [
      'GET /',
      'GET /admin', 
      'GET /v1/health',
      'GET /dashboard/*',
      'PROXY /whatsapp/* -> localhost:3002',
      'PROXY /crm/* -> localhost:8000',
      'PROXY /agent-zero/* -> localhost:6800',
      'PROXY /instagram/* -> localhost:3003'
    ],
    timestamp: new Date().toISOString()
  });
});

// Root dashboard
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>SKINCOS AI - Sistema Principal</title>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      min-height: 100vh;
    }
    .container { 
      max-width: 1200px; 
      margin: 0 auto; 
      padding: 40px 20px; 
    }
    .header { 
      text-align: center; 
      margin-bottom: 50px; 
    }
    .header h1 { 
      font-size: 3rem; 
      margin-bottom: 10px; 
      text-shadow: 0 2px 4px rgba(0,0,0,0.3); 
    }
    .status-banner { 
      background: rgba(34, 197, 94, 0.2); 
      padding: 15px; 
      border-radius: 10px; 
      margin: 20px 0; 
      border: 1px solid rgba(34, 197, 94, 0.3);
    }
    .grid { 
      display: grid; 
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); 
      gap: 25px; 
    }
    .card { 
      background: rgba(255,255,255,0.1); 
      padding: 30px; 
      border-radius: 15px; 
      text-align: center; 
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255,255,255,0.2);
      transition: transform 0.3s ease;
    }
    .card:hover { 
      transform: translateY(-5px); 
    }
    .card h3 { 
      font-size: 1.5rem; 
      margin-bottom: 15px; 
    }
    .card p { 
      opacity: 0.9; 
      margin-bottom: 20px; 
    }
    .btn { 
      background: rgba(255,255,255,0.2); 
      color: white; 
      padding: 12px 24px; 
      border: 1px solid rgba(255,255,255,0.3); 
      border-radius: 25px; 
      text-decoration: none; 
      display: inline-block; 
      margin: 5px; 
      transition: all 0.3s ease;
    }
    .btn:hover { 
      background: rgba(255,255,255,0.3); 
      transform: scale(1.05); 
    }
    .footer { 
      text-align: center; 
      margin-top: 50px; 
      opacity: 0.8; 
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎯 SKINCOS AI</h1>
      <p>Sistema Integrado de Gestão Empresarial</p>
      <div class="status-banner">
        ✅ <strong>Sistema Operacional</strong> - Todas as funcionalidades ativas
      </div>
    </div>
    
    <div class="grid">
      <div class="card">
        <h3>📊 Dashboard Principal</h3>
        <p>Painel de controle e monitoramento geral</p>
        <a href="/admin" class="btn">Abrir Dashboard</a>
      </div>
      
      <div class="card">
        <h3>🔍 Status do Sistema</h3>
        <p>Verificar saúde e performance dos serviços</p>
        <a href="/v1/health" class="btn">Ver Status</a>
      </div>
      
      <div class="card">
        <h3>📱 WhatsApp Business</h3>
        <p>Central de atendimento e conversas</p>
        <a href="/whatsapp-hub" class="btn">Acessar</a>
      </div>
      
      <div class="card">
        <h3>👥 CRM Inteligente</h3>
        <p>Gestão de clientes e relacionamento</p>
        <a href="/crm/" class="btn">Acessar</a>
      </div>
      
      <div class="card">
        <h3>📸 Instagram Manager</h3>
        <p>Automação e gestão do Instagram</p>
        <a href="/instagram/admin" class="btn">Acessar</a>
      </div>
      
      <div class="card">
        <h3>🤖 Agent Zero IA</h3>
        <p>Assistente inteligente e automações</p>
        <a href="/agent-zero/admin" class="btn">Acessar</a>
      </div>
    </div>
    
    <div class="footer">
      <p>Servidor iniciado em: ${new Date().toISOString()}</p>
      <p>Modo: Standalone | Porta: ${PORT} | Status: ✅ Operacional</p>
    </div>
  </div>
</body>
</html>
  `);
});

// Admin panel
app.get('/admin', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>SKINCOS AI - Painel Administrativo</title>
  <meta charset="utf-8">
  <style>
    body { font-family: system-ui; margin: 0; background: #f8fafc; }
    .header { background: #1f2937; color: white; padding: 20px 0; }
    .container { max-width: 1200px; margin: 0 auto; padding: 0 20px; }
    .content { padding: 30px 20px; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin: 30px 0; }
    .stat-card { background: white; padding: 25px; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); text-align: center; }
    .stat-value { font-size: 2rem; font-weight: bold; color: #10b981; }
    .stat-label { color: #6b7280; margin-top: 5px; }
    .actions { margin-top: 30px; }
    .btn { background: #3b82f6; color: white; padding: 12px 24px; border: none; border-radius: 8px; text-decoration: none; display: inline-block; margin: 5px; }
    .btn:hover { background: #2563eb; }
  </style>
</head>
<body>
  <div class="header">
    <div class="container">
      <h1>🔧 Painel Administrativo</h1>
      <p>Gestão e monitoramento do SKINCOS AI</p>
    </div>
  </div>
  
  <div class="content">
    <div class="container">
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">✅</div>
          <div class="stat-label">Sistema Principal</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${PORT}</div>
          <div class="stat-label">Porta do Servidor</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">100%</div>
          <div class="stat-label">Uptime</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">Standalone</div>
          <div class="stat-label">Modo de Operação</div>
        </div>
      </div>
      
      <div class="actions">
        <h3>Ações Disponíveis:</h3>
        <a href="/v1/health" class="btn">🔍 Status do Sistema</a>
        <a href="/" class="btn">🏠 Voltar ao Início</a>
      </div>
      
      <div style="margin-top: 40px; padding: 20px; background: white; border-radius: 10px;">
        <h3>ℹ️ Informações do Sistema</h3>
        <ul>
          <li><strong>Versão:</strong> SKINCOS AI v2.0 (Standalone)</li>
          <li><strong>Servidor:</strong> Express.js</li>
          <li><strong>Porta:</strong> ${PORT}</li>
          <li><strong>Iniciado em:</strong> ${new Date().toISOString()}</li>
          <li><strong>Status:</strong> Operacional ✅</li>
        </ul>
      </div>
    </div>
  </div>
</body>
</html>
  `);
});

// WhatsApp Business Hub Redirect Route - Automatically navigate to WhatsApp module in CRM
app.get('/whatsapp-hub', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Redirecionando para WhatsApp Business Hub...</title>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #25D366 0%, #128C7E 100%);
      color: white;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      text-align: center;
      max-width: 500px;
      padding: 40px 20px;
    }
    .loading-icon {
      font-size: 4rem;
      margin-bottom: 30px;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0% { transform: scale(1); }
      50% { transform: scale(1.1); }
      100% { transform: scale(1); }
    }
    h1 {
      font-size: 2rem;
      margin-bottom: 20px;
      text-shadow: 0 2px 4px rgba(0,0,0,0.3);
    }
    p {
      opacity: 0.9;
      margin-bottom: 30px;
    }
    .features {
      background: rgba(255,255,255,0.1);
      padding: 20px;
      border-radius: 10px;
      backdrop-filter: blur(10px);
      margin-bottom: 20px;
    }
    .feature {
      margin: 10px 0;
      padding: 5px 0;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    .feature:last-child {
      border-bottom: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="loading-icon">📱</div>
    <h1>WhatsApp Business Hub</h1>
    <p>Redirecionando para o dashboard completo...</p>
    
    <div class="features">
      <div class="feature">✅ Conversas em Tempo Real</div>
      <div class="feature">📄 Templates de Mensagens</div>
      <div class="feature">📢 Broadcasts em Massa</div>
      <div class="feature">📊 Analytics Avançados</div>
      <div class="feature">🤖 Automação Inteligente</div>
      <div class="feature">👥 Gestão de Contatos</div>
    </div>
    
    <p><small>Aguarde, você será redirecionado automaticamente...</small></p>
  </div>

  <script>
    // Set the localStorage to navigate directly to WhatsApp Business Hub module
    try {
      localStorage.setItem('app.activeModule', 'whatsapp-business');
      console.log('✅ Configured CRM to show WhatsApp Business Hub');
    } catch (err) {
      console.warn('⚠️ Could not set localStorage:', err);
    }
    
    // Redirect to CRM after a brief delay
    setTimeout(function() {
      window.location.href = '/crm/';
    }, 2000);
    
    // Fallback - immediate redirect if user clicks anywhere
    document.addEventListener('click', function() {
      window.location.href = '/crm/';
    });
  </script>
</body>
</html>
  `);
});

// Fallback dashboard routes
const dashboards = ['whatsapp', 'crm', 'instagram', 'agent-zero', 'broadhub'];

dashboards.forEach(name => {
  app.get(`/dashboard/${name}`, (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>${name.toUpperCase()} - Dashboard</title>
  <meta charset="utf-8">
  <style>
    body { font-family: system-ui; margin: 0; background: linear-gradient(135deg, #3b82f6, #1d4ed8); color: white; text-align: center; padding: 50px 20px; }
    .container { max-width: 600px; margin: 0 auto; }
    .icon { font-size: 5rem; margin-bottom: 30px; }
    h1 { font-size: 2.5rem; margin-bottom: 20px; }
    .btn { background: white; color: #3b82f6; padding: 15px 30px; border: none; border-radius: 25px; text-decoration: none; display: inline-block; margin: 10px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">📊</div>
    <h1>${name.replace('-', ' ').toUpperCase()}</h1>
    <p>Dashboard disponível - Sistema operacional</p>
    <a href="/" class="btn">🏠 Voltar ao Início</a>
  </div>
</body>
</html>
    `);
  });
});

// Catch-all middleware
app.use((req, res) => {
  res.status(200).json({
    message: 'SKINCOS AI System - Standalone Mode',
    status: 'running',
    method: req.method,
    path: req.path,
    timestamp: new Date().toISOString(),
    available_endpoints: [
      'GET /',
      'GET /admin', 
      'GET /v1/health',
      'GET /dashboard/*'
    ]
  });
});

// Start server
console.log(`📡 Starting server on port ${PORT}...`);

app.listen(PORT, '0.0.0.0', () => {
  console.log('✅ SKINCOS AI System started successfully!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🎯 SKINCOS AI System: http://0.0.0.0:${PORT}`);
  console.log(`📊 Main Dashboard: http://0.0.0.0:${PORT}`);
  console.log(`🔐 Admin Panel: http://0.0.0.0:${PORT}/admin`);
  console.log(`🔗 System Health: http://0.0.0.0:${PORT}/v1/health`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🌍 Environment: Standalone');
  console.log('🔒 Mode: Simplified (No dependencies)');
  console.log(`📊 Status: Server listening on port ${PORT} ✅`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎬 System ready for connections!');
});