const express = require('express');
const { body, validationResult } = require('express-validator');
const AuthService = require('../lib/auth-service');
const AuthMiddleware = require('../middleware/auth-middleware');

const router = express.Router();
const authService = new AuthService();
const authMiddleware = new AuthMiddleware();

/**
 * Enterprise Authentication Routes
 * Provides secure login, token refresh, and user management
 */

/**
 * POST /auth/login - User authentication
 */
router.post('/login',
    authMiddleware.getAuthRateLimit(),
    [
        body('email').isEmail().normalizeEmail(),
        body('password').isLength({ min: 6 })
    ],
    async (req, res) => {
        try {
            // Validate input
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    error: 'Validation failed',
                    details: errors.array()
                });
            }

            const { email, password } = req.body;
            const ipAddress = req.ip;
            const userAgent = req.get('User-Agent');

            // Authenticate user
            const result = await authService.authenticateUser(email, password, ipAddress, userAgent);

            res.json({
                success: true,
                message: 'Authentication successful',
                user: result.user,
                tokens: result.tokens,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Login error:', error);
            
            // Rate limit failed attempts
            if (error.message === 'Invalid credentials') {
                return res.status(401).json({
                    error: 'Authentication failed',
                    details: 'Invalid email or password',
                    timestamp: new Date().toISOString()
                });
            }

            res.status(500).json({
                error: 'Authentication service error',
                details: 'Unable to process login request',
                timestamp: new Date().toISOString()
            });
        }
    }
);

/**
 * POST /auth/refresh - Refresh access token
 */
router.post('/refresh',
    authMiddleware.getAuthRateLimit(),
    [
        body('refresh_token').notEmpty()
    ],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    error: 'Validation failed',
                    details: errors.array()
                });
            }

            const { refresh_token } = req.body;
            const ipAddress = req.ip;
            const userAgent = req.get('User-Agent');

            const result = await authService.refreshAccessToken(refresh_token, ipAddress, userAgent);

            res.json({
                success: true,
                message: 'Token refreshed successfully',
                tokens: result,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Token refresh error:', error);
            res.status(401).json({
                error: 'Token refresh failed',
                details: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }
);

/**
 * POST /auth/logout - Logout user (revoke refresh token)
 */
router.post('/logout',
    authMiddleware.requireAuth(),
    [
        body('refresh_token').notEmpty()
    ],
    async (req, res) => {
        try {
            const { refresh_token } = req.body;

            const success = await authService.revokeRefreshToken(refresh_token);

            // Log logout
            await authService.logAuditEvent(
                req.auth.user_id,
                req.auth.tenant_id,
                'logout',
                'auth',
                req.ip,
                req.get('User-Agent'),
                success
            );

            res.json({
                success: true,
                message: 'Logout successful',
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Logout error:', error);
            res.status(500).json({
                error: 'Logout failed',
                details: 'Unable to process logout request',
                timestamp: new Date().toISOString()
            });
        }
    }
);

/**
 * GET /auth/me - Get current user info
 */
router.get('/me',
    authMiddleware.requireAuth(),
    async (req, res) => {
        try {
            const user = {
                id: req.auth.user_id,
                email: req.auth.email,
                tenant_id: req.auth.tenant_id,
                role: req.auth.role,
                permissions: req.auth.permissions,
                auth_type: req.auth.type
            };

            res.json({
                success: true,
                user: user,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Get user info error:', error);
            res.status(500).json({
                error: 'Unable to retrieve user information',
                timestamp: new Date().toISOString()
            });
        }
    }
);

/**
 * POST /auth/users - Create new user (admin only)
 */
router.post('/users',
    authMiddleware.requireAuth(),
    authMiddleware.requireRole(['admin', 'super_admin']),
    [
        body('email').isEmail().normalizeEmail(),
        body('password').isLength({ min: 8 }),
        body('tenant_id').notEmpty(),
        body('role').isIn(['user', 'admin', 'manager']),
        body('permissions').optional().isArray()
    ],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    error: 'Validation failed',
                    details: errors.array()
                });
            }

            const { email, password, tenant_id, role, permissions = [] } = req.body;

            // Only super_admin can create admin users
            if (role === 'admin' && req.auth.role !== 'super_admin') {
                return res.status(403).json({
                    error: 'Insufficient permissions',
                    details: 'Only super_admin can create admin users'
                });
            }

            const user = await authService.createUser(email, password, tenant_id, role, permissions);

            // Log user creation
            await authService.logAuditEvent(
                req.auth.user_id,
                req.auth.tenant_id,
                'user_created',
                'users',
                req.ip,
                req.get('User-Agent'),
                true,
                null,
                { created_user_id: user.id, created_user_role: role }
            );

            res.status(201).json({
                success: true,
                message: 'User created successfully',
                user: {
                    id: user.id,
                    email: user.email,
                    tenant_id: user.tenant_id,
                    role: user.role,
                    permissions: user.permissions,
                    created_at: user.created_at
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Create user error:', error);
            
            if (error.message === 'Email already exists') {
                return res.status(409).json({
                    error: 'User already exists',
                    details: 'Email is already registered',
                    timestamp: new Date().toISOString()
                });
            }

            res.status(500).json({
                error: 'User creation failed',
                details: 'Unable to create user',
                timestamp: new Date().toISOString()
            });
        }
    }
);

/**
 * POST /auth/api-keys - Create API key (admin only)
 */
router.post('/api-keys',
    authMiddleware.requireAuth(),
    authMiddleware.requireRole(['admin', 'super_admin']),
    [
        body('key_name').notEmpty().isLength({ max: 100 }),
        body('tenant_id').notEmpty(),
        body('permissions').optional().isArray(),
        body('expires_at').optional().isISO8601()
    ],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    error: 'Validation failed',
                    details: errors.array()
                });
            }

            const { key_name, tenant_id, permissions = [], expires_at } = req.body;

            const apiKeyData = await authService.createApiKey(
                key_name,
                tenant_id,
                permissions,
                expires_at ? new Date(expires_at) : null
            );

            // Log API key creation
            await authService.logAuditEvent(
                req.auth.user_id,
                req.auth.tenant_id,
                'api_key_created',
                'api_keys',
                req.ip,
                req.get('User-Agent'),
                true,
                null,
                { key_name: key_name, target_tenant: tenant_id }
            );

            res.status(201).json({
                success: true,
                message: 'API key created successfully',
                api_key: apiKeyData.api_key, // Only returned once
                key_info: {
                    id: apiKeyData.id,
                    key_name: apiKeyData.key_name,
                    tenant_id: apiKeyData.tenant_id,
                    permissions: apiKeyData.permissions,
                    expires_at: apiKeyData.expires_at,
                    created_at: apiKeyData.created_at
                },
                warning: 'Store this API key securely. It will not be shown again.',
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Create API key error:', error);
            res.status(500).json({
                error: 'API key creation failed',
                details: 'Unable to create API key',
                timestamp: new Date().toISOString()
            });
        }
    }
);

/**
 * GET /auth/audit - Get audit logs (admin only)
 */
router.get('/audit',
    authMiddleware.requireAuth(),
    authMiddleware.requireRole(['admin', 'super_admin']),
    async (req, res) => {
        try {
            const {
                tenant_id,
                action,
                user_id,
                from_date,
                to_date,
                limit = 100,
                offset = 0
            } = req.query;

            let query = 'SELECT * FROM auth_audit_log WHERE 1=1';
            const params = [];
            let paramIndex = 1;

            // Apply filters
            if (tenant_id) {
                query += ` AND tenant_id = $${paramIndex++}`;
                params.push(tenant_id);
            }

            if (action) {
                query += ` AND action = $${paramIndex++}`;
                params.push(action);
            }

            if (user_id) {
                query += ` AND user_id = $${paramIndex++}`;
                params.push(user_id);
            }

            if (from_date) {
                query += ` AND created_at >= $${paramIndex++}`;
                params.push(from_date);
            }

            if (to_date) {
                query += ` AND created_at <= $${paramIndex++}`;
                params.push(to_date);
            }

            // Non-admins can only see their own tenant data
            if (req.auth.role !== 'super_admin') {
                query += ` AND tenant_id = $${paramIndex++}`;
                params.push(req.auth.tenant_id);
            }

            query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
            params.push(parseInt(limit), parseInt(offset));

            const result = await authService.pool.query(query, params);

            res.json({
                success: true,
                audit_logs: result.rows,
                pagination: {
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    total: result.rows.length
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Get audit logs error:', error);
            res.status(500).json({
                error: 'Unable to retrieve audit logs',
                timestamp: new Date().toISOString()
            });
        }
    }
);

module.exports = router;