const path = require('path');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const os = require('os');
const fs = require('fs');
const helmet = require('helmet');
const session = require('express-session');

// Import security middleware
const {
    authenticate,
    requireAllowedIP,
    validateChannelIdMiddleware,
    validateInputMiddleware,
    csrfProtection,
    strictRateLimit,
    moderateRateLimit,
    lenientRateLimit,
    SECURITY_CONFIG
} = require('./middleware/security');

// ========== GLOBAL ERROR HANDLERS ==========
// Add process-level error handlers to capture crashes
process.on('uncaughtException', (err) => {
    console.error('💥 Uncaught Exception:', err.message);
    console.error('Stack trace:', err.stack);
    console.error('⚠️  Process will continue but this should be investigated');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
    console.error('⚠️  This promise rejection was not handled');
});

// Graceful shutdown handler
async function gracefulShutdown(signal) {
    console.log(`🔄 Received ${signal}. Graceful shutdown initiated...`);

    try {
        // Destroy multi-channel system if active
        if (MULTI_CHANNEL_MODE && channelManagementAPI) {
            console.log('🗑️  Destroying Channel Management API...');
            await channelManagementAPI.destroy();
        }

        // Destroy single client if active
        if (client && clientStatus !== 'disconnected') {
            console.log('🗑️  Destroying WhatsApp client...');
            await client.destroy();
        }

        console.log('✅ Graceful shutdown completed successfully');
        process.exit(0);
    } catch (err) {
        console.error('❌ Error during graceful shutdown:', err.message);
        process.exit(1);
    }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Import WhatsApp Web.js from the official cloned repository
// Adjusted path after centralization to whatsapp/official
const { Client, LocalAuth, MessageMedia, Location } = require('../official');

// Import extension handlers
const MediaHandler = require('./extensions/media-handler');
const ChatManager = require('./extensions/chat-manager');
const ContactManager = require('./extensions/contact-manager');

// Import Channel Management System
const ChannelManagementAPI = require('./channel-management-api');

// Express app for web interface
const app = express();

// ========== SECURITY CONFIGURATION ==========
// Global security middleware (MUST be first)
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
        },
    },
    crossOriginEmbedderPolicy: false
}));

// Trust proxy for accurate IP detection
app.set('trust proxy', 1);

// Session configuration for CSRF protection
app.use(session({
    secret: process.env.SESSION_SECRET || crypto.randomBytes(64).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// CORS configuration - RESTRICT TO SPECIFIC ORIGINS
const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5000',
    'https://whatsapp.replit.app', // Replace with actual production domain
    process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (mobile apps, postman, etc.)
        if (!origin) return callback(null, true);

        if (allowedOrigins.indexOf(origin) !== -1 ||
            origin.includes('replit.dev') ||
            origin.includes('replit.app')) {
            return callback(null, true);
        }

        console.warn(`⚠️ CORS: Origin ${origin} not allowed`);
        callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-CSRF-Token', 'X-Requested-With']
}));

// Body parser with size limits
app.use(express.json({
    limit: '10mb',
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Configuration from environment variables
// Use a fixed, stable CLIENT_ID to ensure session persistence across restarts
const CLIENT_ID = process.env.WHATSAPP_CLIENT_ID || 'whatsapp-official-replit';
const DATA_PATH = process.env.WHATSAPP_DATA_PATH || path.join(__dirname, 'sessions', 'session-' + CLIENT_ID);
const CHROMIUM_PATH = process.env.CHROMIUM_EXECUTABLE_PATH || '/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium';
const USER_DATA_DIR = process.env.WHATSAPP_USER_DATA_DIR || path.join(os.tmpdir(), `whatsapp-chromium-${CLIENT_ID}`);

// ========== MULTI-CHANNEL CONFIGURATION ==========
// Set MULTI_CHANNEL_MODE=true to enable multi-channel architecture
const MULTI_CHANNEL_MODE = process.env.MULTI_CHANNEL_MODE === 'true';
const MAX_CHANNELS = parseInt(process.env.MAX_CHANNELS) || 10;

// Ensure directories exist and clean browser data for fresh start
if (!fs.existsSync(path.dirname(DATA_PATH))) {
    fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
}

// Clean up browser data to prevent singleton lock issues
try {
    if (fs.existsSync(USER_DATA_DIR)) {
        console.log('🧹 Cleaning up browser data to prevent locks...');
        fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
} catch (cleanupError) {
    console.warn('⚠️ Could not clean browser data:', cleanupError.message);
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
}

console.log('🔧 WhatsApp Configuration:');
console.log(`   Client ID: ${CLIENT_ID}`);
console.log(`   Data Path: ${DATA_PATH}`);
console.log(`   User Data Dir: ${USER_DATA_DIR}`);
console.log(`   Chromium Path: ${CHROMIUM_PATH}`);
console.log(`   Multi-Channel Mode: ${MULTI_CHANNEL_MODE ? 'ENABLED' : 'DISABLED'}`);
if (MULTI_CHANNEL_MODE) {
    console.log(`   Max Channels: ${MAX_CHANNELS}`);
}

// Global variables for single-channel mode
let currentQR = null;
let clientStatus = 'disconnected';
let clientInfo = null;
let isRecovering = false;
let retryCount = 0;
const MAX_RETRIES = 3;

// Global variables for multi-channel mode
let channelManagementAPI = null;

// ========== WEBHOOKS SYSTEM ==========
const webhooksStore = [];
const eventsStore = [];
const webhookDeliveriesStore = [];
const WEBHOOK_MAX_ATTEMPTS = 3;
const WEBHOOK_RETRY_BASE_MS = 1000;

// Webhook dispatch function
async function dispatchWebhook(webhook, fullPayload, attempt = 1) {
    const startedAt = Date.now();
    let status = 'ok';
    let error = null;
    const bodyString = JSON.stringify(fullPayload);

    try {
        const signature = crypto.createHmac('sha256', webhook.secret || 'default_secret').update(bodyString).digest('hex');
        await axios.post(webhook.url, bodyString, {
            headers: {
                'Content-Type': 'application/json',
                'X-Webhook-Id': webhook.id,
                'X-Signature': signature,
                'X-Event-Id': fullPayload.eventId,
                'X-Event-Type': fullPayload.event,
                'X-Event-Version': '1'
            },
            timeout: 10000
        });
    } catch (e) {
        status = 'error';
        error = e.message || String(e);
    }

    const finishedAt = Date.now();
    webhookDeliveriesStore.push({
        id: crypto.randomUUID(),
        webhookId: webhook.id,
        eventId: fullPayload.eventId,
        type: fullPayload.event,
        status,
        attempt,
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
        error
    });

    if (status === 'error' && attempt < WEBHOOK_MAX_ATTEMPTS) {
        const delay = WEBHOOK_RETRY_BASE_MS * Math.pow(2, attempt - 1);
        setTimeout(() => {
            dispatchWebhook(webhook, fullPayload, attempt + 1).catch(() => { });
        }, delay);
    }
}

// Trigger webhooks for events
function triggerWebhooks(eventType, payload) {
    try {
        const targets = webhooksStore.filter(w => w.active && (!w.events.length || w.events.includes(eventType)));
        if (!targets.length) return;

        const eventId = crypto.randomUUID();
        const timestamp = new Date().toISOString();
        const fullPayload = { v: 1, event: eventType, eventId, timestamp, ...payload };

        // Register event internally
        eventsStore.push({ id: eventId, type: eventType, timestamp, payload });

        // Dispatch to all webhooks
        targets.forEach(w => dispatchWebhook(w, fullPayload).catch(() => { }));
    } catch (e) {
        console.log('⚠️ triggerWebhooks error:', e.message);
    }
}

// Enhanced client recovery and reinitialization function
async function initializeClientWithRecovery() {
    if (isRecovering) {
        console.log('⏳ Recovery already in progress...');
        return;
    }

    isRecovering = true;
    retryCount++;

    try {
        console.log(`🔄 Starting client recovery (attempt ${retryCount}/${MAX_RETRIES})...`);
        clientStatus = 'recovering';

        // Cleanup previous client if exists
        try {
            if (client) {
                // Remove all listeners to prevent memory leaks
                client.removeAllListeners();
                await client.destroy();
                console.log('🗑️ Previous client destroyed successfully');
            }
        } catch (destroyError) {
            console.warn('⚠️ Error destroying previous client:', destroyError.message);
        }

        // Clean up user data directory if it exists
        try {
            if (fs.existsSync(USER_DATA_DIR)) {
                console.log('🧹 Cleaning up browser data...');
                fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
                fs.mkdirSync(USER_DATA_DIR, { recursive: true });
            }
        } catch (cleanupError) {
            console.warn('⚠️ Could not clean browser data:', cleanupError.message);
        }

        // Wait before reinitializing
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Create new client instance
        console.log('🚀 Creating new WhatsApp client...');
        client = createClient();

        // Re-attach all event listeners
        attachEventListeners();

        // Initialize the new client
        console.log('🔌 Initializing WhatsApp client...');
        await client.initialize();

        // Reset retry count on successful recovery
        setTimeout(() => {
            if (clientStatus === 'ready') {
                retryCount = 0;
                console.log('✅ Recovery successful! Client ready.');
            }
        }, 15000);

    } catch (error) {
        console.error(`❌ Recovery failed (attempt ${retryCount}):`, error.message);
        console.error('Stack trace:', error.stack);

        if (retryCount < MAX_RETRIES) {
            const delay = Math.min(10000 * Math.pow(2, retryCount - 1), 60000); // Exponential backoff, max 60s
            console.log(`⏰ Retrying in ${delay / 1000} seconds...`);
            setTimeout(() => {
                initializeClientWithRecovery();
            }, delay);
        } else {
            console.error('💥 Critical failure: All recovery attempts exhausted');
            clientStatus = 'recovery_failed';
        }
    } finally {
        isRecovering = false;
    }
}

// WhatsApp client configuration with improved stability
let client = null;

function createClient() {
    console.log('🚀 Creating WhatsApp client...');
    return new Client({
        authStrategy: new LocalAuth({
            clientId: CLIENT_ID,
            dataPath: DATA_PATH
        }),
        puppeteer: {
            headless: true,
            timeout: 300000, // 5 minutes for complex operations
            protocolTimeout: 300000, // 5 minutes for CDP operations
            handleSIGINT: false, // Let our process handle SIGINT
            handleSIGTERM: false, // Let our process handle SIGTERM
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
                // Additional args for Replit environment constraints
                '--disable-dbus',
                '--disable-system-font-check',
                '--disable-partial-raster',
                '--disable-skia-runtime-opts',
                '--memory-pressure-off',
                '--disable-smooth-scrolling',
                '--disable-threaded-animation',
                '--disable-threaded-scrolling',
                '--disable-software-rasterizer',
                '--disable-gpu-sandbox',
                '--disable-canvas-aa',
                '--disable-2d-canvas-clip-aa',
                '--disable-gl-drawing-for-tests',
                '--max_old_space_size=512',
                '--single-process', // Critical for resource-constrained environments
                `--user-data-dir=${USER_DATA_DIR}`
            ],
            executablePath: CHROMIUM_PATH
        }
    });
}

// Function to attach all event listeners
function attachEventListeners() {
    if (!client) return;

    console.log('🔗 Attaching event listeners...');

    // Loading screen handler
    client.on('loading_screen', (percent, message) => {
        console.log('LOADING SCREEN', percent, message);
        clientStatus = `loading: ${percent}% - ${message}`;
    });

    // QR code handler
    client.on('qr', async (qr) => {
        console.log('QR RECEIVED - Code generated for authentication (length:', qr.length, 'chars)');
        currentQR = qr;
        clientStatus = 'qr_received';
    });

    // Authentication success handler
    client.on('authenticated', () => {
        console.log('AUTHENTICATED');
        clientStatus = 'authenticated';
        currentQR = null;
    });

    // Authentication failure handler
    client.on('auth_failure', msg => {
        console.error('AUTHENTICATION FAILURE', msg);
        clientStatus = 'auth_failure';

        // If auth failure due to browser crash, try to recover
        if (msg && (msg.includes('Protocol error') || msg.includes('Target closed'))) {
            console.log('🛠️ Browser crash detected during authentication. Starting recovery...');
            setTimeout(() => {
                initializeClientWithRecovery();
            }, 3000);
        }
    });

    // Client ready handler
    client.on('ready', async () => {
        console.log('WhatsApp Official Module - READY');
        clientStatus = 'ready';

        try {
            clientInfo = client.info;
            const debugWWebVersion = await client.getWWebVersion();
            console.log(`WWebVersion = ${debugWWebVersion}`);
            console.log('Client Info:', clientInfo);

            // Setup browser listeners
            setupBrowserListeners();

            // Initialize handlers after client is ready
            mediaHandler = new MediaHandler(client);
            chatManager = new ChatManager(client);
            contactManager = new ContactManager(client);
            console.log('✨ Enhanced features initialized: Media, Chats, Contacts');
        } catch (error) {
            console.error('Error getting client info:', error);
        }
    });

    // Message handler
    client.on('message', async msg => {
        console.log('MESSAGE RECEIVED', msg.body);

        // Trigger webhook for message received
        try {
            const messageData = {
                id: msg.id._serialized,
                from: msg.from,
                to: msg.to,
                body: msg.body,
                type: msg.type,
                timestamp: msg.timestamp,
                fromMe: msg.fromMe,
                hasMedia: msg.hasMedia,
                isGroup: msg.from.includes('@g.us')
            };

            if (!msg.fromMe) {
                triggerWebhooks('message_received', { message: messageData });
            } else {
                triggerWebhooks('message_sent', { message: messageData });
            }
        } catch (e) {
            console.log('⚠️ Error triggering message webhook:', e.message);
        }

        // Basic ping-pong for testing
        if (msg.body === '!ping') {
            msg.reply('🤖 Pong! WhatsApp Official Module is working!');
        } else if (msg.body === '!info') {
            if (clientInfo) {
                msg.reply(`📱 *WhatsApp Official Module*\n\nUser: ${clientInfo.pushname}\nNumber: ${clientInfo.wid.user}\nPlatform: ${clientInfo.platform}`);
            } else {
                msg.reply('ℹ️ Client info not available yet');
            }
        }
    });

    // Disconnection handler
    client.on('disconnected', (reason) => {
        console.log('Client was logged out', reason);
        clientStatus = 'disconnected';
        currentQR = null;
        clientInfo = null;

        // If not intentional logout and not already recovering, try to reconnect
        if (reason !== 'LOGOUT' && !isRecovering && retryCount < MAX_RETRIES) {
            console.log(`🔄 Attempting automatic reconnection (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
            setTimeout(() => {
                initializeClientWithRecovery();
            }, 5000); // Wait 5 seconds before trying to reconnect
        }
    });

    // State change handler
    client.on('change_state', state => {
        console.log('CHANGE STATE', state);
        clientStatus = state;
    });

    console.log('✅ Event listeners attached successfully');
}

// Initialize client
client = createClient();
attachEventListeners();

// Initialize extension handlers
let mediaHandler = null;
let chatManager = null;
let contactManager = null;


// Enhanced browser and page error handling
function setupBrowserListeners() {
    try {
        if (client.pupPage) {
            client.pupPage.on('error', (error) => {
                console.error('💥 Page error:', error.message);
                if (error.message.includes('Target closed') || error.message.includes('Protocol error')) {
                    console.log('🛠️ Browser crash detected during operation. Initiating recovery...');
                    clientStatus = 'browser_crashed';
                    setTimeout(() => {
                        if (clientStatus === 'browser_crashed') {
                            initializeClientWithRecovery();
                        }
                    }, 3000);
                }
            });

            client.pupPage.on('close', () => {
                console.warn('📄 Page closed unexpectedly');
                if (clientStatus === 'ready') {
                    clientStatus = 'page_closed';
                    setTimeout(() => {
                        if (clientStatus === 'page_closed') {
                            initializeClientWithRecovery();
                        }
                    }, 2000);
                }
            });
        }

        if (client.pupBrowser) {
            client.pupBrowser.on('disconnected', () => {
                console.warn('🔌 Browser disconnected unexpectedly');
                if (clientStatus === 'ready' || clientStatus === 'authenticated') {
                    clientStatus = 'browser_disconnected';
                    console.log('🛠️ Initiating browser recovery...');
                    setTimeout(() => {
                        if (clientStatus === 'browser_disconnected') {
                            initializeClientWithRecovery();
                        }
                    }, 2000);
                }
            });

            client.pupBrowser.on('targetcreated', (target) => {
                console.log('🎯 New browser target created:', target.type());
            });

            client.pupBrowser.on('targetdestroyed', (target) => {
                console.log('🗑️ Browser target destroyed:', target.type());
            });
        }
        console.log('✅ All browser listeners setup completed');
    } catch (error) {
        console.warn('⚠️ Could not setup browser listeners:', error.message);
    }
}


// Dashboard completo do WhatsApp Business - Rate limited
app.get('/dashboard', lenientRateLimit, (req, res) => {
    // Serve o dashboard local
    const localDashboard = path.join(__dirname, 'public/crm-dashboard.html');
    if (fs.existsSync(localDashboard)) {
        res.sendFile(localDashboard);
    } else {
        res.status(404).send('Dashboard não encontrado');
    }
});

// Rota principal - serve dashboard se cliente estiver pronto (Rate limited)
app.get('/', lenientRateLimit, (req, res) => {
    // Se cliente estiver conectado, mostra dashboard completo
    if (clientStatus === 'ready') {
        const localDashboard = path.join(__dirname, 'public/crm-dashboard.html');
        if (fs.existsSync(localDashboard)) {
            res.sendFile(localDashboard);
            return;
        }
    }

    // Caso contrário, usa index.html padrão
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

// API Routes - All require authentication
app.get('/api/status',
    moderateRateLimit,
    authenticate({ required: true }),
    (req, res) => {
        res.json({
            status: clientStatus,
            hasQR: !!currentQR,
            clientInfo: clientInfo,
            timestamp: new Date().toISOString()
        });
    }
);

app.get('/api/qr',
    moderateRateLimit,
    authenticate({ required: true }),
    async (req, res) => {
        try {
            // Try to fetch from Channel 1 endpoint internally
            const fetch = (await import('node-fetch')).default;
            const channel1Response = await fetch('http://localhost:3001/whatsapp/1/qr', {
                headers: {
                    'X-API-Key': req.headers['x-api-key'] || '',
                    'Accept': 'application/json'
                }
            });

            if (channel1Response.ok) {
                const data = await channel1Response.json();
                if (data.success && data.qr) {
                    return res.json({
                        qr: data.qr,
                        status: 'qr_available',
                        source: 'channel1_proxy'
                    });
                }
            }
        } catch (err) {
            console.warn('[API] Error proxying to Channel 1:', err.message);
        }

        // Fallback to legacy system
        if (currentQR) {
            res.json({
                qr: currentQR,
                status: 'qr_available',
                source: 'legacy'
            });
        } else {
            res.json({
                qr: null,
                status: clientStatus || 'disconnected',
                source: 'legacy'
            });
        }
    }
);

app.post('/api/send-message',
    moderateRateLimit,
    authenticate({ required: true }),
    csrfProtection(),
    validateInputMiddleware({
        number: { required: true, type: 'string', maxLength: 50, pattern: /^[\d\+\-\s@\.c\.us]+$/ },
        message: { required: true, type: 'string', maxLength: 4096 }
    }),
    async (req, res) => {
        try {
            const { number, message } = req.body;

            if (clientStatus !== 'ready') {
                return res.status(400).json({ error: 'Client not ready' });
            }

            const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
            const result = await client.sendMessage(chatId, message);

            res.json({
                success: true,
                messageId: result.id._serialized
            });
        } catch (error) {
            console.error('Error sending message:', error);
            res.status(500).json({ error: error.message });
        }
    }
);

app.get('/api/restart', async (req, res) => {
    try {
        console.log('🔄 Manual restart requested via API');
        retryCount = 0; // Reset retry count for manual restart
        initializeClientWithRecovery();
        res.json({ success: true, message: 'Client restart with recovery initiated' });
    } catch (error) {
        console.error('Error restarting client:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========== ENHANCED API ROUTES ==========

// Media endpoints
app.post('/api/send-media', async (req, res) => {
    try {
        const { number, type, url, caption, filename } = req.body;

        if (!number || !type || !url) {
            return res.status(400).json({ error: 'Number, type and url are required' });
        }

        if (clientStatus !== 'ready' || !mediaHandler) {
            return res.status(400).json({ error: 'Client not ready' });
        }

        let result;

        switch (type) {
            case 'image':
                result = await mediaHandler.sendImage(number, url, caption);
                break;
            case 'video':
                result = await mediaHandler.sendVideo(number, url, caption);
                break;
            case 'document':
                result = await mediaHandler.sendDocument(number, url, caption, filename);
                break;
            case 'audio':
                result = await mediaHandler.sendAudio(number, url);
                break;
            case 'sticker':
                result = await mediaHandler.sendSticker(number, url);
                break;
            default:
                return res.status(400).json({ error: 'Invalid media type' });
        }

        res.json(result);
    } catch (error) {
        console.error('Error sending media:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/send-location', async (req, res) => {
    try {
        const { number, latitude, longitude, description } = req.body;

        if (!number || !latitude || !longitude) {
            return res.status(400).json({ error: 'Number, latitude and longitude are required' });
        }

        if (clientStatus !== 'ready' || !mediaHandler) {
            return res.status(400).json({ error: 'Client not ready' });
        }

        const result = await mediaHandler.sendLocation(number, latitude, longitude, description);
        res.json(result);
    } catch (error) {
        console.error('Error sending location:', error);
        res.status(500).json({ error: error.message });
    }
});

// Chat endpoints
app.get('/api/chats', async (req, res) => {
    try {
        if (clientStatus !== 'ready' || !chatManager) {
            return res.status(400).json({ error: 'Client not ready' });
        }

        const chats = await chatManager.getChats();
        res.json({
            success: true,
            count: chats.length,
            chats: chats
        });
    } catch (error) {
        console.error('Error getting chats:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/chats/:chatId/messages', async (req, res) => {
    try {
        if (clientStatus !== 'ready' || !chatManager) {
            return res.status(400).json({ error: 'Client not ready' });
        }

        const limit = parseInt(req.query.limit) || 50;
        const messages = await chatManager.getMessages(req.params.chatId, limit);

        res.json({
            success: true,
            count: messages.length,
            messages: messages
        });
    } catch (error) {
        console.error('Error getting messages:', error);
        res.status(500).json({ error: error.message });
    }
});

// Contact endpoints
app.get('/api/contacts', async (req, res) => {
    try {
        if (clientStatus !== 'ready' || !contactManager) {
            return res.status(400).json({ error: 'Client not ready' });
        }

        const contacts = await contactManager.getContacts();
        res.json({
            success: true,
            count: contacts.length,
            contacts: contacts
        });
    } catch (error) {
        console.error('Error getting contacts:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========== V1 CHAT APIs ==========

// Get all chats (main v1 endpoint)
app.get('/v1/chats', async (req, res) => {
    try {
        if (clientStatus !== 'ready') {
            return res.status(503).json({ success: false, error: 'Client not ready' });
        }

        const chats = await client.getChats();
        const formattedChats = chats.map(chat => ({
            id: chat.id._serialized,
            name: chat.name,
            isGroup: chat.isGroup,
            unreadCount: chat.unreadCount,
            timestamp: chat.timestamp,
            isMuted: chat.isMuted,
            archived: chat.archived,
            pinned: chat.pinned,
            lastMessage: chat.lastMessage ? {
                id: chat.lastMessage.id._serialized,
                body: chat.lastMessage.body,
                type: chat.lastMessage.type,
                timestamp: chat.lastMessage.timestamp,
                fromMe: chat.lastMessage.fromMe
            } : null
        }));

        res.json({
            success: true,
            count: formattedChats.length,
            chats: formattedChats
        });
    } catch (error) {
        console.error('Error getting chats:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get specific chat by ID
app.get('/v1/chats/:id', async (req, res) => {
    try {
        if (clientStatus !== 'ready') {
            return res.status(503).json({ success: false, error: 'Client not ready' });
        }

        const chatId = req.params.id;
        const chat = await client.getChatById(chatId);

        if (!chat) {
            return res.status(404).json({ success: false, error: 'Chat not found' });
        }

        const formattedChat = {
            id: chat.id._serialized,
            name: chat.name,
            isGroup: chat.isGroup,
            unreadCount: chat.unreadCount,
            timestamp: chat.timestamp,
            isMuted: chat.isMuted,
            archived: chat.archived,
            pinned: chat.pinned,
            lastMessage: chat.lastMessage ? {
                id: chat.lastMessage.id._serialized,
                body: chat.lastMessage.body,
                type: chat.lastMessage.type,
                timestamp: chat.lastMessage.timestamp,
                fromMe: chat.lastMessage.fromMe
            } : null
        };

        if (chat.isGroup && chat.participants) {
            formattedChat.participants = chat.participants.map(p => ({
                id: p.id._serialized,
                isAdmin: p.isAdmin,
                isSuperAdmin: p.isSuperAdmin
            }));
            formattedChat.participantCount = chat.participants.length;
        }

        res.json({
            success: true,
            chat: formattedChat
        });
    } catch (error) {
        console.error('Error getting chat:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== ADVANCED CHAT APIs ==========

// Archive/unarchive chat
app.post('/v1/chats/:id/archive', async (req, res) => {
    try {
        if (clientStatus !== 'ready') {
            return res.status(503).json({ success: false, error: 'Client not ready' });
        }

        const chatId = req.params.id;
        const chat = await client.getChatById(chatId);
        await chat.archive();

        res.json({
            success: true,
            chatId: chat.id?._serialized || chatId,
            archived: true
        });
    } catch (error) {
        console.error('Error archiving chat:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/v1/chats/:id/archive', async (req, res) => {
    try {
        if (clientStatus !== 'ready') {
            return res.status(503).json({ success: false, error: 'Client not ready' });
        }

        const chatId = req.params.id;
        const chat = await client.getChatById(chatId);
        await chat.unarchive();

        res.json({
            success: true,
            chatId: chat.id?._serialized || chatId,
            archived: false
        });
    } catch (error) {
        console.error('Error unarchiving chat:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Pin/unpin chat
app.post('/v1/chats/:id/pin', async (req, res) => {
    try {
        if (clientStatus !== 'ready') {
            return res.status(503).json({ success: false, error: 'Client not ready' });
        }

        const chatId = req.params.id;
        const chat = await client.getChatById(chatId);
        const pinned = await chat.pin();

        res.json({
            success: true,
            chatId: chat.id?._serialized || chatId,
            pinned: !!pinned
        });
    } catch (error) {
        console.error('Error pinning chat:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/v1/chats/:id/pin', async (req, res) => {
    try {
        if (clientStatus !== 'ready') {
            return res.status(503).json({ success: false, error: 'Client not ready' });
        }

        const chatId = req.params.id;
        const chat = await client.getChatById(chatId);
        const pinned = await chat.unpin();

        res.json({
            success: true,
            chatId: chat.id?._serialized || chatId,
            pinned: !!pinned
        });
    } catch (error) {
        console.error('Error unpinning chat:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Mute/unmute chat
app.post('/v1/chats/:id/mute', async (req, res) => {
    try {
        if (clientStatus !== 'ready') {
            return res.status(503).json({ success: false, error: 'Client not ready' });
        }

        const chatId = req.params.id;
        const chat = await client.getChatById(chatId);
        const duration = req.body?.duration != null ? parseInt(req.body.duration, 10) : null;
        const until = duration && duration > 0 ? new Date(Date.now() + duration) : undefined;
        const result = await chat.mute(until);

        res.json({
            success: true,
            chatId: chat.id?._serialized || chatId,
            isMuted: result?.isMuted ?? true,
            muteExpiration: result?.muteExpiration ?? null
        });
    } catch (error) {
        console.error('Error muting chat:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/v1/chats/:id/mute', async (req, res) => {
    try {
        if (clientStatus !== 'ready') {
            return res.status(503).json({ success: false, error: 'Client not ready' });
        }

        const chatId = req.params.id;
        const chat = await client.getChatById(chatId);
        const result = await chat.unmute();

        res.json({
            success: true,
            chatId: chat.id?._serialized || chatId,
            isMuted: result?.isMuted ?? false,
            muteExpiration: result?.muteExpiration ?? null
        });
    } catch (error) {
        console.error('Error unmuting chat:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Mark chat as read
app.post('/v1/chats/:id/read', async (req, res) => {
    try {
        if (clientStatus !== 'ready') {
            return res.status(503).json({ success: false, error: 'Client not ready' });
        }

        const chatId = req.params.id;
        await client.sendSeen(chatId);

        res.json({
            success: true,
            chatId: chatId
        });
    } catch (error) {
        console.error('Error marking chat as read:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== ADVANCED MESSAGE APIs ==========

// Send message with advanced options
app.post('/v1/messages', async (req, res) => {
    try {
        if (clientStatus !== 'ready') {
            return res.status(503).json({ success: false, error: 'Client not ready' });
        }

        const { to, body, type, mediaUrl, caption, filename } = req.body;

        if (!to || (!body && !mediaUrl)) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        const chatId = to.includes('@c.us') ? to : `${to}@c.us`;
        let result;

        if (type === 'text' || !type) {
            result = await client.sendMessage(chatId, body);
        } else if (mediaUrl) {
            const media = await MessageMedia.fromUrl(mediaUrl, { filename });
            result = await client.sendMessage(chatId, media, { caption });
        }

        res.json({
            success: true,
            messageId: result.id._serialized,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get messages from a chat
app.get('/v1/messages', async (req, res) => {
    try {
        if (clientStatus !== 'ready') {
            return res.status(503).json({ success: false, error: 'Client not ready' });
        }

        const { chatId, limit = 50, offset = 0 } = req.query;

        if (!chatId) {
            return res.status(400).json({ success: false, error: 'chatId is required' });
        }

        const chat = await client.getChatById(chatId);
        const messages = await chat.fetchMessages({ limit: parseInt(limit) });

        res.json({
            success: true,
            chatId: chatId,
            count: messages.length,
            messages: messages.map(msg => ({
                id: msg.id._serialized,
                from: msg.from,
                to: msg.to,
                body: msg.body,
                type: msg.type,
                timestamp: msg.timestamp,
                fromMe: msg.fromMe,
                hasMedia: msg.hasMedia
            }))
        });
    } catch (error) {
        console.error('Error getting messages:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get specific message by ID
app.get('/v1/messages/:id', async (req, res) => {
    try {
        if (clientStatus !== 'ready') {
            return res.status(503).json({ success: false, error: 'Client not ready' });
        }

        const messageId = req.params.id;
        const message = await client.getMessageById(messageId);

        if (!message) {
            return res.status(404).json({ success: false, error: 'Message not found' });
        }

        res.json({
            success: true,
            message: {
                id: message.id._serialized,
                from: message.from,
                to: message.to,
                body: message.body,
                type: message.type,
                timestamp: message.timestamp,
                fromMe: message.fromMe,
                hasMedia: message.hasMedia
            }
        });
    } catch (error) {
        console.error('Error getting message:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== CONTACT APIs ==========

// Get contact avatar
app.get('/v1/contacts/:id/avatar', async (req, res) => {
    try {
        if (clientStatus !== 'ready') {
            return res.status(503).json({ success: false, error: 'Client not ready' });
        }

        const contactId = req.params.id.includes('@c.us') ? req.params.id : `${req.params.id}@c.us`;
        const contact = await client.getContactById(contactId);
        const avatarUrl = await contact.getProfilePicUrl();

        if (avatarUrl) {
            res.json({
                success: true,
                contactId: contactId,
                avatarUrl: avatarUrl
            });
        } else {
            res.json({
                success: true,
                contactId: contactId,
                avatarUrl: null
            });
        }
    } catch (error) {
        console.error('Error getting contact avatar:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get contact info
app.get('/v1/contacts/:id', async (req, res) => {
    try {
        if (clientStatus !== 'ready') {
            return res.status(503).json({ success: false, error: 'Client not ready' });
        }

        const contactId = req.params.id.includes('@c.us') ? req.params.id : `${req.params.id}@c.us`;
        const contact = await client.getContactById(contactId);

        res.json({
            success: true,
            contact: {
                id: contact.id._serialized,
                name: contact.name,
                pushname: contact.pushname,
                number: contact.number,
                formattedName: contact.formattedName,
                isMyContact: contact.isMyContact,
                isGroup: contact.isGroup,
                isWAContact: contact.isWAContact
            }
        });
    } catch (error) {
        console.error('Error getting contact:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== V1 CONTACTS APIs ==========

// Get all contacts
app.get('/v1/contacts', async (req, res) => {
    try {
        if (clientStatus !== 'ready') {
            return res.status(503).json({ success: false, error: 'Client not ready' });
        }

        const contacts = await client.getContacts();
        const formattedContacts = contacts
            .filter(contact => !contact.isGroup && contact.isWAContact)
            .map(contact => ({
                id: contact.id._serialized,
                name: contact.name,
                pushname: contact.pushname,
                number: contact.number,
                formattedName: contact.formattedName,
                isMyContact: contact.isMyContact,
                isWAContact: contact.isWAContact
            }));

        res.json({
            success: true,
            count: formattedContacts.length,
            contacts: formattedContacts
        });
    } catch (error) {
        console.error('Error getting contacts:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== V1 MEDIA APIs ==========

// Send media with v1 endpoint
app.post('/v1/media', async (req, res) => {
    try {
        const { to, type, url, caption, filename } = req.body;

        if (!to || !type || !url) {
            return res.status(400).json({ success: false, error: 'to, type, and url are required' });
        }

        if (clientStatus !== 'ready') {
            return res.status(503).json({ success: false, error: 'Client not ready' });
        }

        const chatId = to.includes('@c.us') ? to : `${to}@c.us`;
        let result;

        try {
            const media = await MessageMedia.fromUrl(url, { filename });
            result = await client.sendMessage(chatId, media, { caption });
        } catch (error) {
            return res.status(400).json({ success: false, error: 'Failed to process media: ' + error.message });
        }

        res.json({
            success: true,
            messageId: result.id._serialized,
            to: chatId,
            type: type,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error sending media:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== STATUS & INFO APIs ==========

// Enhanced status endpoint
app.get('/status', (req, res) => {
    res.json({
        status: clientStatus,
        ready: clientStatus === 'ready',
        hasQR: !!currentQR,
        clientInfo: clientInfo,
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        module: 'whatsapp-official'
    });
});

// Legacy status endpoint (for backward compatibility)
app.get('/v1/status', (req, res) => {
    res.json({
        status: clientStatus,
        ready: clientStatus === 'ready',
        hasQR: !!currentQR,
        clientInfo: clientInfo,
        timestamp: new Date().toISOString()
    });
});

// Client info endpoint
app.get('/info', async (req, res) => {
    try {
        if (clientStatus !== 'ready') {
            return res.status(503).json({ success: false, error: 'Client not ready' });
        }

        const info = client.info;
        const state = await client.getState();

        res.json({
            success: true,
            info: {
                wid: info.wid,
                pushname: info.pushname,
                platform: info.platform,
                state: state,
                battery: info.battery,
                plugged: info.plugged
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error getting client info:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// QR Code endpoint
app.get('/qr', (req, res) => {
    if (currentQR) {
        res.json({
            success: true,
            qr: currentQR,
            status: 'qr_available',
            timestamp: new Date().toISOString()
        });
    } else {
        res.json({
            success: true,
            qr: null,
            status: clientStatus,
            timestamp: new Date().toISOString()
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        ready: clientStatus === 'ready',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        module: 'whatsapp-official'
    });
});

// Restart client endpoint
app.post('/restart-client', async (req, res) => {
    try {
        console.log('🔄 Manual restart requested via API');
        retryCount = 0;
        initializeClientWithRecovery();

        res.json({
            success: true,
            message: 'Client restart initiated',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error restarting client:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Explicit start endpoint (alias of restart for lazy-init flows)
app.post('/start-client', async (req, res) => {
    try {
        console.log('▶️  Start requested via API');
        retryCount = 0;
        initializeClientWithRecovery();

        res.json({
            success: true,
            message: 'Client start initiated',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error starting client:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== WEBHOOK APIs ==========

// Create webhook
app.post('/v1/webhooks', (req, res) => {
    try {
        const { url, secret, events = [] } = req.body;

        if (!url) {
            return res.status(400).json({ success: false, error: 'URL is required' });
        }

        const webhook = {
            id: crypto.randomUUID(),
            url: url,
            secret: secret || crypto.randomUUID(),
            events: Array.isArray(events) ? events : [],
            active: true,
            createdAt: new Date().toISOString(),
            retries: 0
        };

        webhooksStore.push(webhook);

        res.json({
            success: true,
            webhook: webhook
        });
    } catch (error) {
        console.error('Error creating webhook:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// List webhooks
app.get('/v1/webhooks', (req, res) => {
    try {
        res.json({
            success: true,
            count: webhooksStore.length,
            webhooks: webhooksStore
        });
    } catch (error) {
        console.error('Error listing webhooks:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Delete webhook
app.delete('/v1/webhooks/:id', (req, res) => {
    try {
        const webhookId = req.params.id;
        const index = webhooksStore.findIndex(w => w.id === webhookId);

        if (index === -1) {
            return res.status(404).json({ success: false, error: 'Webhook not found' });
        }

        webhooksStore.splice(index, 1);

        res.json({
            success: true,
            message: 'Webhook deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting webhook:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Test webhook
app.post('/v1/webhooks/test', (req, res) => {
    try {
        const { webhookId, eventType = 'test' } = req.body;

        const webhook = webhooksStore.find(w => w.id === webhookId);
        if (!webhook) {
            return res.status(404).json({ success: false, error: 'Webhook not found' });
        }

        // Trigger test webhook
        triggerWebhooks(eventType, { test: true, timestamp: new Date().toISOString() });

        res.json({
            success: true,
            message: 'Test webhook triggered'
        });
    } catch (error) {
        console.error('Error testing webhook:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get webhook deliveries
app.get('/v1/webhooks/:id/deliveries', (req, res) => {
    try {
        const webhookId = req.params.id;
        const limit = parseInt(req.query.limit) || 50;

        const deliveries = webhookDeliveriesStore
            .filter(d => d.webhookId === webhookId)
            .sort((a, b) => b.startedAt - a.startedAt)
            .slice(0, limit);

        res.json({
            success: true,
            count: deliveries.length,
            deliveries: deliveries
        });
    } catch (error) {
        console.error('Error getting webhook deliveries:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== GROUP APIs ==========

// Get all groups
app.get('/v1/groups', async (req, res) => {
    try {
        if (clientStatus !== 'ready') {
            return res.status(503).json({ success: false, error: 'Client not ready' });
        }

        const chats = await client.getChats();
        const groups = chats
            .filter(chat => chat.isGroup)
            .map(group => ({
                id: group.id._serialized,
                name: group.name,
                participants: group.participants?.length || 0,
                unreadCount: group.unreadCount,
                timestamp: group.timestamp,
                isReadOnly: group.isReadOnly,
                isMuted: group.isMuted,
                archived: group.archived,
                pinned: group.pinned
            }));

        res.json({
            success: true,
            count: groups.length,
            groups: groups
        });
    } catch (error) {
        console.error('Error getting groups:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get group participants
app.get('/v1/groups/:id/participants', async (req, res) => {
    try {
        if (clientStatus !== 'ready') {
            return res.status(503).json({ success: false, error: 'Client not ready' });
        }

        const groupId = req.params.id;
        const chat = await client.getChatById(groupId);

        if (!chat.isGroup) {
            return res.status(400).json({ success: false, error: 'Not a group chat' });
        }

        const participants = chat.participants.map(p => ({
            id: p.id._serialized,
            isAdmin: p.isAdmin,
            isSuperAdmin: p.isSuperAdmin
        }));

        res.json({
            success: true,
            groupId: groupId,
            count: participants.length,
            participants: participants
        });
    } catch (error) {
        console.error('Error getting group participants:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Get common groups with a contact
app.get('/v1/contacts/:id/common-groups', async (req, res) => {
    try {
        if (clientStatus !== 'ready') {
            return res.status(503).json({ success: false, error: 'Client not ready' });
        }

        const contactId = req.params.id.includes('@c.us') ? req.params.id : `${req.params.id}@c.us`;
        const chats = await client.getChats();
        const groups = chats.filter(c => c.isGroup === true);
        const result = [];

        for (const g of groups) {
            try {
                let participants = g.participants;
                if ((!participants || !participants.length) && typeof g.fetchParticipants === 'function') {
                    participants = await g.fetchParticipants().catch(() => g.participants || []);
                }

                const has = Array.isArray(participants) && participants.some(p => {
                    const id = (p.id && p.id._serialized) ? p.id._serialized : (p.id || p.user || '');
                    return id === contactId;
                });

                if (!has) continue;

                result.push({
                    id: g.id?._serialized || String(g.id || ''),
                    name: g.name || g.groupMetadata?.subject || 'Grupo',
                    participantCount: Array.isArray(participants) ? participants.length : (g.groupMetadata?.size || 0),
                    unreadCount: g.unreadCount || 0,
                    isGroup: true,
                    subject: g.groupMetadata?.subject || g.name || null
                });
            } catch (e) {
                // ignore group with permission/loading error
            }
        }

        res.json({
            success: true,
            groups: result,
            total: result.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error getting common groups:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== LEGACY API COMPATIBILITY ==========

// ========== BACKWARD COMPATIBILITY: REDIRECT TO CHANNEL 1 ==========
// When legacy system (port 3003) is used, redirect to multi-channel Channel 1 (port 3001)

const MULTI_CHANNEL_URL = 'http://localhost:3001';

// Helper function to proxy requests to Channel 1
async function proxyToChannel1(endpoint, method = 'GET', body = null) {
    try {
        const url = `${MULTI_CHANNEL_URL}/whatsapp/1${endpoint}`;
        const options = {
            method,
            headers: { 'Content-Type': 'application/json' }
        };

        if (body && method !== 'GET') {
            options.data = body;
        }

        const response = await axios(url, options);
        return { success: true, data: response.data };
    } catch (error) {
        console.error(`❌ Error proxying to Channel 1 (${endpoint}):`, error.message);
        return {
            success: false,
            error: error.response?.data?.error || error.message,
            statusCode: error.response?.status || 500
        };
    }
}

// Legacy send endpoint (redirect to Channel 1)
app.post('/send', async (req, res) => {
    try {
        console.log('🔄 Legacy /send request - redirecting to Channel 1');

        const { phone, message } = req.body;

        if (!phone || !message) {
            return res.status(400).json({ success: false, error: 'Phone and message are required' });
        }

        // Try multi-channel first
        if (!MULTI_CHANNEL_MODE) {
            const proxyResult = await proxyToChannel1('/send-message', 'POST', {
                number: phone,
                message: message
            });

            if (proxyResult.success) {
                console.log('✅ Successfully proxied to Channel 1');
                return res.json({
                    success: true,
                    messageId: proxyResult.data.messageId,
                    timestamp: proxyResult.data.timestamp || new Date().toISOString(),
                    source: 'channel-1-proxy'
                });
            } else {
                console.log('⚠️ Channel 1 not available, falling back to legacy');
            }
        }

        // Fallback to legacy if multi-channel not available
        if (clientStatus !== 'ready') {
            return res.status(503).json({ success: false, error: 'Client not ready' });
        }

        const chatId = phone.includes('@c.us') ? phone : `${phone}@c.us`;
        const result = await client.sendMessage(chatId, message);

        res.json({
            success: true,
            messageId: result.id._serialized,
            timestamp: new Date().toISOString(),
            source: 'legacy'
        });
    } catch (error) {
        console.error('Error sending message (legacy):', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Legacy chats endpoint (redirect to Channel 1)
app.get('/chats', async (req, res) => {
    try {
        console.log('🔄 Legacy /chats request - redirecting to Channel 1');

        // Try multi-channel first
        if (!MULTI_CHANNEL_MODE) {
            const proxyResult = await proxyToChannel1('/chats');

            if (proxyResult.success) {
                console.log('✅ Successfully proxied chats to Channel 1');
                return res.json({
                    success: true,
                    count: proxyResult.data.count,
                    chats: proxyResult.data.chats,
                    source: 'channel-1-proxy'
                });
            } else {
                console.log('⚠️ Channel 1 not available, falling back to legacy');
            }
        }

        // Fallback to legacy if multi-channel not available
        if (clientStatus !== 'ready') {
            return res.status(503).json({ success: false, error: 'Client not ready' });
        }

        const chats = await client.getChats();
        const formattedChats = chats.map(chat => ({
            id: chat.id._serialized,
            name: chat.name,
            isGroup: chat.isGroup,
            unreadCount: chat.unreadCount,
            timestamp: chat.timestamp,
            lastMessage: chat.lastMessage ? {
                id: chat.lastMessage.id._serialized,
                body: chat.lastMessage.body,
                type: chat.lastMessage.type,
                timestamp: chat.lastMessage.timestamp,
                fromMe: chat.lastMessage.fromMe
            } : null
        }));

        res.json({
            success: true,
            count: formattedChats.length,
            chats: formattedChats,
            source: 'legacy'
        });
    } catch (error) {
        console.error('Error getting chats (legacy):', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Legacy QR endpoint (redirect to Channel 1)
app.get('/qr', async (req, res) => {
    try {
        console.log('🔄 Legacy /qr request - redirecting to Channel 1');

        // Try multi-channel first
        if (!MULTI_CHANNEL_MODE) {
            const proxyResult = await proxyToChannel1('/qr');

            if (proxyResult.success) {
                console.log('✅ Successfully proxied QR to Channel 1');
                return res.json({
                    success: true,
                    qr: proxyResult.data.qr,
                    status: proxyResult.data.status,
                    source: 'channel-1-proxy'
                });
            } else {
                console.log('⚠️ Channel 1 not available, falling back to legacy');
            }
        }

        // Fallback to legacy
        res.json({
            success: true,
            qr: currentQR,
            status: clientStatus,
            source: 'legacy'
        });
    } catch (error) {
        console.error('Error getting QR (legacy):', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Legacy status endpoint (redirect to Channel 1)
app.get('/status', async (req, res) => {
    try {
        console.log('🔄 Legacy /status request - redirecting to Channel 1');

        // Try multi-channel first
        if (!MULTI_CHANNEL_MODE) {
            const proxyResult = await proxyToChannel1('/status');

            if (proxyResult.success) {
                console.log('✅ Successfully proxied status to Channel 1');
                return res.json({
                    ...proxyResult.data,
                    source: 'channel-1-proxy'
                });
            } else {
                console.log('⚠️ Channel 1 not available, falling back to legacy');
            }
        }

        // Fallback to legacy
        res.json({
            success: true,
            status: clientStatus,
            qr: currentQR,
            clientInfo: clientInfo,
            source: 'legacy'
        });
    } catch (error) {
        console.error('Error getting status (legacy):', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Start the server
const PORT = process.env.WHATSAPP_PORT || 3001;
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 WhatsApp Official Module server running on port ${PORT}`);
    console.log(`📱 Web interface: http://localhost:${PORT}`);

    try {
        if (MULTI_CHANNEL_MODE) {
            // Initialize Multi-Channel System (LAZY INIT: do not auto-activate channels)
            console.log('🧭 Multi-Channel mode enabled (lazy initialization)');
            console.log(`⚖️ License-based architecture with max ${MAX_CHANNELS} channels`);

            // Initialize Channel Management API and mount routes
            channelManagementAPI = new ChannelManagementAPI({
                maxChannels: MAX_CHANNELS,
                basePath: __dirname,
                chromiumPath: CHROMIUM_PATH
            });

            channelManagementAPI.applyToApp(app);

            console.log('✅ Channel Management API ready — channels will be activated on-demand via API');
            console.log(`📊 Channel Manager: http://localhost:${PORT}/api/channel-manager/system/status`);

        } else {
            // Legacy single-channel mode — LAZY INIT: do not auto-initialize client
            console.log('🧭 Single-Channel mode (legacy) — lazy initialization enabled.');
            console.log('ℹ️ Use POST /restart-client to initialize the WhatsApp client when the user requests it.');
        }

    } catch (error) {
        console.error('❌ Error during system initialization:', error.message);
        console.error('Stack trace:', error.stack);
    }
});

module.exports = {
    client,
    app,
    channelManagementAPI,
    MULTI_CHANNEL_MODE,
    MAX_CHANNELS
};
