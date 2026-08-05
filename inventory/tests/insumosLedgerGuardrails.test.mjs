import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test, { after, before } from 'node:test';
import wrangler from 'wrangler';

import {
  d1ArchiveInsumo,
  d1Ajuste,
  d1CreateInsumo,
  d1DeleteInsumo,
  d1EntradaBaixa,
  d1EstornarMovimentacao,
  d1ExecuteIdempotent,
  d1Transfer,
} from '../src/d1Store.js';
import { handleMovimentacoesRoutes } from '../src/routes/movimentacoes.js';

const { getPlatformProxy } = wrangler;

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

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const UNIT_NH = 'novo-hamburgo';
const UNIT_BSS = 'barra-shopping-sul';
const UNITS = [UNIT_NH, UNIT_BSS];
const GESTOR = { username: 'ledger-manager', role: 'GESTOR', allowedUnits: UNITS };
const OPERADOR = { username: 'ledger-operator', role: 'OPERADOR', allowedUnits: UNITS };
const NH_ONLY = { username: 'nh-operator', role: 'OPERADOR', allowedUnits: [UNIT_NH] };

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
  ];
  for (const name of names) {
    const sql = await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
    // Use Wrangler's migration splitter so trigger bodies and comments remain
    // intact while each D1 proxy call receives one executable statement.
    const split = splitMigrationSql(sql);
    for (const statement of split) {
      if (statement.trim()) await database.prepare(statement).run();
    }
  }
}

async function createItem({ actor = GESTOR, unit = UNIT_NH, code, product = 'Produto sintético', lot = 'L1', expiry = '2099-12-31', stock = 0, fefo = false }) {
  sequence += 1;
  return d1CreateInsumo({
    env,
    unidades: UNITS,
    unidade: unit,
    actor,
    body: {
      codigoBarras: code || `TEST-${sequence}`,
      produto: product,
      lote: lot,
      dataValidade: expiry,
      estoqueInicial: stock,
      allowDuplicateLot: sequence > 1,
      novoLote: sequence > 1,
      policyFefo: fefo,
      policyRequiresLot: true,
      policyRequiresExpiry: true,
    },
  });
}

async function rows(sql, ...binds) {
  return (await db.prepare(sql).bind(...binds).all()).results || [];
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

test('materializes opening balances, applies FEFO per lot, and ignores body.usuario', async () => {
  const code = `FEFO-${Date.now()}`;
  const first = await createItem({ code, lot: 'EARLY', expiry: '2099-01-01', stock: 2, fefo: true });
  const second = await createItem({ code, lot: 'LATE', expiry: '2099-06-01', stock: 5, fefo: true });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);

  const firstIssue = await d1EntradaBaixa({
    env,
    unidade: UNIT_NH,
    actor: OPERADOR,
    kind: 'BAIXA',
    body: { codigoBarras: code, quantidade: 2, usuario: 'spoofed-client-user' },
  });
  assert.equal(firstIssue.ok, true);
  assert.equal(firstIssue.pickedBy, 'FEFO');
  assert.equal(firstIssue.registro, first.registro);

  const secondIssue = await d1EntradaBaixa({
    env,
    unidade: UNIT_NH,
    actor: OPERADOR,
    kind: 'BAIXA',
    body: { codigoBarras: code, quantidade: 4 },
  });
  assert.equal(secondIssue.ok, true);
  assert.equal(secondIssue.pickedBy, 'FEFO');
  assert.equal(secondIssue.registro, second.registro);

  const movementRows = await rows(
    `SELECT tipo, quantidade, estoque_novo, usuario FROM insumos_movements
     WHERE codigo_barras = ? ORDER BY data_hora ASC, id ASC`,
    code,
  );
  assert.equal(movementRows.filter((row) => row.tipo === 'SALDO_INICIAL').length, 2);
  assert.equal(movementRows.filter((row) => row.tipo === 'SAÍDA').length, 2);
  assert.ok(movementRows.every((row) => row.usuario === 'ledger-manager' || row.usuario === 'ledger-operator'));
  assert.equal(movementRows.find((row) => row.tipo === 'SAÍDA').usuario, OPERADOR.username);
  assert.deepEqual(
    await rows('SELECT registro, quantidade FROM insumos_stocks WHERE registro IN (?, ?) ORDER BY registro', first.registro, second.registro),
    [
      { registro: first.registro, quantidade: 0 },
      { registro: second.registro, quantidade: 1 },
    ],
  );
});

test('blocks negative stock by default and records a governed manager exception', async () => {
  const code = `NEG-${Date.now()}`;
  const item = await createItem({ code, lot: 'N1', stock: 0 });

  const denied = await d1EntradaBaixa({
    env,
    unidade: UNIT_NH,
    actor: OPERADOR,
    kind: 'BAIXA',
    body: { codigoBarras: code, registro: item.registro, quantidade: 1 },
  });
  assert.equal(denied.code, 'INSUFFICIENT_STOCK');
  assert.equal(denied.status, 409);

  const missingReason = await d1EntradaBaixa({
    env,
    unidade: UNIT_NH,
    actor: GESTOR,
    kind: 'BAIXA',
    body: { codigoBarras: code, registro: item.registro, quantidade: 1 },
  });
  assert.equal(missingReason.code, 'NEGATIVE_STOCK_JUSTIFICATION_REQUIRED');
  assert.equal(missingReason.status, 400);

  const exception = await d1EntradaBaixa({
    env,
    unidade: UNIT_NH,
    actor: GESTOR,
    kind: 'BAIXA',
    body: { codigoBarras: code, registro: item.registro, quantidade: 1, usuario: 'spoofed-client-user', justificativa: 'Ajuste emergencial auditado' },
  });
  assert.equal(exception.ok, true);
  assert.equal(exception.negativeOverride, true);
  assert.equal(exception.novoEstoque, -1);
  const movement = (await rows('SELECT usuario, motivo, estoque_novo FROM insumos_movements WHERE id = ?', (await rows('SELECT id FROM insumos_movements WHERE registro_insumo = ? AND tipo = \'SAÍDA\' ORDER BY data_hora DESC LIMIT 1', item.registro))[0].id))[0];
  assert.equal(movement.usuario, GESTOR.username);
  assert.equal(movement.motivo, 'Ajuste emergencial auditado');
  assert.equal(movement.estoque_novo, -1);
});

test('serializes competing issues and rejects cross-unit commands', async () => {
  const code = `RACE-${Date.now()}`;
  const item = await createItem({ code, lot: 'R1', stock: 1 });
  const attempts = await Promise.all([
    d1EntradaBaixa({ env, unidade: UNIT_NH, actor: OPERADOR, kind: 'BAIXA', body: { codigoBarras: code, registro: item.registro, quantidade: 1 } }),
    d1EntradaBaixa({ env, unidade: UNIT_NH, actor: OPERADOR, kind: 'BAIXA', body: { codigoBarras: code, registro: item.registro, quantidade: 1 } }),
  ]);
  assert.equal(attempts.filter((result) => result.ok).length, 1);
  assert.equal(attempts.filter((result) => result.code === 'INSUFFICIENT_STOCK' || result.code === 'STOCK_CONFLICT').length, 1);

  const deniedEntry = await d1EntradaBaixa({
    env,
    unidade: UNIT_BSS,
    actor: NH_ONLY,
    kind: 'ENTRADA',
    body: { codigoBarras: code, registro: item.registro, quantidade: 1 },
  });
  assert.equal(deniedEntry.code, 'RBAC_UNIT_DENIED');

  const deniedTransfer = await d1Transfer({
    env,
    unidade: UNIT_NH,
    actor: NH_ONLY,
    body: { codigoBarras: code, registro: item.registro, quantidade: 1, fromUnidade: UNIT_NH, toUnidade: UNIT_BSS },
  });
  assert.equal(deniedTransfer.code, 'RBAC_UNIT_DENIED');
});

test('moves stock atomically between scoped units and compensates both transfer legs', async () => {
  const code = `TRANSFER-${Date.now()}`;
  const item = await createItem({ code, lot: 'T1', stock: 4 });
  const transfer = await d1Transfer({
    env,
    unidade: UNIT_NH,
    actor: GESTOR,
    body: { codigoBarras: code, registro: item.registro, quantidade: 2, fromUnidade: UNIT_NH, toUnidade: UNIT_BSS },
  });
  assert.equal(transfer.ok, true);
  assert.equal(transfer.estoqueNovoOrigem, 2);
  assert.equal(transfer.estoqueNovoDestino, 2);
  const legs = await rows('SELECT id, tipo, unidade FROM insumos_movements WHERE id_transferencia = ? ORDER BY tipo', transfer.transferId);
  assert.equal(legs.length, 2);
  const reversed = await d1EstornarMovimentacao({ env, id: legs[0].id, actor: GESTOR, justificativa: 'Transferência cancelada no recebimento' });
  assert.equal(reversed.ok, true);
  assert.deepEqual(
    await rows('SELECT unidade, quantidade FROM insumos_stocks WHERE registro = ? ORDER BY unidade', item.registro),
    [
      { unidade: UNIT_BSS, quantidade: 0 },
      { unidade: UNIT_NH, quantidade: 4 },
    ],
  );
  assert.equal((await rows('SELECT COUNT(1) AS n FROM insumos_movements WHERE estorno_de IS NOT NULL AND id_transferencia = ?', transfer.transferId))[0].n, 2);
});

test('records an adjustment and reverses it without rewriting the original', async () => {
  const code = `ADJUST-${Date.now()}`;
  const item = await createItem({ code, lot: 'J1', stock: 1 });
  const adjustment = await d1Ajuste({
    env,
    unidade: UNIT_NH,
    actor: GESTOR,
    body: { codigoBarras: code, registro: item.registro, novoEstoque: 5, motivo: 'Contagem física' },
  });
  assert.equal(adjustment.ok, true);
  const original = (await rows('SELECT id FROM insumos_movements WHERE registro_insumo = ? AND tipo = \'AJUSTE\' ORDER BY data_hora DESC LIMIT 1', item.registro))[0];
  const reversal = await d1EstornarMovimentacao({ env, id: original.id, actor: GESTOR, justificativa: 'Recontagem corrigida' });
  assert.equal(reversal.ok, true);
  assert.equal((await rows('SELECT quantidade FROM insumos_stocks WHERE registro = ? AND unidade = ?', item.registro, UNIT_NH))[0].quantidade, 1);
  assert.equal((await rows('SELECT tipo FROM insumos_movements WHERE estorno_de = ?', original.id))[0].tipo, 'ESTORNO');
});

test('claims idempotency once, replays completed commands, and rejects concurrent claims', async () => {
  let executions = 0;
  const command = () => d1ExecuteIdempotent({
    env,
    actor: GESTOR,
    action: 'TEST_COMMAND',
    idempotencyKey: 'same-test-command',
    command: { value: 1, usuario: 'ignored' },
    execute: async () => {
      executions += 1;
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { ok: true, status: 201, value: 'done' };
    },
  });
  const concurrent = await Promise.all([command(), command()]);
  assert.equal(executions, 1);
  assert.equal(concurrent.filter((result) => result.ok).length, 1);
  assert.equal(concurrent.filter((result) => result.code === 'IDEMPOTENCY_IN_PROGRESS').length, 1);

  const replay = await command();
  assert.equal(replay.ok, true);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.result, { ok: true, status: 201, value: 'done' });
  assert.equal(executions, 1);
});

test('uses compensating estorno rows and archives only zero-stock items', async () => {
  const code = `REV-${Date.now()}`;
  const item = await createItem({ code, lot: 'E1', stock: 0 });
  const entry = await d1EntradaBaixa({ env, unidade: UNIT_NH, actor: OPERADOR, kind: 'ENTRADA', body: { codigoBarras: code, registro: item.registro, quantidade: 3 } });
  assert.equal(entry.ok, true);
  const original = (await rows(
    `SELECT id FROM insumos_movements WHERE registro_insumo = ? AND tipo = 'ENTRADA' ORDER BY data_hora DESC LIMIT 1`,
    item.registro,
  ))[0];
  assert.ok(original?.id);

  const reversal = await d1EstornarMovimentacao({ env, id: original.id, actor: GESTOR, justificativa: 'Correção do recebimento' });
  assert.equal(reversal.ok, true);
  assert.equal((await rows('SELECT quantidade FROM insumos_stocks WHERE registro = ? AND unidade = ?', item.registro, UNIT_NH))[0].quantidade, 0);
  assert.equal((await rows('SELECT tipo, estorno_de, usuario FROM insumos_movements WHERE estorno_de = ?', original.id))[0].usuario, GESTOR.username);
  assert.equal((await d1EstornarMovimentacao({ env, id: original.id, actor: GESTOR, justificativa: 'Segundo estorno' })).code, 'ALREADY_REVERSED');

  assert.equal((await d1DeleteInsumo({ env, registro: item.registro })).code, 'ARCHIVE_REQUIRED');
  const archived = await d1ArchiveInsumo({ env, registro: item.registro });
  assert.equal(archived.ok, true);
  assert.equal((await d1ArchiveInsumo({ env, registro: item.registro })).alreadyArchived, true);
  const archivedEntry = await d1EntradaBaixa({ env, unidade: UNIT_NH, actor: OPERADOR, kind: 'ENTRADA', body: { codigoBarras: code, registro: item.registro, quantidade: 1 } });
  assert.equal(archivedEntry.code, 'INSUMO_ARCHIVED');
});

test('keeps the movement ledger append-only at the database boundary', async () => {
  const movement = (await rows('SELECT id FROM insumos_movements ORDER BY data_hora ASC, id ASC LIMIT 1'))[0];
  assert.ok(movement?.id);
  await assert.rejects(
    db.prepare('UPDATE insumos_movements SET usuario = ? WHERE id = ?').bind('rewritten', movement.id).run(),
    /INSUMOS_MOVEMENTS_APPEND_ONLY/,
  );
  await assert.rejects(
    db.prepare('DELETE FROM insumos_movements WHERE id = ?').bind(movement.id).run(),
    /INSUMOS_MOVEMENTS_APPEND_ONLY/,
  );
});

test('records adjustments without accepting a negative target', async () => {
  const code = `ADJ-${Date.now()}`;
  const item = await createItem({ code, lot: 'A1', stock: 1 });
  const invalid = await d1Ajuste({ env, unidade: UNIT_NH, actor: GESTOR, body: { codigoBarras: code, registro: item.registro, novoEstoque: -1, motivo: 'inválido' } });
  assert.equal(invalid.code, undefined);
  assert.equal(invalid.status, 400);
});

test('rejects destructive movement HTTP verbs and advertises the estorno route', async () => {
  for (const method of ['PUT', 'DELETE']) {
    const response = await handleMovimentacoesRoutes({
      request: new Request('https://inventory.test/movimentacoes/movement-1', { method }),
      url: new URL('https://inventory.test/movimentacoes/movement-1'),
      d1: { enabled: true },
      appOrigin: 'https://crm.skincos.com.br',
      withCORS: (body, init) => new Response(body, init),
    });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET, POST');
    assert.equal((await response.json()).code, 'LEDGER_IMMUTABLE');
  }
});
