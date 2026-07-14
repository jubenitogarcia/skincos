// @ts-nocheck

import {
    buildBackupPayload,
    cleanupBackupSnapshots,
    getBackupStatus,
    listBackupSnapshots,
    loadBackupSnapshot,
    persistBackupSnapshot,
    restoreBackupPayload,
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

            const payload = await buildBackupPayload({ env });

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
            try {
                await restoreBackupPayload({ env, payload: p });
            } catch (restoreErr) {
                const msg = String(restoreErr?.message || restoreErr || '');
                const status = msg === 'PAYLOAD_INVALID' ? 400 : 500;
                return withCORS(JSON.stringify({ success: false, error: msg || 'Erro ao restaurar backup' }), { status }, appOrigin);
            }

            await appendAuditLog({
                env,
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
