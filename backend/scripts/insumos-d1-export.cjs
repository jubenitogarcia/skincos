#!/usr/bin/env node
/* eslint-disable no-console */

// Exports the business state needed by the private, local Insumos preview.
// It deliberately never exports identities, credentials, audit IP/user-agent
// data, notification payloads, or share history.
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PREVIEW_KIND = 'insumos-local-preview-snapshot';
const PREVIEW_VERSION = 2;
const SHA256_RE = /^[a-f0-9]{64}$/;
const SNAPSHOT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SNAPSHOT_CONSISTENCY_MODE = 'd1-batch';

const TABLES = [
  {
    table: 'insumos_items',
    key: 'insumosItems',
    required: true,
    watermark: 'dataAtualizacao',
    // Production can legitimately be on the pre-0019 schema. Missing
    // additive fields are represented as null so the fresh local schema can
    // apply its documented defaults without inventing remote business data.
    legacyNullableColumns: [{ column: 'archived_at', alias: 'archivedAt' }],
    sql: `SELECT registro, codigo_barras as codigoBarras, produto, categoria, marca, especificacao, concentracao, volume, calibre, tipo_unidade as tipoUnidade,
                 fonte, preco_custo as precoCusto, estoque_minimo as estoqueMinimo, lote, data_validade as dataValidade,
                 policy_requires_lot as policyRequiresLot, policy_requires_expiry as policyRequiresExpiry, policy_fefo as policyFefo,
                 archived_at as archivedAt, data_cadastro as dataCadastro, data_atualizacao as dataAtualizacao
          FROM insumos_items ORDER BY registro`,
  },
  {
    table: 'insumos_stocks',
    key: 'insumosStocks',
    required: true,
    watermark: 'updatedAt',
    sql: `SELECT registro, unidade, quantidade, updated_at as updatedAt
          FROM insumos_stocks ORDER BY registro, unidade`,
  },
  {
    table: 'insumos_movements',
    key: 'insumosMovements',
    required: true,
    watermark: 'dataHora',
    legacyNullableColumns: [
      { column: 'status', alias: 'status' },
      { column: 'estorno_de', alias: 'estornoDe' },
      { column: 'tipo_compensacao', alias: 'tipoCompensacao' },
    ],
    sql: `SELECT id, data_hora as dataHora, tipo, codigo_barras as codigoBarras, registro_insumo as registroInsumo, lote, data_validade as dataValidade, produto, quantidade,
                 estoque_anterior as estoqueAnterior, estoque_novo as estoqueNovo, unidade, unidade_origem as unidadeOrigem, unidade_destino as unidadeDestino,
                 id_transferencia as transferId, usuario, motivo, observacoes, status, estorno_de as estornoDe, tipo_compensacao as tipoCompensacao
          FROM insumos_movements ORDER BY data_hora, id`,
  },
  {
    table: 'insumos_transfers',
    key: 'insumosTransfers',
    watermark: 'dispatchedAt',
    sql: `SELECT id, registro_insumo as registroInsumo, codigo_barras as codigoBarras, lote, data_validade as dataValidade, produto, quantidade,
                 unidade_origem as unidadeOrigem, unidade_destino as unidadeDestino, status, dispatched_at as dispatchedAt, dispatched_by as dispatchedBy,
                 received_at as receivedAt, received_by as receivedBy, cancelled_at as cancelledAt, cancelled_by as cancelledBy,
                 reason, dispatch_movement_id as dispatchMovementId, receipt_movement_id as receiptMovementId
          FROM insumos_transfers ORDER BY dispatched_at, id`,
  },
  {
    table: 'insumos_suppliers',
    key: 'insumosSuppliers',
    watermark: 'updatedAt',
    // Supplier contact data is not required to test stock or procurement flows.
    sql: `SELECT id, unidade, nome, archived_at as archivedAt, archived_by as archivedBy,
                 created_at as createdAt, created_by as createdBy, updated_at as updatedAt, updated_by as updatedBy
          FROM insumos_suppliers ORDER BY nome, id`,
  },
  {
    table: 'insumos_purchase_orders',
    key: 'insumosPurchaseOrders',
    watermark: 'updatedAt',
    sql: `SELECT id, unidade, fornecedor_id as fornecedorId, status, expected_at as expectedAt,
                 created_at as createdAt, created_by as createdBy, updated_at as updatedAt, updated_by as updatedBy,
                 cancelled_at as cancelledAt, cancelled_by as cancelledBy, cancel_reason as cancelReason
          FROM insumos_purchase_orders ORDER BY created_at, id`,
  },
  {
    table: 'insumos_purchase_order_lines',
    key: 'insumosPurchaseOrderLines',
    watermark: 'createdAt',
    sql: `SELECT id, pedido_id as pedidoId, registro_insumo as registroInsumo, codigo_barras as codigoBarras, produto, lote, data_validade as dataValidade,
                 quantidade_pedida as quantidadePedida, quantidade_recebida as quantidadeRecebida,
                 custo_unitario_centavos as custoUnitarioCentavos, created_at as createdAt, created_by as createdBy
          FROM insumos_purchase_order_lines ORDER BY created_at, id`,
  },
  {
    table: 'insumos_purchase_receipts',
    key: 'insumosPurchaseReceipts',
    watermark: 'receivedAt',
    sql: `SELECT id, pedido_id as pedidoId, linha_id as linhaId, unidade, registro_insumo as registroInsumo, codigo_barras as codigoBarras,
                 lote, data_validade as dataValidade, quantidade, custo_unitario_centavos as custoUnitarioCentavos,
                 movement_id as movementId, received_at as receivedAt, received_by as receivedBy
          FROM insumos_purchase_receipts ORDER BY received_at, id`,
  },
  {
    table: 'insumos_replenishment_policies',
    key: 'insumosReplenishmentPolicies',
    watermark: 'updatedAt',
    sql: `SELECT id, unidade, registro_insumo as registroInsumo, estoque_minimo as estoqueMinimo, estoque_alvo as estoqueAlvo,
                 estoque_seguranca as estoqueSeguranca, lead_time_dias as leadTimeDias, ativo,
                 created_at as createdAt, created_by as createdBy, updated_at as updatedAt, updated_by as updatedBy
          FROM insumos_replenishment_policies ORDER BY unidade, registro_insumo`,
  },
  {
    table: 'insumos_replenishment_suggestions',
    key: 'insumosReplenishmentSuggestions',
    watermark: 'generatedAt',
    sql: `SELECT id, unidade, registro_insumo as registroInsumo, tipo, status, quantidade, saldo_atual as saldoAtual, saldo_projetado as saldoProjetado,
                 estoque_alvo as estoqueAlvo, estoque_seguranca as estoqueSeguranca, lead_time_dias as leadTimeDias,
                 unidade_origem as unidadeOrigem, unidade_destino as unidadeDestino, codigo_barras as codigoBarras, produto, lote, data_validade as dataValidade,
                 suggestion_key as suggestionKey, draft_json as draftJson, generated_at as generatedAt, generated_by as generatedBy,
                 dismissed_at as dismissedAt, dismissed_by as dismissedBy, dismiss_reason as dismissReason
          FROM insumos_replenishment_suggestions ORDER BY generated_at, id`,
  },
  {
    table: 'insumos_count_sessions',
    key: 'insumosCountSessions',
    watermark: 'snapshotAt',
    sql: `SELECT id, unidade, status, snapshot_at as snapshotAt, started_at as startedAt, started_by as startedBy,
                 closed_at as closedAt, closed_by as closedBy, conflict_at as conflictAt, conflict_reason as conflictReason
          FROM insumos_count_sessions ORDER BY snapshot_at, id`,
  },
  {
    table: 'insumos_count_lines',
    key: 'insumosCountLines',
    watermark: 'countedAt',
    sql: `SELECT id, session_id as sessionId, registro, codigo_barras as codigoBarras, produto, lote, data_validade as dataValidade,
                 snapshot_quantity as snapshotQuantity, physical_quantity as physicalQuantity, status, counted_at as countedAt,
                 counted_by as countedBy, adjustment_movement_id as adjustmentMovementId
          FROM insumos_count_lines ORDER BY session_id, registro`,
  },
  {
    table: 'insumos_count_reads',
    key: 'insumosCountReads',
    watermark: 'readAt',
    sql: `SELECT id, session_id as sessionId, line_id as lineId, registro, quantidade, origem,
                 read_at as readAt, read_by as readBy
          FROM insumos_count_reads ORDER BY read_at, id`,
  },
];

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// The payload crosses the Node-to-Worker boundary before the local seed.  A
// stable representation keeps the digest independent of whitespace or JSON
// property insertion order while preserving the exact ordered ledger rows.
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function normalizeSql(sql) {
  return String(sql || '').replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compatibleSql(spec, columns) {
  const availableColumns = columns instanceof Set ? columns : new Set(columns || []);
  let sql = spec.sql;
  for (const field of spec.legacyNullableColumns || []) {
    if (availableColumns.has(field.column)) continue;
    const selector = field.column === field.alias
      ? new RegExp(`\\b${escapeRegExp(field.column)}\\b`, 'i')
      : new RegExp(`\\b${escapeRegExp(field.column)}\\s+as\\s+${escapeRegExp(field.alias)}\\b`, 'i');
    if (!selector.test(sql)) {
      throw new Error(`D1_LEGACY_FIELD_MAPPING_INVALID:${spec.key}:${field.column}`);
    }
    sql = sql.replace(selector, `NULL as ${field.alias}`);
  }
  return sql;
}

function schemaColumns(rows) {
  return new Set((rows || []).map((row) => String(row?.name || '')).filter(Boolean));
}

function normalizeOutputPath(outputPath) {
  return path.resolve(process.cwd(), outputPath);
}

function assertPreviewOutputPath(outputPath, env = process.env) {
  if (env.INSUMOS_PREVIEW_SNAPSHOT_MODE !== '1') return;
  const root = String(env.INSUMOS_PREVIEW_SNAPSHOT_ROOT || '').trim();
  if (!root) throw new Error('INSUMOS_PREVIEW_SNAPSHOT_ROOT_REQUIRED');
  const relative = path.relative(path.resolve(root), outputPath);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('INSUMOS_PREVIEW_SNAPSHOT_PATH_OUTSIDE_RUNTIME');
  }
}

function assertDatabaseName(value) {
  const databaseName = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/.test(databaseName)) {
    throw new Error('INSUMOS_D1_DATABASE_INVALID');
  }
  return databaseName;
}

function parseDatabaseId(configPath) {
  const source = fs.readFileSync(configPath, 'utf8');
  const match = source.match(/^\s*database_id\s*=\s*"([^"]+)"\s*$/m);
  return match ? match[1] : null;
}

function migrationDigest(migrationsDir) {
  const migrations = fs.readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => `${file}\n${fs.readFileSync(path.join(migrationsDir, file), 'utf8')}`)
    .join('\n');
  return sha256(migrations);
}

function resolveOptions(env = process.env) {
  const configPath = path.resolve(env.INSUMOS_D1_CONFIG || path.join(__dirname, '..', '..', 'inventory', 'wrangler.toml'));
  const migrationsDir = path.resolve(env.INSUMOS_D1_MIGRATIONS_DIR || path.join(path.dirname(configPath), 'migrations'));
  if (!fs.existsSync(configPath)) throw new Error('INSUMOS_D1_CONFIG_NOT_FOUND');
  if (!fs.existsSync(migrationsDir)) throw new Error('INSUMOS_D1_MIGRATIONS_NOT_FOUND');
  const executable = String(env.INSUMOS_D1_WRANGLER_BIN || env.WRNGLR_BIN || 'npx').trim();
  if (!executable) throw new Error('INSUMOS_D1_WRANGLER_NOT_CONFIGURED');
  return {
    configPath,
    migrationsDir,
    dbName: assertDatabaseName(env.INSUMOS_D1_DB || 'skincos-db'),
    databaseId: String(env.INSUMOS_D1_DATABASE_ID || parseDatabaseId(configPath) || '').trim() || null,
    environment: String(env.INSUMOS_D1_ENV || 'production').trim() || 'production',
    executable,
    maxBuffer: Number(env.INSUMOS_D1_MAX_BUFFER_BYTES || 64 * 1024 * 1024),
  };
}

function wranglerArguments(options, sql) {
  const executableName = path.basename(options.executable).toLowerCase();
  const prefix = executableName === 'npx' || executableName === 'npx.cmd' ? ['--no-install', 'wrangler'] : [];
  const command = Array.isArray(sql)
    ? sql.map((statement) => normalizeSql(statement)).filter(Boolean).join(';\n')
    : normalizeSql(sql);
  const environmentArgs = options.environment && options.environment !== 'production'
    ? ['--env', options.environment]
    : [];
  return [
    ...prefix,
    'd1', 'execute', options.dbName,
    '--remote',
    '--json',
    '--config', options.configPath,
    ...environmentArgs,
    '--command', command,
  ];
}

function parseWranglerResults(raw, expectedCount) {
  const parsed = JSON.parse(String(raw || '').trim() || '[]');
  const results = Array.isArray(parsed)
    ? parsed
    : (Array.isArray(parsed?.result) ? parsed.result : []);
  if (results.length !== expectedCount) {
    throw new Error(`D1_BATCH_RESULT_COUNT_INVALID:${results.length}`);
  }
  return results.map((result) => {
    if (!result || result.success === false) throw new Error(result?.error || 'D1_QUERY_FAILED');
    if (!Array.isArray(result.results)) throw new Error('D1_QUERY_RESULT_INVALID');
    return result.results;
  });
}

function runBatch(options, statements, label) {
  const safeStatements = Array.isArray(statements) ? statements.filter(Boolean) : [statements].filter(Boolean);
  if (!safeStatements.length) return [];
  const result = spawnSync(options.executable, wranglerArguments(options, safeStatements), {
    cwd: path.dirname(options.configPath),
    encoding: 'utf8',
    maxBuffer: Number.isFinite(options.maxBuffer) && options.maxBuffer > 0 ? options.maxBuffer : 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.error?.message || 'wrangler failed').replace(/\s+/g, ' ').trim().slice(0, 400);
    throw new Error(`D1_QUERY_FAILED:${label}${detail ? `:${detail}` : ''}`);
  }
  try {
    return parseWranglerResults(result.stdout, safeStatements.length);
  } catch (error) {
    throw new Error(`D1_QUERY_FAILED:${label}:${error.message || error}`);
  }
}

function tableExists(tables, tableName) {
  return tables.some((row) => String(row?.name || '').toLowerCase() === tableName.toLowerCase());
}

function lastWatermark(rows, field) {
  const values = rows.map((row) => String(row?.[field] || '').trim()).filter(Boolean).sort();
  return values.length ? values[values.length - 1] : null;
}

function createPreviewSnapshot({ options, d1, tableMetadata, startedAt, finishedAt, consistency = null }) {
  const snapshotId = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${crypto.randomBytes(4).toString('hex')}-${crypto.randomBytes(2).toString('hex')}-4${crypto.randomBytes(1).toString('hex').slice(1)}-a${crypto.randomBytes(1).toString('hex').slice(1)}-${crypto.randomBytes(6).toString('hex')}`;
  const canonicalD1 = canonicalJson(d1);
  const d1Sha256 = sha256(canonicalD1);
  const snapshot = {
    version: PREVIEW_VERSION,
    kind: PREVIEW_KIND,
    snapshotId,
    createdAt: finishedAt,
    sources: {
      d1: {
        provider: 'cloudflare-d1',
        readOnly: true,
        environment: options.environment,
        databaseName: options.dbName,
        databaseId: options.databaseId,
        exporter: 'insumos-d1-export.cjs',
        startedAt,
        finishedAt,
        migrationDigest: migrationDigest(options.migrationsDir),
        consistency: consistency || {
          mode: SNAPSHOT_CONSISTENCY_MODE,
          statementCount: TABLES.length,
        },
        tables: tableMetadata,
      },
    },
    redaction: {
      omittedTables: ['crm_users', 'insumos_users', 'audit_log', 'notification_snapshot', 'share_history'],
      omittedColumns: [
        'insumos_suppliers.documento',
        'insumos_suppliers.email',
        'insumos_suppliers.telefone',
      ],
    },
    integrity: {
      algorithm: 'sha256',
      d1Sha256,
      d1Bytes: Buffer.byteLength(canonicalD1, 'utf8'),
    },
    d1,
  };
  return snapshot;
}

function buildPreviewSnapshot(options) {
  const startedAt = new Date().toISOString();
  // Schema discovery is separate only to omit genuinely unavailable optional
  // tables. All business reads below are one remote D1 batch, so normal stock
  // writes cannot interleave and create a cross-table mixed snapshot.
  const schemaStatements = [
    `SELECT name FROM sqlite_master WHERE type = 'table'`,
    ...TABLES.map((spec) => `PRAGMA table_info(${spec.table})`),
  ];
  const [tables, ...columnResults] = runBatch(options, schemaStatements, 'schema');
  const availableSpecs = TABLES.map((spec, index) => {
    const available = tableExists(tables, spec.table);
    const columns = schemaColumns(columnResults[index]);
    return {
      ...spec,
      available,
      columns,
      sql: available ? compatibleSql(spec, columns) : spec.sql,
    };
  });
  for (const spec of availableSpecs) {
    if (!spec.available && spec.required) throw new Error(`D1_REQUIRED_TABLE_MISSING:${spec.table}`);
  }
  const resultSets = runBatch(options, availableSpecs.filter((spec) => spec.available).map((spec) => spec.sql), 'snapshot');
  const d1 = {};
  const tableMetadata = {};
  let resultIndex = 0;
  for (const spec of availableSpecs) {
    const rows = spec.available ? resultSets[resultIndex++] : [];
    d1[spec.key] = rows;
    tableMetadata[spec.key] = {
      table: spec.table,
      available: spec.available,
      count: rows.length,
      watermark: spec.watermark ? lastWatermark(rows, spec.watermark) : null,
    };
  }
  return createPreviewSnapshot({
    options,
    d1,
    tableMetadata,
    startedAt,
    finishedAt: new Date().toISOString(),
    consistency: {
      mode: SNAPSHOT_CONSISTENCY_MODE,
      schemaCheckedAt: startedAt,
      statementCount: resultSets.length,
    },
  });
}

function verifyPreviewSnapshot(snapshot) {
  if (!snapshot || snapshot.version !== PREVIEW_VERSION || snapshot.kind !== PREVIEW_KIND) {
    throw new Error('INSUMOS_PREVIEW_SNAPSHOT_INVALID');
  }
  if (!SNAPSHOT_ID_RE.test(String(snapshot.snapshotId || ''))) throw new Error('INSUMOS_PREVIEW_SNAPSHOT_ID_INVALID');
  if (snapshot?.sources?.d1?.readOnly !== true) throw new Error('INSUMOS_PREVIEW_SNAPSHOT_NOT_READ_ONLY');
  if (!snapshot.d1 || typeof snapshot.d1 !== 'object') throw new Error('INSUMOS_PREVIEW_SNAPSHOT_D1_MISSING');
  const expectedKeys = TABLES.map((spec) => spec.key).sort();
  const actualKeys = Object.keys(snapshot.d1).sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error('INSUMOS_PREVIEW_SNAPSHOT_D1_KEYS_INVALID');
  }
  if (snapshot?.sources?.d1?.consistency?.mode !== SNAPSHOT_CONSISTENCY_MODE) {
    throw new Error('INSUMOS_PREVIEW_SNAPSHOT_CONSISTENCY_INVALID');
  }
  for (const spec of TABLES) {
    if (!Array.isArray(snapshot.d1[spec.key])) throw new Error(`INSUMOS_PREVIEW_SNAPSHOT_TABLE_INVALID:${spec.key}`);
    const metadata = snapshot?.sources?.d1?.tables?.[spec.key];
    if (!metadata || Number(metadata.count) !== snapshot.d1[spec.key].length) {
      throw new Error(`INSUMOS_PREVIEW_SNAPSHOT_COUNT_INVALID:${spec.key}`);
    }
  }
  const expectedDigest = String(snapshot?.integrity?.d1Sha256 || '');
  if (!SHA256_RE.test(expectedDigest) || sha256(canonicalJson(snapshot.d1)) !== expectedDigest) {
    throw new Error('INSUMOS_PREVIEW_SNAPSHOT_DIGEST_INVALID');
  }
  return snapshot;
}

function readPreviewSnapshot(filePath) {
  const snapshot = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return verifyPreviewSnapshot(snapshot);
}

function previewMetadata(snapshot) {
  const tables = {};
  for (const spec of TABLES) {
    const metadata = snapshot.sources.d1.tables[spec.key];
    tables[spec.key] = {
      table: metadata.table,
      available: Boolean(metadata.available),
      count: Number(metadata.count),
      watermark: metadata.watermark || null,
    };
  }
  return {
    snapshotId: snapshot.snapshotId,
    createdAt: snapshot.createdAt,
    source: {
      provider: snapshot.sources.d1.provider,
      readOnly: snapshot.sources.d1.readOnly,
      environment: snapshot.sources.d1.environment,
      databaseName: snapshot.sources.d1.databaseName,
      databaseId: snapshot.sources.d1.databaseId,
      migrationDigest: snapshot.sources.d1.migrationDigest,
    },
    integrity: { d1Sha256: snapshot.integrity.d1Sha256, d1Bytes: snapshot.integrity.d1Bytes },
    tables,
  };
}

function writeSnapshotAtomically(outputPath, snapshot) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  const temporary = path.join(path.dirname(outputPath), `.${path.basename(outputPath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, outputPath);
    fs.chmodSync(outputPath, 0o600);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

function main(argv = process.argv, env = process.env) {
  if (argv[2] === '--inspect') {
    const filePath = argv[3];
    if (!filePath) throw new Error('INSUMOS_PREVIEW_SNAPSHOT_PATH_REQUIRED');
    const metadata = previewMetadata(readPreviewSnapshot(path.resolve(process.cwd(), filePath)));
    if (argv[4] === '--field') {
      const field = argv[5];
      if (field === 'snapshotId') {
        process.stdout.write(`${metadata.snapshotId}\n`);
        return metadata;
      }
      throw new Error('INSUMOS_PREVIEW_SNAPSHOT_FIELD_INVALID');
    }
    process.stdout.write(`${JSON.stringify(metadata)}\n`);
    return metadata;
  }

  const outputPath = normalizeOutputPath(argv[2] || `insumos-preview-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  assertPreviewOutputPath(outputPath, env);
  const snapshot = buildPreviewSnapshot(resolveOptions(env));
  writeSnapshotAtomically(outputPath, snapshot);
  const metadata = previewMetadata(snapshot);
  const summary = Object.entries(metadata.tables).map(([key, value]) => `${key}=${value.count}`).join(', ');
  console.log(`[insumos-export] Snapshot ${metadata.snapshotId} pronto (${summary}).`);
  return metadata;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[insumos-export] ${error.message || error}`);
    process.exitCode = 1;
  }
}

module.exports = {
  PREVIEW_KIND,
  PREVIEW_VERSION,
  SNAPSHOT_CONSISTENCY_MODE,
  TABLES,
  assertPreviewOutputPath,
  compatibleSql,
  canonicalJson,
  buildPreviewSnapshot,
  createPreviewSnapshot,
  previewMetadata,
  readPreviewSnapshot,
  resolveOptions,
  verifyPreviewSnapshot,
  writeSnapshotAtomically,
  wranglerArguments,
};
