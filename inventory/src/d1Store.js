// @ts-nocheck
import {
  hasUnitScopeAccess,
  normalizeAllowedUnits as normalizeCanonicalAllowedUnits,
  normalizeUnitScope,
} from '../../shared/identity-contract/index.js';

function toInt(v, fallback = 0) {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function toNumber(v, fallback = 0) {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const IDEMPOTENCY_PENDING_STATUS = 'PENDING';
const IDEMPOTENCY_COMPLETED_STATUS = 'COMPLETED';

function canonicalCommandValue(value, key = '') {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((entry) => canonicalCommandValue(entry));
  if (typeof value === 'object') {
    const out = {};
    for (const name of Object.keys(value).sort()) {
      // The actor is always server-derived. A client supplied usuario/actor
      // must not produce a second command hash or affect the ledger.
      if (['usuario', 'actor', 'responsavel', 'responsible'].includes(String(name).toLowerCase())) continue;
      out[name] = canonicalCommandValue(value[name], name);
    }
    return out;
  }
  return String(value);
}

function canonicalCommandJson(value) {
  return JSON.stringify(canonicalCommandValue(value));
}

async function sha256Hex(value) {
  const input = new TextEncoder().encode(String(value || ''));
  const digest = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function resultChanges(result) {
  const changes = result?.meta?.changes;
  return Number.isFinite(Number(changes)) ? Number(changes) : 0;
}

function actorName(actor) {
  if (typeof actor === 'string') return actor.trim();
  return String(actor?.username || actor?.user || actor?.id || '').trim();
}

function assertActorUnitScope(actor, unit) {
  const normalized = normalizeUnitScope(unit);
  if (!normalized || !hasUnitScopeAccess(actor, normalized)) {
    return { ok: false, status: 403, code: 'RBAC_UNIT_DENIED', error: 'Sem permissão para unidade' };
  }
  return { ok: true, unit: normalized };
}

function assertCountManager(actor) {
  const role = String(actor?.role || '').trim().toUpperCase();
  if (!['GERENTE', 'GESTOR', 'ADMIN'].includes(role)) {
    return {
      ok: false,
      status: 403,
      code: 'COUNT_MANAGER_REQUIRED',
      error: 'A contagem só pode ser fechada ou reaberta por gerente, gestor ou administrador',
    };
  }
  return { ok: true };
}

function assertCountActor(actor) {
  if (!actorName(actor)) {
    return { ok: false, status: 401, code: 'ACTOR_REQUIRED', error: 'Responsável da operação não identificado' };
  }
  return { ok: true };
}

function assertProcurementRole(actor, roles) {
  const actorCheck = assertCountActor(actor);
  if (!actorCheck.ok) return actorCheck;
  const role = String(actor?.role || '').trim().toUpperCase();
  if (!roles.includes(role)) {
    return { ok: false, status: 403, code: 'PROCUREMENT_ROLE_DENIED', error: 'Sem permissão para esta operação de compras' };
  }
  return { ok: true };
}

function parseCountQuantity(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 ? value : NaN;
  const raw = String(value ?? '').trim();
  if (!/^\d+$/.test(raw)) return NaN;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : NaN;
}

function parseCents(value, { required = true } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return required ? NaN : null;
  }
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : NaN;
  }
  const raw = String(value).trim();
  if (!/^\d+$/.test(raw)) return NaN;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : NaN;
}

function mapSupplier(row) {
  if (!row) return null;
  return {
    id: String(row.id || '').trim(),
    unidade: normalizeUnitScope(row.unidade),
    nome: String(row.nome || '').trim(),
    documento: String(row.documento || '').trim(),
    email: String(row.email || '').trim(),
    telefone: String(row.telefone || '').trim(),
    observacoes: String(row.observacoes || '').trim(),
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    archivedBy: row.archived_by ? String(row.archived_by) : null,
    createdAt: row.created_at ? String(row.created_at) : null,
    createdBy: String(row.created_by || '').trim(),
    updatedAt: row.updated_at ? String(row.updated_at) : null,
    updatedBy: String(row.updated_by || '').trim(),
    active: !String(row.archived_at || '').trim(),
  };
}

function mapPurchaseLine(row) {
  if (!row) return null;
  return {
    id: String(row.id || '').trim(),
    pedidoId: String(row.pedido_id || '').trim(),
    registro: String(row.registro_insumo || '').trim(),
    codigoBarras: String(row.codigo_barras || '').trim(),
    produto: String(row.produto || '').trim(),
    lote: row.lote ? String(row.lote) : null,
    dataValidade: row.data_validade ? String(row.data_validade) : null,
    quantidadePedida: toInt(row.quantidade_pedida, 0),
    quantidadeRecebida: toInt(row.quantidade_recebida, 0),
    quantidadePendente: Math.max(0, toInt(row.quantidade_pedida, 0) - toInt(row.quantidade_recebida, 0)),
    custoUnitarioCentavos: toInt(row.custo_unitario_centavos, 0),
  };
}

function mapPurchaseReceipt(row) {
  if (!row) return null;
  return {
    id: String(row.id || '').trim(),
    pedidoId: String(row.pedido_id || '').trim(),
    linhaId: String(row.linha_id || '').trim(),
    unidade: normalizeUnitScope(row.unidade),
    registro: String(row.registro_insumo || '').trim(),
    codigoBarras: String(row.codigo_barras || '').trim(),
    lote: row.lote ? String(row.lote) : null,
    dataValidade: row.data_validade ? String(row.data_validade) : null,
    quantidade: toInt(row.quantidade, 0),
    custoUnitarioCentavos: toInt(row.custo_unitario_centavos, 0),
    movementId: String(row.movement_id || '').trim(),
    receivedAt: row.received_at ? String(row.received_at) : null,
    receivedBy: String(row.received_by || '').trim(),
    observacoes: String(row.observacoes || '').trim(),
  };
}

function mapPurchaseOrder(row, lines = [], receipts = []) {
  if (!row) return null;
  return {
    id: String(row.id || '').trim(),
    unidade: normalizeUnitScope(row.unidade),
    fornecedorId: row.fornecedor_id ? String(row.fornecedor_id) : null,
    fornecedorNome: String(row.fornecedor_nome || '').trim() || null,
    status: String(row.status || 'DRAFT').trim().toUpperCase(),
    expectedAt: row.expected_at ? String(row.expected_at) : null,
    observacoes: String(row.observacoes || '').trim(),
    createdAt: row.created_at ? String(row.created_at) : null,
    createdBy: String(row.created_by || '').trim(),
    updatedAt: row.updated_at ? String(row.updated_at) : null,
    updatedBy: String(row.updated_by || '').trim(),
    cancelledAt: row.cancelled_at ? String(row.cancelled_at) : null,
    cancelledBy: row.cancelled_by ? String(row.cancelled_by) : null,
    cancelReason: row.cancel_reason ? String(row.cancel_reason) : null,
    lines,
    receipts,
    totalLines: lines.length,
    totalQuantity: lines.reduce((sum, line) => sum + toInt(line.quantidadePedida, 0), 0),
    totalReceived: lines.reduce((sum, line) => sum + toInt(line.quantidadeRecebida, 0), 0),
    totalCostCentavos: lines.reduce((sum, line) => sum + (toInt(line.quantidadePedida, 0) * toInt(line.custoUnitarioCentavos, 0)), 0),
  };
}

function mapCountLine(row) {
  return {
    id: String(row?.id || '').trim(),
    sessionId: String(row?.session_id || '').trim(),
    registro: String(row?.registro || '').trim(),
    codigoBarras: String(row?.codigo_barras || '').trim(),
    produto: String(row?.produto || '').trim(),
    lote: String(row?.lote || '').trim(),
    dataValidade: row?.data_validade ? String(row.data_validade) : null,
    snapshotQuantity: toInt(row?.snapshot_quantity, 0),
    physicalQuantity: row?.physical_quantity === null || row?.physical_quantity === undefined
      ? null
      : toInt(row.physical_quantity, 0),
    status: String(row?.status || 'OPEN').trim().toUpperCase(),
    countedAt: row?.counted_at ? String(row.counted_at) : null,
    countedBy: row?.counted_by ? String(row.counted_by) : null,
    adjustmentMovementId: row?.adjustment_movement_id ? String(row.adjustment_movement_id) : null,
    readCount: toInt(row?.read_count, 0),
  };
}

function mapCountSession(row, lines = []) {
  if (!row) return null;
  return {
    id: String(row.id || '').trim(),
    unidade: normalizeUnitScope(row.unidade),
    status: String(row.status || '').trim().toUpperCase(),
    snapshotAt: row.snapshot_at ? String(row.snapshot_at) : null,
    startedAt: row.started_at ? String(row.started_at) : null,
    startedBy: row.started_by ? String(row.started_by) : null,
    closedAt: row.closed_at ? String(row.closed_at) : null,
    closedBy: row.closed_by ? String(row.closed_by) : null,
    conflictAt: row.conflict_at ? String(row.conflict_at) : null,
    conflictReason: row.conflict_reason ? String(row.conflict_reason) : null,
    observacoes: row.observacoes ? String(row.observacoes) : '',
    lines,
    totalLines: lines.length,
    countedLines: lines.filter((line) => line.physicalQuantity !== null).length,
    adjustedLines: lines.filter((line) => line.status === 'ADJUSTED').length,
  };
}

/**
 * Claims a server-side command slot before a write and stores the successful
 * response. A repeated command by the same actor/key is replayed verbatim;
 * concurrent execution receives a deterministic conflict instead of double
 * applying stock.
 */
export async function d1ExecuteIdempotent({ env, actor, action, idempotencyKey, command, execute }) {
  const subject = actorName(actor);
  const key = String(idempotencyKey || '').trim().slice(0, 180);
  if (!subject) return { ok: false, status: 401, code: 'ACTOR_REQUIRED', error: 'Responsável da operação não identificado' };
  if (!key) return { ok: false, status: 428, code: 'IDEMPOTENCY_REQUIRED', error: 'Idempotency-Key é obrigatório' };
  if (typeof execute !== 'function') return { ok: false, status: 500, code: 'IDEMPOTENCY_EXECUTOR_INVALID', error: 'Comando inválido' };

  const commandJson = canonicalCommandJson({ actor: subject, action: String(action || '').trim(), key, command });
  const commandHash = await sha256Hex(commandJson);
  const now = nowIso();
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString();

  let claim = await env.DB.prepare(
    `INSERT OR IGNORE INTO insumos_command_idempotency
       (command_hash, actor, action, command_json, status, response_json, response_status, created_at, updated_at, expires_at)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`
  ).bind(commandHash, subject, String(action || '').trim(), commandJson, IDEMPOTENCY_PENDING_STATUS, now, now, expiresAt).run();

  if (resultChanges(claim) === 0) {
    let existing = await env.DB.prepare(
      `SELECT command_hash, actor, status, response_json, response_status, expires_at
       FROM insumos_command_idempotency
       WHERE command_hash = ? AND actor = ?
       LIMIT 1`
    ).bind(commandHash, subject).first();

    if (existing?.status === IDEMPOTENCY_COMPLETED_STATUS) {
      let replay = null;
      try { replay = existing.response_json ? JSON.parse(existing.response_json) : null; } catch { replay = null; }
      return { ok: true, replayed: true, commandHash, result: replay || { ok: true } };
    }

    const expired = existing?.status === IDEMPOTENCY_PENDING_STATUS && String(existing?.expires_at || '') < now;
    if (expired) {
      claim = await env.DB.prepare(
        `UPDATE insumos_command_idempotency
         SET updated_at = ?, expires_at = ?
         WHERE command_hash = ? AND actor = ? AND status = ? AND expires_at < ?`
      ).bind(now, expiresAt, commandHash, subject, IDEMPOTENCY_PENDING_STATUS, now).run();
      if (resultChanges(claim) === 0) {
        existing = await env.DB.prepare(
          `SELECT status, response_json, expires_at
           FROM insumos_command_idempotency
           WHERE command_hash = ? AND actor = ?
           LIMIT 1`
        ).bind(commandHash, subject).first();
      }
    }

    if (resultChanges(claim) === 0 && existing?.status !== IDEMPOTENCY_COMPLETED_STATUS) {
      return { ok: false, status: 409, code: 'IDEMPOTENCY_IN_PROGRESS', error: 'Comando idêntico em processamento' };
    }
  }

  try {
    const result = await execute();
    if (result?.ok === false) {
      await env.DB.prepare('DELETE FROM insumos_command_idempotency WHERE command_hash = ? AND actor = ?').bind(commandHash, subject).run();
      return { ok: true, replayed: false, commandHash, result };
    }

    const responseJson = JSON.stringify(result ?? { ok: true });
    await env.DB.prepare(
      `UPDATE insumos_command_idempotency
       SET status = ?, response_json = ?, response_status = ?, updated_at = ?, expires_at = ?
       WHERE command_hash = ? AND actor = ?`
    ).bind(
      IDEMPOTENCY_COMPLETED_STATUS,
      responseJson,
      Number(result?.status || 200),
      nowIso(),
      expiresAt,
      commandHash,
      subject
    ).run();
    return { ok: true, replayed: false, commandHash, result };
  } catch (error) {
    try {
      await env.DB.prepare('DELETE FROM insumos_command_idempotency WHERE command_hash = ? AND actor = ?').bind(commandHash, subject).run();
    } catch {
      // Keep the original failure; a future TTL reclaim prevents a permanent lock.
    }
    throw error;
  }
}

function normalizeDateTimeInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
}

// D1/SQLite can reject statements with many bound variables.
// D1 can reject large IN(...) bind lists on some plans/regions.
// Keep this low to avoid `too many SQL variables` on overview/insights loads.
const MAX_SQL_BINDS = 80;

function normalizeTipo(tipo) {
  return String(tipo || '').toUpperCase().replace('Í', 'I');
}

function extractTransferFreeText(observacoes) {
  const raw = String(observacoes || '').trim();
  if (!raw) return '';
  const sep = raw.indexOf(' | ');
  return sep >= 0 ? raw.slice(sep + 3).trim() : '';
}

function buildTransferObservacoes(kind, fromUnidade, toUnidade, freeText) {
  const tipo = normalizeTipo(kind);
  const from = String(fromUnidade || '').trim();
  const to = String(toUnidade || '').trim();
  const note = String(freeText || '').trim();
  const prefix = tipo.includes('SAIDA') ? `Transferência para ${to}` : `Transferência de ${from}`;
  return note ? `${prefix} | ${note}` : prefix;
}

function computeMovementDelta(row) {
  const tipo = normalizeTipo(row?.tipo);
  if (tipo === 'SALDO_INICIAL') return toInt(row?.quantidade, 0);
  if (tipo === 'ESTORNO') {
    const compensation = normalizeTipo(row?.tipo_compensacao);
    if (compensation.includes('ENTRADA')) return Math.max(1, toInt(row?.quantidade, 1));
    if (compensation.includes('SAIDA')) return -Math.max(1, toInt(row?.quantidade, 1));
    return 0;
  }
  if (tipo === 'AJUSTE') {
    return toInt(row?.estoque_novo, 0) - toInt(row?.estoque_anterior, 0);
  }
  if (tipo.includes('ENTRADA')) return Math.max(1, toInt(row?.quantidade, 1));
  if (tipo.includes('SAIDA')) return -Math.max(1, toInt(row?.quantidade, 1));
  return 0;
}

async function recomputeMovementLedgerForRegistro({ env, registro, overrides = new Map(), removeIds = new Set() }) {
  const reg = String(registro || '').trim();
  if (!reg) throw new Error('Registro inválido');

  const movementRows = await env.DB.prepare(
    `SELECT
        id,
        data_hora,
        tipo,
        codigo_barras,
        registro_insumo,
        lote,
        data_validade,
        produto,
        quantidade,
        estoque_anterior,
        estoque_novo,
        unidade,
        unidade_origem,
        unidade_destino,
        id_transferencia,
        usuario,
        motivo,
        observacoes
     FROM insumos_movements
     WHERE registro_insumo = ?
     ORDER BY data_hora ASC, id ASC`
  ).bind(reg).all();

  const rows = (movementRows?.results || []).map((row) => ({ ...row }));

  const stockRows = await env.DB.prepare(
    `SELECT unidade, quantidade
     FROM insumos_stocks
     WHERE registro = ?`
  ).bind(reg).all();

  const currentStockByUnit = new Map();
  for (const row of stockRows?.results || []) {
    const unit = String(row?.unidade || '').trim();
    if (!unit) continue;
    currentStockByUnit.set(unit, toInt(row?.quantidade, 0));
  }

  const historicalDeltaByUnit = new Map();
  for (const row of rows) {
    const unit = String(row?.unidade || '').trim();
    if (!unit) continue;
    historicalDeltaByUnit.set(unit, toInt(historicalDeltaByUnit.get(unit), 0) + computeMovementDelta(row));
  }

  const baseStockByUnit = new Map();
  const allUnits = new Set([...currentStockByUnit.keys(), ...historicalDeltaByUnit.keys()]);
  for (const unit of allUnits) {
    const current = toInt(currentStockByUnit.get(unit), 0);
    const delta = toInt(historicalDeltaByUnit.get(unit), 0);
    baseStockByUnit.set(unit, current - delta);
  }

  const removeIdSet =
    removeIds instanceof Set
      ? new Set(Array.from(removeIds).map((id) => String(id || '').trim()).filter(Boolean))
      : new Set((Array.isArray(removeIds) ? removeIds : []).map((id) => String(id || '').trim()).filter(Boolean));

  const rowsWithOverrides = rows
    .filter((row) => !removeIdSet.has(String(row.id || '').trim()))
    .map((row) => {
      const patch = overrides instanceof Map ? overrides.get(String(row.id || '').trim()) : null;
      return patch ? { ...row, ...patch } : row;
    })
    .sort((a, b) => {
      const dateA = String(a?.data_hora || '');
      const dateB = String(b?.data_hora || '');
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      return String(a?.id || '').localeCompare(String(b?.id || ''));
    });

  const nextStockByUnit = new Map(baseStockByUnit);
  const movementUpdates = [];
  for (const row of rowsWithOverrides) {
    const unit = String(row?.unidade || '').trim();
    if (!unit) continue;
    const tipo = normalizeTipo(row?.tipo);
    const before = toInt(nextStockByUnit.get(unit), 0);
    let quantidade = Math.max(1, toInt(row?.quantidade, 1));
    let after = before;

    if (tipo === 'AJUSTE') {
      after = Math.max(0, toInt(row?.estoque_novo, before));
      quantidade = Math.abs(after - before);
    } else if (tipo.includes('ENTRADA')) {
      after = before + quantidade;
    } else if (tipo.includes('SAIDA')) {
      after = before - quantidade;
    }

    nextStockByUnit.set(unit, after);
    movementUpdates.push({
      id: String(row.id || '').trim(),
      dataHora: normalizeDateTimeInput(row?.data_hora) || nowIso(),
      produto: String(row?.produto || '').trim(),
      unidade: unit,
      unidadeOrigem: String(row?.unidade_origem || '').trim(),
      unidadeDestino: String(row?.unidade_destino || '').trim(),
      quantidade,
      estoqueAnterior: before,
      estoqueNovo: after,
      motivo: String(row?.motivo || '').trim(),
      observacoes: String(row?.observacoes || '').trim(),
    });
  }

  const statements = [];
  for (const id of removeIdSet) {
    statements.push(
      env.DB.prepare(
        `DELETE FROM insumos_movements
         WHERE id = ?`
      ).bind(id)
    );
  }
  for (const row of movementUpdates) {
    statements.push(
      env.DB.prepare(
        `UPDATE insumos_movements
         SET data_hora = ?, produto = ?, quantidade = ?, estoque_anterior = ?, estoque_novo = ?,
             unidade = ?, unidade_origem = ?, unidade_destino = ?, motivo = ?, observacoes = ?
         WHERE id = ?`
      ).bind(
        row.dataHora,
        row.produto,
        row.quantidade,
        row.estoqueAnterior,
        row.estoqueNovo,
        row.unidade,
        row.unidadeOrigem || null,
        row.unidadeDestino || null,
        row.motivo,
        row.observacoes,
        row.id
      )
    );
  }

  statements.push(
    env.DB.prepare(
      `DELETE FROM insumos_stocks
       WHERE registro = ?`
    ).bind(reg)
  );

  for (const [unit, qty] of nextStockByUnit.entries()) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO insumos_stocks (registro, unidade, quantidade, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(registro, unidade) DO UPDATE SET quantidade = excluded.quantidade, updated_at = excluded.updated_at`
      ).bind(reg, unit, toInt(qty, 0), nowIso())
    );
  }

  if (statements.length) await env.DB.batch(statements);

  return {
    registro: reg,
    movimentos: movementUpdates,
    estoqueAtual: Object.fromEntries(Array.from(nextStockByUnit.entries()).map(([unit, qty]) => [unit, toInt(qty, 0)])),
  };
}

function normalizeTipoUnidade(raw) {
  const v = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s*\(s\)\s*/g, '')
    .trim();
  if (!v) return '';
  if (v === 'flaconete') return 'frasco';
  if (v === 'unidade') return 'unidade';
  if (v === 'frasco') return 'frasco';
  if (v === 'seringa') return 'seringa';
  if (v === 'caixa') return 'caixa';
  if (v === 'ampola') return 'ampola';
  if (v === 'pacote') return 'pacote';
  if (v === 'rolo') return 'rolo';
  return '';
}

function normalizeBarcodeList(input) {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.map((v) => String(v || '').trim()).filter(Boolean);
  }
  return String(input)
    .split(/[\n,;]+/g)
    .map((v) => String(v || '').trim())
    .filter(Boolean);
}

function mergeBarcodeList(primary, extras) {
  const seen = new Set();
  const out = [];
  const add = (value) => {
    const v = String(value || '').trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  };
  add(primary);
  for (const v of extras || []) add(v);
  return out;
}

async function loadBarcodesByRegistro(env, registros) {
  const map = new Map();
  if (!env?.DB) return map;
  const list = (registros || []).map((r) => String(r || '').trim()).filter(Boolean);
  if (!list.length) return map;
  const queryChunk = async (chunk) => {
    if (!chunk.length) return [];
    const placeholders = chunk.map(() => '?').join(',');
    try {
      const res = await env.DB.prepare(
        `SELECT registro, codigo_barras
         FROM insumos_barcodes
         WHERE registro IN (${placeholders})`
      ).bind(...chunk).all();
      return res?.results || [];
    } catch (err) {
      const message = String(err?.message || err || '');
      if (/too many sql variables/i.test(message) && chunk.length > 1) {
        const splitAt = Math.max(1, Math.floor(chunk.length / 2));
        const left = await queryChunk(chunk.slice(0, splitAt));
        const right = await queryChunk(chunk.slice(splitAt));
        return left.concat(right);
      }
      throw err;
    }
  };
  for (let i = 0; i < list.length; i += MAX_SQL_BINDS) {
    const chunk = list.slice(i, i + MAX_SQL_BINDS);
    const rows = await queryChunk(chunk);
    for (const row of rows) {
      const reg = String(row?.registro || '').trim();
      const code = String(row?.codigo_barras || '').trim();
      if (!reg || !code) continue;
      const current = map.get(reg) || [];
      current.push(code);
      map.set(reg, current);
    }
  }
  return map;
}

async function loadStocksByRegistro(env, registros) {
  const map = new Map();
  if (!env?.DB) return map;
  const list = (registros || []).map((r) => String(r || '').trim()).filter(Boolean);
  if (!list.length) return map;
  const queryChunk = async (chunk) => {
    if (!chunk.length) return [];
    const placeholders = chunk.map(() => '?').join(',');
    try {
      const res = await env.DB.prepare(
        `SELECT registro, unidade, quantidade
         FROM insumos_stocks
         WHERE registro IN (${placeholders})`
      ).bind(...chunk).all();
      return res?.results || [];
    } catch (err) {
      const message = String(err?.message || err || '');
      if (/too many sql variables/i.test(message) && chunk.length > 1) {
        const splitAt = Math.max(1, Math.floor(chunk.length / 2));
        const left = await queryChunk(chunk.slice(0, splitAt));
        const right = await queryChunk(chunk.slice(splitAt));
        return left.concat(right);
      }
      throw err;
    }
  };
  for (let i = 0; i < list.length; i += MAX_SQL_BINDS) {
    const chunk = list.slice(i, i + MAX_SQL_BINDS);
    const rows = await queryChunk(chunk);
    for (const row of rows) {
      const reg = String(row?.registro || '').trim();
      const unidade = String(row?.unidade || '').trim();
      if (!reg || !unidade) continue;
      const current = map.get(reg) || {};
      current[unidade] = toInt(row?.quantidade, 0);
      map.set(reg, current);
    }
  }
  return map;
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

function slugifyCategory(value) {
  const s0 = String(value || '').trim().toLowerCase();
  if (!s0) return '';
  return s0
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function getCategoryPolicy(env, categoria) {
  const slug = slugifyCategory(categoria);
  if (!env?.DB || !slug) return { slug, requiresLot: false, requiresExpiry: false, fefo: false };
  try {
    const row = await env.DB.prepare(
      `SELECT slug, requires_lot, requires_expiry, fefo
       FROM insumos_categories
       WHERE slug = ? LIMIT 1`
    )
      .bind(slug)
      .first();
    if (!row?.slug) return { slug, requiresLot: false, requiresExpiry: false, fefo: false };
    return {
      slug,
      requiresLot: Number(row.requires_lot || 0) ? true : false,
      requiresExpiry: Number(row.requires_expiry || 0) ? true : false,
      fefo: Number(row.fefo || 0) ? true : false,
    };
  } catch {
    return { slug, requiresLot: false, requiresExpiry: false, fefo: false };
  }
}

function normalizePolicyFlag(value) {
  if (value === null || value === undefined) return null;
  return Number(value) ? true : false;
}

function readPolicyFromRow(row) {
  const requiresLot = normalizePolicyFlag(row?.policy_requires_lot ?? row?.policyRequiresLot);
  const requiresExpiry = normalizePolicyFlag(row?.policy_requires_expiry ?? row?.policyRequiresExpiry);
  const fefo = normalizePolicyFlag(row?.policy_fefo ?? row?.policyFefo);
  const explicit = requiresLot !== null || requiresExpiry !== null || fefo !== null;
  return {
    explicit,
    requiresLot: !!requiresLot,
    requiresExpiry: !!requiresExpiry,
    fefo: !!fefo,
  };
}

function readPolicyFromBody(body) {
  const hasAny =
    body?.policyRequiresLot !== undefined ||
    body?.policyRequiresExpiry !== undefined ||
    body?.policyFefo !== undefined;
  if (!hasAny) return { explicit: false, requiresLot: false, requiresExpiry: false, fefo: false };
  return {
    explicit: true,
    requiresLot: !!body?.policyRequiresLot,
    requiresExpiry: !!body?.policyRequiresExpiry,
    fefo: !!body?.policyFefo,
  };
}

async function resolveItemPolicy(env, row, categoriaOverride) {
  const itemPolicy = readPolicyFromRow(row);
  if (itemPolicy.explicit) return itemPolicy;
  // Policy is item-scoped. Category policies may exist for suggestions/analytics,
  // but they do not enforce requirements unless explicitly set on the item.
  return { explicit: false, requiresLot: false, requiresExpiry: false, fefo: false };
}

function enforceLotExpiryPolicyOrError({ policy, lote, dataValidade }) {
  if (policy?.requiresLot && !String(lote || '').trim()) {
    return { ok: false, status: 400, code: 'POLICY_REQUIRES_LOT', error: 'Este item exige Lote pela política do item.' };
  }
  if (policy?.requiresExpiry && !String(dataValidade || '').trim()) {
    return { ok: false, status: 400, code: 'POLICY_REQUIRES_EXPIRY', error: 'Este item exige Data de validade pela política do item.' };
  }
  return { ok: true };
}

async function listRegistrosByCodigo(env, codigo) {
  const rows = await env.DB.prepare(
    `SELECT i.registro, i.lote, i.data_validade
     FROM insumos_items i
     JOIN insumos_barcodes b ON b.registro = i.registro
     WHERE b.codigo_barras = ?
     ORDER BY (CASE WHEN data_validade IS NULL OR data_validade = '' THEN 1 ELSE 0 END),
              data_validade ASC,
              registro ASC`
  )
    .bind(String(codigo || '').trim())
    .all();
  return rows?.results || [];
}

async function listPickCandidates(env, { codigo, unidade }) {
  const normCodigo = String(codigo || '').trim();
  if (!normCodigo) return [];
  const unit = String(unidade || '').trim();

  const rows = await env.DB.prepare(
    `SELECT i.registro, i.lote, i.data_validade, i.categoria,
            i.policy_requires_lot, i.policy_requires_expiry, i.policy_fefo,
            COALESCE(s.quantidade, 0) AS quantidade
     FROM insumos_items i
     JOIN insumos_barcodes b ON b.registro = i.registro
     LEFT JOIN insumos_stocks s
       ON s.registro = i.registro AND s.unidade = ?
     WHERE b.codigo_barras = ?
       AND COALESCE(i.archived_at, '') = ''
     ORDER BY (CASE WHEN i.data_validade IS NULL OR i.data_validade = '' THEN 1 ELSE 0 END),
              i.data_validade ASC,
              i.registro ASC`
  )
    .bind(unit, normCodigo)
    .all();

  return (rows?.results || [])
    .map((r) => ({
      registro: String(r.registro || '').trim(),
      lote: String(r.lote || '').trim(),
      dataValidade: r.data_validade ? String(r.data_validade) : null,
      categoria: String(r.categoria || '').trim(),
      policyRequiresLot: normalizePolicyFlag(r.policy_requires_lot),
      policyRequiresExpiry: normalizePolicyFlag(r.policy_requires_expiry),
      policyFefo: normalizePolicyFlag(r.policy_fefo),
      estoque: toInt(r.quantidade, 0),
    }))
    .filter((r) => r.registro);
}

async function pickRegistroOrAmbiguous(env, { codigo, registro, unidade, allowFefo = true, quantidade = 1 }) {
  const normCodigo = String(codigo || '').trim();
  const normRegistro = String(registro || '').trim();
  if (!normCodigo) return { ok: false, code: 'BAD_REQUEST', error: 'Código inválido' };

  if (normRegistro) {
    const row = await env.DB.prepare(
      `SELECT registro
       FROM insumos_items
       WHERE registro = ?`
    )
      .bind(normRegistro)
      .first();
    if (!row?.registro) return { ok: false, code: 'NOT_FOUND', error: 'Registro não encontrado' };

    const match = await env.DB.prepare(
      `SELECT 1
       FROM insumos_barcodes
       WHERE registro = ? AND codigo_barras = ?
       LIMIT 1`
    )
      .bind(normRegistro, normCodigo)
      .first();
    if (!match) {
      const primary = await env.DB.prepare(
        `SELECT codigo_barras
         FROM insumos_items
         WHERE registro = ?`
      )
        .bind(normRegistro)
        .first();
      if (String(primary?.codigo_barras || '').trim() !== normCodigo) {
        return { ok: false, code: 'MISMATCH', error: 'Registro não corresponde ao código informado' };
      }
    }
    return { ok: true, registro: normRegistro };
  }

  const candidates = await listPickCandidates(env, { codigo: normCodigo, unidade });
  if (!candidates.length) return { ok: false, code: 'NOT_FOUND', error: 'Insumo não encontrado' };
  if (candidates.length > 1) {
    let fefoEnabled = false;
    let fefoPolicy = null;
    if (allowFefo) {
      for (const c of candidates) {
        const policy = await resolveItemPolicy(env, c, c?.categoria);
        if (policy?.fefo) {
          fefoEnabled = true;
          fefoPolicy = policy;
          break;
        }
      }
    }

    if (allowFefo && fefoEnabled) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const validCandidates = candidates.filter((candidate) => {
        if (!candidate?.dataValidade) return true;
        const expiry = new Date(candidate.dataValidade);
        if (Number.isNaN(expiry.getTime())) return true;
        expiry.setHours(0, 0, 0, 0);
        return expiry >= today;
      });
      const sourceCandidates = validCandidates.length ? validCandidates : candidates;
      const pool = sourceCandidates.filter((c) => toInt(c?.estoque, 0) > 0);
      const source = pool.length ? pool : sourceCandidates;
      const requestedQuantity = Math.max(1, toInt(quantidade, 1));
      const withEnough = source.filter((candidate) => toInt(candidate?.estoque, 0) >= requestedQuantity);
      const eligible = withEnough.length ? withEnough : source;
      const picked = eligible
        .slice()
        .sort((a, b) => {
          const da = a?.dataValidade ? new Date(a.dataValidade).getTime() : Number.POSITIVE_INFINITY;
          const db = b?.dataValidade ? new Date(b.dataValidade).getTime() : Number.POSITIVE_INFINITY;
          if (da !== db) return da - db;
          return String(a.registro).localeCompare(String(b.registro));
        })[0];
      if (picked?.registro && toInt(picked?.estoque, 0) >= requestedQuantity) return { ok: true, registro: picked.registro, pickedBy: 'FEFO', policy: fefoPolicy };
      if (allowFefo) {
        return {
          ok: false,
          code: 'INSUFFICIENT_STOCK',
          error: 'Estoque insuficiente para o lote selecionado por FEFO',
          registros: candidates.map((r) => String(r.registro || '').trim()).filter(Boolean),
          candidates,
        };
      }
    }

    return {
      ok: false,
      code: 'AMBIGUOUS',
      error: 'Código possui múltiplos registros (lotes). Selecione o lote/registro.',
      registros: candidates.map((r) => String(r.registro || '').trim()).filter(Boolean),
      candidates
    };
  }
  return { ok: true, registro: String(candidates[0].registro).trim() };
}

async function nextRegistro(env) {
  const row = await env.DB.prepare(
    `SELECT MAX(CAST(registro AS INTEGER)) AS mx
     FROM insumos_items
     WHERE registro GLOB '[0-9]*'`
  ).first();
  const next = (toInt(row?.mx, 0) || 0) + 1;
  return String(next).padStart(3, '0');
}

export async function d1HasInsumos(env) {
  if (!env?.DB) return false;
  try {
    const row = await env.DB.prepare('SELECT COUNT(1) AS n FROM insumos_items').first();
    return (toInt(row?.n, 0) || 0) > 0;
  } catch {
    return false;
  }
}

export async function d1HasUsers(env) {
  if (!env?.DB) return false;
  try {
    const { usersTable } = await resolveCrmTables(env);
    const row = await env.DB.prepare(`SELECT COUNT(1) AS n FROM ${usersTable}`).first();
    return (toInt(row?.n, 0) || 0) > 0;
  } catch {
    return false;
  }
}

async function sqliteObjectType(env, name) {
  if (!env?.DB || !name) return null;
  try {
    const row = await env.DB.prepare(`SELECT type FROM sqlite_master WHERE name = ? LIMIT 1`).bind(String(name)).first();
    return row?.type ? String(row.type) : null;
  } catch {
    return null;
  }
}

export async function resolveCrmTables(env) {
  // Prefer crm_* tables (post-migration). Fall back to legacy insumos_* tables.
  const usersType = await sqliteObjectType(env, 'crm_users');
  const invitesType = await sqliteObjectType(env, 'crm_invites');
  const resetsType = await sqliteObjectType(env, 'crm_password_resets');
  const prefsType = await sqliteObjectType(env, 'crm_user_prefs');

  return {
    usersTable: usersType === 'table' ? 'crm_users' : 'insumos_users',
    invitesTable: invitesType === 'table' ? 'crm_invites' : 'insumos_invites',
    passwordResetsTable: resetsType === 'table' ? 'crm_password_resets' : 'insumos_password_resets',
    userPrefsTable: prefsType === 'table' ? 'crm_user_prefs' : 'insumos_user_prefs',
  };
}

async function tableHasColumn(env, tableName, columnName) {
  if (!env?.DB || !tableName || !columnName) return false;
  // PRAGMA does not support binding identifiers; tableName is from a fixed allowlist.
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

// D1-only: legacy Sheets storage mode is removed.

export async function d1ListInsumos({ env, unidades, unidade }) {
  const itemsRes = await env.DB.prepare(
    `SELECT
        registro,
        codigo_barras,
        produto,
        categoria,
        marca,
        especificacao,
        concentracao,
        volume,
        calibre,
        tipo_unidade,
        fonte,
        preco_custo,
        estoque_minimo,
        lote,
        data_validade,
        policy_requires_lot,
        policy_requires_expiry,
        policy_fefo,
        data_cadastro,
        data_atualizacao
     FROM insumos_items
     WHERE COALESCE(archived_at, '') = ''
     ORDER BY produto COLLATE NOCASE ASC, codigo_barras ASC, registro ASC`
  ).all();
  const items = itemsRes?.results || [];
  const registros = items.map((it) => String(it?.registro || '').trim()).filter(Boolean);
  const barcodesByRegistro = await loadBarcodesByRegistro(env, registros);

  const stocksRes = await env.DB.prepare(
    `SELECT registro, unidade, quantidade
     FROM insumos_stocks`
  ).all();
  const stocks = stocksRes?.results || [];

  const byRegistro = new Map();
  for (const s of stocks) {
    const reg = String(s.registro || '').trim();
    if (!reg) continue;
    const map = byRegistro.get(reg) || {};
    map[String(s.unidade || '').trim()] = toInt(s.quantidade, 0);
    byRegistro.set(reg, map);
  }

  return items.map((it) => {
    const registro = String(it.registro || '').trim();
    const estoques = byRegistro.get(registro) || {};
    const estoqueAtual = toInt(estoques?.[unidade], 0);
    const dataValidade = it.data_validade ? String(it.data_validade) : null;
    const codigosBarras = mergeBarcodeList(String(it.codigo_barras || ''), barcodesByRegistro.get(registro));
    return {
      registro,
      codigoBarras: String(it.codigo_barras || ''),
      codigosBarras,
      categoria: String(it.categoria || ''),
      marca: String(it.marca || ''),
      produto: String(it.produto || ''),
      especificacao: String(it.especificacao || ''),
      concentracao: String(it.concentracao || ''),
      volume: String(it.volume || ''),
      calibre: String(it.calibre || ''),
      tipoUnidade: String(it.tipo_unidade || ''),
      fonte: String(it.fonte || ''),
      lote: String(it.lote || ''),
      precoCusto: toNumber(it.preco_custo, 0),
      estoqueAtual,
      estoqueMinimo: toInt(it.estoque_minimo, 0),
      dataValidade: dataValidade || null,
      statusValidade: calcularStatusValidade(dataValidade),
      policyRequiresLot: normalizePolicyFlag(it.policy_requires_lot),
      policyRequiresExpiry: normalizePolicyFlag(it.policy_requires_expiry),
      policyFefo: normalizePolicyFlag(it.policy_fefo),
      estoques: Object.fromEntries((unidades || []).map((u) => [u, toInt(estoques?.[u], 0)])),
    };
  });
}

export async function d1ListInsumosLite({ env, unidade }) {
  const itemsRes = await env.DB.prepare(
    `SELECT
        registro,
        codigo_barras,
        produto,
        categoria,
        marca,
        especificacao,
        concentracao,
        volume,
        calibre,
        tipo_unidade,
        fonte,
        preco_custo,
        estoque_minimo,
        lote,
        data_validade,
        policy_requires_lot,
        policy_requires_expiry,
        policy_fefo,
        data_cadastro,
        data_atualizacao
     FROM insumos_items
     WHERE COALESCE(archived_at, '') = ''
     ORDER BY produto COLLATE NOCASE ASC, codigo_barras ASC, registro ASC`
  ).all();
  const items = itemsRes?.results || [];
  const registros = items.map((it) => String(it?.registro || '').trim()).filter(Boolean);

  const stocksRes = await env.DB.prepare(
    `SELECT registro, quantidade
     FROM insumos_stocks
     WHERE unidade = ?`
  ).bind(String(unidade || '').trim()).all();
  const stocks = stocksRes?.results || [];
  const byRegistro = new Map();
  for (const s of stocks) {
    const reg = String(s.registro || '').trim();
    if (!reg) continue;
    byRegistro.set(reg, toInt(s.quantidade, 0));
  }

  return items.map((it) => {
    const registro = String(it.registro || '').trim();
    const estoqueAtual = toInt(byRegistro.get(registro), 0);
    const dataValidade = it.data_validade ? String(it.data_validade) : null;
    return {
      registro,
      codigoBarras: String(it.codigo_barras || ''),
      codigosBarras: [],
      categoria: String(it.categoria || ''),
      marca: String(it.marca || ''),
      produto: String(it.produto || ''),
      especificacao: String(it.especificacao || ''),
      concentracao: String(it.concentracao || ''),
      volume: String(it.volume || ''),
      calibre: String(it.calibre || ''),
      tipoUnidade: String(it.tipo_unidade || ''),
      fonte: String(it.fonte || ''),
      lote: String(it.lote || ''),
      precoCusto: toNumber(it.preco_custo, 0),
      estoqueAtual,
      estoqueMinimo: toInt(it.estoque_minimo, 0),
      dataValidade: dataValidade || null,
      statusValidade: calcularStatusValidade(dataValidade),
      policyRequiresLot: normalizePolicyFlag(it.policy_requires_lot),
      policyRequiresExpiry: normalizePolicyFlag(it.policy_requires_expiry),
      policyFefo: normalizePolicyFlag(it.policy_fefo),
      estoques: { [String(unidade || '').trim()]: estoqueAtual },
    };
  });
}

export async function d1ListInsumosPaged({ env, unidades, unidade, q, pagina, limite }) {
  const page = Math.max(1, toInt(pagina, 1) || 1);
  const lim = Math.max(1, Math.min(1000, toInt(limite, 200) || 200));
  const offset = (page - 1) * lim;

  const query = String(q || '').trim();
  const where = [];
  const binds = [];
  if (query) {
    const like = `%${query}%`;
    where.push(`(
      produto LIKE ? COLLATE NOCASE OR
      codigo_barras LIKE ? COLLATE NOCASE OR
      categoria LIKE ? COLLATE NOCASE OR
      marca LIKE ? COLLATE NOCASE OR
      lote LIKE ? COLLATE NOCASE OR
      EXISTS (
        SELECT 1 FROM insumos_barcodes b
        WHERE b.registro = insumos_items.registro
          AND b.codigo_barras LIKE ? COLLATE NOCASE
      )
    )`);
    binds.push(like, like, like, like, like, like);
  }
  where.unshift(`COALESCE(archived_at, '') = ''`);
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const countRow = await env.DB.prepare(`SELECT COUNT(1) AS n FROM insumos_items ${whereSql}`)
    .bind(...binds)
    .first();
  const total = toInt(countRow?.n, 0);

  const itemsRes = await env.DB.prepare(
    `SELECT
        registro,
        codigo_barras,
        produto,
        categoria,
        marca,
        especificacao,
        concentracao,
        volume,
        calibre,
        tipo_unidade,
        fonte,
        preco_custo,
        estoque_minimo,
        lote,
        data_validade,
        policy_requires_lot,
        policy_requires_expiry,
        policy_fefo,
        data_cadastro,
        data_atualizacao
     FROM insumos_items
     ${whereSql}
     ORDER BY produto COLLATE NOCASE ASC, codigo_barras ASC, registro ASC
     LIMIT ? OFFSET ?`
  )
    .bind(...binds, lim, offset)
    .all();
  const items = itemsRes?.results || [];
  const registros = items.map((it) => String(it?.registro || '').trim()).filter(Boolean);
  const barcodesByRegistro = await loadBarcodesByRegistro(env, registros);

  const byRegistro = await loadStocksByRegistro(env, registros);

  const mapped = items.map((it) => {
    const registro = String(it.registro || '').trim();
    const estoques = byRegistro.get(registro) || {};
    const estoqueAtual = toInt(estoques?.[unidade], 0);
    const dataValidade = it.data_validade ? String(it.data_validade) : null;
    const codigosBarras = mergeBarcodeList(String(it.codigo_barras || ''), barcodesByRegistro.get(registro));
    return {
      registro,
      codigoBarras: String(it.codigo_barras || ''),
      codigosBarras,
      categoria: String(it.categoria || ''),
      marca: String(it.marca || ''),
      produto: String(it.produto || ''),
      especificacao: String(it.especificacao || ''),
      concentracao: String(it.concentracao || ''),
      volume: String(it.volume || ''),
      calibre: String(it.calibre || ''),
      tipoUnidade: String(it.tipo_unidade || ''),
      fonte: String(it.fonte || ''),
      lote: String(it.lote || ''),
      precoCusto: toNumber(it.preco_custo, 0),
      estoqueAtual,
      estoqueMinimo: toInt(it.estoque_minimo, 0),
      dataValidade: dataValidade || null,
      statusValidade: calcularStatusValidade(dataValidade),
      policyRequiresLot: normalizePolicyFlag(it.policy_requires_lot),
      policyRequiresExpiry: normalizePolicyFlag(it.policy_requires_expiry),
      policyFefo: normalizePolicyFlag(it.policy_fefo),
      estoques: Object.fromEntries((unidades || []).map((u) => [u, toInt(estoques?.[u], 0)])),
    };
  });

  return {
    items: mapped,
    resumo: { total, pagina: page, limite: lim, q: query || null }
  };
}

export async function d1ListInsumosByCodigos({ env, unidades, unidade, codigos }) {
  if (!env?.DB) return [];
  const rawList = normalizeBarcodeList(codigos);
  const uniq = Array.from(new Set(rawList.map((v) => String(v || '').trim()).filter(Boolean)));
  if (!uniq.length) return [];

  const chunkSize = Math.max(1, Math.floor(MAX_SQL_BINDS / 2));
  const registrosSet = new Set();

  const queryRegistros = async (chunk) => {
    if (!chunk.length) return [];
    const placeholders = chunk.map(() => '?').join(',');
    try {
      const res = await env.DB.prepare(
        `SELECT DISTINCT i.registro
         FROM insumos_items i
         LEFT JOIN insumos_barcodes b ON b.registro = i.registro
         WHERE COALESCE(i.archived_at, '') = ''
           AND (i.codigo_barras IN (${placeholders})
            OR b.codigo_barras IN (${placeholders}))`
      ).bind(...chunk, ...chunk).all();
      return res?.results || [];
    } catch (err) {
      const message = String(err?.message || err || '');
      if (/too many sql variables/i.test(message) && chunk.length > 1) {
        const splitAt = Math.max(1, Math.floor(chunk.length / 2));
        const left = await queryRegistros(chunk.slice(0, splitAt));
        const right = await queryRegistros(chunk.slice(splitAt));
        return left.concat(right);
      }
      throw err;
    }
  };

  for (let i = 0; i < uniq.length; i += chunkSize) {
    const chunk = uniq.slice(i, i + chunkSize);
    const rows = await queryRegistros(chunk);
    for (const row of rows) {
      const reg = String(row?.registro || '').trim();
      if (reg) registrosSet.add(reg);
    }
  }

  const registros = Array.from(registrosSet);
  if (!registros.length) return [];

  const items = [];
  const queryItems = async (chunk) => {
    if (!chunk.length) return [];
    const placeholders = chunk.map(() => '?').join(',');
    try {
      const res = await env.DB.prepare(
        `SELECT
            registro,
            codigo_barras,
            produto,
            categoria,
            marca,
            especificacao,
            concentracao,
            volume,
            calibre,
            tipo_unidade,
            fonte,
            preco_custo,
            estoque_minimo,
            lote,
            data_validade,
            policy_requires_lot,
            policy_requires_expiry,
            policy_fefo,
            data_cadastro,
            data_atualizacao
         FROM insumos_items
         WHERE registro IN (${placeholders})
           AND COALESCE(archived_at, '') = ''`
      ).bind(...chunk).all();
      return res?.results || [];
    } catch (err) {
      const message = String(err?.message || err || '');
      if (/too many sql variables/i.test(message) && chunk.length > 1) {
        const splitAt = Math.max(1, Math.floor(chunk.length / 2));
        const left = await queryItems(chunk.slice(0, splitAt));
        const right = await queryItems(chunk.slice(splitAt));
        return left.concat(right);
      }
      throw err;
    }
  };

  for (let i = 0; i < registros.length; i += MAX_SQL_BINDS) {
    const chunk = registros.slice(i, i + MAX_SQL_BINDS);
    const rows = await queryItems(chunk);
    for (const row of rows) items.push(row);
  }

  const barcodesByRegistro = await loadBarcodesByRegistro(env, registros);
  const byRegistro = await loadStocksByRegistro(env, registros);

  return items.map((it) => {
    const registro = String(it.registro || '').trim();
    const estoques = byRegistro.get(registro) || {};
    const estoqueAtual = toInt(estoques?.[unidade], 0);
    const dataValidade = it.data_validade ? String(it.data_validade) : null;
    const codigosBarras = mergeBarcodeList(String(it.codigo_barras || ''), barcodesByRegistro.get(registro));
    return {
      registro,
      codigoBarras: String(it.codigo_barras || ''),
      codigosBarras,
      categoria: String(it.categoria || ''),
      marca: String(it.marca || ''),
      produto: String(it.produto || ''),
      especificacao: String(it.especificacao || ''),
      concentracao: String(it.concentracao || ''),
      volume: String(it.volume || ''),
      calibre: String(it.calibre || ''),
      tipoUnidade: String(it.tipo_unidade || ''),
      fonte: String(it.fonte || ''),
      lote: String(it.lote || ''),
      precoCusto: toNumber(it.preco_custo, 0),
      estoqueAtual,
      estoqueMinimo: toInt(it.estoque_minimo, 0),
      dataValidade: dataValidade || null,
      statusValidade: calcularStatusValidade(dataValidade),
      policyRequiresLot: normalizePolicyFlag(it.policy_requires_lot),
      policyRequiresExpiry: normalizePolicyFlag(it.policy_requires_expiry),
      policyFefo: normalizePolicyFlag(it.policy_fefo),
      estoques: Object.fromEntries((unidades || []).map((u) => [u, toInt(estoques?.[u], 0)])),
    };
  });
}

export async function d1ListInsumosOptions({ env, limite }) {
  const lim = Math.max(50, Math.min(500, toInt(limite, 250) || 250));

  const [categoriasRes, marcasRes] = await Promise.all([
    env.DB.prepare(
      `SELECT DISTINCT categoria
       FROM insumos_items
       WHERE COALESCE(archived_at, '') = ''
         AND categoria IS NOT NULL AND TRIM(categoria) != ''
       ORDER BY categoria COLLATE NOCASE ASC
       LIMIT ?`
    ).bind(lim).all(),
    env.DB.prepare(
      `SELECT DISTINCT marca
       FROM insumos_items
       WHERE COALESCE(archived_at, '') = ''
         AND marca IS NOT NULL AND TRIM(marca) != ''
       ORDER BY marca COLLATE NOCASE ASC
       LIMIT ?`
    ).bind(lim).all()
  ]);

  const categorias = (categoriasRes?.results || [])
    .map((row) => String(row?.categoria || '').trim())
    .filter(Boolean);
  const marcas = (marcasRes?.results || [])
    .map((row) => String(row?.marca || '').trim())
    .filter(Boolean);

  return { categorias, marcas };
}

export async function d1GetInsumoByRegistro(env, registro) {
  const row = await env.DB.prepare(
    `SELECT
        registro,
        codigo_barras,
        produto,
        categoria,
        marca,
        especificacao,
        concentracao,
        volume,
        calibre,
        tipo_unidade,
        fonte,
        preco_custo,
        estoque_minimo,
        lote,
        data_validade,
        policy_requires_lot,
        policy_requires_expiry,
        policy_fefo,
        archived_at,
        data_cadastro,
        data_atualizacao
     FROM insumos_items
     WHERE registro = ?`
  ).bind(String(registro || '').trim()).first();
  if (!row) return null;
  const barcodes = await env.DB.prepare(
    `SELECT codigo_barras FROM insumos_barcodes WHERE registro = ?`
  ).bind(String(registro || '').trim()).all();
  const codigosBarras = mergeBarcodeList(
    String(row?.codigo_barras || ''),
    (barcodes?.results || []).map((r) => r?.codigo_barras)
  );
  return { ...row, codigosBarras };
}

export async function d1CreateInsumo({ env, unidades, unidade, body, actor }) {
  const primaryCodigo = String(body?.codigoBarras || '').trim();
  const codigosBarras = mergeBarcodeList(primaryCodigo, normalizeBarcodeList(body?.codigosBarras));
  const codigoBarras = codigosBarras[0] || '';
  const produto = String(body?.produto || '').trim();
  if (!codigoBarras) return { ok: false, status: 400, error: 'Código de barras é obrigatório' };
  if (!produto) return { ok: false, status: 400, error: 'Produto é obrigatório' };

  const allowDuplicateLot = body?.allowDuplicateLot === true || body?.novoLote === true;
  const lote = String(body?.lote || '').trim();

  if (allowDuplicateLot && !lote) return { ok: false, status: 400, error: 'Lote é obrigatório para cadastrar novo lote' };

  if (!allowDuplicateLot) {
    for (const code of codigosBarras) {
      const exists = await env.DB.prepare(
        'SELECT 1 FROM insumos_barcodes WHERE codigo_barras = ? LIMIT 1'
      ).bind(code).first();
      if (exists) return { ok: false, status: 409, error: 'Código de barras já cadastrado' };
    }
  } else {
    for (const code of codigosBarras) {
      const existsSame = await env.DB.prepare(
        `SELECT 1
         FROM insumos_barcodes b
         JOIN insumos_items i ON i.registro = b.registro
         WHERE b.codigo_barras = ? AND i.lote = ?
         LIMIT 1`
      ).bind(code, lote).first();
      if (existsSame) return { ok: false, status: 409, error: 'Lote já cadastrado para este código de barras' };
    }
  }

  const registro = await nextRegistro(env);
  const ts = nowIso();
  const dataValidade = body?.dataValidade ? String(body.dataValidade).trim() : '';
  const estoqueMinimo = toInt(body?.estoqueMinimo, 0);
  const precoCusto = toNumber(body?.precoCusto, 0);
  const estoqueInicial = toInt(body?.estoqueInicial, 0);
  const responsavel = actorName(actor);
  if (!responsavel) return { ok: false, status: 401, code: 'ACTOR_REQUIRED', error: 'Responsável da operação não identificado' };

  const categoria = String(body?.categoria || '').trim();
  const bodyPolicy = readPolicyFromBody(body);
  const policy = bodyPolicy.explicit ? bodyPolicy : { explicit: false, requiresLot: false, requiresExpiry: false, fefo: false };
  const policyCheck = enforceLotExpiryPolicyOrError({ policy, lote, dataValidade });
  if (!policyCheck.ok) return policyCheck;

  const statements = [];
  statements.push(
    env.DB.prepare(
      `INSERT INTO insumos_items (
          registro, codigo_barras, produto, categoria, marca, especificacao, concentracao, volume, calibre, tipo_unidade,
          fonte, preco_custo, estoque_minimo, lote, data_validade,
          policy_requires_lot, policy_requires_expiry, policy_fefo,
          data_cadastro, data_atualizacao
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      registro,
      codigoBarras,
      produto,
      categoria,
      String(body?.marca || '').trim(),
      String(body?.especificacao || '').trim(),
      String(body?.concentracao || '').trim(),
      String(body?.volume || '').trim(),
      String(body?.calibre || '').trim(),
      normalizeTipoUnidade(String(body?.tipoUnidade || body?.unidade || '').trim()),
      String(body?.fonte || '').trim(),
      precoCusto,
      estoqueMinimo,
      lote,
      dataValidade,
      bodyPolicy.explicit ? (bodyPolicy.requiresLot ? 1 : 0) : null,
      bodyPolicy.explicit ? (bodyPolicy.requiresExpiry ? 1 : 0) : null,
      bodyPolicy.explicit ? (bodyPolicy.fefo ? 1 : 0) : null,
      ts,
      ts
    )
  );

  for (const code of codigosBarras) {
    statements.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO insumos_barcodes (registro, codigo_barras, created_at)
         VALUES (?, ?, ?)`
      ).bind(registro, code, ts)
    );
  }

  // Stock only for selected unidade (others implied 0)
  statements.push(
    env.DB.prepare(
      `INSERT INTO insumos_stocks (registro, unidade, quantidade, updated_at)
       VALUES (?, ?, ?, ?)`
    ).bind(registro, String(unidade || '').trim(), estoqueInicial, ts)
  );

  // Every new item receives an immutable opening-balance event, including a
  // zero baseline. Future corrections never need to rewrite this row.
  statements.push(
    env.DB.prepare(
      `INSERT INTO insumos_movements (
        id, data_hora, tipo, codigo_barras, registro_insumo, lote, data_validade,
        produto, quantidade, estoque_anterior, estoque_novo, unidade, usuario,
        motivo, observacoes, status
      ) VALUES (?, ?, 'SALDO_INICIAL', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 'COMPLETED')`
    ).bind(
      crypto.randomUUID(),
      ts,
      codigoBarras,
      registro,
      lote,
      dataValidade,
      produto,
      estoqueInicial,
      estoqueInicial,
      String(unidade || '').trim(),
      responsavel,
      'Cadastro inicial do item',
      'SALDO_INICIAL'
    )
  );

  await env.DB.batch(statements);
  return { ok: true, registro };
}

export async function d1UpdateInsumo({ env, registro, body }) {
  const reg = String(registro || '').trim();
  if (!reg) return { ok: false, status: 400, error: 'Registro inválido' };

  const existing = await env.DB.prepare(
    'SELECT registro, codigo_barras, categoria, lote, data_validade, policy_requires_lot, policy_requires_expiry, policy_fefo, archived_at FROM insumos_items WHERE registro = ?'
  )
    .bind(reg)
    .first();
  if (!existing) return { ok: false, status: 404, error: 'Registro não encontrado' };
  if (String(existing.archived_at || '').trim()) return { ok: false, status: 409, code: 'INSUMO_ARCHIVED', error: 'Insumo arquivado não pode ser editado' };

  const nextCategoria = body?.categoria !== undefined ? String(body?.categoria || '').trim() : String(existing?.categoria || '').trim();
  const nextLote = body?.lote !== undefined ? String(body?.lote || '').trim() : String(existing?.lote || '').trim();
  const nextValidade = body?.dataValidade !== undefined ? String(body?.dataValidade || '').trim() : String(existing?.data_validade || '').trim();
  const bodyPolicy = readPolicyFromBody(body);
  const existingPolicy = readPolicyFromRow(existing);
  const policy = bodyPolicy.explicit
    ? bodyPolicy
    : existingPolicy.explicit
      ? existingPolicy
      : { explicit: false, requiresLot: false, requiresExpiry: false, fefo: false };
  const policyCheck = enforceLotExpiryPolicyOrError({ policy, lote: nextLote, dataValidade: nextValidade });
  if (!policyCheck.ok) return policyCheck;

  const fields = [];
  const vals = [];
  const set = (col, v) => {
    fields.push(`${col} = ?`);
    vals.push(v);
  };

  const nextPrimary = body?.codigoBarras !== undefined
    ? String(body.codigoBarras || '').trim()
    : String(existing?.codigo_barras || '').trim();
  const nextCodigosBarras = body?.codigosBarras !== undefined
    ? mergeBarcodeList(nextPrimary, normalizeBarcodeList(body.codigosBarras))
    : mergeBarcodeList(nextPrimary, []);

  if (body?.codigoBarras !== undefined) set('codigo_barras', nextPrimary);
  if (body?.produto !== undefined) set('produto', String(body.produto || '').trim());
  if (body?.categoria !== undefined) set('categoria', String(body.categoria || '').trim());
  if (body?.marca !== undefined) set('marca', String(body.marca || '').trim());
  if (body?.especificacao !== undefined) set('especificacao', String(body.especificacao || '').trim());
  if (body?.concentracao !== undefined) set('concentracao', String(body.concentracao || '').trim());
  if (body?.volume !== undefined) set('volume', String(body.volume || '').trim());
  if (body?.calibre !== undefined) set('calibre', String(body.calibre || '').trim());
  if (body?.tipoUnidade !== undefined) set('tipo_unidade', normalizeTipoUnidade(String(body.tipoUnidade || '').trim()));
  if (body?.fonte !== undefined) set('fonte', String(body.fonte || '').trim());
  if (body?.precoCusto !== undefined) set('preco_custo', toNumber(body.precoCusto, 0));
  if (body?.estoqueMinimo !== undefined) set('estoque_minimo', toInt(body.estoqueMinimo, 0));
  if (body?.lote !== undefined) set('lote', String(body.lote || '').trim());
  if (body?.dataValidade !== undefined) set('data_validade', String(body.dataValidade || '').trim());
  if (body?.policyRequiresLot !== undefined) set('policy_requires_lot', body.policyRequiresLot ? 1 : 0);
  if (body?.policyRequiresExpiry !== undefined) set('policy_requires_expiry', body.policyRequiresExpiry ? 1 : 0);
  if (body?.policyFefo !== undefined) set('policy_fefo', body.policyFefo ? 1 : 0);

  set('data_atualizacao', nowIso());

  const sql = `UPDATE insumos_items SET ${fields.join(', ')} WHERE registro = ?`;
  vals.push(reg);
  await env.DB.prepare(sql).bind(...vals).run();

  if (body?.codigosBarras !== undefined) {
    await env.DB.prepare('DELETE FROM insumos_barcodes WHERE registro = ?').bind(reg).run();
    const ts = nowIso();
    const inserts = nextCodigosBarras.map((code) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO insumos_barcodes (registro, codigo_barras, created_at)
         VALUES (?, ?, ?)`
      ).bind(reg, code, ts)
    );
    if (inserts.length) await env.DB.batch(inserts);
  } else if (body?.codigoBarras !== undefined && nextPrimary) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO insumos_barcodes (registro, codigo_barras, created_at)
       VALUES (?, ?, ?)`
    ).bind(reg, nextPrimary, nowIso()).run();
  }
  return { ok: true };
}

export async function d1DeleteInsumo({ env, registro }) {
  const reg = String(registro || '').trim();
  if (!reg) return { ok: false, status: 400, error: 'Registro inválido' };
  return { ok: false, status: 405, code: 'ARCHIVE_REQUIRED', error: 'Exclusão física de insumos é proibida; arquive o registro.' };
}

export async function d1ArchiveInsumo({ env, registro }) {
  const reg = String(registro || '').trim();
  if (!reg) return { ok: false, status: 400, error: 'Registro inválido' };
  const item = await env.DB.prepare(
    `SELECT registro, archived_at
     FROM insumos_items
     WHERE registro = ?
     LIMIT 1`
  ).bind(reg).first();
  if (!item) return { ok: false, status: 404, error: 'Registro não encontrado' };
  if (String(item.archived_at || '').trim()) return { ok: true, archivedAt: item.archived_at, alreadyArchived: true };

  const positive = await env.DB.prepare(
    `SELECT COALESCE(SUM(CASE WHEN quantidade > 0 THEN quantidade ELSE 0 END), 0) AS quantidade
     FROM insumos_stocks
     WHERE registro = ?`
  ).bind(reg).first();
  if (toInt(positive?.quantidade, 0) > 0) {
    return { ok: false, status: 409, code: 'ARCHIVE_STOCK_NOT_ZERO', error: 'Não é possível arquivar um insumo com saldo positivo.' };
  }

  const pending = await env.DB.prepare(
    `SELECT 1
     FROM insumos_transfers
     WHERE registro_insumo = ?
       AND status = 'PENDING_RECEIPT'
     LIMIT 1`
  ).bind(reg).first();
  if (pending) {
    return { ok: false, status: 409, code: 'ARCHIVE_TRANSFER_PENDING', error: 'Não é possível arquivar um insumo com transferência pendente.' };
  }

  const archivedAt = nowIso();
  await env.DB.prepare(
    `UPDATE insumos_items
     SET archived_at = ?, data_atualizacao = ?
     WHERE registro = ? AND COALESCE(archived_at, '') = ''`
  ).bind(archivedAt, archivedAt, reg).run();
  return { ok: true, archivedAt };
}

export async function d1EntradaBaixa({ env, unidade, body, kind, actor }) {
  const codigo = String(body?.codigoBarras || '').trim();
  const registro = String(body?.registro || '').trim();
  const quantidade = Math.max(1, toInt(body?.quantidade, 0));
  const observacoes = String(body?.observacoes || '').trim();
  const unitScope = assertActorUnitScope(actor, unidade);
  if (!unitScope.ok) return unitScope;
  if (!codigo || !quantidade) return { ok: false, status: 400, error: 'Código e quantidade são obrigatórios' };

  const normalizedKind = String(kind || '').toUpperCase() === 'ENTRADA' ? 'ENTRADA' : 'BAIXA';
  const pick = await pickRegistroOrAmbiguous(env, {
    codigo,
    registro,
    unidade: unitScope.unit,
    quantidade,
    allowFefo: normalizedKind === 'BAIXA',
  });
  if (!pick.ok) {
    const status = pick.code === 'NOT_FOUND' ? 404 : pick.code === 'AMBIGUOUS' || pick.code === 'INSUFFICIENT_STOCK' ? 409 : 400;
    return { ok: false, status, error: pick.error, code: pick.code, registros: pick.registros || [], candidates: pick.candidates || [] };
  }
  const reg = pick.registro;

  const item = await env.DB.prepare(
    `SELECT registro, codigo_barras, produto, categoria, lote, data_validade, estoque_minimo,
            policy_requires_lot, policy_requires_expiry, policy_fefo, archived_at
     FROM insumos_items WHERE registro = ?`
  ).bind(reg).first();
  if (!item) return { ok: false, status: 404, error: 'Insumo não encontrado' };
  if (String(item.archived_at || '').trim()) return { ok: false, status: 409, code: 'INSUMO_ARCHIVED', error: 'Insumo arquivado não aceita movimentações' };

  const policy = await resolveItemPolicy(env, item, item?.categoria || '');
  const policyCheck = enforceLotExpiryPolicyOrError({
    policy,
    lote: String(item?.lote || ''),
    dataValidade: String(item?.data_validade || '')
  });
  if (!policyCheck.ok) return policyCheck;

  const actorId = actorName(actor);
  const role = String(actor?.role || '').trim().toUpperCase();
  const justification = String(body?.justificativa || body?.negativeStockJustification || '').trim();
  const canOverrideNegative = ['GERENTE', 'GESTOR', 'ADMIN'].includes(role);
  const beforeRow = await env.DB.prepare(
    `SELECT quantidade FROM insumos_stocks WHERE registro = ? AND unidade = ?`
  ).bind(reg, unitScope.unit).first();
  const observedStock = toInt(beforeRow?.quantidade, 0);

  if (normalizedKind === 'BAIXA' && observedStock < quantidade && canOverrideNegative && !justification) {
    return { ok: false, status: 400, code: 'NEGATIVE_STOCK_JUSTIFICATION_REQUIRED', error: 'Justificativa é obrigatória para saldo negativo' };
  }
  if (normalizedKind === 'BAIXA' && observedStock < quantidade && !(canOverrideNegative && justification)) {
    return {
      ok: false,
      status: 409,
      code: 'INSUFFICIENT_STOCK',
      error: 'Estoque insuficiente para a saída',
      estoqueAnterior: observedStock,
      deficit: quantidade - observedStock,
    };
  }

  const ts = nowIso();
  const movId = crypto.randomUUID();
  const lote = String(item.lote || '');
  const dataValidade = String(item.data_validade || '');
  const produto = String(item.produto || '');
  const negativeOverride = normalizedKind === 'BAIXA' && observedStock < quantidade;
  const stmts = [];

  if (normalizedKind === 'ENTRADA' || negativeOverride) {
    const delta = normalizedKind === 'ENTRADA' ? quantidade : -quantidade;
    stmts.push(
      env.DB.prepare(
        `INSERT INTO insumos_stocks (registro, unidade, quantidade, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(registro, unidade) DO UPDATE SET
           quantidade = insumos_stocks.quantidade + excluded.quantidade,
           updated_at = excluded.updated_at`
      ).bind(reg, unitScope.unit, delta, ts)
    );
    stmts.push(
      env.DB.prepare(
        `INSERT INTO insumos_movements (
          id, data_hora, tipo, codigo_barras, registro_insumo, lote, data_validade,
          produto, quantidade, estoque_anterior, estoque_novo, unidade, usuario,
          motivo, observacoes, status
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, quantidade - ?, quantidade, ?, ?, ?, ?, 'COMPLETED'
        FROM insumos_stocks
        WHERE registro = ? AND unidade = ? AND updated_at = ?`
      ).bind(
        movId,
        ts,
        normalizedKind === 'ENTRADA' ? 'ENTRADA' : 'SAÍDA',
        codigo,
        reg,
        lote,
        dataValidade,
        produto,
        quantidade,
        delta,
        unitScope.unit,
        actorId,
        negativeOverride ? justification : '',
        observacoes,
        reg,
        unitScope.unit,
        ts
      )
    );
  } else {
    // Conditional decrement is the FEFO/concurrency guard: if another request
    // consumed the selected lot first, no movement row is written.
    stmts.push(
      env.DB.prepare(
        `UPDATE insumos_stocks
         SET quantidade = quantidade - ?, updated_at = ?
         WHERE registro = ? AND unidade = ? AND quantidade >= ?`
      ).bind(quantidade, ts, reg, unitScope.unit, quantidade)
    );
    stmts.push(
      env.DB.prepare(
        `INSERT INTO insumos_movements (
          id, data_hora, tipo, codigo_barras, registro_insumo, lote, data_validade,
          produto, quantidade, estoque_anterior, estoque_novo, unidade, usuario,
          motivo, observacoes, status
        )
        SELECT ?, ?, 'SAÍDA', ?, ?, ?, ?, ?, ?, quantidade + ?, quantidade, ?, ?, '', ?, 'COMPLETED'
        FROM insumos_stocks
        WHERE registro = ? AND unidade = ? AND updated_at = ?`
      ).bind(
        movId,
        ts,
        codigo,
        reg,
        lote,
        dataValidade,
        produto,
        quantidade,
        quantidade,
        unitScope.unit,
        actorId,
        observacoes,
        reg,
        unitScope.unit,
        ts
      )
    );
  }

  const results = await env.DB.batch(stmts);
  if (normalizedKind === 'BAIXA' && !negativeOverride && resultChanges(results?.[0]) !== 1) {
    const current = await env.DB.prepare(
      `SELECT quantidade FROM insumos_stocks WHERE registro = ? AND unidade = ?`
    ).bind(reg, unitScope.unit).first();
    const currentStock = toInt(current?.quantidade, 0);
    return { ok: false, status: 409, code: 'INSUFFICIENT_STOCK', error: 'Estoque insuficiente para a saída', estoqueAnterior: currentStock, deficit: Math.max(0, quantidade - currentStock) };
  }
  if (resultChanges(results?.[1]) !== 1) {
    return { ok: false, status: 409, code: 'STOCK_CONFLICT', error: 'Saldo alterado por outra operação; tente novamente' };
  }

  const saved = await env.DB.prepare(
    `SELECT estoque_anterior, estoque_novo
     FROM insumos_movements
     WHERE id = ?`
  ).bind(movId).first();
  const estoqueAnterior = toInt(saved?.estoque_anterior, 0);
  const novoEstoque = toInt(saved?.estoque_novo, 0);
  return {
    ok: true,
    estoqueAnterior,
    novoEstoque,
    registro: reg,
    quebraEstoque: negativeOverride,
    deficit: negativeOverride ? Math.abs(novoEstoque) : 0,
    negativeOverride,
    negativeJustification: negativeOverride ? justification : null,
    pickedBy: pick.pickedBy || null,
  };
}

export async function d1Ajuste({ env, unidade, body, actor }) {
  const codigo = String(body?.codigoBarras || '').trim();
  const registro = String(body?.registro || '').trim();
  const motivo = String(body?.motivo || '').trim();
  const observacoes = String(body?.observacoes || '').trim();
  const novoEstoque = toInt(body?.novoEstoque, NaN);
  const unitScope = assertActorUnitScope(actor, unidade);
  if (!codigo) return { ok: false, status: 400, error: 'Código é obrigatório' };
  if (!motivo) return { ok: false, status: 400, error: 'Motivo é obrigatório para ajuste' };
  if (!Number.isFinite(novoEstoque) || novoEstoque < 0) return { ok: false, status: 400, error: 'novoEstoque inválido' };
  if (!unitScope.ok) return unitScope;

  const unit = String(unidade || '').trim();
  const pick = await pickRegistroOrAmbiguous(env, { codigo, registro, unidade: unit, allowFefo: false });
  if (!pick.ok) {
    const status = pick.code === 'NOT_FOUND' ? 404 : pick.code === 'AMBIGUOUS' ? 409 : 400;
    return { ok: false, status, error: pick.error, code: pick.code, registros: pick.registros || [], candidates: pick.candidates || [] };
  }
  const reg = pick.registro;

  const item = await env.DB.prepare(
    `SELECT registro, codigo_barras, produto, categoria, lote, data_validade,
            policy_requires_lot, policy_requires_expiry, policy_fefo, archived_at
     FROM insumos_items WHERE registro = ?`
  ).bind(reg).first();
  if (!item) return { ok: false, status: 404, error: 'Insumo não encontrado' };

  const policy = await resolveItemPolicy(env, item, item?.categoria || '');
  const policyCheck = enforceLotExpiryPolicyOrError({
    policy,
    lote: String(item?.lote || ''),
    dataValidade: String(item?.data_validade || '')
  });
  if (!policyCheck.ok) return policyCheck;

  const beforeRow = await env.DB.prepare(
    `SELECT quantidade FROM insumos_stocks WHERE registro = ? AND unidade = ?`
  ).bind(reg, unit).first();
  const estoqueAnterior = toInt(beforeRow?.quantidade, 0);
  if (String(item.archived_at || '').trim()) return { ok: false, status: 409, code: 'INSUMO_ARCHIVED', error: 'Insumo arquivado não aceita movimentações' };
  const diff = Math.abs((Number(novoEstoque) || 0) - (Number(estoqueAnterior) || 0));

  const ts = nowIso();
  const movId = crypto.randomUUID();
  const actorId = actorName(actor);

  const stmts = [];
  stmts.push(
    env.DB.prepare(
      `INSERT OR IGNORE INTO insumos_stocks (registro, unidade, quantidade, updated_at)
       VALUES (?, ?, 0, ?)`
    ).bind(reg, unit, ts)
  );
  stmts.push(
    env.DB.prepare(
      `UPDATE insumos_stocks
       SET quantidade = ?, updated_at = ?
       WHERE registro = ? AND unidade = ? AND quantidade = ?`
    ).bind(novoEstoque, ts, reg, unit, estoqueAnterior)
  );
  stmts.push(
    env.DB.prepare(
      `INSERT INTO insumos_movements (
        id, data_hora, tipo, codigo_barras, registro_insumo, lote, data_validade,
        produto, quantidade, estoque_anterior, estoque_novo, unidade, usuario, motivo, observacoes, status
      )
      SELECT ?, ?, 'AJUSTE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED'
      FROM insumos_stocks
      WHERE registro = ? AND unidade = ? AND updated_at = ? AND quantidade = ?`
    ).bind(
      movId,
      ts,
      codigo,
      reg,
      String(item.lote || ''),
      String(item.data_validade || ''),
      String(item.produto || ''),
      diff,
      estoqueAnterior,
      novoEstoque,
      unit,
      actorId,
      motivo,
      observacoes,
      reg,
      unit,
      ts,
      novoEstoque
    )
  );
  const results = await env.DB.batch(stmts);
  if (resultChanges(results?.[1]) !== 1 || resultChanges(results?.[2]) !== 1) {
    return { ok: false, status: 409, code: 'STOCK_CONFLICT', error: 'Saldo alterado por outra operação; tente novamente' };
  }
  return { ok: true, estoqueAnterior, novoEstoque, registro: reg, movementId: movId };
}

/**
 * Starts an auditable physical count for one unit. The snapshot is materialized
 * as count lines, including zero stock and every active lot, so a scanner never
 * has to infer a missing lot from current stock later in the workflow.
 */
export async function d1IniciarContagem({ env, unidade, actor, observacoes }) {
  const actorCheck = assertCountActor(actor);
  if (!actorCheck.ok) return actorCheck;
  const unitScope = assertActorUnitScope(actor, unidade);
  if (!unitScope.ok) return unitScope;
  const existing = await env.DB.prepare(
    `SELECT id, status
     FROM insumos_count_sessions
     WHERE unidade = ? AND status IN ('OPEN', 'CLOSING', 'CONFLICT')
     ORDER BY started_at DESC, id DESC
     LIMIT 1`
  ).bind(unitScope.unit).first();
  if (existing) {
    return {
      ok: false,
      status: 409,
      code: 'COUNT_ALREADY_OPEN',
      error: 'Já existe uma contagem ativa para esta unidade',
      sessionId: String(existing.id || '').trim(),
      sessionStatus: String(existing.status || '').trim().toUpperCase(),
    };
  }

  const id = crypto.randomUUID();
  const ts = nowIso();
  const actorId = actorName(actor);
  const note = String(observacoes || '').trim().slice(0, 2000);
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO insumos_count_sessions (
          id, unidade, status, snapshot_at, started_at, started_by, observacoes
        ) VALUES (?, ?, 'OPEN', ?, ?, ?, ?)`
      ).bind(id, unitScope.unit, ts, ts, actorId, note),
      env.DB.prepare(
        `INSERT INTO insumos_count_lines (
          id, session_id, registro, codigo_barras, produto, lote, data_validade,
          snapshot_quantity, physical_quantity, status
        )
        SELECT lower(hex(randomblob(16))), ?, i.registro, i.codigo_barras, i.produto,
               i.lote, i.data_validade, COALESCE(s.quantidade, 0), NULL, 'OPEN'
        FROM insumos_items i
        LEFT JOIN insumos_stocks s
          ON s.registro = i.registro AND s.unidade = ?
        WHERE COALESCE(i.archived_at, '') = ''
        ORDER BY i.produto COLLATE NOCASE ASC, i.codigo_barras ASC, i.lote ASC, i.registro ASC`
      ).bind(id, unitScope.unit),
    ]);
  } catch (error) {
    const message = String(error?.message || error || '');
    if (/unique|constraint/i.test(message)) {
      const active = await env.DB.prepare(
        `SELECT id, status FROM insumos_count_sessions
         WHERE unidade = ? AND status IN ('OPEN', 'CLOSING', 'CONFLICT')
         ORDER BY started_at DESC, id DESC LIMIT 1`
      ).bind(unitScope.unit).first();
      return {
        ok: false,
        status: 409,
        code: 'COUNT_ALREADY_OPEN',
        error: 'Já existe uma contagem ativa para esta unidade',
        sessionId: String(active?.id || '').trim() || null,
        sessionStatus: String(active?.status || '').trim().toUpperCase() || null,
      };
    }
    throw error;
  }
  return d1GetContagem({ env, id, actor, unidade: unitScope.unit });
}

/** Returns the full count context, including immutable read counts per line. */
export async function d1GetContagem({ env, id, actor, unidade }) {
  const actorCheck = assertCountActor(actor);
  if (!actorCheck.ok) return actorCheck;
  const sessionId = String(id || '').trim();
  if (!sessionId) return { ok: false, status: 400, code: 'COUNT_INVALID', error: 'Contagem inválida' };
  const session = await env.DB.prepare(
    `SELECT id, unidade, status, snapshot_at, started_at, started_by,
            closed_at, closed_by, conflict_at, conflict_reason, observacoes
     FROM insumos_count_sessions WHERE id = ? LIMIT 1`
  ).bind(sessionId).first();
  if (!session) return { ok: false, status: 404, code: 'COUNT_NOT_FOUND', error: 'Contagem não encontrada' };
  const scope = assertActorUnitScope(actor, session.unidade);
  if (!scope.ok) return scope;
  if (unidade && normalizeUnitScope(unidade) !== scope.unit) {
    return { ok: false, status: 400, code: 'UNIT_COUNT_MISMATCH', error: 'A unidade da rota não corresponde à contagem' };
  }
  const linesRes = await env.DB.prepare(
    `SELECT l.id, l.session_id, l.registro, l.codigo_barras, l.produto,
            l.lote, l.data_validade, l.snapshot_quantity, l.physical_quantity,
            l.status, l.counted_at, l.counted_by, l.adjustment_movement_id,
            (SELECT COUNT(1) FROM insumos_count_reads r WHERE r.line_id = l.id) AS read_count
     FROM insumos_count_lines l
     WHERE l.session_id = ?
     ORDER BY l.produto COLLATE NOCASE ASC, l.codigo_barras ASC, l.lote ASC, l.registro ASC`
  ).bind(sessionId).all();
  const lines = (linesRes?.results || []).map(mapCountLine);
  return { ok: true, session: mapCountSession(session, lines), ...mapCountSession(session, lines) };
}

/** Records a scanner/manual read while retaining every previous read. */
export async function d1RegistrarContagem({ env, id, actor, unidade, body }) {
  const actorCheck = assertCountActor(actor);
  if (!actorCheck.ok) return actorCheck;
  const sessionId = String(id || '').trim();
  if (!sessionId) return { ok: false, status: 400, code: 'COUNT_INVALID', error: 'Contagem inválida' };
  const quantity = parseCountQuantity(body?.quantidade ?? body?.physicalQuantity ?? body?.quantidadeFisica);
  if (!Number.isFinite(quantity)) {
    return { ok: false, status: 400, code: 'COUNT_QUANTITY_INVALID', error: 'Quantidade física deve ser um inteiro maior ou igual a zero' };
  }
  const session = await env.DB.prepare(
    `SELECT id, unidade, status FROM insumos_count_sessions WHERE id = ? LIMIT 1`
  ).bind(sessionId).first();
  if (!session) return { ok: false, status: 404, code: 'COUNT_NOT_FOUND', error: 'Contagem não encontrada' };
  const scope = assertActorUnitScope(actor, session.unidade);
  if (!scope.ok) return scope;
  if (unidade && normalizeUnitScope(unidade) !== scope.unit) {
    return { ok: false, status: 400, code: 'UNIT_COUNT_MISMATCH', error: 'A unidade da rota não corresponde à contagem' };
  }
  if (String(session.status || '').toUpperCase() !== 'OPEN') {
    const code = String(session.status || '').toUpperCase() === 'CONFLICT' ? 'COUNT_RECOUNT_REQUIRED' : 'COUNT_NOT_OPEN';
    return { ok: false, status: 409, code, error: 'A contagem não está aberta para leituras', sessionStatus: String(session.status || '').toUpperCase() };
  }

  const lineId = String(body?.lineId || body?.linhaId || '').trim();
  const registro = String(body?.registro || body?.registroInsumo || '').trim();
  const codigo = String(body?.codigoBarras || body?.codigo || '').trim();
  const lote = String(body?.lote || '').trim();
  let line;
  if (lineId) {
    line = await env.DB.prepare(
      `SELECT id, session_id, registro, codigo_barras, produto, lote, data_validade,
              snapshot_quantity, physical_quantity, status, counted_at, counted_by,
              adjustment_movement_id
       FROM insumos_count_lines WHERE id = ? AND session_id = ? LIMIT 1`
    ).bind(lineId, sessionId).first();
  } else if (registro) {
    line = await env.DB.prepare(
      `SELECT id, session_id, registro, codigo_barras, produto, lote, data_validade,
              snapshot_quantity, physical_quantity, status, counted_at, counted_by,
              adjustment_movement_id
       FROM insumos_count_lines WHERE registro = ? AND session_id = ? LIMIT 1`
    ).bind(registro, sessionId).first();
  } else if (codigo) {
    const result = await env.DB.prepare(
      `SELECT id, session_id, registro, codigo_barras, produto, lote, data_validade,
              snapshot_quantity, physical_quantity, status, counted_at, counted_by,
              adjustment_movement_id
       FROM insumos_count_lines
       WHERE session_id = ?
         AND (codigo_barras = ? OR EXISTS (
           SELECT 1 FROM insumos_barcodes b
           WHERE b.registro = insumos_count_lines.registro AND b.codigo_barras = ?
         ))
         AND (? = '' OR lote = ?)
       ORDER BY lote ASC, registro ASC`
    ).bind(sessionId, codigo, codigo, lote, lote).all();
    const candidates = result?.results || [];
    if (candidates.length > 1) {
      return {
        ok: false,
        status: 409,
        code: 'COUNT_AMBIGUOUS_LOT',
        error: 'Código possui múltiplos lotes; informe o lote ou registro',
        registros: candidates.map((candidate) => String(candidate.registro || '').trim()),
        candidates: candidates.map(mapCountLine),
      };
    }
    line = candidates[0] || null;
  }
  if (!line) return { ok: false, status: 404, code: 'COUNT_LINE_NOT_FOUND', error: 'Linha não encontrada na contagem' };

  const ts = nowIso();
  const actorId = actorName(actor);
  const readId = crypto.randomUUID();
  const origem = String(body?.origem || body?.source || 'MANUAL').trim().slice(0, 40).toUpperCase() || 'MANUAL';
  const note = String(body?.observacoes || body?.nota || '').trim().slice(0, 1000);
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE insumos_count_lines
       SET physical_quantity = ?, status = 'COUNTED', counted_at = ?, counted_by = ?
       WHERE id = ? AND session_id = ?
         AND EXISTS (SELECT 1 FROM insumos_count_sessions WHERE id = ? AND status = 'OPEN')`
    ).bind(quantity, ts, actorId, line.id, sessionId, sessionId),
    env.DB.prepare(
      `INSERT INTO insumos_count_reads (
        id, session_id, line_id, registro, quantidade, origem, observacoes, read_at, read_by
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM insumos_count_lines l
        JOIN insumos_count_sessions s ON s.id = l.session_id
        WHERE l.id = ? AND l.session_id = ? AND s.status = 'OPEN'
      )`
    ).bind(readId, sessionId, line.id, line.registro, quantity, origem, note, ts, actorId, line.id, sessionId),
  ]);
  if (resultChanges(results?.[0]) !== 1 || resultChanges(results?.[1]) !== 1) {
    return { ok: false, status: 409, code: 'COUNT_READ_CONFLICT', error: 'A contagem foi alterada por outra operação; recarregue a sessão' };
  }
  const current = await env.DB.prepare(
    `SELECT l.id, l.session_id, l.registro, l.codigo_barras, l.produto, l.lote,
            l.data_validade, l.snapshot_quantity, l.physical_quantity, l.status,
            l.counted_at, l.counted_by, l.adjustment_movement_id,
            (SELECT COUNT(1) FROM insumos_count_reads r WHERE r.line_id = l.id) AS read_count
     FROM insumos_count_lines l WHERE l.id = ? LIMIT 1`
  ).bind(line.id).first();
  return { ok: true, readId, line: mapCountLine(current) };
}

/**
 * Closes a count only if every line was read and no ledger movement occurred
 * after the snapshot. Differences are recorded through the existing AJUSTE
 * append-only flow, never by rewriting a movement or a stock history row.
 */
export async function d1FecharContagem({ env, id, actor, unidade }) {
  const actorCheck = assertCountActor(actor);
  if (!actorCheck.ok) return actorCheck;
  const sessionId = String(id || '').trim();
  if (!sessionId) return { ok: false, status: 400, code: 'COUNT_INVALID', error: 'Contagem inválida' };
  const manager = assertCountManager(actor);
  if (!manager.ok) return manager;
  const session = await env.DB.prepare(
    `SELECT id, unidade, status, snapshot_at, started_at, started_by, observacoes
     FROM insumos_count_sessions WHERE id = ? LIMIT 1`
  ).bind(sessionId).first();
  if (!session) return { ok: false, status: 404, code: 'COUNT_NOT_FOUND', error: 'Contagem não encontrada' };
  const scope = assertActorUnitScope(actor, session.unidade);
  if (!scope.ok) return scope;
  if (unidade && normalizeUnitScope(unidade) !== scope.unit) {
    return { ok: false, status: 400, code: 'UNIT_COUNT_MISMATCH', error: 'A unidade da rota não corresponde à contagem' };
  }
  const status = String(session.status || '').toUpperCase();
  if (status === 'CLOSED') return { ok: false, status: 409, code: 'COUNT_ALREADY_CLOSED', error: 'A contagem já foi encerrada' };
  if (status === 'CONFLICT') return { ok: false, status: 409, code: 'COUNT_RECOUNT_REQUIRED', error: 'Movimentação posterior ao snapshot; faça a recontagem' };
  if (status === 'CANCELLED') return { ok: false, status: 409, code: 'COUNT_CANCELLED', error: 'A contagem foi cancelada' };
  if (status === 'CLOSING') return { ok: false, status: 409, code: 'COUNT_CLOSE_IN_PROGRESS', error: 'O encerramento da contagem já está em andamento' };

  const incomplete = await env.DB.prepare(
    `SELECT COUNT(1) AS n FROM insumos_count_lines
     WHERE session_id = ? AND physical_quantity IS NULL`
  ).bind(sessionId).first();
  const incompleteCount = toInt(incomplete?.n, 0);
  if (incompleteCount > 0) {
    return { ok: false, status: 409, code: 'COUNT_INCOMPLETE', error: 'Todas as linhas precisam ser contadas antes do fechamento', pendingLines: incompleteCount };
  }

  const movements = await env.DB.prepare(
    `SELECT id, data_hora, tipo, registro_insumo, quantidade, unidade, usuario
     FROM insumos_movements
     WHERE unidade = ? AND data_hora >= ?
     ORDER BY data_hora ASC, id ASC
     LIMIT 50`
  ).bind(scope.unit, session.snapshot_at).all();
  if ((movements?.results || []).length > 0) {
    const conflictAt = nowIso();
    const reason = 'Movimentação registrada após o snapshot; recontagem obrigatória';
    await env.DB.prepare(
      `UPDATE insumos_count_sessions
       SET status = 'CONFLICT', conflict_at = ?, conflict_reason = ?
       WHERE id = ? AND status = 'OPEN'`
    ).bind(conflictAt, reason, sessionId).run();
    return {
      ok: false,
      status: 409,
      code: 'COUNT_CONFLICT',
      error: reason,
      conflictAt,
      movements: (movements.results || []).map((row) => ({
        id: String(row.id || ''),
        dataHora: String(row.data_hora || ''),
        tipo: String(row.tipo || ''),
        registro: String(row.registro_insumo || ''),
        quantidade: toInt(row.quantidade, 0),
        unidade: normalizeUnitScope(row.unidade),
        usuario: String(row.usuario || ''),
      })),
    };
  }

  const claim = await env.DB.prepare(
    `UPDATE insumos_count_sessions
     SET status = 'CLOSING'
     WHERE id = ? AND status = 'OPEN'`
  ).bind(sessionId).run();
  if (resultChanges(claim) !== 1) return { ok: false, status: 409, code: 'COUNT_CLOSE_IN_PROGRESS', error: 'A contagem foi alterada por outra operação' };

  const linesRes = await env.DB.prepare(
    `SELECT id, registro, codigo_barras, produto, lote, data_validade,
            snapshot_quantity, physical_quantity
     FROM insumos_count_lines
     WHERE session_id = ? ORDER BY registro ASC`
  ).bind(sessionId).all();
  const lines = linesRes?.results || [];
  const adjustments = [];
  try {
    for (const line of lines) {
      const snapshotQuantity = toInt(line.snapshot_quantity, 0);
      const physicalQuantity = parseCountQuantity(line.physical_quantity);
      if (!Number.isFinite(physicalQuantity)) throw Object.assign(new Error('COUNT_INCOMPLETE'), { code: 'COUNT_INCOMPLETE' });
      if (snapshotQuantity === physicalQuantity) {
        adjustments.push({ lineId: String(line.id || ''), registro: String(line.registro || ''), delta: 0, movementId: null });
        continue;
      }
      const adjustment = await d1Ajuste({
        env,
        unidade: scope.unit,
        actor,
        body: {
          codigoBarras: String(line.codigo_barras || ''),
          registro: String(line.registro || ''),
          novoEstoque: physicalQuantity,
          motivo: `Contagem física ${sessionId}`,
          observacoes: `Fechamento da contagem ${sessionId}`,
        },
      });
      if (!adjustment?.ok) throw Object.assign(new Error(adjustment?.error || 'Falha ao aplicar ajuste da contagem'), adjustment);
      adjustments.push({
        lineId: String(line.id || ''),
        registro: String(line.registro || ''),
        delta: physicalQuantity - snapshotQuantity,
        movementId: adjustment.movementId || null,
      });
    }
  } catch (error) {
    const reason = String(error?.error || error?.message || 'Falha ao aplicar ajustes da contagem');
    await env.DB.prepare(
      `UPDATE insumos_count_sessions
       SET status = 'CONFLICT', conflict_at = ?, conflict_reason = ?
       WHERE id = ? AND status = 'CLOSING'`
    ).bind(nowIso(), `Fechamento parcial: ${reason}`, sessionId).run();
    if (error?.code && String(error.code).startsWith('COUNT_')) return { ok: false, status: 409, code: error.code, error: reason };
    return { ok: false, status: Number(error?.status || 409), code: error?.code || 'COUNT_CLOSE_FAILED', error: reason };
  }

  const closedAt = nowIso();
  const updates = [
    ...adjustments.map((entry) => env.DB.prepare(
      `UPDATE insumos_count_lines
       SET status = 'ADJUSTED', adjustment_movement_id = ?
       WHERE id = ? AND session_id = ?`
    ).bind(entry.movementId, entry.lineId, sessionId)),
    env.DB.prepare(
      `UPDATE insumos_count_sessions
       SET status = 'CLOSED', closed_at = ?, closed_by = ?, conflict_at = NULL, conflict_reason = NULL
       WHERE id = ? AND status = 'CLOSING'`
    ).bind(closedAt, actorName(actor), sessionId),
  ];
  const closeResults = await env.DB.batch(updates);
  if (resultChanges(closeResults?.[closeResults.length - 1]) !== 1) {
    return { ok: false, status: 409, code: 'COUNT_CLOSE_CONFLICT', error: 'A contagem não pôde ser encerrada com segurança' };
  }
  const out = await d1GetContagem({ env, id: sessionId, actor, unidade: scope.unit });
  return { ok: true, ...out, adjustments };
}

/** Refreshes a conflicted snapshot while retaining all prior read evidence. */
export async function d1RecontarContagem({ env, id, actor, unidade, observacoes }) {
  const actorCheck = assertCountActor(actor);
  if (!actorCheck.ok) return actorCheck;
  const sessionId = String(id || '').trim();
  if (!sessionId) return { ok: false, status: 400, code: 'COUNT_INVALID', error: 'Contagem inválida' };
  const manager = assertCountManager(actor);
  if (!manager.ok) return manager;
  const session = await env.DB.prepare(
    `SELECT id, unidade, status FROM insumos_count_sessions WHERE id = ? LIMIT 1`
  ).bind(sessionId).first();
  if (!session) return { ok: false, status: 404, code: 'COUNT_NOT_FOUND', error: 'Contagem não encontrada' };
  const scope = assertActorUnitScope(actor, session.unidade);
  if (!scope.ok) return scope;
  if (unidade && normalizeUnitScope(unidade) !== scope.unit) {
    return { ok: false, status: 400, code: 'UNIT_COUNT_MISMATCH', error: 'A unidade da rota não corresponde à contagem' };
  }
  const status = String(session.status || '').toUpperCase();
  if (!['OPEN', 'CONFLICT'].includes(status)) {
    return { ok: false, status: 409, code: status === 'CLOSED' ? 'COUNT_ALREADY_CLOSED' : 'COUNT_NOT_OPEN', error: 'A contagem não pode ser reaberta neste estado' };
  }
  const snapshotAt = nowIso();
  const note = observacoes === undefined ? null : String(observacoes || '').trim().slice(0, 2000);
  const stockRes = await env.DB.prepare(
    `SELECT i.registro, i.codigo_barras, i.produto, i.lote, i.data_validade,
            COALESCE(s.quantidade, 0) AS snapshot_quantity
     FROM insumos_items i
     LEFT JOIN insumos_stocks s ON s.registro = i.registro AND s.unidade = ?
     WHERE COALESCE(i.archived_at, '') = ''`
  ).bind(scope.unit).all();
  const stockRows = stockRes?.results || [];
  const statements = [
    env.DB.prepare(
      `UPDATE insumos_count_sessions
       SET status = 'OPEN', snapshot_at = ?, conflict_at = NULL, conflict_reason = NULL,
           closed_at = NULL, closed_by = ?, observacoes = COALESCE(?, observacoes)
       WHERE id = ? AND status IN ('OPEN', 'CONFLICT')`
    ).bind(snapshotAt, null, note, sessionId),
  ];
  for (const row of stockRows) {
    statements.push(env.DB.prepare(
      `UPDATE insumos_count_lines
       SET snapshot_quantity = ?, physical_quantity = NULL, status = 'OPEN',
           counted_at = NULL, counted_by = NULL, adjustment_movement_id = NULL
       WHERE session_id = ? AND registro = ?`
    ).bind(toInt(row.snapshot_quantity, 0), sessionId, String(row.registro || '').trim()));
    statements.push(env.DB.prepare(
      `INSERT OR IGNORE INTO insumos_count_lines (
        id, session_id, registro, codigo_barras, produto, lote, data_validade,
        snapshot_quantity, physical_quantity, status
      ) VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, NULL, 'OPEN')`
    ).bind(sessionId, String(row.registro || '').trim(), String(row.codigo_barras || ''), String(row.produto || ''), String(row.lote || ''), String(row.data_validade || ''), toInt(row.snapshot_quantity, 0)));
  }
  try {
    const results = await env.DB.batch(statements);
    if (resultChanges(results?.[0]) !== 1) return { ok: false, status: 409, code: 'COUNT_RECOUNT_CONFLICT', error: 'A contagem foi alterada por outra operação' };
  } catch (error) {
    return { ok: false, status: 409, code: 'COUNT_RECOUNT_CONFLICT', error: 'A recontagem não pôde ser aplicada com segurança' };
  }
  return d1GetContagem({ env, id: sessionId, actor, unidade: scope.unit });
}

async function loadProcurementItem({ env, registro, codigoBarras }) {
  const reg = String(registro || '').trim();
  const code = String(codigoBarras || '').trim();
  if (reg) {
    return env.DB.prepare(
      `SELECT registro, codigo_barras, produto, lote, data_validade, archived_at
       FROM insumos_items WHERE registro = ? LIMIT 1`
    ).bind(reg).first();
  }
  if (!code) return null;
  const found = await env.DB.prepare(
    `SELECT i.registro, i.codigo_barras, i.produto, i.lote, i.data_validade, i.archived_at
     FROM insumos_items i
     WHERE i.codigo_barras = ?
        OR EXISTS (SELECT 1 FROM insumos_barcodes b WHERE b.registro = i.registro AND b.codigo_barras = ?)
     ORDER BY i.registro ASC`
  ).bind(code, code).all();
  const rows = found?.results || [];
  if (rows.length === 1) return rows[0];
  if (rows.length > 1) return { ambiguous: true, candidates: rows };
  return null;
}

export async function d1ListFornecedores({ env, unidade, actor, includeArchived = false }) {
  const roleCheck = assertProcurementRole(actor, ['ADMIN', 'GESTOR', 'GERENTE', 'OPERADOR', 'CONSULTOR']);
  if (!roleCheck.ok) return roleCheck;
  const scope = assertActorUnitScope(actor, unidade);
  if (!scope.ok) return scope;
  const sql = `SELECT id, unidade, nome, documento, email, telefone, observacoes,
                      archived_at, archived_by, created_at, created_by, updated_at, updated_by
               FROM insumos_suppliers
               WHERE unidade = ? ${includeArchived ? '' : "AND COALESCE(archived_at, '') = ''"}
               ORDER BY CASE WHEN COALESCE(archived_at, '') = '' THEN 0 ELSE 1 END, lower(nome), id`;
  const result = await env.DB.prepare(sql).bind(scope.unit).all();
  return { ok: true, items: (result?.results || []).map(mapSupplier) };
}

export async function d1CreateFornecedor({ env, unidade, actor, body }) {
  const roleCheck = assertProcurementRole(actor, ['ADMIN', 'GESTOR', 'GERENTE']);
  if (!roleCheck.ok) return roleCheck;
  const scope = assertActorUnitScope(actor, unidade);
  if (!scope.ok) return scope;
  const name = String(body?.nome || body?.name || '').trim().slice(0, 160);
  if (!name) return { ok: false, status: 400, code: 'SUPPLIER_NAME_REQUIRED', error: 'Nome do fornecedor é obrigatório' };
  const existing = await env.DB.prepare(
    `SELECT id, archived_at FROM insumos_suppliers WHERE unidade = ? AND lower(nome) = lower(?) LIMIT 1`
  ).bind(scope.unit, name).first();
  if (existing && !String(existing.archived_at || '').trim()) {
    return { ok: false, status: 409, code: 'SUPPLIER_DUPLICATE', error: 'Já existe um fornecedor ativo com este nome', id: String(existing.id || '') };
  }
  const id = crypto.randomUUID();
  const now = nowIso();
  const actorId = actorName(actor);
  const result = await env.DB.prepare(
    `INSERT INTO insumos_suppliers (
       id, unidade, nome, documento, email, telefone, observacoes,
       archived_at, archived_by, created_at, created_by, updated_at, updated_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`
  ).bind(
    id,
    scope.unit,
    name,
    String(body?.documento || body?.document || '').trim().slice(0, 80) || null,
    String(body?.email || '').trim().slice(0, 160) || null,
    String(body?.telefone || body?.phone || '').trim().slice(0, 60) || null,
    String(body?.observacoes || body?.nota || '').trim().slice(0, 1000) || null,
    now,
    actorId,
    now,
    actorId,
  ).run();
  if (resultChanges(result) !== 1) return { ok: false, status: 409, code: 'SUPPLIER_CREATE_CONFLICT', error: 'Fornecedor não pôde ser cadastrado' };
  const row = await env.DB.prepare(
    `SELECT id, unidade, nome, documento, email, telefone, observacoes, archived_at, archived_by,
            created_at, created_by, updated_at, updated_by
     FROM insumos_suppliers WHERE id = ?`
  ).bind(id).first();
  return { ok: true, supplier: mapSupplier(row) };
}

export async function d1ArchiveFornecedor({ env, id, unidade, actor }) {
  const roleCheck = assertProcurementRole(actor, ['ADMIN', 'GESTOR', 'GERENTE']);
  if (!roleCheck.ok) return roleCheck;
  const scope = assertActorUnitScope(actor, unidade);
  if (!scope.ok) return scope;
  const supplierId = String(id || '').trim();
  if (!supplierId) return { ok: false, status: 400, code: 'SUPPLIER_INVALID', error: 'Fornecedor inválido' };
  const supplier = await env.DB.prepare(
    `SELECT id, unidade, archived_at FROM insumos_suppliers WHERE id = ? LIMIT 1`
  ).bind(supplierId).first();
  if (!supplier) return { ok: false, status: 404, code: 'SUPPLIER_NOT_FOUND', error: 'Fornecedor não encontrado' };
  if (normalizeUnitScope(supplier.unidade) !== scope.unit) return { ok: false, status: 403, code: 'RBAC_UNIT_DENIED', error: 'Sem permissão para unidade' };
  if (String(supplier.archived_at || '').trim()) return { ok: true, alreadyArchived: true, archivedAt: supplier.archived_at };
  const pending = await env.DB.prepare(
    `SELECT id FROM insumos_purchase_orders
     WHERE fornecedor_id = ? AND status IN ('DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED') LIMIT 1`
  ).bind(supplierId).first();
  if (pending) return { ok: false, status: 409, code: 'SUPPLIER_PENDING_ORDERS', error: 'Não é possível arquivar fornecedor com pedido pendente' };
  const archivedAt = nowIso();
  const archivedBy = actorName(actor);
  const result = await env.DB.prepare(
    `UPDATE insumos_suppliers SET archived_at = ?, archived_by = ?, updated_at = ?, updated_by = ?
     WHERE id = ? AND unidade = ? AND COALESCE(archived_at, '') = ''`
  ).bind(archivedAt, archivedBy, archivedAt, archivedBy, supplierId, scope.unit).run();
  if (resultChanges(result) !== 1) return { ok: false, status: 409, code: 'SUPPLIER_ARCHIVE_CONFLICT', error: 'Fornecedor foi alterado por outra operação' };
  return { ok: true, archivedAt };
}

async function loadPurchaseOrderRow({ env, id, unidade }) {
  return env.DB.prepare(
    `SELECT o.id, o.unidade, o.fornecedor_id, s.nome AS fornecedor_nome, o.status, o.expected_at,
            o.observacoes, o.created_at, o.created_by, o.updated_at, o.updated_by,
            o.cancelled_at, o.cancelled_by, o.cancel_reason
     FROM insumos_purchase_orders o
     LEFT JOIN insumos_suppliers s ON s.id = o.fornecedor_id
     WHERE o.id = ? AND o.unidade = ? LIMIT 1`
  ).bind(id, unidade).first();
}

async function loadPurchaseOrderDetails({ env, row }) {
  if (!row) return null;
  const [lineResult, receiptResult] = await Promise.all([
    env.DB.prepare(
      `SELECT id, pedido_id, registro_insumo, codigo_barras, produto, lote, data_validade,
              quantidade_pedida, quantidade_recebida, custo_unitario_centavos
       FROM insumos_purchase_order_lines WHERE pedido_id = ? ORDER BY id`
    ).bind(row.id).all(),
    env.DB.prepare(
      `SELECT id, pedido_id, linha_id, unidade, registro_insumo, codigo_barras, lote, data_validade,
              quantidade, custo_unitario_centavos, movement_id, received_at, received_by, observacoes
       FROM insumos_purchase_receipts WHERE pedido_id = ? ORDER BY received_at, id`
    ).bind(row.id).all(),
  ]);
  return mapPurchaseOrder(
    row,
    (lineResult?.results || []).map(mapPurchaseLine),
    (receiptResult?.results || []).map(mapPurchaseReceipt),
  );
}

export async function d1ListPedidosInternos({ env, unidade, actor, status = '' }) {
  const roleCheck = assertProcurementRole(actor, ['ADMIN', 'GESTOR', 'GERENTE', 'OPERADOR', 'CONSULTOR']);
  if (!roleCheck.ok) return roleCheck;
  const scope = assertActorUnitScope(actor, unidade);
  if (!scope.ok) return scope;
  const normalizedStatus = String(status || '').trim().toUpperCase();
  if (normalizedStatus && !['DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'].includes(normalizedStatus)) {
    return { ok: false, status: 400, code: 'PURCHASE_STATUS_INVALID', error: 'Status de pedido inválido' };
  }
  const result = await env.DB.prepare(
    `SELECT o.id, o.unidade, o.fornecedor_id, s.nome AS fornecedor_nome, o.status, o.expected_at,
            o.observacoes, o.created_at, o.created_by, o.updated_at, o.updated_by,
            o.cancelled_at, o.cancelled_by, o.cancel_reason,
            COUNT(l.id) AS total_linhas, COALESCE(SUM(l.quantidade_pedida), 0) AS total_quantidade,
            COALESCE(SUM(l.quantidade_recebida), 0) AS total_recebida
     FROM insumos_purchase_orders o
     LEFT JOIN insumos_suppliers s ON s.id = o.fornecedor_id
     LEFT JOIN insumos_purchase_order_lines l ON l.pedido_id = o.id
     WHERE o.unidade = ? ${normalizedStatus ? 'AND o.status = ?' : ''}
     GROUP BY o.id ORDER BY o.updated_at DESC, o.id DESC`
  ).bind(...(normalizedStatus ? [scope.unit, normalizedStatus] : [scope.unit])).all();
  return {
    ok: true,
    items: (result?.results || []).map((row) => ({
      ...mapPurchaseOrder(row),
      totalLines: toInt(row.total_linhas, 0),
      totalQuantity: toInt(row.total_quantidade, 0),
      totalReceived: toInt(row.total_recebida, 0),
      totalPending: Math.max(0, toInt(row.total_quantidade, 0) - toInt(row.total_recebida, 0)),
      totalCostCentavos: null,
    })),
  };
}

export async function d1GetPedidoInterno({ env, id, unidade, actor }) {
  const roleCheck = assertProcurementRole(actor, ['ADMIN', 'GESTOR', 'GERENTE', 'OPERADOR', 'CONSULTOR']);
  if (!roleCheck.ok) return roleCheck;
  const scope = assertActorUnitScope(actor, unidade);
  if (!scope.ok) return scope;
  const orderId = String(id || '').trim();
  if (!orderId) return { ok: false, status: 400, code: 'PURCHASE_INVALID', error: 'Pedido inválido' };
  const row = await loadPurchaseOrderRow({ env, id: orderId, unidade: scope.unit });
  if (!row) return { ok: false, status: 404, code: 'PURCHASE_NOT_FOUND', error: 'Pedido não encontrado' };
  return { ok: true, order: await loadPurchaseOrderDetails({ env, row }) };
}

export async function d1CreatePedidoInterno({ env, unidade, actor, body }) {
  const roleCheck = assertProcurementRole(actor, ['ADMIN', 'GESTOR', 'GERENTE']);
  if (!roleCheck.ok) return roleCheck;
  const scope = assertActorUnitScope(actor, unidade);
  if (!scope.ok) return scope;
  const requestedStatus = String(body?.status || 'DRAFT').trim().toUpperCase();
  if (!['DRAFT', 'ORDERED'].includes(requestedStatus)) return { ok: false, status: 400, code: 'PURCHASE_STATUS_INVALID', error: 'Um novo pedido só pode ser rascunho ou solicitado' };
  const rawLines = Array.isArray(body?.linhas) ? body.linhas : Array.isArray(body?.lines) ? body.lines : Array.isArray(body?.itens) ? body.itens : [];
  if (!rawLines.length || rawLines.length > 100) return { ok: false, status: 400, code: 'PURCHASE_LINES_REQUIRED', error: 'O pedido precisa de pelo menos uma linha e no máximo 100' };

  const supplierId = String(body?.fornecedorId || body?.supplierId || '').trim() || null;
  if (supplierId) {
    const supplier = await env.DB.prepare(
      `SELECT id, unidade, archived_at FROM insumos_suppliers WHERE id = ? LIMIT 1`
    ).bind(supplierId).first();
    if (!supplier) return { ok: false, status: 404, code: 'SUPPLIER_NOT_FOUND', error: 'Fornecedor não encontrado' };
    if (normalizeUnitScope(supplier.unidade) !== scope.unit) return { ok: false, status: 403, code: 'RBAC_UNIT_DENIED', error: 'Fornecedor fora do escopo da unidade' };
    if (String(supplier.archived_at || '').trim()) return { ok: false, status: 409, code: 'SUPPLIER_ARCHIVED', error: 'Fornecedor arquivado não pode receber novos pedidos' };
  }

  const lines = [];
  const seenRecords = new Set();
  for (const raw of rawLines) {
    const quantity = toInt(raw?.quantidade ?? raw?.quantity, NaN);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) return { ok: false, status: 400, code: 'PURCHASE_QUANTITY_INVALID', error: 'Quantidade pedida deve ser um inteiro positivo' };
    const cost = parseCents(raw?.custoUnitarioCentavos ?? raw?.unitCostCents ?? raw?.custoCentavos);
    if (!Number.isSafeInteger(cost)) return { ok: false, status: 400, code: 'COST_CENTS_REQUIRED', error: 'Custo unitário deve ser informado em centavos inteiros' };
    const item = await loadProcurementItem({ env, registro: raw?.registro || raw?.registroInsumo, codigoBarras: raw?.codigoBarras || raw?.codigo });
    if (item?.ambiguous) return { ok: false, status: 409, code: 'PURCHASE_AMBIGUOUS_ITEM', error: 'Código possui múltiplos lotes; informe o registro', candidates: item.candidates.map((candidate) => String(candidate.registro || '')) };
    if (!item) return { ok: false, status: 404, code: 'INSUMO_NOT_FOUND', error: 'Insumo não encontrado' };
    if (String(item.archived_at || '').trim()) return { ok: false, status: 409, code: 'INSUMO_ARCHIVED', error: 'Insumo arquivado não pode entrar em novo pedido' };
    const record = String(item.registro || '').trim();
    if (seenRecords.has(record)) return { ok: false, status: 400, code: 'PURCHASE_DUPLICATE_LINE', error: 'O mesmo registro não pode aparecer em duas linhas do pedido' };
    seenRecords.add(record);
    const lot = String(raw?.lote ?? item.lote ?? '').trim() || null;
    const expiry = String(raw?.dataValidade ?? raw?.validade ?? item.data_validade ?? '').trim() || null;
    if (String(item.lote || '').trim() && lot !== String(item.lote).trim()) return { ok: false, status: 400, code: 'PURCHASE_LOT_MISMATCH', error: 'Lote da linha não corresponde ao registro do insumo' };
    lines.push({ item, quantity, cost, lot, expiry });
  }

  const id = crypto.randomUUID();
  const actorId = actorName(actor);
  const now = nowIso();
  const statements = [env.DB.prepare(
    `INSERT INTO insumos_purchase_orders
       (id, unidade, fornecedor_id, status, expected_at, observacoes, created_at, created_by, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    scope.unit,
    supplierId,
    requestedStatus,
    String(body?.expectedAt || body?.dataEsperada || '').trim() || null,
    String(body?.observacoes || body?.nota || '').trim().slice(0, 2000) || null,
    now,
    actorId,
    now,
    actorId,
  )];
  for (const line of lines) {
    statements.push(env.DB.prepare(
      `INSERT INTO insumos_purchase_order_lines
         (id, pedido_id, registro_insumo, codigo_barras, produto, lote, data_validade,
          quantidade_pedida, quantidade_recebida, custo_unitario_centavos, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(), id, String(line.item.registro || ''), String(line.item.codigo_barras || ''), String(line.item.produto || ''),
      line.lot, line.expiry, line.quantity, line.cost, now, actorId,
    ));
  }
  await env.DB.batch(statements);
  const created = await d1GetPedidoInterno({ env, id, unidade: scope.unit, actor });
  return { ok: true, ...created };
}

export async function d1ReceberPedidoInterno({ env, id, unidade, actor, body }) {
  const roleCheck = assertProcurementRole(actor, ['ADMIN', 'GESTOR', 'GERENTE', 'OPERADOR']);
  if (!roleCheck.ok) return roleCheck;
  const scope = assertActorUnitScope(actor, unidade);
  if (!scope.ok) return scope;
  const orderId = String(id || '').trim();
  const row = await loadPurchaseOrderRow({ env, id: orderId, unidade: scope.unit });
  if (!row) return { ok: false, status: 404, code: 'PURCHASE_NOT_FOUND', error: 'Pedido não encontrado' };
  if (['CANCELLED', 'RECEIVED'].includes(String(row.status || '').toUpperCase())) return { ok: false, status: 409, code: 'PURCHASE_NOT_RECEIVABLE', error: 'Pedido não aceita recebimentos neste estado' };
  const rawReceipts = Array.isArray(body?.linhas) ? body.linhas : Array.isArray(body?.lines) ? body.lines : Array.isArray(body?.itens) ? body.itens : [];
  if (!rawReceipts.length) return { ok: false, status: 400, code: 'RECEIPT_LINES_REQUIRED', error: 'Informe ao menos uma linha para recebimento' };
  const linesResult = await env.DB.prepare(
    `SELECT id, pedido_id, registro_insumo, codigo_barras, produto, lote, data_validade,
            quantidade_pedida, quantidade_recebida, custo_unitario_centavos
     FROM insumos_purchase_order_lines WHERE pedido_id = ? ORDER BY id`
  ).bind(orderId).all();
  const lineMap = new Map((linesResult?.results || []).map((line) => [String(line.id || ''), line]));
  const seen = new Set();
  const receipts = [];
  for (const raw of rawReceipts) {
    const lineId = String(raw?.linhaId || raw?.lineId || '').trim();
    if (!lineId || seen.has(lineId)) return { ok: false, status: 400, code: 'RECEIPT_LINE_INVALID', error: 'Linha de recebimento inválida ou repetida' };
    seen.add(lineId);
    const line = lineMap.get(lineId);
    if (!line) return { ok: false, status: 404, code: 'PURCHASE_LINE_NOT_FOUND', error: 'Linha do pedido não encontrada' };
    const quantity = toInt(raw?.quantidade ?? raw?.quantity, NaN);
    const pending = toInt(line.quantidade_pedida, 0) - toInt(line.quantidade_recebida, 0);
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > pending) return { ok: false, status: 409, code: 'RECEIPT_EXCEEDS_PENDING', error: 'Recebimento excede a quantidade pendente', pending, lineId };
    const cost = raw?.custoUnitarioCentavos ?? raw?.unitCostCents ?? raw?.custoCentavos;
    const costCents = cost === undefined ? toInt(line.custo_unitario_centavos, 0) : parseCents(cost);
    if (!Number.isSafeInteger(costCents)) return { ok: false, status: 400, code: 'COST_CENTS_INVALID', error: 'Custo unitário deve ser um inteiro em centavos', lineId };
    const lot = String(raw?.lote ?? line.lote ?? '').trim() || null;
    const expiry = String(raw?.dataValidade ?? raw?.validade ?? line.data_validade ?? '').trim() || null;
    if (String(line.lote || '').trim() && lot !== String(line.lote).trim()) return { ok: false, status: 400, code: 'RECEIPT_LOT_MISMATCH', error: 'Lote recebido não corresponde à linha do pedido', lineId };
    receipts.push({ line, quantity, costCents, lot, expiry, id: crypto.randomUUID(), movementId: crypto.randomUUID(), receivedAt: nowIso() });
  }

  const actorId = actorName(actor);
  const notes = String(body?.observacoes || body?.nota || '').trim().slice(0, 1000) || null;
  const allStatements = [];
  const offsets = [];
  for (const receipt of receipts) {
    const { line, quantity, costCents, lot, expiry, id: receiptId, movementId, receivedAt } = receipt;
    const reg = String(line.registro_insumo || '').trim();
    const code = String(line.codigo_barras || '').trim();
    const product = String(line.produto || '').trim();
    const reason = `Recebimento pedido ${orderId}`;
    const stockUpdateIndex = allStatements.length;
    allStatements.push(env.DB.prepare(
      `UPDATE insumos_stocks
       SET quantidade = quantidade + ?, updated_at = ?
       WHERE registro = ? AND unidade = ?
         AND EXISTS (
           SELECT 1 FROM insumos_purchase_order_lines l
           JOIN insumos_purchase_orders o ON o.id = l.pedido_id
           JOIN insumos_items i ON i.registro = l.registro_insumo
           WHERE l.id = ? AND l.pedido_id = ?
             AND l.quantidade_pedida - l.quantidade_recebida >= ?
             AND o.status NOT IN ('CANCELLED', 'RECEIVED')
             AND COALESCE(i.archived_at, '') = ''
         )`
    ).bind(quantity, receivedAt, reg, scope.unit, line.id, orderId, quantity));
    allStatements.push(env.DB.prepare(
      `INSERT OR IGNORE INTO insumos_stocks (registro, unidade, quantidade, updated_at)
       SELECT ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM insumos_purchase_order_lines l
         JOIN insumos_purchase_orders o ON o.id = l.pedido_id
         JOIN insumos_items i ON i.registro = l.registro_insumo
         WHERE l.id = ? AND l.pedido_id = ?
           AND l.quantidade_pedida - l.quantidade_recebida >= ?
           AND o.status NOT IN ('CANCELLED', 'RECEIVED')
           AND COALESCE(i.archived_at, '') = ''
       )`
    ).bind(reg, scope.unit, quantity, receivedAt, line.id, orderId, quantity));
    allStatements.push(env.DB.prepare(
      `INSERT INTO insumos_movements (
        id, data_hora, tipo, codigo_barras, registro_insumo, lote, data_validade,
        produto, quantidade, estoque_anterior, estoque_novo, unidade, usuario,
        motivo, observacoes, status
      )
      SELECT ?, ?, 'ENTRADA', ?, ?, ?, ?, ?, ?, quantidade - ?, quantidade, ?, ?, ?, ?, 'COMPLETED'
      FROM insumos_stocks
      WHERE registro = ? AND unidade = ? AND updated_at = ?
        AND EXISTS (
          SELECT 1 FROM insumos_purchase_order_lines l
          WHERE l.id = ? AND l.pedido_id = ? AND l.quantidade_pedida - l.quantidade_recebida >= ?
        )`
    ).bind(movementId, receivedAt, code, reg, lot, expiry, product, quantity, quantity, scope.unit, actorId, reason, notes, reg, scope.unit, receivedAt, line.id, orderId, quantity));
    const movementIndex = allStatements.length - 1;
    allStatements.push(env.DB.prepare(
      `INSERT INTO insumos_purchase_receipts (
        id, pedido_id, linha_id, unidade, registro_insumo, codigo_barras, lote, data_validade,
        quantidade, custo_unitario_centavos, movement_id, received_at, received_by, observacoes
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM insumos_movements WHERE id = ?)`
    ).bind(receiptId, orderId, line.id, scope.unit, reg, code, lot, expiry, quantity, costCents, movementId, receivedAt, actorId, notes, movementId));
    const receiptIndex = allStatements.length - 1;
    allStatements.push(env.DB.prepare(
      `UPDATE insumos_purchase_order_lines
       SET quantidade_recebida = quantidade_recebida + ?
       WHERE id = ? AND pedido_id = ? AND quantidade_pedida - quantidade_recebida >= ?
         AND EXISTS (SELECT 1 FROM insumos_purchase_receipts WHERE id = ?)`
    ).bind(quantity, line.id, orderId, quantity, receiptId));
    const lineIndex = allStatements.length - 1;
    offsets.push({ stockUpdateIndex, movementIndex, receiptIndex, lineIndex, receipt });
  }
  allStatements.push(env.DB.prepare(
    `UPDATE insumos_purchase_orders
     SET status = CASE
       WHEN NOT EXISTS (SELECT 1 FROM insumos_purchase_order_lines WHERE pedido_id = ? AND quantidade_recebida < quantidade_pedida) THEN 'RECEIVED'
       WHEN EXISTS (SELECT 1 FROM insumos_purchase_order_lines WHERE pedido_id = ? AND quantidade_recebida > 0) THEN 'PARTIALLY_RECEIVED'
       ELSE status END,
       updated_at = ?, updated_by = ?
     WHERE id = ? AND unidade = ? AND status NOT IN ('CANCELLED', 'RECEIVED')`
  ).bind(orderId, orderId, nowIso(), actorId, orderId, scope.unit));
  const results = await env.DB.batch(allStatements);
  for (const offset of offsets) {
    if (resultChanges(results?.[offset.movementIndex]) !== 1 || resultChanges(results?.[offset.receiptIndex]) !== 1 || resultChanges(results?.[offset.lineIndex]) !== 1) {
      return { ok: false, status: 409, code: 'RECEIPT_CONFLICT', error: 'O recebimento foi alterado por outra operação; recarregue o pedido' };
    }
  }
  const order = await d1GetPedidoInterno({ env, id: orderId, unidade: scope.unit, actor });
  return { ok: true, ...order, received: receipts.map((receipt) => ({ lineId: String(receipt.line.id || ''), receiptId: receipt.id, movementId: receipt.movementId, quantidade: receipt.quantity, custoUnitarioCentavos: receipt.costCents })) };
}

export async function d1CancelarPedidoInterno({ env, id, unidade, actor, justificativa }) {
  const roleCheck = assertProcurementRole(actor, ['ADMIN', 'GESTOR', 'GERENTE']);
  if (!roleCheck.ok) return roleCheck;
  const scope = assertActorUnitScope(actor, unidade);
  if (!scope.ok) return scope;
  const orderId = String(id || '').trim();
  const reason = String(justificativa || '').trim().slice(0, 1000);
  if (!reason) return { ok: false, status: 400, code: 'CANCEL_REASON_REQUIRED', error: 'Justificativa é obrigatória para cancelar o pedido' };
  const row = await loadPurchaseOrderRow({ env, id: orderId, unidade: scope.unit });
  if (!row) return { ok: false, status: 404, code: 'PURCHASE_NOT_FOUND', error: 'Pedido não encontrado' };
  if (['RECEIVED', 'CANCELLED'].includes(String(row.status || '').toUpperCase())) return { ok: false, status: 409, code: 'PURCHASE_NOT_CANCELLABLE', error: 'Pedido não pode ser cancelado neste estado' };
  const now = nowIso();
  const result = await env.DB.prepare(
    `UPDATE insumos_purchase_orders
     SET status = 'CANCELLED', cancelled_at = ?, cancelled_by = ?, cancel_reason = ?, updated_at = ?, updated_by = ?
     WHERE id = ? AND unidade = ? AND status IN ('DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED')`
  ).bind(now, actorName(actor), reason, now, actorName(actor), orderId, scope.unit).run();
  if (resultChanges(result) !== 1) return { ok: false, status: 409, code: 'PURCHASE_CANCEL_CONFLICT', error: 'Pedido foi alterado por outra operação' };
  const order = await d1GetPedidoInterno({ env, id: orderId, unidade: scope.unit, actor });
  return { ok: true, ...order };
}

export async function d1Transfer({ env, body, actor, unidade }) {
  const codigo = String(body?.codigoBarras || '').trim();
  const registro = String(body?.registro || '').trim();
  const quantidade = Math.max(1, toInt(body?.quantidade, 0));
  const fromUnidade = String(body?.fromUnidade || body?.unidadeOrigem || body?.from || '').trim();
  const toUnidade = String(body?.toUnidade || body?.unidadeDestino || body?.to || '').trim();
  const observacoes = String(body?.observacoes || '').trim();

  if (!codigo || !quantidade) return { ok: false, status: 400, error: 'Código e quantidade são obrigatórios' };
  if (!fromUnidade || !toUnidade) return { ok: false, status: 400, error: 'Unidade origem e destino são obrigatórias' };
  if (fromUnidade === toUnidade) return { ok: false, status: 400, error: 'Origem e destino devem ser diferentes' };
  const fromScope = assertActorUnitScope(actor, fromUnidade);
  const toScope = assertActorUnitScope(actor, toUnidade);
  if (!fromScope.ok) return fromScope;
  if (!toScope.ok) return toScope;
  if (unidade && normalizeUnitScope(unidade) !== fromScope.unit) {
    return { ok: false, status: 400, code: 'UNIT_ORIGIN_MISMATCH', error: 'A unidade da rota deve ser a origem da transferência' };
  }

  const pick = await pickRegistroOrAmbiguous(env, { codigo, registro, unidade: fromScope.unit, quantidade, allowFefo: true });
  if (!pick.ok) {
    const status = pick.code === 'NOT_FOUND' ? 404 : (pick.code === 'AMBIGUOUS' || pick.code === 'INSUFFICIENT_STOCK') ? 409 : 400;
    return { ok: false, status, error: pick.error, code: pick.code, registros: pick.registros || [], candidates: pick.candidates || [] };
  }
  const reg = pick.registro;

  const item = await env.DB.prepare(
    `SELECT registro, codigo_barras, produto, categoria, lote, data_validade,
            policy_requires_lot, policy_requires_expiry, policy_fefo, archived_at
     FROM insumos_items WHERE registro = ?`
  ).bind(reg).first();
  if (!item) return { ok: false, status: 404, error: 'Insumo não encontrado' };
  if (String(item.archived_at || '').trim()) return { ok: false, status: 409, code: 'INSUMO_ARCHIVED', error: 'Insumo arquivado não aceita movimentações' };

  const policy = await resolveItemPolicy(env, item, item?.categoria || '');
  const policyCheck = enforceLotExpiryPolicyOrError({
    policy,
    lote: String(item?.lote || ''),
    dataValidade: String(item?.data_validade || '')
  });
  if (!policyCheck.ok) return policyCheck;

  const beforeOrig = await env.DB.prepare(
    `SELECT quantidade FROM insumos_stocks WHERE registro = ? AND unidade = ?`
  ).bind(reg, fromScope.unit).first();
  const beforeDest = await env.DB.prepare(
    `SELECT quantidade FROM insumos_stocks WHERE registro = ? AND unidade = ?`
  ).bind(reg, toScope.unit).first();
  const estoqueAnteriorOrigem = toInt(beforeOrig?.quantidade, 0);
  const estoqueAnteriorDestino = toInt(beforeDest?.quantidade, 0);
  const ts = nowIso();
  const transferId = crypto.randomUUID();
  const dispatchMovementId = crypto.randomUUID();

  const obsSaida = `Transferência para ${toScope.unit}${observacoes ? ` | ${observacoes}` : ''}`;
  const actorId = actorName(actor);

  const stmts = [];
  stmts.push(
    env.DB.prepare(
      `UPDATE insumos_stocks
       SET quantidade = quantidade - ?, updated_at = ?
       WHERE registro = ? AND unidade = ? AND quantidade >= ?`
    ).bind(quantidade, ts, reg, fromScope.unit, quantidade)
  );
  stmts.push(
    env.DB.prepare(
      `INSERT INTO insumos_transfers (
        id, registro_insumo, codigo_barras, lote, data_validade, produto,
        quantidade, unidade_origem, unidade_destino, status, dispatched_at,
        dispatched_by, dispatch_movement_id
      )
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_RECEIPT', ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM insumos_stocks
         WHERE registro = ? AND unidade = ? AND updated_at = ?
       )`
    ).bind(
      transferId,
      reg,
      codigo,
      String(item.lote || ''),
      String(item.data_validade || ''),
      String(item.produto || ''),
      quantidade,
      fromScope.unit,
      toScope.unit,
      ts,
      actorId,
      dispatchMovementId,
      reg,
      fromScope.unit,
      ts,
    )
  );

  const produto = String(item.produto || '');
  const lote = String(item.lote || '');
  const dataValidade = String(item.data_validade || '');

  stmts.push(
    env.DB.prepare(
      `INSERT INTO insumos_movements (
        id, data_hora, tipo, codigo_barras, registro_insumo, lote, data_validade, produto,
        quantidade, estoque_anterior, estoque_novo, unidade, unidade_origem, unidade_destino, id_transferencia, usuario, observacoes, status
      )
      SELECT ?, ?, 'SAÍDA', ?, ?, ?, ?, ?, ?, quantidade + ?, quantidade, ?, ?, ?, ?, ?, ?, 'PENDING_RECEIPT'
      FROM insumos_stocks
      WHERE registro = ? AND unidade = ? AND updated_at = ?
        AND EXISTS (
          SELECT 1 FROM insumos_transfers
          WHERE id = ? AND status = 'PENDING_RECEIPT' AND dispatched_at = ?
        )`
    ).bind(
      dispatchMovementId,
      ts,
      codigo,
      reg,
      lote,
      dataValidade,
      produto,
      quantidade,
      quantidade,
      fromScope.unit,
      fromScope.unit,
      toScope.unit,
      transferId,
      actorId,
      obsSaida,
      reg,
      fromScope.unit,
      ts,
      transferId,
      ts
    )
  );

  const results = await env.DB.batch(stmts);
  if (resultChanges(results?.[0]) !== 1 || resultChanges(results?.[1]) !== 1 || resultChanges(results?.[2]) !== 1) {
    const current = await env.DB.prepare(
      `SELECT quantidade FROM insumos_stocks WHERE registro = ? AND unidade = ?`
    ).bind(reg, fromScope.unit).first();
    const currentStock = toInt(current?.quantidade, 0);
    return { ok: false, status: 409, code: 'INSUFFICIENT_STOCK', error: 'Estoque insuficiente na unidade de origem', estoqueAnteriorOrigem: currentStock, deficitOrigem: Math.max(0, quantidade - currentStock) };
  }
  const sourceAfter = await env.DB.prepare('SELECT quantidade FROM insumos_stocks WHERE registro = ? AND unidade = ?').bind(reg, fromScope.unit).first();
  const destinationAfter = await env.DB.prepare('SELECT quantidade FROM insumos_stocks WHERE registro = ? AND unidade = ?').bind(reg, toScope.unit).first();
  const estoqueNovoOrigem = toInt(sourceAfter?.quantidade, 0);
  const estoqueNovoDestino = toInt(destinationAfter?.quantidade, 0);
  return {
    ok: true,
    transferId,
    dispatchMovementId,
    status: 'PENDING_RECEIPT',
    pendingReceipt: true,
    unidadeOrigem: fromScope.unit,
    unidadeDestino: toScope.unit,
    estoqueAnteriorOrigem,
    estoqueNovoOrigem,
    estoqueAnteriorDestino,
    estoqueNovoDestino,
    quebraEstoqueOrigem: false,
    deficitOrigem: 0,
    registro: reg
  };
}

export async function d1ReceberTransferencia({ env, id, actor, unidade, observacoes }) {
  const transferId = String(id || '').trim();
  if (!transferId) return { ok: false, status: 400, code: 'TRANSFER_INVALID', error: 'Transferência inválida' };

  const transfer = await env.DB.prepare(
    `SELECT id, registro_insumo, codigo_barras, lote, data_validade, produto,
            quantidade, unidade_origem, unidade_destino, status, dispatched_at,
            dispatched_by, received_at, received_by, dispatch_movement_id,
            receipt_movement_id
     FROM insumos_transfers
     WHERE id = ?
     LIMIT 1`
  ).bind(transferId).first();
  if (!transfer) return { ok: false, status: 404, code: 'TRANSFER_NOT_FOUND', error: 'Transferência não encontrada' };

  const destinationScope = assertActorUnitScope(actor, transfer.unidade_destino);
  if (!destinationScope.ok) return destinationScope;
  if (unidade && normalizeUnitScope(unidade) !== destinationScope.unit) {
    return { ok: false, status: 400, code: 'UNIT_DESTINATION_MISMATCH', error: 'A unidade da rota deve ser o destino da transferência' };
  }
  const status = String(transfer.status || '').toUpperCase();
  if (status === 'RECEIVED') return { ok: false, status: 409, code: 'TRANSFER_ALREADY_RECEIVED', error: 'A transferência já foi recebida', receivedAt: transfer.received_at || null };
  if (status === 'CANCELLED') return { ok: false, status: 409, code: 'TRANSFER_CANCELLED', error: 'A transferência foi cancelada' };

  const item = await env.DB.prepare(
    `SELECT archived_at FROM insumos_items WHERE registro = ? LIMIT 1`
  ).bind(transfer.registro_insumo).first();
  if (String(item?.archived_at || '').trim()) {
    return { ok: false, status: 409, code: 'INSUMO_ARCHIVED', error: 'Insumo arquivado não aceita recebimento' };
  }

  const quantity = Math.max(1, toInt(transfer.quantidade, 0));
  if (!quantity) return { ok: false, status: 409, code: 'TRANSFER_INVALID', error: 'Quantidade de transferência inválida' };
  const ts = nowIso();
  const actorId = actorName(actor);
  const receiptMovementId = crypto.randomUUID();
  const note = String(observacoes || '').trim();
  const receiptNote = `Recebimento de transferência de ${normalizeUnitScope(transfer.unidade_origem)}${note ? ` | ${note}` : ''}`;

  const statements = [
    env.DB.prepare(
      `UPDATE insumos_transfers
       SET status = 'RECEIVED', received_at = ?, received_by = ?, receipt_movement_id = ?
       WHERE id = ? AND status = 'PENDING_RECEIPT' AND unidade_destino = ?`
    ).bind(ts, actorId, receiptMovementId, transferId, destinationScope.unit),
    env.DB.prepare(
      `INSERT INTO insumos_stocks (registro, unidade, quantidade, updated_at)
       SELECT ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM insumos_transfers
         WHERE id = ? AND status = 'RECEIVED' AND received_at = ?
       )
       ON CONFLICT(registro, unidade) DO UPDATE SET
         quantidade = insumos_stocks.quantidade + excluded.quantidade,
         updated_at = excluded.updated_at`
    ).bind(transfer.registro_insumo, destinationScope.unit, quantity, ts, transferId, ts),
    env.DB.prepare(
      `INSERT INTO insumos_movements (
        id, data_hora, tipo, codigo_barras, registro_insumo, lote, data_validade,
        produto, quantidade, estoque_anterior, estoque_novo, unidade,
        unidade_origem, unidade_destino, id_transferencia, usuario, observacoes, status
      )
      SELECT ?, ?, 'ENTRADA', ?, ?, ?, ?, ?, ?, quantidade - ?, quantidade, ?, ?, ?, ?, ?, ?, 'COMPLETED'
      FROM insumos_stocks
      WHERE registro = ? AND unidade = ? AND updated_at = ?
        AND EXISTS (
          SELECT 1 FROM insumos_transfers
          WHERE id = ? AND status = 'RECEIVED' AND received_at = ?
        )`
    ).bind(
      receiptMovementId,
      ts,
      transfer.codigo_barras || '',
      transfer.registro_insumo || '',
      transfer.lote || '',
      transfer.data_validade || '',
      transfer.produto || '',
      quantity,
      quantity,
      destinationScope.unit,
      transfer.unidade_origem || '',
      transfer.unidade_destino || '',
      transferId,
      actorId,
      receiptNote,
      transfer.registro_insumo,
      destinationScope.unit,
      ts,
      transferId,
      ts,
    ),
  ];

  const results = await env.DB.batch(statements);
  if (resultChanges(results?.[0]) !== 1 || resultChanges(results?.[1]) !== 1 || resultChanges(results?.[2]) !== 1) {
    const current = await env.DB.prepare(
      `SELECT status, received_at FROM insumos_transfers WHERE id = ? LIMIT 1`
    ).bind(transferId).first();
    if (String(current?.status || '').toUpperCase() === 'RECEIVED') {
      return { ok: false, status: 409, code: 'TRANSFER_ALREADY_RECEIVED', error: 'A transferência já foi recebida', receivedAt: current.received_at || null };
    }
    return { ok: false, status: 409, code: 'TRANSFER_RECEIPT_CONFLICT', error: 'O recebimento não pôde ser efetivado com segurança' };
  }

  const destinationAfter = await env.DB.prepare(
    `SELECT quantidade FROM insumos_stocks WHERE registro = ? AND unidade = ?`
  ).bind(transfer.registro_insumo, destinationScope.unit).first();
  return {
    ok: true,
    transferId,
    receiptMovementId,
    status: 'RECEIVED',
    receivedBy: actorId,
    receivedAt: ts,
    unidadeOrigem: normalizeUnitScope(transfer.unidade_origem),
    unidadeDestino: destinationScope.unit,
    registro: transfer.registro_insumo,
    estoqueNovoDestino: toInt(destinationAfter?.quantidade, 0),
  };
}

export async function d1CancelarTransferencia({ env, id, actor, unidade, justificativa }) {
  const transferId = String(id || '').trim();
  const reason = String(justificativa || '').trim();
  if (!transferId) return { ok: false, status: 400, code: 'TRANSFER_INVALID', error: 'Transferência inválida' };
  if (reason.length < 3) return { ok: false, status: 400, code: 'JUSTIFICATION_REQUIRED', error: 'Motivo do cancelamento é obrigatório' };

  const transfer = await env.DB.prepare(
    `SELECT id, registro_insumo, codigo_barras, lote, data_validade, produto,
            quantidade, unidade_origem, unidade_destino, status, dispatched_at,
            dispatched_by, dispatch_movement_id
     FROM insumos_transfers WHERE id = ? LIMIT 1`
  ).bind(transferId).first();
  if (!transfer) return { ok: false, status: 404, code: 'TRANSFER_NOT_FOUND', error: 'Transferência não encontrada' };

  const originScope = assertActorUnitScope(actor, transfer.unidade_origem);
  if (!originScope.ok) return originScope;
  if (unidade && normalizeUnitScope(unidade) !== originScope.unit) {
    return { ok: false, status: 400, code: 'UNIT_ORIGIN_MISMATCH', error: 'A unidade da rota deve ser a origem da transferência' };
  }
  const status = String(transfer.status || '').toUpperCase();
  if (status === 'CANCELLED') return { ok: false, status: 409, code: 'TRANSFER_ALREADY_CANCELLED', error: 'A transferência já foi cancelada' };
  if (status === 'RECEIVED') return { ok: false, status: 409, code: 'TRANSFER_ALREADY_RECEIVED', error: 'A transferência já foi recebida; use estorno compensatório' };

  const dispatchMovement = transfer.dispatch_movement_id
    ? await env.DB.prepare(
      `SELECT id, tipo, unidade, unidade_origem, unidade_destino, quantidade
       FROM insumos_movements WHERE id = ? LIMIT 1`
    ).bind(transfer.dispatch_movement_id).first()
    : await env.DB.prepare(
      `SELECT id, tipo, unidade, unidade_origem, unidade_destino, quantidade
       FROM insumos_movements
       WHERE id_transferencia = ? AND UPPER(tipo) IN ('SAÍDA', 'SAIDA')
       ORDER BY data_hora ASC, id ASC LIMIT 1`
    ).bind(transferId).first();
  if (!dispatchMovement?.id) return { ok: false, status: 409, code: 'TRANSFER_INVALID', error: 'Despacho da transferência não encontrado' };

  const quantity = Math.max(1, toInt(transfer.quantidade, dispatchMovement.quantidade));
  const ts = nowIso();
  const actorId = actorName(actor);
  const reversalId = crypto.randomUUID();
  const note = `Cancelamento da transferência para ${normalizeUnitScope(transfer.unidade_destino)} | ${reason}`;

  const statements = [
    env.DB.prepare(
      `UPDATE insumos_transfers
       SET status = 'CANCELLED', cancelled_at = ?, cancelled_by = ?, reason = ?
       WHERE id = ? AND status = 'PENDING_RECEIPT' AND unidade_origem = ?`
    ).bind(ts, actorId, reason, transferId, originScope.unit),
    env.DB.prepare(
      `INSERT INTO insumos_stocks (registro, unidade, quantidade, updated_at)
       SELECT ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM insumos_transfers
         WHERE id = ? AND status = 'CANCELLED' AND cancelled_at = ?
       )
       ON CONFLICT(registro, unidade) DO UPDATE SET
         quantidade = insumos_stocks.quantidade + excluded.quantidade,
         updated_at = excluded.updated_at`
    ).bind(transfer.registro_insumo, originScope.unit, quantity, ts, transferId, ts),
    env.DB.prepare(
      `INSERT INTO insumos_movements (
        id, data_hora, tipo, codigo_barras, registro_insumo, lote, data_validade,
        produto, quantidade, estoque_anterior, estoque_novo, unidade,
        unidade_origem, unidade_destino, id_transferencia, usuario, motivo,
        observacoes, status, estorno_de, tipo_compensacao
      )
      SELECT ?, ?, 'ESTORNO', ?, ?, ?, ?, ?, ?, quantidade - ?, quantidade, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?, 'ENTRADA'
      FROM insumos_stocks
      WHERE registro = ? AND unidade = ? AND updated_at = ?
        AND EXISTS (
          SELECT 1 FROM insumos_transfers
          WHERE id = ? AND status = 'CANCELLED' AND cancelled_at = ?
        )`
    ).bind(
      reversalId,
      ts,
      transfer.codigo_barras || '',
      transfer.registro_insumo || '',
      transfer.lote || '',
      transfer.data_validade || '',
      transfer.produto || '',
      quantity,
      quantity,
      originScope.unit,
      transfer.unidade_origem || '',
      transfer.unidade_destino || '',
      transferId,
      actorId,
      reason,
      note,
      dispatchMovement.id,
      transfer.registro_insumo,
      originScope.unit,
      ts,
      transferId,
      ts,
    ),
  ];
  const results = await env.DB.batch(statements);
  if (resultChanges(results?.[0]) !== 1 || resultChanges(results?.[1]) !== 1 || resultChanges(results?.[2]) !== 1) {
    const current = await env.DB.prepare('SELECT status FROM insumos_transfers WHERE id = ? LIMIT 1').bind(transferId).first();
    if (String(current?.status || '').toUpperCase() === 'CANCELLED') {
      return { ok: false, status: 409, code: 'TRANSFER_ALREADY_CANCELLED', error: 'A transferência já foi cancelada' };
    }
    return { ok: false, status: 409, code: 'TRANSFER_CANCEL_CONFLICT', error: 'O cancelamento não pôde ser aplicado com segurança' };
  }
  const originAfter = await env.DB.prepare(
    `SELECT quantidade FROM insumos_stocks WHERE registro = ? AND unidade = ?`
  ).bind(transfer.registro_insumo, originScope.unit).first();
  return {
    ok: true,
    transferId,
    reversalId,
    status: 'CANCELLED',
    cancelledBy: actorId,
    cancelledAt: ts,
    unidadeOrigem: originScope.unit,
    unidadeDestino: normalizeUnitScope(transfer.unidade_destino),
    registro: transfer.registro_insumo,
    estoqueNovoOrigem: toInt(originAfter?.quantidade, 0),
  };
}

async function d1EstornarMovimentacaoLegacy({ env, id, actor, justificativa }) {
  const movementId = String(id || '').trim();
  const reason = String(justificativa || '').trim();
  if (!movementId) return { ok: false, status: 400, code: 'MOVEMENT_INVALID', error: 'Movimentação inválida' };
  if (reason.length < 3) return { ok: false, status: 400, code: 'JUSTIFICATION_REQUIRED', error: 'Motivo do estorno é obrigatório' };
  const original = await env.DB.prepare(
    `SELECT id, data_hora, tipo, codigo_barras, registro_insumo, lote, data_validade,
            produto, quantidade, estoque_anterior, estoque_novo, unidade,
            unidade_origem, unidade_destino, id_transferencia, usuario, motivo,
            observacoes, status, estorno_de
     FROM insumos_movements
     WHERE id = ?
     LIMIT 1`
  ).bind(movementId).first();
  if (!original) return { ok: false, status: 404, code: 'MOVEMENT_NOT_FOUND', error: 'Movimentação não encontrada' };
  if (String(original.estorno_de || '').trim()) return { ok: false, status: 409, code: 'REVERSAL_NOT_REVERSIBLE', error: 'Movimentação compensatória não pode ser estornada novamente' };
  const already = await env.DB.prepare(
    `SELECT 1 FROM insumos_movements WHERE estorno_de = ? LIMIT 1`
  ).bind(movementId).first();
  if (already) return { ok: false, status: 409, code: 'ALREADY_REVERSED', error: 'Movimentação já possui estorno' };

  const tipo = normalizeTipo(original.tipo);
  if (tipo === 'SALDO_INICIAL') return { ok: false, status: 409, code: 'OPENING_BALANCE_NOT_REVERSIBLE', error: 'Saldo inicial só pode ser corrigido por ajuste compensatório' };
  if (tipo === 'ESTORNO') return { ok: false, status: 409, code: 'REVERSAL_NOT_REVERSIBLE', error: 'Movimentação compensatória não pode ser estornada novamente' };

  const actorId = actorName(actor);
  const transferId = String(original.id_transferencia || '').trim();
  const pairRows = transferId
    ? ((await env.DB.prepare(
      `SELECT id, data_hora, tipo, codigo_barras, registro_insumo, lote, data_validade,
              produto, quantidade, estoque_anterior, estoque_novo, unidade,
              unidade_origem, unidade_destino, id_transferencia, status, estorno_de
       FROM insumos_movements
       WHERE id_transferencia = ?
       ORDER BY data_hora ASC, id ASC`
    ).bind(transferId).all())?.results || [])
    : [original];
  if (pairRows.some((row) => String(row.estorno_de || '').trim() || String(row.status || 'COMPLETED').toUpperCase() !== 'COMPLETED')) {
    return { ok: false, status: 409, code: 'TRANSFER_NOT_EFFECTIVE', error: 'A transferência ainda não está efetivada ou já foi compensada' };
  }

  for (const row of pairRows) {
    const scope = assertActorUnitScope(actor, row.unidade);
    if (!scope.ok) return scope;
  }

  const ts = nowIso();
  const compensationRows = [];
  const statements = [];
  const addMovementInsert = ({ row, movId, beforeExpression, afterExpression, compensationType, whereSql, whereBinds }) => {
    statements.push(
      env.DB.prepare(
        `INSERT INTO insumos_movements (
          id, data_hora, tipo, codigo_barras, registro_insumo, lote, data_validade,
          produto, quantidade, estoque_anterior, estoque_novo, unidade,
          unidade_origem, unidade_destino, id_transferencia, usuario, motivo,
          observacoes, status, estorno_de, tipo_compensacao
        )
        SELECT ?, ?, 'ESTORNO', ?, ?, ?, ?, ?, ?, ${beforeExpression}, ${afterExpression}, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?
        FROM insumos_stocks
        WHERE ${whereSql}`
      ).bind(
        movId,
        ts,
        row.codigo_barras || '',
        row.registro_insumo || '',
        row.lote || '',
        row.data_validade || '',
        row.produto || '',
        Math.max(1, toInt(row.quantidade, 1)),
        row.unidade || '',
        row.unidade_origem || '',
        row.unidade_destino || '',
        row.id_transferencia || null,
        actorId,
        reason,
        `Estorno da movimentação ${row.id}`,
        row.id,
        compensationType,
        ...whereBinds
      )
    );
  };

  if (transferId && pairRows.length >= 2) {
    const source = pairRows.find((row) => normalizeTipo(row.tipo).includes('SAIDA'));
    const destination = pairRows.find((row) => normalizeTipo(row.tipo).includes('ENTRADA'));
    if (!source || !destination) return { ok: false, status: 409, code: 'TRANSFER_INVALID', error: 'Par de transferência inválido' };
    const quantity = Math.max(1, toInt(source.quantidade, 1));
    const destUnit = normalizeUnitScope(destination.unidade);
    const sourceUnit = normalizeUnitScope(source.unidade);
    const destReg = String(destination.registro_insumo || '').trim();
    const sourceReg = String(source.registro_insumo || '').trim();
    if (!destReg || !sourceReg || destReg !== sourceReg) return { ok: false, status: 409, code: 'TRANSFER_INVALID', error: 'Transferência sem registro consistente' };

    statements.push(
      env.DB.prepare(
        `UPDATE insumos_stocks
         SET quantidade = quantidade - ?, updated_at = ?
         WHERE registro = ? AND unidade = ? AND quantidade >= ?`
      ).bind(quantity, ts, destReg, destUnit, quantity)
    );
    statements.push(
      env.DB.prepare(
        `INSERT INTO insumos_stocks (registro, unidade, quantidade, updated_at)
         SELECT ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM insumos_stocks WHERE registro = ? AND unidade = ? AND updated_at = ?)
         ON CONFLICT(registro, unidade) DO UPDATE SET
           quantidade = insumos_stocks.quantidade + excluded.quantidade,
           updated_at = excluded.updated_at`
      ).bind(sourceReg, sourceUnit, quantity, ts, destReg, destUnit, ts)
    );

    const sourceEstornoId = crypto.randomUUID();
    const destinationEstornoId = crypto.randomUUID();
    compensationRows.push(sourceEstornoId, destinationEstornoId);
    addMovementInsert({
      row: source,
      movId: sourceEstornoId,
      beforeExpression: 'quantidade - ?',
      afterExpression: 'quantidade',
      compensationType: 'ENTRADA',
      whereSql: 'registro = ? AND unidade = ? AND updated_at = ? AND EXISTS (SELECT 1 FROM insumos_stocks WHERE registro = ? AND unidade = ? AND updated_at = ?)',
      whereBinds: [sourceReg, sourceUnit, ts, destReg, destUnit, ts],
    });
    addMovementInsert({
      row: destination,
      movId: destinationEstornoId,
      beforeExpression: 'quantidade + ?',
      afterExpression: 'quantidade',
      compensationType: 'SAIDA',
      whereSql: 'registro = ? AND unidade = ? AND updated_at = ?',
      whereBinds: [destReg, destUnit, ts],
    });
    // The quantity used by the source/destination expressions is bound as the
    // final placeholder for each SELECT below.
    statements[2] = env.DB.prepare(
      statements[2].rawSql || ''
    );
  } else {
    const row = original;
    const unit = normalizeUnitScope(row.unidade);
    const reg = String(row.registro_insumo || '').trim();
    const quantity = Math.max(1, toInt(row.quantidade, 1));
    const before = toInt(row.estoque_anterior, 0);
    const after = toInt(row.estoque_novo, 0);
    const movId = crypto.randomUUID();
    compensationRows.push(movId);
    if (tipo === 'ENTRADA') {
      statements.push(
        env.DB.prepare(
          `UPDATE insumos_stocks SET quantidade = quantidade - ?, updated_at = ?
           WHERE registro = ? AND unidade = ? AND quantidade >= ?`
        ).bind(quantity, ts, reg, unit, quantity)
      );
      addMovementInsert({ row, movId, beforeExpression: 'quantidade + ?', afterExpression: 'quantidade', compensationType: 'SAIDA', whereSql: 'registro = ? AND unidade = ? AND updated_at = ?', whereBinds: [reg, unit, ts, quantity] });
    } else if (tipo === 'SAIDA') {
      statements.push(
        env.DB.prepare(
          `INSERT INTO insumos_stocks (registro, unidade, quantidade, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(registro, unidade) DO UPDATE SET quantidade = insumos_stocks.quantidade + excluded.quantidade, updated_at = excluded.updated_at`
        ).bind(reg, unit, quantity, ts)
      );
      addMovementInsert({ row, movId, beforeExpression: 'quantidade - ?', afterExpression: 'quantidade', compensationType: 'ENTRADA', whereSql: 'registro = ? AND unidade = ? AND updated_at = ?', whereBinds: [reg, unit, ts, quantity] });
    } else if (tipo === 'AJUSTE') {
      statements.push(env.DB.prepare('INSERT OR IGNORE INTO insumos_stocks (registro, unidade, quantidade, updated_at) VALUES (?, ?, ?, ?)').bind(reg, unit, before, ts));
      statements.push(env.DB.prepare('UPDATE insumos_stocks SET quantidade = ?, updated_at = ? WHERE registro = ? AND unidade = ? AND quantidade = ?').bind(before, ts, reg, unit, after));
      addMovementInsert({ row, movId, beforeExpression: 'quantidade + ?', afterExpression: 'quantidade', compensationType: 'AJUSTE', whereSql: 'registro = ? AND unidade = ? AND updated_at = ? AND quantidade = ?', whereBinds: [reg, unit, ts, before, Math.abs(after - before)] });
    } else {
      return { ok: false, status: 409, code: 'MOVEMENT_NOT_REVERSIBLE', error: 'Tipo de movimentação não pode ser estornado' };
    }
  }

  // The helper above uses quantity as a final SQL expression parameter. D1
  // statements are immutable prepared objects, so bind the expressions in a
  // dedicated, explicit form below instead of relying on mutable SQL state.
  const normalizedStatements = [];
  if (transferId && pairRows.length >= 2) {
    const source = pairRows.find((row) => normalizeTipo(row.tipo).includes('SAIDA'));
    const destination = pairRows.find((row) => normalizeTipo(row.tipo).includes('ENTRADA'));
    const quantity = Math.max(1, toInt(source.quantidade, 1));
    const sourceReg = String(source.registro_insumo || '').trim();
    const sourceUnit = normalizeUnitScope(source.unidade);
    const destReg = String(destination.registro_insumo || '').trim();
    const destUnit = normalizeUnitScope(destination.unidade);
    normalizedStatements.push(statements[0], statements[1]);
    const make = (row, movId, beforeExpr, afterExpr, compensationType, whereSql, binds) => env.DB.prepare(
      `INSERT INTO insumos_movements (
        id, data_hora, tipo, codigo_barras, registro_insumo, lote, data_validade,
        produto, quantidade, estoque_anterior, estoque_novo, unidade,
        unidade_origem, unidade_destino, id_transferencia, usuario, motivo,
        observacoes, status, estorno_de, tipo_compensacao
      ) SELECT ?, ?, 'ESTORNO', ?, ?, ?, ?, ?, ?, ${beforeExpr}, ${afterExpr}, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?
      FROM insumos_stocks WHERE ${whereSql}`
    ).bind(
      movId, ts, row.codigo_barras || '', row.registro_insumo || '', row.lote || '', row.data_validade || '', row.produto || '', quantity,
      quantity, row.unidade || '', row.unidade_origem || '', row.unidade_destino || '', row.id_transferencia || null, actorId, reason,
      `Estorno da movimentação ${row.id}`, row.id, compensationType, ...binds
    );
    normalizedStatements.push(make(source, compensationRows[0], 'quantidade - ?', 'quantidade', 'ENTRADA', 'registro = ? AND unidade = ? AND updated_at = ? AND EXISTS (SELECT 1 FROM insumos_stocks WHERE registro = ? AND unidade = ? AND updated_at = ?)', [sourceReg, sourceUnit, ts, destReg, destUnit, ts, quantity]));
    normalizedStatements.push(make(destination, compensationRows[1], 'quantidade + ?', 'quantidade', 'SAIDA', 'registro = ? AND unidade = ? AND updated_at = ?', [destReg, destUnit, ts, quantity]));
  } else {
    normalizedStatements.push(...statements);
  }

  const results = await env.DB.batch(normalizedStatements);
  const minimumExpected = transferId && pairRows.length >= 2 ? 4 : (tipo === 'AJUSTE' ? 3 : 2);
  if ((transferId && pairRows.length >= 2 && (resultChanges(results?.[0]) !== 1 || resultChanges(results?.[1]) !== 1 || resultChanges(results?.[2]) !== 1 || resultChanges(results?.[3]) !== 1)) || (!transferId && ((tipo === 'AJUSTE' && (resultChanges(results?.[1]) !== 1 || resultChanges(results?.[2]) !== 1)) || (tipo !== 'AJUSTE' && (resultChanges(results?.[0]) !== 1 || resultChanges(results?.[1]) !== 1))))) {
    return { ok: false, status: 409, code: 'REVERSAL_CONFLICT', error: 'O saldo não permite aplicar o estorno com segurança' };
  }
  return { ok: true, estornoIds: compensationRows, transferId: transferId || null, registro: String(original.registro_insumo || '').trim() };
}

export async function d1EstornarMovimentacao({ env, id, actor, justificativa }) {
  const movementId = String(id || '').trim();
  const reason = String(justificativa || '').trim();
  if (!movementId) return { ok: false, status: 400, code: 'MOVEMENT_INVALID', error: 'Movimentação inválida' };
  if (reason.length < 3) return { ok: false, status: 400, code: 'JUSTIFICATION_REQUIRED', error: 'Motivo do estorno é obrigatório' };

  const original = await env.DB.prepare(
    `SELECT id, tipo, codigo_barras, registro_insumo, lote, data_validade, produto,
            quantidade, estoque_anterior, estoque_novo, unidade, unidade_origem,
            unidade_destino, id_transferencia, usuario, status, estorno_de
     FROM insumos_movements WHERE id = ? LIMIT 1`
  ).bind(movementId).first();
  if (!original) return { ok: false, status: 404, code: 'MOVEMENT_NOT_FOUND', error: 'Movimentação não encontrada' };
  if (String(original.estorno_de || '').trim()) return { ok: false, status: 409, code: 'REVERSAL_NOT_REVERSIBLE', error: 'Movimentação compensatória não pode ser estornada novamente' };
  if (await env.DB.prepare('SELECT 1 FROM insumos_movements WHERE estorno_de = ? LIMIT 1').bind(movementId).first()) {
    return { ok: false, status: 409, code: 'ALREADY_REVERSED', error: 'Movimentação já possui estorno' };
  }

  const tipo = normalizeTipo(original.tipo);
  if (tipo === 'SALDO_INICIAL' || tipo === 'ESTORNO') {
    return { ok: false, status: 409, code: 'MOVEMENT_NOT_REVERSIBLE', error: 'Este tipo de movimentação não pode ser estornado' };
  }
  const actorId = actorName(actor);
  const ts = nowIso();
  const transferId = String(original.id_transferencia || '').trim();
  const transferRecord = transferId
    ? await env.DB.prepare(
      `SELECT id, status, unidade_origem, unidade_destino
       FROM insumos_transfers WHERE id = ? LIMIT 1`
    ).bind(transferId).first()
    : null;
  if (transferRecord && String(transferRecord.status || '').toUpperCase() === 'PENDING_RECEIPT') {
    return d1CancelarTransferencia({
      env,
      id: transferId,
      actor,
      unidade: original.unidade,
      justificativa: reason,
    });
  }
  if (transferRecord && String(transferRecord.status || '').toUpperCase() === 'CANCELLED') {
    return { ok: false, status: 409, code: 'TRANSFER_ALREADY_CANCELLED', error: 'A transferência já foi cancelada' };
  }

  const pairRows = transferId
    ? ((await env.DB.prepare(
      `SELECT id, tipo, codigo_barras, registro_insumo, lote, data_validade, produto,
              quantidade, unidade, unidade_origem, unidade_destino, id_transferencia,
              status, estorno_de
       FROM insumos_movements WHERE id_transferencia = ? ORDER BY data_hora ASC, id ASC`
    ).bind(transferId).all())?.results || [])
    : [original];
  if (pairRows.some((row) => String(row.estorno_de || '').trim())) {
    return { ok: false, status: 409, code: 'ALREADY_REVERSED', error: 'Transferência já possui estorno' };
  }
  if ((!transferRecord || String(transferRecord.status || '').toUpperCase() !== 'RECEIVED')
    && pairRows.some((row) => String(row.status || 'COMPLETED').toUpperCase() !== 'COMPLETED')) {
    return { ok: false, status: 409, code: 'TRANSFER_NOT_EFFECTIVE', error: 'A transferência ainda não está efetivada' };
  }
  for (const row of pairRows) {
    const scope = assertActorUnitScope(actor, row.unidade);
    if (!scope.ok) return scope;
  }

  const statements = [];
  const estornoIds = [];
  const makeMovement = ({ row, movId, movementQuantity, beforeExpression, afterExpression, compensationType, whereSql, whereBinds }) => {
    statements.push(
      env.DB.prepare(
        `INSERT INTO insumos_movements (
          id, data_hora, tipo, codigo_barras, registro_insumo, lote, data_validade,
          produto, quantidade, estoque_anterior, estoque_novo, unidade,
          unidade_origem, unidade_destino, id_transferencia, usuario, motivo,
          observacoes, status, estorno_de, tipo_compensacao
        )
        SELECT ?, ?, 'ESTORNO', ?, ?, ?, ?, ?, ?, ${beforeExpression}, ${afterExpression},
               ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?
        FROM insumos_stocks
        WHERE ${whereSql}`
      ).bind(
        movId,
        ts,
        row.codigo_barras || '',
        row.registro_insumo || '',
        row.lote || '',
        row.data_validade || '',
        row.produto || '',
        movementQuantity,
        movementQuantity,
        row.unidade || '',
        row.unidade_origem || '',
        row.unidade_destino || '',
        row.id_transferencia || null,
        actorId,
        reason,
        `Estorno da movimentação ${row.id}`,
        row.id,
        compensationType,
        ...whereBinds
      )
    );
  };

  if (transferId && pairRows.length >= 2) {
    const source = pairRows.find((row) => normalizeTipo(row.tipo).includes('SAIDA'));
    const destination = pairRows.find((row) => normalizeTipo(row.tipo).includes('ENTRADA'));
    if (!source || !destination) return { ok: false, status: 409, code: 'TRANSFER_INVALID', error: 'Par de transferência inválido' };
    const quantity = Math.max(1, toInt(source.quantidade, 1));
    const sourceReg = String(source.registro_insumo || '').trim();
    const sourceUnit = normalizeUnitScope(source.unidade);
    const destinationReg = String(destination.registro_insumo || '').trim();
    const destinationUnit = normalizeUnitScope(destination.unidade);
    if (!sourceReg || sourceReg !== destinationReg) return { ok: false, status: 409, code: 'TRANSFER_INVALID', error: 'Transferência sem registro consistente' };

    statements.push(env.DB.prepare(
      `UPDATE insumos_stocks SET quantidade = quantidade - ?, updated_at = ?
       WHERE registro = ? AND unidade = ? AND quantidade >= ?`
    ).bind(quantity, ts, destinationReg, destinationUnit, quantity));
    statements.push(env.DB.prepare(
      `INSERT INTO insumos_stocks (registro, unidade, quantidade, updated_at)
       SELECT ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM insumos_stocks WHERE registro = ? AND unidade = ? AND updated_at = ?)
       ON CONFLICT(registro, unidade) DO UPDATE SET
         quantidade = insumos_stocks.quantidade + excluded.quantidade,
         updated_at = excluded.updated_at`
    ).bind(sourceReg, sourceUnit, quantity, ts, destinationReg, destinationUnit, ts));

    const sourceEstornoId = crypto.randomUUID();
    const destinationEstornoId = crypto.randomUUID();
    estornoIds.push(sourceEstornoId, destinationEstornoId);
    makeMovement({
      row: source,
      movId: sourceEstornoId,
      movementQuantity: quantity,
      beforeExpression: 'quantidade - ?',
      afterExpression: 'quantidade',
      compensationType: 'ENTRADA',
      whereSql: 'registro = ? AND unidade = ? AND updated_at = ? AND EXISTS (SELECT 1 FROM insumos_stocks WHERE registro = ? AND unidade = ? AND updated_at = ?)',
      whereBinds: [sourceReg, sourceUnit, ts, destinationReg, destinationUnit, ts],
    });
    makeMovement({
      row: destination,
      movId: destinationEstornoId,
      movementQuantity: quantity,
      beforeExpression: 'quantidade + ?',
      afterExpression: 'quantidade',
      compensationType: 'SAIDA',
      whereSql: 'registro = ? AND unidade = ? AND updated_at = ?',
      whereBinds: [destinationReg, destinationUnit, ts],
    });
  } else {
    const row = original;
    const unit = normalizeUnitScope(row.unidade);
    const reg = String(row.registro_insumo || '').trim();
    const quantity = Math.max(1, toInt(row.quantidade, 1));
    const before = toInt(row.estoque_anterior, 0);
    const after = toInt(row.estoque_novo, 0);
    const estornoId = crypto.randomUUID();
    estornoIds.push(estornoId);

    if (tipo === 'ENTRADA') {
      statements.push(env.DB.prepare(
        `UPDATE insumos_stocks SET quantidade = quantidade - ?, updated_at = ?
         WHERE registro = ? AND unidade = ? AND quantidade >= ?`
      ).bind(quantity, ts, reg, unit, quantity));
      makeMovement({ row, movId: estornoId, movementQuantity: quantity, beforeExpression: 'quantidade + ?', afterExpression: 'quantidade', compensationType: 'SAIDA', whereSql: 'registro = ? AND unidade = ? AND updated_at = ?', whereBinds: [reg, unit, ts] });
    } else if (tipo === 'SAIDA') {
      statements.push(env.DB.prepare(
        `INSERT INTO insumos_stocks (registro, unidade, quantidade, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(registro, unidade) DO UPDATE SET
           quantidade = insumos_stocks.quantidade + excluded.quantidade,
           updated_at = excluded.updated_at`
      ).bind(reg, unit, quantity, ts));
      makeMovement({ row, movId: estornoId, movementQuantity: quantity, beforeExpression: 'quantidade - ?', afterExpression: 'quantidade', compensationType: 'ENTRADA', whereSql: 'registro = ? AND unidade = ? AND updated_at = ?', whereBinds: [reg, unit, ts] });
    } else if (tipo === 'AJUSTE') {
      const diff = Math.abs(after - before);
      statements.push(env.DB.prepare('INSERT OR IGNORE INTO insumos_stocks (registro, unidade, quantidade, updated_at) VALUES (?, ?, ?, ?)').bind(reg, unit, before, ts));
      statements.push(env.DB.prepare(
        `UPDATE insumos_stocks SET quantidade = ?, updated_at = ?
         WHERE registro = ? AND unidade = ? AND quantidade = ?`
      ).bind(before, ts, reg, unit, after));
      makeMovement({ row, movId: estornoId, movementQuantity: diff, beforeExpression: 'quantidade + ?', afterExpression: 'quantidade', compensationType: 'AJUSTE', whereSql: 'registro = ? AND unidade = ? AND updated_at = ? AND quantidade = ?', whereBinds: [reg, unit, ts, before] });
    } else {
      return { ok: false, status: 409, code: 'MOVEMENT_NOT_REVERSIBLE', error: 'Este tipo de movimentação não pode ser estornado' };
    }
  }

  const results = await env.DB.batch(statements);
  const transferValid = transferId && pairRows.length >= 2;
  const successful = transferValid
    ? results.length >= 4 && results.slice(0, 4).every((result) => resultChanges(result) === 1)
    : (tipo === 'AJUSTE'
      ? resultChanges(results?.[1]) === 1 && resultChanges(results?.[2]) === 1
      : resultChanges(results?.[0]) === 1 && resultChanges(results?.[1]) === 1);
  if (!successful) return { ok: false, status: 409, code: 'REVERSAL_CONFLICT', error: 'O saldo não permite aplicar o estorno com segurança' };
  return { ok: true, estornoIds, transferId: transferId || null, registro: String(original.registro_insumo || '').trim() };
}

export async function d1UpdateMovimentacao({ env, id, body }) {
  return { ok: false, status: 405, code: 'LEDGER_IMMUTABLE', error: 'Movimentações são imutáveis; use o estorno compensatório' };
  /* legacy implementation retained only for source compatibility */
  const movementId = String(id || '').trim();
  if (!movementId) return { ok: false, status: 400, error: 'Movimentação inválida' };

  const movement = await env.DB.prepare(
    `SELECT
        id,
        data_hora,
        tipo,
        codigo_barras,
        registro_insumo,
        lote,
        data_validade,
        produto,
        quantidade,
        estoque_anterior,
        estoque_novo,
        unidade,
        unidade_origem,
        unidade_destino,
        id_transferencia,
        usuario,
        motivo,
        observacoes
     FROM insumos_movements
     WHERE id = ?`
  ).bind(movementId).first();
  if (!movement) return { ok: false, status: 404, error: 'Movimentação não encontrada' };

  const registro = String(movement?.registro_insumo || '').trim();
  if (!registro) return { ok: false, status: 400, error: 'Movimentação sem registro de insumo' };

  const tipo = normalizeTipo(movement?.tipo);
  const overrides = new Map();
  const produtoProvided = Object.prototype.hasOwnProperty.call(body || {}, 'produto');
  const dataHoraProvided = Object.prototype.hasOwnProperty.call(body || {}, 'dataHora');
  const unidadeProvided = Object.prototype.hasOwnProperty.call(body || {}, 'unidade');
  const produto = produtoProvided ? String(body?.produto || '').trim() : String(movement?.produto || '').trim();
  const dataHora = dataHoraProvided ? normalizeDateTimeInput(body?.dataHora) : normalizeDateTimeInput(movement?.data_hora);

  if (!produto) return { ok: false, status: 400, error: 'Produto inválido' };
  if (!dataHora) return { ok: false, status: 400, error: 'Data/hora inválida' };

  if (String(movement?.id_transferencia || '').trim()) {
    const transferId = String(movement.id_transferencia || '').trim();
    const pairRowsRes = await env.DB.prepare(
      `SELECT
          id,
          tipo,
          unidade,
          unidade_origem,
          unidade_destino,
          quantidade,
          observacoes
       FROM insumos_movements
       WHERE id_transferencia = ?
       ORDER BY data_hora ASC, id ASC`
    ).bind(transferId).all();
    const pairRows = (pairRowsRes?.results || []).map((row) => ({ ...row }));
    if (!pairRows.length) return { ok: false, status: 404, error: 'Transferência vinculada não encontrada' };

    const quantidadeProvided = Object.prototype.hasOwnProperty.call(body || {}, 'quantidade');
    const quantidade = quantidadeProvided ? toInt(body?.quantidade, NaN) : toInt(movement?.quantidade, 1);
    if (!Number.isFinite(quantidade) || quantidade < 1) {
      return { ok: false, status: 400, error: 'Quantidade inválida' };
    }
    if (unidadeProvided) {
      return { ok: false, status: 400, error: 'Unidade de transferência não pode ser alterada neste modal' };
    }

    const freeText = Object.prototype.hasOwnProperty.call(body || {}, 'observacoes')
      ? String(body?.observacoes || '').trim()
      : extractTransferFreeText(movement?.observacoes);

    for (const row of pairRows) {
      overrides.set(String(row.id || '').trim(), {
        data_hora: dataHora,
        produto,
        quantidade,
        observacoes: buildTransferObservacoes(row?.tipo, row?.unidade_origem, row?.unidade_destino, freeText),
      });
    }
  } else if (tipo === 'AJUSTE') {
    const targetProvided = Object.prototype.hasOwnProperty.call(body || {}, 'estoqueNovo');
    const motivoProvided = Object.prototype.hasOwnProperty.call(body || {}, 'motivo');
    const observacoesProvided = Object.prototype.hasOwnProperty.call(body || {}, 'observacoes');
    const estoqueNovo = targetProvided ? toInt(body?.estoqueNovo, NaN) : toInt(movement?.estoque_novo, NaN);
    const motivo = motivoProvided ? String(body?.motivo || '').trim() : String(movement?.motivo || '').trim();
    const observacoes = observacoesProvided ? String(body?.observacoes || '').trim() : String(movement?.observacoes || '').trim();
    const unidade = unidadeProvided ? String(body?.unidade || '').trim() : String(movement?.unidade || '').trim();

    if (!Number.isFinite(estoqueNovo) || estoqueNovo < 0) {
      return { ok: false, status: 400, error: 'Novo estoque inválido' };
    }
    if (!motivo) return { ok: false, status: 400, error: 'Motivo é obrigatório' };
    if (!unidade) return { ok: false, status: 400, error: 'Unidade inválida' };

    overrides.set(movementId, { data_hora: dataHora, produto, unidade, estoque_novo: estoqueNovo, motivo, observacoes });
  } else {
    const quantidadeProvided = Object.prototype.hasOwnProperty.call(body || {}, 'quantidade');
    const observacoesProvided = Object.prototype.hasOwnProperty.call(body || {}, 'observacoes');
    const quantidade = quantidadeProvided ? toInt(body?.quantidade, NaN) : toInt(movement?.quantidade, 1);
    const observacoes = observacoesProvided ? String(body?.observacoes || '').trim() : String(movement?.observacoes || '').trim();
    const unidade = unidadeProvided ? String(body?.unidade || '').trim() : String(movement?.unidade || '').trim();
    if (!Number.isFinite(quantidade) || quantidade < 1) {
      return { ok: false, status: 400, error: 'Quantidade inválida' };
    }
    if (!unidade) return { ok: false, status: 400, error: 'Unidade inválida' };
    overrides.set(movementId, { data_hora: dataHora, produto, unidade, quantidade, observacoes });
  }

  const recomputed = await recomputeMovementLedgerForRegistro({ env, registro, overrides });

  const updatedRowsRes = await env.DB.prepare(
    `SELECT
        id,
        data_hora AS dataHora,
        tipo,
        codigo_barras AS codigoBarras,
        produto,
        quantidade,
        estoque_anterior AS estoqueAnterior,
        estoque_novo AS estoqueNovo,
        unidade,
        unidade_origem AS unidadeOrigem,
        unidade_destino AS unidadeDestino,
        id_transferencia AS transferId,
        usuario,
        motivo,
        observacoes,
        registro_insumo AS registroInsumo,
        lote,
        data_validade AS dataValidade
     FROM insumos_movements
     WHERE id = ? OR (? != '' AND id_transferencia = ?)
     ORDER BY data_hora ASC, id ASC`
  ).bind(movementId, String(movement?.id_transferencia || '').trim(), String(movement?.id_transferencia || '').trim()).all();

  return {
    ok: true,
    registro,
    transferId: String(movement?.id_transferencia || '').trim() || null,
    movimentos: updatedRowsRes?.results || [],
    estoqueAtual: recomputed.estoqueAtual,
  };
}

export async function d1DeleteMovimentacao({ env, id }) {
  return { ok: false, status: 405, code: 'LEDGER_IMMUTABLE', error: 'Movimentações são imutáveis; use o estorno compensatório' };
  /* legacy implementation retained only for source compatibility */
  const movementId = String(id || '').trim();
  if (!movementId) return { ok: false, status: 400, error: 'Movimentação inválida' };

  const movement = await env.DB.prepare(
    `SELECT
        id,
        registro_insumo,
        unidade,
        id_transferencia
     FROM insumos_movements
     WHERE id = ?`
  ).bind(movementId).first();
  if (!movement) return { ok: false, status: 404, error: 'Movimentação não encontrada' };

  const registro = String(movement?.registro_insumo || '').trim();
  if (!registro) return { ok: false, status: 400, error: 'Movimentação sem registro de insumo' };

  const removeIds = new Set([movementId]);
  const transferId = String(movement?.id_transferencia || '').trim();
  if (transferId) {
    const pairRows = await env.DB.prepare(
      `SELECT id
       FROM insumos_movements
       WHERE id_transferencia = ?`
    ).bind(transferId).all();
    for (const row of pairRows?.results || []) {
      const idValue = String(row?.id || '').trim();
      if (idValue) removeIds.add(idValue);
    }
  }

  const recomputed = await recomputeMovementLedgerForRegistro({ env, registro, removeIds });
  return {
    ok: true,
    registro,
    transferId: transferId || null,
    deletedIds: Array.from(removeIds),
    estoqueAtual: recomputed.estoqueAtual,
  };
}

export async function d1ListMovimentacoes({ env, unidade, tipo, de, ate, pagina, limite, codigoBarras }) {
  const where = [];
  const binds = [];
  if (unidade) {
    where.push('unidade = ?');
    binds.push(String(unidade));
  }
  if (tipo && String(tipo).toUpperCase() !== 'TODOS') {
    where.push('UPPER(tipo) = ?');
    binds.push(String(tipo).toUpperCase());
  }
  if (codigoBarras) {
    where.push('codigo_barras = ?');
    binds.push(String(codigoBarras).trim());
  }

  const start = de ? String(de).trim() : '';
  const end = ate ? String(ate).trim() : '';
  if (start) {
    where.push('data_hora >= ?');
    binds.push(`${start}T00:00:00.000Z`);
  }
  if (end) {
    where.push('data_hora <= ?');
    binds.push(`${end}T23:59:59.999Z`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const lim = Math.max(1, Math.min(200, toInt(limite, 50)));
  const pag = Math.max(1, toInt(pagina, 1));
  const offset = (pag - 1) * lim;

  const totalRow = await env.DB.prepare(`SELECT COUNT(1) AS n FROM insumos_movements ${whereSql}`).bind(...binds).first();
  const totalMovimentacoes = toInt(totalRow?.n, 0);

  const rows = await env.DB.prepare(
    `SELECT
        m.id AS id,
        m.data_hora AS dataHora,
        m.tipo AS tipo,
        m.codigo_barras AS codigoBarras,
        m.produto AS produto,
        m.quantidade AS quantidade,
        m.estoque_anterior AS estoqueAnterior,
        m.estoque_novo AS estoqueNovo,
        m.unidade AS unidade,
        m.unidade_origem AS unidadeOrigem,
        m.unidade_destino AS unidadeDestino,
        m.id_transferencia AS transferId,
        t.status AS transferStatus,
        t.dispatched_at AS transferDispatchedAt,
        t.dispatched_by AS transferDispatchedBy,
        t.received_at AS transferReceivedAt,
        t.received_by AS transferReceivedBy,
        t.cancelled_at AS transferCancelledAt,
        t.cancelled_by AS transferCancelledBy,
        t.reason AS transferReason,
        m.usuario AS usuario,
        m.motivo AS motivo,
        m.observacoes AS observacoes,
        m.status AS ledgerStatus,
        m.estorno_de AS estornoDe,
        m.tipo_compensacao AS tipoCompensacao,
        CASE WHEN EXISTS (
          SELECT 1 FROM insumos_movements reversal WHERE reversal.estorno_de = m.id
        ) THEN 'ESTORNADO' ELSE COALESCE(t.status, m.status, 'COMPLETED') END AS status,
        m.registro_insumo AS registroInsumo,
        m.lote AS lote,
        m.data_validade AS dataValidade,
        i.preco_custo AS preco,
        i.categoria AS categoria,
        i.marca AS marca
     FROM insumos_movements m
     LEFT JOIN insumos_items i
       ON i.registro = m.registro_insumo
     LEFT JOIN insumos_transfers t
       ON t.id = m.id_transferencia
     ${whereSql}
     ORDER BY m.data_hora DESC
     LIMIT ? OFFSET ?`
  )
    .bind(...binds, lim, offset)
    .all();

  return {
    movimentos: (rows?.results || []).map((r) => ({
      ...r,
      preco: toNumber(r.preco, 0),
      estornado: String(r.status || '').toUpperCase() === 'ESTORNADO',
    })),
    resumo: { totalMovimentacoes, pagina: pag, limite: lim }
  };
}

function safeJsonParse(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function normalizeAllowedUnits(value) {
  return normalizeCanonicalAllowedUnits(value);
}

function normalizeAllowedModules(value) {
  // Sem campo/vazio => "ALL" (represented by empty array)
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof value === 'string') {
    const parsed = safeJsonParse(value, null);
    if (Array.isArray(parsed)) return parsed.map(String).map((s) => s.trim()).filter(Boolean);
    return value
      .split(/[,;|]/g)
      .map((s) => String(s || '').trim())
      .filter(Boolean);
  }
  return [];
}

export function d1UserRowToUser(row) {
  if (!row) return null;
  return {
    name: row.display_name || row.username,
    displayName: row.display_name || row.username,
    username: row.username,
    email: row.email || '',
    role: row.role || 'CONSULTOR',
    photoUrl: row.photo_url || '',
    allowedUnits: normalizeAllowedUnits(row.allowed_units_json),
    allowedModules: normalizeAllowedModules(row.allowed_modules_json),
    ativo: toInt(row.ativo, 1) ? true : false,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    passwordHash: row.password_hash || '',
    sessionVersion: toInt(row.session_version, 0),
  };
}

export async function d1GetUserByUsername(env, username) {
  if (!env?.DB) return null;
  const u = String(username || '').trim();
  if (!u) return null;
  const { usersTable } = await resolveCrmTables(env);
  const hasModules = await tableHasColumn(env, usersTable, 'allowed_modules_json');
  const extra = hasModules ? ', allowed_modules_json' : '';
  const row = await env.DB.prepare(
    `SELECT username, email, display_name, password_hash, role, photo_url, allowed_units_json, ativo, created_at, updated_at, session_version${extra}
     FROM ${usersTable}
     WHERE LOWER(username) = LOWER(?)
     LIMIT 1`
  )
    .bind(u)
    .first();
  return d1UserRowToUser(row);
}

export async function d1GetUserByIdentifier(env, identifier) {
  if (!env?.DB) return null;
  const id = String(identifier || '').trim();
  if (!id) return null;
  const { usersTable } = await resolveCrmTables(env);
  const hasModules = await tableHasColumn(env, usersTable, 'allowed_modules_json');
  const extra = hasModules ? ', allowed_modules_json' : '';
  const row = await env.DB.prepare(
    `SELECT username, email, display_name, password_hash, role, photo_url, allowed_units_json, ativo, created_at, updated_at, session_version${extra}
     FROM ${usersTable}
     WHERE LOWER(username) = LOWER(?) OR (email IS NOT NULL AND email != '' AND LOWER(email) = LOWER(?))
     LIMIT 1`
  )
    .bind(id, id)
    .first();
  return d1UserRowToUser(row);
}

export async function d1UpdateUserProfile(env, username, updates) {
  if (!env?.DB) return { ok: false, status: 500, error: 'DB_NOT_CONFIGURED' };
  const u = String(username || '').trim();
  if (!u) return { ok: false, status: 400, error: 'USERNAME_REQUIRED' };

  const { usersTable } = await resolveCrmTables(env);
  const hasModules = await tableHasColumn(env, usersTable, 'allowed_modules_json');
  const extra = hasModules ? ', allowed_modules_json' : '';
  const existing = await env.DB.prepare(
    `SELECT username, email, display_name, password_hash, role, photo_url, allowed_units_json, ativo, created_at, updated_at${extra}
     FROM ${usersTable}
     WHERE LOWER(username) = LOWER(?)
     LIMIT 1`
  )
    .bind(u)
    .first();
  if (!existing) return { ok: false, status: 404, error: 'USER_NOT_FOUND' };

  const nextUsername = updates?.newUsername ? String(updates.newUsername).trim() : null;
  const nextDisplayName = updates?.displayName !== undefined ? String(updates.displayName || '').trim() : null;
  const nextEmail = updates?.email !== undefined ? String(updates.email || '').trim() : null;
  const nextPhotoUrl = updates?.photoUrl !== undefined ? String(updates.photoUrl || '') : null;
  const nextPasswordHash = updates?.passwordHash ? String(updates.passwordHash) : null;
  const now = nowIso();

  if (nextUsername && nextUsername.toLowerCase() !== String(existing.username).toLowerCase()) {
    const taken = await env.DB.prepare(
      `SELECT 1 FROM ${usersTable} WHERE LOWER(username) = LOWER(?) LIMIT 1`
    )
      .bind(nextUsername)
      .first();
    if (taken) return { ok: false, status: 409, error: 'USERNAME_TAKEN' };

    // Move user PK (best-effort) and keep references consistent.
    if (hasModules) {
      await env.DB.prepare(
        `INSERT INTO ${usersTable} (username, email, display_name, password_hash, role, photo_url, allowed_units_json, allowed_modules_json, ativo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          nextUsername,
          nextEmail ?? existing.email ?? '',
          nextDisplayName ?? existing.display_name ?? '',
          nextPasswordHash ?? existing.password_hash ?? '',
          existing.role ?? 'CONSULTOR',
          nextPhotoUrl ?? existing.photo_url ?? '',
          existing.allowed_units_json ?? null,
          existing.allowed_modules_json ?? null,
          toInt(existing.ativo, 1),
          existing.created_at || now,
          now
        )
        .run();
    } else {
      await env.DB.prepare(
        `INSERT INTO ${usersTable} (username, email, display_name, password_hash, role, photo_url, allowed_units_json, ativo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          nextUsername,
          nextEmail ?? existing.email ?? '',
          nextDisplayName ?? existing.display_name ?? '',
          nextPasswordHash ?? existing.password_hash ?? '',
          existing.role ?? 'CONSULTOR',
          nextPhotoUrl ?? existing.photo_url ?? '',
          existing.allowed_units_json ?? null,
          toInt(existing.ativo, 1),
          existing.created_at || now,
          now
        )
        .run();
    }

    await env.DB.prepare(`DELETE FROM ${usersTable} WHERE LOWER(username) = LOWER(?)`).bind(u).run();
    // Best-effort propagate to other tables where we store username as text.
    // Ledger rows retain the backend actor captured at posting time. User
    // profile changes must never rewrite historical responsibility.
    try { await env.DB.prepare(`UPDATE share_history SET user=? WHERE user=?`).bind(nextUsername, existing.username).run(); } catch { }
    try { await env.DB.prepare(`UPDATE audit_log SET actor=? WHERE actor=?`).bind(nextUsername, existing.username).run(); } catch { }

    const out = await d1GetUserByUsername(env, nextUsername);
    return { ok: true, user: out, username: nextUsername };
  }

  await env.DB.prepare(
    `UPDATE ${usersTable}
     SET email=COALESCE(?, email),
         display_name=COALESCE(?, display_name),
         photo_url=COALESCE(?, photo_url),
         password_hash=COALESCE(?, password_hash),
         updated_at=?
     WHERE LOWER(username) = LOWER(?)`
  )
    .bind(
      nextEmail,
      nextDisplayName,
      nextPhotoUrl,
      nextPasswordHash,
      now,
      u
    )
    .run();

  const out = await d1GetUserByUsername(env, u);
  return { ok: true, user: out, username: u };
}
