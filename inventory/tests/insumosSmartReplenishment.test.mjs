import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test, { after, before } from 'node:test';
import wrangler from 'wrangler';

import {
  d1CreateInsumo,
  d1EntradaBaixa,
  d1ExecuteIdempotent,
  d1GerarSugestoesReposicao,
  d1DismissSugestaoReposicao,
  d1ListSugestoesReposicao,
  d1UpsertPoliticaReposicao,
} from '../src/d1Store.js';
import { handleInsumosRoutes } from '../src/routes/insumos.js';
import { buildBackupPayload } from '../src/services/backup.js';

const { getPlatformProxy } = wrangler;
const UNIT_NH = 'novo-hamburgo';
const UNIT_BSS = 'barra-shopping-sul';
const UNITS = [UNIT_NH, UNIT_BSS];
const MANAGER = { username: 'replenishment-manager', role: 'GESTOR', allowedUnits: UNITS };
const OPERATOR = { username: 'replenishment-operator', role: 'OPERADOR', allowedUnits: UNITS };
const NH_ONLY = { username: 'replenishment-nh-only', role: 'GESTOR', allowedUnits: [UNIT_NH] };
const BSS_ONLY = { username: 'replenishment-bss-only', role: 'GESTOR', allowedUnits: [UNIT_BSS] };

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
    '0023_insumos_replenishment.sql',
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
  const codigoBarras = code || `REPL-${sequence}`;
  const produto = `Produto de reposição ${sequence}`;
  const created = await d1CreateInsumo({
    env,
    unidades: UNITS,
    unidade: UNIT_NH,
    actor: MANAGER,
    body: {
      codigoBarras: code || `REPL-${sequence}`,
      produto,
      lote: `REPL-LOT-${sequence}`,
      dataValidade: '2099-12-31',
      estoqueInicial: 0,
      policyRequiresLot: true,
      policyRequiresExpiry: true,
    },
  });
  return { ...created, codigoBarras, produto };
}

before(async () => {
  proxy = await getPlatformProxy({ configPath: fileURLToPath(new URL('../wrangler.toml', import.meta.url)), persist: false, remoteBindings: false });
  env = { DB: proxy.env.DB };
  db = env.DB;
  await applyTestSchema(db);
});

after(async () => { await proxy?.dispose?.(); });

test('policies are manager-only, unit-scoped and actor-derived', async () => {
  const item = await createItem(`REPL-POLICY-${Date.now()}`);
  const deniedRole = await d1UpsertPoliticaReposicao({
    env, unidade: UNIT_NH, actor: OPERATOR,
    body: { registro: item.registro, estoqueMinimo: 2, estoqueAlvo: 5, createdBy: 'spoofed' },
  });
  assert.equal(deniedRole.code, 'PROCUREMENT_ROLE_DENIED');
  const deniedUnit = await d1UpsertPoliticaReposicao({
    env, unidade: UNIT_NH, actor: BSS_ONLY,
    body: { registro: item.registro, estoqueMinimo: 2, estoqueAlvo: 5 },
  });
  assert.equal(deniedUnit.code, 'RBAC_UNIT_DENIED');
  const policyRouteRequest = new Request(`https://inventory.test/insumos/reposicao/politicas?unidade=${UNIT_NH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ registro: item.registro, estoqueMinimo: 1, estoqueAlvo: 3, createdBy: 'spoofed' }),
  });
  const policyRouteResponse = await handleInsumosRoutes({
    request: policyRouteRequest,
    url: new URL(policyRouteRequest.url),
    env,
    ctx: { waitUntil: () => {} },
    appOrigin: 'https://crm.skincos.com.br',
    withCORS: (body, init) => new Response(body, init),
    unidade: UNIT_NH,
    requireRoles: async () => ({ ok: true, user: MANAGER }),
    appendAuditLog: async () => {},
    enqueueNotificationsRefresh: async () => {},
    idempotencyKey: `policy-route-${Date.now()}`,
    d1: {
      enabled: true,
      executeIdempotent: (args) => d1ExecuteIdempotent({ env, ...args }),
      upsertPoliticaReposicao: ({ unidade, actor, body }) => d1UpsertPoliticaReposicao({ env, unidade, actor, body }),
    },
  });
  assert.equal(policyRouteResponse.status, 200);
  const policyRoutePayload = await policyRouteResponse.json();
  assert.equal(policyRoutePayload.data.createdBy, MANAGER.username);
  const saved = await d1UpsertPoliticaReposicao({
    env, unidade: UNIT_NH, actor: MANAGER,
    body: { registro: item.registro, estoqueMinimo: 2, estoqueAlvo: 5, estoqueSeguranca: 1, leadTimeDias: 4, createdBy: 'spoofed' },
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.policy.createdBy, MANAGER.username);
  assert.equal(saved.policy.estoqueSeguranca, 1);
  assert.equal(saved.policy.leadTimeDias, 4);
  const invalid = await d1UpsertPoliticaReposicao({
    env, unidade: UNIT_NH, actor: MANAGER,
    body: { registro: item.registro, estoqueMinimo: 5, estoqueAlvo: 4 },
  });
  assert.equal(invalid.code, 'REPLENISHMENT_TARGET_INVALID');
});

test('generation creates only FEFO-ready transfer/purchase drafts and is idempotent', async () => {
  const transferItem = await createItem(`REPL-TRANSFER-${Date.now()}`);
  const purchaseItem = await createItem(`REPL-PURCHASE-${Date.now()}`);
  const donorEntry = await d1EntradaBaixa({
    env, unidade: UNIT_BSS, actor: MANAGER, kind: 'ENTRADA',
    body: { codigoBarras: transferItem.codigoBarras, quantidade: 10, observacoes: 'estoque doador de teste' },
  });
  assert.equal(donorEntry.ok, true);
  await d1UpsertPoliticaReposicao({
    env, unidade: UNIT_NH, actor: MANAGER,
    body: { registro: transferItem.registro, estoqueMinimo: 3, estoqueAlvo: 8, estoqueSeguranca: 1, leadTimeDias: 2 },
  });
  await d1UpsertPoliticaReposicao({
    env, unidade: UNIT_NH, actor: MANAGER,
    body: { registro: purchaseItem.registro, estoqueMinimo: 4, estoqueAlvo: 7, estoqueSeguranca: 1, leadTimeDias: 6 },
  });
  const movementsBefore = Number((await rows('SELECT COUNT(1) AS n FROM insumos_movements'))[0].n);
  const transfersBefore = Number((await rows('SELECT COUNT(1) AS n FROM insumos_transfers'))[0].n);
  const purchasesBefore = Number((await rows('SELECT COUNT(1) AS n FROM insumos_purchase_orders'))[0].n);
  const command = {
    unidade: UNIT_NH,
    actor: MANAGER.username,
    body: {},
  };
  const idempotencyKey = `replenishment-${Date.now()}`;
  const first = await d1ExecuteIdempotent({
    env, actor: MANAGER, action: 'REPLENISHMENT_SUGGESTIONS_GENERATE',
    idempotencyKey, command,
    execute: () => d1GerarSugestoesReposicao({ env, unidade: UNIT_NH, actor: MANAGER }),
  });
  const replay = await d1ExecuteIdempotent({
    env, actor: MANAGER, action: 'REPLENISHMENT_SUGGESTIONS_GENERATE',
    idempotencyKey, command,
    execute: () => d1GerarSugestoesReposicao({ env, unidade: UNIT_NH, actor: MANAGER }),
  });
  assert.equal(first.result.ok, true);
  assert.equal(replay.replayed, true);
  const generated = first.result.generated.filter((row) => [transferItem.registro, purchaseItem.registro].includes(row.registro));
  assert.equal(generated.length, 2);
  const transfer = generated.find((row) => row.registro === transferItem.registro);
  const purchase = generated.find((row) => row.registro === purchaseItem.registro);
  assert.equal(transfer.tipo, 'TRANSFER_DRAFT');
  assert.equal(transfer.quantidade, 8);
  assert.equal(transfer.unidadeOrigem, UNIT_BSS);
  assert.equal(transfer.draft.prontaParaExecucao, false);
  assert.equal(purchase.tipo, 'PURCHASE_DRAFT');
  assert.equal(purchase.quantidade, 7);
  assert.equal(purchase.draft.prontaParaExecucao, false);
  assert.equal(purchase.draft.status, 'DRAFT');
  assert.equal(Number((await rows('SELECT COUNT(1) AS n FROM insumos_movements'))[0].n), movementsBefore);
  assert.equal(Number((await rows('SELECT COUNT(1) AS n FROM insumos_transfers'))[0].n), transfersBefore);
  assert.equal(Number((await rows('SELECT COUNT(1) AS n FROM insumos_purchase_orders'))[0].n), purchasesBefore);
  const listed = await d1ListSugestoesReposicao({ env, unidade: UNIT_NH, actor: OPERATOR, status: 'DRAFT' });
  assert.equal(listed.items.some((row) => row.id === transfer.id), true);
  const routeRequest = new Request(`https://inventory.test/insumos/reposicao/sugestoes?unidade=${UNIT_NH}&status=DRAFT`, { method: 'GET' });
  const routeResponse = await handleInsumosRoutes({
    request: routeRequest,
    url: new URL(routeRequest.url),
    env,
    ctx: { waitUntil: () => {} },
    appOrigin: 'https://crm.skincos.com.br',
    withCORS: (body, init) => new Response(body, init),
    unidade: UNIT_NH,
    requireRoles: async () => ({ ok: true, user: OPERATOR }),
    appendAuditLog: async () => {},
    enqueueNotificationsRefresh: async () => {},
    d1: {
      enabled: true,
      listSugestoesReposicao: ({ unidade, actor, status }) => d1ListSugestoesReposicao({ env, unidade, actor, status }),
    },
  });
  assert.equal(routeResponse.status, 200);
  assert.equal((await routeResponse.json()).success, true);
  const dismissed = await d1DismissSugestaoReposicao({ env, id: transfer.id, unidade: UNIT_NH, actor: MANAGER, justificativa: 'Não executar neste ciclo' });
  assert.equal(dismissed.suggestion.status, 'DISMISSED');
  const missingReason = await d1DismissSugestaoReposicao({ env, id: purchase.id, unidade: UNIT_NH, actor: MANAGER, justificativa: '' });
  assert.equal(missingReason.code, 'DISMISS_REASON_REQUIRED');
  assert.equal((await rows('SELECT COUNT(1) AS n FROM insumos_replenishment_suggestions WHERE id = ?', transfer.id))[0].n, 1);
  const backup = await buildBackupPayload({ env });
  assert.equal(backup.d1.insumosReplenishmentPolicies.some((row) => row.registroInsumo === transferItem.registro), true);
  assert.equal(backup.d1.insumosReplenishmentSuggestions.some((row) => row.id === transfer.id), true);
});

test('a manager scoped to one unit cannot discover donor stock in another unit', async () => {
  const item = await createItem(`REPL-SCOPE-${Date.now()}`);
  await d1EntradaBaixa({ env, unidade: UNIT_BSS, actor: MANAGER, kind: 'ENTRADA', body: { codigoBarras: item.codigoBarras || '', quantidade: 9 } });
  await d1UpsertPoliticaReposicao({ env, unidade: UNIT_NH, actor: MANAGER, body: { registro: item.registro, estoqueMinimo: 2, estoqueAlvo: 5, estoqueSeguranca: 0 } });
  const result = await d1GerarSugestoesReposicao({ env, unidade: UNIT_NH, actor: NH_ONLY });
  assert.equal(result.ok, true);
  const suggestion = result.generated.find((row) => row.registro === item.registro);
  assert.equal(suggestion.tipo, 'PURCHASE_DRAFT');
  assert.equal(suggestion.unidadeOrigem, null);
});

test('negative governed balance increases the calculated purchase shortage', async () => {
  const item = await createItem(`REPL-NEGATIVE-${Date.now()}`);
  const output = await d1EntradaBaixa({
    env, unidade: UNIT_NH, actor: MANAGER, kind: 'BAIXA',
    body: { codigoBarras: item.codigoBarras, quantidade: 2, justificativa: 'Divergência operacional autorizada' },
  });
  assert.equal(output.ok, true);
  assert.equal(output.negativeOverride, true);
  await d1UpsertPoliticaReposicao({
    env, unidade: UNIT_NH, actor: MANAGER,
    body: { registro: item.registro, estoqueMinimo: 1, estoqueAlvo: 4, estoqueSeguranca: 0, leadTimeDias: 9 },
  });
  const generated = await d1GerarSugestoesReposicao({ env, unidade: UNIT_NH, actor: MANAGER });
  const suggestion = generated.generated.find((row) => row.registro === item.registro);
  assert.equal(suggestion.tipo, 'PURCHASE_DRAFT');
  assert.equal(suggestion.saldoAtual, 0);
  assert.equal(suggestion.draft.saldoContabilAtual, -2);
  assert.equal(suggestion.quantidade, 6);
  assert.equal(suggestion.leadTimeDias, 9);
});
