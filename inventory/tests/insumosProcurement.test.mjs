import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test, { after, before } from 'node:test';
import wrangler from 'wrangler';

import {
  d1ArchiveFornecedor,
  d1CancelarPedidoInterno,
  d1CreateFornecedor,
  d1CreateInsumo,
  d1CreatePedidoInterno,
  d1ExecuteIdempotent,
  d1GetPedidoInterno,
  d1ListFornecedores,
  d1ReceberPedidoInterno,
} from '../src/d1Store.js';
import { handleInsumosRoutes } from '../src/routes/insumos.js';

const { getPlatformProxy } = wrangler;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const UNIT_NH = 'novo-hamburgo';
const UNIT_BSS = 'barra-shopping-sul';
const UNITS = [UNIT_NH, UNIT_BSS];
const MANAGER = { username: 'procurement-manager', role: 'GESTOR', allowedUnits: UNITS };
const OPERATOR = { username: 'procurement-operator', role: 'OPERADOR', allowedUnits: UNITS };
const BSS_ONLY = { username: 'procurement-bss', role: 'GESTOR', allowedUnits: [UNIT_BSS] };

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
    if (quote) { buffer += char; if (char === quote && sql[index - 1] !== '\\') quote = null; continue; }
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

let proxy;
let env;
let db;
let sequence = 0;

async function applyTestSchema(database) {
  const names = [
    '0004_insumos_d1.sql', '0006_categories_policy.sql', '0012_item_policy.sql',
    '0013_insumos_barcodes.sql', '0014_insumos_movements_agg.sql',
    '0019_insumos_ledger_guardrails.sql', '0020_insumos_transfer_receipt.sql',
    '0021_insumos_guided_count.sql', '0022_insumos_procurement.sql',
  ];
  for (const name of names) {
    const sql = await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
    for (const statement of splitMigrationSql(sql)) await database.prepare(statement).run();
  }
}

async function rows(sql, ...binds) {
  return (await db.prepare(sql).bind(...binds).all()).results || [];
}

async function createItem(code) {
  sequence += 1;
  return d1CreateInsumo({
    env,
    unidades: UNITS,
    unidade: UNIT_NH,
    actor: MANAGER,
    body: {
      codigoBarras: code || `PROC-${sequence}`,
      produto: 'Produto de compras',
      lote: 'PROC-LOT',
      dataValidade: '2099-12-31',
      estoqueInicial: 0,
      policyRequiresLot: true,
      policyRequiresExpiry: true,
    },
  });
}

before(async () => {
  proxy = await getPlatformProxy({ configPath: fileURLToPath(new URL('../wrangler.toml', import.meta.url)), persist: false, remoteBindings: false });
  env = { DB: proxy.env.DB };
  db = env.DB;
  await applyTestSchema(db);
});

after(async () => { await proxy?.dispose?.(); });

test('supplier creation is unit-scoped and archival is governed by pending orders', async () => {
  const created = await d1CreateFornecedor({ env, unidade: UNIT_NH, actor: MANAGER, body: { nome: `Fornecedor ${Date.now()}` } });
  assert.equal(created.ok, true);
  assert.equal(created.supplier.active, true);
  const denied = await d1CreateFornecedor({ env, unidade: UNIT_NH, actor: BSS_ONLY, body: { nome: 'Sem escopo' } });
  assert.equal(denied.code, 'RBAC_UNIT_DENIED');
  const item = await createItem(`PROC-ARCH-${Date.now()}`);
  const order = await d1CreatePedidoInterno({
    env,
    unidade: UNIT_NH,
    actor: MANAGER,
    body: { fornecedorId: created.supplier.id, status: 'ORDERED', linhas: [{ registro: item.registro, quantidade: 2, custoUnitarioCentavos: 1250 }] },
  });
  assert.equal(order.ok, true);
  const blocked = await d1ArchiveFornecedor({ env, id: created.supplier.id, unidade: UNIT_NH, actor: MANAGER });
  assert.equal(blocked.code, 'SUPPLIER_PENDING_ORDERS');
  const cancelled = await d1CancelarPedidoInterno({ env, id: order.order.id, unidade: UNIT_NH, actor: MANAGER, justificativa: 'Pedido de teste cancelado' });
  assert.equal(cancelled.order.status, 'CANCELLED');
  const archived = await d1ArchiveFornecedor({ env, id: created.supplier.id, unidade: UNIT_NH, actor: MANAGER });
  assert.equal(archived.ok, true);
  assert.equal((await d1ListFornecedores({ env, unidade: UNIT_NH, actor: MANAGER, includeArchived: true })).items.find((row) => row.id === created.supplier.id).active, false);
});

test('partial receipts record integer-cent costs and ledger entries without external effects', async () => {
  const supplier = await d1CreateFornecedor({ env, unidade: UNIT_NH, actor: MANAGER, body: { nome: `Recebimento ${Date.now()}` } });
  const item = await createItem(`PROC-RECEIVE-${Date.now()}`);
  const order = await d1CreatePedidoInterno({
    env,
    unidade: UNIT_NH,
    actor: MANAGER,
    body: { fornecedorId: supplier.supplier.id, status: 'ORDERED', linhas: [{ registro: item.registro, quantidade: 10, custoUnitarioCentavos: 987 }] },
  });
  assert.equal(order.order.lines[0].custoUnitarioCentavos, 987);
  const lineId = order.order.lines[0].id;
  const first = await d1ReceberPedidoInterno({ env, id: order.order.id, unidade: UNIT_NH, actor: OPERATOR, body: { linhas: [{ linhaId: lineId, quantidade: 4 }], observacoes: 'Recebimento parcial' } });
  assert.equal(first.ok, true);
  assert.equal(first.order.status, 'PARTIALLY_RECEIVED');
  assert.equal(first.received[0].custoUnitarioCentavos, 987);
  assert.equal((await rows('SELECT quantidade FROM insumos_stocks WHERE registro = ? AND unidade = ?', item.registro, UNIT_NH))[0].quantidade, 4);
  assert.equal((await rows("SELECT tipo, quantidade, usuario FROM insumos_movements WHERE registro_insumo = ? AND tipo = 'ENTRADA' ORDER BY data_hora DESC", item.registro))[0].usuario, OPERATOR.username);
  const second = await d1ReceberPedidoInterno({ env, id: order.order.id, unidade: UNIT_NH, actor: OPERATOR, body: { lines: [{ lineId, quantity: 6, unitCostCents: 1001 }] } });
  assert.equal(second.order.status, 'RECEIVED');
  assert.equal(second.received[0].custoUnitarioCentavos, 1001);
  assert.equal((await rows('SELECT quantidade FROM insumos_stocks WHERE registro = ? AND unidade = ?', item.registro, UNIT_NH))[0].quantidade, 10);
  const receipts = await rows('SELECT quantidade, custo_unitario_centavos FROM insumos_purchase_receipts WHERE pedido_id = ? ORDER BY received_at', order.order.id);
  assert.deepEqual(receipts.map((row) => [row.quantidade, row.custo_unitario_centavos]), [[4, 987], [6, 1001]]);
});

test('idempotent receipt and route actor contract prevent duplicate stock and spoofed responsibility', async () => {
  const supplier = await d1CreateFornecedor({ env, unidade: UNIT_NH, actor: MANAGER, body: { nome: `Idempotência ${Date.now()}` } });
  const item = await createItem(`PROC-IDEMP-${Date.now()}`);
  const order = await d1CreatePedidoInterno({ env, unidade: UNIT_NH, actor: MANAGER, body: { fornecedorId: supplier.supplier.id, linhas: [{ registro: item.registro, quantidade: 3, custoUnitarioCentavos: 1 }] } });
  const lineId = order.order.lines[0].id;
  const execute = () => d1ReceberPedidoInterno({ env, id: order.order.id, unidade: UNIT_NH, actor: OPERATOR, body: { linhas: [{ linhaId: lineId, quantidade: 3 }] } });
  const first = await d1ExecuteIdempotent({ env, actor: OPERATOR, action: 'PURCHASE_RECEIPT', idempotencyKey: 'proc-receipt-idempotent', command: { orderId: order.order.id, unidade: UNIT_NH, body: { linhas: [{ linhaId: lineId, quantidade: 3 }] } }, execute });
  const replay = await d1ExecuteIdempotent({ env, actor: OPERATOR, action: 'PURCHASE_RECEIPT', idempotencyKey: 'proc-receipt-idempotent', command: { orderId: order.order.id, unidade: UNIT_NH, body: { linhas: [{ linhaId: lineId, quantidade: 3 }] } }, execute });
  assert.equal(first.result.ok, true);
  assert.equal(replay.replayed, true);
  assert.equal((await rows('SELECT COUNT(1) AS n FROM insumos_purchase_receipts WHERE pedido_id = ?', order.order.id))[0].n, 1);
  assert.equal((await rows('SELECT quantidade FROM insumos_stocks WHERE registro = ? AND unidade = ?', item.registro, UNIT_NH))[0].quantidade, 3);

  const audit = [];
  const actor = { ...MANAGER, username: 'route-real-actor' };
  const d1 = {
    enabled: true,
    executeIdempotent: (args) => d1ExecuteIdempotent({ env, ...args }),
    createFornecedor: ({ unidade, actor: currentActor, body }) => d1CreateFornecedor({ env, unidade, actor: currentActor, body }),
  };
  const request = new Request(`https://inventory.test/insumos/fornecedores?unidade=${UNIT_NH}`, { method: 'POST', body: JSON.stringify({ nome: `Rota ${Date.now()}`, usuario: 'spoofed' }), headers: { 'content-type': 'application/json', 'idempotency-key': 'supplier-route' } });
  const response = await handleInsumosRoutes({ request, url: new URL(request.url), env, ctx: { waitUntil: () => {} }, appOrigin: 'https://crm.skincos.com.br', withCORS: (body, init) => new Response(body, init), unidade: UNIT_NH, requireRoles: async () => ({ ok: true, user: actor }), appendAuditLog: async (entry) => audit.push(entry), enqueueNotificationsRefresh: async () => {}, idempotencyKey: 'supplier-route', d1 });
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.data.createdBy, actor.username);
  assert.equal(payload.data.createdBy, 'route-real-actor');
  assert.equal(audit[0].actor, actor.username);
});

test('receipt rejects quantities above the pending balance', async () => {
  const item = await createItem(`PROC-OVER-${Date.now()}`);
  const order = await d1CreatePedidoInterno({ env, unidade: UNIT_NH, actor: MANAGER, body: { linhas: [{ registro: item.registro, quantidade: 2, custoUnitarioCentavos: 25 }] } });
  const result = await d1ReceberPedidoInterno({ env, id: order.order.id, unidade: UNIT_NH, actor: OPERATOR, body: { linhas: [{ linhaId: order.order.lines[0].id, quantidade: 3 }] } });
  assert.equal(result.code, 'RECEIPT_EXCEEDS_PENDING');
  assert.equal(result.status, 409);
});
