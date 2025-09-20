const AuthService = require('../lib/auth-service');
const rateLimit = require('express-rate-limit');

/**
 * Enterprise Authentication Middleware
 * Provides JWT validation, tenant isolation, and RBAC
 */
class AuthMiddleware {
    constructor() {
        this.authService = new AuthService();
        
        // Rate limiting for auth endpoints
        this.authRateLimit = rateLimit({
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 5, // 5 attempts per window
            message: {
                error: 'Too many authentication attempts',
                details: 'Please try again after 15 minutes'
            },
            standardHeaders: true,
            legacyHeaders: false,
        });

        // Rate limiting for API endpoints (per tenant)
        this.apiRateLimit = rateLimit({
            windowMs: 60 * 1000, // 1 minute
            max: (req) => {
                // Different limits based on authentication type
                if (req.auth?.type === 'api_key') return 1000; // Higher for API keys
                if (req.auth?.role === 'admin') return 500; // Higher for admins
                return 100; // Default for regular users
            },
            keyGenerator: (req, res) => {
                // Rate limit per tenant + user/api_key (IPv6 compatible)
                const identifier = req.auth?.user_id || req.auth?.key_name || rateLimit.ipKeyGenerator(req, res);
                return `${req.auth?.tenant_id || 'unknown'}:${identifier}`;
            },
            message: {
                error: 'Rate limit exceeded',
                details: 'Too many requests for this tenant'
            }
        });

        console.log('🔐 Auth Middleware initialized');
    }

    /**
     * JWT Authentication Middleware
     * Validates JWT tokens and sets req.auth
     */
    requireAuth() {
        return async (req, res, next) => {
            try {
                const authHeader = req.headers.authorization;
                const apiKey = req.headers['x-api-key'];

                // Check for JWT token
                if (authHeader && authHeader.startsWith('Bearer ')) {
                    const token = authHeader.substring(7);
                    
                    const verification = this.authService.verifyToken(token);
                    if (!verification.valid) {
                        return this.unauthorizedResponse(res, 'Invalid or expired token');
                    }

                    // Set auth context
                    req.auth = {
                        type: 'jwt',
                        user_id: verification.decoded.user_id,
                        email: verification.decoded.email,
                        tenant_id: verification.decoded.tenant_id,
                        role: verification.decoded.role,
                        permissions: verification.decoded.permissions
                    };

                    // Log access
                    await this.authService.logAuditEvent(
                        req.auth.user_id,
                        req.auth.tenant_id,
                        'api_access',
                        req.path,
                        req.ip,
                        req.get('User-Agent'),
                        true
                    );

                    return next();
                }

                // Check for API key
                if (apiKey) {
                    const validation = await this.authService.validateApiKey(apiKey);
                    if (!validation.valid) {
                        return this.unauthorizedResponse(res, 'Invalid API key');
                    }

                    // Set auth context for API key
                    req.auth = {
                        type: 'api_key',
                        tenant_id: validation.tenant_id,
                        permissions: validation.permissions,
                        key_name: validation.key_name,
                        role: 'service' // API keys get service role
                    };

                    // Log API key access
                    await this.authService.logAuditEvent(
                        null,
                        req.auth.tenant_id,
                        'api_key_access',
                        req.path,
                        req.ip,
                        req.get('User-Agent'),
                        true,
                        null,
                        { key_name: validation.key_name }
                    );

                    return next();
                }

                // No authentication provided
                return this.unauthorizedResponse(res, 'Authentication required');

            } catch (error) {
                console.error('Auth middleware error:', error);
                return res.status(500).json({
                    error: 'Authentication service error',
                    details: 'Unable to validate authentication'
                });
            }
        };
    }

    /**
     * Permission-based authorization middleware
     */
    requirePermission(permission) {
        return (req, res, next) => {
            if (!req.auth) {
                return this.forbiddenResponse(res, 'Authentication required');
            }

            const hasPermission = this.authService.hasPermission(req.auth.permissions, permission);
            if (!hasPermission) {
                // Log permission denial
                this.authService.logAuditEvent(
                    req.auth.user_id,
                    req.auth.tenant_id,
                    'permission_denied',
                    req.path,
                    req.ip,
                    req.get('User-Agent'),
                    false,
                    `Missing permission: ${permission}`
                );

                return this.forbiddenResponse(res, `Insufficient permissions. Required: ${permission}`);
            }

            next();
        };
    }

    /**
     * Role-based authorization middleware
     */
    requireRole(roles) {
        const allowedRoles = Array.isArray(roles) ? roles : [roles];
        
        return (req, res, next) => {
            if (!req.auth) {
                return this.forbiddenResponse(res, 'Authentication required');
            }

            if (!allowedRoles.includes(req.auth.role)) {
                // Log role denial
                this.authService.logAuditEvent(
                    req.auth.user_id,
                    req.auth.tenant_id,
                    'role_denied',
                    req.path,
                    req.ip,
                    req.get('User-Agent'),
                    false,
                    `Role ${req.auth.role} not in allowed roles: ${allowedRoles.join(', ')}`
                );

                return this.forbiddenResponse(res, `Insufficient role. Required: ${allowedRoles.join(' or ')}`);
            }

            next();
        };
    }

    /**
     * Tenant isolation middleware
     * Ensures users can only access data from their tenant
     */
    enforceTenantIsolation() {
        return (req, res, next) => {
            if (!req.auth) {
                return this.forbiddenResponse(res, 'Authentication required');
            }

            // Add tenant_id to query/body if not already present
            if (req.method === 'GET' && !req.query.tenant_id) {
                req.query.tenant_id = req.auth.tenant_id;
            } else if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body && !req.body.tenant_id) {
                req.body.tenant_id = req.auth.tenant_id;
            }

            // For route parameters
            if (req.params.tenant_id && req.params.tenant_id !== req.auth.tenant_id) {
                // Only admins can access cross-tenant data
                if (req.auth.role !== 'admin') {
                    return this.forbiddenResponse(res, 'Access denied: Tenant isolation violation');
                }
            }

            next();
        };
    }

    /**
     * Admin-only middleware
     */
    requireAdmin() {
        return this.requireRole(['admin', 'super_admin']);
    }

    /**
     * Optional authentication middleware
     * Sets req.auth if valid token provided, but doesn't require it
     */
    optionalAuth() {
        return async (req, res, next) => {
            try {
                const authHeader = req.headers.authorization;
                const apiKey = req.headers['x-api-key'];

                if (authHeader && authHeader.startsWith('Bearer ')) {
                    const token = authHeader.substring(7);
                    const verification = this.authService.verifyToken(token);
                    
                    if (verification.valid) {
                        req.auth = {
                            type: 'jwt',
                            user_id: verification.decoded.user_id,
                            email: verification.decoded.email,
                            tenant_id: verification.decoded.tenant_id,
                            role: verification.decoded.role,
                            permissions: verification.decoded.permissions
                        };
                    }
                } else if (apiKey) {
                    const validation = await this.authService.validateApiKey(apiKey);
                    if (validation.valid) {
                        req.auth = {
                            type: 'api_key',
                            tenant_id: validation.tenant_id,
                            permissions: validation.permissions,
                            key_name: validation.key_name,
                            role: 'service'
                        };
                    }
                }

                next();
            } catch (error) {
                // Continue without auth on error
                next();
            }
        };
    }

    /**
     * Admin panel authentication middleware
     */
    requireAdminPanelAuth() {
        return async (req, res, next) => {
            try {
                // Check for session-based auth (for web interface)
                if (req.session && req.session.user) {
                    const user = req.session.user;
                    if (user.role === 'admin' || user.role === 'super_admin') {
                        req.auth = {
                            type: 'session',
                            user_id: user.id,
                            email: user.email,
                            tenant_id: user.tenant_id,
                            role: user.role,
                            permissions: user.permissions
                        };
                        return next();
                    }
                }

                // Check for JWT token
                const authResult = await new Promise((resolve) => {
                    this.requireAuth()(req, res, (err) => {
                        resolve(!err && req.auth && (req.auth.role === 'admin' || req.auth.role === 'super_admin'));
                    });
                });

                if (authResult) {
                    return next();
                }

                // Redirect to login page for web interface
                if (req.headers.accept && req.headers.accept.includes('text/html')) {
                    return res.redirect('/admin/login');
                }

                // Return JSON error for API requests
                return this.unauthorizedResponse(res, 'Admin authentication required');

            } catch (error) {
                console.error('Admin panel auth error:', error);
                return res.status(500).json({
                    error: 'Authentication service error'
                });
            }
        };
    }

    /**
     * Get rate limiting middleware for auth endpoints
     */
    getAuthRateLimit() {
        return this.authRateLimit;
    }

    /**
     * Get rate limiting middleware for API endpoints
     */
    getApiRateLimit() {
        return this.apiRateLimit;
    }

    /**
     * Standard unauthorized response
     */
    unauthorizedResponse(res, message = 'Unauthorized') {
        return res.status(401).json({
            error: 'Unauthorized',
            details: message,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Standard forbidden response
     */
    forbiddenResponse(res, message = 'Forbidden') {
        return res.status(403).json({
            error: 'Forbidden',
            details: message,
            timestamp: new Date().toISOString()
        });
    }
}

module.exports = AuthMiddleware;