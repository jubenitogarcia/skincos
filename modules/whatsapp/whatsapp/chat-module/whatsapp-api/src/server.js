// Extracted server creation for testability
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const qrterm = require('qrcode-terminal');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const clientMetrics = require('prom-client');
require('dotenv').config({ path: process.env.WHATSAPP_ENV_FILE || path.join(process.cwd(), '.env') });

// WhatsApp core (can be disabled in tests)
const Client = require('@chat-module/whatsapp-core/src/Client');
const LocalAuth = require('@chat-module/whatsapp-core/src/authStrategies/LocalAuth');
const { MessageMedia } = require('@chat-module/whatsapp-core/src/structures/MessageMedia');
const persistence = require('./persistence');

function createServer(options = {}) {
    const disableClient = process.env.WHATSAPP_DISABLE_CLIENT === 'true' || options.disableClient;
    // --- State & Persistence ---
    const contactsCache = new Map(); // id -> { id, name, pushname, number }
    const sseClients = new Set();
    let persistenceReady = false;
    persistence.init().then(r => { persistenceReady = true; console.log('[whatsapp-api] persistence backend:', r.backend); });

    // --- Webhook Delivery Queue ---
    const WEBHOOK_MAX_RETRIES = Number(process.env.WEBHOOK_MAX_RETRIES || 6);
    const WEBHOOK_BASE_DELAY_MS = Number(process.env.WEBHOOK_BASE_DELAY_MS || 2000);
    const WEBHOOK_MAX_DELAY_MS = Number(process.env.WEBHOOK_MAX_DELAY_MS || 60000);
    const WEBHOOK_WORKER_CONCURRENCY = Number(process.env.WEBHOOK_WORKER_CONCURRENCY || 5);
    const WEBHOOK_HTTP_TIMEOUT_MS = Number(process.env.WEBHOOK_HTTP_TIMEOUT_MS || 10000);
    const WEBHOOK_QUEUE_TICK_MS = Number(process.env.WEBHOOK_QUEUE_TICK_MS || 500);

    const webhookQueue = []; // array of jobs
    let webhookInflight = 0;

    function computeDelay(attempt) {
        const raw = Math.min(WEBHOOK_BASE_DELAY_MS * Math.pow(2, attempt - 1), WEBHOOK_MAX_DELAY_MS);
        const jitter = raw * (Math.random() * 0.2 - 0.1); // ±10%
        return Math.round(raw + jitter);
    }

    function enqueueWebhookJob(hook, evt, payload) {
        const job = {
            id: crypto.randomUUID(),
            hookId: hook.id,
            url: hook.url,
            eventType: evt.type,
            payload,
            attempt: 1,
            nextAttemptAt: Date.now(),
            createdAt: Date.now(),
            lastError: null
        };
        webhookQueue.push(job);
        gaugeWebhookQueue && gaugeWebhookQueue.set(webhookQueue.length);
        return job.id;
    }

    async function attemptDelivery(job) {
        webhookInflight += 1; gaugeWebhookInflight.set(webhookInflight);
        let success = false; let statusCode = null; let errorMessage = null;
        try {
            const controller = new AbortController();
            const t = setTimeout(() => controller.abort(), WEBHOOK_HTTP_TIMEOUT_MS);
            const res = await fetch(job.url, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-webhook-event': job.eventType,
                    'x-webhook-delivery-id': job.id,
                    'x-webhook-attempt': String(job.attempt)
                },
                body: JSON.stringify(job.payload),
                signal: controller.signal,
                timeout: WEBHOOK_HTTP_TIMEOUT_MS
            });
            clearTimeout(t);
            statusCode = res.status;
            if (res.ok) success = true; else errorMessage = `status ${res.status}`;
        } catch (e) {
            errorMessage = e.name === 'AbortError' ? 'timeout' : (e.message || String(e));
        }
        webhookInflight -= 1; gaugeWebhookInflight.set(webhookInflight);
        if (success) {
            counterWebhookDeliveries.inc({ result: 'success', eventType: job.eventType });
        } else {
            if (job.attempt < WEBHOOK_MAX_RETRIES) {
                job.attempt += 1;
                job.lastError = errorMessage || statusCode || 'unknown';
                job.nextAttemptAt = Date.now() + computeDelay(job.attempt);
                webhookQueue.push(job);
                counterWebhookRetries.inc({ eventType: job.eventType });
            } else {
                counterWebhookDeliveries.inc({ result: 'failed', eventType: job.eventType });
            }
        }
        gaugeWebhookQueue.set(webhookQueue.length);
    }

    function processWebhookQueue() {
        if (!webhookQueue.length) return;
        const now = Date.now();
        for (let i = 0; i < webhookQueue.length && webhookInflight < WEBHOOK_WORKER_CONCURRENCY;) {
            const job = webhookQueue[i];
            if (job.nextAttemptAt > now) { i++; continue; }
            webhookQueue.splice(i, 1);
            attemptDelivery(job); // async
        }
        gaugeWebhookQueue.set(webhookQueue.length);
    }
    setInterval(processWebhookQueue, WEBHOOK_QUEUE_TICK_MS).unref?.();

    function dispatchWebhooks(evt) {
        const iter = persistence.iterWebhooksSync();
        if (!iter) return;
        const payload = { ts: Date.now(), ...evt };
        for (const hook of iter) {
            if (hook.events.size && hook.events.size > 0 && !hook.events.has(evt.type)) continue;
            enqueueWebhookJob(hook, evt, payload);
        }
    }

    // --- Metrics ---
    clientMetrics.collectDefaultMetrics({ prefix: 'whatsapp_api_' });
    const counterMessages = new clientMetrics.Counter({ name: 'whatsapp_messages_total', help: 'Total messages observed' });
    const counterEvents = new clientMetrics.Counter({ name: 'whatsapp_events_total', help: 'Total SSE events broadcast' });
    const gaugeSseClients = new clientMetrics.Gauge({ name: 'whatsapp_sse_clients', help: 'Connected SSE clients' });
    const counterWebhookDeliveries = new clientMetrics.Counter({ name: 'whatsapp_webhook_deliveries_total', help: 'Total webhook delivery outcomes', labelNames: ['result', 'eventType'] });
    const counterWebhookRetries = new clientMetrics.Counter({ name: 'whatsapp_webhook_retries_total', help: 'Total webhook retry attempts', labelNames: ['eventType'] });
    const gaugeWebhookQueue = new clientMetrics.Gauge({ name: 'whatsapp_webhook_queue_size', help: 'Current webhook queue size' });
    const gaugeWebhookInflight = new clientMetrics.Gauge({ name: 'whatsapp_webhook_inflight', help: 'Webhook deliveries currently in flight' });
    function metricsEvent(evt) { counterEvents.inc(); if (evt.type === 'message') counterMessages.inc(); }

    function nowTs() { return Date.now(); }
    function normalizeWid(num) { return num.endsWith('@c.us') ? num : `${num}@c.us`; }
    function toPublicMessage(m) {
        return {
            id: m.id?._serialized || m.id || null,
            from: m.from?._serialized || m.from || (m.author?._serialized) || null,
            to: m.to?._serialized || m.to || null,
            timestamp: (m.timestamp ? m.timestamp * 1000 : nowTs()),
            type: m.type,
            body: m.body || m.message || m.caption || '',
            hasMedia: !!m.hasMedia,
            ack: m.ack,
            fromMe: !!m.fromMe
        };
    }

    const recentMedia = new Map();
    const RECENT_MEDIA_LIMIT = 300;

    async function pushMessage(m) {
        const pub = toPublicMessage(m);
        if (pub.from && !contactsCache.has(pub.from)) {
            contactsCache.set(pub.from, { id: pub.from, name: pub.from.split('@')[0], pushname: pub.from, number: pub.from.replace(/@c\.us$/, '') });
        }
        persistence.saveMessage(pub).catch(() => { });
        if (pub.hasMedia) {
            const mid = pub.id;
            if (mid) {
                recentMedia.set(mid, m);
                if (recentMedia.size > RECENT_MEDIA_LIMIT) {
                    const firstKey = recentMedia.keys().next().value; recentMedia.delete(firstKey);
                }
            }
        }
        broadcastEvent({ type: 'message', data: pub });
    }

    function broadcastEvent(evt) {
        const line = `data: ${JSON.stringify(evt)}\n\n`;
        for (const res of sseClients) {
            try { res.write(line); } catch { }
        }
        metricsEvent(evt);
        dispatchWebhooks(evt);
    }

    // --- Express App ---
    const app = express();
    app.use(express.json({ limit: '8mb' }));
    app.use(cors());
    app.use(helmet());
    app.use((req, _res, next) => { req.id = (req.headers['x-request-id'] || crypto.randomUUID()); next(); });

    // Auth
    const REQUIRE_AUTH = process.env.AUTH_ENABLED === 'true';
    const ADMIN_USER = process.env.ADMIN_USER || 'admin';
    const ADMIN_PASS = process.env.ADMIN_PASS || 'admin';
    const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change';
    function issueToken(username) { return jwt.sign({ sub: username }, JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES || '12h' }); }
    function authMiddleware(req, res, next) {
        if (!REQUIRE_AUTH) return next();
        const header = req.headers.authorization || '';
        const token = header.startsWith('Bearer ') ? header.slice(7) : null;
        if (!token) return res.status(401).json({ error: 'missing token' });
        try { req.user = jwt.verify(token, JWT_SECRET); return next(); } catch { return res.status(401).json({ error: 'invalid token' }); }
    }
    const rateState = new Map();
    const RATE_LIMIT = Number(process.env.RATE_LIMIT || 60);
    const RATE_WINDOW_MS = Number(process.env.RATE_WINDOW_MS || 60_000);
    function rateLimiter(req, res, next) {
        if (!REQUIRE_AUTH) return next();
        const user = req.user?.sub || 'anon';
        const now = Date.now();
        let bucket = rateState.get(user);
        if (!bucket) { bucket = { tokens: RATE_LIMIT, updated: now }; rateState.set(user, bucket); }
        const elapsed = now - bucket.updated;
        if (elapsed > RATE_WINDOW_MS) { bucket.tokens = RATE_LIMIT; bucket.updated = now; }
        if (bucket.tokens <= 0) return res.status(429).json({ error: 'rate limit exceeded' });
        bucket.tokens -= 1;
        next();
    }

    app.post('/auth/login', (req, res) => {
        if (!REQUIRE_AUTH) return res.json({ token: null, disabled: true });
        const { username, password } = req.body || {};
        if (username === ADMIN_USER && password === ADMIN_PASS) return res.json({ token: issueToken(username) });
        return res.status(401).json({ error: 'invalid credentials' });
    });

    // WhatsApp client (can be stubbed)
    let client = null; let state = { ready: false, qr: null, startedAt: Date.now() };
    let hydrateContacts = async () => { };
    if (!disableClient) {
        const sessionPath = process.env.WHATSAPP_SESSION_PATH || path.join(process.cwd(), '.wa-sessions');
        fs.mkdirSync(sessionPath, { recursive: true });
        client = new Client({
            authStrategy: new LocalAuth({ dataPath: sessionPath }),
            puppeteer: {
                headless: process.env.WHATSAPP_HEADLESS !== 'false',
                args: (process.env.WHATSAPP_BROWSER_ARGS || '--no-sandbox,--disable-setuid-sandbox')
                    .split(',').map(s => s.trim()).filter(Boolean)
            }
        });
        client.on('qr', qr => { state.qr = qr; broadcastEvent({ type: 'qr', data: { qr } }); });
        client.on('ready', async () => { state.ready = true; broadcastEvent({ type: 'ready' }); try { await hydrateContacts(); } catch { } });
        client.on('disconnected', reason => { state.ready = false; broadcastEvent({ type: 'disconnected', data: { reason } }); });
        client.on('message_create', pushMessage);
        client.on('message', pushMessage);
        client.initialize();
        hydrateContacts = async () => {
            try {
                const list = await client.getContacts();
                list.forEach(c => {
                    const id = c.id?._serialized || c.id; if (!id) return;
                    contactsCache.set(id, { id, name: c.name || c.pushname || c.number || id, pushname: c.pushname || c.name || null, number: (c.number || id.replace(/@c\.us$/, '')), isBusiness: !!c.isBusiness, isMyContact: !!c.isMyContact });
                });
            } catch { }
        };
    } else {
        // stubbed client
        client = {
            sendMessage: async (_to, _msg) => ({ id: { _serialized: 'stubbed-msg-id' }, ack: 1 }),
            getChats: async () => [],
            getContacts: async () => [],
            getChatById: async () => null
        };
    }

    // Routes
    app.get('/status', (_req, res) => {
        res.json({
            ready: state.ready,
            qr: state.ready ? undefined : state.qr,
            uptimeMs: Date.now() - state.startedAt,
            contacts: contactsCache.size,
            persistenceReady,
            webhookQueueSize: webhookQueue.length,
            webhookInflight,
            webhookRetry: { maxRetries: WEBHOOK_MAX_RETRIES, baseDelayMs: WEBHOOK_BASE_DELAY_MS, maxDelayMs: WEBHOOK_MAX_DELAY_MS, concurrency: WEBHOOK_WORKER_CONCURRENCY },
            ts: Date.now(),
            testMode: disableClient
        });
    });

    app.get('/events', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();
        res.write(`data: ${JSON.stringify({ type: 'hello', data: { ts: Date.now(), ready: state.ready } })}\n\n`);
        sseClients.add(res); gaugeSseClients.set(sseClients.size);
        req.on('close', () => { sseClients.delete(res); gaugeSseClients.set(sseClients.size); });
    });

    app.post('/send', authMiddleware, rateLimiter, async (req, res) => {
        const { number, to, type = 'text', message, text, url, base64, caption } = req.body || {};
        const target = normalizeWid(number || to || '');
        if (!number && !to) return res.status(400).json({ error: 'number or to required' });
        try {
            let payload = message || text || caption || '';
            let options = {}; let mediaObj = null;
            if (type !== 'text') {
                if (base64) {
                    const cleaned = base64.startsWith('data:') ? base64.split(',')[1] : base64;
                    mediaObj = new MessageMedia('application/octet-stream', cleaned, 'upload');
                } else if (url) { mediaObj = await MessageMedia.fromUrl(url); }
                else return res.status(400).json({ error: 'media requires url or base64' });
                if (caption) options.caption = caption;
            }
            const sent = await client.sendMessage(target, mediaObj || payload, options);
            return res.json({ id: sent.id?._serialized || sent.id, ack: sent.ack, type, to: target });
        } catch (err) { return res.status(500).json({ error: 'failed to send', details: String(err.message || err) }); }
    });

    app.get('/chats', async (_req, res) => {
        try { const chats = await client.getChats(); const data = chats.map(c => ({ id: c.id?._serialized || c.id, name: c.name || c.formattedTitle || c.id?._serialized || '', unreadCount: c.unreadCount || 0, isGroup: !!c.isGroup, pinned: false, archived: false })); res.json(data); }
        catch { res.status(500).json({ error: 'failed to list chats' }); }
    });

    app.get('/contacts', async (_req, res) => {
        try { if (!contactsCache.size && !disableClient) await hydrateContacts(); res.json(Array.from(contactsCache.values())); }
        catch { res.status(500).json({ error: 'failed to list contacts' }); }
    });

    app.get('/messages', async (req, res) => {
        const since = Number(req.query.since || '0');
        const chatId = req.query.chatId || req.query.contactId;
        const limit = Number(req.query.limit || 100);
        const cursor = req.query.cursor ? Number(req.query.cursor) : 0;
        try { const { items, nextCursor, total } = await persistence.listMessages({ since, chatId, limit, cursor }); res.json({ items, nextCursor, total }); }
        catch { res.status(500).json({ error: 'failed to list messages' }); }
    });

    app.get('/messages/:id/media', authMiddleware, async (req, res) => {
        return res.status(404).json({ error: 'media not cached in test mode' });
    });

    app.post('/chats/:id/actions', authMiddleware, rateLimiter, async (req, res) => {
        const id = req.params.id; const { action } = req.body || {};
        if (!action) return res.status(400).json({ error: 'action required' });
        return res.json({ id, flags: { stubbed: true } });
    });

    app.get('/search', authMiddleware, async (req, res) => {
        const q = (req.query.q || req.query.query || '').toLowerCase().trim();
        if (!q) return res.status(400).json({ error: 'q required' });
        try { const { items } = await persistence.listMessages({ limit: 1000 }); const inMessages = items.filter(m => (m.body || '').toLowerCase().includes(q)).slice(-200); res.json({ query: q, messages: inMessages, chats: [] }); }
        catch { res.status(500).json({ error: 'search failed' }); }
    });

    app.get('/health', (_req, res) => res.json({ ok: true }));
    app.get('/metrics', async (_req, res) => { try { res.set('Content-Type', clientMetrics.register.contentType); res.end(await clientMetrics.register.metrics()); } catch { res.status(500).end('# metrics error'); } });
    app.get('/webhooks', authMiddleware, async (_req, res) => { res.json(await persistence.listWebhooks()); });
    app.post('/webhooks', authMiddleware, rateLimiter, async (req, res) => { const { url, events } = req.body || {}; if (!url) return res.status(400).json({ error: 'url required' }); const created = await persistence.createWebhook({ url, events }); res.status(201).json(created); });
    app.delete('/webhooks/:id', authMiddleware, rateLimiter, async (req, res) => { const removed = await persistence.deleteWebhook(req.params.id); res.json({ removed }); });
    app.put('/webhooks/:id', authMiddleware, rateLimiter, async (req, res) => { const { url, events } = req.body || {}; const updated = await persistence.updateWebhook(req.params.id, { url, events }); if (!updated) return res.status(404).json({ error: 'not found' }); res.json(updated); });
    app.use((_req, res) => res.status(404).json({ error: 'not found' }));

    return { app, state: () => ({ ...state }), client, controls: { enqueueWebhookJob, webhookQueue, shutdown: () => { } } };
}

function start(options = {}) {
    const { app } = createServer(options);
    const port = process.env.PORT || 3001;
    return app.listen(port, () => console.log(`[whatsapp-api] Listening on :${port}`));
}

module.exports = { createServer, start };
