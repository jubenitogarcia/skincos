// @ts-nocheck

import {
    buildBackupPayload,
    cleanupBackupSnapshots,
    getBackupStatus,
    listBackupSnapshots,
    loadBackupSnapshot,
    persistBackupSnapshot,
} from '../services/backup.js';
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
            const hasSheets = !!(p?.sheets?.insumosValues && p?.sheets?.usersValues && p?.sheets?.movValues);
	            const hasD1Insumos = !!(
	                p?.d1 &&
	                (Array.isArray(p.d1.insumosItems) ||
	                    Array.isArray(p.d1.crmUsers) ||
	                    Array.isArray(p.d1.insumosUsers) ||
	                    Array.isArray(p.d1.insumosStocks) ||
	                    Array.isArray(p.d1.insumosMovements))
	            );

            if (!hasSheets && !hasD1Insumos) {
                return withCORS(JSON.stringify({ success: false, error: 'Payload inválido' }), { status: 400 }, appOrigin);
            }

            if (hasSheets && !hasD1Insumos) {
                return withCORS(
                    JSON.stringify({ success: false, error: 'Backup legado (Sheets) não é suportado. Gere um novo backup a partir do D1.' }),
                    { status: 400 },
                    appOrigin
                );
            }

            // Restore D1 (includes Insumos tables + snapshots; does not touch jobs/backups)
            if (env?.DB && p?.d1) {
                try {
	                    const { usersTable } = await resolveCrmTables(env);
	                    const usersHasModules = await tableHasColumn(env, usersTable, 'allowed_modules_json');
	                    const usersRows = Array.isArray(p.d1.crmUsers)
	                        ? p.d1.crmUsers
	                        : (Array.isArray(p.d1.insumosUsers) ? p.d1.insumosUsers : []);

	                    if (Array.isArray(p.d1.insumosStocks)) await env.DB.prepare('DELETE FROM insumos_stocks').run();
	                    if (Array.isArray(p.d1.insumosMovements)) await env.DB.prepare('DELETE FROM insumos_movements').run();
	                    if (Array.isArray(p.d1.insumosItems)) await env.DB.prepare('DELETE FROM insumos_items').run();
	                    if (usersRows.length) await env.DB.prepare(`DELETE FROM ${usersTable}`).run();
	                    if (Array.isArray(p.d1.shareHistory)) await env.DB.prepare('DELETE FROM share_history').run();

	                    for (const row of (usersRows || []).reverse()) {
	                        if (usersHasModules) {
	                            await env.DB.prepare(
	                                `INSERT INTO ${usersTable} (username, email, display_name, password_hash, role, photo_url, allowed_units_json, allowed_modules_json, ativo, created_at, updated_at)
	                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	                            )
	                                .bind(
	                                    row.username || '',
	                                    row.email || '',
	                                    row.displayName || '',
	                                    row.passwordHash || '',
	                                    row.role || 'CONSULTOR',
	                                    row.photoUrl || '',
	                                    row.allowedUnitsJson || null,
	                                    row.allowedModulesJson || null,
	                                    Number(row.ativo || 0) ? 1 : 0,
	                                    row.createdAt || new Date().toISOString(),
	                                    row.updatedAt || new Date().toISOString()
	                                )
	                                .run();
	                        } else {
	                            await env.DB.prepare(
	                                `INSERT INTO ${usersTable} (username, email, display_name, password_hash, role, photo_url, allowed_units_json, ativo, created_at, updated_at)
	                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	                            )
	                                .bind(
	                                    row.username || '',
	                                    row.email || '',
	                                    row.displayName || '',
	                                    row.passwordHash || '',
	                                    row.role || 'CONSULTOR',
	                                    row.photoUrl || '',
	                                    row.allowedUnitsJson || null,
	                                    Number(row.ativo || 0) ? 1 : 0,
	                                    row.createdAt || new Date().toISOString(),
	                                    row.updatedAt || new Date().toISOString()
	                                )
	                                .run();
	                        }
	                    }
                    for (const row of (p.d1.insumosItems || []).reverse()) {
                        await env.DB.prepare(
                            `INSERT INTO insumos_items
                             (registro, codigo_barras, produto, categoria, marca, especificacao, concentracao, volume, calibre, tipo_unidade,
                              fonte, preco_custo, estoque_minimo, lote, data_validade, data_cadastro, data_atualizacao)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                        )
                            .bind(
                                row.registro || '',
                                row.codigoBarras || '',
                                row.produto || '',
                                row.categoria || '',
                                row.marca || '',
                                row.especificacao || '',
                                row.concentracao || '',
                                row.volume || '',
                                row.calibre || '',
                                row.tipoUnidade || '',
                                row.fonte || '',
                                Number(row.precoCusto || 0),
                                Number(row.estoqueMinimo || 0),
                                row.lote || '',
                                row.dataValidade || '',
                                row.dataCadastro || new Date().toISOString(),
                                row.dataAtualizacao || new Date().toISOString()
                            )
                            .run();
                    }
                    for (const row of (p.d1.insumosStocks || []).reverse()) {
                        await env.DB.prepare(
                            `INSERT INTO insumos_stocks (registro, unidade, quantidade, updated_at)
                             VALUES (?, ?, ?, ?)`
                        )
                            .bind(row.registro || '', row.unidade || '', Number(row.quantidade || 0), row.updatedAt || new Date().toISOString())
                            .run();
                    }
                    for (const row of (p.d1.insumosMovements || []).reverse()) {
                        await env.DB.prepare(
                            `INSERT INTO insumos_movements
                             (id, data_hora, tipo, codigo_barras, registro_insumo, lote, data_validade, produto, quantidade,
                              estoque_anterior, estoque_novo, unidade, unidade_origem, unidade_destino, id_transferencia,
                              usuario, motivo, observacoes)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                        )
                            .bind(
                                row.id || crypto.randomUUID(),
                                row.dataHora || new Date().toISOString(),
                                row.tipo || '',
                                row.codigoBarras || '',
                                row.registroInsumo || '',
                                row.lote || '',
                                row.dataValidade || '',
                                row.produto || '',
                                Number(row.quantidade || 0),
                                Number(row.estoqueAnterior || 0),
                                Number(row.estoqueNovo || 0),
                                row.unidade || '',
                                row.unidadeOrigem || '',
                                row.unidadeDestino || '',
                                row.transferId || '',
                                row.usuario || '',
                                row.motivo || '',
                                row.observacoes || ''
                            )
                            .run();
                    }
                    for (const row of (p.d1.shareHistory || []).reverse()) {
                        await env.DB.prepare(
                            `INSERT INTO share_history (id, user, created_at, title, text, url, files_json, source_id)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
                        )
                            .bind(
                                row.id || crypto.randomUUID(),
                                row.user || '',
                                row.createdAt || new Date().toISOString(),
                                row.title || '',
                                row.text || '',
                                row.url || '',
                                row.filesJson || '[]',
                                row.sourceId || ''
                            )
                            .run();
                    }
                } catch {
                    // ignore
                }
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
