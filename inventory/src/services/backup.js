// @ts-nocheck
import { safeJsonNoTruncate } from '../lib/json.js';
import { resolveCrmTables } from '../d1Store.js';
import { isOpaqueIdentitySubject } from '../../../shared/identity-contract/index.js';

const IDENTITY_SESSION_EPOCH_TABLE = 'crm_identity_session_epochs';

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

async function tableExists(env, tableName) {
    if (!env?.DB || tableName !== IDENTITY_SESSION_EPOCH_TABLE) return false;
    try {
        const row = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1")
            .bind(tableName)
            .first();
        return row?.name === tableName;
    } catch {
        return false;
    }
}

function hasBackupPayloadInsumos(payload) {
    return !!(
        payload?.d1 &&
        (Array.isArray(payload.d1.insumosItems) ||
            Array.isArray(payload.d1.crmUsers) ||
            Array.isArray(payload.d1.insumosUsers) ||
            Array.isArray(payload.d1.insumosStocks) ||
            Array.isArray(payload.d1.insumosMovements) ||
            Array.isArray(payload.d1.insumosTransfers) ||
            Array.isArray(payload.d1.insumosSuppliers) ||
            Array.isArray(payload.d1.insumosPurchaseOrders) ||
            Array.isArray(payload.d1.insumosPurchaseOrderLines) ||
            Array.isArray(payload.d1.insumosPurchaseReceipts) ||
            Array.isArray(payload.d1.insumosReplenishmentPolicies) ||
            Array.isArray(payload.d1.insumosReplenishmentSuggestions) ||
            Array.isArray(payload.d1.insumosCountSessions) ||
            Array.isArray(payload.d1.insumosCountLines) ||
            Array.isArray(payload.d1.insumosCountReads))
    );
}

const INSUMOS_PREVIEW_TABLES = [
    ['insumosItems', 'insumos_items'],
    ['insumosStocks', 'insumos_stocks'],
    ['insumosMovements', 'insumos_movements'],
    ['insumosTransfers', 'insumos_transfers'],
    ['insumosSuppliers', 'insumos_suppliers'],
    ['insumosPurchaseOrders', 'insumos_purchase_orders'],
    ['insumosPurchaseOrderLines', 'insumos_purchase_order_lines'],
    ['insumosPurchaseReceipts', 'insumos_purchase_receipts'],
    ['insumosReplenishmentPolicies', 'insumos_replenishment_policies'],
    ['insumosReplenishmentSuggestions', 'insumos_replenishment_suggestions'],
    ['insumosCountSessions', 'insumos_count_sessions'],
    ['insumosCountLines', 'insumos_count_lines'],
    ['insumosCountReads', 'insumos_count_reads'],
];

const INSUMOS_PREVIEW_KIND = 'insumos-local-preview-snapshot';
const INSUMOS_PREVIEW_VERSION = 2;
const INSUMOS_PREVIEW_CONSISTENCY_MODE = 'd1-batch';

function canonicalJson(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

async function sha256Hex(value) {
    const cryptoApi = globalThis.crypto;
    if (!cryptoApi?.subtle) throw new Error('INSUMOS_PREVIEW_SNAPSHOT_CRYPTO_UNAVAILABLE');
    const bytes = new TextEncoder().encode(value);
    const digest = await cryptoApi.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hasExactKeys(value, expectedKeys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const actual = Object.keys(value).sort();
    const expected = [...expectedKeys].sort();
    return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function getInsumosPreviewSnapshotMetadata(payload) {
    const previewMarkerPresent = payload?.version === INSUMOS_PREVIEW_VERSION || payload?.kind === INSUMOS_PREVIEW_KIND;
    if (!previewMarkerPresent) return null;
    if (payload?.version !== INSUMOS_PREVIEW_VERSION || payload?.kind !== INSUMOS_PREVIEW_KIND) {
        throw new Error('INSUMOS_PREVIEW_SNAPSHOT_INVALID');
    }
    const snapshotId = String(payload?.snapshotId || '');
    const d1Sha256 = String(payload?.integrity?.d1Sha256 || '');
    const d1Bytes = Number(payload?.integrity?.d1Bytes);
    const d1CanonicalJson = payload?.integrity?.d1CanonicalJson;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(snapshotId) ||
        !/^[a-f0-9]{64}$/i.test(d1Sha256) || !Number.isInteger(d1Bytes) || d1Bytes < 2 ||
        typeof d1CanonicalJson !== 'string' || !d1CanonicalJson.length) {
        throw new Error('INSUMOS_PREVIEW_SNAPSHOT_INVALID');
    }
    if (payload?.sources?.d1?.readOnly !== true) throw new Error('INSUMOS_PREVIEW_SNAPSHOT_NOT_READ_ONLY');
    if (payload?.sources?.d1?.consistency?.mode !== INSUMOS_PREVIEW_CONSISTENCY_MODE) {
        throw new Error('INSUMOS_PREVIEW_SNAPSHOT_CONSISTENCY_INVALID');
    }
    const expectedKeys = INSUMOS_PREVIEW_TABLES.map(([key]) => key);
    if (!hasExactKeys(payload?.d1, expectedKeys)) throw new Error('INSUMOS_PREVIEW_SNAPSHOT_D1_KEYS_INVALID');
    if (!hasExactKeys(payload?.sources?.d1?.tables, expectedKeys)) throw new Error('INSUMOS_PREVIEW_SNAPSHOT_TABLES_INVALID');
    for (const [key] of INSUMOS_PREVIEW_TABLES) {
        if (!Array.isArray(payload?.d1?.[key])) throw new Error(`INSUMOS_PREVIEW_SNAPSHOT_TABLE_INVALID:${key}`);
        if (Number(payload.sources.d1.tables[key]?.count) !== payload.d1[key].length) {
            throw new Error(`INSUMOS_PREVIEW_SNAPSHOT_COUNT_INVALID:${key}`);
        }
    }
    return { snapshotId, d1Sha256, d1Bytes, d1CanonicalJson };
}

export async function verifyInsumosPreviewSnapshotIntegrity(payload) {
    const snapshot = getInsumosPreviewSnapshotMetadata(payload);
    if (!snapshot) throw new Error('INSUMOS_PREVIEW_SNAPSHOT_INVALID');
    const actualDigest = await sha256Hex(snapshot.d1CanonicalJson);
    const actualBytes = new TextEncoder().encode(snapshot.d1CanonicalJson).byteLength;
    if (actualDigest !== snapshot.d1Sha256 || actualBytes !== snapshot.d1Bytes) {
        throw new Error('INSUMOS_PREVIEW_SNAPSHOT_DIGEST_INVALID');
    }
    let trustedD1;
    try {
        trustedD1 = JSON.parse(snapshot.d1CanonicalJson);
    } catch {
        throw new Error('INSUMOS_PREVIEW_SNAPSHOT_D1_CANONICAL_INVALID');
    }
    const expectedKeys = INSUMOS_PREVIEW_TABLES.map(([key]) => key);
    if (!hasExactKeys(trustedD1, expectedKeys)) {
        throw new Error('INSUMOS_PREVIEW_SNAPSHOT_D1_KEYS_INVALID');
    }
    for (const [key] of INSUMOS_PREVIEW_TABLES) {
        if (!Array.isArray(trustedD1[key]) || Number(payload.sources.d1.tables[key]?.count) !== trustedD1[key].length) {
            throw new Error(`INSUMOS_PREVIEW_SNAPSHOT_COUNT_INVALID:${key}`);
        }
    }
    // Compare the duplicated transport body within this one Worker runtime.
    // This catches altered outer JSON while avoiding a cross-engine signature
    // comparison for Unicode escaping.
    if (canonicalJson(payload.d1) !== canonicalJson(trustedD1)) {
        throw new Error('INSUMOS_PREVIEW_SNAPSHOT_DIGEST_INVALID');
    }
    return { ...snapshot, d1: trustedD1 };
}

export async function verifyInsumosPreviewRestore({ env, payload }) {
    const snapshot = await verifyInsumosPreviewSnapshotIntegrity(payload);
    if (!snapshot) throw new Error('INSUMOS_PREVIEW_SNAPSHOT_INVALID');
    const counts = {};
    for (const [key, table] of INSUMOS_PREVIEW_TABLES) {
        const expected = snapshot.d1[key].length;
        const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first();
        const actual = Number(row?.count ?? -1);
        if (!Number.isInteger(actual) || actual !== expected) {
            throw new Error(`INSUMOS_PREVIEW_SEED_COUNT_MISMATCH:${key}`);
        }
        counts[key] = actual;
    }
    // This result is returned by the local seed endpoint. Keep its proof
    // aggregate-only: the canonical payload is an input to verification, not
    // a record-bearing API response.
    return {
        snapshotId: snapshot.snapshotId,
        d1Sha256: snapshot.d1Sha256,
        d1Bytes: snapshot.d1Bytes,
        counts,
    };
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
        insumosTransfers: [],
        insumosSuppliers: [],
        insumosPurchaseOrders: [],
        insumosPurchaseOrderLines: [],
        insumosPurchaseReceipts: [],
        insumosReplenishmentPolicies: [],
        insumosReplenishmentSuggestions: [],
        insumosCountSessions: [],
        insumosCountLines: [],
        insumosCountReads: [],
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
            const hasIdentitySubject = await tableHasColumn(env, usersTable, 'identity_subject');
            const hasSessionVersion = await tableHasColumn(env, usersTable, 'session_version');
            const u = await env.DB.prepare(
                `SELECT username, email, display_name as displayName, password_hash as passwordHash, role, photo_url as photoUrl,
                        allowed_units_json as allowedUnitsJson${hasModules ? ', allowed_modules_json as allowedModulesJson' : ''},
                        ativo, created_at as createdAt, updated_at as updatedAt${hasSessionVersion ? ', session_version as sessionVersion' : ''}${hasIdentitySubject ? ', identity_subject as identitySubject' : ''}
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
                        archived_at as archivedAt,
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
                        id_transferencia as transferId, usuario, motivo, observacoes,
                        status, estorno_de as estornoDe, tipo_compensacao as tipoCompensacao
                 FROM insumos_movements`
            ).all();
            d1Dump.insumosMovements = mv?.results || [];
        } catch {
            // ignore
        }
        try {
            const tr = await env.DB.prepare(
                `SELECT id, registro_insumo as registroInsumo, codigo_barras as codigoBarras,
                        lote, data_validade as dataValidade, produto, quantidade,
                        unidade_origem as unidadeOrigem, unidade_destino as unidadeDestino,
                        status, dispatched_at as dispatchedAt, dispatched_by as dispatchedBy,
                        received_at as receivedAt, received_by as receivedBy,
                        cancelled_at as cancelledAt, cancelled_by as cancelledBy,
                        reason, dispatch_movement_id as dispatchMovementId,
                        receipt_movement_id as receiptMovementId
                 FROM insumos_transfers`
            ).all();
            d1Dump.insumosTransfers = tr?.results || [];
        } catch {
            // Older databases may not have the two-phase transfer aggregate yet.
        }
        try {
            const sp = await env.DB.prepare(
                `SELECT id, unidade, nome, documento, email, telefone, observacoes,
                        archived_at as archivedAt, archived_by as archivedBy,
                        created_at as createdAt, created_by as createdBy,
                        updated_at as updatedAt, updated_by as updatedBy
                 FROM insumos_suppliers`
            ).all();
            d1Dump.insumosSuppliers = sp?.results || [];
        } catch {
            // Older databases may not have procurement tables yet.
        }
        try {
            const po = await env.DB.prepare(
                `SELECT o.id, o.unidade, o.fornecedor_id as fornecedorId, o.status, o.expected_at as expectedAt,
                        o.observacoes, o.created_at as createdAt, o.created_by as createdBy,
                        o.updated_at as updatedAt, o.updated_by as updatedBy,
                        o.cancelled_at as cancelledAt, o.cancelled_by as cancelledBy, o.cancel_reason as cancelReason
                 FROM insumos_purchase_orders o`
            ).all();
            d1Dump.insumosPurchaseOrders = po?.results || [];
        } catch {
            // Older databases may not have procurement tables yet.
        }
        try {
            const pl = await env.DB.prepare(
                `SELECT id, pedido_id as pedidoId, registro_insumo as registroInsumo, codigo_barras as codigoBarras,
                        produto, lote, data_validade as dataValidade,
                        quantidade_pedida as quantidadePedida, quantidade_recebida as quantidadeRecebida,
                        custo_unitario_centavos as custoUnitarioCentavos, created_at as createdAt, created_by as createdBy
                 FROM insumos_purchase_order_lines`
            ).all();
            d1Dump.insumosPurchaseOrderLines = pl?.results || [];
        } catch {
            // Older databases may not have procurement tables yet.
        }
        try {
            const pr = await env.DB.prepare(
                `SELECT id, pedido_id as pedidoId, linha_id as linhaId, unidade,
                        registro_insumo as registroInsumo, codigo_barras as codigoBarras,
                        lote, data_validade as dataValidade, quantidade,
                        custo_unitario_centavos as custoUnitarioCentavos, movement_id as movementId,
                        received_at as receivedAt, received_by as receivedBy, observacoes
                 FROM insumos_purchase_receipts`
            ).all();
            d1Dump.insumosPurchaseReceipts = pr?.results || [];
        } catch {
            // Older databases may not have procurement tables yet.
        }
        try {
            const rp = await env.DB.prepare(
                `SELECT id, unidade, registro_insumo as registroInsumo,
                        estoque_minimo as estoqueMinimo, estoque_alvo as estoqueAlvo,
                        estoque_seguranca as estoqueSeguranca, lead_time_dias as leadTimeDias,
                        ativo, created_at as createdAt, created_by as createdBy,
                        updated_at as updatedAt, updated_by as updatedBy
                 FROM insumos_replenishment_policies`
            ).all();
            d1Dump.insumosReplenishmentPolicies = rp?.results || [];
        } catch {
            // Older databases may not have replenishment tables yet.
        }
        try {
            const rs = await env.DB.prepare(
                `SELECT id, unidade, registro_insumo as registroInsumo, tipo, status,
                        quantidade, saldo_atual as saldoAtual, saldo_projetado as saldoProjetado,
                        estoque_alvo as estoqueAlvo, estoque_seguranca as estoqueSeguranca,
                        lead_time_dias as leadTimeDias, unidade_origem as unidadeOrigem,
                        unidade_destino as unidadeDestino, codigo_barras as codigoBarras,
                        produto, lote, data_validade as dataValidade, suggestion_key as suggestionKey,
                        draft_json as draftJson, generated_at as generatedAt, generated_by as generatedBy,
                        dismissed_at as dismissedAt, dismissed_by as dismissedBy, dismiss_reason as dismissReason
                 FROM insumos_replenishment_suggestions`
            ).all();
            d1Dump.insumosReplenishmentSuggestions = rs?.results || [];
        } catch {
            // Older databases may not have replenishment tables yet.
        }
        try {
            const cs = await env.DB.prepare(
                `SELECT id, unidade, status, snapshot_at as snapshotAt, started_at as startedAt,
                        started_by as startedBy, closed_at as closedAt, closed_by as closedBy,
                        conflict_at as conflictAt, conflict_reason as conflictReason, observacoes
                 FROM insumos_count_sessions`
            ).all();
            d1Dump.insumosCountSessions = cs?.results || [];
        } catch {
            // Older databases may not have guided count tables yet.
        }
        try {
            const cl = await env.DB.prepare(
                `SELECT id, session_id as sessionId, registro, codigo_barras as codigoBarras,
                        produto, lote, data_validade as dataValidade,
                        snapshot_quantity as snapshotQuantity, physical_quantity as physicalQuantity,
                        status, counted_at as countedAt, counted_by as countedBy,
                        adjustment_movement_id as adjustmentMovementId
                 FROM insumos_count_lines`
            ).all();
            d1Dump.insumosCountLines = cl?.results || [];
        } catch {
            // Older databases may not have guided count tables yet.
        }
        try {
            const cr = await env.DB.prepare(
                `SELECT id, session_id as sessionId, line_id as lineId, registro,
                        quantidade, origem, observacoes, read_at as readAt, read_by as readBy
                 FROM insumos_count_reads`
            ).all();
            d1Dump.insumosCountReads = cr?.results || [];
        } catch {
            // Older databases may not have guided count tables yet.
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
                insumosTransfersCount: d1Dump.insumosTransfers.length,
                insumosSuppliersCount: d1Dump.insumosSuppliers.length,
                insumosPurchaseOrdersCount: d1Dump.insumosPurchaseOrders.length,
                insumosPurchaseOrderLinesCount: d1Dump.insumosPurchaseOrderLines.length,
                insumosPurchaseReceiptsCount: d1Dump.insumosPurchaseReceipts.length,
                insumosReplenishmentPoliciesCount: d1Dump.insumosReplenishmentPolicies.length,
                insumosReplenishmentSuggestionsCount: d1Dump.insumosReplenishmentSuggestions.length,
                insumosCountSessionsCount: d1Dump.insumosCountSessions.length,
                insumosCountLinesCount: d1Dump.insumosCountLines.length,
                insumosCountReadsCount: d1Dump.insumosCountReads.length,
            },
        },
        d1: d1Dump,
    };
}

export async function restoreBackupPayload({ env, payload, strict = false }) {
    if (!env?.DB) throw new Error('DB_NOT_CONFIGURED');
    const previewSnapshot = getInsumosPreviewSnapshotMetadata(payload);
    const verifiedPreviewSnapshot = previewSnapshot ? await verifyInsumosPreviewSnapshotIntegrity(payload) : null;
    const p = previewSnapshot
        ? {
            version: payload.version,
            kind: payload.kind,
            d1: Object.fromEntries(INSUMOS_PREVIEW_TABLES.map(([key]) => [key, verifiedPreviewSnapshot.d1[key]])),
        }
        : payload;
    if (previewSnapshot) {
        strict = true;
    }
    if (!hasBackupPayloadInsumos(p)) throw new Error('PAYLOAD_INVALID');

    if (env?.DB && p?.d1) {
        try {
            const { usersTable } = await resolveCrmTables(env);
            const usersHasModules = await tableHasColumn(env, usersTable, 'allowed_modules_json');
            const usersHasIdentitySubject = await tableHasColumn(env, usersTable, 'identity_subject');
            const usersHasSessionVersion = await tableHasColumn(env, usersTable, 'session_version');
            const usersRows = Array.isArray(p.d1.crmUsers)
                ? p.d1.crmUsers
                : (Array.isArray(p.d1.insumosUsers) ? p.d1.insumosUsers : []);

            // Once the durable subject schema exists, a restore must preserve
            // the original audit identity. A legacy backup is not allowed to
            // silently remint subjects for already-known accounts.
            if (usersHasIdentitySubject) {
                const seenIdentitySubjects = new Set();
                for (const row of usersRows) {
                    const subject = row?.identitySubject;
                    if (!isOpaqueIdentitySubject(subject)) {
                        throw new Error('IDENTITY_SUBJECT_BACKUP_REQUIRED');
                    }
                    if (seenIdentitySubjects.has(subject)) {
                        throw new Error('IDENTITY_SUBJECT_BACKUP_DUPLICATE');
                    }
                    seenIdentitySubjects.add(subject);
                }
            }

            // Session-version schemas also require the monotonic tombstone.
            // Refuse a destructive restore if migrations were not applied in
            // order; otherwise a sid-less legacy V2 cookie could become valid
            // again after the same username is restored.
            if (usersRows.length && usersHasSessionVersion && !await tableExists(env, IDENTITY_SESSION_EPOCH_TABLE)) {
                throw new Error('IDENTITY_SESSION_EPOCH_REQUIRED');
            }

            if (Array.isArray(p.d1.insumosStocks)) await env.DB.prepare('DELETE FROM insumos_stocks').run();
            // The stock ledger is append-only. Restore may add missing evidence,
            // but it must never erase or rewrite movements already posted.
            // Items are restored by upsert. Deleting them would cascade into
            // insumos_movements through the legacy foreign key and violate the
            // append-only ledger contract.
            const restoreAt = new Date().toISOString();
            if (usersRows.length && usersHasSessionVersion) {
                await env.DB.prepare(
                    'UPDATE crm_identity_sessions SET revoked_at=?, revoke_reason=? WHERE revoked_at IS NULL'
                ).bind(restoreAt, 'BACKUP_RESTORE').run();
            }
            if (usersRows.length) await env.DB.prepare(`DELETE FROM ${usersTable}`).run();
            if (Array.isArray(p.d1.shareHistory)) await env.DB.prepare('DELETE FROM share_history').run();

            for (const row of (usersRows || []).reverse()) {
                const userColumns = ['username', 'email', 'display_name', 'password_hash', 'role', 'photo_url', 'allowed_units_json'];
                const userValues = [
                    row.username || '',
                    row.email || '',
                    row.displayName || '',
                    row.passwordHash || '',
                    row.role || 'CONSULTOR',
                    row.photoUrl || '',
                    row.allowedUnitsJson || null,
                ];
                if (usersHasModules) {
                    userColumns.push('allowed_modules_json');
                    userValues.push(row.allowedModulesJson || null);
                }
                userColumns.push('ativo', 'created_at', 'updated_at');
                userValues.push(Number(row.ativo || 0) ? 1 : 0, row.createdAt || new Date().toISOString(), row.updatedAt || new Date().toISOString());
                if (usersHasSessionVersion) {
                    userColumns.push('session_version');
                    // Restoring an account must invalidate every cookie that
                    // existed when this snapshot was taken, including a
                    // sid-less legacy V2 cookie restored into a clean D1
                    // target whose epoch ledger has no local history yet.
                    // The trigger may advance this further when the target
                    // already has a newer tombstone for the username.
                    userValues.push(Math.max(0, Number(row.sessionVersion) || 0) + 1);
                }
                if (usersHasIdentitySubject) {
                    userColumns.push('identity_subject');
                    userValues.push(row.identitySubject);
                }
                await env.DB.prepare(`INSERT INTO ${usersTable} (${userColumns.join(',')}) VALUES (${userColumns.map(() => '?').join(',')})`)
                    .bind(...userValues)
                    .run();
            }
            if (usersRows.length && usersHasSessionVersion) {
                await env.DB.prepare(
                    `UPDATE ${IDENTITY_SESSION_EPOCH_TABLE}
                     SET updated_at=?, reason='BACKUP_RESTORE'
                     WHERE username IN (SELECT username FROM ${usersTable})`
                ).bind(restoreAt).run();
            }
            for (const row of (p.d1.insumosItems || []).reverse()) {
                await env.DB.prepare(
                    `INSERT INTO insumos_items
                     (registro, codigo_barras, produto, categoria, marca, especificacao, concentracao, volume, calibre, tipo_unidade,
                      fonte, preco_custo, estoque_minimo, lote, data_validade,
                      policy_requires_lot, policy_requires_expiry, policy_fefo,
                      archived_at, data_cadastro, data_atualizacao)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT(registro) DO UPDATE SET
                       codigo_barras = excluded.codigo_barras,
                       produto = excluded.produto,
                       categoria = excluded.categoria,
                       marca = excluded.marca,
                       especificacao = excluded.especificacao,
                       concentracao = excluded.concentracao,
                       volume = excluded.volume,
                       calibre = excluded.calibre,
                       tipo_unidade = excluded.tipo_unidade,
                       fonte = excluded.fonte,
                       preco_custo = excluded.preco_custo,
                       estoque_minimo = excluded.estoque_minimo,
                       lote = excluded.lote,
                       data_validade = excluded.data_validade,
                       policy_requires_lot = excluded.policy_requires_lot,
                       policy_requires_expiry = excluded.policy_requires_expiry,
                       policy_fefo = excluded.policy_fefo,
                       archived_at = excluded.archived_at,
                       data_cadastro = excluded.data_cadastro,
                       data_atualizacao = excluded.data_atualizacao`
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
                        row.policyRequiresLot !== undefined && row.policyRequiresLot !== null ? (Number(row.policyRequiresLot) ? 1 : 0) : null,
                        row.policyRequiresExpiry !== undefined && row.policyRequiresExpiry !== null ? (Number(row.policyRequiresExpiry) ? 1 : 0) : null,
                        row.policyFefo !== undefined && row.policyFefo !== null ? (Number(row.policyFefo) ? 1 : 0) : null,
                        row.archivedAt || null,
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
            // Procurement state is restored additively. Supplier/order and
            // receipt history are never deleted or rewritten by a restore.
            for (const row of (p.d1.insumosSuppliers || []).reverse()) {
                await env.DB.prepare(
                    `INSERT OR IGNORE INTO insumos_suppliers
                     (id, unidade, nome, documento, email, telefone, observacoes,
                      archived_at, archived_by, created_at, created_by, updated_at, updated_by)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(
                    row.id || crypto.randomUUID(), row.unidade || '', row.nome || '', row.documento || null,
                    row.email || null, row.telefone || null, row.observacoes || null,
                    row.archivedAt || null, row.archivedBy || null,
                    row.createdAt || new Date().toISOString(), row.createdBy || '',
                    row.updatedAt || new Date().toISOString(), row.updatedBy || row.createdBy || '',
                ).run();
            }
            for (const row of (p.d1.insumosPurchaseOrders || []).reverse()) {
                await env.DB.prepare(
                    `INSERT OR IGNORE INTO insumos_purchase_orders
                     (id, unidade, fornecedor_id, status, expected_at, observacoes,
                      created_at, created_by, updated_at, updated_by,
                      cancelled_at, cancelled_by, cancel_reason)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(
                    row.id || crypto.randomUUID(), row.unidade || '', row.fornecedorId || null,
                    row.status || 'DRAFT', row.expectedAt || null, row.observacoes || null,
                    row.createdAt || new Date().toISOString(), row.createdBy || '',
                    row.updatedAt || new Date().toISOString(), row.updatedBy || row.createdBy || '',
                    row.cancelledAt || null, row.cancelledBy || null, row.cancelReason || null,
                ).run();
            }
            for (const row of (p.d1.insumosPurchaseOrderLines || []).reverse()) {
                await env.DB.prepare(
                    `INSERT OR IGNORE INTO insumos_purchase_order_lines
                     (id, pedido_id, registro_insumo, codigo_barras, produto, lote, data_validade,
                      quantidade_pedida, quantidade_recebida, custo_unitario_centavos, created_at, created_by)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(
                    row.id || crypto.randomUUID(), row.pedidoId || '', row.registroInsumo || '', row.codigoBarras || '',
                    row.produto || '', row.lote || null, row.dataValidade || null,
                    Number(row.quantidadePedida || 0), Number(row.quantidadeRecebida || 0), Number(row.custoUnitarioCentavos || 0),
                    row.createdAt || new Date().toISOString(), row.createdBy || '',
                ).run();
            }
            for (const row of (p.d1.insumosPurchaseReceipts || []).reverse()) {
                await env.DB.prepare(
                    `INSERT OR IGNORE INTO insumos_purchase_receipts
                     (id, pedido_id, linha_id, unidade, registro_insumo, codigo_barras, lote, data_validade,
                      quantidade, custo_unitario_centavos, movement_id, received_at, received_by, observacoes)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(
                    row.id || crypto.randomUUID(), row.pedidoId || '', row.linhaId || '', row.unidade || '',
                    row.registroInsumo || '', row.codigoBarras || '', row.lote || null, row.dataValidade || null,
                    Number(row.quantidade || 0), Number(row.custoUnitarioCentavos || 0), row.movementId || '',
                    row.receivedAt || new Date().toISOString(), row.receivedBy || '', row.observacoes || null,
                ).run();
            }
            // Replenishment policy and suggestion state is restored additively.
            // Suggestions are draft/audit evidence and must never be deleted or
            // rewritten during recovery.
            for (const row of (p.d1.insumosReplenishmentPolicies || []).reverse()) {
                await env.DB.prepare(
                    `INSERT OR IGNORE INTO insumos_replenishment_policies
                     (id, unidade, registro_insumo, estoque_minimo, estoque_alvo,
                      estoque_seguranca, lead_time_dias, ativo, created_at, created_by,
                      updated_at, updated_by)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(
                    row.id || crypto.randomUUID(), row.unidade || '', row.registroInsumo || '',
                    Number(row.estoqueMinimo || 0), Number(row.estoqueAlvo || 0),
                    Number(row.estoqueSeguranca || 0), Number(row.leadTimeDias || 0),
                    Number(row.ativo) ? 1 : 0,
                    row.createdAt || new Date().toISOString(), row.createdBy || '',
                    row.updatedAt || new Date().toISOString(), row.updatedBy || row.createdBy || '',
                ).run();
            }
            for (const row of (p.d1.insumosReplenishmentSuggestions || []).reverse()) {
                await env.DB.prepare(
                    `INSERT OR IGNORE INTO insumos_replenishment_suggestions
                     (id, unidade, registro_insumo, tipo, status, quantidade, saldo_atual,
                      saldo_projetado, estoque_alvo, estoque_seguranca, lead_time_dias,
                      unidade_origem, unidade_destino, codigo_barras, produto, lote,
                      data_validade, suggestion_key, draft_json, generated_at, generated_by,
                      dismissed_at, dismissed_by, dismiss_reason)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(
                    row.id || crypto.randomUUID(), row.unidade || '', row.registroInsumo || '',
                    row.tipo || 'PURCHASE_DRAFT', row.status || 'DRAFT', Number(row.quantidade || 0),
                    Number(row.saldoAtual || 0), Number(row.saldoProjetado || 0),
                    Number(row.estoqueAlvo || 0), Number(row.estoqueSeguranca || 0),
                    Number(row.leadTimeDias || 0), row.unidadeOrigem || null, row.unidadeDestino || null,
                    row.codigoBarras || '', row.produto || '', row.lote || null, row.dataValidade || null,
                    row.suggestionKey || '', row.draftJson || '{}', row.generatedAt || new Date().toISOString(),
                    row.generatedBy || '', row.dismissedAt || null, row.dismissedBy || null, row.dismissReason || null,
                ).run();
            }
            if (Array.isArray(p.d1.insumosTransfers)) {
                await env.DB.prepare('DELETE FROM insumos_transfers').run();
                for (const row of p.d1.insumosTransfers) {
                    await env.DB.prepare(
                        `INSERT OR REPLACE INTO insumos_transfers
                         (id, registro_insumo, codigo_barras, lote, data_validade, produto,
                          quantidade, unidade_origem, unidade_destino, status, dispatched_at,
                          dispatched_by, received_at, received_by, cancelled_at, cancelled_by,
                          reason, dispatch_movement_id, receipt_movement_id)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                    ).bind(
                        row.id || crypto.randomUUID(),
                        row.registroInsumo || '',
                        row.codigoBarras || '',
                        row.lote || '',
                        row.dataValidade || '',
                        row.produto || '',
                        Number(row.quantidade || 0),
                        row.unidadeOrigem || '',
                        row.unidadeDestino || '',
                        row.status || 'PENDING_RECEIPT',
                        row.dispatchedAt || new Date().toISOString(),
                        row.dispatchedBy || '',
                        row.receivedAt || null,
                        row.receivedBy || null,
                        row.cancelledAt || null,
                        row.cancelledBy || null,
                        row.reason || null,
                        row.dispatchMovementId || null,
                        row.receiptMovementId || null,
                    ).run();
                }
            }
            // Guided count state is restored additively. Reads are append-only
            // evidence, so an existing row is never rewritten or deleted.
            if (Array.isArray(p.d1.insumosCountSessions)) {
                for (const row of p.d1.insumosCountSessions) {
                    await env.DB.prepare(
                        `INSERT OR IGNORE INTO insumos_count_sessions
                         (id, unidade, status, snapshot_at, started_at, started_by,
                          closed_at, closed_by, conflict_at, conflict_reason, observacoes)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                    ).bind(
                        row.id || crypto.randomUUID(),
                        row.unidade || '',
                        row.status || 'OPEN',
                        row.snapshotAt || new Date().toISOString(),
                        row.startedAt || new Date().toISOString(),
                        row.startedBy || '',
                        row.closedAt || null,
                        row.closedBy || null,
                        row.conflictAt || null,
                        row.conflictReason || null,
                        row.observacoes || ''
                    ).run();
                }
            }
            if (Array.isArray(p.d1.insumosCountLines)) {
                for (const row of p.d1.insumosCountLines) {
                    await env.DB.prepare(
                        `INSERT OR IGNORE INTO insumos_count_lines
                         (id, session_id, registro, codigo_barras, produto, lote, data_validade,
                          snapshot_quantity, physical_quantity, status, counted_at, counted_by,
                          adjustment_movement_id)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                    ).bind(
                        row.id || crypto.randomUUID(),
                        row.sessionId || '',
                        row.registro || '',
                        row.codigoBarras || '',
                        row.produto || '',
                        row.lote || '',
                        row.dataValidade || '',
                        Number(row.snapshotQuantity || 0),
                        row.physicalQuantity === null || row.physicalQuantity === undefined ? null : Number(row.physicalQuantity),
                        row.status || 'OPEN',
                        row.countedAt || null,
                        row.countedBy || null,
                        row.adjustmentMovementId || null
                    ).run();
                }
            }
            if (Array.isArray(p.d1.insumosCountReads)) {
                for (const row of p.d1.insumosCountReads) {
                    await env.DB.prepare(
                        `INSERT OR IGNORE INTO insumos_count_reads
                         (id, session_id, line_id, registro, quantidade, origem, observacoes, read_at, read_by)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
                    ).bind(
                        row.id || crypto.randomUUID(),
                        row.sessionId || '',
                        row.lineId || '',
                        row.registro || '',
                        Number(row.quantidade || 0),
                        row.origem || 'MANUAL',
                        row.observacoes || null,
                        row.readAt || new Date().toISOString(),
                        row.readBy || ''
                    ).run();
                }
            }
            for (const row of (p.d1.insumosMovements || []).reverse()) {
                await env.DB.prepare(
                    `INSERT OR IGNORE INTO insumos_movements
                     (id, data_hora, tipo, codigo_barras, registro_insumo, lote, data_validade, produto, quantidade,
                      estoque_anterior, estoque_novo, unidade, unidade_origem, unidade_destino, id_transferencia,
                      usuario, motivo, observacoes, status, estorno_de, tipo_compensacao)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
                        row.observacoes || '',
                        row.status || 'COMPLETED',
                        row.estornoDe || null,
                        row.tipoCompensacao || null
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
        } catch (error) {
            // Durable identity subjects and session epochs must never be
            // bypassed by the historical best-effort restore path.
            if (strict
                || String(error?.message || '').startsWith('IDENTITY_SUBJECT_BACKUP_')
                || String(error?.message || '') === 'IDENTITY_SESSION_EPOCH_REQUIRED') throw error;
            // Legacy restore is intentionally best-effort for historical backup
            // files. The private preview sets strict and fails closed instead.
        }
        if (Array.isArray(p.d1.auditLog)) {
            try {
                await env.DB.prepare('DELETE FROM audit_log').run();
                for (const row of p.d1.auditLog.slice().reverse()) {
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
            } catch (error) {
                if (strict) throw error;
                // Historical audit restoration remains best-effort outside the
                // read-only local preview contract.
            }
        }
        if (Array.isArray(p.d1.notificationSnapshots)) {
            try {
                await env.DB.prepare('DELETE FROM notification_snapshot').run();
                for (const row of p.d1.notificationSnapshots.slice().reverse()) {
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
            } catch (error) {
                if (strict) throw error;
                // Historical notification restoration remains best-effort
                // outside the read-only local preview contract.
            }
        }
    }

    return { restored: true };
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
