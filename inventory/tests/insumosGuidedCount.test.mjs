import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test, { after, before } from 'node:test';
import wrangler from 'wrangler';

import {
  d1Ajuste,
  d1CreateInsumo,
  d1EntradaBaixa,
  d1FecharContagem,
  d1GetContagem,
  d1IniciarContagem,
  d1RegistrarContagem,
  d1RecontarContagem,
} from '../src/d1Store.js';
import { handleInsumosRoutes } from '../src/routes/insumos.js';

const { getPlatformProxy } = wrangler;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const UNIT_NH = 'novo-hamburgo';
const UNIT_BSS = 'barra-shopping-sul';
const UNITS = [UNIT_NH, UNIT_BSS];
const GESTOR = { username: 'count-manager', role: 'GESTOR', allowedUnits: UNITS };
const OPERADOR = { username: 'count-operator', role: 'OPERADOR', allowedUnits: UNITS };
const NH_ONLY = { username: 'count-nh-only', role: 'OPERADOR', allowedUnits: [UNIT_NH] };

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
      if (char === '\n') {
        buffer += char;
        lineComment = false;
      }
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (!quote && char === '-' && next === '-') {
      lineComment = true;
      buffer += '\n';
      index += 1;
      continue;
    }
    if (!quote && char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (quote) {
      buffer += char;
      if (char === quote && sql[index - 1] !== '\\') quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      buffer += char;
      continue;
    }
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

let proxy;
let env;
let db;
let sequence = 0;

async function applyTestSchema(database) {
  const names = [
    '0004_insumos_d1.sql',
    '0006_categories_policy.sql',
    '0012_item_policy.sql',
    '0013_insumos_barcodes.sql',
    '0014_insumos_movements_agg.sql',
    '0019_insumos_ledger_guardrails.sql',
    '0020_insumos_transfer_receipt.sql',
    '0021_insumos_guided_count.sql',
  ];
  for (const name of names) {
    const sql = await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
    for (const statement of splitMigrationSql(sql)) {
      if (statement.trim()) await database.prepare(statement).run();
    }
  }
}

async function rows(sql, ...binds) {
  return (await db.prepare(sql).bind(...binds).all()).results || [];
}

async function createItem({ code, lot = 'L1', stock = 0, product = 'Produto de contagem' }) {
  sequence += 1;
  return d1CreateInsumo({
    env,
    unidades: UNITS,
    unidade: UNIT_NH,
    actor: GESTOR,
    body: {
      codigoBarras: code || `COUNT-${sequence}`,
      produto: product,
      lote: lot,
      dataValidade: '2099-12-31',
      estoqueInicial: stock,
      allowDuplicateLot: sequence > 1,
      novoLote: sequence > 1,
      policyRequiresLot: true,
      policyRequiresExpiry: true,
    },
  });
}

before(async () => {
  proxy = await getPlatformProxy({
    configPath: fileURLToPath(new URL('../wrangler.toml', import.meta.url)),
    persist: false,
    remoteBindings: false,
  });
  env = { DB: proxy.env.DB };
  db = env.DB;
  await applyTestSchema(db);
});

after(async () => {
  await proxy?.dispose?.();
});

test('snapshots every lot, requires scoped permissions, and rejects ambiguous reads', async () => {
  const code = `COUNT-LOTS-${Date.now()}`;
  const first = await createItem({ code, lot: 'EARLY', stock: 3 });
  const second = await createItem({ code, lot: 'LATE', stock: 2 });
  const started = await d1IniciarContagem({ env, unidade: UNIT_NH, actor: OPERADOR, observacoes: 'Contagem de rotina' });
  assert.equal(started.ok, true);
  assert.equal(started.session.status, 'OPEN');
  assert.equal(started.session.lines.length >= 2, true);
  const lotLines = started.session.lines.filter((line) => line.codigoBarras === code);
  assert.equal(lotLines.length, 2);
  assert.deepEqual(lotLines.map((line) => line.lote).sort(), ['EARLY', 'LATE']);

  const denied = await d1IniciarContagem({ env, unidade: UNIT_BSS, actor: NH_ONLY });
  assert.equal(denied.code, 'RBAC_UNIT_DENIED');
  assert.equal(denied.status, 403);
  const duplicate = await d1IniciarContagem({ env, unidade: UNIT_NH, actor: GESTOR });
  assert.equal(duplicate.code, 'COUNT_ALREADY_OPEN');
  assert.equal(duplicate.status, 409);

  const ambiguous = await d1RegistrarContagem({
    env,
    id: started.session.id,
    unidade: UNIT_NH,
    actor: OPERADOR,
    body: { codigoBarras: code, quantidade: 3 },
  });
  assert.equal(ambiguous.code, 'COUNT_AMBIGUOUS_LOT');
  assert.equal(ambiguous.status, 409);

  const readFirst = await d1RegistrarContagem({
    env,
    id: started.session.id,
    unidade: UNIT_NH,
    actor: OPERADOR,
    body: { registro: first.registro, quantidade: 4, lote: 'EARLY', observacoes: 'Leitura manual' },
  });
  assert.equal(readFirst.ok, true);
  assert.equal(readFirst.line.physicalQuantity, 4);
  const readSecond = await d1RegistrarContagem({
    env,
    id: started.session.id,
    unidade: UNIT_NH,
    actor: OPERADOR,
    body: { lineId: lotLines.find((line) => line.registro === second.registro).id, quantidade: 2 },
  });
  assert.equal(readSecond.ok, true);
  assert.equal(readSecond.line.status, 'COUNTED');
  assert.equal((await rows('SELECT COUNT(1) AS n FROM insumos_count_reads WHERE session_id = ?', started.session.id))[0].n, 2);
  // Keep the shared in-memory D1 fixture ready for the next scenario.
  const closed = await d1FecharContagem({ env, id: started.session.id, unidade: UNIT_NH, actor: GESTOR });
  assert.equal(closed.ok, true);
  assert.equal(closed.session.status, 'CLOSED');
});

test('marks movement-after-snapshot as conflict, recounts, then closes with compensating adjustment', async () => {
  const itemCode = `COUNT-CONFLICT-${Date.now()}`;
  const item = await createItem({ code: itemCode, lot: 'C1', stock: 5 });
  const started = await d1IniciarContagem({ env, unidade: UNIT_NH, actor: OPERADOR });
  for (const line of started.session.lines) {
    const read = await d1RegistrarContagem({ env, id: started.session.id, unidade: UNIT_NH, actor: OPERADOR, body: { registro: line.registro, quantidade: line.snapshotQuantity } });
    assert.equal(read.ok, true);
  }

  const issue = await d1EntradaBaixa({
    env,
    unidade: UNIT_NH,
    actor: OPERADOR,
    kind: 'BAIXA',
    body: { codigoBarras: itemCode, registro: item.registro, quantidade: 1 },
  });
  assert.equal(issue.ok, true);

  const conflict = await d1FecharContagem({ env, id: started.session.id, unidade: UNIT_NH, actor: GESTOR });
  assert.equal(conflict.code, 'COUNT_CONFLICT');
  assert.equal(conflict.status, 409);
  assert.equal((await d1GetContagem({ env, id: started.session.id, unidade: UNIT_NH, actor: GESTOR })).session.status, 'CONFLICT');

  const recount = await d1RecontarContagem({ env, id: started.session.id, unidade: UNIT_NH, actor: GESTOR, observacoes: 'Recontagem após conflito' });
  assert.equal(recount.ok, true);
  assert.equal(recount.session.status, 'OPEN');
  for (const line of recount.session.lines) {
    const read = await d1RegistrarContagem({ env, id: started.session.id, unidade: UNIT_NH, actor: OPERADOR, body: { registro: line.registro, quantidade: line.snapshotQuantity } });
    assert.equal(read.ok, true);
  }
  const forbiddenClose = await d1FecharContagem({ env, id: started.session.id, unidade: UNIT_NH, actor: OPERADOR });
  assert.equal(forbiddenClose.code, 'COUNT_MANAGER_REQUIRED');
  assert.equal(forbiddenClose.status, 403);
  const closed = await d1FecharContagem({ env, id: started.session.id, unidade: UNIT_NH, actor: GESTOR });
  assert.equal(closed.ok, true);
  assert.equal(closed.session.status, 'CLOSED');

  const adjustmentSession = await d1IniciarContagem({ env, unidade: UNIT_NH, actor: GESTOR });
  for (const line of adjustmentSession.session.lines) {
    const desired = line.registro === item.registro ? line.snapshotQuantity + 2 : line.snapshotQuantity;
    const read = await d1RegistrarContagem({ env, id: adjustmentSession.session.id, unidade: UNIT_NH, actor: OPERADOR, body: { registro: line.registro, quantidade: desired } });
    assert.equal(read.ok, true);
  }
  const adjusted = await d1FecharContagem({ env, id: adjustmentSession.session.id, unidade: UNIT_NH, actor: GESTOR });
  assert.equal(adjusted.ok, true);
  assert.equal(adjusted.session.status, 'CLOSED');
  assert.equal(adjusted.adjustments.filter((entry) => entry.delta !== 0).length, 1);
  const stock = await rows('SELECT quantidade FROM insumos_stocks WHERE registro = ? AND unidade = ?', item.registro, UNIT_NH);
  assert.equal(stock[0].quantidade, 6);
  const movements = await rows("SELECT tipo, motivo, usuario FROM insumos_movements WHERE registro_insumo = ? AND tipo = 'AJUSTE' ORDER BY data_hora DESC", item.registro);
  assert.equal(movements.length >= 1, true);
  assert.equal(movements[0].usuario, GESTOR.username);
  assert.match(movements[0].motivo, /Contagem física/);
});

test('routes expose the stable session/line contract and use the authenticated actor', async () => {
  await createItem({ code: `COUNT-ROUTE-${Date.now()}`, lot: 'R1', stock: 1 });
  const audit = [];
  const d1 = {
    enabled: true,
    executeIdempotent: (args) => import('../src/d1Store.js').then(({ d1ExecuteIdempotent }) => d1ExecuteIdempotent({ env, ...args })),
    iniciarContagem: ({ unidade, actor, observacoes }) => d1IniciarContagem({ env, unidade, actor, observacoes }),
    getContagem: ({ id, actor, unidade }) => d1GetContagem({ env, id, actor, unidade }),
    registrarContagem: ({ id, actor, unidade, body }) => d1RegistrarContagem({ env, id, actor, unidade, body }),
    fecharContagem: ({ id, actor, unidade }) => d1FecharContagem({ env, id, actor, unidade }),
    recontarContagem: ({ id, actor, unidade, observacoes }) => d1RecontarContagem({ env, id, actor, unidade, observacoes }),
  };
  const actor = { ...GESTOR, username: 'route-count-actor' };
  const base = (request, url, key) => ({
    request,
    url,
    env,
    ctx: { waitUntil: () => {} },
    appOrigin: 'https://crm.skincos.com.br',
    withCORS: (body, init) => new Response(body, init),
    unidade: UNIT_NH,
    requireRoles: async () => ({ ok: true, user: actor }),
    appendAuditLog: async (entry) => audit.push(entry),
    enqueueNotificationsRefresh: async () => {},
    idempotencyKey: key,
    d1,
  });
  const startRequest = new Request(`https://inventory.test/insumos/contagens?unidade=${UNIT_NH}`, {
    method: 'POST',
    body: JSON.stringify({ observacoes: 'rota' }),
    headers: { 'content-type': 'application/json', 'idempotency-key': 'count-route-start' },
  });
  const startResponse = await handleInsumosRoutes(base(startRequest, new URL(startRequest.url), 'count-route-start'));
  assert.equal(startResponse.status, 201);
  const startPayload = await startResponse.json();
  assert.equal(startPayload.success, true);
  const session = startPayload.data.session;
  assert.equal(Array.isArray(session.lines), true);
  assert.equal(typeof session.lines[0].snapshotQuantity, 'number');

  const getRequest = new Request(`https://inventory.test/insumos/contagens/${session.id}?unidade=${UNIT_NH}`, { method: 'GET' });
  const getResponse = await handleInsumosRoutes(base(getRequest, new URL(getRequest.url), ''));
  assert.equal(getResponse.status, 200);
  const getPayload = await getResponse.json();
  assert.equal(getPayload.data.lines[0].id, session.lines[0].id);

  const readRequest = new Request(`https://inventory.test/insumos/contagens/${session.id}/leituras?unidade=${UNIT_NH}`, {
    method: 'POST',
    body: JSON.stringify({ registro: session.lines[0].registro, quantidade: session.lines[0].snapshotQuantity, usuario: 'spoofed' }),
    headers: { 'content-type': 'application/json', 'idempotency-key': 'count-route-read' },
  });
  const readResponse = await handleInsumosRoutes(base(readRequest, new URL(readRequest.url), 'count-route-read'));
  assert.equal(readResponse.status, 200);
  const readPayload = await readResponse.json();
  assert.equal(readPayload.data.line.countedBy, actor.username);
  assert.notEqual(readPayload.data.line.countedBy, 'spoofed');
  assert.equal(audit.map((entry) => entry.action).includes('COUNT_START'), true);
  const cleanup = await d1RecontarContagem({ env, id: session.id, actor, unidade: UNIT_NH });
  assert.equal(cleanup.ok, true);
  // Leave no active session in the shared D1 fixture.
  for (const line of cleanup.session.lines) {
    await d1RegistrarContagem({ env, id: session.id, actor, unidade: UNIT_NH, body: { registro: line.registro, quantidade: line.snapshotQuantity } });
  }
  assert.equal((await d1FecharContagem({ env, id: session.id, actor, unidade: UNIT_NH })).ok, true);
});
