const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const express = require('express');

// Import security modules
const { encryptLicenseKey, decryptLicenseKey, saveEncryptedFile, loadEncryptedFile } = require('./middleware/encryption');

// 🔧 NOVO: Import authentication middleware
const { authenticate, moderateRateLimit } = require('./middleware/security');

// Import WhatsApp Web.js
const { Client, LocalAuth } = require('../official');

// Import extension handlers
const MediaHandler = require('./extensions/media-handler');
const ChatManager = require('./extensions/chat-manager');
const ContactManager = require('./extensions/contact-manager');

/**
 * LicensedChannelManager - Gerenciador de canais multi-licenciado
 *
 * Esta classe permite:
 * - Gerenciar múltiplos canais WhatsApp dinamicamente
 * - Sistema de licenças para ativar/desativar canais
 * - Isolamento de sessões por canal
 * - Validação de canais licenciados
 * - APIs de gerenciamento completas
 */
class LicensedChannelManager {
    constructor(options = {}) {
        this.channels = new Map(); // channelId -> ChannelInstance
        this.licenses = new Map(); // licenseKey -> LicenseInfo
        this.activeChannels = new Set(); // channelIds ativos
        this.maxChannels = options.maxChannels || 10;
        this.basePath = options.basePath || __dirname;
        this.sessionsPath = path.join(this.basePath, 'sessions');
        this.chromiumPath = options.chromiumPath || process.env.CHROMIUM_PATH || process.env.CHROME_PATH || '/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium';

        // Configuration file for active channels and licenses
        this.configPath = path.join(this.basePath, 'channels-config.json');

        // 🚀 NOVO: Sistema de tracking de clientes SSE para broadcast de eventos
        this.sseClients = new Map(); // channelId -> Set of response objects

        this.init();
    }

    /**
     * Inicializa o gerenciador de canais
     */
    init() {
        // Ensure sessions directory exists
        if (!fs.existsSync(this.sessionsPath)) {
            fs.mkdirSync(this.sessionsPath, { recursive: true });
        }

        // Load configuration
        this.loadConfiguration();

        console.log('🚀 LicensedChannelManager initialized');
        console.log(`📁 Sessions path: ${this.sessionsPath}`);
        console.log(`⚖️ Max channels: ${this.maxChannels}`);
        console.log(`🔑 Loaded ${this.licenses.size} licenses`);
        console.log(`📊 Active channels: ${this.activeChannels.size}`);
    }

    /**
     * 🚀 NOVO: Registra cliente SSE para receber broadcast de eventos
     */
    addSSEClient(channelId, res) {
        if (!this.sseClients.has(channelId)) {
            this.sseClients.set(channelId, new Set());
        }
        this.sseClients.get(channelId).add(res);
        console.log(`📡 SSE client registered for channel ${channelId} (total: ${this.sseClients.get(channelId).size})`);
    }

    /**
     * 🚀 NOVO: Remove cliente SSE quando desconecta
     */
    removeSSEClient(channelId, res) {
        if (this.sseClients.has(channelId)) {
            this.sseClients.get(channelId).delete(res);
            if (this.sseClients.get(channelId).size === 0) {
                this.sseClients.delete(channelId);
            }
            console.log(`📡 SSE client removed from channel ${channelId}`);
        }
    }

    /**
     * 🚀 NOVO: Broadcast mudanças de status para todos os clientes SSE
     */
    broadcastStatusChange(channelId, status, metadata = {}) {
        if (!this.sseClients.has(channelId)) {
            console.log(`📡 No SSE clients for channel ${channelId}, skipping broadcast`);
            return;
        }

        const channelInstance = this.getChannelInstance(channelId);
        if (!channelInstance) {
            console.warn(`⚠️ Channel ${channelId} not found for broadcast`);
            return;
        }

        const isConnected = status === 'connected' || status === 'ready';
        const isAuthenticated = status === 'authenticated' || status === 'connected' || status === 'ready';

        // 🚀 CORRIGIDO: Enviar eventos corretos que o frontend espera
        const statusData = {
            type: isConnected ? 'status_update' : 'qr_update', // Frontend espera esses tipos específicos
            channelId: channelId,
            qr: channelInstance.qrCode,
            status: status,
            timestamp: new Date().toISOString(),
            expiresAt: channelInstance.qrExpiresAt || null,
            connected: isConnected,
            authenticated: isAuthenticated,
            ...metadata
        };

        const clients = this.sseClients.get(channelId);
        const deadClients = new Set();

        clients.forEach(res => {
            try {
                // 🚀 CORREÇÃO CRÍTICA: Emitir AMBOS eventos para máxima compatibilidade
                // Original event type (manter compatibilidade existente)
                const originalEventType = channelInstance.qrCode && !isConnected ? 'qr' : 'state';

                // 🎯 PRIMEIRO: Emitir evento original
                res.write(`event: ${originalEventType}\ndata: ${JSON.stringify(statusData)}\n\n`);

                // 🎯 SEGUNDO: TAMBÉM emitir evento 'status' que o dashboard espera
                res.write(`event: status\ndata: ${JSON.stringify(statusData)}\n\n`);

                console.log(`📤 [${channelId}] Events '${originalEventType}' AND 'status' (status: ${status}) broadcasted to SSE client`);
            } catch (error) {
                console.warn(`⚠️ Failed to send SSE to client for channel ${channelId}:`, error.message);
                deadClients.add(res);
            }
        });

        // Cleanup dead clients
        deadClients.forEach(res => {
            this.removeSSEClient(channelId, res);
        });

        console.log(`🔥 [${channelId}] Status change '${status}' broadcasted to ${clients.size - deadClients.size} clients`);
    }

    /**
     * Carrega configuração de canais e licenças com fallback robusto
     */
    loadConfiguration() {
        try {
            if (fs.existsSync(this.configPath)) {
                console.log('📋 Loading configuration from:', this.configPath);

                // Try to load encrypted configuration first
                const encryptedResult = loadEncryptedFile(this.configPath);
                let config = null;

                if (encryptedResult.success) {
                    config = encryptedResult.data;
                    console.log('🔐 Loaded encrypted configuration successfully');
                } else {
                    console.log('⚠️ Encrypted configuration failed:', encryptedResult.error);

                    // Fallback: try to read as plain text JSON
                    try {
                        const plainTextData = fs.readFileSync(this.configPath, 'utf8');

                        // Check if it's a corrupted base64 (starts with "eyJ")
                        if (plainTextData.trim().startsWith('eyJ') && !plainTextData.includes('{')) {
                            console.log('🗑️ Detected corrupted base64 config, removing...');
                            fs.unlinkSync(this.configPath);
                            throw new Error('Corrupted configuration file removed');
                        }

                        config = JSON.parse(plainTextData);
                        console.log('📝 Loaded plain text configuration successfully');

                        // Migrate to encrypted format
                        console.log('🔄 Migrating to encrypted configuration...');
                        this.saveConfiguration(config);
                    } catch (plaintextError) {
                        console.error('❌ Plain text configuration also failed:', plaintextError.message);

                        // Backup corrupted file and remove it
                        const backupPath = this.configPath + '.corrupted.' + Date.now();
                        try {
                            fs.copyFileSync(this.configPath, backupPath);
                            fs.unlinkSync(this.configPath);
                            console.log('💾 Corrupted config backed up to:', backupPath);
                        } catch (backupError) {
                            console.error('⚠️ Failed to backup corrupted config:', backupError.message);
                        }

                        throw new Error('Configuration file is corrupted and has been reset');
                    }
                }

                if (!config) {
                    throw new Error('Failed to load any configuration');
                }

                // Load licenses with decryption
                if (config.licenses) {
                    config.licenses.forEach(license => {
                        let licenseData = license;

                        // Check if license key is encrypted
                        if (license.encrypted === true && license.encryptedKey) {
                            const decryptResult = decryptLicenseKey(license.encryptedKey);
                            if (decryptResult.success) {
                                licenseData = {
                                    ...license,
                                    key: decryptResult.licenseKey,
                                    metadata: decryptResult.metadata
                                };
                                delete licenseData.encryptedKey;
                                delete licenseData.encrypted;
                            } else {
                                console.error(`❌ Failed to decrypt license: ${license.key || 'unknown'}`);
                                return; // Skip this license
                            }
                        }

                        this.licenses.set(licenseData.key, {
                            ...licenseData,
                            createdAt: new Date(licenseData.createdAt),
                            expiresAt: licenseData.expiresAt ? new Date(licenseData.expiresAt) : null
                        });
                    });
                }

                // Load active channels
                if (config.activeChannels) {
                    config.activeChannels.forEach(channelId => {
                        this.activeChannels.add(channelId);
                    });
                }

                console.log('✅ Configuration loaded successfully');
            } else {
                // Create default configuration
                this.createDefaultConfiguration();
            }
        } catch (error) {
            console.error('❌ Error loading configuration:', error.message);
            this.createDefaultConfiguration();
        }
    }

    /**
     * Cria configuração padrão
     */
    createDefaultConfiguration() {
        const defaultConfig = {
            licenses: [
                {
                    key: 'DEFAULT_LICENSE_001',
                    type: 'premium',
                    maxChannels: 5,
                    features: ['basic_messaging', 'media_support', 'webhook_support'],
                    createdAt: new Date().toISOString(),
                    expiresAt: null,
                    active: true
                }
            ],
            activeChannels: []
        };

        this.saveConfiguration(defaultConfig);

        // Load the default license
        this.licenses.set('DEFAULT_LICENSE_001', {
            key: 'DEFAULT_LICENSE_001',
            type: 'premium',
            maxChannels: 5,
            features: ['basic_messaging', 'media_support', 'webhook_support'],
            createdAt: new Date(),
            expiresAt: null,
            active: true
        });

        console.log('📄 Default configuration created');
    }

    /**
     * Salva configuração no arquivo com criptografia
     */
    saveConfiguration(config = null) {
        try {
            const configToSave = config || {
                licenses: Array.from(this.licenses.values()).map(license => {
                    // Encrypt license key
                    const encryptResult = encryptLicenseKey(license.key, {
                        type: license.type,
                        maxChannels: license.maxChannels,
                        features: license.features
                    });

                    if (encryptResult.success) {
                        return {
                            ...license,
                            key: '***ENCRYPTED***', // Hide the actual key
                            encryptedKey: encryptResult.data,
                            encrypted: true,
                            createdAt: license.createdAt.toISOString(),
                            expiresAt: license.expiresAt ? license.expiresAt.toISOString() : null
                        };
                    } else {
                        console.warn(`⚠️ Failed to encrypt license key: ${license.key}`);
                        return {
                            ...license,
                            createdAt: license.createdAt.toISOString(),
                            expiresAt: license.expiresAt ? license.expiresAt.toISOString() : null
                        };
                    }
                }),
                activeChannels: Array.from(this.activeChannels),
                lastUpdated: new Date().toISOString(),
                version: '2.0' // Version for encrypted format
            };

            // Save using encrypted file system
            const saveResult = saveEncryptedFile(this.configPath, configToSave);

            if (saveResult.success) {
                console.log('💾🔐 Encrypted configuration saved successfully');
            } else {
                console.error('❌ Failed to save encrypted configuration, falling back to plain text');
                fs.writeFileSync(this.configPath, JSON.stringify(configToSave, null, 2));
                console.log('💾 Configuration saved (plain text fallback)');
            }
        } catch (error) {
            console.error('❌ Error saving configuration:', error.message);
        }
    }

    /**
     * Valida se uma licença é válida e ativa
     */
    validateLicense(licenseKey) {
        const license = this.licenses.get(licenseKey);

        if (!license) {
            return { valid: false, reason: 'License not found' };
        }

        if (!license.active) {
            return { valid: false, reason: 'License is inactive' };
        }

        if (license.expiresAt && new Date() > license.expiresAt) {
            return { valid: false, reason: 'License has expired' };
        }

        return { valid: true, license };
    }

    /**
     * Cria isolamento de sessão para um canal
     */
    createChannelSessionPath(channelId) {
        const channelSessionPath = path.join(this.sessionsPath, `channel-${channelId}`);

        if (!fs.existsSync(channelSessionPath)) {
            fs.mkdirSync(channelSessionPath, { recursive: true });
        }

        return channelSessionPath;
    }

    /**
     * Cria diretório de dados do usuário para um canal com cleanup automático
     */
    createChannelUserDataDir(channelId) {
        // Cleanup old userDataDir directories first
        this.cleanupOldUserDataDirs(channelId);

        const userDataDir = path.join(os.tmpdir(), `whatsapp-channel-${channelId}-${Date.now()}`);

        if (!fs.existsSync(userDataDir)) {
            fs.mkdirSync(userDataDir, { recursive: true });
        }

        // Store reference for cleanup
        if (!this.userDataDirs) {
            this.userDataDirs = new Map();
        }
        this.userDataDirs.set(channelId, userDataDir);

        console.log(`📁 Created userDataDir for channel ${channelId}: ${userDataDir}`);
        return userDataDir;
    }

    /**
     * Limpa diretórios antigos de userData para um canal
     */
    cleanupOldUserDataDirs(channelId) {
        try {
            const tempDir = os.tmpdir();
            const pattern = `whatsapp-channel-${channelId}-`;

            const files = fs.readdirSync(tempDir);
            let cleanedCount = 0;

            files.forEach(file => {
                if (file.startsWith(pattern)) {
                    const fullPath = path.join(tempDir, file);
                    try {
                        const stat = fs.statSync(fullPath);
                        // Remove directories older than 1 hour
                        const ageHours = (Date.now() - stat.mtime.getTime()) / (1000 * 60 * 60);

                        if (stat.isDirectory() && ageHours > 1) {
                            fs.rmSync(fullPath, { recursive: true, force: true });
                            cleanedCount++;
                            console.log(`🗑️ Cleaned old userDataDir: ${file}`);
                        }
                    } catch (cleanupError) {
                        console.warn(`⚠️ Failed to cleanup ${file}:`, cleanupError.message);
                    }
                }
            });

            if (cleanedCount > 0) {
                console.log(`✅ Cleaned ${cleanedCount} old userDataDir(s) for channel ${channelId}`);
            }
        } catch (error) {
            console.warn(`⚠️ Error during userDataDir cleanup for channel ${channelId}:`, error.message);
        }
    }

    /**
     * Força cleanup de todos os userDataDirs de um canal
     */
    forceCleanupChannelUserDataDirs(channelId) {
        try {
            // Cleanup stored reference
            if (this.userDataDirs && this.userDataDirs.has(channelId)) {
                const userDataDir = this.userDataDirs.get(channelId);
                if (fs.existsSync(userDataDir)) {
                    fs.rmSync(userDataDir, { recursive: true, force: true });
                    console.log(`🗑️ Force cleaned userDataDir: ${userDataDir}`);
                }
                this.userDataDirs.delete(channelId);
            }

            // Also cleanup any remaining directories
            this.cleanupOldUserDataDirs(channelId);
        } catch (error) {
            console.warn(`⚠️ Error during force cleanup for channel ${channelId}:`, error.message);
        }
    }

    /**
     * Cria um cliente WhatsApp para um canal específico
     */
    createChannelClient(channelId, options = {}) {
        // Support legacy session for Channel 1 backward compatibility
        const isLegacyChannel = channelId === '1' && options.useLegacySession;

        let sessionPath, clientId;

        if (isLegacyChannel) {
            // Use legacy session path and client ID for Channel 1 compatibility
            sessionPath = path.join(this.basePath, 'sessions', 'session-whatsapp-official-replit');
            clientId = 'whatsapp-official-replit';
            console.log(`🔄 Channel ${channelId}: Using LEGACY session for backward compatibility`);
        } else {
            sessionPath = this.createChannelSessionPath(channelId);
            clientId = options.clientId || `channel-${channelId}`;
        }

        const userDataDir = this.createChannelUserDataDir(channelId);

        console.log(`🔧 Creating client for channel ${channelId}`);
        console.log(`   Session path: ${sessionPath}`);
        console.log(`   Client ID: ${clientId}`);
        console.log(`   User data dir: ${userDataDir}`);

        // Ensure session directory exists
        if (!fs.existsSync(sessionPath)) {
            fs.mkdirSync(sessionPath, { recursive: true });
        }

        const client = new Client({
            authStrategy: new LocalAuth({
                clientId: clientId,
                dataPath: sessionPath
            }),
            puppeteer: {
                headless: true,
                timeout: 300000,
                protocolTimeout: 300000,
                handleSIGINT: false,
                handleSIGTERM: false,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--no-first-run',
                    '--disable-gpu',
                    '--disable-web-security',
                    '--disable-features=VizDisplayCompositor',
                    '--no-zygote',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                    '--disable-crash-reporter',
                    '--disable-breakpad',
                    '--disable-logging',
                    '--disable-ipc-flooding-protection',
                    `--user-data-dir=${userDataDir}`
                ],
                executablePath: this.chromiumPath
            }
        });

        return client;
    }

    /**
     * Ativa um canal com uma licença específica
     */
    async activateChannel(channelId, licenseKey, options = {}) {
        try {
            // Validate license
            const licenseValidation = this.validateLicense(licenseKey);
            if (!licenseValidation.valid) {
                throw new Error(`License validation failed: ${licenseValidation.reason}`);
            }

            const license = licenseValidation.license;

            // Check if channel already exists
            if (this.channels.has(channelId)) {
                throw new Error(`Channel ${channelId} is already active`);
            }

            // Check license limits
            const currentChannelsForLicense = Array.from(this.channels.values())
                .filter(channel => channel.licenseKey === licenseKey).length;

            if (currentChannelsForLicense >= license.maxChannels) {
                throw new Error(`License ${licenseKey} has reached maximum channels limit (${license.maxChannels})`);
            }

            // Check global limits
            if (this.channels.size >= this.maxChannels) {
                throw new Error(`Maximum channels limit reached (${this.maxChannels})`);
            }

            console.log(`🚀 Activating channel ${channelId} with license ${licenseKey}`);

            // Create client
            const client = this.createChannelClient(channelId, options);

            // Create extension handlers
            const mediaHandler = new MediaHandler(client);
            const chatManager = new ChatManager(client);
            const contactManager = new ContactManager(client);

            // Create channel instance
            const channelInstance = {
                channelId,
                licenseKey,
                client,
                mediaHandler,
                chatManager,
                contactManager,
                status: 'created',
                createdAt: new Date(),
                lastActivity: new Date(),
                qrCode: null,
                clientInfo: null,
                userDataDir: this.createChannelUserDataDir(channelId)
            };

            // Setup event listeners
            this.setupChannelEventListeners(channelInstance);

            // Store channel
            this.channels.set(channelId, channelInstance);
            this.activeChannels.add(channelId);

            // Save configuration
            this.saveConfiguration();

            // Initialize client
            client.initialize();

            console.log(`✅ Channel ${channelId} activated successfully`);

            return {
                success: true,
                channelId,
                status: 'activated',
                licenseKey,
                createdAt: channelInstance.createdAt
            };

        } catch (error) {
            console.error(`❌ Error activating channel ${channelId}:`, error.message);
            throw error;
        }
    }

    /**
     * Configura event listeners para um canal
     */
    setupChannelEventListeners(channelInstance) {
        const { client, channelId } = channelInstance;

        client.on('loading_screen', (percent, message) => {
            console.log(`📱 [${channelId}] Loading: ${percent}% - ${message}`);
            channelInstance.status = `loading: ${percent}%`;
            this.broadcastStatusChange(channelId, channelInstance.status, {
                percent,
                message,
                connected: false
            });
        });

        client.on('qr', (qr) => {
            console.log(`📱 [${channelId}] QR Code received`);
            channelInstance.qrCode = qr;
            channelInstance.status = 'qr_received';
            // QR expires after 30 seconds typically
            channelInstance.qrExpiresAt = new Date(Date.now() + 30 * 1000).toISOString();
            channelInstance.qrGeneratedAt = new Date().toISOString();
            this.broadcastStatusChange(channelId, 'qr_received', {
                qrCode: qr,
                expiresAt: channelInstance.qrExpiresAt,
                connected: false
            });
        });

        client.on('authenticated', () => {
            console.log(`📱 [${channelId}] Authenticated`);
            channelInstance.status = 'authenticated';
            channelInstance.qrCode = null;
            channelInstance.lastActivity = new Date();

            // 🚀 NOVO: Broadcast evento de autenticação para SSE clients
            this.broadcastStatusChange(channelId, 'authenticated', {
                authenticated: true,
                connected: false,
                timestamp: new Date().toISOString()
            });
            console.log(`🔥 [${channelId}] Authentication status broadcasted via SSE`);
        });

        client.on('auth_failure', (msg) => {
            console.error(`📱 [${channelId}] Authentication failure:`, msg);
            channelInstance.status = 'auth_failure';
            this.broadcastStatusChange(channelId, 'auth_failure', {
                error: msg,
                connected: false
            });
        });

        client.on('ready', async () => {
            console.log(`📱 [${channelId}] Ready`);
            channelInstance.status = 'connected'; // 🚀 NOVO: Status final é "connected"
            channelInstance.clientInfo = client.info;
            channelInstance.lastActivity = new Date();
            channelInstance.connectedAt = new Date().toISOString();

            // 🚀 NOVO: Broadcast evento de conexão bem-sucedida para SSE clients
            this.broadcastStatusChange(channelId, 'connected', {
                authenticated: true,
                connected: true,
                ready: true,
                clientInfo: client.info,
                connectedAt: channelInstance.connectedAt,
                timestamp: new Date().toISOString()
            });
            console.log(`🎉 [${channelId}] Connection ready status broadcasted via SSE - DASHBOARD SHOULD LOAD NOW`);
        });

        client.on('message', async (msg) => {
            console.log(`📱 [${channelId}] Message received:`, msg.body.substring(0, 50));
            channelInstance.lastActivity = new Date();
            // Atualizar último status de atividade via SSE
            this.broadcastStatusChange(channelId, channelInstance.status, {
                lastMessage: msg.body.substring(0, 50),
                lastActivity: channelInstance.lastActivity.toISOString(),
                connected: channelInstance.status === 'connected'
            });
        });

        client.on('disconnected', (reason) => {
            console.log(`📱 [${channelId}] Disconnected:`, reason);
            channelInstance.status = 'disconnected';
            channelInstance.qrCode = null;
            channelInstance.clientInfo = null;
            this.broadcastStatusChange(channelId, 'disconnected', {
                reason,
                connected: false,
                authenticated: false
            });
        });
    }

    /**
     * Desativa um canal
     */
    async deactivateChannel(channelId) {
        try {
            if (!this.channels.has(channelId)) {
                throw new Error(`Channel ${channelId} not found`);
            }

            console.log(`🛑 Deactivating channel ${channelId}`);

            const channelInstance = this.channels.get(channelId);

            // Destroy client
            if (channelInstance.client) {
                await channelInstance.client.destroy();
            }

            // Clean up user data directory
            try {
                if (fs.existsSync(channelInstance.userDataDir)) {
                    fs.rmSync(channelInstance.userDataDir, { recursive: true, force: true });
                }
            } catch (cleanupError) {
                console.warn(`⚠️ Could not clean user data dir for channel ${channelId}:`, cleanupError.message);
            }

            // Remove from active channels
            this.channels.delete(channelId);
            this.activeChannels.delete(channelId);

            // Save configuration
            this.saveConfiguration();

            console.log(`✅ Channel ${channelId} deactivated successfully`);

            return {
                success: true,
                channelId,
                status: 'deactivated'
            };

        } catch (error) {
            console.error(`❌ Error deactivating channel ${channelId}:`, error.message);
            throw error;
        }
    }

    /**
     * Lista todos os canais ativos
     */
    getActiveChannels() {
        const channels = [];

        for (const [channelId, channelInstance] of this.channels) {
            channels.push({
                channelId,
                licenseKey: channelInstance.licenseKey,
                status: channelInstance.status,
                createdAt: channelInstance.createdAt,
                lastActivity: channelInstance.lastActivity,
                hasQR: !!channelInstance.qrCode,
                clientInfo: channelInstance.clientInfo
            });
        }

        return {
            success: true,
            count: channels.length,
            maxChannels: this.maxChannels,
            channels
        };
    }

    /**
     * Obtém status de um canal específico
     */
    getChannelStatus(channelId) {
        if (!this.channels.has(channelId)) {
            return {
                success: false,
                error: 'Channel not found'
            };
        }

        const channelInstance = this.channels.get(channelId);

        return {
            success: true,
            channelId,
            status: channelInstance.status,
            licenseKey: channelInstance.licenseKey,
            createdAt: channelInstance.createdAt,
            lastActivity: channelInstance.lastActivity,
            qrCode: channelInstance.qrCode,
            clientInfo: channelInstance.clientInfo
        };
    }

    /**
     * Obtém instância de um canal
     */
    getChannelInstance(channelId) {
        return this.channels.get(channelId);
    }

    /**
     * Adiciona uma nova licença
     */
    addLicense(licenseKey, licenseData) {
        try {
            const license = {
                key: licenseKey,
                type: licenseData.type || 'basic',
                maxChannels: licenseData.maxChannels || 1,
                features: licenseData.features || ['basic_messaging'],
                createdAt: new Date(),
                expiresAt: licenseData.expiresAt ? new Date(licenseData.expiresAt) : null,
                active: licenseData.active !== false
            };

            this.licenses.set(licenseKey, license);
            this.saveConfiguration();

            console.log(`🔑 License ${licenseKey} added successfully`);

            return {
                success: true,
                licenseKey,
                license
            };

        } catch (error) {
            console.error(`❌ Error adding license ${licenseKey}:`, error.message);
            throw error;
        }
    }

    /**
     * Lista todas as licenças
     */
    getLicenses() {
        const licenses = Array.from(this.licenses.values());

        return {
            success: true,
            count: licenses.length,
            licenses
        };
    }

    /**
     * Cria rotas dinâmicas para um canal específico
     */
    createChannelRoutes(channelId) {
        const router = express.Router();

        // Status do canal - 🔧 AGORA COM AUTENTICAÇÃO
        router.get('/status',
            moderateRateLimit,
            authenticate({ required: true }), // 🔧 NOVO: Middleware de autenticação
            (req, res) => {
                const status = this.getChannelStatus(channelId);
                res.json(status);
            });

        // QR Code do canal - 🔧 AGORA COM AUTENTICAÇÃO
        router.get('/qr',
            moderateRateLimit,
            authenticate({ required: process.env.NODE_ENV !== 'development' }), // 🔧 CRITICAL: Auth protection
            (req, res) => {
                const channelInstance = this.getChannelInstance(channelId);
                if (!channelInstance) {
                    return res.status(404).json({ error: 'Channel not found' });
                }

                res.json({
                    success: true,
                    channelId,
                    qr: channelInstance.qrCode,
                    status: channelInstance.status,
                    timestamp: new Date().toISOString(),
                    expiresAt: channelInstance.qrExpiresAt || null
                });
            });

        // 🚀 MELHORADO: SSE stream com sistema de broadcast automático
        router.get('/qr/stream',
            moderateRateLimit,
            authenticate({ required: process.env.NODE_ENV !== 'development' }), // 🔧 CRITICAL: Auth protection
            (req, res) => {
                const channelInstance = this.getChannelInstance(channelId);
                if (!channelInstance) {
                    return res.status(404).json({ error: 'Channel not found' });
                }

                // Configure SSE headers
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Cache-Control',
                });

                // 🚀 NOVO: Registrar cliente para receber broadcasts automáticos
                this.addSSEClient(channelId, res);

                // Send heartbeat ping every 15s
                const sendHeartbeat = () => {
                    try {
                        res.write(`event: ping\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);
                    } catch (error) {
                        console.warn(`⚠️ Heartbeat failed for channel ${channelId}:`, error.message);
                        this.removeSSEClient(channelId, res);
                    }
                };

                // Send initial state data
                const sendInitialData = () => {
                    try {
                        const currentInstance = this.getChannelInstance(channelId);
                        if (currentInstance) {
                            const initialData = {
                                type: 'initial_state',
                                channelId: channelId,
                                status: currentInstance.status,
                                qr: currentInstance.qrCode,
                                timestamp: new Date().toISOString(),
                                expiresAt: currentInstance.qrExpiresAt || null,
                                connected: currentInstance.status === 'connected' || currentInstance.status === 'ready',
                                authenticated: currentInstance.status === 'authenticated' || currentInstance.status === 'connected' || currentInstance.status === 'ready',
                                clientInfo: currentInstance.clientInfo,
                                connectedAt: currentInstance.connectedAt
                            };
                            res.write(`event: initial\ndata: ${JSON.stringify(initialData)}\n\n`);
                            console.log(`📡 [${channelId}] Initial state sent to new SSE client`);
                        }
                    } catch (error) {
                        console.warn(`⚠️ Failed to send initial data for channel ${channelId}:`, error.message);
                        this.removeSSEClient(channelId, res);
                    }
                };

                // Send initial data immediately
                sendInitialData();

                // Set up heartbeat (every 15s)
                const heartbeatInterval = setInterval(sendHeartbeat, 15000);

                // Clean up on client disconnect
                const cleanup = () => {
                    clearInterval(heartbeatInterval);
                    this.removeSSEClient(channelId, res);
                };

                req.on('close', () => {
                    cleanup();
                    console.log(`🔌 SSE client disconnected from channel ${channelId} stream`);
                });

                req.on('error', (err) => {
                    cleanup();
                    console.error(`❌ SSE error for channel ${channelId}:`, err.message);
                });

                // Send initial heartbeat
                sendHeartbeat();
                console.log(`📡 SSE client connected to channel ${channelId} stream (automatic broadcasts enabled)`);
            });

        // 🆕 Endpoint para forçar geração de novo QR
        router.post('/start',
            moderateRateLimit,
            authenticate({ required: true }),
            async (req, res) => {
                try {
                    const channelInstance = this.getChannelInstance(channelId);
                    if (!channelInstance) {
                        return res.status(404).json({
                            success: false,
                            error: 'Channel not found'
                        });
                    }

                    console.log(`🔄 Forcing new QR generation for channel ${channelId}`);

                    // Restart the WhatsApp client to force new QR generation
                    if (channelInstance.client) {
                        try {
                            // Destroy current client
                            await channelInstance.client.destroy();

                            // Clear QR data
                            channelInstance.qrCode = null;
                            channelInstance.qrExpiresAt = null;
                            channelInstance.status = 'initializing';

                            // Recreate client - this will trigger new QR generation
                            await this.createWhatsAppClient(channelId, channelInstance.licenseKey);

                            res.json({
                                success: true,
                                channelId,
                                message: 'QR generation restarted',
                                timestamp: new Date().toISOString()
                            });

                        } catch (restartError) {
                            console.error(`❌ Error restarting channel ${channelId}:`, restartError.message);
                            res.status(500).json({
                                success: false,
                                error: 'Failed to restart channel',
                                details: restartError.message
                            });
                        }
                    } else {
                        // If no client exists, activate the channel
                        const result = await this.activateChannel(channelId, channelInstance.licenseKey);
                        if (result.success) {
                            res.json({
                                success: true,
                                channelId,
                                message: 'Channel activated, QR will be generated',
                                timestamp: new Date().toISOString()
                            });
                        } else {
                            res.status(500).json({
                                success: false,
                                error: 'Failed to activate channel',
                                details: result.error
                            });
                        }
                    }

                } catch (error) {
                    console.error(`❌ Error in start endpoint for channel ${channelId}:`, error.message);
                    res.status(500).json({
                        success: false,
                        error: 'Internal server error',
                        details: error.message
                    });
                }
            });


        // Enviar mensagem
        router.post('/send-message', async (req, res) => {
            try {
                const { number, message } = req.body;
                const channelInstance = this.getChannelInstance(channelId);

                if (!channelInstance) {
                    return res.status(404).json({ error: 'Channel not found' });
                }

                if (channelInstance.status !== 'ready') {
                    return res.status(400).json({ error: 'Channel not ready' });
                }

                const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
                const result = await channelInstance.client.sendMessage(chatId, message);

                channelInstance.lastActivity = new Date();

                res.json({
                    success: true,
                    channelId,
                    messageId: result.id._serialized
                });

            } catch (error) {
                console.error(`❌ Error sending message on channel ${channelId}:`, error.message);
                res.status(500).json({ error: error.message });
            }
        });

        // Chats do canal
        router.get('/chats', async (req, res) => {
            try {
                const channelInstance = this.getChannelInstance(channelId);

                if (!channelInstance) {
                    return res.status(404).json({ error: 'Channel not found' });
                }

                if (channelInstance.status !== 'ready') {
                    return res.status(400).json({ error: 'Channel not ready' });
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
                console.error(`❌ Error getting chats for channel ${channelId}:`, error.message);
                res.status(500).json({ error: error.message });
            }
        });

        // Contatos do canal
        router.get('/contacts', async (req, res) => {
            try {
                const channelInstance = this.getChannelInstance(channelId);

                if (!channelInstance) {
                    return res.status(404).json({ error: 'Channel not found' });
                }

                if (channelInstance.status !== 'ready') {
                    return res.status(400).json({ error: 'Channel not ready' });
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
                console.error(`❌ Error getting contacts for channel ${channelId}:`, error.message);
                res.status(500).json({ error: error.message });
            }
        });

        return router;
    }

    /**
     * Destrói todos os canais e limpa recursos
     */
    async destroy() {
        console.log('🛑 Destroying all channels...');

        for (const channelId of this.channels.keys()) {
            try {
                await this.deactivateChannel(channelId);
            } catch (error) {
                console.error(`❌ Error destroying channel ${channelId}:`, error.message);
            }
        }

        this.channels.clear();
        this.activeChannels.clear();

        console.log('✅ All channels destroyed');
    }
}

module.exports = LicensedChannelManager;
