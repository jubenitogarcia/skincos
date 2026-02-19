#!/usr/bin/env node
/* eslint-disable no-console */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dbName = process.env.INSUMOS_D1_DB || 'skincos-db';
const outArg = process.argv[2];
const outputPath = outArg
  ? path.resolve(process.cwd(), outArg)
  : path.resolve(process.cwd(), `insumos-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);

const wranglerBin = process.env.WRNGLR_BIN || 'npx';
const wranglerCmd = process.env.WRNGLR_CMD || `${wranglerBin} wrangler`;

function runQuery(sql) {
  const normalized = String(sql || '').replace(/\s+/g, ' ').trim();
  const cmd = `${wranglerCmd} d1 execute ${dbName} --remote --json --command ${JSON.stringify(normalized)}`;
  let raw = '';
  try {
    raw = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    const stderr = (err && err.stderr ? String(err.stderr) : '').trim();
    const msg = stderr || (err && err.message ? String(err.message) : 'Query failed');
    throw new Error(msg);
  }
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed[0]) return [];
  if (parsed[0].success === false) {
    const err = parsed[0].error || 'Query failed';
    throw new Error(err);
  }
  return parsed[0].results || [];
}

function tryQuery(sql) {
  try {
    return runQuery(sql);
  } catch (err) {
    console.warn(`[insumos-export] query failed: ${err.message || err}`);
    return [];
  }
}

function tableExists(tables, name) {
  return tables.some((t) => String(t?.name || '').toLowerCase() === name.toLowerCase());
}

function columnExists(cols, name) {
  return cols.some((c) => String(c?.name || '').toLowerCase() === name.toLowerCase());
}

console.log(`[insumos-export] Fetching tables from D1 (${dbName})...`);
const tables = runQuery(`SELECT name FROM sqlite_master WHERE type='table'`);
const usersTable = tableExists(tables, 'crm_users') ? 'crm_users' : 'insumos_users';
const usersColumns = tryQuery(`PRAGMA table_info(${usersTable})`);
const hasModules = columnExists(usersColumns, 'allowed_modules_json');

console.log(`[insumos-export] Using users table: ${usersTable}${hasModules ? ' (with modules)' : ''}`);

const auditLog = tryQuery(
  `SELECT ts, actor, role, action, entity, entity_id as entityId, unidade, ip, user_agent as userAgent, idempotency_key as idempotencyKey, before_json as beforeJson, after_json as afterJson
   FROM audit_log
   ORDER BY ts DESC
   LIMIT 2000`
);
const notificationSnapshots = tryQuery(
  `SELECT ts, unidade, low_stock as lowStock, expiring_soon as expiringSoon, expired_with_stock as expiredWithStock, payload_json as payloadJson
   FROM notification_snapshot
   ORDER BY ts DESC
   LIMIT 500`
);
const shareHistory = tryQuery(
  `SELECT id, user, created_at as createdAt, title, text, url, files_json as filesJson, source_id as sourceId
   FROM share_history
   ORDER BY created_at DESC
   LIMIT 500`
);
const users = tryQuery(
  `SELECT username, email, display_name as displayName, password_hash as passwordHash, role, photo_url as photoUrl,
          allowed_units_json as allowedUnitsJson${hasModules ? ', allowed_modules_json as allowedModulesJson' : ''},
          ativo, created_at as createdAt, updated_at as updatedAt
   FROM ${usersTable}`
);
const insumosItems = tryQuery(
  `SELECT registro, codigo_barras as codigoBarras, produto, categoria, marca, especificacao, concentracao, volume, calibre, tipo_unidade as tipoUnidade,
          fonte, preco_custo as precoCusto, estoque_minimo as estoqueMinimo, lote, data_validade as dataValidade,
          policy_requires_lot as policyRequiresLot, policy_requires_expiry as policyRequiresExpiry, policy_fefo as policyFefo,
          data_cadastro as dataCadastro, data_atualizacao as dataAtualizacao
   FROM insumos_items`
);
const insumosStocks = tryQuery(
  `SELECT registro, unidade, quantidade, updated_at as updatedAt
   FROM insumos_stocks`
);
const insumosMovements = tryQuery(
  `SELECT id, data_hora as dataHora, tipo, codigo_barras as codigoBarras, registro_insumo as registroInsumo, lote, data_validade as dataValidade, produto, quantidade,
          estoque_anterior as estoqueAnterior, estoque_novo as estoqueNovo, unidade, unidade_origem as unidadeOrigem, unidade_destino as unidadeDestino,
          id_transferencia as transferId, usuario, motivo, observacoes
   FROM insumos_movements`
);

const payload = {
  version: 1,
  createdAt: new Date().toISOString(),
  sources: {
    d1: {
      enabled: true,
      auditLogCount: auditLog.length,
      notificationSnapshotCount: notificationSnapshots.length,
      shareHistoryCount: shareHistory.length,
      insumosUsersCount: users.length,
      insumosItemsCount: insumosItems.length,
      insumosStocksCount: insumosStocks.length,
      insumosMovementsCount: insumosMovements.length,
    },
  },
  d1: {
    auditLog,
    notificationSnapshots,
    shareHistory,
    insumosUsers: users,
    crmUsers: users,
    insumosItems,
    insumosStocks,
    insumosMovements,
  },
};

fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
console.log(`[insumos-export] Wrote snapshot: ${outputPath}`);
