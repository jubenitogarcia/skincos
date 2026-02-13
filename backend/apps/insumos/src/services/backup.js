// @ts-nocheck
import { safeJsonNoTruncate } from '../lib/json.js';
import { resolveCrmTables } from '../d1Store.js';

async function tableHasColumn(env, tableName, columnName) {
    if (!env?.DB || !tableName || !columnName) return false;
    const t = String(tableName);
    if (!['crm_users', 'insumos_users'].includes(t)) return false;
    try {
        const res = await env.DB.prepare(`PRAGMA table_info(${t})`).all();
        const cols = (res?.results || []).map((r) => String(r?.name || '').toLowerCase());
        return cols.includes(String(columnName).toLowerCase());
    } catch {
        return false;
    }
}

// -------------------------------------------------------------
// Backups (Cloudflare-only)
// - Prefer storing large payloads in R2 when BACKUP_BUCKET exists.
// - Fallback: store payload_json directly in D1.
// -------------------------------------------------------------
export async function buildBackupPayload({ env }) {

    const d1Dump = {
        auditLog: [],
        notificationSnapshots: [],
        shareHistory: [],
        insumosUsers: [],
        crmUsers: [],
        insumosItems: [],
        insumosStocks: [],
        insumosMovements: [],
    };

    if (env?.DB) {
        try {
            const a = await env.DB.prepare(
                `SELECT ts, actor, role, action, entity, entity_id as entityId, unidade, ip, user_agent as userAgent, idempotency_key as idempotencyKey, before_json as beforeJson, after_json as afterJson
                 FROM audit_log
                 ORDER BY ts DESC
                 LIMIT 2000`
            ).all();
            d1Dump.auditLog = a?.results || [];
        } catch {
            // ignore
        }
        try {
            const n = await env.DB.prepare(
                `SELECT ts, unidade, low_stock as lowStock, expiring_soon as expiringSoon, expired_with_stock as expiredWithStock, payload_json as payloadJson
                 FROM notification_snapshot
                 ORDER BY ts DESC
                 LIMIT 500`
            ).all();
            d1Dump.notificationSnapshots = n?.results || [];
        } catch {
            // ignore
        }
        try {
            const s = await env.DB.prepare(
                `SELECT id, user, created_at as createdAt, title, text, url, files_json as filesJson, source_id as sourceId
                 FROM share_history
                 ORDER BY created_at DESC
                 LIMIT 500`
            ).all();
            d1Dump.shareHistory = s?.results || [];
        } catch {
            // ignore
        }
        try {
            const { usersTable } = await resolveCrmTables(env);
            const hasModules = await tableHasColumn(env, usersTable, 'allowed_modules_json');
            const u = await env.DB.prepare(
                `SELECT username, email, display_name as displayName, password_hash as passwordHash, role, photo_url as photoUrl,
                        allowed_units_json as allowedUnitsJson${hasModules ? ', allowed_modules_json as allowedModulesJson' : ''},
                        ativo, created_at as createdAt, updated_at as updatedAt
                 FROM ${usersTable}`
            ).all();
            d1Dump.insumosUsers = u?.results || [];
            d1Dump.crmUsers = d1Dump.insumosUsers;
        } catch {
            // ignore
        }
        try {
            const it = await env.DB.prepare(
                `SELECT registro, codigo_barras as codigoBarras, produto, categoria, marca, especificacao, concentracao, volume, calibre, tipo_unidade as tipoUnidade,
                        fonte, preco_custo as precoCusto, estoque_minimo as estoqueMinimo, lote, data_validade as dataValidade,
                        policy_requires_lot as policyRequiresLot, policy_requires_expiry as policyRequiresExpiry, policy_fefo as policyFefo,
                        data_cadastro as dataCadastro, data_atualizacao as dataAtualizacao
                 FROM insumos_items`
            ).all();
            d1Dump.insumosItems = it?.results || [];
        } catch {
            // ignore
        }
        try {
            const st = await env.DB.prepare(
                `SELECT registro, unidade, quantidade, updated_at as updatedAt
                 FROM insumos_stocks`
            ).all();
            d1Dump.insumosStocks = st?.results || [];
        } catch {
            // ignore
        }
        try {
            const mv = await env.DB.prepare(
                `SELECT id, data_hora as dataHora, tipo, codigo_barras as codigoBarras, registro_insumo as registroInsumo, lote, data_validade as dataValidade, produto, quantidade,
                        estoque_anterior as estoqueAnterior, estoque_novo as estoqueNovo, unidade, unidade_origem as unidadeOrigem, unidade_destino as unidadeDestino,
                        id_transferencia as transferId, usuario, motivo, observacoes
                 FROM insumos_movements`
            ).all();
            d1Dump.insumosMovements = mv?.results || [];
        } catch {
            // ignore
        }
    }

    return {
        version: 1,
        createdAt: new Date().toISOString(),
        sources: {
            d1: {
                enabled: !!env?.DB,
                auditLogCount: d1Dump.auditLog.length,
                notificationSnapshotCount: d1Dump.notificationSnapshots.length,
                shareHistoryCount: d1Dump.shareHistory.length,
                insumosUsersCount: d1Dump.insumosUsers.length,
                insumosItemsCount: d1Dump.insumosItems.length,
                insumosStocksCount: d1Dump.insumosStocks.length,
                insumosMovementsCount: d1Dump.insumosMovements.length,
            },
        },
        d1: d1Dump,
    };
}

export async function persistBackupSnapshot({ env, actor, role, unidade, kind, payload }) {
    if (!env?.DB) {
        return { stored: false, reason: 'DB_NOT_CONFIGURED' };
    }

    const ts = new Date().toISOString();
    const metadata = {
        kind: kind || 'FULL',
        sizes: {
            d1: payload?.sources?.d1 || { enabled: false },
        },
    };

    // Prefer R2 for large payloads if configured.
    let payloadJson = safeJsonNoTruncate(payload);
    let storage = { type: 'd1' };

    try {
        const bucket = env?.BACKUP_BUCKET;
        if (bucket && typeof bucket.put === 'function') {
            const key = `backups/insumos-${ts.replace(/[:.]/g, '-')}-${crypto.randomUUID()}.json`;
            await bucket.put(key, payloadJson, {
                httpMetadata: { contentType: 'application/json; charset=utf-8' },
                customMetadata: {
                    kind: String(kind || 'FULL'),
                    ts,
                    unidade: String(unidade || ''),
                    actor: String(actor || ''),
                },
            });
            storage = { type: 'r2', key };
            payloadJson = null;
        }
    } catch {
        // fallback to D1
    }

    const r = await env.DB.prepare(
        `INSERT INTO backup_snapshots (ts, actor, role, unidade, kind, metadata_json, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
        .bind(
            ts,
            actor || '',
            role || '',
            unidade || '',
            kind || 'FULL',
            safeJsonNoTruncate({ ...metadata, storage }),
            payloadJson
        )
        .run();

    const id = r?.meta?.last_row_id;
    return { stored: true, id, ts, storage };
}

export async function loadBackupSnapshot({ env, id }) {
    if (!env?.DB) throw new Error('DB_NOT_CONFIGURED');
    const row = await env.DB.prepare(
        `SELECT id, ts, actor, role, unidade, kind, metadata_json as metadataJson, payload_json as payloadJson
         FROM backup_snapshots
         WHERE id = ?`
    )
        .bind(Number(id))
        .first();
    if (!row) throw new Error('BACKUP_NOT_FOUND');

    const metadata = row.metadataJson ? JSON.parse(row.metadataJson) : {};
    let payload = row.payloadJson ? JSON.parse(row.payloadJson) : null;
    const storage = metadata?.storage;

    if (!payload && storage?.type === 'r2') {
        const bucket = env?.BACKUP_BUCKET;
        if (!bucket || typeof bucket.get !== 'function') {
            throw new Error('BACKUP_BUCKET_NOT_CONFIGURED');
        }
        const obj = await bucket.get(storage.key);
        if (!obj) throw new Error('BACKUP_OBJECT_NOT_FOUND');
        const text = await obj.text();
        payload = JSON.parse(text);
    }

    return { ...row, metadata, payload };
}

export async function listBackupSnapshots({ env, limit = 10 }) {
    if (!env?.DB) return [];
    const lim = Math.max(1, Math.min(100, Number(limit) || 10));
    const r = await env.DB.prepare(
        `SELECT id, ts, actor, role, unidade, kind, metadata_json as metadataJson
         FROM backup_snapshots
         ORDER BY ts DESC
         LIMIT ?`
    )
        .bind(lim)
        .all();
    return (r?.results || []).map((x) => ({
        ...x,
        metadata: x.metadataJson ? JSON.parse(x.metadataJson) : {},
    }));
}

export async function cleanupBackupSnapshots({ env, daysToKeep = 30 }) {
    if (!env?.DB) return { deleted: 0 };
    const days = Math.max(1, Math.min(3650, Number(daysToKeep) || 30));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // List candidates first (to delete R2 objects if needed)
    const candidates = await env.DB.prepare(
        `SELECT id, metadata_json as metadataJson
         FROM backup_snapshots
         WHERE ts < ?`
    )
        .bind(cutoff)
        .all();

    const rows = candidates?.results || [];
    const bucket = env?.BACKUP_BUCKET;
    if (bucket && typeof bucket.delete === 'function') {
        for (const r of rows) {
            try {
                const meta = r.metadataJson ? JSON.parse(r.metadataJson) : {};
                if (meta?.storage?.type === 'r2' && meta?.storage?.key) {
                    await bucket.delete(meta.storage.key);
                }
            } catch {
                // ignore
            }
        }
    }

    const del = await env.DB.prepare(`DELETE FROM backup_snapshots WHERE ts < ?`).bind(cutoff).run();
    return { deleted: Number(del?.meta?.changes || 0), cutoff, daysToKeep: days };
}

export async function getBackupStatus({ env }) {
    if (!env?.DB) return { db: false };
    const row = await env.DB.prepare(`SELECT ts FROM backup_snapshots ORDER BY ts DESC LIMIT 1`).first();
    return {
        db: true,
        lastBackupTs: row?.ts || null,
        r2: !!(env?.BACKUP_BUCKET && typeof env.BACKUP_BUCKET.get === 'function'),
    };
}
