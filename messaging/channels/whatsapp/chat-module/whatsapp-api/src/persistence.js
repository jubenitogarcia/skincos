/**
 * Persistence abstraction (memory or Redis) for messages, webhooks, chat flags.
 * Fallback to in-memory if Redis not configured or connection fails.
 */
const crypto = require('crypto');
let backend = 'memory';
let redis = null;
let ready = false;

// In-memory stores
const mem = {
    messages: [], // {id, from, to, timestamp, type, body, hasMedia, ack, fromMe}
    webhooks: new Map(), // id -> { id, url, events: Set }
    flags: { pinned: new Set(), archived: new Set(), muted: new Set() },
    seq: { webhook: 0 }
};

async function init() {
    const useRedis = process.env.REDIS_URL || process.env.REDIS_HOST;
    if (!useRedis) { backend = 'memory'; ready = true; return { backend }; }
    try {
        const { createClient } = require('redis');
        const url = process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || 6379}`;
        redis = createClient({ url });
        redis.on('error', (e) => console.error('[persistence] redis error', e.message));
        await redis.connect();
        backend = 'redis';
        ready = true;
        console.log('[persistence] connected to redis', url);
    } catch (e) {
        console.warn('[persistence] redis unavailable, falling back to memory:', e.message);
        backend = 'memory';
        ready = true;
    }
    return { backend };
}

function isReady() { return ready; }

// ---- Messages ----
async function saveMessage(msg) {
    if (!msg.id) return;
    if (backend === 'memory') {
        if (!mem.messages.find(m => m.id === msg.id)) mem.messages.push(msg);
        return;
    }
    const keyList = 'wa:messages';
    const keyItem = `wa:msg:${msg.id}`;
    const exists = await redis.exists(keyItem);
    if (!exists) {
        await redis.multi()
            .rPush(keyList, msg.id)
            .set(keyItem, JSON.stringify(msg), { EX: 60 * 60 * 24 * 30 }) // 30d TTL
            .exec();
    }
}

async function listMessages({ since = 0, chatId, limit = 100, cursor = 0 }) {
    limit = Math.min(limit, 500);
    if (backend === 'memory') {
        let list = mem.messages;
        if (since) list = list.filter(m => m.timestamp >= since);
        if (chatId) list = list.filter(m => (m.from === chatId || m.to === chatId));
        list.sort((a, b) => a.timestamp - b.timestamp);
        const slice = list.slice(cursor, cursor + limit);
        const nextCursor = (cursor + limit) < list.length ? cursor + limit : null;
        return { items: slice, nextCursor, total: list.length };
    }
    // redis path
    const keyList = 'wa:messages';
    const total = await redis.lLen(keyList);
    const end = Math.min(cursor + limit - 1, total - 1);
    if (cursor >= total) return { items: [], nextCursor: null, total };
    const ids = await redis.lRange(keyList, cursor, end);
    const pipeline = redis.multi();
    ids.forEach(id => pipeline.get(`wa:msg:${id}`));
    const raw = await pipeline.exec();
    let items = raw.map(r => { try { return JSON.parse(r[1]); } catch { return null; } }).filter(Boolean);
    if (since) items = items.filter(m => m.timestamp >= since);
    if (chatId) items = items.filter(m => (m.from === chatId || m.to === chatId));
    const nextCursor = (end + 1) < total ? end + 1 : null;
    return { items, nextCursor, total };
}

// ---- Webhooks ----
async function createWebhook({ url, events }) {
    if (backend === 'memory') {
        const id = String(++mem.seq.webhook);
        mem.webhooks.set(id, { id, url, events: new Set(events || []) });
        return mem.webhooks.get(id);
    }
    const id = crypto.randomUUID();
    const key = `wa:webhook:${id}`;
    const value = JSON.stringify({ id, url, events: Array.from(new Set(events || [])) });
    await redis.set(key, value);
    await redis.sAdd('wa:webhooks', id);
    return JSON.parse(value);
}

async function listWebhooks() {
    if (backend === 'memory') {
        return Array.from(mem.webhooks.values()).map(w => ({ id: w.id, url: w.url, events: Array.from(w.events) }));
    }
    const ids = await redis.sMembers('wa:webhooks');
    if (!ids.length) return [];
    const pipeline = redis.multi();
    ids.forEach(id => pipeline.get(`wa:webhook:${id}`));
    const raw = await pipeline.exec();
    return raw.map(r => { try { return JSON.parse(r[1]); } catch { return null; } }).filter(Boolean);
}

async function updateWebhook(id, { url, events }) {
    if (backend === 'memory') {
        const hook = mem.webhooks.get(id);
        if (!hook) return null;
        if (url) hook.url = url;
        if (events) hook.events = new Set(events);
        return { id: hook.id, url: hook.url, events: Array.from(hook.events) };
    }
    const key = `wa:webhook:${id}`;
    const raw = await redis.get(key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (url) obj.url = url;
    if (events) obj.events = Array.from(new Set(events));
    await redis.set(key, JSON.stringify(obj));
    return obj;
}

async function deleteWebhook(id) {
    if (backend === 'memory') {
        return mem.webhooks.delete(id);
    }
    const key = `wa:webhook:${id}`;
    const n = await redis.del(key);
    await redis.sRem('wa:webhooks', id);
    return n > 0;
}

function iterWebhooksSync() {
    if (backend === 'memory') return Array.from(mem.webhooks.values()).map(w => ({ id: w.id, url: w.url, events: w.events }));
    // For redis we return a promise to be awaited externally (dispatch can be adapted)
    return null;
}

// ---- Chat Flags ----
async function setChatFlag(chatId, flag, value) {
    const valid = ['pinned', 'archived', 'muted'];
    if (!valid.includes(flag)) return;
    if (backend === 'memory') {
        const set = mem.flags[flag];
        if (value) set.add(chatId); else set.delete(chatId);
        return;
    }
    const key = `wa:chatflags:${flag}`;
    if (value) await redis.sAdd(key, chatId); else await redis.sRem(key, chatId);
}

async function getChatFlags(chatId) {
    if (backend === 'memory') {
        return {
            pinned: mem.flags.pinned.has(chatId),
            archived: mem.flags.archived.has(chatId),
            muted: mem.flags.muted.has(chatId)
        };
    }
    const pipeline = redis.multi();
    ['pinned', 'archived', 'muted'].forEach(f => pipeline.sIsMember(`wa:chatflags:${f}`, chatId));
    const r = await pipeline.exec();
    return { pinned: !!r[0][1], archived: !!r[1][1], muted: !!r[2][1] };
}

module.exports = {
    init,
    isReady,
    saveMessage,
    listMessages,
    createWebhook,
    listWebhooks,
    updateWebhook,
    deleteWebhook,
    iterWebhooksSync,
    setChatFlag,
    getChatFlags
};
