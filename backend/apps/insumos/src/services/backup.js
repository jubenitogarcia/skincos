// @ts-nocheck
import { readSheet } from '../../workers/sheets-api.js';
import { safeJsonNoTruncate } from '../lib/json.js';

// -------------------------------------------------------------
// Backups (Cloudflare-only)
// - Prefer storing large payloads in R2 when BACKUP_BUCKET exists.
// - Fallback: store payload_json directly in D1.
// -------------------------------------------------------------
export async function clearSheetRange(spreadsheetId, range, accessToken) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
    });
    if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`Sheets clear failed: ${res.status} ${t}`.trim());
    }
}

export async function buildBackupPayload({ spreadsheetId, accessToken, sheetRange, userRange, movimentacoesRange, env }) {
    const insumosValues = await readSheet(spreadsheetId, sheetRange, accessToken);
    const usersValues = await readSheet(spreadsheetId, userRange, accessToken);
    const movValues = await readSheet(spreadsheetId, movimentacoesRange, accessToken);

    let auditLog = [];
    let notifSnapshots = [];

    if (env?.DB) {
        try {
            const a = await env.DB.prepare(
                `SELECT ts, actor, role, action, entity, entity_id as entityId, unidade, ip, user_agent as userAgent, idempotency_key as idempotencyKey, before_json as beforeJson, after_json as afterJson
                 FROM audit_log
                 ORDER BY ts DESC
                 LIMIT 2000`
            ).all();
            auditLog = a?.results || [];
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
            notifSnapshots = n?.results || [];
        } catch {
            // ignore
        }
    }

    return {
        version: 1,
        createdAt: new Date().toISOString(),
        sources: {
            sheets: {
                sheetRange,
                userRange,
                movimentacoesRange,
            },
            d1: {
                enabled: !!env?.DB,
                auditLogCount: auditLog.length,
                notificationSnapshotCount: notifSnapshots.length,
            },
        },
        sheets: {
            insumosValues,
            usersValues,
            movValues,
        },
        d1: {
            auditLog,
            notificationSnapshots: notifSnapshots,
        },
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
            insumosRows: (payload?.sheets?.insumosValues?.length || 0) - 1,
            usersRows: (payload?.sheets?.usersValues?.length || 0) - 1,
            movRows: (payload?.sheets?.movValues?.length || 0) - 1,
        },
        d1: payload?.sources?.d1 || { enabled: false },
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
