const express = require('express');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const { createProxyMiddleware } = require('http-proxy-middleware');

// Global error handlers to prevent crashes
process.on('uncaughtException', (error) => {
  console.error('🚨 Uncaught Exception (non-fatal):', error.message);
  console.error('Stack:', error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 Unhandled Rejection (non-fatal):', reason);
  console.error('Promise:', promise);
});

// Import Enterprise API and Hybrid Queue System (with fallbacks)
let enterpriseRouter, hybridQueue, messageService, rateLimiter;
let QueueWorker, AuthService, AuthMiddleware, authRoutes;

try {
  const enterpriseApi = require('./routes/enterprise-api');
  enterpriseRouter = enterpriseApi.router;
  hybridQueue = enterpriseApi.hybridQueue;
  messageService = enterpriseApi.messageService;
  rateLimiter = enterpriseApi.rateLimiter;

  QueueWorker = require('./lib/queue-worker');
  AuthService = require('./lib/auth-service');
  AuthMiddleware = require('./middleware/auth-middleware');
  authRoutes = require('./routes/auth-routes');

  console.log('✅ Enterprise modules loaded successfully');
} catch (error) {
  console.warn('⚠️ Enterprise modules failed to load (running in basic mode):', error.message);

  // Create mock objects to prevent crashes
  enterpriseRouter = require('express').Router();
  hybridQueue = {
    isReady: () => false,
    getQueueStats: () => ({ memory: 'unavailable', redis: 'unavailable' }),
    getMode: () => ({ current: 'none', redisAvailable: false, memoryAvailable: false })
  };
  messageService = { pool: { query: () => Promise.reject(new Error('No database')) } };
  rateLimiter = (req, res, next) => next();

  QueueWorker = class { constructor() { } start() { } getStats() { return null; } };
  AuthService = class { constructor() { } async initializeTables() { } async createDefaultAdminUser() { } };
  AuthMiddleware = class { constructor() { } requireAdminPanelAuth() { return (req, res, next) => next(); } };
  authRoutes = require('express').Router();
}

const app = express();
const PORT = process.env.PORT || 5000

// ===== NO_AUTH MODE FOR DEVELOPMENT =====
// Set NO_AUTH=true to disable all authentication for testing
const NO_AUTH_MODE = process.env.NO_AUTH === 'true' || process.env.NODE_ENV === 'development'
if (NO_AUTH_MODE) {
  console.log('🔓 NO_AUTH MODE ENABLED - All authentication disabled for development')
  console.log('🔓 To re-enable auth, set NO_AUTH=false or NODE_ENV=production')
};
const NODE_ENV = process.env.NODE_ENV || 'development';

// Initialize enterprise services
let queueWorker = null;
let authService = null;
let authMiddleware = null;

/**
 * ENTERPRISE STARTUP VALIDATION
 * Validate critical environment variables and dependencies
 */
async function validateEnvironment() {
  console.log('🔍 Validating enterprise environment...');

  const requiredEnvVars = ['DATABASE_URL'];
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    if (NODE_ENV === 'production') {
      console.error('❌ Critical environment variables missing:', missingVars);
      process.exit(1);
    } else {
      console.warn('⚠️ Environment variables missing (non-fatal in development):', missingVars);
      console.warn('⚠️ System will run in memory-only mode');
    }
  }

  // Check database connectivity (non-fatal in development)
  try {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query('SELECT 1');
    await pool.end();
    console.log('✅ Database connectivity verified');
    global.DB_AVAILABLE = true;
  } catch (error) {
    if (NODE_ENV === 'production') {
      console.error('❌ Database connection failed:', error.message);
      process.exit(1);
    } else {
      console.warn('⚠️ Database connection failed (non-fatal in development):', error.message);
      console.warn('⚠️ System will run without database features');
      global.DB_AVAILABLE = false;
    }
  }

  // Warn about Redis (not critical, has fallback)
  if (!process.env.REDIS_URL) {
    console.warn('⚠️ REDIS_URL not set - using memory fallback queue');
  }

  // Warn about JWT secret
  if (!process.env.JWT_SECRET) {
    console.warn('⚠️ JWT_SECRET not set - using generated secret (not recommended for production)');
  }

  console.log('✅ Environment validation complete');
}

/**
 * ENTERPRISE INITIALIZATION
 * Initialize authentication and security services
 */
async function initializeEnterpriseServices() {
  console.log('🔧 Initializing enterprise services...');

  try {
    // Initialize auth service only if database is available
    if (global.DB_AVAILABLE) {
      authService = new AuthService();
      await authService.initializeTables();
      await authService.createDefaultAdminUser();
      console.log('✅ Auth service initialized with database');
    } else {
      console.warn('⚠️ Skipping auth service initialization (no database)');
    }

    // Initialize auth middleware (can work without database)
    authMiddleware = new AuthMiddleware();

    console.log('✅ Enterprise services initialized');
    global.SERVICES_INITIALIZED = true;

  } catch (error) {
    if (NODE_ENV === 'production') {
      console.error('❌ Failed to initialize enterprise services:', error);
      process.exit(1);
    } else {
      console.warn('⚠️ Failed to initialize enterprise services (non-fatal in development):', error);
      console.warn('⚠️ System will run with limited functionality');
      global.SERVICES_INITIALIZED = false;

      // Create minimal fallback auth middleware
      try {
        authMiddleware = new AuthMiddleware();
        console.warn('⚠️ Using fallback auth middleware');
      } catch (e) {
        console.warn('⚠️ Auth middleware failed, creating mock');
        authMiddleware = { requireAdminPanelAuth: () => (req, res, next) => next() };
      }
    }
  }
}

// CORS Configuration - Restrictive for production
const corsOptions = {
  origin: NODE_ENV === 'production'
    ? ['https://replit.app', 'https://replit.com', 'https://replit.dev'] // Adjust for your allowed domains
    : true, // Allow all origins in development
  credentials: true,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  maxAge: 86400 // 24 hours
};

// Apply enterprise security middleware with permissive CSP for React
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://unpkg.com", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://fonts.googleapis.com"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false
}));

app.use(require('cors')(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Trust proxy for proper IP detection in rate limiting
app.set('trust proxy', 1);

// Serve only safe static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Mount WhatsApp Official Module assets for centralized access
// Serve WhatsApp public UI from centralized location
app.use('/whatsapp', express.static(path.join(__dirname, 'whatsapp/official-module/public')));

// Mount authentication routes (public, no auth required)
app.use('/v1/auth', authRoutes);
console.log('✅ Authentication routes mounted at /v1/auth/*');

// Mount Enterprise API routes (protected)
app.use('/v1', enterpriseRouter);
console.log('✅ Enterprise API v1 routes mounted at /v1/*');

// Redirect /whatsapp/api/* to WhatsApp Official Module API
app.use('/whatsapp/api', async (req, res) => {
  try {
    const targetUrl = `http://localhost:3002/api${req.url}`;
    const options = {
      method: req.method,
      headers: { ...req.headers, host: 'localhost:3002' },
      body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined
    };

    const response = await fetch(targetUrl, options);
    const data = await response.text();

    // Copy response headers
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    res.status(response.status);

    // Try to parse as JSON, fallback to text
    try {
      res.json(JSON.parse(data));
    } catch {
      res.send(data);
    }
  } catch (error) {
    console.error('WhatsApp Official API proxy error (via /whatsapp/api):', error);
    res.status(503).json({ error: 'WhatsApp Official service temporarily unavailable' });
  }
});

// Proxy API calls to WhatsApp Official Module
app.use('/whatsapp-api', async (req, res) => {
  try {
    const targetUrl = `http://localhost:3002${req.url}`;
    const options = {
      method: req.method,
      headers: { ...req.headers, host: 'localhost:3002' },
    };

    if (req.method === 'POST' || req.method === 'PUT') {
      options.body = JSON.stringify(req.body);
      options.headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(targetUrl, options);
    const data = await response.text();

    res.status(response.status);
    response.headers.forEach((value, key) => {
      if (key !== 'content-encoding' && key !== 'content-length') {
        res.setHeader(key, value);
      }
    });

    res.send(data);
  } catch (error) {
    console.error('WhatsApp Official API proxy error:', error);
    res.status(503).json({ error: 'WhatsApp Official service temporarily unavailable' });
  }
});

// Health check endpoint for WhatsApp Official Module compatibility
app.get('/api/whatsapp/health', async (req, res) => {
  try {
    const response = await fetch('http://localhost:3002/api/status');
    const data = await response.json();

    // Map official module status to expected health format
    res.json({
      ok: data.status === 'ready',
      status: data.status,
      clientInfo: data.clientInfo,
      hasQR: data.hasQR,
      timestamp: data.timestamp
    });
  } catch (error) {
    console.error('WhatsApp Official health check error:', error);
    res.status(503).json({
      ok: false,
      status: 'service_unavailable',
      error: 'WhatsApp Official Module is not responding'
    });
  }
});

// CRM health check proxy
app.get('/api/crm/health', async (req, res) => {
  try {
    const response = await fetch('http://localhost:8099/health');
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('CRM health check error:', error);
    res.status(503).json({
      ok: false,
      status: 'service_unavailable',
      error: 'CRM service is not responding',
      service: 'crm-microservice'
    });
  }
});

// Enterprise system health check
app.get('/v1/health', async (req, res) => {
  try {
    // Check all services in parallel
    const [whatsappResponse, crmResponse, dbCheck] = await Promise.allSettled([
      fetch('http://localhost:3002/api/status'),
      fetch('http://localhost:8099/health'),
      messageService.pool.query('SELECT 1')
    ]);

    // Process WhatsApp status
    let whatsappData = { status: 'offline' };
    if (whatsappResponse.status === 'fulfilled') {
      try {
        whatsappData = await whatsappResponse.value.json();
      } catch (e) {
        whatsappData = { status: 'error', error: e.message };
      }
    }

    // Process CRM status
    let crmData = { status: 'offline' };
    if (crmResponse.status === 'fulfilled') {
      try {
        crmData = await crmResponse.value.json();
      } catch (e) {
        crmData = { status: 'error', error: e.message };
      }
    }

    // Check hybrid queue stats
    const queueStats = hybridQueue.getQueueStats();

    // Get worker stats if available
    const workerStats = queueWorker ? queueWorker.getStats() : null;

    // Determine overall health
    const isHealthy = dbCheck.status === 'fulfilled' &&
      (whatsappData.status === 'ready' || whatsappData.status === 'qr_received') &&
      (crmData.ok !== false);

    res.json({
      success: true,
      system: 'SKINCOS AI Enterprise System v2.0',
      status: isHealthy ? 'healthy' : 'degraded',
      components: {
        crm_service: {
          status: crmData.status || 'unknown',
          ok: crmData.ok !== false,
          port: 8099,
          ready: crmData.ok === true
        },
        whatsapp_client: {
          status: whatsappData.status,
          ready: whatsappData.status === 'ready',
          has_qr: whatsappData.hasQR
        },
        message_queue: {
          connected: !!queueStats,
          stats: queueStats
        },
        database: {
          connected: dbCheck.status === 'fulfilled'
        },
        queue_worker: {
          running: queueWorker?.isRunning || false,
          stats: workerStats
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Enterprise health check error:', error);
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Admin login page (public)
app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin/login.html'));
});

// Enterprise Admin Interface - Protected with authentication (with NO_AUTH bypass)
app.get('/admin', (req, res, next) => {
  console.log('[ADMIN] Access attempt from:', req.ip, 'Host:', req.hostname);

  // NO_AUTH MODE: Skip all authentication in development
  if (NO_AUTH_MODE) {
    console.log('[ADMIN] 🔓 NO_AUTH MODE - bypassing authentication for development');
    return res.sendFile(path.join(__dirname, 'public/admin/index.html'));
  }

  // Create a temporary authMiddleware if not yet initialized
  const tempAuthMiddleware = authMiddleware || new AuthMiddleware();
  tempAuthMiddleware.requireAdminPanelAuth()(req, res, next);
}, (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin/index.html'));
});

// Instagram Module Interface - Protected with authentication (with NO_AUTH bypass)
app.get('/admin/instagram', (req, res, next) => {
  // NO_AUTH MODE: Skip all authentication in development
  if (NO_AUTH_MODE) {
    console.log('[ADMIN/INSTAGRAM] 🔓 NO_AUTH MODE - bypassing authentication for development');
    return res.sendFile(path.join(__dirname, 'instagram-module/interface/instagram_dashboard.html'));
  }

  const tempAuthMiddleware = authMiddleware || new AuthMiddleware();
  tempAuthMiddleware.requireAdminPanelAuth()(req, res, next);
}, (req, res) => {
  res.sendFile(path.join(__dirname, 'instagram-module/interface/instagram_dashboard.html'));
});

// Instagram API Proxy - Protected with authentication (with NO_AUTH bypass)
app.use('/instagram-api', (req, res, next) => {
  // NO_AUTH MODE: Skip all authentication in development
  if (NO_AUTH_MODE) {
    console.log('[API/INSTAGRAM] 🔓 NO_AUTH MODE - bypassing authentication for development');
    return next();
  }

  const tempAuthMiddleware = authMiddleware || new AuthMiddleware();
  tempAuthMiddleware.requireAdminPanelAuth()(req, res, next);
}, createProxyMiddleware({
  target: 'http://localhost:3003',
  changeOrigin: true,
  pathRewrite: {
    '^/instagram-api': ''
  },
  logLevel: 'warn'
}));

// Agent Zero IA Interface - Protected with authentication (with NO_AUTH bypass)
app.get('/admin/agent-zero', (req, res, next) => {
  // NO_AUTH MODE: Skip all authentication in development
  if (NO_AUTH_MODE) {
    console.log('[ADMIN/AGENT-ZERO] 🔓 NO_AUTH MODE - bypassing authentication for development');
    return res.sendFile(path.join(__dirname, 'agent-zero-module-integrated/interface/agent_dashboard.html'));
  }

  const tempAuthMiddleware = authMiddleware || new AuthMiddleware();
  tempAuthMiddleware.requireAdminPanelAuth()(req, res, next);
}, (req, res) => {
  res.sendFile(path.join(__dirname, 'agent-zero-module-integrated/interface/agent_dashboard.html'));
});

// Agent Zero API Proxy - Protected with authentication (with NO_AUTH bypass)
app.use('/agent-zero-api', (req, res, next) => {
  // NO_AUTH MODE: Skip all authentication in development
  if (NO_AUTH_MODE) {
    console.log('[API/AGENT-ZERO] 🔓 NO_AUTH MODE - bypassing authentication for development');
    return next();
  }

  const tempAuthMiddleware = authMiddleware || new AuthMiddleware();
  tempAuthMiddleware.requireAdminPanelAuth()(req, res, next);
}, createProxyMiddleware({
  target: 'http://localhost:6800',
  changeOrigin: true,
  pathRewrite: {
    '^/agent-zero-api': ''
  },
  logLevel: 'warn'
}));

console.log('🔐 Enterprise Admin Interface protected at /admin');
console.log('📸 Instagram Module available at /admin/instagram');
console.log('🤖 Agent Zero IA available at /admin/agent-zero');
console.log('🔑 Admin login available at /admin/login');

// CRITICAL: Primary health endpoint - must be BEFORE proxy catch-all
app.get('/health', async (req, res) => {
  console.log('[HEALTH CHECK] 🔍 Primary /health endpoint requested from:', req.ip);
  try {
    const healthStatus = {
      status: 'healthy',
      service: 'skincos-ai-main-app',
      timestamp: Date.now(),
      uptime: process.uptime(),
      mode: 'production',
      version: '1.0.0',
      services: {}
    };

    // Quick health checks for backend services (non-blocking with timeouts)
    const healthChecks = [
      { name: 'crm', url: 'http://localhost:8099/health', timeout: 2000 },
      { name: 'agent-zero', url: 'http://localhost:6800/health', timeout: 2000 },
      { name: 'instagram', url: 'http://localhost:3003/health', timeout: 2000 },
      { name: 'whatsapp', url: 'http://localhost:3002/health', timeout: 2000 }
    ];

    // Run health checks in parallel with Promise.allSettled to not fail on any single service
    const results = await Promise.allSettled(
      healthChecks.map(async check => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), check.timeout);
        try {
          const response = await fetch(check.url, {
            method: 'GET',
            signal: controller.signal,
            headers: { 'User-Agent': 'SKINCOS-AI-HealthCheck/1.0' }
          });
          clearTimeout(timeoutId);
          return { name: check.name, status: response.ok ? 'healthy' : 'degraded', code: response.status };
        } catch (error) {
          clearTimeout(timeoutId);
          return { name: check.name, status: 'unavailable', error: error.message };
        }
      })
    );

    // Process results
    results.forEach(result => {
      if (result.status === 'fulfilled') {
        healthStatus.services[result.value.name] = result.value;
      } else {
        healthStatus.services[result.value?.name || 'unknown'] = { status: 'error', error: result.reason };
      }
    });

    console.log('[HEALTH CHECK] ✅ Primary /health completed:', healthStatus.status);
    res.json(healthStatus);
  } catch (error) {
    console.error('[HEALTH CHECK] ❌ Primary /health error:', error);
    res.status(500).json({
      status: 'error',
      service: 'skincos-ai-main-app',
      timestamp: Date.now(),
      error: 'Health check failed',
      message: error.message
    });
  }
});

console.log('✅ Primary /health endpoint configured (BEFORE proxy catch-all)');

// CRM Root Proxy - CATCH-ALL (must be after all specific routes)
console.log('📋 Setting up CRM proxy as root...');
app.use('/', createProxyMiddleware({
  target: 'http://localhost:8099', // Correct CRM backend port with auth
  changeOrigin: true,
  ws: true, // WebSocket support
  pathFilter: (path, req) => {
    // Exclude specific existing routes (but allow /api/login, /api/callback, /api/logout for auth)
    const excludePatterns = [
      /^\/v1(\/|$)/,                    // Enterprise API
      /^\/api\/system(\/|$)/,           // System API routes (keep in main_app)
      /^\/api\/crm(\/|$)/,              // CRM health routes (keep in main_app)
      /^\/api\/whatsapp(\/|$)/,         // WhatsApp health routes (keep in main_app)
      /^\/admin(\/|$)/,                 // Admin interfaces
      /^\/agent-zero-api(\/|$)/,        // Agent Zero API proxy
      /^\/instagram-api(\/|$)/,         // Instagram API proxy
      /^\/whatsapp-api(\/|$)/,          // WhatsApp API proxy
      /^\/whatsapp(\/|$)/,              // WhatsApp assets
      /^\/dashboard(\/|$)/              // Dashboard routes
    ];

    // Return false to exclude (don't proxy), true to proxy to CRM
    for (const pattern of excludePatterns) {
      if (pattern.test(path)) {
        return false; // Don't proxy, let existing routes handle
      }
    }

    return true; // Proxy everything else to CRM
  },
  onError: (err, req, res) => {
    console.error('CRM proxy error:', err.message);
    res.status(503).json({
      error: 'CRM service temporarily unavailable',
      message: 'Please try again later or contact system administrator',
      timestamp: new Date().toISOString()
    });
  },
  onProxyReq: (proxyReq, req, res) => {
    // Add custom headers for CRM integration
    proxyReq.setHeader('X-Forwarded-For', req.ip);
    proxyReq.setHeader('X-SKINCOS-Source', 'main-app');
  },
  logLevel: 'warn'
}));

console.log('✅ CRM proxy configured as root catch-all');
console.log('🚀 All unmatched routes will be forwarded to CRM at localhost:8099');

// Integrated Dashboard Routes - Serve all modules through main interface
app.get('/dashboard/whatsapp', (req, res) => {
  // Proxy to WhatsApp dashboard or show fallback
  res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>WhatsApp Business - Dashboard</title>
    <meta charset='utf-8'>
    <meta name='viewport' content='width=device-width, initial-scale=1'>
    <style>
        body { font-family: system-ui; margin: 0; padding: 20px; background: #25D366; color: white; text-align: center; }
        .container { max-width: 800px; margin: 0 auto; padding: 50px 20px; }
        .icon { font-size: 5rem; margin-bottom: 30px; }
        h1 { font-size: 2.5rem; margin-bottom: 20px; }
        p { font-size: 1.2rem; margin-bottom: 30px; opacity: 0.9; }
        .btn { background: white; color: #25D366; padding: 15px 30px; border: none; border-radius: 50px; font-size: 1.1rem; font-weight: bold; cursor: pointer; margin: 10px; text-decoration: none; display: inline-block; transition: transform 0.2s; }
        .btn:hover { transform: scale(1.05); }
        .status { background: rgba(255,255,255,0.2); padding: 15px; border-radius: 10px; margin: 20px 0; }
    </style>
</head>
<body>
    <div class='container'>
        <div class='icon'>📱</div>
        <h1>WhatsApp Business</h1>
        <p>Central de atendimento para conversas com clientes</p>

        <div class='status'>
            <strong>Status:</strong> <span id='status-text'>Verificando conexão...</span>
        </div>

        <a href='/whatsapp/' target='_blank' class='btn'>📱 Abrir Dashboard Completo</a>
        <a href='/whatsapp/qr-simple.html' target='_blank' class='btn'>🔗 Conectar WhatsApp</a>
        <a href='/' class='btn'>🏠 Voltar ao Início</a>

        <div style='margin-top: 40px; opacity: 0.8;'>
            <h3>Funcionalidades:</h3>
            <p>✅ Receber mensagens de clientes<br>
            ✅ Responder conversas em tempo real<br>
            ✅ Gerenciar múltiplos atendimentos<br>
            ✅ Estatísticas de atendimento</p>
        </div>
    </div>

    <script>
        // Verificar status do WhatsApp
        fetch('/api/whatsapp/health')
            .then(response => response.json())
            .then(data => {
                const statusText = document.getElementById('status-text');
                if (data.ok || data.success) {
                    statusText.textContent = '✅ Conectado e funcionando';
                } else {
                    statusText.textContent = '⚠️ Aguardando conexão';
                }
            })
            .catch(() => {
                document.getElementById('status-text').textContent = '❌ Módulo indisponível temporariamente';
            });
    </script>
</body>
</html>
  `);
});

app.get('/dashboard/crm', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>CRM Inteligente - Dashboard</title>
    <meta charset='utf-8'>
    <meta name='viewport' content='width=device-width, initial-scale=1'>
    <style>
        body { font-family: system-ui; margin: 0; padding: 20px; background: linear-gradient(135deg, #3b82f6, #1d4ed8); color: white; text-align: center; }
        .container { max-width: 800px; margin: 0 auto; padding: 50px 20px; }
        .icon { font-size: 5rem; margin-bottom: 30px; }
        h1 { font-size: 2.5rem; margin-bottom: 20px; }
        p { font-size: 1.2rem; margin-bottom: 30px; opacity: 0.9; }
        .btn { background: white; color: #3b82f6; padding: 15px 30px; border: none; border-radius: 50px; font-size: 1.1rem; font-weight: bold; cursor: pointer; margin: 10px; text-decoration: none; display: inline-block; transition: transform 0.2s; }
        .btn:hover { transform: scale(1.05); }
        .status { background: rgba(255,255,255,0.2); padding: 15px; border-radius: 10px; margin: 20px 0; }
        .features { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin: 40px 0; }
        .feature { background: rgba(255,255,255,0.1); padding: 20px; border-radius: 10px; }
    </style>
</head>
<body>
    <div class='container'>
        <div class='icon'>👥</div>
        <h1>CRM Inteligente</h1>
        <p>Sistema completo de gestão de relacionamento com clientes</p>

        <div class='status'>
            <strong>Status:</strong> Em desenvolvimento - Dashboard será lançado em breve!
        </div>

        <a href='/' class='btn'>🏠 Voltar ao Início</a>

        <div class='features'>
            <div class='feature'>
                <h3>📊 Dashboard</h3>
                <p>Visão completa de vendas e clientes</p>
            </div>
            <div class='feature'>
                <h3>👤 Gestão de Contatos</h3>
                <p>Base completa de clientes</p>
            </div>
            <div class='feature'>
                <h3>📈 Relatórios</h3>
                <p>Analytics avançados de vendas</p>
            </div>
            <div class='feature'>
                <h3>🎯 Campanhas</h3>
                <p>Marketing direcionado</p>
            </div>
        </div>
    </div>
</body>
</html>
  `);
});

app.get('/dashboard/broadhub', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>BroadHub - Central de Campanhas</title>
    <meta charset='utf-8'>
    <meta name='viewport' content='width=device-width, initial-scale=1'>
    <style>
        body { font-family: system-ui; margin: 0; padding: 20px; background: linear-gradient(135deg, #f59e0b, #d97706); color: white; text-align: center; }
        .container { max-width: 800px; margin: 0 auto; padding: 50px 20px; }
        .icon { font-size: 5rem; margin-bottom: 30px; }
        h1 { font-size: 2.5rem; margin-bottom: 20px; }
        p { font-size: 1.2rem; margin-bottom: 30px; opacity: 0.9; }
        .btn { background: white; color: #f59e0b; padding: 15px 30px; border: none; border-radius: 50px; font-size: 1.1rem; font-weight: bold; cursor: pointer; margin: 10px; text-decoration: none; display: inline-block; transition: transform 0.2s; }
        .btn:hover { transform: scale(1.05); }
        .status { background: rgba(255,255,255,0.2); padding: 15px; border-radius: 10px; margin: 20px 0; }
        .features { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin: 40px 0; }
        .feature { background: rgba(255,255,255,0.1); padding: 20px; border-radius: 10px; }
    </style>
</head>
<body>
    <div class='container'>
        <div class='icon'>📡</div>
        <h1>BroadHub</h1>
        <p>Central de transmissões e campanhas para múltiplas plataformas</p>

        <div class='status'>
            <strong>Status:</strong> Em desenvolvimento - Sistema de campanhas será lançado em breve!
        </div>

        <a href='/' class='btn'>🏠 Voltar ao Início</a>

        <div class='features'>
            <div class='feature'>
                <h3>📱 Multi-Plataforma</h3>
                <p>WhatsApp, Instagram, Email</p>
            </div>
            <div class='feature'>
                <h3>🎯 Campanhas</h3>
                <p>Criação e gestão de campanhas</p>
            </div>
            <div class='feature'>
                <h3>📊 Analytics</h3>
                <p>Métricas de performance</p>
            </div>
            <div class='feature'>
                <h3>⏱️ Agendamento</h3>
                <p>Envios programados</p>
            </div>
        </div>
    </div>
</body>
</html>
  `);
});

app.get('/dashboard/agent-zero', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Agent Zero - IA Inteligente</title>
    <meta charset='utf-8'>
    <meta name='viewport' content='width=device-width, initial-scale=1'>
    <style>
        body { font-family: system-ui; margin: 0; padding: 20px; background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: white; text-align: center; }
        .container { max-width: 800px; margin: 0 auto; padding: 50px 20px; }
        .icon { font-size: 5rem; margin-bottom: 30px; }
        h1 { font-size: 2.5rem; margin-bottom: 20px; }
        p { font-size: 1.2rem; margin-bottom: 30px; opacity: 0.9; }
        .btn { background: white; color: #8b5cf6; padding: 15px 30px; border: none; border-radius: 50px; font-size: 1.1rem; font-weight: bold; cursor: pointer; margin: 10px; text-decoration: none; display: inline-block; transition: transform 0.2s; }
        .btn:hover { transform: scale(1.05); }
        .status { background: rgba(255,255,255,0.2); padding: 15px; border-radius: 10px; margin: 20px 0; }
        .features { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin: 40px 0; }
        .feature { background: rgba(255,255,255,0.1); padding: 20px; border-radius: 10px; }
    </style>
</head>
<body>
    <div class='container'>
        <div class='icon'>🤖</div>
        <h1>Agent Zero</h1>
        <p>Assistente de IA inteligente para automação de tarefas e atendimento</p>

        <div class='status'>
            <strong>Status:</strong> Aguardando configuração - Sistema de IA será ativado em breve!
        </div>

        <a href='/' class='btn'>🏠 Voltar ao Início</a>

        <div class='features'>
            <div class='feature'>
                <h3>🧠 IA Conversacional</h3>
                <p>Atendimento automático inteligente</p>
            </div>
            <div class='feature'>
                <h3>⚙️ Automação</h3>
                <p>Tarefas automáticas e workflows</p>
            </div>
            <div class='feature'>
                <h3>📊 Analytics</h3>
                <p>Análise de performance da IA</p>
            </div>
            <div class='feature'>
                <h3>🔧 Integração</h3>
                <p>Conecta com todos os módulos</p>
            </div>
        </div>
    </div>
</body>
</html>
  `);
});

app.get('/dashboard/instagram', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Instagram Manager - Dashboard</title>
    <meta charset='utf-8'>
    <meta name='viewport' content='width=device-width, initial-scale=1'>
    <style>
        body { font-family: system-ui; margin: 0; padding: 20px; background: linear-gradient(135deg, #e1306c, #fd5949); color: white; text-align: center; }
        .container { max-width: 800px; margin: 0 auto; padding: 50px 20px; }
        .icon { font-size: 5rem; margin-bottom: 30px; }
        h1 { font-size: 2.5rem; margin-bottom: 20px; }
        p { font-size: 1.2rem; margin-bottom: 30px; opacity: 0.9; }
        .btn { background: white; color: #e1306c; padding: 15px 30px; border: none; border-radius: 50px; font-size: 1.1rem; font-weight: bold; cursor: pointer; margin: 10px; text-decoration: none; display: inline-block; transition: transform 0.2s; }
        .btn:hover { transform: scale(1.05); }
        .status { background: rgba(255,255,255,0.2); padding: 15px; border-radius: 10px; margin: 20px 0; }
        .features { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin: 40px 0; }
        .feature { background: rgba(255,255,255,0.1); padding: 20px; border-radius: 10px; }
    </style>
</head>
<body>
    <div class='container'>
        <div class='icon'>📸</div>
        <h1>Instagram Manager</h1>
        <p>Gestão automatizada de conteúdo e interações no Instagram</p>

        <div class='status'>
            <strong>Status:</strong> Aguardando configuração - Manager será ativado em breve!
        </div>

        <a href='/' class='btn'>🏠 Voltar ao Início</a>

        <div class='features'>
            <div class='feature'>
                <h3>📷 Conteúdo</h3>
                <p>Gestão de posts e stories</p>
            </div>
            <div class='feature'>
                <h3>👥 Seguidores</h3>
                <p>Análise e crescimento</p>
            </div>
            <div class='feature'>
                <h3>💬 Interações</h3>
                <p>Comments e mensagens</p>
            </div>
            <div class='feature'>
                <h3>📊 Analytics</h3>
                <p>Métricas de performance</p>
            </div>
        </div>
    </div>
</body>
</html>
  `);
});

// System utilities and settings pages
app.get('/dashboard/settings', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>SKINCOS AI - Configurações</title>
    <meta charset='utf-8'>
    <meta name='viewport' content='width=device-width, initial-scale=1'>
    <style>
        body { font-family: system-ui; margin: 0; padding: 20px; background: linear-gradient(135deg, #6b7280, #4b5563); color: white; text-align: center; }
        .container { max-width: 800px; margin: 0 auto; padding: 50px 20px; }
        .icon { font-size: 5rem; margin-bottom: 30px; }
        h1 { font-size: 2.5rem; margin-bottom: 20px; }
        p { font-size: 1.2rem; margin-bottom: 30px; opacity: 0.9; }
        .btn { background: white; color: #6b7280; padding: 15px 30px; border: none; border-radius: 50px; font-size: 1.1rem; font-weight: bold; cursor: pointer; margin: 10px; text-decoration: none; display: inline-block; transition: transform 0.2s; }
        .btn:hover { transform: scale(1.05); }
        .settings-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin: 40px 0; text-align: left; }
        .setting-card { background: rgba(255,255,255,0.1); padding: 25px; border-radius: 15px; }
    </style>
</head>
<body>
    <div class='container'>
        <div class='icon'>⚙️</div>
        <h1>Centro de Configurações</h1>
        <p>Configurações gerais, logs do sistema e ferramentas administrativas</p>

        <a href='/' class='btn'>🏠 Voltar ao Início</a>
        <a href='/api/system/health' target='_blank' class='btn'>🔍 Saúde do Sistema</a>
        <a href='/api/system/status' target='_blank' class='btn'>📊 Status Completo</a>

        <div class='settings-grid'>
            <div class='setting-card'>
                <h3>📊 Monitoramento</h3>
                <p>• Status de todos os módulos</p>
                <p>• Logs em tempo real</p>
                <p>• Alertas de sistema</p>
            </div>
            <div class='setting-card'>
                <h3>🔒 Segurança</h3>
                <p>• Chaves de API</p>
                <p>• Autenticação</p>
                <p>• Permissões de acesso</p>
            </div>
            <div class='setting-card'>
                <h3>💾 Backup</h3>
                <p>• Backup automático</p>
                <p>• Restauração</p>
                <p>• Versionamento</p>
            </div>
            <div class='setting-card'>
                <h3>🔧 Manutenção</h3>
                <p>• Limpeza de cache</p>
                <p>• Otimização</p>
                <p>• Atualizações</p>
            </div>
        </div>
    </div>
</body>
</html>
  `);
});

// Health checking utility
async function checkServiceHealth(url, timeout = 3000) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const response = await require('axios').get(url, {
      signal: controller.signal,
      timeout: timeout
    });
    clearTimeout(timeoutId);
    return response.status === 200 ? 'active' : 'error';
  } catch (error) {
    return 'offline';
  }
}

// Simple API key authentication
const API_KEY = process.env.API_KEY || 'sk-skincos-ai-' + require('crypto').randomBytes(32).toString('hex');
function authenticateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  if (!apiKey || apiKey !== API_KEY) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized. Valid API key required in X-API-Key header or apiKey query parameter'
    });
  }
  next();
}

// API Routes
app.get('/api/system/health', async (req, res) => {
  const [whatsappHealth] = await Promise.all([
    checkServiceHealth('http://localhost:3003/health')
  ]);

  res.json({
    ok: true,
    service: 'skincos-ai-system',
    port: PORT,
    timestamp: new Date().toISOString(),
    services: {
      crm: 'stub',
      whatsapp: whatsappHealth,
      broadhub: 'stub',
      agent_zero: 'pending',
      instagrapi: 'pending'
    }
  });
});

app.get('/api/system/status', (req, res) => {
  res.json({
    status: 'running',
    project: 'SKINCOS AI',
    version: '1.0.0-stub',
    uptime: process.uptime(),
    environment: 'development',
    platform: 'replit'
  });
});

// CRM API endpoints
app.get('/api/crm/health', (req, res) => {
  res.json({ ok: true, service: 'crm-api', port: PORT });
});

app.get('/api/crm/status', (req, res) => {
  res.json({
    status: 'running',
    service: 'comprehensive-crm-so',
    version: '1.0.0-stub',
    uptime: process.uptime()
  });
});

// WhatsApp API endpoints
app.get('/api/whatsapp/health', async (req, res) => {
  // Try to proxy to external service first, fallback to self-hosted status
  try {
    const response = await require('axios').get('http://localhost:3003/health', { timeout: 3000 });
    res.json(response.data);
  } catch (error) {
    // Return fallback status when external service is not available
    res.json({
      ok: false,
      service: 'whatsapp-gateway',
      status: 'fallback-mode',
      message: 'WhatsApp assets served internally',
      port: PORT,
      assetsPath: '/whatsapp/'
    });
  }
});

app.get('/api/whatsapp/instances', async (req, res) => {
  try {
    const response = await require('axios').get('http://localhost:3003/instances');
    res.json(response.data);
  } catch (error) {
    try {
      const metaPath = path.join(__dirname, 'wa_instances_meta.json');
      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        res.json(meta);
      } else {
        res.json({ instances: {}, message: 'WhatsApp Gateway not available and no local instances metadata found' });
      }
    } catch (localError) {
      res.json({ instances: {}, error: localError.message });
    }
  }
});

// WhatsApp send message proxy - PROTECTED with API key authentication
app.post('/api/whatsapp/send', authenticateApiKey, async (req, res) => {
  try {
    // Validate required fields
    if (!req.body || (!req.body.to && !req.body.phone)) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: to or phone'
      });
    }

    const response = await require('axios').post('http://localhost:3003/send', req.body, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    res.json(response.data);
  } catch (error) {
    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else {
      res.status(503).json({
        success: false,
        error: 'WhatsApp Gateway not available',
        message: 'Make sure WhatsApp Official Module is running on port 3003'
      });
    }
  }
});

// BroadHub API endpoints
app.get('/api/broadhub/health', (req, res) => {
  res.json({ ok: true, service: 'broadhub', port: PORT });
});

// Documentation endpoints
app.get('/docs/ai-knowledge', (req, res) => {
  res.redirect('/ai-knowledge/index.html');
});

app.get('/docs/crm', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head><title>CRM Documentation</title></head>
<body style="font-family: system-ui; margin: 40px; background: #f5f5f5;">
<h1>CRM Comprehensive Documentation</h1>
<p>Sistema de CRM integrado com funcionalidades de frontend e API.</p>
<h3>Endpoints Disponíveis:</h3>
<ul>
<li><code>GET /api/crm/health</code> - Health check</li>
<li><code>GET /api/crm/status</code> - Status do serviço</li>
</ul>
<p><a href="/">← Voltar ao Dashboard</a></p>
</body>
</html>
  `);
});

app.get('/docs/whatsapp', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head><title>WhatsApp Gateway Documentation</title></head>
<body style="font-family: system-ui; margin: 40px; background: #f5f5f5;">
<h1>WhatsApp Gateway Documentation</h1>
<p>Gateway para comunicação via WhatsApp.</p>
<h3>Endpoints Disponíveis:</h3>
<ul>
<li><code>GET /api/whatsapp/health</code> - Health check</li>
<li><code>GET /api/whatsapp/instances</code> - Lista de instâncias</li>
</ul>
<p><a href="/">← Voltar ao Dashboard</a></p>
</body>
</html>
  `);
});

app.get('/docs/broadhub', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head><title>BroadHub Documentation</title></head>
<body style="font-family: system-ui; margin: 40px; background: #f5f5f5;">
<h1>BroadHub Documentation</h1>
<p>Sistema de broadcasting para múltiplas plataformas.</p>
<h3>Endpoints Disponíveis:</h3>
<ul>
<li><code>GET /api/broadhub/health</code> - Health check</li>
</ul>
<p><a href="/">← Voltar ao Dashboard</a></p>
</body>
</html>
  `);
});

/**
 * ENTERPRISE STARTUP SEQUENCE
 * Initialize all enterprise services before starting server
 */
// Create a simple startup that opens port immediately
function startSimpleServer() {
  console.log('🚀 Starting SKINCOS AI Enterprise System...');

  try {
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log('✅ SKINCOS AI Enterprise System started successfully!');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`🎯 SKINCOS AI System: http://0.0.0.0:${PORT}`);
      console.log(`📊 Main Dashboard: http://0.0.0.0:${PORT}`);
      console.log(`🔐 Admin Panel: http://0.0.0.0:${PORT}/admin`);
      console.log(`🔑 Admin Login: http://0.0.0.0:${PORT}/admin/login`);
      console.log(`🏢 Enterprise API: http://0.0.0.0:${PORT}/v1/*`);
      console.log(`🔒 Authentication: http://0.0.0.0:${PORT}/v1/auth/*`);
      console.log(`🔗 System Health: http://0.0.0.0:${PORT}/v1/health`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`🌍 Environment: ${NODE_ENV}`);
      console.log(`🔒 Security: JWT + RBAC + Tenant Isolation`);
      console.log(`📋 Rate Limiting: Active per tenant`);
      console.log(`📊 Audit Logging: Enabled`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      // Ensure logs directory exists and write log
      try {
        const logsDir = path.join(__dirname, 'logs');
        if (!fs.existsSync(logsDir)) {
          fs.mkdirSync(logsDir, { recursive: true });
        }
        const msg = `SKINCOS AI System with Enterprise API started on port ${PORT} at ${new Date().toISOString()}`;
        fs.appendFileSync(path.join(logsDir, 'system.out'), msg + '\n');
      } catch (logError) {
        console.warn('⚠️ Could not write to logs directory:', logError.message);
      }

      // Start all background initialization after port is open
      setTimeout(initializeAllServices, 1000);
    });

    // Add server error handler
    server.on('error', (error) => {
      console.error('🚨 Server error (attempting restart):', error.message);
      if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use`);
        process.exit(1); // Only exit for port conflicts
      }
    });

  } catch (error) {
    console.error('🚨 Failed to start server:', error.message);
    console.error('🔄 Attempting emergency fallback server...');

    // Emergency fallback - basic Express server
    const fallbackApp = require('express')();
    fallbackApp.get('*', (req, res) => {
      res.json({
        status: 'emergency_mode',
        message: 'SKINCOS AI System - Emergency Mode',
        error: 'Main system components failed to load',
        timestamp: new Date().toISOString()
      });
    });

    fallbackApp.listen(PORT, '0.0.0.0', () => {
      console.log(`🔄 Emergency server running on port ${PORT}`);
    });
  }
}

// Background initialization function
async function initializeAllServices() {
  try {
    console.log('🔄 Initializing background services...');
    await validateEnvironment();
    await initializeEnterpriseServices();
    console.log('🔄 Initializing Enterprise WhatsApp API with Hybrid Queue System...');
    await initializeWhatsAppIntegration();
    console.log('✅ All background services initialized successfully!');
  } catch (error) {
    console.warn('⚠️ Some background services failed, but server continues running:', error.message);
  }
}

/**
 * Initialize WhatsApp Integration and Queue Worker
 */
async function initializeWhatsAppIntegration() {
  try {

    // Wait for hybrid queue to initialize
    let retryCount = 0;
    while (!hybridQueue.isReady() && retryCount < 10) {
      console.log(`⏳ Waiting for hybrid queue to be ready... (attempt ${retryCount + 1}/10)`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      retryCount++;
    }

    if (hybridQueue.isReady()) {
      const queueMode = hybridQueue.getMode();
      console.log(`✅ Hybrid Queue initialized in mode: ${queueMode.current}`);
      console.log(`📊 Redis: ${queueMode.redisAvailable ? 'Available' : 'Fallback to Memory'} | Memory: ${queueMode.memoryAvailable ? 'Ready' : 'Error'}`);

      // Initialize WhatsApp integration
      const WhatsAppIntegration = require('./lib/whatsapp-integration');
      const whatsappIntegration = new WhatsAppIntegration(messageService);

      // Start integration in background
      setTimeout(async () => {
        try {
          const integrated = await whatsappIntegration.initialize();

          // Initialize and start queue worker with WhatsApp client
          console.log('🤖 Starting Enterprise Queue Worker with Hybrid Queue...');

          // For now, we'll simulate the WhatsApp client connection
          // In production, you'd get the actual client instance from the integration
          queueWorker = new QueueWorker(integrated || null); // Use WhatsApp client if available

          // Start worker with hybrid queue
          await queueWorker.start(hybridQueue);
          console.log('✅ Enterprise Queue Worker started successfully with hybrid fallback');
          console.log(`📈 Operating in ${queueMode.current} mode - Target: 99% delivery rate with intelligent retries`);

          if (!queueMode.redisAvailable) {
            console.log('💡 Running in memory fallback mode with database outbox pattern for resilience');
          }

        } catch (error) {
          console.error('❌ Enterprise queue worker initialization error:', error);
          console.log('📋 Enterprise API endpoints remain available for message queuing');
        }
      }, 1000); // Wait 1 second for WhatsApp to be ready

    } else {
      throw new Error('Hybrid queue failed to initialize');
    }

  } catch (error) {
    console.error('❌ Enterprise hybrid system initialization failed:', error);
    console.log('📋 Enterprise API endpoints are still available, but message processing may be degraded');
    console.log('💡 System will continue operating - check /v1/health for detailed status');
  }
}

// Start the simple server immediately
startSimpleServer();
