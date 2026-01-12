// @ts-nocheck

import { writeSheet } from '../../workers/sheets-api.js';
import {
    buildBackupPayload,
    cleanupBackupSnapshots,
    clearSheetRange,
    getBackupStatus,
    listBackupSnapshots,
    loadBackupSnapshot,
    persistBackupSnapshot,
} from '../services/backup.js';

export async function handleBackupRoutes({
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
}) {
    if (url.pathname === "/backup/status" && request.method === "GET") {
        try {
            const auth = await requireRoles(['ADMIN', 'GESTOR']);
            if (!auth.ok) return auth.response;
            const status = await getBackupStatus({ env });
            return withCORS(JSON.stringify({ success: true, data: status }), { status: 200 }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }

    if (url.pathname === "/backup/list" && request.method === "GET") {
        try {
            const auth = await requireRoles(['ADMIN', 'GESTOR']);
            if (!auth.ok) return auth.response;
            const limit = url.searchParams.get('limit') || '10';
            const items = await listBackupSnapshots({ env, limit });
            return withCORS(JSON.stringify({ success: true, data: items }), { status: 200 }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }

    if (url.pathname === "/backup/trigger" && request.method === "POST") {
        try {
            const auth = await requireRoles(['ADMIN', 'GESTOR']);
            if (!auth.ok) return auth.response;

            const payload = await buildBackupPayload({
                spreadsheetId,
                accessToken,
                sheetRange,
                userRange,
                movimentacoesRange,
                env
            });

            const stored = await persistBackupSnapshot({
                env,
                actor: auth.user.username,
                role: auth.user.role,
                unidade: url.searchParams.get('unidade') || unidade,
                kind: 'FULL',
                payload
            });

            await appendAuditLog({
                env,
                spreadsheetId,
                accessToken,
                actor: auth.user.username,
                role: auth.user.role,
                ip,
                userAgent,
                idempotencyKey,
                action: 'BACKUP',
                entity: 'BACKUP',
                entityId: String(stored?.id || ''),
                unidade: url.searchParams.get('unidade') || unidade,
                before: null,
                after: { stored }
            });

            return withCORS(JSON.stringify({ success: true, data: stored }), { status: 200 }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }

    if (url.pathname === "/backup/cleanup" && request.method === "POST") {
        try {
            const auth = await requireRoles(['ADMIN', 'GESTOR']);
            if (!auth.ok) return auth.response;
            const body = await request.json().catch(() => ({}));
            const daysToKeep = body.daysToKeep ?? body.days ?? 30;
            const result = await cleanupBackupSnapshots({ env, daysToKeep });
            return withCORS(JSON.stringify({ success: true, data: result }), { status: 200 }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }

    if (url.pathname === "/backup/restore" && request.method === "POST") {
        try {
            const auth = await requireRoles(['ADMIN', 'GESTOR']);
            if (!auth.ok) return auth.response;

            const body = await request.json().catch(() => ({}));
            const id = body.id ?? body.backupId;
            const confirm = String(body.confirm || '').toUpperCase();
            if (!id) return withCORS(JSON.stringify({ success: false, error: 'backup id requerido' }), { status: 400 }, appOrigin);
            if (confirm !== 'RESTORE') {
                return withCORS(JSON.stringify({ success: false, error: 'Confirmação necessária', hint: 'Envie {"confirm":"RESTORE"}' }), { status: 400 }, appOrigin);
            }

            const snap = await loadBackupSnapshot({ env, id });
            const p = snap?.payload;
            if (!p?.sheets?.insumosValues || !p?.sheets?.usersValues || !p?.sheets?.movValues) {
                return withCORS(JSON.stringify({ success: false, error: 'Payload inválido' }), { status: 400 }, appOrigin);
            }

            // Restore Sheets (clear then write full values)
            await clearSheetRange(spreadsheetId, sheetRange, accessToken);
            await writeSheet(spreadsheetId, sheetRange, p.sheets.insumosValues, accessToken, 'UPDATE');

            await clearSheetRange(spreadsheetId, userRange, accessToken);
            await writeSheet(spreadsheetId, userRange, p.sheets.usersValues, accessToken, 'UPDATE');

            await clearSheetRange(spreadsheetId, movimentacoesRange, accessToken);
            await writeSheet(spreadsheetId, movimentacoesRange, p.sheets.movValues, accessToken, 'UPDATE');

            // Best-effort restore D1 snapshots (do not touch jobs)
            if (env?.DB && p?.d1) {
                try {
                    await env.DB.prepare('DELETE FROM audit_log').run();
                    for (const row of (p.d1.auditLog || []).reverse()) {
                        await env.DB.prepare(
                            `INSERT INTO audit_log (ts, actor, role, action, entity, entity_id, unidade, ip, user_agent, idempotency_key, before_json, after_json)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                        )
                            .bind(
                                row.ts || row.timestamp || new Date().toISOString(),
                                row.actor || '',
                                row.role || '',
                                row.action || '',
                                row.entity || '',
                                row.entityId || '',
                                row.unidade || '',
                                row.ip || '',
                                row.userAgent || '',
                                row.idempotencyKey || '',
                                row.beforeJson || null,
                                row.afterJson || null
                            )
                            .run();
                    }
                } catch {
                    // ignore
                }
                try {
                    await env.DB.prepare('DELETE FROM notification_snapshot').run();
                    for (const row of (p.d1.notificationSnapshots || []).reverse()) {
                        await env.DB.prepare(
                            `INSERT INTO notification_snapshot (ts, unidade, low_stock, expiring_soon, expired_with_stock, payload_json)
                             VALUES (?, ?, ?, ?, ?, ?)`
                        )
                            .bind(
                                row.ts || new Date().toISOString(),
                                row.unidade || '',
                                Number(row.lowStock || 0),
                                Number(row.expiringSoon || 0),
                                Number(row.expiredWithStock || 0),
                                row.payloadJson || null
                            )
                            .run();
                    }
                } catch {
                    // ignore
                }
            }

            await appendAuditLog({
                env,
                spreadsheetId,
                accessToken,
                actor: auth.user.username,
                role: auth.user.role,
                ip,
                userAgent,
                idempotencyKey,
                action: 'RESTORE_BACKUP',
                entity: 'BACKUP',
                entityId: String(id),
                unidade: url.searchParams.get('unidade') || unidade,
                before: null,
                after: { restored: true }
            });

            ctx.waitUntil(enqueueNotificationsRefresh(env, unidade));
            return withCORS(JSON.stringify({ success: true, data: { restored: true, id } }), { status: 200 }, appOrigin);
        } catch (err) {
            return withCORS(JSON.stringify({ success: false, error: err.message }), { status: 500 }, appOrigin);
        }
    }

    return null;
}
