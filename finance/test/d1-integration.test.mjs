import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare } from 'miniflare';
import { createFinanceHandler } from '../api/worker.js';

const migrations = await Promise.all(['0001_finance_foundation.sql', '0002_finance_operational_core.sql', '0003_finance_integrity_guards.sql'].map(async (file) => (await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8')).replace(/^--.*$/gm, '')));
const handler = createFinanceHandler();
const scopeNh = 'finance-scope-novo-hamburgo';
const scopeBss = 'finance-scope-barra-shopping-sul';
const scopePersonal = 'finance-scope-personal';

function sqlStatements(migration) {
  const statements = []; let buffer = ''; let trigger = false;
  for (const line of migration.split(/\r?\n/)) {
    const trimmed = line.trim(); if (!trimmed) continue; buffer += `${line}\n`;
    if (/^CREATE\s+TRIGGER\b/i.test(trimmed)) trigger = true;
    if ((trigger && (/^END;\s*$/i.test(trimmed) || (/\bBEGIN\b/i.test(trimmed) && /\bEND;\s*$/i.test(trimmed)))) || (!trigger && /;\s*$/.test(trimmed))) { statements.push(buffer.trim()); buffer = ''; trigger = false; }
  }
  if (buffer.trim()) throw new Error(`Unterminated migration statement: ${buffer}`);
  return statements;
}

async function fixture({ enabled = true, actor = { username: 'pilot', allowedModules: ['finance'] } } = {}) {
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok") } }', compatibilityDate: '2024-11-20', d1Databases: ['DB'] });
  const DB = await mf.getD1Database('DB');
  for (const migration of migrations) for (const statement of sqlStatements(migration)) { try { await DB.prepare(statement).run(); } catch (error) { throw new Error(`${error.message}\nSQL:\n${statement}`); } }
  await DB.prepare(`UPDATE finance_settings SET value=? WHERE key='module_enabled'`).bind(enabled ? 'true' : 'false').run();
  return { mf, DB, env: { DB }, actor };
}

async function grant(DB, username, scopeId, permission = 'operator') {
  await DB.prepare(`INSERT INTO finance_access_grants(id,username,scope_id,permission,created_at) VALUES(?,?,?,?,?)`).bind(crypto.randomUUID(), username, scopeId, permission, new Date().toISOString()).run();
}

async function request(env, actor, path, { method = 'GET', body, key = 'key' } = {}) {
  const url = new URL(`https://api.skincos.com.br/finance${path}`);
  const headers = new Headers({ 'x-request-id': 'finance-d1-test' });
  if (method !== 'GET') { headers.set('content-type', 'application/json'); headers.set('idempotency-key', key); }
  const response = await handler(new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined }), env, {}, { actor });
  return { response, body: await response.json() };
}

async function account(env, actor, scopeId, name, key) {
  const result = await request(env, actor, `/accounts?scopeId=${scopeId}`, { method: 'POST', key, body: { name, type: 'bank', currency: 'BRL' } });
  assert.equal(result.response.status, 201, JSON.stringify(result.body)); return result.body.account;
}

async function category(env, actor, scopeId, name, direction, key, parentId) {
  const result = await request(env, actor, `/categories?scopeId=${scopeId}`, { method: 'POST', key, body: { name, direction, parentId } });
  assert.equal(result.response.status, 201, JSON.stringify(result.body)); return result.body.category;
}

test('D1 local: flag, module and grants deny before domain data is exposed', async (t) => {
  const disabled = await fixture({ enabled: false }); t.after(() => disabled.mf.dispose());
  let result = await request(disabled.env, disabled.actor, `/overview?scopeId=${scopeNh}`);
  assert.equal(result.response.status, 423);

  const noModule = await fixture({ actor: { username: 'pilot', allowedModules: [] } }); t.after(() => noModule.mf.dispose());
  result = await request(noModule.env, noModule.actor, '/bootstrap');
  assert.equal(result.response.status, 403);

  const noGrant = await fixture(); t.after(() => noGrant.mf.dispose());
  result = await request(noGrant.env, noGrant.actor, '/bootstrap');
  assert.equal(result.response.status, 200); assert.equal(result.body.canAccess, false);
  result = await request(noGrant.env, noGrant.actor, `/overview?scopeId=${scopeNh}`);
  assert.equal(result.response.status, 403);
});

test('D1 local: a one-unit grant cannot read another unit or the inactive personal context', async (t) => {
  const ctx = await fixture(); t.after(() => ctx.mf.dispose()); await grant(ctx.DB, 'pilot', scopeNh);
  const authorized = await request(ctx.env, ctx.actor, `/overview?scopeId=${scopeNh}`);
  assert.equal(authorized.response.status, 200, JSON.stringify(authorized.body));
  assert.equal((await request(ctx.env, ctx.actor, `/overview?scopeId=${scopeBss}`)).response.status, 403);
  assert.equal((await request(ctx.env, ctx.actor, `/overview?scopeId=${scopePersonal}`)).response.status, 403);
  assert.equal((await request(ctx.env, ctx.actor, `/movements?scopeId=${scopeBss}&accountId=forged`)).response.status, 403);
});

test('D1 local: idempotency replays only the identical actor/route payload and rejects conflicts', async (t) => {
  const ctx = await fixture(); t.after(() => ctx.mf.dispose()); await grant(ctx.DB, 'pilot', scopeNh);
  const first = await request(ctx.env, ctx.actor, `/accounts?scopeId=${scopeNh}`, { method: 'POST', key: 'account-key', body: { name: 'Banco', type: 'bank', currency: 'BRL' } });
  const second = await request(ctx.env, ctx.actor, `/accounts?scopeId=${scopeNh}`, { method: 'POST', key: 'account-key', body: { name: 'Banco', type: 'bank', currency: 'BRL' } });
  const conflict = await request(ctx.env, ctx.actor, `/accounts?scopeId=${scopeNh}`, { method: 'POST', key: 'account-key', body: { name: 'Outro banco', type: 'bank', currency: 'BRL' } });
  assert.equal(first.response.status, 201); assert.equal(second.response.status, 201); assert.equal(second.body.replayed, true);
  assert.equal(first.body.account.id, second.body.account.id); assert.equal(conflict.response.status, 409);
});

test('D1 local: transfer posts a balanced journal and an invalid income cannot be unbalanced', async (t) => {
  const ctx = await fixture(); t.after(() => ctx.mf.dispose()); await grant(ctx.DB, 'pilot', scopeNh);
  const source = await account(ctx.env, ctx.actor, scopeNh, 'Caixa', 'source'); const destination = await account(ctx.env, ctx.actor, scopeNh, 'Banco', 'destination');
  const transfer = await request(ctx.env, ctx.actor, `/movements?scopeId=${scopeNh}`, { method: 'POST', key: 'transfer', body: { type: 'transfer', accountId: source.id, destinationAccountId: destination.id, description: 'Aporte', amountMinor: 2500, currency: 'BRL', competenceDate: '2026-07-21' } });
  assert.equal(transfer.response.status, 201, JSON.stringify(transfer.body));
  const journal = await ctx.DB.prepare(`SELECT direction, amount_minor FROM finance_journal_lines`).all();
  assert.equal(journal.results.filter((line) => line.direction === 'debit').reduce((sum, line) => sum + line.amount_minor, 0), 2500);
  assert.equal(journal.results.filter((line) => line.direction === 'credit').reduce((sum, line) => sum + line.amount_minor, 0), 2500);
  const invalid = await request(ctx.env, ctx.actor, `/movements?scopeId=${scopeNh}`, { method: 'POST', key: 'invalid-income', body: { type: 'income', accountId: source.id, description: 'Sem categoria', amountMinor: 1, currency: 'BRL', competenceDate: '2026-07-21' } });
  assert.equal(invalid.response.status, 400);
});

test('D1 local: audit is immutable and CSV reimports are explicitly deduplicated', async (t) => {
  const ctx = await fixture(); t.after(() => ctx.mf.dispose()); await grant(ctx.DB, 'pilot', scopeNh);
  await account(ctx.env, ctx.actor, scopeNh, 'Banco', 'account');
  const csv = 'data,descricao,valor,tipo\n2026-07-21,Teste,10.00,receita\n';
  const first = await request(ctx.env, ctx.actor, `/imports?scopeId=${scopeNh}`, { method: 'POST', key: 'file-one', body: { filename: 'one.csv', csv } });
  const repeat = await request(ctx.env, ctx.actor, `/imports?scopeId=${scopeNh}`, { method: 'POST', key: 'file-two', body: { filename: 'two.csv', csv } });
  assert.equal(first.response.status, 201, JSON.stringify(first.body)); assert.equal(repeat.body.alreadyStaged, true);
  await assert.rejects(ctx.DB.exec(`UPDATE finance_audit_events SET action='tampered'`), /append-only/);
  const secondFileSameRow = await request(ctx.env, ctx.actor, `/imports?scopeId=${scopeNh}`, { method: 'POST', key: 'file-three', body: { filename: 'three.csv', csv: `data,descricao,valor,tipo,nota\n2026-07-21,Teste,10.00,receita,x\n` } });
  assert.equal(secondFileSameRow.response.status, 201);
  const duplicates = await ctx.DB.prepare(`SELECT COUNT(*) count FROM finance_import_duplicate_candidates`).first();
  assert.equal(Number(duplicates.count), 1);
});

test('D1 local: splits, base currency, installments and operational lifecycle remain traceable', async (t) => {
  const ctx = await fixture(); t.after(() => ctx.mf.dispose()); await grant(ctx.DB, 'pilot', scopeNh);
  const bank = await account(ctx.env, ctx.actor, scopeNh, 'Conta EUR', 'bank-eur');
  const service = await category(ctx.env, ctx.actor, scopeNh, 'Serviços', 'income', 'category-service');
  const retail = await category(ctx.env, ctx.actor, scopeNh, 'Varejo', 'income', 'category-retail');
  const created = await request(ctx.env, ctx.actor, `/movements?scopeId=${scopeNh}`, { method: 'POST', key: 'split-pending', body: {
    type: 'income', accountId: bank.id, description: 'Receita parcelada', amountMinor: 10000, currency: 'EUR', baseCurrency: 'BRL', baseAmountMinor: 62000, exchangeRatePpm: 6200000,
    competenceDate: '2026-07-21', operationalStatus: 'pending', splits: [
      { categoryId: service.id, amountMinor: 4000, baseAmountMinor: 24800 }, { categoryId: retail.id, amountMinor: 6000, baseAmountMinor: 37200 },
    ], installments: [{ dueDate: '2026-08-01', amountMinor: 5000 }, { dueDate: '2026-09-01', amountMinor: 5000 }],
  } });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const movementId = created.body.movement.id;
  const detail = await request(ctx.env, ctx.actor, `/movements/${movementId}?scopeId=${scopeNh}`);
  assert.equal(detail.response.status, 200); assert.equal(detail.body.splits.length, 2); assert.equal(detail.body.installments.length, 2); assert.equal(detail.body.movement.base_currency, 'BRL');
  assert.equal((await request(ctx.env, ctx.actor, `/movements/${movementId}/confirm?scopeId=${scopeNh}`, { method: 'POST', key: 'confirm-pending', body: {} })).response.status, 201);
  assert.equal((await request(ctx.env, ctx.actor, `/installments/${detail.body.installments[0].id}/pay?scopeId=${scopeNh}`, { method: 'POST', key: 'pay-installment', body: { paidDate: '2026-08-01' } })).response.status, 201);
  assert.equal((await request(ctx.env, ctx.actor, `/movements/${movementId}/reconcile?scopeId=${scopeNh}`, { method: 'POST', key: 'reconcile', body: {} })).response.status, 201);
  const reversal = await request(ctx.env, ctx.actor, `/movements/${movementId}/reverse?scopeId=${scopeNh}`, { method: 'POST', key: 'reverse', body: { reason: 'Correção documentada' } });
  assert.equal(reversal.response.status, 201, JSON.stringify(reversal.body));
  const reversed = await request(ctx.env, ctx.actor, `/movements/${movementId}?scopeId=${scopeNh}`);
  assert.equal(reversed.body.movement.operational_status, 'cancelled');
  const reversalLines = await ctx.DB.prepare(`SELECT direction,amount_minor FROM finance_reversal_lines`).all();
  assert.equal(reversalLines.results.reduce((sum, line) => sum + line.amount_minor, 0), 20_000);
  await assert.rejects(ctx.DB.exec(`UPDATE finance_movement_revisions SET kind='tampered'`), /append-only/);
});

test('D1 local: scope and monetary safeguards reject cross-scope, unbalanced and reused cross-scope operations', async (t) => {
  const ctx = await fixture(); t.after(() => ctx.mf.dispose()); await grant(ctx.DB, 'pilot', scopeNh); await grant(ctx.DB, 'pilot', scopeBss);
  const nhAccount = await account(ctx.env, ctx.actor, scopeNh, 'NH Banco', 'nh-account'); const bssAccount = await account(ctx.env, ctx.actor, scopeBss, 'BSS Banco', 'bss-account');
  const nhCategory = await category(ctx.env, ctx.actor, scopeNh, 'NH Receita', 'income', 'nh-category');
  const cross = await request(ctx.env, ctx.actor, `/movements?scopeId=${scopeNh}`, { method: 'POST', key: 'cross-account', body: { type: 'transfer', accountId: nhAccount.id, destinationAccountId: bssAccount.id, description: 'Proibido', amountMinor: 1, currency: 'BRL', competenceDate: '2026-07-21' } });
  assert.equal(cross.response.status, 400);
  const fractional = await request(ctx.env, ctx.actor, `/movements?scopeId=${scopeNh}`, { method: 'POST', key: 'fractional', body: { type: 'income', accountId: nhAccount.id, categoryId: nhCategory.id, description: 'Proibido', amountMinor: 1.5, currency: 'BRL', competenceDate: '2026-07-21' } });
  assert.equal(fractional.response.status, 400);
  const badSplit = await request(ctx.env, ctx.actor, `/movements?scopeId=${scopeNh}`, { method: 'POST', key: 'bad-split', body: { type: 'income', accountId: nhAccount.id, description: 'Split inválido', amountMinor: 100, currency: 'BRL', competenceDate: '2026-07-21', splits: [{ categoryId: nhCategory.id, amountMinor: 99 }] } });
  assert.equal(badSplit.response.status, 400);
  const first = await request(ctx.env, ctx.actor, `/accounts?scopeId=${scopeNh}`, { method: 'POST', key: 'cross-scope-key', body: { name: 'Chave NH', type: 'cash', currency: 'BRL' } });
  const reused = await request(ctx.env, ctx.actor, `/accounts?scopeId=${scopeBss}`, { method: 'POST', key: 'cross-scope-key', body: { name: 'Chave NH', type: 'cash', currency: 'BRL' } });
  assert.equal(first.response.status, 201); assert.equal(reused.response.status, 409);
  const filtered = await request(ctx.env, ctx.actor, `/movements?scopeId=${scopeNh}&accountId=${bssAccount.id}`);
  assert.equal(filtered.response.status, 200); assert.equal(filtered.body.movements.length, 0);
});
