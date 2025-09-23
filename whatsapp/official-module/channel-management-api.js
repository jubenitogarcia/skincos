const express = require('express');
const LicensedChannelManager = require('./channelManager');

// Import security middleware
const {
    authenticate,
    requireAllowedIP,
    validateChannelIdMiddleware,
    validateInputMiddleware,
    csrfProtection,
    strictRateLimit,
    moderateRateLimit,
    lenientRateLimit
} = require('./middleware/security');

/**
 * Channel Management API
 *
 * Fornece todas as APIs para gerenciamento de canais multi-licenciados:
 * - Ativar/desativar canais
 * - Listar canais ativos
 * - Status por canal
 * - Gerenciar licenças
 * - Roteamento dinâmico
 */
class ChannelManagementAPI {
    constructor(options = {}) {
        this.channelManager = new LicensedChannelManager(options);
        this.router = express.Router();
        this.setupRoutes();

        // Track dynamic routes for cleanup
        this.dynamicRoutes = new Map(); // channelId -> router
        this.app = null; // Reference to Express app for dynamic mounting

        console.log('🚀 Channel Management API initialized');
    }

    /**
     * Configura todas as rotas da API
     */
    setupRoutes() {
        // ========== LICENSE MANAGEMENT ==========

        // Get all licenses - Critical operation requiring IP allowlist + authentication
        this.router.get('/licenses',
            strictRateLimit,
            requireAllowedIP(),
            authenticate({ required: true }),
            (req, res) => {
                try {
                    const result = this.channelManager.getLicenses();
                    res.json(result);
                } catch (error) {
                    console.error('❌ Error getting licenses:', error.message);
                    res.status(500).json({ success: false, error: error.message });
                }
            }
        );

        // Add new license - Critical operation requiring IP allowlist + authentication + CSRF
        this.router.post('/licenses',
            strictRateLimit,
            requireAllowedIP(),
            authenticate({ required: true }),
            csrfProtection(),
            validateInputMiddleware({
                licenseKey: { required: true, type: 'string', maxLength: 100, pattern: /^[A-Za-z0-9\-_]+$/ },
                licenseData: { type: 'object' }
            }),
            (req, res) => {
                try {
                    const { licenseKey, licenseData } = req.body;

                    const result = this.channelManager.addLicense(licenseKey, licenseData || {});
                    res.json(result);
                } catch (error) {
                    console.error('❌ Error adding license:', error.message);
                    res.status(500).json({ success: false, error: error.message });
                }
            }
        );

        // Validate license
        this.router.post('/licenses/:licenseKey/validate',
            strictRateLimit,
            authenticate({ required: true }),
            (req, res) => {
                try {
                    const { licenseKey } = req.params;
                    const validation = this.channelManager.validateLicense(licenseKey);

                    res.json({
                        success: validation.valid,
                        licenseKey,
                        ...validation
                    });
                } catch (error) {
                    console.error('❌ Error validating license:', error.message);
                    res.status(500).json({ success: false, error: error.message });
                }
            });

        // ========== CHANNEL MANAGEMENT ==========

        // Get all active channels - Requires authentication + rate limiting
        this.router.get('/channels',
            moderateRateLimit,
            authenticate({ required: true }),
            (req, res) => {
                try {
                    const result = this.channelManager.getActiveChannels();
                    res.json(result);
                } catch (error) {
                    console.error('❌ Error getting channels:', error.message);
                    res.status(500).json({ success: false, error: error.message });
                }
            }
        );

        // Get specific channel status - Requires authentication + channel validation
        this.router.get('/channels/:channelId',
            moderateRateLimit,
            authenticate({ required: true }),
            validateChannelIdMiddleware(),
            (req, res) => {
                try {
                    const { channelId } = req.params;
                    const result = this.channelManager.getChannelStatus(channelId);
                    res.json(result);
                } catch (error) {
                    console.error('❌ Error getting channel status:', error.message);
                    res.status(500).json({ success: false, error: error.message });
                }
            }
        );

        // Activate channel - Critical operation requiring IP allowlist + authentication + CSRF
        this.router.post('/channels/:channelId/activate',
            strictRateLimit,
            requireAllowedIP(),
            authenticate({ required: true }),
            csrfProtection(),
            validateChannelIdMiddleware(),
            validateInputMiddleware({
                licenseKey: { required: true, type: 'string', maxLength: 100, pattern: /^[A-Za-z0-9\-_]+$/ },
                options: { type: 'object' }
            }),
            async (req, res) => {
                try {
                    const { channelId } = req.params;
                    const { licenseKey, options } = req.body;

                    const result = await this.channelManager.activateChannel(channelId, licenseKey, options || {});

                    // Create dynamic routes for the new channel
                    this.createDynamicChannelRoutes(channelId);

                    res.json(result);
                } catch (error) {
                    console.error('❌ Error activating channel:', error.message);
                    res.status(500).json({ success: false, error: error.message });
                }
            }
        );

        // Deactivate channel - Critical operation requiring IP allowlist + authentication + CSRF
        this.router.delete('/channels/:channelId',
            strictRateLimit,
            requireAllowedIP(),
            authenticate({ required: true }),
            csrfProtection(),
            validateChannelIdMiddleware(),
            async (req, res) => {
                try {
                    const { channelId } = req.params;
                    const result = await this.channelManager.deactivateChannel(channelId);

                    // Remove dynamic routes for the channel
                    this.removeDynamicChannelRoutes(channelId);

                    res.json(result);
                } catch (error) {
                    console.error('❌ Error deactivating channel:', error.message);
                    res.status(500).json({ success: false, error: error.message });
                }
            }
        );

        // ========== CHANNEL OPERATIONS ==========

        // Get channel QR code - Secured endpoint requiring authentication + IP allowlist
        this.router.get('/channels/:channelId/qr',
            strictRateLimit,
            requireAllowedIP(),
            authenticate({ required: true }),
            validateChannelIdMiddleware(),
            (req, res) => {
                try {
                    const { channelId } = req.params;
                    const channelInstance = this.channelManager.getChannelInstance(channelId);

                    if (!channelInstance) {
                        return res.status(404).json({ success: false, error: 'Channel not found' });
                    }

                    res.json({
                        success: true,
                        channelId,
                        qr: channelInstance.qrCode,
                        status: channelInstance.status,
                        hasQR: !!channelInstance.qrCode
                    });
                } catch (error) {
                    console.error('❌ Error getting channel QR:', error.message);
                    res.status(500).json({ success: false, error: error.message });
                }
            });

        // Send message through specific channel - Critical operation requiring full security
        this.router.post('/channels/:channelId/send-message',
            strictRateLimit,
            requireAllowedIP(),
            authenticate({ required: true }),
            csrfProtection(),
            validateChannelIdMiddleware(),
            validateInputMiddleware({
                number: { required: true, type: 'string', maxLength: 50, pattern: /^[0-9+\-\s@\.]+$/ },
                message: { required: true, type: 'string', maxLength: 4096 }
            }),
            async (req, res) => {
                try {
                    const { channelId } = req.params;
                    const { number, message } = req.body;

                    if (!number || !message) {
                        return res.status(400).json({ success: false, error: 'Number and message are required' });
                    }

                    const channelInstance = this.channelManager.getChannelInstance(channelId);

                    if (!channelInstance) {
                        return res.status(404).json({ success: false, error: 'Channel not found' });
                    }

                    if (channelInstance.status !== 'ready') {
                        return res.status(400).json({ success: false, error: 'Channel not ready' });
                    }

                    const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
                    const result = await channelInstance.client.sendMessage(chatId, message);

                    channelInstance.lastActivity = new Date();

                    res.json({
                        success: true,
                        channelId,
                        messageId: result.id._serialized,
                        timestamp: new Date().toISOString()
                    });

                } catch (error) {
                    console.error('❌ Error sending message:', error.message);
                    res.status(500).json({ success: false, error: error.message });
                }
            });

        // Get channel chats - Secured endpoint requiring authentication + IP allowlist
        this.router.get('/channels/:channelId/chats',
            moderateRateLimit,
            requireAllowedIP(),
            authenticate({ required: true }),
            validateChannelIdMiddleware(),
            async (req, res) => {
                try {
                    const { channelId } = req.params;
                    const channelInstance = this.channelManager.getChannelInstance(channelId);

                    if (!channelInstance) {
                        return res.status(404).json({ success: false, error: 'Channel not found' });
                    }

                    if (channelInstance.status !== 'ready') {
                        return res.status(400).json({ success: false, error: 'Channel not ready' });
                    }

                    const chats = await channelInstance.chatManager.getChats();
                    channelInstance.lastActivity = new Date();

                    res.json({
                        success: true,
                        channelId,
                        count: chats.length,
                        chats
                    });

                } catch (error) {
                    console.error('❌ Error getting chats:', error.message);
                    res.status(500).json({ success: false, error: error.message });
                }
            });

        // Get channel contacts
        this.router.get('/channels/:channelId/contacts',
            moderateRateLimit,
            requireAllowedIP(),
            authenticate({ required: true }),
            validateChannelIdMiddleware(),
            async (req, res) => {
                try {
                    const { channelId } = req.params;
                    const channelInstance = this.channelManager.getChannelInstance(channelId);

                    if (!channelInstance) {
                        return res.status(404).json({ success: false, error: 'Channel not found' });
                    }

                    if (channelInstance.status !== 'ready') {
                        return res.status(400).json({ success: false, error: 'Channel not ready' });
                    }

                    const contacts = await channelInstance.contactManager.getContacts();
                    channelInstance.lastActivity = new Date();

                    res.json({
                        success: true,
                        channelId,
                        count: contacts.length,
                        contacts
                    });

                } catch (error) {
                    console.error('❌ Error getting contacts:', error.message);
                    res.status(500).json({ success: false, error: error.message });
                }
            });

        // ========== SYSTEM MANAGEMENT ==========

        // Get system status
        this.router.get('/system/status', (req, res) => {
            try {
                const channels = this.channelManager.getActiveChannels();
                const licenses = this.channelManager.getLicenses();

                res.json({
                    success: true,
                    system: {
                        status: 'running',
                        uptime: process.uptime(),
                        timestamp: new Date().toISOString()
                    },
                    channels: {
                        active: channels.count,
                        max: channels.maxChannels
                    },
                    licenses: {
                        total: licenses.count
                    }
                });
            } catch (error) {
                console.error('❌ Error getting system status:', error.message);
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Restart specific channel
        this.router.post('/channels/:channelId/restart',
            strictRateLimit,
            requireAllowedIP(),
            authenticate({ required: true }),
            csrfProtection(),
            validateChannelIdMiddleware(),
            async (req, res) => {
                try {
                    const { channelId } = req.params;
                    const channelInstance = this.channelManager.getChannelInstance(channelId);

                    if (!channelInstance) {
                        return res.status(404).json({ success: false, error: 'Channel not found' });
                    }

                    console.log(`🔄 Restarting channel ${channelId}`);

                    // Store license key for reactivation
                    const licenseKey = channelInstance.licenseKey;

                    // Deactivate and reactivate
                    await this.channelManager.deactivateChannel(channelId);
                    await this.channelManager.activateChannel(channelId, licenseKey);

                    // Recreate dynamic routes
                    this.removeDynamicChannelRoutes(channelId);
                    this.createDynamicChannelRoutes(channelId);

                    res.json({
                        success: true,
                        channelId,
                        status: 'restarted',
                        timestamp: new Date().toISOString()
                    });

                } catch (error) {
                    console.error('❌ Error restarting channel:', error.message);
                    res.status(500).json({ success: false, error: error.message });
                }
            });

        console.log('✅ Channel Management API routes configured');
    }

    /**
     * Cria rotas dinâmicas para um canal específico
     */
    createDynamicChannelRoutes(channelId) {
        if (this.dynamicRoutes.has(channelId)) {
            console.log(`⚠️ Dynamic routes for channel ${channelId} already exist`);
            return;
        }

        const channelRouter = this.channelManager.createChannelRoutes(channelId);
        this.dynamicRoutes.set(channelId, channelRouter);

        // Mount routes immediately if app is available
        if (this.app) {
            this.app.use(`/whatsapp/${channelId}`, channelRouter);
            console.log(`🔗 Mounted dynamic routes for channel ${channelId} at /whatsapp/${channelId}/*`);
        } else {
            console.log(`🔗 Created dynamic routes for channel ${channelId} (will mount when app is available)`);
        }
    }

    /**
     * Remove rotas dinâmicas para um canal específico
     */
    removeDynamicChannelRoutes(channelId) {
        if (this.dynamicRoutes.has(channelId)) {
            this.dynamicRoutes.delete(channelId);
            console.log(`🗑️ Removed dynamic routes for channel ${channelId}`);
            // Note: Express doesn't provide a direct way to unmount routes
            // The routes will be inactive because the channel is deactivated
        }
    }

    /**
     * Monta todas as rotas dinamicamente para canais ativos
     */
    mountDynamicRoutes(app) {
        // Mount dynamic channel routes
        for (const [channelId, channelRouter] of this.dynamicRoutes) {
            app.use(`/whatsapp/${channelId}`, channelRouter);
            console.log(`🔗 Mounted dynamic routes for channel ${channelId} at /whatsapp/${channelId}/*`);
        }
    }

    /**
     * Aplica rotas do gerenciador de canais a uma aplicação Express
     */
    applyToApp(app) {
        // Store app reference for dynamic mounting
        this.app = app;

        // Mount main management API
        app.use('/api/channel-manager', this.router);

        // Mount existing dynamic channel routes
        this.mountDynamicRoutes(app);

        console.log('✅ Channel Management API applied to Express app');
        console.log('📋 Available routes:');
        console.log('   GET    /api/channel-manager/licenses');
        console.log('   POST   /api/channel-manager/licenses');
        console.log('   POST   /api/channel-manager/licenses/:key/validate');
        console.log('   GET    /api/channel-manager/channels');
        console.log('   GET    /api/channel-manager/channels/:id');
        console.log('   POST   /api/channel-manager/channels/:id/activate');
        console.log('   DELETE /api/channel-manager/channels/:id');
        console.log('   GET    /api/channel-manager/channels/:id/qr');
        console.log('   POST   /api/channel-manager/channels/:id/send-message');
        console.log('   GET    /api/channel-manager/channels/:id/chats');
        console.log('   GET    /api/channel-manager/channels/:id/contacts');
        console.log('   POST   /api/channel-manager/channels/:id/restart');
        console.log('   GET    /api/channel-manager/system/status');
        console.log('');
        console.log('📋 Dynamic channel routes (per active channel):');
        console.log('   GET    /whatsapp/:channelId/status');
        console.log('   GET    /whatsapp/:channelId/qr');
        console.log('   POST   /whatsapp/:channelId/send-message');
        console.log('   GET    /whatsapp/:channelId/chats');
        console.log('   GET    /whatsapp/:channelId/contacts');
    }

    /**
     * Lazy initialization placeholder — channels are now started explicitly via API.
     * Kept for backward compatibility: now only creates dynamic routes without activating clients.
     */
    async initializeActiveChannels() {
        try {
            console.log('🧭 Lazy mode: not auto-activating channels on startup');
            // Ensure routes exist for any pre-listed active channels, but do not start clients
            const activeChannels = Array.from(this.channelManager.activeChannels);
            for (const channelId of activeChannels) {
                this.createDynamicChannelRoutes(channelId);
            }
            if (activeChannels.length === 0) {
                // Expose at least channel 1 routes for convenience
                this.createDynamicChannelRoutes('1');
            }
            console.log('✅ Dynamic routes ready. Use POST /api/channel-manager/channels/:id/activate to start a channel.');
        } catch (error) {
            console.error('❌ Error preparing dynamic routes:', error.message);
        }
    }

    /**
     * Limpa dados de sessão de um canal para prevenir conflitos
     */
    async cleanChannelSessionData(channelId) {
        try {
            console.log(`🧹 Cleaning session data for channel ${channelId}...`);

            const sessionPath = this.channelManager.createChannelSessionPath(channelId);
            const fs = require('fs');

            // Remove session directory if it exists
            if (fs.existsSync(sessionPath)) {
                fs.rmSync(sessionPath, { recursive: true, force: true });
                console.log(`🗑️ Removed session directory: ${sessionPath}`);
            }

            // Clean user data directory for the channel
            const userDataDir = this.channelManager.createChannelUserDataDir(channelId);
            if (fs.existsSync(userDataDir)) {
                fs.rmSync(userDataDir, { recursive: true, force: true });
                console.log(`🗑️ Removed user data directory: ${userDataDir}`);
            }

            console.log(`✅ Session cleanup completed for channel ${channelId}`);

        } catch (cleanupError) {
            console.warn(`⚠️ Session cleanup warning for channel ${channelId}:`, cleanupError.message);
            // Don't throw - continue with activation even if cleanup fails
        }
    }

    /**
     * Destroi o gerenciador de canais e limpa recursos
     */
    async destroy() {
        console.log('🛑 Destroying Channel Management API...');

        // Clear dynamic routes
        this.dynamicRoutes.clear();

        // Destroy channel manager
        await this.channelManager.destroy();

        console.log('✅ Channel Management API destroyed');
    }

    /**
     * Obtém informações do gerenciador de canais
     */
    getChannelManager() {
        return this.channelManager;
    }

    /**
     * Obtém router principal da API
     */
    getRouter() {
        return this.router;
    }
}

module.exports = ChannelManagementAPI;
