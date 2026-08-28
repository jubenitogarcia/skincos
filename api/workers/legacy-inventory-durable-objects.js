import { normalizeUnitScope } from '../../shared/identity-contract/index.js';

const LEGACY_API_NOTIFICATIONS_REFRESH = 'NOTIFICATIONS_REFRESH';

function safeJson(value, maxLen = 45000) {
    try {
        const serialized = JSON.stringify(value ?? null);
        return serialized.length > maxLen ? `${serialized.slice(0, maxLen)}…` : serialized;
    } catch {
        return '';
    }
}

function normalizeLegacyJob(job) {
    const type = String(job?.type || '').trim().toUpperCase();
    if (!type) return { ok: false, reason: 'MISSING_TYPE' };
    if (type !== LEGACY_API_NOTIFICATIONS_REFRESH) {
        return { ok: false, reason: 'UNSUPPORTED_JOB_TYPE' };
    }

    const rawUnidade = job?.unidade;
    if (rawUnidade === undefined || rawUnidade === null || String(rawUnidade).trim() === '') {
        return { ok: true, type, unidade: null };
    }
    if (typeof rawUnidade !== 'string') {
        return { ok: false, reason: 'UNIDADE_INVALID' };
    }

    const unidade = rawUnidade.trim();
    if (unidade.length > 160) {
        return { ok: false, reason: 'UNIDADE_TOO_LONG' };
    }
    const canonicalUnidade = normalizeUnitScope(unidade);
    if (!canonicalUnidade) {
        return { ok: false, reason: 'UNIDADE_INVALID' };
    }

    return { ok: true, type, unidade: canonicalUnidade };
}

async function runLegacyInventoryJob(env, job) {
    const normalized = normalizeLegacyJob(job);
    if (!normalized.ok) throw new Error(normalized.reason);

    const service = env?.INVENTORY_LEGACY_JOBS;
    if (!service || typeof service.runNotificationsRefresh !== 'function') {
        throw new Error('INVENTORY_LEGACY_JOBS_UNAVAILABLE');
    }

    const result = await service.runNotificationsRefresh({ unidade: normalized.unidade });
    if (!result || result.ok !== true) {
        throw new Error('INVENTORY_LEGACY_JOBS_REJECTED');
    }
    return result;
}

// These class names must remain owned by API: Cloudflare associates them with
// the existing API Durable Object namespaces declared in api/wrangler.toml.
export class RateLimiter {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        this._cache = new Map();
    }

    async fetch(request) {
        const url = new URL(request.url);
        const key = url.searchParams.get('key') || 'anon';
        const limit = Math.max(1, parseInt(url.searchParams.get('limit') || '60', 10) || 60);
        const windowSec = Math.max(1, parseInt(url.searchParams.get('window') || '60', 10) || 60);
        const nowSec = Math.floor(Date.now() / 1000);
        const bucket = Math.floor(nowSec / windowSec);
        const storageKey = `rl:${key}:${bucket}`;

        const nowMs = Date.now();
        const bucketExpiresAtMs = (bucket + 2) * windowSec * 1000;

        let entry = this._cache.get(storageKey);
        if (!entry || entry.expiresAtMs <= nowMs) {
            const current = (await this.state.storage.get(storageKey)) || 0;
            entry = {
                count: Number(current) || 0,
                lastPersistAtMs: 0,
                expiresAtMs: bucketExpiresAtMs,
            };
            this._cache.set(storageKey, entry);
        }

        const next = (entry.count += 1);
        const persistEvery = Math.max(1, Math.floor(limit / 4));
        const persistIntervalMs = 15_000;
        const shouldPersist =
            next === 1 ||
            next % persistEvery === 0 ||
            next >= limit ||
            (entry.lastPersistAtMs && nowMs - entry.lastPersistAtMs >= persistIntervalMs);

        if (shouldPersist) {
            await this.state.storage.put(storageKey, next, { expirationTtl: windowSec * 2 });
            entry.lastPersistAtMs = nowMs;
        }

        if (this._cache.size > 500) {
            let scanned = 0;
            for (const [cacheKey, cacheEntry] of this._cache) {
                if (cacheEntry.expiresAtMs <= nowMs) this._cache.delete(cacheKey);
                if (++scanned >= 50) break;
            }
        }

        const allowed = next <= limit;
        return new Response(JSON.stringify({ allowed, limit, remaining: Math.max(0, limit - next) }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    }
}

export class JobQueue {
    constructor(state, env) {
        this.state = state;
        this.env = env;
    }

    async enqueue(job) {
        if (!this.env?.DB) return { enqueued: false, reason: 'DB_NOT_CONFIGURED' };

        const normalized = normalizeLegacyJob(job);
        if (!normalized.ok) return { enqueued: false, reason: normalized.reason };

        const now = new Date().toISOString();
        const payloadJson = job?.payload ? safeJson(job.payload) : null;
        const id = job?.id ? String(job.id) : `${normalized.type}:${normalized.unidade || 'ALL'}`;

        await this.env.DB.prepare(
            `INSERT OR IGNORE INTO jobs (id, type, status, unidade, payload_json, created_at)
             VALUES (?, ?, 'PENDING', ?, ?, ?)`
        )
            .bind(id, normalized.type, normalized.unidade, payloadJson, now)
            .run();

        await this.env.DB.prepare(
            `UPDATE jobs
             SET status='PENDING', created_at=?, started_at=NULL, finished_at=NULL, error=NULL, payload_json=?
             WHERE id=? AND status!='PENDING'`
        )
            .bind(now, payloadJson, id)
            .run();

        await this.state.storage.setAlarm(Date.now() + 1500);
        return { enqueued: true, id };
    }

    async processBatch(limit = 10) {
        if (!this.env?.DB) return { processed: 0, remaining: 0 };

        const rows = await this.env.DB.prepare(
            `SELECT id, type, unidade, payload_json
             FROM jobs
             WHERE status='PENDING'
             ORDER BY created_at ASC
             LIMIT ?`
        )
            .bind(limit)
            .all();

        const jobs = rows?.results || [];
        let processed = 0;

        for (const job of jobs) {
            const startedAt = new Date().toISOString();
            const claimed = await this.env.DB.prepare(
                `UPDATE jobs SET status='RUNNING', started_at=? WHERE id=? AND status='PENDING'`
            )
                .bind(startedAt, job.id)
                .run();
            if ((claimed?.meta?.changes || 0) === 0) continue;

            try {
                await runLegacyInventoryJob(this.env, job);
                const finishedAt = new Date().toISOString();
                await this.env.DB.prepare(
                    `UPDATE jobs SET status='DONE', finished_at=?, error=NULL WHERE id=?`
                )
                    .bind(finishedAt, job.id)
                    .run();
                processed += 1;
            } catch (err) {
                const finishedAt = new Date().toISOString();
                await this.env.DB.prepare(
                    `UPDATE jobs SET status='FAILED', finished_at=?, error=? WHERE id=?`
                )
                    .bind(finishedAt, String(err?.message || err || 'JOB_ERROR'), job.id)
                    .run();
                processed += 1;
            }
        }

        const remainingRow = await this.env.DB.prepare(
            `SELECT COUNT(*) as c FROM jobs WHERE status='PENDING'`
        )
            .first();
        const remaining = Number(remainingRow?.c || 0);
        if (remaining > 0) {
            await this.state.storage.setAlarm(Date.now() + 2000);
        }
        return { processed, remaining };
    }

    async fetch(request) {
        const url = new URL(request.url);
        if (request.method === 'POST' && url.pathname === '/enqueue') {
            const body = await request.json().catch(() => ({}));
            const result = await this.enqueue(body);
            return new Response(JSON.stringify({ success: true, ...result }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        }
        if (request.method === 'POST' && url.pathname === '/run') {
            const out = await this.processBatch(25);
            return new Response(JSON.stringify({ success: true, ...out }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        }
        if (request.method === 'GET' && url.pathname === '/status') {
            if (!this.env?.DB) {
                return new Response(JSON.stringify({ success: true, db: false }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            const pending = await this.env.DB.prepare(`SELECT COUNT(*) as c FROM jobs WHERE status='PENDING'`).first();
            const running = await this.env.DB.prepare(`SELECT COUNT(*) as c FROM jobs WHERE status='RUNNING'`).first();
            const failed = await this.env.DB.prepare(`SELECT COUNT(*) as c FROM jobs WHERE status='FAILED'`).first();
            return new Response(
                JSON.stringify({
                    success: true,
                    db: true,
                    pending: Number(pending?.c || 0),
                    running: Number(running?.c || 0),
                    failed: Number(failed?.c || 0),
                }),
                { status: 200, headers: { 'content-type': 'application/json' } }
            );
        }
        return new Response('Not Found', { status: 404 });
    }

    async alarm() {
        // Preserve the existing API Durable Object alarm serialization contract.
        await this.state.blockConcurrencyWhile(async () => {
            await this.processBatch(25);
        });
    }
}
