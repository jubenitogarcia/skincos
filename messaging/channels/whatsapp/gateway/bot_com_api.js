// Carrega variáveis de ambiente de .env local (se existir)
try { require('dotenv').config(); } catch (_) { /* dotenv opcional */ }
const { Client, LocalAuth, MessageMedia, Location } = require('./index');
// Metrics (Prometheus)
let metricsEnabled = false;
let metrics;
try {
    metrics = require('./metrics/metrics');
    metricsEnabled = true;
} catch (e) { /* silencioso se não existir */ }
const crypto = require('crypto');
const qrcode = require('qrcode-terminal');
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { createMediaFromUrl, validateMediaUrl } = require('./media_helper');
const VideoOptimizer = require('./video_optimizer');
// Cloudinary (opcional) para upload de caminho local -> URL pública
let cloudinary = null;
try { cloudinary = require('cloudinary').v2; } catch (_) { /* lib não instalada */ }
// ===== Nova camada de armazenamento e logger =====
const { getStores, addMessage, getMessage } = require('./storage/inMemory');
let persist = null;
try { persist = require('./storage/persist'); } catch { /* optional */ }
const logger = require('./utils/logger');
// ===== Auto-register Agent Zero webhook (if env provided) =====
const AGZ_WEBHOOK_URL = process.env.AGZ_WEBHOOK_URL; // ex: https://a0.skincos.com.br/agent-zero/webhooks/whatsapp
const AGZ_WEBHOOK_SECRET = process.env.WHATSAPP_WEBHOOK_SECRET || process.env.AGZ_WEBHOOK_SECRET;
function ensureAgentZeroWebhook(tenant = 'default') {
    if (!AGZ_WEBHOOK_URL) return;
    try {
        const { webhooks: webhooksStore } = getStores(tenant);
        const exists = webhooksStore.find(w => w.url === AGZ_WEBHOOK_URL);
        if (exists) {
            // Desativa o webhook do Agent Zero sem deletar
            exists.active = false;
            console.log('🔗 Agent Zero webhook DESATIVADO:', AGZ_WEBHOOK_URL);
            return;
        }
        webhooksStore.push({
            id: 'agent-zero',
            url: AGZ_WEBHOOK_URL,
            secret: AGZ_WEBHOOK_SECRET || 'AGZ_SECRET_123',
            active: false,
            events: [], // todos os eventos
            createdAt: new Date().toISOString(),
            retries: 0
        });
        console.log('🔗 Agent Zero webhook registrado (DESATIVADO):', AGZ_WEBHOOK_URL);
    } catch (e) {
        console.log('⚠️ Falha registrar Agent Zero webhook:', e.message);
    }
}

// =========================
// Integração direta Agent Zero (/message) com CSRF
// =========================
const AGZ_INTERNAL_BASE = process.env.AGZ_INTERNAL_BASE || 'http://localhost:50001';
const AGZ_INTERNAL_ENABLE_DIRECT = process.env.AGZ_INTERNAL_ENABLE_DIRECT === '1';
// Permitir override em tempo de execução via endpoint
let agzDirectEnabled = AGZ_INTERNAL_ENABLE_DIRECT;
// credenciais basic auth: pode vir em AGZ_INTERNAL_BASIC_AUTH como user:pass ou usar AUTH_LOGIN/AUTH_PASSWORD
let _basicAuthUser = null;
let _basicAuthPass = null;
if (process.env.AGZ_INTERNAL_BASIC_AUTH && process.env.AGZ_INTERNAL_BASIC_AUTH.includes(':')) {
    const [u, p] = process.env.AGZ_INTERNAL_BASIC_AUTH.split(':');
    _basicAuthUser = u; _basicAuthPass = p;
} else if (process.env.AUTH_LOGIN && process.env.AUTH_PASSWORD) {
    _basicAuthUser = process.env.AUTH_LOGIN; _basicAuthPass = process.env.AUTH_PASSWORD;
}
const _basicAuthHeader = (_basicAuthUser && _basicAuthPass) ? 'Basic ' + Buffer.from(_basicAuthUser + ':' + _basicAuthPass).toString('base64') : null;

// Armazena sessão CSRF + cookie para reaproveitar
const agentZeroSession = { csrfToken: null, runtimeId: null, cookie: null, lastAt: 0 };
async function ensureCsrfSession(force = false) {
    if (!AGZ_INTERNAL_ENABLE_DIRECT) return null;
    const now = Date.now();
    // renovar se mais de 50 min (~3000s) ou se não existe
    if (!force && agentZeroSession.csrfToken && (now - agentZeroSession.lastAt) < 3000_000) {
        return agentZeroSession;
    }
    try {
        const resp = await axios.get(AGZ_INTERNAL_BASE + '/csrf_token', {
            headers: _basicAuthHeader ? { 'Authorization': _basicAuthHeader } : {},
            timeout: 5000,
            validateStatus: s => s === 200
        });
        const setCookie = resp.headers['set-cookie'];
        if (!setCookie || !Array.isArray(setCookie) || !setCookie.length) throw new Error('Set-Cookie ausente na resposta CSRF');
        // pegar primeiro cookie (session_...)
        const raw = setCookie[0].split(';')[0]; // session_<id>=<value>
        agentZeroSession.cookie = raw;
        agentZeroSession.csrfToken = resp.data.token;
        agentZeroSession.runtimeId = resp.data.runtime_id;
        agentZeroSession.lastAt = now;
        return agentZeroSession;
    } catch (e) {
        console.log('⚠️ Falha ao obter CSRF token Agent Zero:', e.message);
        return null;
    }
}

// Mapa de contexto por número (para manter conversas separadas)
const contextMap = new Map(); // key: phone (sem @c.us) => contextId (uuid)

// Persistência de contextos e contas
const CONTEXT_STORE_PATH = process.env.WA_CONTEXT_STORE_PATH || path.join(__dirname, 'context_store.json');
function saveContextStore() {
    try {
        const obj = {
            contextMap: Object.fromEntries(contextMap.entries()),
            contacts: getStores('default').contacts || []
        };
        fs.writeFileSync(CONTEXT_STORE_PATH, JSON.stringify(obj, null, 2));
    } catch (e) {
        console.log('⚠️ Falha ao salvar context_store.json:', e.message);
    }
}
function loadContextStore() {
    if (!fs.existsSync(CONTEXT_STORE_PATH)) return;
    try {
        const obj = JSON.parse(fs.readFileSync(CONTEXT_STORE_PATH, 'utf8'));
        if (obj.contextMap) {
            Object.entries(obj.contextMap).forEach(([phone, uuid]) => {
                contextMap.set(phone, uuid);
            });
        }
        if (obj.contacts && Array.isArray(obj.contacts)) {
            const store = getStores('default');
            store.contacts = obj.contacts;
        }
        console.log('💾 Contextos e contatos restaurados de context_store.json');
    } catch (e) {
        console.log('⚠️ Falha ao carregar context_store.json:', e.message);
    }
}
// Carregar ao iniciar
loadContextStore();

function resolveContextForPhone(phone) {
    if (!phone) return '';
    if (!contextMap.has(phone)) {
        // gerar uuid simples (sem dependência externa) usando crypto
        const uuid = ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c => (c ^ crypto.randomBytes(1)[0] & 15 >> c / 4).toString(16));
        contextMap.set(phone, uuid);
        saveContextStore();
    }
    return contextMap.get(phone);
}
function resetContextForPhone(phone) {
    if (contextMap.has(phone)) {
        contextMap.delete(phone);
        saveContextStore();
    }
}

// Identificador da conta (porta ou nome customizado)
const ACCOUNT_ID = process.env.ACCOUNT_ID || process.env.PORT || '3001';
async function postAgentZeroMessage({ text, context, retries = 1 }) {
    if (!AGZ_INTERNAL_ENABLE_DIRECT) return null;
    const sess = await ensureCsrfSession();
    if (!sess || !sess.csrfToken) return null;
    try {
        const payload = { text, context, accountId: ACCOUNT_ID };
        const resp = await axios.post(AGZ_INTERNAL_BASE + '/message', payload, {
            headers: {
                'Content-Type': 'application/json',
                ...(_basicAuthHeader ? { 'Authorization': _basicAuthHeader } : {}),
                'X-CSRF-Token': sess.csrfToken,
                'Cookie': sess.cookie
            },
            timeout: 20000,
            validateStatus: s => s === 200 || s === 403
        });
        if (resp.status === 403 && retries > 0) {
            // token possivelmente expirado -> renovar e tentar novamente
            await ensureCsrfSession(true);
            return await postAgentZeroMessage({ text, context, retries: retries - 1 });
        }
        if (resp.status !== 200) {
            console.log('⚠️ Resposta inesperada /message:', resp.status, resp.data);
            return null;
        }
        return resp.data; // { message: <texto>, context: <id> }
    } catch (e) {
        console.log('⚠️ Falha POST /message Agent Zero:', e.message);
        return null;
    }
}

// Configuração do servidor Express
const app = express();
try { if (persist) { persist.init({ dir: process.env.PERSIST_DIR }); persist.loadMessagesToMemory('default'); } } catch { /* ignore */ }
const PORT = process.env.PORT || 3001;
// Dev flag to allow simulation/injection endpoints (disabled in production by default)
const DEV_ENABLE_SIMULATION = (process.env.DEV_ENABLE_SIMULATION === '1') || (process.env.NODE_ENV !== 'production');

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public')); // Servir arquivos estáticos

// ================= Dev utilities (simulation) =================
// POST /v1/dev/simulate-inbound
// Body: { phone: "+5511999999999" | "5511999999999" | "11999999999", body: string, type?: "text"|"image"|"audio"|"video"|"document"|"ptt"|"sticker", count?: number, intervalMs?: number }
// Notes:
// - Only available when DEV_ENABLE_SIMULATION is true.
// - Injects inbound messages into in-memory store and emits an event via triggerWebhooks for UI testing.
app.post('/v1/dev/simulate-inbound', async (req, res) => {
    if (!DEV_ENABLE_SIMULATION) return res.status(403).json({ success: false, error: 'simulation disabled' });
    try {
        const tenant = resolveTenant(req);
        const rawPhone = String(req.body?.phone || req.body?.contact || '').trim();
        const body = String(req.body?.body ?? '').trim();
        const type = (req.body?.type ? String(req.body.type).toLowerCase() : 'text');
        const count = Math.max(1, Math.min(100, parseInt(req.body?.count ?? '1', 10)));
        const intervalMs = Math.max(0, Math.min(60_000, parseInt(req.body?.intervalMs ?? '0', 10)));
        const phone = rawPhone.replace(/@c\.us$/i, '').replace(/\D/g, '');
        if (!phone) return res.status(400).json({ success: false, error: 'invalid phone' });
        if (!body && type === 'text') return res.status(400).json({ success: false, error: 'body required for text' });

        // Ensure contact exists in store for better UX in search/lists
        try {
            const { contacts: contactsStore, indexes } = getStores(tenant);
            if (!indexes.contactsById.has(phone)) {
                const contact = { id: phone, displayName: `Simulado ${phone}`, createdAt: new Date().toISOString(), inboundCount: 0, outboundCount: 0 };
                contactsStore.push(contact);
                indexes.contactsById.set(phone, contact);
            }
        } catch { /* best-effort */ }

        // Enqueue the injections (optionally spaced by intervalMs)
        const scheduled = [];
        for (let i = 0; i < count; i++) {
            const delay = intervalMs * i;
            const when = Date.now() + delay;
            scheduled.push({ at: new Date(when).toISOString() });
            setTimeout(() => {
                try {
                    const now = new Date();
                    const id = `sim_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`;
                    const rec = {
                        id,
                        from: `${phone}@c.us`,
                        to: `me@c.us`,
                        type,
                        body: type === 'text' ? body : (body || null),
                        direction: 'inbound',
                        timestamp: now.toISOString(),
                        createdAt: now.toISOString(),
                        ack: 1,
                        status: 'received'
                    };
                    addMessage(tenant, rec);
                    const stored = getMessage(tenant, id) || rec;
                    triggerWebhooks('message_received', { message: stored }, tenant);
                } catch (e) {
                    console.log('⚠️ simulate-inbound failed to inject message:', e.message);
                }
            }, delay);
        }

        return res.json({ success: true, scheduled: scheduled.length, phone, type, intervalMs });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});

// ================= RESTful variants for chat actions =================
// Archive/unarchive
app.post('/v1/chats/:id/archive', async (req, res) => {
    try {
        if (!isClientReady) return res.status(503).json({ success: false, message: 'Bot não está pronto' });
        const chat = await getChatOr404(req.params.id, res); if (!chat) return;
        await chat.archive();
        res.json({ success: true, chatId: chat.id?._serialized, archived: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
app.delete('/v1/chats/:id/archive', async (req, res) => {
    try {
        if (!isClientReady) return res.status(503).json({ success: false, message: 'Bot não está pronto' });
        const chat = await getChatOr404(req.params.id, res); if (!chat) return;
        await chat.unarchive();
        res.json({ success: true, chatId: chat.id?._serialized, archived: false });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// Pin/unpin
app.post('/v1/chats/:id/pin', async (req, res) => {
    try {
        if (!isClientReady) return res.status(503).json({ success: false, message: 'Bot não está pronto' });
        const chat = await getChatOr404(req.params.id, res); if (!chat) return;
        const pinned = await chat.pin();
        res.json({ success: true, chatId: chat.id?._serialized, pinned: !!pinned });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
app.delete('/v1/chats/:id/pin', async (req, res) => {
    try {
        if (!isClientReady) return res.status(503).json({ success: false, message: 'Bot não está pronto' });
        const chat = await getChatOr404(req.params.id, res); if (!chat) return;
        const pinned = await chat.unpin();
        res.json({ success: true, chatId: chat.id?._serialized, pinned: !!pinned });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// Mute/unmute
app.post('/v1/chats/:id/mute', async (req, res) => {
    try {
        if (!isClientReady) return res.status(503).json({ success: false, message: 'Bot não está pronto' });
        const chat = await getChatOr404(req.params.id, res); if (!chat) return;
        const duration = req.body?.duration != null ? parseInt(req.body.duration, 10) : null;
        const until = duration && duration > 0 ? new Date(Date.now() + duration) : undefined;
        const result = await chat.mute(until);
        res.json({ success: true, chatId: chat.id?._serialized, isMuted: result?.isMuted ?? true, muteExpiration: result?.muteExpiration ?? null });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
app.delete('/v1/chats/:id/mute', async (req, res) => {
    try {
        if (!isClientReady) return res.status(503).json({ success: false, message: 'Bot não está pronto' });
        const chat = await getChatOr404(req.params.id, res); if (!chat) return;
        const result = await chat.unmute();
        res.json({ success: true, chatId: chat.id?._serialized, isMuted: result?.isMuted ?? false, muteExpiration: result?.muteExpiration ?? null });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// Read/mark seen
app.post('/v1/chats/:id/read', async (req, res) => {
    try {
        if (!isClientReady) return res.status(503).json({ success: false, message: 'Bot não está pronto' });
        const id = normalizeChatId(req.params.id);
        if (!id) return res.status(400).json({ success: false, message: 'chatId inválido' });
        await client.sendSeen(id);
        res.json({ success: true, chatId: id });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// Variáveis globais
let isClientReady = false;
let qrCodeData = null;
let lastConnState = null; // última mudança de estado reportada pelo cliente
let didAuth = false; // marcou evento de autenticado
// ======= Abstração multi-tenant (fase 1: apenas 'default') =======
function resolveTenant(_req) { return 'default'; }
// ======= Rate limiting simples por tenant/rota =======
const rateBuckets = {}; // key => { tokens, updated }
function rateLimit(tenant, route, capacity = 60, refillPerSec = 1) {
    const key = `${tenant}:${route}`;
    const now = Date.now();
    if (!rateBuckets[key]) rateBuckets[key] = { tokens: capacity, updated: now };
    const bucket = rateBuckets[key];
    const elapsed = (now - bucket.updated) / 1000;
    const refill = Math.floor(elapsed * refillPerSec);
    if (refill > 0) {
        bucket.tokens = Math.min(capacity, bucket.tokens + refill);
        bucket.updated = now;
    }
    if (bucket.tokens <= 0) return false;
    bucket.tokens -= 1;
    return true;
}

function snapshotLimits(tenant) {
    const out = {};
    Object.keys(rateBuckets).forEach(k => {
        if (!k.startsWith(`${tenant}:`)) return;
        const route = k.split(':')[1];
        out[route] = { remaining: rateBuckets[k].tokens };
    });
    return out;
}

// ========================================
// ENDPOINT: Grupos em comum com um contato
// - GET /common-groups?phone=5599999999999
// - GET /common-groups?contactId=5599999999999@c.us
// - GET /v1/contacts/:id/common-groups (id pode ser telefone ou 5599...@c.us)
// Retorna lista de grupos onde o contato participa (o próprio cliente já é membro se aparece em getChats())
// ========================================
async function listCommonGroups(contactIdRaw) {
    if (!isClientReady) {
        const e = new Error('WhatsApp não está conectado');
        e.statusCode = 503; throw e;
    }
    if (!contactIdRaw) {
        const e = new Error('Parâmetro contactId/phone é obrigatório');
        e.statusCode = 400; throw e;
    }
    const contactId = contactIdRaw.includes('@') ? contactIdRaw : `${String(contactIdRaw).replace(/\D/g, '')}@c.us`;
    const chats = await client.getChats();
    const groups = chats.filter(c => c.isGroup === true);
    const result = [];
    for (const g of groups) {
        try {
            // Alguns ambientes não carregam participants por padrão; usar fetchParticipants se existir
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
            // ignora grupo com erro de permissão/carga
        }
    }
    return { success: true, groups: result, total: result.length, timestamp: new Date().toISOString() };
}

app.get('/common-groups', async (req, res) => {
    const tenant = resolveTenant(req);
    if (!rateLimit(tenant, 'common-groups', 30, 0.5)) return res.status(429).json({ success: false, error: 'rate_limited' });
    try {
        const contactId = req.query.contactId || req.query.phone;
        const data = await listCommonGroups(contactId);
        res.json(data);
    } catch (error) {
        console.error('❌ Erro /common-groups:', error.message);
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
});

app.get('/v1/contacts/:id/common-groups', async (req, res) => {
    const tenant = resolveTenant(req);
    if (!rateLimit(tenant, 'v1/contacts/common-groups', 30, 0.5)) return res.status(429).json({ success: false, error: 'rate_limited' });
    try {
        const id = req.params.id;
        const data = await listCommonGroups(id);
        res.json(data);
    } catch (error) {
        console.error('❌ Erro /v1/contacts/:id/common-groups:', error.message);
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
});

// Função auxiliar para extrair ID da mensagem de forma segura
function extractMessageId(sentMessage) {
    if (!sentMessage) return 'unknown';

    // Tentar diferentes formatos de ID
    if (sentMessage.id && sentMessage.id._serialized) {
        return sentMessage.id._serialized;
    } else if (sentMessage.id) {
        return sentMessage.id.toString();
    } else if (sentMessage._data && sentMessage._data.id) {
        return sentMessage._data.id._serialized || sentMessage._data.id.toString();
    } else if (sentMessage.messageId) {
        return sentMessage.messageId;
    } else if (typeof sentMessage === 'string') {
        return sentMessage;
    }

    return 'sent_without_id';
}

// Função para detectar o caminho do Chrome
function getChromePath() {
    const fs = require('fs');
    const path = require('path');

    const chromePaths = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // macOS Chrome
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        process.env.PUPPETEER_EXECUTABLE_PATH // Para imagem puppeteer
    ].filter(Boolean);

    // Primeiro tentar Chrome do sistema
    for (const chromePath of chromePaths) {
        if (fs.existsSync(chromePath)) {
            console.log('🌐 Chrome do sistema encontrado em:', chromePath);
            return chromePath;
        }
    }

    // Se não encontrar Chrome do sistema, procurar Chromium do Puppeteer
    const puppeteerChromiumPaths = [
        path.join(__dirname, 'node_modules/puppeteer/.local-chromium'),
        path.join(process.cwd(), 'node_modules/puppeteer/.local-chromium')
    ];

    for (const basePath of puppeteerChromiumPaths) {
        if (fs.existsSync(basePath)) {
            try {
                const revisions = fs.readdirSync(basePath);
                if (revisions.length > 0) {
                    const latestRevision = revisions.sort().pop();
                    const chromiumPaths = [
                        path.join(basePath, latestRevision, 'chrome-linux/chrome'),
                        path.join(basePath, latestRevision, 'chrome-win/chrome.exe'),
                        path.join(basePath, latestRevision, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium')
                    ];

                    for (const chromiumPath of chromiumPaths) {
                        if (fs.existsSync(chromiumPath)) {
                            console.log('🌐 Chromium do Puppeteer encontrado em:', chromiumPath);
                            return chromiumPath;
                        }
                    }
                }
            } catch (error) {
                console.log('⚠️ Erro ao verificar Chromium do Puppeteer:', error.message);
            }
        }
    }

    console.log('⚠️ Nem Chrome nem Chromium encontrados');
    return null;
}

// ========================================
// FUNÇÃO UNIFICADA DE ENVIO (REFATORADA)
// ========================================
async function sendUnifiedMessage({
    number,
    message,
    type = 'text',
    url,
    latitude,
    longitude,
    location_name,
    location_address,
    contact_name,
    contact_phone,
    contact_organization,
    tenant = 'default'
}) {
    const traceId = crypto.randomUUID().slice(0, 8);
    console.log(`🟢 [${traceId}] IN sendUnifiedMessage type=${type} number=${number} url=${url}`);
    if (!isClientReady) {
        const err = new Error('Bot não está pronto');
        err.statusCode = 503;
        console.log(`🔴 [${traceId}] abort not ready`);
        throw err;
    }

    if (!number) {
        const err = new Error('Número é obrigatório');
        err.statusCode = 400;
        throw err;
    }

    // Reuso da formatação
    const formattedNumber = number.includes('@c.us') ? number : `${number.replace(/\D/g, '')}@c.us`;
    let sentMessage;

    // =========================
    // SUPORTE A CAMINHO LOCAL DE MÍDIA
    // Se "url" não é http(s), tratamos como caminho local (possivelmente passado entre aspas pelo bulk sender)
    // Estratégia:
    // 1. Normaliza removendo aspas envolventes.
    // 2. Se existir arquivo local:
    //    a) Se Cloudinary configurado (CLOUDINARY_URL ou variáveis dedicadas) -> faz upload (resource_type auto) e substitui url pelo secure_url.
    //    b) Caso falhe upload ou Cloudinary indisponível -> lê arquivo local e cria MessageMedia manualmente (fallback direto, sem URL pública).
    // Observação: para fallback manual só suportamos types image/video/audio/document simples.
    let localMedia = null; // { media, inferredType }
    if (url && typeof url === 'string' && !/^https?:/i.test(url)) {
        try {
            const cleaned = url.replace(/^['"]|['"]$/g, '');
            const exists = fs.existsSync(cleaned) && fs.statSync(cleaned).isFile();
            console.log(`🔍 [${traceId}] local path detected cleaned=${cleaned} exists=${exists}`);
            if (!exists) {
                const err = new Error('Arquivo local não existe no servidor. Forneça URL http(s) ou rode local.');
                err.statusCode = 400;
                throw err;
            }
            if (exists) {
                const MAX_FALLBACK_BYTES = (process.env.LOCAL_MEDIA_MAX_BYTES ? parseInt(process.env.LOCAL_MEDIA_MAX_BYTES, 10) : 12 * 1024 * 1024); // 12MB default
                // Cloudinary upload se possível
                const cloudinaryConfigured = !!(cloudinary && (process.env.CLOUDINARY_URL || (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET)));
                if (cloudinary && cloudinaryConfigured) {
                    try {
                        if (!cloudinary.config().cloud_name && process.env.CLOUDINARY_CLOUD_NAME) {
                            cloudinary.config({
                                cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
                                api_key: process.env.CLOUDINARY_API_KEY,
                                api_secret: process.env.CLOUDINARY_API_SECRET,
                                secure: true
                            });
                        }
                        const upRes = await cloudinary.uploader.upload(cleaned, { resource_type: 'auto', folder: 'whatsapp_uploads' });
                        if (upRes && upRes.secure_url) {
                            console.log('☁️  Upload Cloudinary ok:', upRes.secure_url);
                            url = upRes.secure_url; // substitui para fluxo normal de URL remota (abaixo nos cases)
                        }
                    } catch (e) {
                        console.log(`⚠️ [${traceId}] Cloudinary falhou: ${e.message} (fallback local)`);
                    }
                }
                // Se ainda não temos URL http -> preparar fallback manual
                if (!/^https?:/i.test(url)) {
                    const ext = cleaned.toLowerCase().split('.').pop() || '';
                    const mimeMap = {
                        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
                        mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo', mkv: 'video/x-matroska', webm: 'video/webm',
                        pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                        xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                        txt: 'text/plain', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac'
                    };
                    const mime = mimeMap[ext] || 'application/octet-stream';
                    const stat = fs.statSync(cleaned);
                    if (stat.size > MAX_FALLBACK_BYTES) {
                        const err = new Error(`Arquivo local excede limite fallback (${stat.size} > ${MAX_FALLBACK_BYTES}). Configure Cloudinary ou reduza o tamanho.`);
                        err.statusCode = 413;
                        throw err;
                    }
                    const b64 = fs.readFileSync(cleaned, { encoding: 'base64' });
                    const filename = path.basename(cleaned);
                    try {
                        const { MessageMedia } = require('./index');
                        const mediaObj = new MessageMedia(mime, b64, filename);
                        // inferir tipo se ainda default image/video/document
                        let inferredType = type;
                        if (!message) message = '';
                        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)) inferredType = 'image';
                        else if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) inferredType = 'video';
                        else if (['mp3', 'wav', 'ogg', 'm4a', 'aac'].includes(ext)) inferredType = 'audio';
                        else inferredType = 'document';
                        localMedia = { media: mediaObj, inferredType };
                        console.log(`📎 [${traceId}] fallback local preparado filename=${filename} inferred=${inferredType}`);
                        type = inferredType; // ajusta tipo para switch
                    } catch (e) {
                        console.log(`⚠️ [${traceId}] erro criar MessageMedia: ${e.message}`);
                    }
                }
            }
        } catch (e) {
            console.log(`🔴 [${traceId}] erro caminho local: ${e.message}`);
            throw e;
        }
    }

    // ================= DISPATCH POR TIPO =================
    function setStatus(e, code) { e.statusCode = code; return e; }
    console.log(`➡️  [${traceId}] dispatch type=${type}`);
    switch (type) {
        case 'image':
            try {
                if (localMedia && localMedia.inferredType === 'image') {
                    sentMessage = await client.sendMessage(formattedNumber, localMedia.media, { caption: message || '' });
                } else {
                    if (!url) throw setStatus(new Error('URL da imagem é obrigatória'), 400);
                    let media;
                    try {
                        media = await MessageMedia.fromUrl(url);
                        if (!media.data || media.data.length === 0) throw new Error('MessageMedia.fromUrl retornou dados vazios');
                    } catch { media = await createMediaFromUrl(url); }
                    sentMessage = await client.sendMessage(formattedNumber, media, { caption: message || '' });
                }
            } catch (e) { e.userMessage = e.userMessage || 'Erro ao enviar imagem'; console.log(`❌ [${traceId}] image fail ${e.message}`); throw e; }
            break;
        case 'video':
            try {
                if (localMedia && localMedia.inferredType === 'video') {
                    sentMessage = await client.sendMessage(formattedNumber, localMedia.media, { caption: message || '' });
                } else {
                    if (!url) throw setStatus(new Error('URL de vídeo é obrigatória'), 400);
                    const media = await createMediaFromUrl(url);
                    sentMessage = await client.sendMessage(formattedNumber, media, { caption: message || '' });
                }
            } catch (e) { e.userMessage = e.userMessage || 'Erro ao enviar vídeo'; console.log(`❌ [${traceId}] video fail ${e.message}`); throw e; }
            break;
        case 'audio':
            try {
                if (localMedia && localMedia.inferredType === 'audio') {
                    sentMessage = await client.sendMessage(formattedNumber, localMedia.media, {});
                } else {
                    if (!url) throw setStatus(new Error('URL de áudio é obrigatória'), 400);
                    const media = await createMediaFromUrl(url);
                    sentMessage = await client.sendMessage(formattedNumber, media, {});
                }
            } catch (e) { e.userMessage = e.userMessage || 'Erro ao enviar áudio'; console.log(`❌ [${traceId}] audio fail ${e.message}`); throw e; }
            break;
        case 'document':
            try {
                if (localMedia && localMedia.inferredType === 'document') {
                    sentMessage = await client.sendMessage(formattedNumber, localMedia.media, { caption: message || '' });
                } else {
                    if (!url) throw setStatus(new Error('URL do documento é obrigatória'), 400);
                    const media = await createMediaFromUrl(url);
                    sentMessage = await client.sendMessage(formattedNumber, media, { sendMediaAsDocument: true, caption: message || '' });
                }
            } catch (e) { e.userMessage = e.userMessage || 'Erro ao enviar documento'; console.log(`❌ [${traceId}] document fail ${e.message}`); throw e; }
            break;
        case 'location':
            try {
                if (latitude == null || longitude == null) throw setStatus(new Error('latitude e longitude são obrigatórios'), 400);
                // Alguns builds de whatsapp-web.js aceitam apenas 2-3 args (lat, lng, desc). Usar descrição combinada.
                const desc = location_name || location_address || '';
                const loc = new Location(parseFloat(latitude), parseFloat(longitude), desc);
                sentMessage = await client.sendMessage(formattedNumber, loc);
            } catch (e) { e.userMessage = e.userMessage || 'Erro ao enviar localização'; console.log(`❌ [${traceId}] location fail ${e.message}`); throw e; }
            break;
        case 'contact':
            try {
                if (!contact_name || !contact_phone) throw setStatus(new Error('contact_name e contact_phone são obrigatórios'), 400);
                const org = contact_organization || '';
                const cleanPhone = String(contact_phone).replace(/[^0-9+]/g, '');
                const vcard = [
                    'BEGIN:VCARD',
                    'VERSION:3.0',
                    `FN:${contact_name}`,
                    `N:${contact_name};;;;`,
                    org ? `ORG:${org}` : null,
                    `TEL;type=CELL;type=VOICE;waid=${cleanPhone}:${cleanPhone}`,
                    'END:VCARD'
                ].filter(Boolean).join('\n');
                sentMessage = await client.sendMessage(formattedNumber, vcard, {});
            } catch (e) { e.userMessage = e.userMessage || 'Erro ao enviar contato'; console.log(`❌ [${traceId}] contact fail ${e.message}`); throw e; }
            break;
        case 'text':
            if (!message) throw setStatus(new Error('Mensagem é obrigatória'), 400);
            sentMessage = await client.sendMessage(formattedNumber, message);
            break;
        default:
            sentMessage = await client.sendMessage(formattedNumber, message || '');
            break;
    }

    // Registro outbound
    const nowIso = new Date().toISOString();
    const rec = {
        id: sentMessage?.id?._serialized || crypto.randomUUID(),
        from: null,
        to: formattedNumber,
        body: ['image', 'video', 'audio', 'document', 'location', 'contact'].includes(type) ? (message || null) : (message || null),
        type,
        mediaUrl: /^https?:/i.test(url || '') ? url : (localMedia && !/^https?:/i.test(url || '') ? (localMedia.media?.filename || null) : null),
        createdAt: nowIso,
        status: 'sent',
        direction: 'outbound',
        channelId: 'primary-whatsapp',
        annotations: [],
        fromMe: true
    };
    try { addMessage(tenant, rec); } catch { console.log(`⚠️ [${traceId}] addMessage falhou`); }
    console.log(`✅ [${traceId}] OK id=${rec.id} to=${rec.to} type=${type}`);
    return { sentMessage, record: rec, traceId };
}

// ================= Helpers CRM & Webhooks =================
function upsertContactFromPhone(phoneE164, displayName, direction, tenant = 'default') {
    if (!phoneE164) return;
    const id = phoneE164.replace(/[^0-9]/g, '');
    const { contacts: contactsStore, indexes } = getStores(tenant);
    let c = contactsStore.find(ct => ct.id === id);
    const now = new Date().toISOString();
    if (!c) {
        c = { id, name: displayName || null, displayName: displayName || null, createdAt: now, updatedAt: now, lastInteractionAt: now, tags: [], custom: {}, inboundCount: 0, outboundCount: 0, firstSeenAt: now, lastInboundAt: null, lastOutboundAt: null };
        contactsStore.push(c);
        try { if (indexes && indexes.contactsById) indexes.contactsById.set(id, c); } catch { }
    }
    if (displayName) c.displayName = displayName || c.displayName;
    c.lastInteractionAt = now;
    if (direction === 'inbound') { c.inboundCount += 1; c.lastInboundAt = now; }
    if (direction === 'outbound') { c.outboundCount += 1; c.lastOutboundAt = now; }
    c.updatedAt = now;
    return c;
}

// ---- Webhook delivery enhancements (retry + tracking) ----
const WEBHOOK_MAX_ATTEMPTS = 5;
const WEBHOOK_RETRY_BASE_MS = 2000; // 2s, exponencial
const webhookDeliveriesStore = []; // { id, webhookId, tenantId, eventId, type, status, attempt, startedAt, finishedAt, durationMs, error }

async function dispatchWebhook(webhook, fullPayload, attempt = 1) {
    const startedAt = Date.now();
    let status = 'ok';
    let error = null;
    const bodyString = JSON.stringify(fullPayload);
    try {
        const signature = crypto.createHmac('sha256', webhook.secret).update(bodyString).digest('hex');
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
        tenantId: fullPayload.tenantId,
        eventId: fullPayload.eventId,
        type: fullPayload.event,
        status,
        attempt,
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
        error
    });
    if (metricsEnabled) {
        if (status === 'error') metrics.incWebhookFailure(); else metrics.incWebhookOk();
    }
    if (status === 'error' && attempt < WEBHOOK_MAX_ATTEMPTS) {
        const delay = WEBHOOK_RETRY_BASE_MS * Math.pow(2, attempt - 1);
        setTimeout(() => {
            dispatchWebhook(webhook, fullPayload, attempt + 1).catch(() => { });
        }, delay);
    } else if (status === 'error') {
        console.log(`⚠️ Webhook falhou definitivamente após ${attempt} tentativas:`, webhook.id, error);
    }
}

function triggerWebhooks(eventType, payload, tenant = 'default') {
    try {
        const { webhooks: webhooksStore, events: eventsStore } = getStores(tenant);
        const targets = webhooksStore.filter(w => w.active && (!w.events.length || w.events.includes(eventType)));
        if (!targets.length) return;
        const eventId = crypto.randomUUID();
        const timestamp = new Date().toISOString();
        const fullPayload = { v: 1, event: eventType, eventId, tenantId: tenant, timestamp, ...payload };
        // registrar internamente
        eventsStore.push({ id: eventId, type: eventType, timestamp, payload, tenantId: tenant });
        targets.forEach(w => dispatchWebhook(w, fullPayload).catch(() => { }));
    } catch (e) {
        console.log('⚠️ triggerWebhooks error:', e.message);
    }
}

// Configuração do Puppeteer
function getPuppeteerConfig() {
    const chromePath = getChromePath();
    const config = {
        headless: 'new',
        timeout: 60000,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-gpu-sandbox',
            '--no-first-run',
            '--disable-extensions',
            '--disable-default-apps',
            '--disable-background-timer-throttling',
            '--disable-renderer-backgrounding',
            '--disable-backgrounding-occluded-windows',
            '--disable-client-side-phishing-detection',
            '--disable-hang-monitor',
            '--disable-popup-blocking',
            '--disable-prompt-on-repost',
            '--disable-sync',
            '--disable-translate',
            '--metrics-recording-only',
            '--no-crash-upload',
            '--safebrowsing-disable-auto-update',
            '--disable-features=VizDisplayCompositor',
            '--disable-blink-features=AutomationControlled',
            '--user-data-dir=/tmp/chrome-user-data',
            '--disable-web-security',
            '--disable-features=site-per-process',
            '--disable-ipc-flooding-protection',
            '--disable-background-networking',
            '--disable-logging',
            '--disable-plugins',
            '--memory-pressure-off',
            '--max_old_space_size=4096',
            '--disable-crash-reporter',
            '--disable-in-process-stack-traces',
            '--disable-logging',
            '--disable-dev-shm-usage',
            '--disable-remote-fonts',
            '--disable-background-media-playback',
            '--disable-features=TranslateUI',
            '--disable-features=BlinkGenPropertyTrees'
        ]
    };

    // Só adicionar executablePath se Chrome foi encontrado
    if (chromePath) {
        config.executablePath = chromePath;
    }

    return config;
}

// =============================
// CLIENTE WHATSAPP (MULTI-INSTANCE READY)
// =============================
let client = null;
let clientInitError = null;
const INSTANCE_PORT = process.env.PORT || '3001';
const INSTANCE_AUTH_PATH = process.env.WWJS_AUTH_PATH || (`.wwebjs_auth_local_${INSTANCE_PORT}`);

function getPuppeteerConfigPerInstance() {
    const base = getPuppeteerConfig();
    const profileDir = process.env.WWJS_PROFILE_DIR || path.join(process.cwd(), `.chrome_profile_${INSTANCE_PORT}`);
    try { if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true }); } catch { }
    // Best-effort: limpar locks que quebram Chrome (ProcessSingleton)
    try {
        const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
        for (const f of lockFiles) {
            const p = path.join(profileDir, f);
            if (fs.existsSync(p)) {
                fs.rmSync(p, { force: true });
            }
        }
    } catch { /* ignore lock cleanup errors */ }
    base.args = (base.args || []).filter(a => !a.startsWith('--user-data-dir'));
    base.args.push(`--user-data-dir=${profileDir}`);
    return base;
}

function wireClientEvents(c) {
    c.on('qr', (qr) => {
        console.log('\n🔄 Novo QR Code gerado!');
        console.log('📱 Escaneie o QR Code com seu WhatsApp:');
        console.log('📱 WhatsApp > Menu > Dispositivos conectados > Conectar dispositivo');
        qrcode.generate(qr, { small: true });
        qrCodeData = qr;
        console.log(`\n🌐 Acesse também: http://localhost:${PORT}/qr.html`);
        console.log(`📅 ${new Date().toLocaleString()}\n`);
    });
    c.on('loading_screen', (percent, message) => console.log(`⏳ Carregando... ${percent}% - ${message}`));
    c.on('authenticated', () => {
        console.log('✅ Cliente autenticado com sucesso!');
        // Assim que autenticar, o QR não é mais necessário
        didAuth = true;
        lastConnState = lastConnState || 'AUTHENTICATED';
        try { qrCodeData = null; } catch { }
        // Fallback de segurança: se READY não chegar em 5s, mas estado já for CONNECTED, marcar como pronto
        setTimeout(() => {
            try {
                if (!isClientReady && (lastConnState === 'CONNECTED' || lastConnState === 'open' || lastConnState === 'OPENING')) {
                    console.log('🛡️ Fallback pós-auth: marcando como pronto baseado no estado', lastConnState);
                    isClientReady = true;
                    qrCodeData = null;
                }
            } catch { }
        }, 5000);
        // Fallback 2: se ainda não ficou pronto após 15s do auth, forçar pronto (ambientes sem READY/state)
        setTimeout(() => {
            try {
                if (!isClientReady) {
                    console.log('⏱️ Fallback pós-auth (15s): marcando como pronto por timeout (READY/state ausentes)');
                    isClientReady = true;
                    qrCodeData = null;
                }
            } catch { }
        }, 15000);
    });
    c.on('auth_failure', msg => { console.error('❌ Falha na autenticação:', msg); });
    c.on('ready', () => {
        console.log('\n🎉 WhatsApp Bot está pronto!');
        console.log('📱 Conectado e funcionando!');
        console.log(`🕐 ${new Date().toLocaleString()}`);
        console.log(`🌐 Interface: http://localhost:${PORT}/qr.html`);
        console.log(`� API: http://localhost:${PORT}/status\n`);
        isClientReady = true;
        qrCodeData = null;
        ensureAgentZeroWebhook('default');
    });
    // Estado de conexão granular
    c.on('change_state', (state) => {
        lastConnState = typeof state === 'string' ? state : (state && state.state) ? state.state : state;
        console.log('🔀 Estado de conexão alterado:', lastConnState);
        if (!isClientReady && String(lastConnState).toUpperCase() === 'CONNECTED') {
            isClientReady = true;
            qrCodeData = null;
        }
    });
    c.on('disconnected', (r) => { isClientReady = false; console.log('⚠️ Cliente desconectado:', r); });
}

function createClient() {
    console.log(`🔧 Criando cliente WhatsApp (porta ${INSTANCE_PORT}) authPath=${INSTANCE_AUTH_PATH}`);
    clientInitError = null;
    client = new Client({
        authStrategy: new LocalAuth({ dataPath: INSTANCE_AUTH_PATH, clientId: `api-client-${INSTANCE_PORT}` }),
        puppeteer: getPuppeteerConfigPerInstance()
    });
    wireClientEvents(client);
    return client;
}

createClient();

// (Removida limpeza automática agressiva para preservar sessões multi-instância)

// Função para cleanup seguro do cliente
async function safeClientCleanup() {
    try {
        if (client && client.pupPage) {
            await client.pupPage.close().catch(() => { });
            console.log('📱 Página Puppeteer fechada');
        }
        if (client && client.pupBrowser) {
            await client.pupBrowser.close().catch(() => { });
            console.log('🌐 Navegador Puppeteer fechado');
        }
    } catch (error) {
        console.log('⚠️ Erro no cleanup:', error.message);
    }
}

// ========================================
// Tentativa de limpeza preventiva de lock de perfil Chrome que gera erro ProcessSingleton.
try {
    const lockPath = '/tmp/chrome-user-data/SingletonLock';
    if (fs.existsSync(lockPath)) {
        fs.rmSync(lockPath, { force: true });
    }
} catch (e) { /* ignore */ }
// EVENTOS DO CLIENTE WHATSAPP (definidos via wireClientEvents; abaixo apenas handlers específicos adicionais)

// (handlers de mensagens inbound definidos abaixo no client.on('message'))

// (disconnected já tratado em wireClientEvents)
// Mensagens recebidas (tratamento CRM + webhooks + Agent Zero) — handler unificado
client.on('message', async (msg) => {
    console.log(`📨 Mensagem recebida: ${msg.body}`);
    // Ignora eco de mensagens do próprio bot
    if (msg.fromMe) {
        try {
            const rec = {
                id: msg.id?._serialized || msg.id || 'unknown',
                to: msg.to || null,
                from: msg.from,
                type: msg.type || 'text',
                body: msg.body || null,
                mediaUrl: null,
                status: 'sent',
                createdAt: new Date().toISOString(),
                direction: 'outbound',
                channelId: 'primary-whatsapp',
                annotations: [],
                fromMe: true
            };
            addMessage('default', rec);
            try { if (persist) persist.appendMessage('default', rec); } catch { }
        } catch { }
        return;
    }

    const tenant = 'default';
    try {
        const phoneMatch = msg.from.endsWith('@c.us') ? msg.from.replace('@c.us', '') : null;
        if (phoneMatch) upsertContactFromPhone(phoneMatch, msg._data?.notifyName || msg._data?.pushname || null, 'inbound', tenant);
    } catch (e) { console.log('⚠️ Falha ao atualizar contato inbound:', e.message); }

    try {
        const rec = {
            id: msg.id?._serialized || msg.id || 'unknown',
            to: null,
            from: msg.from,
            type: msg.type || 'text',
            body: msg.body || null,
            mediaUrl: null,
            status: 'received',
            createdAt: new Date().toISOString(),
            direction: 'inbound',
            channelId: 'primary-whatsapp',
            annotations: [],
            fromMe: false
        };
        addMessage(tenant, rec);
        try { if (persist) persist.appendMessage(tenant, rec); } catch { }
        if (metricsEnabled) metrics.incInbound();
        const stored = getMessage(tenant, msg.id?._serialized || msg.id || 'unknown');
        if (stored && typeof stored === 'object') stored.fromMe = false;
        triggerWebhooks('message_received', { message: stored }, tenant);
    } catch (e) { console.log('⚠️ Falha ao armazenar mensagem inbound:', e.message); }

    if (agzDirectEnabled && AGZ_INTERNAL_ENABLE_DIRECT && msg.body) {
        try {
            const phone = msg.from.endsWith('@c.us') ? msg.from.replace('@c.us', '') : msg.from;
            if (msg.body.trim().toLowerCase() === '!reset') {
                resetContextForPhone(phone);
                await msg.reply('🔄 Contexto desta conversa foi reiniciado. Envie uma nova mensagem.');
                return;
            }
            const contextId = resolveContextForPhone(phone);
            const result = await postAgentZeroMessage({ text: msg.body, context: contextId });
            if (result && result.message) {
                console.log('🤖 Agent Zero respondeu (context ' + result.context + '):', result.message);
                try { await msg.reply(result.message); } catch (e) { console.log('⚠️ Falha ao responder com mensagem Agent Zero:', e.message); }
            } else {
                console.log('ℹ️ Sem resposta do Agent Zero.');
            }
        } catch (e) { console.log('⚠️ Erro Agent Zero direct:', e.message); }
    }

    // Comandos utilitários
    if (msg.body.toLowerCase() === '!ping') { await msg.reply('🏓 Pong! Bot funcionando!'); console.log('🏓 Respondeu ping'); }
    if (msg.body.toLowerCase() === '!help') {
        const helpText = `\n🤖 *WhatsApp Bot - Comandos Disponíveis*\n\n• !ping - Teste\n• !help - Ajuda\n`; await msg.reply(helpText); console.log('📋 Enviou help');
    }
    // Encaminhar para Agent Zero interno
    if (AGZ_INTERNAL_ENABLE_DIRECT && msg.body) {
        try {
            const phone = msg.from.endsWith('@c.us') ? msg.from.replace('@c.us', '') : msg.from;
            if (msg.body.trim().toLowerCase() === '!reset') {
                resetContextForPhone(phone);
                await msg.reply('🔄 Contexto desta conversa foi reiniciado. Envie uma nova mensagem.');
                return;
            }
            const contextId = resolveContextForPhone(phone);
            const result = await postAgentZeroMessage({ text: msg.body, context: contextId });
            if (result && result.message) {
                console.log('🤖 Agent Zero respondeu (context ' + result.context + '):', result.message);
                try { await msg.reply(result.message); } catch (e) { console.log('⚠️ Falha reply Agent Zero:', e.message); }
            } else {
                console.log('ℹ️ Sem resposta do Agent Zero.');
            }
        } catch (e) { console.log('⚠️ Erro Agent Zero direct:', e.message); }
    }

    // Comandos utilitários
    if (msg.body.toLowerCase() === '!ping') { await msg.reply('🏓 Pong! Bot funcionando!'); console.log('🏓 Respondeu ping'); }
    if (msg.body.toLowerCase() === '!help') { await msg.reply('\n🤖 *WhatsApp Bot*\n• !ping\n• !help'); console.log('📋 Enviou help'); }
});

// ========================================
// ROTAS DA API REST
// ========================================

// Status do bot (estendido)
app.get('/status', (req, res) => {
    res.json({
        success: clientInitError ? false : true,
        ready: isClientReady,
        status: clientInitError ? 'init-error' : (isClientReady ? 'ready' : (didAuth ? 'authenticated' : 'connecting')),
        connState: lastConnState || null,
        message: clientInitError
            ? ('Falha inicial: ' + clientInitError.message)
            : (isClientReady
                ? 'Bot está pronto'
                : (qrCodeData
                    ? 'Escaneie o QR Code'
                    : (didAuth ? 'Autenticado. Finalizando conexão…' : 'Bot conectando...'))),
        qrRequired: !!qrCodeData && !clientInitError && !isClientReady,
        didAuth: !!didAuth,
        instancePort: PORT,
        agentZeroDirect: agzDirectEnabled && AGZ_INTERNAL_ENABLE_DIRECT,
        initError: clientInitError ? { message: clientInitError.message, stack: clientInitError.stack?.split('\n').slice(0, 5) } : null,
        timestamp: new Date().toISOString()
    });
});

// Versioned alias for status
app.get('/v1/status', (req, res) => app._router.handle({ ...req, url: '/status', method: 'GET' }, res, () => { }));

// Reiniciar cliente sem derrubar servidor
app.post('/restart-client', async (req, res) => {
    try {
        if (client && client.pupBrowser) { try { await client.pupBrowser.close(); } catch { } }
        isClientReady = false; qrCodeData = null; clientInitError = null;
        createClient();
        client.initialize().catch(err => { clientInitError = err; console.error('❌ Erro init pós-restart:', err.message); });
        res.json({ ok: true, restarting: true });
    } catch (e) {
        clientInitError = e;
        res.status(500).json({ ok: false, error: e.message });
    }
});

// Toggle runtime Agent Zero direct integration (não persiste reinício)
app.get('/agent-zero/direct', (req, res) => {
    res.json({ enabled: agzDirectEnabled && AGZ_INTERNAL_ENABLE_DIRECT, envEnabled: AGZ_INTERNAL_ENABLE_DIRECT });
});
app.post('/agent-zero/direct', (req, res) => {
    try {
        const desired = !!req.body.enabled;
        if (!AGZ_INTERNAL_ENABLE_DIRECT && desired) {
            return res.status(400).json({ ok: false, message: 'Env AGZ_INTERNAL_ENABLE_DIRECT=1 não habilitado; não é possível ativar.' });
        }
        agzDirectEnabled = desired;
        console.log(`⚙️ Agent Zero direct ${agzDirectEnabled ? 'ATIVADO' : 'DESATIVADO'} via API`);
        res.json({ ok: true, enabled: agzDirectEnabled });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// QR Code atual
app.get('/qr', (req, res) => {
    if (qrCodeData) {
        res.json({
            success: true,
            qr: qrCodeData,
            message: 'QR Code disponível'
        });
    } else {
        res.json({
            success: false,
            message: isClientReady ? 'Bot já conectado' : 'QR Code não disponível ainda'
        });
    }
});

// Página do QR Code - Servir arquivo HTML externo
app.get('/qr.html', (req, res) => {
    const htmlPath = path.join(__dirname, 'qr-interface.html');
    if (fs.existsSync(htmlPath)) {
        res.sendFile(htmlPath);
    } else {
        res.status(404).send('Arquivo QR interface não encontrado');
    }
});

// Rota simples também
app.get('/qr-simple.html', (req, res) => {
    const htmlPath = path.join(__dirname, 'qr-interface.html');
    if (fs.existsSync(htmlPath)) {
        res.sendFile(htmlPath);
    } else {
        res.status(404).send('Arquivo QR interface não encontrado');
    }
});

// Enviar mensagem via API
app.post('/send', async (req, res) => {
    try {
        const tenant = resolveTenant(req);
        if (!rateLimit(tenant, 'send', 40, 1)) { logger.warn('rate_limit_block', { tenant, route: 'send' }); return res.status(429).json({ success: false, message: 'Rate limit excedido' }); }
        const { sentMessage, record } = await sendUnifiedMessage({ ...req.body, tenant });
        res.json({
            success: true,
            message: 'Mensagem enviada com sucesso',
            to: record.to,
            content: record.body || record.mediaUrl || 'Mídia/Localização',
            type: record.type,
            messageId: record.id,
            timestamp: record.createdAt
        });
        console.log(`📤 (/send) Mensagem ${record.type} enviada para ${record.to}`);
    } catch (error) {
        console.error('❌ Erro ao enviar mensagem (/send):', error.message);
        res.status(error.statusCode || 500).json({
            success: false,
            message: error.userMessage || error.message
        });
    }
});

// ========================================
// NOVOS ENDPOINTS v1 (PROTÓTIPO)
// ========================================
// POST /v1/messages - novo formato (usa os mesmos campos mas aceita 'to')
app.post('/v1/messages', async (req, res) => {
    try {
        const tenant = resolveTenant(req);
        if (!rateLimit(tenant, 'v1messages', 60, 1)) { logger.warn('rate_limit_block', { tenant, route: 'v1messages' }); return res.status(429).json({ success: false, error: 'Rate limit excedido' }); }
        const payload = { ...req.body, tenant };
        if (payload.to && !payload.number) payload.number = payload.to;
        const { record } = await sendUnifiedMessage(payload);
        if (metricsEnabled) metrics.incOutbound();
        res.status(201).json({
            success: true,
            data: record
        });
        console.log(`📤 (/v1/messages) ${record.type} -> ${record.to}`);
    } catch (error) {
        res.status(error.statusCode || 500).json({
            success: false,
            error: error.userMessage || error.message
        });
    }
});

// ================= Chat Flags (pinned/archived/unread) =================
app.get('/v1/chats/flags', async (req, res) => {
    try {
        if (!isClientReady) return res.status(503).json({ success: false, message: 'Bot não está pronto' });
        const chats = await client.getChats();
        const pinned = [];
        const archived = [];
        const unread = [];
        for (const c of chats) {
            const id = c?.id?._serialized || String(c?.id || '');
            if (!id) continue;
            if (c.pinned || c.pin) pinned.push(id);
            if (c.archived || c.archive) archived.push(id);
            const uc = (typeof c.unreadCount === 'number') ? c.unreadCount : (c.unread || 0);
            if (uc > 0) unread.push(id);
        }
        res.json({ success: true, pinned, archived, unread, total: chats.length, timestamp: new Date().toISOString() });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});
// Legacy alias
app.get('/chats/flags', async (req, res) => app._router.handle({ ...req, url: '/v1/chats/flags', method: 'GET' }, res, () => { }));

// ================= Avatars =================
function normalizeChatId(raw) {
    if (!raw) return null;
    const s = String(raw);
    if (s.includes('@')) return s;
    const only = s.replace(/\D/g, '');
    if (!only) return null;
    return `${only}@c.us`;
}

app.get('/v1/contacts/:id/avatar', async (req, res) => {
    try {
        if (!isClientReady) return res.status(503).json({ success: false, message: 'Bot não está pronto' });
        const id = normalizeChatId(req.params.id);
        if (!id) return res.status(400).json({ success: false, message: 'id inválido' });
        const url = await client.getProfilePicUrl(id);
        if (!url) return res.status(404).json({ success: false, message: 'avatar_indisponivel' });
        res.json({ success: true, url, id });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});
// Fallback aliases
app.get('/contacts/:id/avatar', async (req, res) => app._router.handle({ ...req, url: `/v1/contacts/${encodeURIComponent(req.params.id)}/avatar`, method: 'GET' }, res, () => { }));
app.get('/avatar', async (req, res) => {
    try {
        if (!isClientReady) return res.status(503).json({ success: false, message: 'Bot não está pronto' });
        const id = normalizeChatId(req.query.chatId || req.query.phone);
        if (!id) return res.status(400).json({ success: false, message: 'Informe chatId ou phone' });
        const url = await client.getProfilePicUrl(id);
        if (!url) return res.status(404).json({ success: false, message: 'avatar_indisponivel' });
        res.json({ success: true, url, id });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ================= Recent Media per Chat =================
app.get('/v1/chats/:id/media', async (req, res) => {
    try {
        if (!isClientReady) return res.status(503).json({ success: false, message: 'Bot não está pronto' });
        const id = normalizeChatId(req.params.id);
        const limit = Math.max(1, Math.min(500, parseInt(req.query.limit || '32', 10)));
        if (!id) return res.status(400).json({ success: false, message: 'id inválido' });
        const chat = await client.getChatById(id);
        const msgs = await chat.fetchMessages({ limit });
        const candidates = msgs.filter(m => m.hasMedia || ['image', 'video', 'audio', 'document', 'ptt', 'sticker'].includes(m.type));
        const media = candidates.map(m => ({
            id: m?.id?._serialized || String(m?.id || ''),
            type: m.type || null,
            timestamp: m.timestamp || m._data?.t || null,
            mimetype: m.mimetype || m._data?.mimetype || null,
            directPath: m._data?.directPath || null,
            mediaKey: m._data?.mediaKey || null,
            filehash: m._data?.filehash || null,
            size: m._data?.size || null,
            caption: m.caption || m.body || null
        }));
        res.json({ success: true, media, total: media.length });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});
// Aliases
app.get('/chats/:id/media', async (req, res) => app._router.handle({ ...req, url: `/v1/chats/${encodeURIComponent(req.params.id)}/media${req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''}`, method: 'GET' }, res, () => { }));
app.get('/v1/media', async (req, res) => {
    if (!req.query.chatId) return res.status(400).json({ success: false, message: 'chatId é obrigatório' });
    // Delegate to /v1/chats/:id/media
    const id = encodeURIComponent(req.query.chatId);
    const q = Object.entries(req.query).filter(([k]) => k !== 'chatId').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const url = `/v1/chats/${id}/media${q ? ('?' + q) : ''}`;
    return app._router.handle({ ...req, url, method: 'GET' }, res, () => { });
});

// ================= Avatar Proxy (stream image) =================
app.get('/v1/contacts/:id/avatar/raw', async (req, res) => {
    try {
        if (!isClientReady) return res.status(503).json({ success: false, message: 'Bot não está pronto' });
        const id = normalizeChatId(req.params.id);
        if (!id) return res.status(400).json({ success: false, message: 'id inválido' });
        const url = await client.getProfilePicUrl(id);
        if (!url) return res.status(404).json({ success: false, message: 'avatar_indisponivel' });
        const resp = await axios.get(url, { responseType: 'arraybuffer' });
        const contentType = resp.headers['content-type'] || 'image/jpeg';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.send(Buffer.from(resp.data));
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});
// Aliases
app.get('/contacts/:id/avatar/raw', async (req, res) => app._router.handle({ ...req, url: `/v1/contacts/${encodeURIComponent(req.params.id)}/avatar/raw`, method: 'GET' }, res, () => { }));
app.get('/avatar/raw', async (req, res) => {
    try {
        if (!isClientReady) return res.status(503).json({ success: false, message: 'Bot não está pronto' });
        const id = normalizeChatId(req.query.chatId || req.query.phone);
        if (!id) return res.status(400).json({ success: false, message: 'Informe chatId ou phone' });
        const url = await client.getProfilePicUrl(id);
        if (!url) return res.status(404).json({ success: false, message: 'avatar_indisponivel' });
        const resp = await axios.get(url, { responseType: 'arraybuffer' });
        const contentType = resp.headers['content-type'] || 'image/jpeg';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.send(Buffer.from(resp.data));
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ================= Message Media Download (by message id) =================
async function findMessageByIdFlexible(messageId, chatId) {
    // Try native method if available
    if (client && typeof client.getMessageById === 'function') {
        try { const msg = await client.getMessageById(messageId); if (msg) return msg; } catch { /* ignore */ }
    }
    // Fallback: if chatId provided, scan recent messages
    if (chatId) {
        try {
            const cid = normalizeChatId(chatId);
            const chat = await client.getChatById(cid);
            const msgs = await chat.fetchMessages({ limit: 256 });
            const target = msgs.find(m => (m?.id?._serialized === messageId) || (String(m?.id || '') === messageId));
            if (target) return target;
        } catch { /* ignore */ }
    }
    return null;
}

app.get('/v1/messages/:id/media', async (req, res) => {
    try {
        if (!isClientReady) return res.status(503).json({ success: false, message: 'Bot não está pronto' });
        const mid = String(req.params.id);
        const chatId = req.query.chatId;
        const msg = await findMessageByIdFlexible(mid, chatId);
        if (!msg) return res.status(404).json({ success: false, message: 'Mensagem não encontrada' });
        if (!msg.downloadMedia || (!msg.hasMedia && !['image', 'video', 'audio', 'document', 'ptt', 'sticker'].includes(msg.type))) {
            return res.status(400).json({ success: false, message: 'Mensagem não contém mídia' });
        }
        const media = await msg.downloadMedia(); // returns { data (base64), mimetype, filename, filesize }
        if (!media || !media.data) return res.status(404).json({ success: false, message: 'Mídia indisponível' });
        const buf = Buffer.from(media.data, 'base64');
        const mimetype = media.mimetype || 'application/octet-stream';
        const filename = media.filename || `${mid}`;
        const forceDownload = req.query.download === '1' || req.query.download === 'true';
        res.setHeader('Content-Type', mimetype);
        res.setHeader('Content-Length', buf.length);
        res.setHeader('Cache-Control', 'private, max-age=600');
        res.setHeader('Content-Disposition', `${forceDownload ? 'attachment' : 'inline'}; filename="${filename}"`);
        res.send(buf);
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});
// Alias
app.get('/messages/:id/media', async (req, res) => app._router.handle({ ...req, url: `/v1/messages/${encodeURIComponent(req.params.id)}/media${req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''}`, method: 'GET' }, res, () => { }));

// ================= Chat Actions: mute/unmute, archive/unarchive, pin/unpin, mark seen =================
async function getChatOr404(chatIdRaw, res) {
    try {
        const id = normalizeChatId(chatIdRaw);
        if (!id) { res.status(400).json({ success: false, message: 'chatId inválido' }); return null; }
        const chat = await client.getChatById(id);
        return chat;
    } catch (e) {
        res.status(404).json({ success: false, message: 'Chat não encontrado' });
        return null;
    }
}

function actionOk(res, extra = {}) { res.json({ success: true, ...extra }); }

// Mute
app.post('/mute-chat', async (req, res) => {
    try {
        if (!isClientReady) return res.status(503).json({ success: false, message: 'Bot não está pronto' });
        const chat = await getChatOr404(req.body.chatId, res); if (!chat) return;
        const duration = req.body.duration != null ? parseInt(req.body.duration, 10) : null;
        const until = duration && duration > 0 ? new Date(Date.now() + duration) : undefined;
        const result = await chat.mute(until);
        actionOk(res, { chatId: chat.id?._serialized, isMuted: result?.isMuted ?? true, muteExpiration: result?.muteExpiration ?? null });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
app.post('/v1/mute-chat', async (req, res) => app._router.handle({ ...req, url: '/mute-chat', method: 'POST' }, res, () => { }));

// Unmute
app.post('/unmute-chat', async (req, res) => {
    try {
        if (!isClientReady) return res.status(503).json({ success: false, message: 'Bot não está pronto' });
        const chat = await getChatOr404(req.body.chatId, res); if (!chat) return;
        const result = await chat.unmute();
        actionOk(res, { chatId: chat.id?._serialized, isMuted: result?.isMuted ?? false, muteExpiration: result?.muteExpiration ?? null });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
app.post('/v1/unmute-chat', async (req, res) => app._router.handle({ ...req, url: '/unmute-chat', method: 'POST' }, res, () => { }));

// Archive
app.post('/archive-chat', async (req, res) => {
    try {
        if (!isClientReady) return res.status(503).json({ success: false, message: 'Bot não está pronto' });
        const chat = await getChatOr404(req.body.chatId, res); if (!chat) return;
        await chat.archive();
        actionOk(res, { chatId: chat.id?._serialized, archived: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
app.post('/v1/archive-chat', async (req, res) => app._router.handle({ ...req, url: '/archive-chat', method: 'POST' }, res, () => { }));

// Unarchive
app.post('/unarchive-chat', async (req, res) => {
    try {
        if (!isClientReady) return res.status(503).json({ success: false, message: 'Bot não está pronto' });
        const chat = await getChatOr404(req.body.chatId, res); if (!chat) return;
        await chat.unarchive();
        actionOk(res, { chatId: chat.id?._serialized, archived: false });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
app.post('/v1/unarchive-chat', async (req, res) => app._router.handle({ ...req, url: '/unarchive-chat', method: 'POST' }, res, () => { }));

// Pin
app.post('/pin-chat', async (req, res) => {
    try {
        if (!isClientReady) return res.status(503).json({ success: false, message: 'Bot não está pronto' });
        const chat = await getChatOr404(req.body.chatId, res); if (!chat) return;
        const pinned = await chat.pin();
        actionOk(res, { chatId: chat.id?._serialized, pinned: !!pinned });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
app.post('/v1/pin-chat', async (req, res) => app._router.handle({ ...req, url: '/pin-chat', method: 'POST' }, res, () => { }));

// Unpin
app.post('/unpin-chat', async (req, res) => {
    try {
        if (!isClientReady) return res.status(503).json({ success: false, message: 'Bot não está pronto' });
        const chat = await getChatOr404(req.body.chatId, res); if (!chat) return;
        const pinned = await chat.unpin();
        actionOk(res, { chatId: chat.id?._serialized, pinned: !!pinned });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
app.post('/v1/unpin-chat', async (req, res) => app._router.handle({ ...req, url: '/unpin-chat', method: 'POST' }, res, () => { }));

// Mark seen (idempotent/safe)
app.post('/mark-seen', async (req, res) => {
    try {
        if (!isClientReady) return res.status(503).json({ success: false, message: 'Bot não está pronto' });
        const chat = await getChatOr404(req.body.chatId, res); // valida e normaliza
        if (!chat) return; // getChatOr404 já respondeu 4xx adequado
        const id = chat.id?._serialized;
        try {
            // Algumas instalações podem falhar com sendSeen em casos específicos; trate como no-op
            await client.sendSeen(id);
            return actionOk(res, { chatId: id });
        } catch (err) {
            // Evita 500 ruidoso no front; responde 200 com sucesso=false para ser tratado como "noop"
            return res.json({ success: false, chatId: id, message: 'sendSeen falhou', error: String(err?.message || err) });
        }
    } catch (e) {
        // Quaisquer outros erros inesperados
        res.status(500).json({ success: false, message: e.message });
    }
});
app.post('/v1/mark-seen', async (req, res) => app._router.handle({ ...req, url: '/mark-seen', method: 'POST' }, res, () => { }));

// ================= Search aliases (POST) to match UI adapter =================
app.post('/search-messages', (req, res) => {
    try {
        const tenant = resolveTenant(req);
        const { messages: messagesStore } = getStores(tenant);
        const { query, chatId, type, limit = 100 } = req.body || {};
        if (!query) return res.status(400).json({ success: false, message: 'Parâmetro query é obrigatório' });
        let results = messagesStore.filter(m => m.body && m.body.toLowerCase().includes(String(query).toLowerCase()));
        if (chatId) {
            const cid = String(chatId).replace(/\D/g, '');
            results = results.filter(m => (m.from && m.from.startsWith(cid)) || (m.to && m.to.startsWith(cid)));
        }
        if (type) results = results.filter(m => m.type === type);
        const limited = results.slice(-Number(limit)).reverse();
        res.json({ success: true, total: limited.length, data: limited });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});
app.post('/v1/search-messages', async (req, res) => app._router.handle({ ...req, url: '/search-messages', method: 'POST' }, res, () => { }));

// Expor limites atuais (DEBUG / Observabilidade Inicial)
app.get('/v1/limits', (req, res) => {
    const tenant = resolveTenant(req);
    res.json({ success: true, tenant, limits: snapshotLimits(tenant) });
});

// GET /v1/messages - listagem simples com filtros básicos in-memory
app.get('/v1/messages', (req, res) => {
    const tenant = resolveTenant(req);
    const { messages: messagesStore } = getStores(tenant);
    const { type, to, limit = 50 } = req.query;
    let results = messagesStore;
    if (type) results = results.filter(m => m.type === type);
    if (to) {
        const target = to.includes('@c.us') ? to : `${to.replace(/\D/g, '')}@c.us`;
        results = results.filter(m => m.to === target);
    }
    const limited = results.slice(-Number(limit)).reverse();
    res.json({ success: true, total: limited.length, data: limited });
});

// GET /v1/messages/:id - detalhe
app.get('/v1/messages/:id', (req, res) => {
    const tenant = resolveTenant(req);
    const found = getMessage(tenant, req.params.id);
    if (!found) return res.status(404).json({ success: false, message: 'Mensagem não encontrada' });
    res.json({ success: true, data: found });
});

// PUT /v1/messages/:id/status (apenas altera status manualmente neste protótipo)
app.put('/v1/messages/:id/status', (req, res) => {
    const tenant = resolveTenant(req);
    const { messages: messagesStore } = getStores(tenant);
    const { status } = req.body;
    const allowed = ['queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'received'];
    if (!allowed.includes(status)) return res.status(400).json({ success: false, message: 'Status inválido' });
    const found = messagesStore.find(m => m.id === req.params.id);
    if (!found) return res.status(404).json({ success: false, message: 'Mensagem não encontrada' });
    found.status = status;
    found.updatedAt = new Date().toISOString();
    triggerWebhooks('message_status_updated', { message: found }, tenant);
    res.json({ success: true, data: found });
});

// ================= Contatos (CRM Básico) =================
app.get('/v1/contacts', (req, res) => {
    const tenant = resolveTenant(req);
    const { contacts: contactsStore } = getStores(tenant);
    const { tag, q, limit = 100 } = req.query;
    let list = contactsStore;
    if (tag) list = list.filter(c => c.tags.includes(tag));
    if (q) list = list.filter(c => (c.id.includes(q) || (c.displayName || '').toLowerCase().includes(q.toLowerCase())));
    res.json({ success: true, total: Math.min(list.length, limit), data: list.slice(0, Number(limit)) });
});

app.post('/v1/contacts', (req, res) => {
    const tenant = resolveTenant(req);
    const { phone, name } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: 'phone é obrigatório' });
    const contact = upsertContactFromPhone(phone, name || null, null, tenant);
    res.status(201).json({ success: true, data: contact });
});

app.get('/v1/contacts/:id', (req, res) => {
    const tenant = resolveTenant(req);
    const { contacts: contactsStore } = getStores(tenant);
    const c = contactsStore.find(ct => ct.id === req.params.id);
    if (!c) return res.status(404).json({ success: false, message: 'Contato não encontrado' });
    res.json({ success: true, data: c });
});

app.put('/v1/contacts/:id', (req, res) => {
    const tenant = resolveTenant(req);
    const { contacts: contactsStore } = getStores(tenant);
    const c = contactsStore.find(ct => ct.id === req.params.id);
    if (!c) return res.status(404).json({ success: false, message: 'Contato não encontrado' });
    const { name, tags, custom } = req.body;
    if (name !== undefined) c.displayName = name;
    if (Array.isArray(tags)) c.tags = Array.from(new Set(tags));
    if (custom && typeof custom === 'object') c.custom = { ...c.custom, ...custom };
    c.updatedAt = new Date().toISOString();
    res.json({ success: true, data: c });
});

// ================= Message Annotations (IA / CRM) =================
app.post('/v1/messages/:id/annotations', (req, res) => {
    const tenant = resolveTenant(req);
    const { annotations: messageAnnotationsStore } = getStores(tenant);
    const msgObj = getMessage(tenant, req.params.id);
    if (!msgObj) return res.status(404).json({ success: false, message: 'Mensagem não encontrada' });
    const { sentiment = null, intent = null, categories = [], score = null, metadata = {} } = req.body || {};
    const annotation = { id: crypto.randomUUID(), messageId: msgObj.id, sentiment, intent, categories, score, metadata, createdAt: new Date().toISOString() };
    messageAnnotationsStore.push(annotation);
    if (!msgObj.annotations) msgObj.annotations = [];
    msgObj.annotations.push(annotation.id);
    triggerWebhooks('message_annotated', { annotation }, tenant);
    res.status(201).json({ success: true, data: annotation });
});

app.get('/v1/messages/:id/annotations', (req, res) => {
    const tenant = resolveTenant(req);
    const { annotations: messageAnnotationsStore } = getStores(tenant);
    const list = messageAnnotationsStore.filter(a => a.messageId === req.params.id);
    res.json({ success: true, total: list.length, data: list });
});

// ================= Conversas (agrupamento simples por contato) =================
app.get('/v1/conversations', (req, res) => {
    const tenant = resolveTenant(req);
    const { messages: messagesStore } = getStores(tenant);
    const map = new Map();
    for (const m of messagesStore) {
        const contactId = m.direction === 'inbound' ? (m.from?.replace('@c.us', '')) : (m.to?.replace('@c.us', ''));
        if (!contactId) continue;
        if (!map.has(contactId)) map.set(contactId, { contactId, messages: 0, lastMessageAt: m.createdAt });
        const conv = map.get(contactId);
        conv.messages += 1;
        if (new Date(m.createdAt) > new Date(conv.lastMessageAt)) conv.lastMessageAt = m.createdAt;
    }
    const conversations = Array.from(map.values()).sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
    res.json({ success: true, total: conversations.length, data: conversations });
});

app.get('/v1/conversations/:contactId/messages', (req, res) => {
    const tenant = resolveTenant(req);
    const { messages: messagesStore } = getStores(tenant);
    const id = req.params.contactId.replace(/\D/g, '');
    const msgs = messagesStore.filter(m => (m.from && m.from.startsWith(id)) || (m.to && m.to.startsWith(id))).slice(-200);
    res.json({ success: true, total: msgs.length, data: msgs });
});

// ================= Busca de Mensagens =================
app.get('/v1/messages/search', (req, res) => {
    const tenant = resolveTenant(req);
    const { messages: messagesStore } = getStores(tenant);
    const { q, contact, type, limit = 100 } = req.query;
    if (!q) return res.status(400).json({ success: false, message: 'Parâmetro q é obrigatório' });
    let results = messagesStore.filter(m => m.body && m.body.toLowerCase().includes(q.toLowerCase()));
    if (contact) {
        const cid = contact.replace(/\D/g, '');
        results = results.filter(m => (m.from && m.from.startsWith(cid)) || (m.to && m.to.startsWith(cid)));
    }
    if (type) results = results.filter(m => m.type === type);
    results = results.slice(-Number(limit)).reverse();
    res.json({ success: true, total: results.length, data: results });
});

// ================= Unread Counts per Chat =================
// Returns map of chat id -> unreadCount using whatsapp-web.js getChats()
app.get('/v1/chats/unread-counts', async (req, res) => {
    try {
        if (!isClientReady) return res.status(503).json({ success: false, message: 'Bot não está pronto' });
        const chats = await client.getChats();
        const counts = {};
        let totalUnread = 0;
        for (const c of chats) {
            const id = c?.id?._serialized || String(c?.id || '');
            if (!id) continue;
            const uc = (typeof c.unreadCount === 'number') ? c.unreadCount : (c.unread || 0);
            if (uc > 0) { counts[id] = uc; totalUnread += uc; }
        }
        res.json({ success: true, counts, totalUnread, totalChats: chats.length, timestamp: new Date().toISOString() });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ================= Unified Global Search =================
// GET /v1/search?q=...&phone=...&tag=...&has=media|image|video|audio|document&type=text|image|...&before=ISO|epoch&after=ISO|epoch&limit=50&offset=0&sort=recent|recente|old|antigo|asc|desc
// Searches in-memory stores (contacts, messages). Returns grouped results.
app.get('/v1/search', (req, res) => {
    try {
        const tenant = resolveTenant(req);
        const { contacts: contactsStore, messages: messagesStore, indexes } = getStores(tenant);
        const q = (req.query.q || '').toString().trim().toLowerCase();
        const phone = (req.query.phone || req.query.contact || '').toString().replace(/\D/g, '');
        const tag = (req.query.tag || '').toString().trim().toLowerCase();
        const hasParam = (req.query.has || '').toString().trim().toLowerCase();
        const type = (req.query.type || '').toString().trim().toLowerCase();
        const limit = Math.max(1, Math.min(500, parseInt(req.query.limit || '50', 10)));
        const offset = Math.max(0, parseInt(req.query.offset || '0', 10));
        const sortRaw = (req.query.sort || 'recent').toString().toLowerCase();
        const sortDesc = ['recent', 'recente', 'desc', 'newest'].includes(sortRaw);
        const sortAsc = ['antigo', 'old', 'asc', 'oldest'].includes(sortRaw);
        const beforeRaw = req.query.before ? String(req.query.before) : null;
        const afterRaw = req.query.after ? String(req.query.after) : null;
        const beforeTs = beforeRaw ? (isNaN(Number(beforeRaw)) ? Date.parse(beforeRaw) : Number(beforeRaw)) : null;
        const afterTs = afterRaw ? (isNaN(Number(afterRaw)) ? Date.parse(afterRaw) : Number(afterRaw)) : null;

        // Contacts search (use index when possible)
        let contacts = contactsStore;
        if (phone && indexes?.contactsById?.has(phone)) {
            contacts = [indexes.contactsById.get(phone)];
        } else {
            if (phone) contacts = contacts.filter(c => c.id.includes(phone));
            if (q) contacts = contacts.filter(c => (c.id.includes(q) || (c.displayName || '').toLowerCase().includes(q)));
        }
        if (tag) contacts = contacts.filter(c => (Array.isArray(c.tags) && c.tags.map(t => String(t).toLowerCase()).includes(tag)));

        // Messages search (use indices for phone/type when available)
        const wantsMedia = hasParam && (hasParam === 'media' || ['image', 'video', 'audio', 'document', 'ptt', 'sticker'].includes(hasParam));
        let candidateIds = null;
        if (phone && indexes?.messagesByChatId?.has(phone)) candidateIds = new Set(indexes.messagesByChatId.get(phone));
        if ((type || wantsMedia) && indexes?.messagesByType) {
            const t = type || (hasParam !== 'media' ? hasParam : null);
            if (t && indexes.messagesByType.has(t)) {
                const typeSet = new Set(indexes.messagesByType.get(t));
                candidateIds = candidateIds ? new Set([...candidateIds].filter(id => typeSet.has(id))) : typeSet;
            }
        }
        let messages = candidateIds ? [...candidateIds].map(id => indexes.messageById.get(id)).filter(Boolean) : messagesStore;
        if (q) messages = messages.filter(m => (m.body && String(m.body).toLowerCase().includes(q)));
        if (type) messages = messages.filter(m => String(m.type || '').toLowerCase() === type);
        if (wantsMedia) {
            if (hasParam === 'media') {
                messages = messages.filter(m => ['image', 'video', 'audio', 'document', 'ptt', 'sticker'].includes(String(m.type || '').toLowerCase()));
            } else {
                messages = messages.filter(m => String(m.type || '').toLowerCase() === hasParam);
            }
        }
        if (afterTs != null) messages = messages.filter(m => Date.parse(m.createdAt || m.timestamp || 0) >= afterTs);
        if (beforeTs != null) messages = messages.filter(m => Date.parse(m.createdAt || m.timestamp || 0) <= beforeTs);

        // Sort and paginate
        messages = messages.sort((a, b) => {
            const at = new Date(a.createdAt || a.timestamp || 0).getTime();
            const bt = new Date(b.createdAt || b.timestamp || 0).getTime();
            if (sortAsc) return at - bt;
            // default to desc
            return bt - at;
        });
        const totalMessages = messages.length;
        const pagedMessages = messages.slice(offset, offset + limit);

        // Media results are subset of messages that have media types
        const media = pagedMessages.filter(m => ['image', 'video', 'audio', 'document', 'ptt', 'sticker'].includes(String(m.type || '').toLowerCase()))
            .map(m => ({ id: m.id, type: m.type, createdAt: m.createdAt || m.timestamp || null, chatId: (m.direction === 'inbound' ? m.from : m.to) || null }));

        // Normalize outputs
        const outContacts = contacts.slice(0, 100).map(c => ({ id: c.id, name: c.displayName || c.name || null, tags: c.tags || [], lastInteractionAt: c.lastInteractionAt || c.updatedAt || null, inboundCount: c.inboundCount || 0, outboundCount: c.outboundCount || 0 }));
        const outMessages = pagedMessages.map(m => ({ id: m.id, body: m.body || null, type: m.type || 'text', createdAt: m.createdAt || m.timestamp || null, direction: m.direction || null, chatId: (m.direction === 'inbound' ? m.from : m.to) || null }));

        // Facets: quick counts for types and has:media
        const facetTypes = ['text', 'image', 'video', 'audio', 'document', 'ptt', 'sticker'];
        const facets = { byType: {}, hasMedia: 0 };
        for (const t of facetTypes) { facets.byType[t] = 0; }
        for (const m of messages) {
            const t = String(m.type || '').toLowerCase();
            if (facets.byType.hasOwnProperty(t)) facets.byType[t] += 1; else facets.byType[t] = 1;
            if (['image', 'video', 'audio', 'document', 'ptt', 'sticker'].includes(t)) facets.hasMedia += 1;
        }

        res.json({
            success: true,
            query: { q, phone, tag, has: hasParam || null, type: type || null, before: beforeRaw || null, after: afterRaw || null, sort: (sortAsc ? 'asc' : 'desc'), limit, offset },
            total: { contacts: contacts.length, messages: totalMessages, media: media.length },
            facets,
            contacts: outContacts,
            messages: outMessages,
            media
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ================= Cursor-based Global Search =================
// GET /v1/search-cursor?cursor=...&limit=50&q=...&phone=...&has=media|image|video|audio|document|ptt|sticker&type=text|image|...&before=ISO|epoch&after=ISO|epoch&sort=recent|recente|old|antigo|asc|desc
// Uses persistence helper to paginate deterministically across filtered candidates.
app.get('/v1/search-cursor', (req, res) => {
    try {
        const tenant = resolveTenant(req);
        const { indexes, messages: messagesStore } = getStores(tenant);
        if (!persist || !persist.searchWithCursorInMemory) {
            return res.status(501).json({ success: false, message: 'Cursor search not available' });
        }

        const q = (req.query.q || '').toString().trim().toLowerCase();
        const phone = (req.query.phone || req.query.contact || '').toString().replace(/\D/g, '');
        const hasParam = (req.query.has || '').toString().trim().toLowerCase();
        const type = (req.query.type || '').toString().trim().toLowerCase();
        const limit = Math.max(1, Math.min(500, parseInt(req.query.limit || '50', 10)));
        const cursor = req.query.cursor ? String(req.query.cursor) : null;
        const beforeRaw = req.query.before ? String(req.query.before) : null;
        const afterRaw = req.query.after ? String(req.query.after) : null;
        const sortRaw = (req.query.sort || 'recent').toString().toLowerCase();
        const sortOrder = ['antigo', 'old', 'asc', 'oldest'].includes(sortRaw) ? 'asc' : 'desc';
        const beforeTs = beforeRaw ? (isNaN(Number(beforeRaw)) ? Date.parse(beforeRaw) : Number(beforeRaw)) : null;
        const afterTs = afterRaw ? (isNaN(Number(afterRaw)) ? Date.parse(afterRaw) : Number(afterRaw)) : null;

        const wantsMedia = hasParam && (hasParam === 'media' || ['image', 'video', 'audio', 'document', 'ptt', 'sticker'].includes(hasParam));

        // Base candidate IDs from indices for efficiency
        let baseIds = null; // Set of ids
        if (phone && indexes?.messagesByChatId?.has(phone)) {
            baseIds = new Set(indexes.messagesByChatId.get(phone));
        }
        if ((type || wantsMedia) && indexes?.messagesByType) {
            const t = type || (hasParam !== 'media' ? hasParam : null);
            if (t && indexes.messagesByType.has(t)) {
                const typeSet = new Set(indexes.messagesByType.get(t));
                baseIds = baseIds ? new Set([...baseIds].filter(id => typeSet.has(id))) : typeSet;
            }
        }
        if (!baseIds) {
            // all messages as baseline
            baseIds = new Set(indexes?.messageById ? indexes.messageById.keys() : messagesStore.map(m => m.id));
        }

        // Apply non-indexable filters (q/body substring, time range, exact media when has=media)
        const filteredIds = new Set();
        for (const id of baseIds) {
            const m = indexes?.messageById?.get(id);
            if (!m) continue;
            if (q && !(m.body && String(m.body).toLowerCase().includes(q))) continue;
            if (hasParam && hasParam !== 'media') {
                if (String(m.type || '').toLowerCase() !== hasParam) continue;
            }
            if (wantsMedia && hasParam === 'media') {
                const t = String(m.type || '').toLowerCase();
                if (!['image', 'video', 'audio', 'document', 'ptt', 'sticker'].includes(t)) continue;
            }
            const ts = Date.parse(m.createdAt || m.timestamp || 0);
            if (afterTs != null && !(ts >= afterTs)) continue;
            if (beforeTs != null && !(ts <= beforeTs)) continue;
            filteredIds.add(id);
        }

        const { items, nextCursor, total } = persist.searchWithCursorInMemory(tenant, filteredIds, { limit, cursor, sort: sortOrder });
        const out = items.map(m => ({ id: m.id, body: m.body || null, type: m.type || 'text', createdAt: m.createdAt || m.timestamp || null, direction: m.direction || null, chatId: (m.direction === 'inbound' ? m.from : m.to) || null }));
        return res.json({ success: true, total, limit, cursor: cursor || null, nextCursor, sort: sortOrder, messages: out });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ================= Analytics Básico =================
app.get('/v1/analytics/overview', (req, res) => {
    const tenant = resolveTenant(req);
    const { messages: messagesStore, contacts: contactsStore } = getStores(tenant);
    const now = Date.now();
    const last24h = now - 24 * 60 * 60 * 1000;
    const msgs24 = messagesStore.filter(m => new Date(m.createdAt).getTime() >= last24h);
    const inbound = msgs24.filter(m => m.direction === 'inbound').length;
    const outbound = msgs24.filter(m => m.direction === 'outbound').length;
    const uniqueContacts = new Set(msgs24.map(m => (m.from || '').replace('@c.us', '') || (m.to || '').replace('@c.us', ''))).size;
    const deliveryRate = (() => {
        const sent = messagesStore.filter(m => m.direction === 'outbound').length;
        const delivered = messagesStore.filter(m => m.status === 'delivered').length;
        if (!sent) return 0; return +(delivered / sent * 100).toFixed(2);
    })();
    res.json({ success: true, data: { last24h: { inbound, outbound, total: inbound + outbound, uniqueContacts }, totals: { contacts: contactsStore.length, messages: messagesStore.length }, deliveryRate } });
});

app.get('/v1/analytics/contacts/top', (req, res) => {
    const tenant = resolveTenant(req);
    const { contacts: contactsStore } = getStores(tenant);
    const ranked = contactsStore.map(c => ({ id: c.id, displayName: c.displayName, total: c.inboundCount + c.outboundCount, inbound: c.inboundCount, outbound: c.outboundCount, lastInteractionAt: c.lastInteractionAt }))
        .sort((a, b) => b.total - a.total)
        .slice(0, Number(req.query.limit || 20));
    res.json({ success: true, total: ranked.length, data: ranked });
});

// ================= Eventos =================
app.get('/v1/events', (req, res) => {
    const tenant = resolveTenant(req);
    const { events: eventsStore } = getStores(tenant);
    const { type, limit = 100 } = req.query;
    let list = eventsStore;
    if (type) list = list.filter(e => e.type === type);
    const data = list.slice(-Number(limit)).reverse();
    res.json({ success: true, total: data.length, data });
});

// ================= Webhooks Avançados =================
app.post('/v1/webhooks', (req, res) => {
    const tenant = resolveTenant(req);
    const { webhooks: webhooksStore } = getStores(tenant);
    const { url, secret, events } = req.body;
    if (!url || !secret) return res.status(400).json({ success: false, message: 'url e secret são obrigatórios' });
    const id = crypto.randomUUID();
    webhooksStore.push({ id, url, secret, events: Array.isArray(events) ? events : [], active: true, createdAt: new Date().toISOString() });
    res.status(201).json({ success: true, data: { id, url } });
});

app.get('/v1/webhooks', (req, res) => {
    const tenant = resolveTenant(req);
    const { webhooks: webhooksStore } = getStores(tenant);
    res.json({ success: true, total: webhooksStore.length, data: webhooksStore.map(w => ({ ...w, secret: undefined })) });
});

app.delete('/v1/webhooks/:id', (req, res) => {
    const tenant = resolveTenant(req);
    const { webhooks: webhooksStore } = getStores(tenant);
    const idx = webhooksStore.findIndex(w => w.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, message: 'Webhook não encontrado' });
    webhooksStore.splice(idx, 1);
    res.json({ success: true });
});

app.post('/v1/webhooks/test', (req, res) => {
    const tenant = resolveTenant(req);
    const { webhooks: webhooksStore } = getStores(tenant);
    const { id, event = 'test_event' } = req.body;
    const w = webhooksStore.find(w => w.id === id);
    if (!w) return res.status(404).json({ success: false, message: 'Webhook não encontrado' });
    triggerWebhooks(event, { test: true }, tenant);
    res.json({ success: true, message: 'Evento de teste disparado' });
});

// Histórico de entregas de um webhook (últimos 50)
app.get('/v1/webhooks/:id/deliveries', (req, res) => {
    const tenant = resolveTenant(req);
    const { id } = req.params;
    // Filtra por webhook e tenant
    const deliveries = webhookDeliveriesStore
        .filter(d => d.webhookId === id && d.tenantId === tenant)
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(0, 50);
    res.json({ success: true, total: deliveries.length, data: deliveries });
});

// Metrics endpoint
app.get('/metrics', async (_req, res) => {
    if (!metricsEnabled) return res.status(503).send('metrics_disabled');
    try {
        res.set('Content-Type', metrics.register.contentType);
        res.end(await metrics.register.metrics());
    } catch (e) {
        res.status(500).send('metrics_error');
    }
});

// Lightweight health check for dev scripts
app.get('/health', (_req, res) => {
    try {
        res.json({ success: true, status: isClientReady ? 'ready' : 'starting', timestamp: new Date().toISOString() });
    } catch {
        res.status(500).json({ success: false });
    }
});

// Versioned alias for health
app.get('/v1/health', (req, res) => app._router.handle({ ...req, url: '/health', method: 'GET' }, res, () => { }));

// ================= Canais / Multicanal (Protótipo) =================
app.get('/v1/channels', (req, res) => {
    const tenant = resolveTenant(req);
    const { channels: channelsStore } = getStores(tenant);
    res.json({ success: true, total: channelsStore.length, data: channelsStore });
});

app.get('/v1/channels/:id', (req, res) => {
    const tenant = resolveTenant(req);
    const { channels: channelsStore } = getStores(tenant);
    const ch = channelsStore.find(c => c.id === req.params.id);
    if (!ch) return res.status(404).json({ success: false, message: 'Canal não encontrado' });
    res.json({ success: true, data: ch });
});

// Placeholder: criação de novos canais ainda não suportada (multi-instância futura)
app.post('/v1/channels', (_req, res) => {
    res.status(501).json({ success: false, message: 'Criação dinâmica de canais não implementada neste protótipo' });
});

// Webhook para receber dados externos
app.post('/webhook', async (req, res) => {
    try {
        const { target, message, data } = req.body;

        let responseMessage = 'Webhook processado';

        if (target && message && isClientReady) {
            const formattedNumber = target.includes('@c.us') ? target : `${target.replace(/\D/g, '')}@c.us`;

            let fullMessage = message;
            if (data) {
                fullMessage += '\n\n📊 Dados adicionais:\n' + JSON.stringify(data, null, 2);
            }

            await client.sendMessage(formattedNumber, fullMessage);
            responseMessage = 'Webhook processado e mensagem enviada';
            console.log(`📧 Webhook enviado para ${formattedNumber}: ${message}`);
        }

        res.json({
            success: true,
            message: responseMessage,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro no webhook:', error);
        res.status(500).json({
            success: false,
            message: 'Erro no processamento do webhook',
            error: error.message
        });
    }
});

// Listar chats
app.get('/chats', async (req, res) => {
    try {
        if (!isClientReady) {
            // Prefer a graceful response to keep frontend stable
            return res.status(200).json({ success: false, chats: [], total: 0, reason: 'not-ready' });
        }

        const chats = await client.getChats();
        const chatsList = chats.slice(0, 20).map(chat => ({
            id: chat?.id?._serialized,
            name: chat?.name || 'Chat',
            isGroup: !!chat?.isGroup,
            unreadCount: Number(chat?.unreadCount || 0),
            lastMessage: chat?.lastMessage ? {
                body: String(chat.lastMessage.body || '').slice(0, 200),
                timestamp: chat.lastMessage.timestamp,
                from: chat.lastMessage.from
            } : null
        }));

        return res.json({
            success: true,
            chats: chatsList,
            total: chats.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao listar chats:', error);
        // Return a stable structure with HTTP 200 to avoid frontend hard-fail
        return res.status(200).json({ success: false, chats: [], total: 0, reason: 'exception', error: String(error?.message || error) });
    }
});

// Obter informações do usuário
app.get('/info', async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(503).json({
                success: false,
                message: 'Bot não está pronto'
            });
        }

        const info = client.info;
        res.json({
            success: true,
            info: {
                wid: info.wid._serialized,
                pushname: info.pushname,
                me: info.me._serialized,
                platform: info.platform
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro ao obter informações:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao obter informações',
            error: error.message
        });
    }
});

// Página inicial
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>WhatsApp Bot API</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
                .container { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                .status { padding: 15px; margin: 20px 0; border-radius: 5px; }
                .ready { background: #d4edda; border: 1px solid #c3e6cb; color: #155724; }
                .connecting { background: #fff3cd; border: 1px solid #ffeaa7; color: #856404; }
                .btn { display: inline-block; padding: 10px 20px; background: #25D366; color: white; text-decoration: none; border-radius: 5px; margin: 5px; }
                h1 { color: #333; }
                .api-info { background: #e3f2fd; padding: 20px; border-radius: 5px; margin: 20px 0; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🤖 WhatsApp Bot API</h1>

                <div class="status ${isClientReady ? 'ready' : 'connecting'}">
                    <strong>Status:</strong> ${isClientReady ? '✅ Conectado e funcionando!' : '⏳ Conectando...'}
                </div>

                <div class="api-info">
                    <h3>🔗 Links úteis:</h3>
                    <a href="/qr.html" class="btn">📱 Ver QR Code</a>
                    <a href="/status" class="btn">📊 Status JSON</a>
                    <a href="/qr" class="btn">🔢 QR Code JSON</a>
                </div>

                <div class="api-info">
                    <h3>📡 Endpoints da API:</h3>
                    <ul>
                        <li><strong>GET /status</strong> - Status do bot</li>
                        <li><strong>GET /qr</strong> - QR Code atual</li>
                        <li><strong>POST /send</strong> - Enviar mensagem</li>
                    </ul>

                    <h3>📤 Exemplo de envio de mensagem:</h3>
                    <pre>POST /send
{
    "number": "5511999999999",
    "message": "Olá! Mensagem de teste."
}</pre>
                </div>

                <div style="margin-top: 30px; color: #666; font-size: 12px;">
                    <p>🕐 Última atualização: ${new Date().toLocaleString()}</p>
                </div>
            </div>
        </body>
        </html>
    `);
});

// ========================================
// INICIALIZAÇÃO
// ========================================

// Handlers de processo
process.on('SIGINT', async () => {
    console.log('\n🔄 Recebido SIGINT, fechando graciosamente...');
    await safeClientCleanup();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🔄 Recebido SIGTERM, fechando graciosamente...');
    await safeClientCleanup();
    process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promise rejeitada não tratada:', reason);
    console.log('🔄 Continuando execução...');
});

// Inicializar servidor
app.listen(PORT, () => {
    console.log(`\n🚀 Servidor iniciado na porta ${PORT}`);
    console.log(`🌐 Acesse: http://localhost:${PORT}`);
    console.log(`📱 QR Code: http://localhost:${PORT}/qr.html`);
    console.log(`📡 API Status: http://localhost:${PORT}/status`);
    console.log(`📅 ${new Date().toLocaleString()}\n`);
    // Fallback: registra webhook Agent Zero cedo (antes de WhatsApp estar pronto) para já começar a receber eventos de teste.
    try { ensureAgentZeroWebhook('default'); } catch (e) { /* ignore */ }
});

// Inicializar cliente WhatsApp
console.log('🔄 Inicializando WhatsApp Client...');
client.initialize().catch(error => {
    console.error('❌ Erro na inicialização do cliente:', error);
    process.exit(1);
});

module.exports = { app, client };
