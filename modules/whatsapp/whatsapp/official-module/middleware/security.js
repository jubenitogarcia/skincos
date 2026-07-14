const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const validator = require('validator');

/**
 * Middleware de Segurança Centralizado
 *
 * Implementa todas as proteções de segurança necessárias:
 * - Autenticação via API Key e JWT
 * - Rate limiting
 * - Validação de entrada rigorosa
 * - IP allowlisting
 * - Proteções CSRF
 */

// ========== CONFIGURAÇÕES DE SEGURANÇA ==========
const SECURITY_CONFIG = {
    // API Keys permitidas (em produção, carregar de variáveis de ambiente)
    API_KEYS: new Set([
        process.env.WHATSAPP_API_KEY,
        process.env.ADMIN_API_KEY,
        process.env.CHANNEL_MANAGER_KEY,
        process.env.UNIFIED_API_KEY,
        process.env.CRM_UNIFIED_API_KEY
    ]),

    // JWT Secret
    JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex'),
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '24h',

    // IPs permitidos para APIs críticas (em produção, configurar adequadamente)
    ALLOWED_IPS: new Set([
        '127.0.0.1',
        '::1',
        'localhost',
        process.env.ADMIN_IP || '0.0.0.0' // Configurar IP real do admin
    ]),

    // Rate limiting configs
    RATE_LIMITS: {
        strict: { windowMs: 15 * 60 * 1000, max: 10 }, // 10 req/15min para APIs críticas
        moderate: { windowMs: 15 * 60 * 1000, max: 100 }, // 100 req/15min para APIs normais
        lenient: { windowMs: 15 * 60 * 1000, max: 1000 } // 1000 req/15min para consultas
    }
};

// ========== UTILIDADES DE SEGURANÇA ==========

/**
 * Valida se um IP está na lista de IPs permitidos
 */
function isIPAllowed(ip) {
    // Normalizar IP para IPv4 se for IPv6 mapeado
    const normalizedIP = ip.replace(/^::ffff:/, '');
    return SECURITY_CONFIG.ALLOWED_IPS.has(normalizedIP) ||
        SECURITY_CONFIG.ALLOWED_IPS.has(ip);
}

/**
 * Extrai e valida API key do request
 */
function extractAPIKey(req) {
    // Tentar várias formas de autenticação
    const authHeader = req.headers.authorization;
    const apiKeyHeader = req.headers['x-api-key'];
    const apiKeyQuery = req.query.api_key;

    let apiKey = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        apiKey = authHeader.substring(7);
    } else if (authHeader && authHeader.startsWith('ApiKey ')) {
        apiKey = authHeader.substring(7);
    } else if (apiKeyHeader) {
        apiKey = apiKeyHeader;
    } else if (apiKeyQuery) {
        apiKey = apiKeyQuery;
    }

    return apiKey;
}

/**
 * Valida JWT token
 */
function validateJWT(token) {
    try {
        const decoded = jwt.verify(token, SECURITY_CONFIG.JWT_SECRET);
        return { valid: true, payload: decoded };
    } catch (error) {
        return { valid: false, error: error.message };
    }
}

/**
 * Sanitiza e valida channelId
 */
function validateChannelId(channelId) {
    if (!channelId) {
        return { valid: false, error: 'Channel ID is required' };
    }

    // Remover caracteres perigosos
    const sanitized = channelId.toString().replace(/[^a-zA-Z0-9\-_]/g, '');

    // Validações de segurança
    if (sanitized.length === 0) {
        return { valid: false, error: 'Invalid channel ID format' };
    }

    if (sanitized.length > 50) {
        return { valid: false, error: 'Channel ID too long' };
    }

    // Verificar padrões maliciosos
    const dangerousPatterns = [
        '../', '..\\', '/etc/', '/proc/', '/sys/',
        'javascript:', 'data:', 'vbscript:',
        '<script', '</script>', 'eval(', 'function(',
        'DROP', 'DELETE', 'UPDATE', 'INSERT', 'UNION'
    ];

    const lowerCaseId = sanitized.toLowerCase();
    for (const pattern of dangerousPatterns) {
        if (lowerCaseId.includes(pattern.toLowerCase())) {
            return { valid: false, error: 'Channel ID contains forbidden patterns' };
        }
    }

    return { valid: true, sanitized };
}

/**
 * Valida entrada de dados gerais
 */
function validateInput(data, rules = {}) {
    const errors = [];

    for (const [field, value] of Object.entries(data)) {
        const rule = rules[field];
        if (!rule) continue;

        // Verificar se é obrigatório
        if (rule.required && (value === undefined || value === null || value === '')) {
            errors.push(`${field} is required`);
            continue;
        }

        if (value === undefined || value === null) continue;

        // Validar tipo
        if (rule.type && typeof value !== rule.type) {
            errors.push(`${field} must be of type ${rule.type}`);
            continue;
        }

        // Validar comprimento
        if (rule.maxLength && value.toString().length > rule.maxLength) {
            errors.push(`${field} exceeds maximum length of ${rule.maxLength}`);
        }

        // Validar padrão
        if (rule.pattern && !rule.pattern.test(value.toString())) {
            errors.push(`${field} format is invalid`);
        }

        // Validar se é email
        if (rule.isEmail && !validator.isEmail(value.toString())) {
            errors.push(`${field} must be a valid email`);
        }

        // Validar se é URL
        if (rule.isURL && !validator.isURL(value.toString())) {
            errors.push(`${field} must be a valid URL`);
        }
    }

    return { valid: errors.length === 0, errors };
}

// ========== MIDDLEWARES DE SEGURANÇA ==========

/**
 * Middleware de autenticação base
 */
function authenticate(options = {}) {
    const { allowAPIKey = true, allowJWT = true, required = true } = options;

    return (req, res, next) => {
        try {
            // 🔧 NOVO: Suporte NO_AUTH para desenvolvimento
            if (process.env.NO_AUTH === 'true') {
                console.log('🔓 [AUTH] NO_AUTH mode - bypassing authentication for', req.method, req.originalUrl);
                return next();
            }

            let authenticated = false;
            let authInfo = null;

            // Tentar autenticação via API Key
            if (allowAPIKey) {
                const apiKey = extractAPIKey(req);
                if (apiKey && SECURITY_CONFIG.API_KEYS.has(apiKey)) {
                    authenticated = true;
                    authInfo = { type: 'api_key', key: apiKey };
                }
            }

            // Tentar autenticação via JWT se API Key falhou
            if (!authenticated && allowJWT) {
                const token = extractAPIKey(req); // Reutiliza a função para extrair token
                if (token) {
                    const jwtResult = validateJWT(token);
                    if (jwtResult.valid) {
                        authenticated = true;
                        authInfo = { type: 'jwt', payload: jwtResult.payload };
                    }
                }
            }

            if (!authenticated && required) {
                console.warn('[AUTH] 401 on %s %s — missing/invalid credentials', req.method, req.originalUrl);
                return res.status(401).json({
                    success: false,
                    error: 'Authentication required',
                    code: 'AUTH_REQUIRED',
                    hint: 'Send X-API-Key header with valid API key, or enable NO_AUTH=true for development'
                });
            }

            // Adicionar informações de autenticação ao request
            req.auth = authInfo;
            req.authenticated = authenticated;

            next();
        } catch (error) {
            console.error('❌ Authentication error:', error.message);
            res.status(500).json({
                success: false,
                error: 'Authentication system error',
                code: 'AUTH_ERROR'
            });
        }
    };
}

/**
 * Middleware de autorização baseado em IP
 */
function requireAllowedIP() {
    return (req, res, next) => {
        try {
            const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;

            if (!isIPAllowed(clientIP)) {
                console.warn(`⚠️ Access denied for IP: ${clientIP}`);
                return res.status(403).json({
                    success: false,
                    error: 'Access denied',
                    code: 'IP_NOT_ALLOWED',
                    details: 'Your IP address is not authorized to access this resource'
                });
            }

            req.clientIP = clientIP;
            next();
        } catch (error) {
            console.error('❌ IP validation error:', error.message);
            res.status(500).json({
                success: false,
                error: 'IP validation system error',
                code: 'IP_VALIDATION_ERROR'
            });
        }
    };
}

/**
 * Middleware de validação de channelId
 */
function validateChannelIdMiddleware() {
    return (req, res, next) => {
        try {
            const channelId = req.params.channelId || req.body.channelId || req.query.channelId;

            if (channelId) {
                const validation = validateChannelId(channelId);
                if (!validation.valid) {
                    return res.status(400).json({
                        success: false,
                        error: 'Invalid channel ID',
                        code: 'INVALID_CHANNEL_ID',
                        details: validation.error
                    });
                }

                // Substituir o channelId original pelo sanitizado
                if (req.params.channelId) req.params.channelId = validation.sanitized;
                if (req.body.channelId) req.body.channelId = validation.sanitized;
                if (req.query.channelId) req.query.channelId = validation.sanitized;
            }

            next();
        } catch (error) {
            console.error('❌ Channel ID validation error:', error.message);
            res.status(500).json({
                success: false,
                error: 'Channel ID validation system error',
                code: 'CHANNEL_VALIDATION_ERROR'
            });
        }
    };
}

/**
 * Middleware de validação de entrada personalizada
 */
function validateInputMiddleware(rules) {
    return (req, res, next) => {
        try {
            const dataToValidate = { ...req.body, ...req.query, ...req.params };
            const validation = validateInput(dataToValidate, rules);

            if (!validation.valid) {
                return res.status(400).json({
                    success: false,
                    error: 'Validation failed',
                    code: 'VALIDATION_ERROR',
                    details: validation.errors
                });
            }

            next();
        } catch (error) {
            console.error('❌ Input validation error:', error.message);
            res.status(500).json({
                success: false,
                error: 'Input validation system error',
                code: 'INPUT_VALIDATION_ERROR'
            });
        }
    };
}

/**
 * Middleware de proteção CSRF
 */
function csrfProtection() {
    return (req, res, next) => {
        try {
            // Para requests GET, HEAD, OPTIONS não precisamos verificar CSRF
            if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
                return next();
            }

            const csrfToken = req.headers['x-csrf-token'] || req.body._csrf || req.query._csrf;
            const sessionToken = req.session?.csrfToken;

            // Se não há token de sessão, criar um novo
            if (!sessionToken) {
                req.session = req.session || {};
                req.session.csrfToken = crypto.randomBytes(32).toString('hex');

                // Para APIs, aceitar se há autenticação válida
                if (req.authenticated) {
                    return next();
                }

                return res.status(403).json({
                    success: false,
                    error: 'CSRF token required',
                    code: 'CSRF_TOKEN_REQUIRED',
                    csrfToken: req.session.csrfToken
                });
            }

            // Verificar se o token está presente e é válido
            if (!csrfToken || csrfToken !== sessionToken) {
                return res.status(403).json({
                    success: false,
                    error: 'Invalid CSRF token',
                    code: 'INVALID_CSRF_TOKEN'
                });
            }

            next();
        } catch (error) {
            console.error('❌ CSRF protection error:', error.message);
            res.status(500).json({
                success: false,
                error: 'CSRF protection system error',
                code: 'CSRF_ERROR'
            });
        }
    };
}

// ========== RATE LIMITERS ==========

const createRateLimit = (config, keyGenerator = null) => {
    return rateLimit({
        windowMs: config.windowMs,
        max: config.max,
        message: {
            success: false,
            error: 'Too many requests',
            code: 'RATE_LIMIT_EXCEEDED',
            details: `Maximum ${config.max} requests per ${Math.round(config.windowMs / 60000)} minutes`
        },
        standardHeaders: true,
        legacyHeaders: false,
        // Remove custom keyGenerator to use default which handles IPv6 correctly
        // keyGenerator: keyGenerator || ((req) => {
        //     return req.ip || req.connection.remoteAddress;
        // }),
        handler: (req, res) => {
            console.warn(`⚠️ Rate limit exceeded for IP: ${req.ip}`);
            res.status(429).json({
                success: false,
                error: 'Too many requests',
                code: 'RATE_LIMIT_EXCEEDED',
                details: `Maximum ${config.max} requests per ${Math.round(config.windowMs / 60000)} minutes`
            });
        }
    });
};

// Rate limiters específicos
const strictRateLimit = createRateLimit(SECURITY_CONFIG.RATE_LIMITS.strict);
const moderateRateLimit = createRateLimit(SECURITY_CONFIG.RATE_LIMITS.moderate);
const lenientRateLimit = createRateLimit(SECURITY_CONFIG.RATE_LIMITS.lenient);

// ========== UTILIDADES PARA GERAR TOKENS ==========

/**
 * Gera JWT token
 */
function generateJWT(payload, expiresIn = SECURITY_CONFIG.JWT_EXPIRES_IN) {
    return jwt.sign(payload, SECURITY_CONFIG.JWT_SECRET, { expiresIn });
}

/**
 * Gera API key segura
 */
function generateAPIKey() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Gera token CSRF
 */
function generateCSRFToken() {
    return crypto.randomBytes(32).toString('hex');
}

// ========== EXPORTS ==========

module.exports = {
    // Middlewares principais
    authenticate,
    requireAllowedIP,
    validateChannelIdMiddleware,
    validateInputMiddleware,
    csrfProtection,

    // Rate limiters
    strictRateLimit,
    moderateRateLimit,
    lenientRateLimit,
    createRateLimit,

    // Utilidades
    validateChannelId,
    validateInput,
    validateJWT,
    generateJWT,
    generateAPIKey,
    generateCSRFToken,

    // Configurações
    SECURITY_CONFIG
};
