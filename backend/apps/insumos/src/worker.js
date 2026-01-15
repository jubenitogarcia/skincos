import { authenticate, readSheet, writeSheet, batchUpdate, deleteRows, ensureSheetExists } from '../workers/sheets-api.js';
import bcrypt from 'bcryptjs';
import { toCsv } from './lib/csv.js';
import { safeJson, safeJsonNoTruncate } from './lib/json.js';
import { qrSvg } from './lib/qr.js';
import { getClientIp, getUserAgent } from './lib/request.js';
import { handleBackupRoutes } from './routes/backup.js';
import { handleAuthRoutes } from './routes/auth.js';
import { handleExportsRoutes } from './routes/exports.js';
import { handleAuditRoutes } from './routes/audit.js';
import { handleMovimentacoesRoutes } from './routes/movimentacoes.js';
import { handleInsumosRoutes } from './routes/insumos.js';
import { handleInsightsRoutes } from './routes/insights.js';

const MAX_PROFILE_PHOTO_URL_CHARS = 45000;
const AUDIT_SHEET_NAME = 'AuditLog';
const NOTIFICATIONS_SHEET_NAME = 'Notifications';

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

function getUnidadeHeaderCandidates(unidade, config) {
    const slug = slugifyUnidade(unidade);
    const out = [];
    const custom = config?.unidadeHeaders?.[slug];
    if (custom) out.push(String(custom).toLowerCase());
    if (slug) {
        const withSpaces = slug.replace(/-/g, ' ');
        out.push(withSpaces);
        out.push(slug.replace(/-/g, ''));
        out.push(withSpaces.replace(/\s+/g, ''));
    }
    return Array.from(new Set(out.filter(Boolean)));
}

function getStockFromParsedRow(item, unidade, config) {
    const candidates = getUnidadeHeaderCandidates(unidade, config);
    for (const k of candidates) {
        if (Object.prototype.hasOwnProperty.call(item, k)) {
            const n = parseInt(item[k], 10);
            return Number.isFinite(n) ? n : 0;
        }
    }
    return 0;
}

export class RateLimiter {
    constructor(state, env) {
        this.state = state;
        this.env = env;
    }

    async fetch(request) {
        const url = new URL(request.url);
        const key = url.searchParams.get('key') || 'anon';
        const limit = Math.max(1, parseInt(url.searchParams.get('limit') || '60', 10) || 60);
        const windowSec = Math.max(1, parseInt(url.searchParams.get('window') || '60', 10) || 60);
        const nowSec = Math.floor(Date.now() / 1000);
        const bucket = Math.floor(nowSec / windowSec);
        const storageKey = `rl:${key}:${bucket}`;

        const current = (await this.state.storage.get(storageKey)) || 0;
        const next = current + 1;
        await this.state.storage.put(storageKey, next, { expirationTtl: windowSec * 2 });

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

function withCORS(body, init = {}, origin) {
    const headers = init.headers instanceof Headers ? init.headers : new Headers(init.headers || {});
    headers.set("content-type", headers.get("content-type") || "application/json");
    headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
    if (origin) {
        headers.set("Access-Control-Allow-Origin", origin);
        headers.set("Access-Control-Allow-Credentials", "true");
        headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
        headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CSRF-Token, Idempotency-Key, X-Requested-With");
        headers.set("Access-Control-Expose-Headers", "Content-Type, Authorization, X-CSRF-Token, Idempotency-Key");
        headers.set("Access-Control-Max-Age", "86400");
        headers.append("Vary", "Origin");
    }
    return new Response(body, { ...init, headers });
}

/**
 * Parse rows from Sheets into structured data
 */
function parseInsumos(rows) {
    if (!rows || rows.length < 2) return [];
    const headers = rows[0];
    return rows.slice(1).map((row, idx) => {
        const obj = { _rowIndex: idx + 2 }; // +2 for header and 1-based index
        headers.forEach((header, i) => {
            // Convert to lowercase for consistency with frontend
            const key = header.toLowerCase();
            obj[key] = row[i] || '';
        });
        return obj;
    });
}

function calcularStatusValidade(dataValidade) {
    if (!dataValidade) return { status: 'OK', dias: null };
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const validade = new Date(dataValidade);
    if (Number.isNaN(validade.getTime())) return { status: 'OK', dias: null };
    validade.setHours(0, 0, 0, 0);
    const diff = (validade - hoje) / (1000 * 60 * 60 * 24);
    if (diff < 0) return { status: 'EXPIRADO', dias: diff };
    if (diff <= 30) return { status: 'VENCENDO', dias: diff };
    return { status: 'OK', dias: diff };
}

function parsePrice(value) {
    if (!value || value === '') return 0;
    let clean = String(value).trim().replace(/R\$/gi, '').replace(/\s+/g, '').replace(',', '.');
    const parsed = parseFloat(clean);
    return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeInsumos(rows, unidade = 'novo-hamburgo', config = { unidades: DEFAULT_UNIDADES, unidadeHeaders: { 'barra-shopping-sul': 'barrashoppingsul', 'novo-hamburgo': 'novo hamburgo' } }) {
    const unidades = Array.isArray(config?.unidades) && config.unidades.length ? config.unidades : DEFAULT_UNIDADES;
    return rows.map((item, idx) => {
        const estoques = Object.fromEntries(unidades.map((u) => [u, getStockFromParsedRow(item, u, config)]));
        const estoqueAtual = getStockFromParsedRow(item, unidade, config);
        const dataValidade = item['data validade'] || item.validade || null;
        return {
            registro: item.registro || String(idx + 1).padStart(3, '0'),
            codigoBarras: item['código'] || '',
            categoria: item.categoria || '',
            marca: item.marca || '',
            produto: item.produto || '',
            especificacao: item['especificação'] || '',
            concentracao: item['concentração'] || '',
            volume: item.volume || '',
            tipoUnidade: item.unidade || '',
            unidade: item.unidade || '',
            precoCusto: parsePrice(item['preço']),
            fonte: item.fonte || '',
            estoqueAtual,
            estoqueMinimo: parseInt(item['estoque mínimo']) || 0,
            dataValidade: dataValidade || null,
            lote: item.lote || '',
            statusValidade: calcularStatusValidade(dataValidade),
            dataCadastro: item['data cadastro'] || null,
            ultimaAtualizacao: item['data atualização'] || null,
            estoques,
            novoHamburgo: getStockFromParsedRow(item, 'novo-hamburgo', config),
            barraShoppingSul: getStockFromParsedRow(item, 'barra-shopping-sul', config),
        };
    });
}

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

// User sheet may include an optional column "UNIDADES" (comma/semicolon separated).
// If empty (or "*"), user can access all units.
function parseAllowedUnits(raw) {
    const text = String(raw || '').trim();
    if (!text) return [];
    const parts = text
        .split(/[,;|]/g)
        .map((p) => slugifyUnidade(p))
        .filter(Boolean);
    if (parts.includes('*')) return [];
    return Array.from(new Set(parts));
}

function parseUsers(rows) {
    if (!rows || rows.length < 2) return [];
    const headers = rows[0].map(h => (h || '').toLowerCase());
    return rows.slice(1).map((row) => {
        const obj = {};
        headers.forEach((h, i) => {
            obj[h] = row[i] ?? '';
        });
        const rawUnits = obj.unidades || obj.unidades_permitidas || obj.allowed_units || '';
        return {
            username: (obj.username || '').trim(),
            displayName: obj.display_name || obj.username || '',
            email: obj.email || '',
            role: obj.role || 'CONSULTOR',
            ativo: `${obj.ativo}`.toLowerCase() !== 'false' && `${obj.ativo}`.toUpperCase() !== 'FALSE' && `${obj.ativo}` !== '0',
            createdAt: obj.created_at || '',
            updatedAt: obj.updated_at || '',
            passwordHash: obj.password_hash || '',
            photoUrl: obj.photo_url || '',
            allowedUnits: parseAllowedUnits(rawUnits),
        };
    });
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
    if (!token) return null;
    try {
        if (secret && String(token).includes('.')) return await decodeSessionV2(token, secret);
    } catch {
        // fall back
    }
    const legacy = decodeSessionLegacy(token);
    if (!legacy) return null;
    const exp = Number(legacy?.exp || 0);
    if (exp && Date.now() > exp) return null;
    return legacy;
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

function toA1Col(index) {
    let n = index + 1;
    let s = '';
    while (n > 0) {
        const rem = (n - 1) % 26;
        s = String.fromCharCode(65 + rem) + s;
        n = Math.floor((n - 1) / 26);
    }
    return s;
}

function buildUserResponseFromSheetRow(row, headerMap) {
    const get = (key) => {
        const idx = headerMap[key];
        return idx === undefined ? '' : (row[idx] ?? '');
    };
    const username = (get('username') || '').toString().trim();
    const displayName = (get('display_name') || username).toString().trim();
    return {
        name: displayName || username,
        displayName: displayName || username,
        username,
        email: (get('email') || '').toString(),
        role: (get('role') || 'CONSULTOR').toString(),
        photoUrl: (get('photo_url') || '').toString(),
        allowedUnits: parseAllowedUnits(get('unidades') || get('unidades_permitidas') || get('allowed_units') || ''),
    };
}

function getHeaderMap(headerRow) {
    return Object.fromEntries((headerRow || []).map((h, i) => [String(h || '').toLowerCase(), i]));
}

function getInsumosUnidadeHeaderKeys(unidade, config) {
    return getUnidadeHeaderCandidates(unidade, config);
}

async function ensureHeaderColumns({ spreadsheetId, sheetName, accessToken, requiredHeaders }) {
    const headerValues = await readSheet(spreadsheetId, `${sheetName}!1:1`, accessToken);
    const current = (headerValues?.[0] || []).filter((h) => String(h || '').trim() !== '');
    const currentLower = current.map((h) => String(h).toLowerCase());
    const toAdd = requiredHeaders.filter((h) => !currentLower.includes(String(h).toLowerCase()));
    if (!toAdd.length) return current;

    const nextHeader = [...current, ...toAdd];
    const range = `${sheetName}!A1:${toA1Col(nextHeader.length - 1)}1`;
    await batchUpdate(spreadsheetId, [{ range, values: [nextHeader] }], accessToken);
    return nextHeader;
}

async function appendAuditLog({ env, spreadsheetId, accessToken, actor, role, ip, userAgent, action, entity, entityId, unidade, before, after, idempotencyKey }) {
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
        // ignore DB failures, keep sheet as fallback
    }

    const auditToSheets = env?.AUDIT_TO_SHEETS === 'true';
    if (!auditToSheets) return;

    await ensureSheetExists(spreadsheetId, AUDIT_SHEET_NAME, accessToken);
    await ensureHeaderColumns({
        spreadsheetId,
        sheetName: AUDIT_SHEET_NAME,
        accessToken,
        requiredHeaders: [
            'TIMESTAMP',
            'ACTOR',
            'ROLE',
            'ACTION',
            'ENTITY',
            'ENTITY_ID',
            'UNIDADE',
            'IP',
            'USER_AGENT',
            'IDEMPOTENCY_KEY',
            'BEFORE_JSON',
            'AFTER_JSON',
        ]
    });

    const headers = (await readSheet(spreadsheetId, `${AUDIT_SHEET_NAME}!1:1`, accessToken))?.[0] || [];
    const map = getHeaderMap(headers);
    const row = ensureRowLength([], headers.length);
    setIfPresent(row, map, 'timestamp', ts);
    setIfPresent(row, map, 'actor', actor || '');
    setIfPresent(row, map, 'role', role || '');
    setIfPresent(row, map, 'action', action || '');
    setIfPresent(row, map, 'entity', entity || '');
    setIfPresent(row, map, 'entity_id', entityId || '');
    setIfPresent(row, map, 'unidade', unidade || '');
    setIfPresent(row, map, 'ip', ip || '');
    setIfPresent(row, map, 'user_agent', userAgent || '');
    setIfPresent(row, map, 'idempotency_key', idempotencyKey || '');
    setIfPresent(row, map, 'before_json', safeJson(before));
    setIfPresent(row, map, 'after_json', safeJson(after));

    await writeSheet(spreadsheetId, `${AUDIT_SHEET_NAME}!A:AZ`, [row], accessToken, 'APPEND');
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
    if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY) return;

    const config = getInsumosConfig(env);
    const accessToken = await authenticate(env.GOOGLE_SERVICE_ACCOUNT_EMAIL, env.GOOGLE_PRIVATE_KEY);
    const spreadsheetId = env.SPREADSHEET_ID;
    const sheetRange = env.SHEET_RANGE || 'Insumos!A:AZ';

    const values = await readSheet(spreadsheetId, sheetRange, accessToken);
    const parsed = parseInsumos(values);
    const unit = unidade ? slugifyUnidade(unidade) : null;
    const unidades = unit ? [unit] : config.unidades;

    for (const u of unidades) {
        const insumos = normalizeInsumos(parsed, u, config);
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

function nextRegistroFromValues(values, registroIdx) {
    let max = 0;
    for (const row of values.slice(1)) {
        const raw = (row?.[registroIdx] || '').toString().trim();
        const n = parseInt(raw, 10);
        if (Number.isFinite(n)) max = Math.max(max, n);
    }
    return String(max + 1).padStart(3, '0');
}

function ensureRowLength(row, len) {
    const r = Array.isArray(row) ? [...row] : [];
    while (r.length < len) r.push('');
    return r;
}

function setIfPresent(row, headerMap, headerKeyLower, value) {
    const idx = headerMap[headerKeyLower];
    if (idx === undefined) return;
    row[idx] = value ?? '';
}

function parseMovimentacoes(values) {
    if (!values || values.length < 2) return [];
    const headers = values[0] || [];
    const map = getHeaderMap(headers);
    return values.slice(1).map((row) => {
        const r = row || [];
        const get = (key) => {
            const idx = map[key];
            return idx === undefined ? '' : (r[idx] ?? '');
        };
        const dataHora = (get('data/hora') || '').toString();
        return {
            id: get('id movimentação') || '',
            dataHora,
            tipo: get('tipo') || '',
            codigoBarras: get('código de barras') || '',
            produto: get('produto') || '',
            quantidade: Number(get('quantidade')) || 0,
            estoqueAnterior: Number(get('estoque anterior')) || 0,
            estoqueNovo: Number(get('estoque novo')) || 0,
            unidade: get('unidade') || '',
            unidadeOrigem: get('unidade origem') || '',
            unidadeDestino: get('unidade destino') || '',
            transferId: get('id transferência') || '',
            usuario: get('usuário') || '',
            motivo: get('motivo') || '',
            observacoes: get('observações') || ''
        };
    }).filter((m) => m.dataHora || m.tipo || m.codigoBarras || m.produto);
}

/**
 * Convert structured data back to rows for Sheets
 */
function toSheetRows(data, headers) {
    return data.map(item => headers.map(h => item[h] || ''));
}

export default {
    async fetch(request, env, ctx) {
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
        const appOrigin = env.APP_ORIGIN || "https://crm.skincos.com.br";
        const defaultUnidade = UNIDADES[0] || 'novo-hamburgo';
        const unidade = slugifyUnidade(url.searchParams.get('unidade') || '') || defaultUnidade;
        const cookies = parseCookies(request.headers.get('cookie') || '');
        const ip = getClientIp(request);
        const userAgent = getUserAgent(request);
        const idempotencyKey = request.headers.get('idempotency-key') || request.headers.get('Idempotency-Key') || '';
        const isSecureContext = url.protocol === 'https:';

        const enforceRateLimit = async (kind) => {
            if (!env.RATE_LIMITER) return { allowed: true };
            const windowSec = 60;
            const cfg = {
                auth: { limit: 20 },
                read: { limit: 240 },
                write: { limit: 60 }
            }[kind] || { limit: 120 };
            const key = `${ip}:${kind}`;
            const id = env.RATE_LIMITER.idFromName(ip);
            const stub = env.RATE_LIMITER.get(id);
            const res = await stub.fetch(`https://rl/?key=${encodeURIComponent(key)}&limit=${cfg.limit}&window=${windowSec}`);
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

        // Public endpoints (must not depend on Google auth / secrets)
        if (url.pathname === "/health") {
            const sheetsEnv = {
                spreadsheetIdPresent: !!env?.SPREADSHEET_ID,
                serviceAccountEmailPresent: !!env?.GOOGLE_SERVICE_ACCOUNT_EMAIL,
                privateKeyPresent: !!env?.GOOGLE_PRIVATE_KEY,
            };
            const sheetsMissing = [
                sheetsEnv.spreadsheetIdPresent ? null : 'SPREADSHEET_ID',
                sheetsEnv.serviceAccountEmailPresent ? null : 'GOOGLE_SERVICE_ACCOUNT_EMAIL',
                sheetsEnv.privateKeyPresent ? null : 'GOOGLE_PRIVATE_KEY',
            ].filter(Boolean);

            return withCORS(
                JSON.stringify({
                    ok: true,
                    service: "insumos",
                    runtime: "cloudflare-workers",
                    dbConfigured: !!env?.DB,
                    sheetsConfigured: sheetsMissing.length === 0,
                    unidades: UNIDADES,
                    sheets: {
                        ...sheetsEnv,
                        missing: sheetsMissing,
                        hint: sheetsMissing.length === 0
                            ? 'Sheets enabled'
                            : 'Sheets disabled (configure missing env vars for local dev or secrets in Cloudflare)'
                    },
                }),
                { status: 200 },
                appOrigin
            );
        }
        if (url.pathname === "/api/metrics" || url.pathname === "/metrics") {
            return withCORS(JSON.stringify({ success: true }), { status: 200 }, appOrigin);
        }

        // Basic rate limiting (Durable Object)
        try {
            const isAuth = url.pathname.startsWith('/auth/');
            const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);
            const kind = isAuth ? 'auth' : (isMutating ? 'write' : 'read');
            const rl = await enforceRateLimit(kind);
            if (!rl.allowed) {
                return withCORS(JSON.stringify({ success: false, error: 'Rate limit excedido', code: 'RATE_LIMITED' }), { status: 429 }, appOrigin);
            }
        } catch {
            // If rate limiting fails, continue without blocking
        }

        // Get credentials and authenticate
        let accessToken;
        try {
            if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY) {
                throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY not configured");
            }
            accessToken = await authenticate(env.GOOGLE_SERVICE_ACCOUNT_EMAIL, env.GOOGLE_PRIVATE_KEY);
        } catch (err) {
            return withCORS(JSON.stringify({ error: `Auth failed: ${err.message}` }), { status: 500 }, appOrigin);
        }

        const spreadsheetId = env.SPREADSHEET_ID || '';
        if (!spreadsheetId) {
            return withCORS(JSON.stringify({ error: "SPREADSHEET_ID not configured" }), { status: 500 }, appOrigin);
        }
        const sheetRange = env.SHEET_RANGE || 'Insumos!A:AZ';
        const userRange = env.USER_SHEET_RANGE || 'Usuarios!A:AZ';
        const movimentacoesRange = env.MOVIMENTACOES_RANGE || 'Movimentacoes!A:AZ';
        const insumosSheetName = sheetRange.split('!')[0] || 'Insumos';
        const movimentacoesSheetName = movimentacoesRange.split('!')[0] || 'Movimentacoes';

        const sessionSecret = env.SESSION_SECRET || '';

        const issueAuthCookies = async (sessionPayload) => {
            const csrf = crypto.randomUUID();
            const exp = Date.now() + 7 * 24 * 60 * 60 * 1000;
            const payload = { ...sessionPayload, csrf, exp };
            const token = sessionSecret ? await encodeSessionV2(payload, sessionSecret) : encodeSessionLegacy(payload);

            // Dev (http) cannot set Secure cookies; SameSite=None also requires Secure.
            const sameSite = isSecureContext ? 'None' : 'Lax';
            const secureAttr = isSecureContext ? '; Secure' : '';
            const headers = new Headers();
            headers.append('Set-Cookie', `session=${token}; Path=/; HttpOnly${secureAttr}; SameSite=${sameSite}; Max-Age=604800`);
            headers.append('Set-Cookie', `csrfToken=${csrf}; Path=/${secureAttr}; SameSite=${sameSite}; Max-Age=604800`);
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
            const userRows = await readSheet(spreadsheetId, userRange, accessToken);
            const users = parseUsers(userRows);
            const userDb = users.find(u => u.username.toLowerCase() === sessionUsername.toLowerCase());
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
            return { ok: true, user: u };
        };

        const authResp = await handleAuthRoutes({
            request,
            url,
            appOrigin,
            withCORS,
            spreadsheetId,
            userRange,
            accessToken,
            sessionUsername,
            sessionCsrf,
            cookies,
            readSheet,
            parseUsers,
            bcrypt,
            issueAuthCookies,
            deleteAuthCookies: () => deleteAuthCookies({ secure: isSecureContext }),
            validateUsername,
            batchUpdate,
            toA1Col,
            buildUserResponseFromSheetRow,
            MAX_PROFILE_PHOTO_URL_CHARS,
        });
        if (authResp) return authResp;

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
        }

        // Ensure optional columns exist for app features
        if (url.pathname.startsWith("/insumos") || url.pathname.startsWith("/relatorios") || url.pathname.startsWith("/alertas") || url.pathname.startsWith("/analytics") || url.pathname.startsWith("/movimentacoes")) {
            try {
                await ensureHeaderColumns({
                    spreadsheetId,
                    sheetName: insumosSheetName,
                    accessToken,
                    requiredHeaders: ['LOTE', 'DATA VALIDADE']
                });
            } catch (e) {
                // ignore header upgrade failures; read-only still works
            }
        }

        const movResp = await handleMovimentacoesRoutes({
            request,
            url,
            appOrigin,
            withCORS,
            spreadsheetId,
            accessToken,
            movimentacoesSheetName,
            movimentacoesRange,
            ensureHeaderColumns,
            readSheet,
            parseMovimentacoes,
            sheetRange,
            parseInsumos,
            normalizeInsumos: (rows, u) => normalizeInsumos(rows, u, config),
            unidade,
        });
        if (movResp) return movResp;

        const insumosResp = await handleInsumosRoutes({
            request,
            url,
            env,
            ctx,
            appOrigin,
            withCORS,
            spreadsheetId,
            accessToken,
            unidade,

            insumosSheetName,
            sheetRange,

            movimentacoesSheetName,
            movimentacoesRange,

            UNIDADES,

            readSheet,
            writeSheet,
            batchUpdate,
            deleteRows,

            ensureHeaderColumns,
            getHeaderMap,
            getInsumosUnidadeHeaderKeys: (u) => getInsumosUnidadeHeaderKeys(u, config),
            ensureRowLength,
            setIfPresent,
            toA1Col,

            parseInsumos,
            normalizeInsumos: (rows, u) => normalizeInsumos(rows, u, config),

            nextRegistroFromValues,
            requireRoles,
            appendAuditLog,
            enqueueNotificationsRefresh,

            ip,
            userAgent,
            idempotencyKey,

            qrSvg,
        });
        if (insumosResp) return insumosResp;


        const exportsResp = await handleExportsRoutes({
            request,
            url,
            env,
            appOrigin,
            withCORS,
            spreadsheetId,
            accessToken,
            sheetRange,
            movimentacoesRange,
            movimentacoesSheetName,
            unidade,
            readSheet,
            ensureHeaderColumns,
            parseMovimentacoes,
            normalizeInsumos,
            parseInsumos,
            computeNotificationsForUnidade,
            safeJson,
            toCsv,
            qrSvg,
        });
        if (exportsResp) return exportsResp;

        const auditResp = await handleAuditRoutes({
            request,
            url,
            env,
            appOrigin,
            withCORS,
            requireRoles,
            spreadsheetId,
            accessToken,
            readSheet,
            ensureSheetExists,
            getHeaderMap,
            AUDIT_SHEET_NAME,
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
            spreadsheetId,
            accessToken,
            sheetRange,
            userRange,
            movimentacoesRange,
            ip,
            userAgent,
            idempotencyKey,
        });
        if (backupResp) return backupResp;

        const insightsResp = await handleInsightsRoutes({
            request,
            url,
            appOrigin,
            withCORS,
            spreadsheetId,
            accessToken,
            sheetRange,
            movimentacoesRange,
            movimentacoesSheetName,
            unidade,
            ensureHeaderColumns,
            readSheet,
            parseInsumos,
            normalizeInsumos: (rows, u) => normalizeInsumos(rows, u, config),
            parseMovimentacoes,
            buildActionables: (itens, u) => buildActionables(itens, u, config),
            buildRoi,
            buildQualityReport,
            stockDistribution,
            buildResumoEstoque,
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
