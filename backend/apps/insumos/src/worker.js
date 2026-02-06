import bcrypt from 'bcryptjs';
import { toCsv } from './lib/csv.js';
import { safeJson, safeJsonNoTruncate } from './lib/json.js';
import { qrSvg } from './lib/qr.js';
import { getClientIp, getUserAgent } from './lib/request.js';
import { handleBackupRoutes } from './routes/backup.js';
import { handleAuthRoutes } from './routes/auth.js';
import { handleAdminRoutes } from './routes/admin.js';
import { handleExportsRoutes } from './routes/exports.js';
import { handleAuditRoutes } from './routes/audit.js';
import { handleMovimentacoesRoutes } from './routes/movimentacoes.js';
import { handleInsumosRoutes } from './routes/insumos.js';
import { handleInsightsRoutes } from './routes/insights.js';
import { handleShareRoutes } from './routes/share.js';
import { handleCategoriasRoutes } from './routes/categorias.js';
import { handlePrefsRoutes } from './routes/prefs.js';
import { handlePontoRoutes } from './routes/ponto.js';
import {
    d1ListInsumos,
    d1CreateInsumo,
    d1UpdateInsumo,
    d1DeleteInsumo,
    d1EntradaBaixa,
    d1Ajuste,
    d1Transfer,
    d1ListMovimentacoes,
    d1ListInsumosPaged,
    d1GetUserByUsername,
    d1GetUserByIdentifier,
    d1UpdateUserProfile,
    resolveCrmTables,
} from './d1Store.js';

const MAX_PROFILE_PHOTO_URL_CHARS = 45000;

const ROLE_ORDER = ['CONSULTOR', 'OPERADOR', 'GERENTE', 'GESTOR', 'ADMIN'];
const normalizeRole = (role) => (role || 'CONSULTOR').toString().trim().toUpperCase();
const hasAnyRole = (role, allowed) => allowed.map(normalizeRole).includes(normalizeRole(role));

const DEFAULT_UNIDADES = ['novo-hamburgo', 'barra-shopping-sul'];

function safeJsonParse(raw) {
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function slugifyUnidade(value) {
    const s0 = String(value || '').trim().toLowerCase();
    if (!s0) return '';
    if (s0 === '*' || s0 === 'all' || s0 === 'todas') return '*';
    if (s0 === 'novo-hamburgo' || s0 === 'novohamburgo' || s0 === 'novo hamburgo' || s0 === 'nh') return 'novo-hamburgo';
    if (s0 === 'barra-shopping-sul' || s0 === 'barrashoppingsul' || s0 === 'barra shopping sul' || s0 === 'bss') return 'barra-shopping-sul';
    const s = s0
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return s;
}

function getInsumosConfig(env) {
    const unidadesRaw = String(env?.UNIDADES || '').trim();
    const unidades = unidadesRaw
        ? Array.from(
            new Set(
                unidadesRaw
                    .split(/[,;|]/g)
                    .map((u) => slugifyUnidade(u))
                    .filter((u) => u && u !== '*')
            )
        )
        : DEFAULT_UNIDADES;

    const unitHeadersRaw = env?.UNIDADES_HEADERS_JSON || env?.UNIDADES_HEADERS || '';
    const unitHeadersParsed = safeJsonParse(unitHeadersRaw);
    const unidadeHeaders = {};
    if (unitHeadersParsed && typeof unitHeadersParsed === 'object') {
        for (const [k, v] of Object.entries(unitHeadersParsed)) {
            const slug = slugifyUnidade(k);
            const key = String(v || '').toLowerCase().trim();
            if (slug && slug !== '*' && key) unidadeHeaders[slug] = key;
        }
    }

    return { unidades, unidadeHeaders };
}

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

        // Persist less frequently to reduce `rows_written`.
        // Heuristic: keep at most ~4 writes/window under steady load.
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

        // Best-effort cache pruning (avoid unbounded growth).
        if (this._cache.size > 500) {
            let scanned = 0;
            for (const [k, v] of this._cache) {
                if (v.expiresAtMs <= nowMs) this._cache.delete(k);
                if (++scanned >= 50) break;
            }
        }

        const allowed = next <= limit;
        return new Response(JSON.stringify({ allowed, limit, remaining: Math.max(0, limit - next) }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
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
        const now = new Date().toISOString();
        const type = String(job?.type || '').trim().toUpperCase();
        const unidade = job?.unidade ? String(job.unidade) : null;
        const payloadJson = job?.payload ? safeJson(job.payload) : null;
        if (!type) return { enqueued: false, reason: 'MISSING_TYPE' };

        // Coalesce jobs by type+unidade to avoid duplicate heavy refreshes
        const id = job?.id ? String(job.id) : `${type}:${unidade || 'ALL'}`;

        await this.env.DB.prepare(
            `INSERT OR IGNORE INTO jobs (id, type, status, unidade, payload_json, created_at)
             VALUES (?, ?, 'PENDING', ?, ?, ?)`
        )
            .bind(id, type, unidade, payloadJson, now)
            .run();

        // If it already exists but is DONE/FAILED, reopen it
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
                await runJob({ env: this.env, job });
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

        const remainingRow = await this.env.DB.prepare(`SELECT COUNT(*) as c FROM jobs WHERE status='PENDING'`).first();
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
        // Durable Objects serialize alarms, but keep it defensive
        await this.state.blockConcurrencyWhile(async () => {
            await this.processBatch(25);
        });
    }
}

function withCORSBase(body, init = {}, origin) {
    const headers = init.headers instanceof Headers ? init.headers : new Headers(init.headers || {});
    headers.set("content-type", headers.get("content-type") || "application/json");
    headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
    if (origin) {
        headers.set("Access-Control-Allow-Origin", origin);
        headers.set("Access-Control-Allow-Credentials", "true");
        headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
        headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CSRF-Token, Idempotency-Key, X-Requested-With, X-Request-Id");
        headers.set("Access-Control-Expose-Headers", "Content-Type, Authorization, X-CSRF-Token, Idempotency-Key, X-Request-Id");
        headers.set("Access-Control-Max-Age", "86400");
        headers.append("Vary", "Origin");
    }
    return new Response(body, { ...init, headers });
}

/**
 * Parse rows from Sheets into structured data
 */
function buildResumoEstoque(itens) {
    const totalInsumos = itens.length;
    const valorEstoqueTotal = itens.reduce((acc, cur) => acc + (Number(cur.precoCusto) || 0) * (Number(cur.estoqueAtual) || 0), 0);
    const criticos = itens.filter(i => i.estoqueMinimo > 0 && (i.estoqueAtual || 0) <= i.estoqueMinimo).length;
    return { totalInsumos, valorEstoqueTotal, criticos };
}

function stockDistribution(itens) {
    const distMap = new Map();
    itens.forEach((i) => {
        const key = (i.categoria || 'Outros').trim() || 'Outros';
        const prev = distMap.get(key) || 0;
        distMap.set(key, prev + (Number(i.estoqueAtual) || 0));
    });
    return Array.from(distMap.entries()).map(([name, value]) => ({ name, value }));
}

function buildActionables(itens, unidade, config = { unidades: DEFAULT_UNIDADES, unidadeHeaders: { 'barra-shopping-sul': 'barrashoppingsul', 'novo-hamburgo': 'novo hamburgo' } }) {
    const unidades = Array.isArray(config?.unidades) && config.unidades.length ? config.unidades : DEFAULT_UNIDADES;
    const reposicao = itens
        .filter((i) => (Number(i.estoqueMinimo) || 0) > 0 && (Number(i.estoqueAtual) || 0) <= (Number(i.estoqueMinimo) || 0))
        .map((i) => {
            const estoque = Number(i.estoqueAtual) || 0;
            const minimo = Number(i.estoqueMinimo) || 0;
            const suggested = Math.max(0, minimo * 2 - estoque);
            return {
                codigoBarras: i.codigoBarras,
                produto: i.produto,
                categoria: i.categoria,
                estoqueAtual: estoque,
                estoqueMinimo: minimo,
                suggestedPurchaseQty: suggested,
                estimatedValue: (Number(i.precoCusto) || 0) * suggested
            };
        })
        .sort((a, b) => (a.estoqueAtual - a.estoqueMinimo) - (b.estoqueAtual - b.estoqueMinimo))
        .slice(0, 50);

    const transferencias = itens
        .map((i) => {
            const minimo = Number(i.estoqueMinimo) || 0;
            const estoqueDestino = Number(i?.estoques?.[unidade] ?? i.estoqueAtual) || 0;
            const need = Math.max(0, minimo - estoqueDestino);
            if (need <= 0) return null;

            let bestFrom = null;
            let bestSurplus = 0;
            for (const u of unidades) {
                if (u === unidade) continue;
                const estoqueOrigem = Number(i?.estoques?.[u] ?? 0) || 0;
                const surplus = Math.max(0, estoqueOrigem - minimo);
                if (surplus > bestSurplus) {
                    bestSurplus = surplus;
                    bestFrom = u;
                }
            }
            if (!bestFrom || bestSurplus <= 0) return null;

            const qty = Math.min(need, bestSurplus);
            return {
                codigoBarras: i.codigoBarras,
                produto: i.produto,
                categoria: i.categoria,
                from: bestFrom,
                to: unidade,
                qty,
                estimatedValue: (Number(i.precoCusto) || 0) * qty
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 50);

    const perdasValidade = itens
        .filter((i) => i.statusValidade?.status === 'EXPIRADO' && (Number(i.estoqueAtual) || 0) > 0)
        .map((i) => ({
            codigoBarras: i.codigoBarras,
            produto: i.produto,
            categoria: i.categoria,
            estoqueAtual: Number(i.estoqueAtual) || 0,
            dataValidade: i.dataValidade,
            lote: i.lote || '',
            lossValue: (Number(i.precoCusto) || 0) * (Number(i.estoqueAtual) || 0)
        }))
        .sort((a, b) => b.lossValue - a.lossValue)
        .slice(0, 50);

    const rupturas = itens
        .filter((i) => (Number(i.estoqueMinimo) || 0) > 0 && (Number(i.estoqueAtual) || 0) === 0)
        .map((i) => ({
            codigoBarras: i.codigoBarras,
            produto: i.produto,
            categoria: i.categoria,
            estoqueMinimo: Number(i.estoqueMinimo) || 0,
            estimatedImpact: (Number(i.precoCusto) || 0) * (Number(i.estoqueMinimo) || 0)
        }))
        .sort((a, b) => b.estimatedImpact - a.estimatedImpact)
        .slice(0, 50);

    return { unidade, reposicao, transferencias, perdasValidade, rupturas };
}

function buildRoi(itens, unidade) {
    const expirados = itens.filter((i) => i.statusValidade?.status === 'EXPIRADO' && (Number(i.estoqueAtual) || 0) > 0);
    const vencendo = itens.filter((i) => i.statusValidade?.status === 'VENCENDO' && (Number(i.estoqueAtual) || 0) > 0);
    const rupturas = itens.filter((i) => (Number(i.estoqueMinimo) || 0) > 0 && (Number(i.estoqueAtual) || 0) === 0);

    const valorExpirado = expirados.reduce((acc, i) => acc + (Number(i.precoCusto) || 0) * (Number(i.estoqueAtual) || 0), 0);
    const valorRiscoVencendo = vencendo.reduce((acc, i) => acc + (Number(i.precoCusto) || 0) * (Number(i.estoqueAtual) || 0), 0);

    return {
        unidade,
        perdas: {
            valorExpirado: Number(valorExpirado.toFixed(2)),
            valorRiscoVencendo: Number(valorRiscoVencendo.toFixed(2)),
            itensExpirados: expirados.length,
            itensVencendo: vencendo.length
        },
        ruptura: {
            itensRuptura: rupturas.length
        },
        produtividade: {
            entrada: null,
            baixa: null
        }
    };
}

const ALLOWED_UNIDADES_MEDIDA = new Set(['FRASCO', 'SERINGA', 'UNIDADE', 'CAIXA', 'ML', 'AMPOLA']);

function buildQualityReport(itens, unidade, limitIssues = 500) {
    const issues = [];
    const normalizeBarcode = (v) => `${v || ''}`.trim().toUpperCase();
    const isValidDate = (v) => {
        if (!v) return false;
        const d = new Date(v);
        return !Number.isNaN(d.getTime());
    };
    const toNumber = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    };
    const makeIssue = (payload) => payload;

    const byBarcode = new Map();
    itens.forEach((i) => {
        const code = normalizeBarcode(i.codigoBarras);
        if (!code) return;
        const list = byBarcode.get(code) || [];
        list.push(i);
        byBarcode.set(code, list);
    });
    for (const [code, list] of byBarcode.entries()) {
        if (list.length <= 1) continue;
        issues.push(makeIssue({
            severity: 'CRITICAL',
            code: 'DUPLICATE_BARCODE',
            message: `Código de barras duplicado (${list.length} linhas)`,
            registro: '',
            codigoBarras: code,
            produto: Array.from(new Set(list.map((x) => x.produto).filter(Boolean))).join(' / '),
            unidade,
            suggestion: 'Consolidar em um único registro ou corrigir códigos duplicados',
            meta: { registros: list.map((x) => x.registro).filter(Boolean) }
        }));
    }

    for (const i of itens) {
        const codigo = normalizeBarcode(i.codigoBarras);
        const produto = `${i.produto || ''}`.trim();
        const categoria = `${i.categoria || ''}`.trim();
        const tipoUnidade = `${i.tipoUnidade || i.unidade || ''}`.trim();
        const estoqueMinimo = toNumber(i.estoqueMinimo);
        const precoCusto = toNumber(i.precoCusto);
        const estoqueAtual = toNumber(i.estoqueAtual) || 0;

        if (!codigo) {
            issues.push(makeIssue({
                severity: 'CRITICAL',
                code: 'MISSING_BARCODE',
                message: 'Código de barras ausente',
                registro: i.registro || '',
                codigoBarras: '',
                produto,
                unidade,
                suggestion: 'Preencher o código de barras (campo chave)'
            }));
        }
        if (!produto) {
            issues.push(makeIssue({
                severity: 'CRITICAL',
                code: 'MISSING_PRODUCT',
                message: 'Produto ausente',
                registro: i.registro || '',
                codigoBarras: codigo,
                produto: '',
                unidade,
                suggestion: 'Preencher nome do produto'
            }));
        }
        if (!categoria) {
            issues.push(makeIssue({
                severity: 'WARN',
                code: 'MISSING_CATEGORY',
                message: 'Categoria ausente',
                registro: i.registro || '',
                codigoBarras: codigo,
                produto,
                unidade,
                suggestion: 'Classificar categoria para relatórios e cores'
            }));
        }
        if (!tipoUnidade) {
            issues.push(makeIssue({
                severity: 'WARN',
                code: 'MISSING_UNIT_MEASURE',
                message: 'Unidade de medida ausente',
                registro: i.registro || '',
                codigoBarras: codigo,
                produto,
                unidade,
                suggestion: 'Definir unidade (ex.: Frasco, Seringa, ml)'
            }));
        } else if (!ALLOWED_UNIDADES_MEDIDA.has(tipoUnidade.toUpperCase())) {
            issues.push(makeIssue({
                severity: 'INFO',
                code: 'NONSTANDARD_UNIT_MEASURE',
                message: `Unidade de medida fora do padrão: "${tipoUnidade}"`,
                registro: i.registro || '',
                codigoBarras: codigo,
                produto,
                unidade,
                suggestion: 'Padronizar unidade para evitar erro operacional'
            }));
        }
        if (estoqueMinimo === null || estoqueMinimo < 0) {
            issues.push(makeIssue({
                severity: 'WARN',
                code: 'INVALID_MIN_STOCK',
                message: 'Estoque mínimo inválido',
                registro: i.registro || '',
                codigoBarras: codigo,
                produto,
                unidade,
                suggestion: 'Definir estoque mínimo (>= 0)'
            }));
        } else if (estoqueMinimo === 0 && estoqueAtual > 0) {
            issues.push(makeIssue({
                severity: 'INFO',
                code: 'MIN_STOCK_ZERO',
                message: 'Estoque mínimo zerado',
                registro: i.registro || '',
                codigoBarras: codigo,
                produto,
                unidade,
                suggestion: 'Revisar estoque mínimo para evitar rupturas silenciosas'
            }));
        }

        if ((precoCusto === null || precoCusto === 0) && estoqueAtual > 0) {
            issues.push(makeIssue({
                severity: 'INFO',
                code: 'MISSING_COST_PRICE',
                message: 'Preço de custo ausente/zero com estoque',
                registro: i.registro || '',
                codigoBarras: codigo,
                produto,
                unidade,
                suggestion: 'Preencher preço para ROI e inventário'
            }));
        }

        if (i.dataValidade && !isValidDate(i.dataValidade)) {
            issues.push(makeIssue({
                severity: 'WARN',
                code: 'INVALID_EXPIRY_DATE',
                message: `Data de validade inválida: "${i.dataValidade}"`,
                registro: i.registro || '',
                codigoBarras: codigo,
                produto,
                unidade,
                suggestion: 'Padronizar validade (YYYY-MM-DD)'
            }));
        }
        if (i.dataValidade && !`${i.lote || ''}`.trim()) {
            issues.push(makeIssue({
                severity: 'INFO',
                code: 'MISSING_LOT',
                message: 'Lote ausente com validade preenchida',
                registro: i.registro || '',
                codigoBarras: codigo,
                produto,
                unidade,
                suggestion: 'Preencher lote para rastreabilidade'
            }));
        }
        if (i.statusValidade?.status === 'EXPIRADO' && estoqueAtual > 0) {
            issues.push(makeIssue({
                severity: 'CRITICAL',
                code: 'EXPIRED_WITH_STOCK',
                message: 'Item expirado ainda em estoque',
                registro: i.registro || '',
                codigoBarras: codigo,
                produto,
                unidade,
                suggestion: 'Baixar por VENCIMENTO e anexar evidência (foto/relatório)'
            }));
        }
    }

    const capped = issues.slice(0, Math.max(1, Math.min(2000, Number(limitIssues) || 500)));
    const summary = capped.reduce((acc, cur) => {
        acc.total += 1;
        acc.bySeverity[cur.severity] = (acc.bySeverity[cur.severity] || 0) + 1;
        acc.byCode[cur.code] = (acc.byCode[cur.code] || 0) + 1;
        return acc;
    }, { total: 0, bySeverity: {}, byCode: {} });

    return { generatedAt: new Date().toISOString(), unidade, summary, issues: capped };
}

function parseCookies(cookieHeader = '') {
    return Object.fromEntries(cookieHeader.split(';').map(c => c.trim()).filter(Boolean).map(c => {
        const idx = c.indexOf('=');
        return [decodeURIComponent(c.slice(0, idx)), decodeURIComponent(c.slice(idx + 1))];
    }));
}

function encodeSessionLegacy(sessionObj) {
    const json = JSON.stringify(sessionObj);
    return btoa(unescape(encodeURIComponent(json)));
}

function decodeSessionLegacy(token) {
    try {
        const json = decodeURIComponent(escape(atob(token)));
        return JSON.parse(json);
    } catch {
        return null;
    }
}

function base64UrlEncodeBytes(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecodeToBytes(b64url) {
    const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + pad;
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function base64UrlEncodeJson(obj) {
    const json = JSON.stringify(obj);
    const bytes = new TextEncoder().encode(json);
    return base64UrlEncodeBytes(bytes);
}

function base64UrlDecodeJson(b64url) {
    const bytes = base64UrlDecodeToBytes(b64url);
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json);
}

function timingSafeEqual(a, b) {
    const aa = new TextEncoder().encode(a || '');
    const bb = new TextEncoder().encode(b || '');
    if (aa.length !== bb.length) return false;
    let out = 0;
    for (let i = 0; i < aa.length; i++) out |= aa[i] ^ bb[i];
    return out === 0;
}

async function hmacSign(secret, data) {
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
    return base64UrlEncodeBytes(new Uint8Array(sig));
}

async function encodeSessionV2(sessionObj, secret) {
    const payload = base64UrlEncodeJson(sessionObj);
    const sig = await hmacSign(secret, payload);
    return `${payload}.${sig}`;
}

async function decodeSessionV2(token, secret) {
    const parts = String(token || '').split('.');
    if (parts.length !== 2) return null;
    const [payload, sig] = parts;
    const expected = await hmacSign(secret, payload);
    if (!timingSafeEqual(expected, sig)) return null;
    const obj = base64UrlDecodeJson(payload);
    const exp = Number(obj?.exp || 0);
    if (exp && Date.now() > exp) return null;
    return obj;
}

async function decodeSessionCookie(token, secret) {
    if (!token || !secret) return null;
    if (!String(token).includes('.')) return null;
    try {
        return await decodeSessionV2(token, secret);
    } catch {
        return null;
    }
}

function deleteAuthCookies({ secure } = {}) {
    const isSecure = secure === undefined ? true : !!secure;
    const sameSite = isSecure ? 'None' : 'Lax';
    const secureAttr = isSecure ? '; Secure' : '';
    const headers = new Headers();
    headers.append('Set-Cookie', `session=deleted; Path=/; Max-Age=0; SameSite=${sameSite}${secureAttr}; HttpOnly`);
    headers.append('Set-Cookie', `csrfToken=deleted; Path=/; Max-Age=0; SameSite=${sameSite}${secureAttr}`);
    return headers;
}

function validateUsername(username) {
    const u = (username || '').trim();
    if (u.length < 3 || u.length > 40) return false;
    return /^[a-zA-Z0-9._-]+$/.test(u);
}

async function appendAuditLog({ env, actor, role, ip, userAgent, action, entity, entityId, unidade, before, after, idempotencyKey }) {
    const ts = new Date().toISOString();

    try {
        if (env?.DB) {
            await env.DB.prepare(
                `INSERT INTO audit_log (ts, actor, role, action, entity, entity_id, unidade, ip, user_agent, idempotency_key, before_json, after_json)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
                .bind(
                    ts,
                    actor || '',
                    role || '',
                    action || '',
                    entity || '',
                    entityId || '',
                    unidade || '',
                    ip || '',
                    userAgent || '',
                    idempotencyKey || '',
                    safeJson(before),
                    safeJson(after)
                )
                .run();
        }
    } catch {
        // ignore DB failures
    }
}

function computeNotificationsForUnidade(insumos, unidade) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const soonDays = 30;

    const lowStock = [];
    const expiringSoon = [];
    const expiredWithStock = [];

    for (const i of insumos) {
        const estoqueAtual = Number(i.estoqueAtual) || 0;
        const estoqueMinimo = Number(i.estoqueMinimo) || 0;
        if (estoqueMinimo > 0 && estoqueAtual <= estoqueMinimo) {
            lowStock.push({
                codigoBarras: i.codigoBarras,
                produto: i.produto,
                categoria: i.categoria,
                estoqueAtual,
                estoqueMinimo,
            });
        }

        const status = i.statusValidade?.status;
        if (status === 'EXPIRADO' && estoqueAtual > 0) {
            expiredWithStock.push({
                codigoBarras: i.codigoBarras,
                produto: i.produto,
                categoria: i.categoria,
                estoqueAtual,
                dataValidade: i.dataValidade,
            });
        } else if (status === 'VENCENDO' && estoqueAtual > 0) {
            expiringSoon.push({
                codigoBarras: i.codigoBarras,
                produto: i.produto,
                categoria: i.categoria,
                estoqueAtual,
                dataValidade: i.dataValidade,
                dias: i.statusValidade?.dias,
            });
        } else if (i.dataValidade && estoqueAtual > 0) {
            const d = new Date(i.dataValidade);
            if (!Number.isNaN(d.getTime())) {
                d.setHours(0, 0, 0, 0);
                const diff = Math.round((d - now) / (1000 * 60 * 60 * 24));
                if (diff >= 0 && diff <= soonDays) {
                    expiringSoon.push({
                        codigoBarras: i.codigoBarras,
                        produto: i.produto,
                        categoria: i.categoria,
                        estoqueAtual,
                        dataValidade: i.dataValidade,
                        dias: diff,
                    });
                }
            }
        }
    }

    lowStock.sort((a, b) => (a.estoqueAtual - a.estoqueMinimo) - (b.estoqueAtual - b.estoqueMinimo));
    expiringSoon.sort((a, b) => (Number(a.dias) || 0) - (Number(b.dias) || 0));
    expiredWithStock.sort((a, b) => (Number(b.estoqueAtual) || 0) - (Number(a.estoqueAtual) || 0));

    return {
        generatedAt: new Date().toISOString(),
        unidade,
        counts: {
            lowStock: lowStock.length,
            expiringSoon: expiringSoon.length,
            expiredWithStock: expiredWithStock.length,
        },
        lowStock: lowStock.slice(0, 50),
        expiringSoon: expiringSoon.slice(0, 50),
        expiredWithStock: expiredWithStock.slice(0, 50),
    };
}

function getJobQueueStub(env) {
    if (!env?.JOB_QUEUE) return null;
    const id = env.JOB_QUEUE.idFromName('global');
    return env.JOB_QUEUE.get(id);
}

async function enqueueJob(env, job) {
    const stub = getJobQueueStub(env);
    if (!stub) return { enqueued: false, reason: 'JOB_QUEUE_NOT_CONFIGURED' };
    const res = await stub.fetch('https://job-queue/enqueue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(job || {}),
    });
    const data = await res.json().catch(() => ({}));
    return data;
}

async function enqueueNotificationsRefresh(env, unidade) {
    const u = unidade ? String(unidade) : null;
    return enqueueJob(env, { type: 'NOTIFICATIONS_REFRESH', unidade: u });
}

async function refreshNotificationsSnapshotInD1({ env, unidade }) {
    if (!env?.DB) return;
    const config = getInsumosConfig(env);
    const unit = unidade ? slugifyUnidade(unidade) : null;
    const unidades = unit ? [unit] : config.unidades;

    for (const u of unidades) {
        const insumos = await d1ListInsumos({ env, unidades: config.unidades, unidade: u });
        const payload = computeNotificationsForUnidade(insumos, u);
        const ts = new Date().toISOString();
        await env.DB.prepare(
            `INSERT INTO notification_snapshot (ts, unidade, low_stock, expiring_soon, expired_with_stock, payload_json)
             VALUES (?, ?, ?, ?, ?, ?)`
        )
            .bind(ts, u, payload.counts.lowStock, payload.counts.expiringSoon, payload.counts.expiredWithStock, safeJson(payload))
            .run();
    }
}

async function runJob({ env, job }) {
    const type = String(job?.type || '').toUpperCase();
    if (type === 'NOTIFICATIONS_REFRESH') {
        await refreshNotificationsSnapshotInD1({ env, unidade: job?.unidade ? String(job.unidade) : null });
        return;
    }
    throw new Error(`Unknown job type: ${type}`);
}

export default {
    async fetch(request, env, ctx) {
        const startedAt = Date.now();
        const incomingRequestId = String(request.headers.get('x-request-id') || request.headers.get('cf-ray') || '').trim();
        const requestId = incomingRequestId || crypto.randomUUID();

        // Service mount: api.skincos.com.br/insumos/*
        // Keep internal routes unchanged by stripping the /insumos prefix.
        try {
            const u = new URL(request.url);
            if (u.pathname === '/insumos' || u.pathname.startsWith('/insumos/')) {
                u.pathname = u.pathname.slice('/insumos'.length) || '/';
                request = new Request(u.toString(), request);
            }
        } catch {
            // ignore URL parsing failures
        }
        const url = new URL(request.url);

        // Compatibility layer: accept legacy "/api/*" paths (old Express-style)
        // while keeping the canonical routes without the "/api" prefix.
        // Example: /insumos/api/backup/trigger -> /backup/trigger
        try {
            const p = url.pathname || '';
            if (p === '/auditoria') {
                url.pathname = '/audit';
            } else if (p.startsWith('/api/')) {
                const rest = p.slice('/api'.length); // keeps leading '/'
                const allow = [
                    '/auth/',
                    '/insumos',
                    '/movimentacoes',
                    '/relatorios',
                    '/alertas',
                    '/backup',
                    '/auditoria',
                    '/quality',
                    '/ponto',
                ];
                if (allow.some((prefix) => rest === prefix || rest.startsWith(prefix))) {
                    url.pathname = rest === '/auditoria' ? '/audit' : rest;
                }
            }
        } catch {
            // ignore
        }
        const config = getInsumosConfig(env);
        const UNIDADES = config.unidades;
        let appOrigin = env.APP_ORIGIN || "https://crm.skincos.com.br";
        try {
            const requestOrigin = String(request.headers.get('Origin') || '').trim();
            const raw = String(env.APP_ORIGINS || '').trim();
            const allow = Array.from(new Set([appOrigin, ...raw.split(',').map((s) => s.trim()).filter(Boolean)]));
            if (requestOrigin && allow.includes(requestOrigin)) {
                appOrigin = requestOrigin;
            }
        } catch {
            // ignore
        }
        const defaultUnidade = UNIDADES[0] || 'novo-hamburgo';
        const unidade = slugifyUnidade(url.searchParams.get('unidade') || '') || defaultUnidade;
        const cookies = parseCookies(request.headers.get('cookie') || '');
        const ip = getClientIp(request);
        const userAgent = getUserAgent(request);
        const idempotencyKey = request.headers.get('idempotency-key') || request.headers.get('Idempotency-Key') || '';
        const isSecureContext = url.protocol === 'https:';

        const withCORS = (body, init = {}) => {
            const res = withCORSBase(body, init, appOrigin);
            res.headers.set('x-request-id', requestId);
            const durationMs = Date.now() - startedAt;
            const status = res.status || 200;
            const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
            const payload = {
                level,
                request_id: requestId,
                method: request.method,
                path: url.pathname,
                status,
                duration_ms: durationMs,
            };
            if (ip) payload.ip = ip;
            if (userAgent) payload.user_agent = userAgent;
            console.log(JSON.stringify(payload));
            return res;
        };

        // Ponto routes must not depend on Insumos session cookies/config (SESSION_SECRET, CSRF, etc).
        // They have their own auth model (proxy token + signed actor headers / admin token / device token).
        let pontoEarlyResp = null;
        try {
            pontoEarlyResp = await handlePontoRoutes({
                request,
                url,
                env,
                appOrigin,
                withCORS,
            });
        } catch (err) {
            const message = String((err && err.message) || err || 'unknown');
            console.error(JSON.stringify({ level: 'error', request_id: requestId, scope: 'ponto', error: message }));
            return withCORS(
                JSON.stringify({ ok: false, error: 'PONTO_WORKER_EXCEPTION', requestId, detail: message }),
                { status: 500, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }
            );
        }
        if (pontoEarlyResp) return pontoEarlyResp;

        const enforceRateLimit = async (kind) => {
            if (!env.RATE_LIMITER) return { allowed: true };
            const windowSec = 60;
            const cfg = {
                auth: { limit: 20 },
                read: { limit: 240 },
                write: { limit: 60 }
            }[kind] || { limit: 120 };
            const ipKey = String(ip || '').trim();
            const uaKey = String(userAgent || '').trim().slice(0, 80);
            const idName = ipKey && ipKey !== '0.0.0.0' ? ipKey : `ua:${uaKey || 'unknown'}`;
            const id = env.RATE_LIMITER.idFromName(idName);
            const stub = env.RATE_LIMITER.get(id);
            const res = await stub.fetch(`https://rl/?key=${encodeURIComponent(kind)}&limit=${cfg.limit}&window=${windowSec}`);
            const data = await res.json().catch(() => ({}));
            if (!data.allowed) {
                return { allowed: false, limit: data.limit ?? cfg.limit, remaining: data.remaining ?? 0 };
            }
            return { allowed: true, remaining: data.remaining };
        };

        // Preflight
        if (request.method === "OPTIONS") {
            return withCORS(null, { status: 204 }, appOrigin);
        }

        const d1Enabled = !!env?.DB;

        // Public endpoints
        if (url.pathname === "/health") {
            return withCORS(
                JSON.stringify({
                    ok: true,
                    service: "insumos",
                    runtime: "cloudflare-workers",
                    storage: "d1",
                    dbConfigured: d1Enabled,
                    unidades: UNIDADES,
                }),
                { status: 200 },
                appOrigin
            );
        }
        if (url.pathname === "/api/metrics" || url.pathname === "/metrics") {
            return withCORS(JSON.stringify({ success: true }), { status: 200 }, appOrigin);
        }

        // D1-only: if DB is not configured, fail fast (no legacy Sheets fallback).
        if (!d1Enabled) {
            return withCORS(
                JSON.stringify({ success: false, error: 'DB_NOT_CONFIGURED', code: 'DB_NOT_CONFIGURED' }),
                { status: 503, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } },
                appOrigin
            );
        }

        // Basic rate limiting (Durable Object)
        try {
            const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);
            const authSensitive = [
                '/auth/login',
                '/auth/register',
                '/auth/signup',
                '/auth/password/request',
                '/auth/password/reset',
            ];
            const isAuthSensitive = authSensitive.includes(url.pathname);
            const kind = isAuthSensitive ? 'auth' : (isMutating ? 'write' : 'read');
            const rl = await enforceRateLimit(kind);
            if (!rl.allowed) {
                return withCORS(JSON.stringify({ success: false, error: 'Rate limit excedido', code: 'RATE_LIMITED' }), { status: 429 }, appOrigin);
            }
        } catch {
            // If rate limiting fails, continue without blocking
        }

        // D1-only: legacy Sheets credentials/ranges are intentionally not loaded.

        const sessionSecret = String(env.SESSION_SECRET || '').trim();
        if (!sessionSecret) {
            return withCORS(JSON.stringify({ error: "SESSION_SECRET not configured" }), { status: 500 }, appOrigin);
        }

        const issueAuthCookies = async (sessionPayload) => {
            const csrf = crypto.randomUUID();
            const exp = Date.now() + 7 * 24 * 60 * 60 * 1000;
            const payload = { ...sessionPayload, csrf, exp };
            const token = await encodeSessionV2(payload, sessionSecret);

            // Dev (http) cannot set Secure cookies; SameSite=None also requires Secure.
            const sameSite = isSecureContext ? 'None' : 'Lax';
            const secureAttr = isSecureContext ? '; Secure' : '';
            const cookieDomain = String(env.SESSION_COOKIE_DOMAIN || '').trim();
            const domainAttr = cookieDomain ? `; Domain=${cookieDomain}` : '';
            const headers = new Headers();
            headers.append('Set-Cookie', `session=${token}; Path=/; HttpOnly${secureAttr}${domainAttr}; SameSite=${sameSite}; Max-Age=604800`);
            headers.append('Set-Cookie', `csrfToken=${csrf}; Path=/${domainAttr}${secureAttr}; SameSite=${sameSite}; Max-Age=604800`);
            return { headers, csrf };
        };

        const session = cookies.session ? await decodeSessionCookie(cookies.session, sessionSecret) : null;
        const sessionUsername = session?.username ? String(session.username).trim() : null;
        const sessionCsrf = session?.csrf ? String(session.csrf) : null;
        // CSRF protection for mutating calls (requires header token matching session/cookie)
        const methodUpper = (request.method || 'GET').toUpperCase();
        const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(methodUpper);
        const isAuthRoute = url.pathname.startsWith('/auth/');
        if (isMutating && !isAuthRoute) {
            const csrfCookie = cookies.csrfToken || '';
            const csrfHeader = request.headers.get('x-csrf-token') || request.headers.get('X-CSRF-Token') || '';
            const expected = sessionCsrf || csrfCookie;
            const ok = expected && csrfHeader && expected === csrfHeader;
            if (!ok) {
                return withCORS(JSON.stringify({ success: false, error: 'CSRF inválido', code: 'CSRF_INVALID' }), { status: 403 }, appOrigin);
            }
        }
        let sessionUser = null;
        const loadSessionUser = async () => {
            if (sessionUser) return sessionUser;
            if (!sessionUsername) return null;
            const userDb = await d1GetUserByUsername(env, sessionUsername);
            if (!userDb || !userDb.ativo) return null;
            sessionUser = { ...userDb, role: normalizeRole(userDb.role || 'CONSULTOR') };
            return sessionUser;
        };

        const hasUnitAccess = (u, unit) => {
            if (!u) return false;
            if (String(u.role || '').toUpperCase() === 'ADMIN') return true;
            const allowed = Array.isArray(u.allowedUnits) ? u.allowedUnits.filter(Boolean) : [];
            if (!allowed.length) return true;
            return allowed.includes(unit);
        };

        const getAllowedModules = (u) => {
            const raw = Array.isArray(u?.allowedModules) ? u.allowedModules : [];
            return raw.map(String).map((s) => s.trim()).filter(Boolean);
        };

        const hasModuleAccess = (u, moduleKey) => {
            if (!u || !moduleKey) return false;
            if (String(u.role || '').toUpperCase() === 'ADMIN') return true; // override
            const allowed = getAllowedModules(u);
            if (!allowed.length) return true; // compat: no list means "ALL"
            return allowed.includes(String(moduleKey));
        };

        const requiredModulesForPath = (pathname) => {
            const p = String(pathname || '');
            if (!p) return null;

            // Auth routes never require module permission.
            if (p === '/auth' || p.startsWith('/auth/')) return null;

            // Backup can be accessed by either module.
            if (p === '/backup' || p.startsWith('/backup/')) return ['status', 'backup-recovery'];

            // Admin routes
            if (p === '/admin/users' || p.startsWith('/admin/users/')) return 'status';
            if (p === '/admin/invites' || p.startsWith('/admin/invites/')) return 'users';

            // Audit is exposed via the status/system module.
            if (p === '/audit' || p.startsWith('/audit/')) return 'status';

            // Everything else below is considered part of Insumos data/domain.
            const insumosPrefixes = [
                '/insumos',
                '/movimentacoes',
                '/relatorios',
                '/alertas',
                '/categorias',
                '/quality',
                '/exports',
                '/prefs',
                '/share',
                '/admin/categories',
            ];
            if (insumosPrefixes.some((x) => p === x || p.startsWith(`${x}/`))) return 'insumos';

            return null;
        };

        const enforceModuleOrResponse = (u) => {
            const required = requiredModulesForPath(url.pathname);
            if (!required) return null;
            if (Array.isArray(required)) {
                const ok = required.some((m) => hasModuleAccess(u, m));
                if (ok) return null;
                return withCORS(JSON.stringify({ success: false, error: 'Sem permissão para módulo', code: 'RBAC_MODULE_DENIED', modules: required }), { status: 403 }, appOrigin);
            }
            if (hasModuleAccess(u, required)) return null;
            return withCORS(JSON.stringify({ success: false, error: 'Sem permissão para módulo', code: 'RBAC_MODULE_DENIED', module: required }), { status: 403 }, appOrigin);
        };

        const requireRoles = async (allowedRoles) => {
            const u = await loadSessionUser();
            if (!u) {
                return {
                    ok: false,
                    response: withCORS(
                        JSON.stringify({ error: "Not authenticated" }),
                        { status: 401, headers: deleteAuthCookies({ secure: isSecureContext }) },
                        appOrigin
                    )
                };
            }
            if (!hasAnyRole(u.role, allowedRoles)) {
                return {
                    ok: false,
                    response: withCORS(
                        JSON.stringify({ success: false, error: 'Sem permissão', code: 'RBAC_DENIED', role: u.role }),
                        { status: 403 },
                        appOrigin
                    )
                };
            }
            if (!hasUnitAccess(u, unidade)) {
                return {
                    ok: false,
                    response: withCORS(
                        JSON.stringify({ success: false, error: 'Sem permissão para unidade', code: 'RBAC_UNIT_DENIED', allowedUnits: u.allowedUnits || [] }),
                        { status: 403 },
                        appOrigin
                    )
                };
            }
            const moduleDenied = enforceModuleOrResponse(u);
            if (moduleDenied) return { ok: false, response: moduleDenied };
            return { ok: true, user: u };
        };

        const authResp = await handleAuthRoutes({
            request,
            url,
            env,
            appOrigin,
            withCORS,
            sessionUsername,
            sessionCsrf,
            cookies,
            bcrypt,
            issueAuthCookies,
            deleteAuthCookies: () => deleteAuthCookies({ secure: isSecureContext }),
            validateUsername,
            MAX_PROFILE_PHOTO_URL_CHARS,
            d1: {
                enabled: true,
                getUserByUsername: (u) => d1GetUserByUsername(env, u),
                getUserByIdentifier: (id) => d1GetUserByIdentifier(env, id),
                updateUserProfile: d1UpdateUserProfile,
            },
            appendAuditLog,
            ip,
            userAgent,
        });
        if (authResp) return authResp;

        const adminResp = await handleAdminRoutes({
            request,
            url,
            env,
            appOrigin,
            withCORS,
            requireRoles,
            appendAuditLog,
            ip,
            userAgent,
            idempotencyKey,
            bcrypt,
            validateUsername,
        });
        if (adminResp) return adminResp;


        const isPublicEndpoint = url.pathname === "/api/metrics" || url.pathname === "/metrics";
        if (!isPublicEndpoint && !url.pathname.startsWith("/auth/")) {
            if (!sessionUsername) {
                return withCORS(
                    JSON.stringify({ error: "Not authenticated" }),
                    { status: 401, headers: deleteAuthCookies({ secure: isSecureContext }) },
                    appOrigin
                );
            }
            const u = await loadSessionUser();
            if (!u) {
                return withCORS(
                    JSON.stringify({ error: "Not authenticated" }),
                    { status: 401, headers: deleteAuthCookies({ secure: isSecureContext }) },
                    appOrigin
                );
            }
	            if (!hasUnitAccess(u, unidade)) {
	                return withCORS(
	                    JSON.stringify({ success: false, error: 'Sem permissão para unidade', code: 'RBAC_UNIT_DENIED', allowedUnits: u.allowedUnits || [] }),
	                    { status: 403 },
	                    appOrigin
	                );
	            }
	            const moduleDenied = enforceModuleOrResponse(u);
	            if (moduleDenied) return moduleDenied;
	        }

        const d1 = {
            enabled: true,
            listInsumos: ({ unidade }) => d1ListInsumos({ env, unidades: UNIDADES, unidade }),
            listInsumosPaged: ({ unidade, q, pagina, limite }) => d1ListInsumosPaged({ env, unidades: UNIDADES, unidade, q, pagina, limite }),
            createInsumo: ({ unidade, body }) => d1CreateInsumo({ env, unidades: UNIDADES, unidade, body }),
            updateInsumo: ({ registro, body }) => d1UpdateInsumo({ env, registro, body }),
            deleteInsumo: ({ registro }) => d1DeleteInsumo({ env, registro }),
            entradaBaixa: ({ unidade, body, kind }) => d1EntradaBaixa({ env, unidade, body, kind }),
            ajuste: ({ unidade, body }) => d1Ajuste({ env, unidade, body }),
            transfer: ({ body }) => d1Transfer({ env, body }),
            listMovimentacoes: ({ unidade, tipo, de, ate, pagina, limite, codigoBarras }) =>
                d1ListMovimentacoes({ env, unidade, tipo, de, ate, pagina, limite, codigoBarras }),
        };

        const movResp = await handleMovimentacoesRoutes({
            request,
            url,
            appOrigin,
            withCORS,
            unidade,
            d1,
        });
        if (movResp) return movResp;

        const insumosResp = await handleInsumosRoutes({
            request,
            url,
            env,
            ctx,
            appOrigin,
            withCORS,
            unidade,
            UNIDADES,
            requireRoles,
            appendAuditLog,
            enqueueNotificationsRefresh,

            ip,
            userAgent,
            idempotencyKey,

            qrSvg,
            d1,
        });
        if (insumosResp) return insumosResp;

        const categoriasResp = await handleCategoriasRoutes({
            request,
            url,
            env,
            appOrigin,
            withCORS,
            requireRoles,
        });
        if (categoriasResp) return categoriasResp;

        const prefsResp = await handlePrefsRoutes({
            request,
            url,
            env,
            appOrigin,
            withCORS,
            requireRoles,
        });
        if (prefsResp) return prefsResp;

        const shareResp = await handleShareRoutes({
            request,
            url,
            env,
            appOrigin,
            withCORS,
            requireRoles,
        });
        if (shareResp) return shareResp;


        const exportsResp = await handleExportsRoutes({
            request,
            url,
            env,
            appOrigin,
            withCORS,
            unidade,
            computeNotificationsForUnidade,
            safeJson,
            toCsv,
            qrSvg,
            d1,
        });
        if (exportsResp) return exportsResp;

        const auditResp = await handleAuditRoutes({
            request,
            url,
            env,
            appOrigin,
            withCORS,
            requireRoles,
        });
        if (auditResp) return auditResp;

        // Backup endpoints (Cloudflare-only)
        const backupResp = await handleBackupRoutes({
            request,
            url,
            env,
            ctx,
            appOrigin,
            withCORS,
            requireRoles,
            appendAuditLog,
            enqueueNotificationsRefresh,
            unidade,
            ip,
            userAgent,
            idempotencyKey,
        });
        if (backupResp) return backupResp;

        const insightsResp = await handleInsightsRoutes({
            request,
            url,
            env,
            appOrigin,
            withCORS,
            unidade,
            buildActionables: (itens, u) => buildActionables(itens, u, config),
            buildRoi,
            buildQualityReport,
            stockDistribution,
            buildResumoEstoque,
            d1,
        });
        if (insightsResp) return insightsResp;

        return withCORS(JSON.stringify({ error: "Not Found" }), { status: 404 }, appOrigin);
    },
    async scheduled(event, env, ctx) {
        try {
            const { unidades } = getInsumosConfig(env);
            // Prefer Cloudflare-only job execution (Queues are not available on free plan).
            if (env?.JOB_QUEUE) {
                for (const unidade of unidades) {
                    ctx.waitUntil(enqueueNotificationsRefresh(env, unidade));
                }
                return;
            }
            await refreshNotificationsSnapshotInD1({ env, unidade: null });
        } catch {
            // ignore cron failures
        }
    }
};
