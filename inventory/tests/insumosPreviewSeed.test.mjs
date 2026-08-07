import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test, { after, before } from 'node:test';
import wrangler from 'wrangler';

import { handleAdminRoutes } from '../src/routes/admin.js';
import { verifyInsumosPreviewRestore } from '../src/services/backup.js';
import { isAuthorizedDevSeedRequest } from '../src/lib/devSeed.js';

const { getPlatformProxy } = wrangler;
const ROOT = fileURLToPath(new URL('..', import.meta.url));

function splitMigrationSql(sql) {
  const statements = [];
  let buffer = '';
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  let compound = false;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1] || '';
    if (lineComment) {
      if (char === '\n') { buffer += char; lineComment = false; }
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; index += 1; }
      continue;
    }
    if (!quote && char === '-' && next === '-') { lineComment = true; buffer += '\n'; index += 1; continue; }
    if (!quote && char === '/' && next === '*') { blockComment = true; index += 1; continue; }
    if (quote) {
      buffer += char;
      if (char === quote && sql[index - 1] !== '\\') quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; buffer += char; continue; }
    buffer += char;
    if (!compound && /CREATE\s+TRIGGER[\s\S]*\bBEGIN\s*$/i.test(buffer)) compound = true;
    if (char === ';' && (!compound || /\bEND\s*;\s*$/i.test(buffer))) {
      const statement = buffer.slice(0, -1).trim();
      if (statement) statements.push(statement);
      buffer = '';
      compound = false;
    }
  }
  if (buffer.trim()) statements.push(buffer.trim());
  return statements;
}

async function applySchema(database) {
  for (const name of [
    '0004_insumos_d1.sql',
    '0006_categories_policy.sql',
    '0012_item_policy.sql',
    '0013_insumos_barcodes.sql',
    '0014_insumos_movements_agg.sql',
    '0019_insumos_ledger_guardrails.sql',
    '0020_insumos_transfer_receipt.sql',
    '0021_insumos_guided_count.sql',
    '0022_insumos_procurement.sql',
    '0023_insumos_replenishment.sql',
  ]) {
    const sql = await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
    for (const statement of splitMigrationSql(sql)) await database.prepare(statement).run();
  }
}

const previewKeys = [
  'insumosItems', 'insumosStocks', 'insumosMovements', 'insumosTransfers',
  'insumosSuppliers', 'insumosPurchaseOrders', 'insumosPurchaseOrderLines',
  'insumosPurchaseReceipts', 'insumosReplenishmentPolicies',
  'insumosReplenishmentSuggestions', 'insumosCountSessions', 'insumosCountLines',
  'insumosCountReads',
];

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

async function postSeed(payload) {
  const url = new URL('http://local.test/admin/seed');
  return handleAdminRoutes({
    request: new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-seed-token': 'preview-token' },
      body: JSON.stringify(payload),
    }),
    url,
    env,
    appOrigin: 'http://local.test',
    withCORS: (body, init) => new Response(body, init),
    requireRoles: async () => ({ ok: false }),
    appendAuditLog: async () => {},
    ip: '',
    userAgent: '',
    idempotencyKey: '',
    bcrypt: null,
    validateUsername: () => true,
  });
}

function previewPayload() {
  const d1 = Object.fromEntries(previewKeys.map((key) => [key, []]));
  d1.insumosItems.push({
    registro: 'preview-registro-1', codigoBarras: 'PREVIEW-1', produto: 'Insumo de prévia',
    categoria: 'Teste', lote: 'L1', dataValidade: '2099-12-31', estoqueMinimo: 1,
    dataCadastro: '2026-08-07T12:00:00.000Z', dataAtualizacao: '2026-08-07T12:00:00.000Z',
  });
  d1.insumosStocks.push({
    registro: 'preview-registro-1', unidade: 'novo-hamburgo', quantidade: 7,
    updatedAt: '2026-08-07T12:00:00.000Z',
  });
  d1.insumosMovements.push({
    id: 'preview-movement-1', dataHora: '2026-08-07T12:00:00.000Z', tipo: 'SALDO_INICIAL',
    codigoBarras: 'PREVIEW-1', registroInsumo: 'preview-registro-1', lote: 'L1',
    dataValidade: '2099-12-31', produto: 'Insumo de prévia', quantidade: 7,
    estoqueAnterior: 0, estoqueNovo: 7, unidade: 'novo-hamburgo', usuario: 'preview-test',
    status: 'COMPLETED',
  });
  const tables = Object.fromEntries(previewKeys.map((key) => [key, {
    table: key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).replace(/^insumos_/, 'insumos_'),
    available: true,
    count: d1[key].length,
    watermark: null,
  }]));
  const canonicalD1 = canonicalJson(d1);
  return {
    version: 2,
    kind: 'insumos-local-preview-snapshot',
    snapshotId: '11111111-1111-4111-a111-111111111111',
    sources: { d1: { readOnly: true, consistency: { mode: 'd1-batch', statementCount: previewKeys.length }, tables } },
    integrity: {
      algorithm: 'sha256',
      d1Sha256: createHash('sha256').update(canonicalD1).digest('hex'),
      d1Bytes: Buffer.byteLength(canonicalD1, 'utf8'),
    },
    d1,
  };
}

let proxy;
let env;

before(async () => {
  proxy = await getPlatformProxy({
    configPath: fileURLToPath(new URL('../wrangler.toml', import.meta.url)),
    persist: false,
    remoteBindings: false,
  });
  env = { DB: proxy.env.DB, ALLOW_DEV_SEED: 'true', INSUMOS_SEED_TOKEN: 'preview-token' };
  await applySchema(env.DB);
});

after(async () => {
  await proxy?.dispose?.();
});

test('local preview rejects altered or non-inventory data before it writes any row', async () => {
  const altered = previewPayload();
  altered.d1.insumosStocks[0].quantidade = 8;
  let response = await postSeed(altered);
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'INSUMOS_PREVIEW_SNAPSHOT_DIGEST_INVALID');
  assert.equal(Number((await env.DB.prepare('SELECT COUNT(*) AS count FROM insumos_stocks').first()).count), 0);

  const expanded = previewPayload();
  expanded.d1.crmUsers = [{ username: 'must-not-restore' }];
  response = await postSeed(expanded);
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'INSUMOS_PREVIEW_SNAPSHOT_D1_KEYS_INVALID');
  assert.equal(Number((await env.DB.prepare('SELECT COUNT(*) AS count FROM insumos_stocks').first()).count), 0);
});

test('local preview seed restores and proves the exact snapshot counts without returning records', async () => {
  const payload = previewPayload();
  const response = await postSeed(payload);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.data.restored, true);
  assert.equal(body.data.snapshot.snapshotId, payload.snapshotId);
  assert.equal(body.data.snapshot.counts.insumosItems, 1);
  assert.equal(body.data.snapshot.counts.insumosStocks, 1);
  assert.equal(body.data.snapshot.counts.insumosMovements, 1);
  assert.equal('d1' in body.data.snapshot, false);

  await env.DB.prepare(`INSERT INTO insumos_stocks (registro, unidade, quantidade, updated_at) VALUES ('preview-registro-1', 'barra-shopping-sul', 1, '2026-08-07T12:01:00.000Z')`).run();
  await assert.rejects(
    () => verifyInsumosPreviewRestore({ env, payload }),
    /INSUMOS_PREVIEW_SEED_COUNT_MISMATCH:insumosStocks/,
  );
});

test('local preview accepts only a valid raw token or private digest before bypassing CSRF', async () => {
  const token = 'preview-token-which-is-long-enough';
  const digest = createHash('sha256').update(token).digest('hex');
  const url = new URL('http://local.test/admin/seed');
  const request = new Request(url, {
    method: 'POST',
    headers: { 'x-seed-token': token },
  });
  assert.equal(await isAuthorizedDevSeedRequest({
    env: { ALLOW_DEV_SEED: 'true', INSUMOS_SEED_TOKEN_SHA256: digest }, request, url,
  }), true);
  assert.equal(await isAuthorizedDevSeedRequest({
    env: { ALLOW_DEV_SEED: 'true', INSUMOS_SEED_TOKEN_SHA256: digest },
    request: new Request(url, { method: 'POST', headers: { 'x-seed-token': 'different-token' } }),
    url,
  }), false);
  assert.equal(await isAuthorizedDevSeedRequest({
    env: { ALLOW_DEV_SEED: 'false', INSUMOS_SEED_TOKEN_SHA256: digest }, request, url,
  }), false);
});
