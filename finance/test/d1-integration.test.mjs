import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare } from 'miniflare';
import { createFinanceHandler } from '../api/worker.js';

const migrations = await Promise.all(['0001_finance_foundation.sql', '0002_finance_operational_core.sql', '0003_finance_integrity_guards.sql', '0004_finance_csv_import_workflow.sql', '0005_finance_moneywiz_adapter.sql', '0006_finance_ef_caixa_adapter.sql', '0007_finance_security_integrity.sql', '0008_finance_draft_revision.sql', '0009_finance_registration_lifecycle.sql', '0010_finance_reconciliation_workflow.sql', '0011_finance_obligations.sql'].map(async (file) => (await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8')).replace(/^--.*$/gm, '')));
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
  await grant(ctx.DB, 'pilot', scopePersonal);
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

test('D1 local: registrations are archived instead of deleted and stay isolated by scope', async (t) => {
  const ctx = await fixture(); t.after(() => ctx.mf.dispose()); await grant(ctx.DB, 'pilot', scopeNh); await grant(ctx.DB, 'pilot', scopeBss);
  const archived = await account(ctx.env, ctx.actor, scopeNh, 'Conta encerrada', 'archive-account');
  const result = await request(ctx.env, ctx.actor, `/accounts/${archived.id}/archive?scopeId=${scopeNh}`, { method: 'POST', key: 'archive-account', body: {} });
  assert.equal(result.response.status, 201, JSON.stringify(result.body)); assert.equal(result.body.active, false);
  const list = await request(ctx.env, ctx.actor, `/accounts?scopeId=${scopeNh}`); assert.equal(list.body.accounts.some((row) => row.id === archived.id), false);
  const ledger = await ctx.DB.prepare(`SELECT active FROM finance_ledger_accounts WHERE id=?`).bind(archived.ledgerAccountId).first(); assert.equal(Number(ledger.active), 0);
  assert.equal((await request(ctx.env, ctx.actor, `/accounts/${archived.id}/restore?scopeId=${scopeBss}`, { method: 'POST', key: 'cross-archive', body: {} })).response.status, 404);
  await assert.rejects(ctx.DB.prepare(`DELETE FROM finance_accounts WHERE id=?`).bind(archived.id).run(), /archived, not deleted/);
  const restored = await request(ctx.env, ctx.actor, `/accounts/${archived.id}/restore?scopeId=${scopeNh}`, { method: 'POST', key: 'restore-account', body: {} }); assert.equal(restored.response.status, 201); assert.equal(restored.body.active, true);
  const audit = await request(ctx.env, ctx.actor, `/audit?scopeId=${scopeNh}&entityId=${archived.id}&entityType=account`); assert.equal(audit.body.events.some((event) => event.action === 'ACCOUNT_ARCHIVED'), true); assert.equal(audit.body.events.some((event) => event.action === 'ACCOUNT_RESTORED'), true);
});

test('D1 local: reconciliation lines, exact suggestions and confirmations are scoped, balanced and auditable', async (t) => {
  const ctx = await fixture(); t.after(() => ctx.mf.dispose()); await grant(ctx.DB, 'pilot', scopeNh); await grant(ctx.DB, 'pilot', scopeBss);
  const bank = await account(ctx.env, ctx.actor, scopeNh, 'Banco conciliado', 'reconciliation-bank'); const income = await category(ctx.env, ctx.actor, scopeNh, 'Receita conciliada', 'income', 'reconciliation-income'); const expense = await category(ctx.env, ctx.actor, scopeNh, 'Despesa conciliada', 'expense', 'reconciliation-expense');
  const incoming = await request(ctx.env, ctx.actor, `/movements?scopeId=${scopeNh}`, { method: 'POST', key: 'reconciliation-income-movement', body: { type: 'income', accountId: bank.id, categoryId: income.id, description: 'Recebimento extrato', amountMinor: 1250, currency: 'BRL', competenceDate: '2026-08-01' } }); assert.equal(incoming.response.status, 201, JSON.stringify(incoming.body));
  const outgoing = await request(ctx.env, ctx.actor, `/movements?scopeId=${scopeNh}`, { method: 'POST', key: 'reconciliation-expense-movement', body: { type: 'expense', accountId: bank.id, categoryId: expense.id, description: 'Pagamento extrato', amountMinor: 700, currency: 'BRL', competenceDate: '2026-08-02' } }); assert.equal(outgoing.response.status, 201, JSON.stringify(outgoing.body));
  const line = await request(ctx.env, ctx.actor, `/reconciliation/lines?scopeId=${scopeNh}`, { method: 'POST', key: 'reconciliation-line', body: { accountId: bank.id, postedDate: '2026-08-01', amountMinor: 1250, currency: 'BRL', description: 'Recebimento no banco', externalId: 'statement-001' } }); assert.equal(line.response.status, 201, JSON.stringify(line.body));
  const duplicate = await request(ctx.env, ctx.actor, `/reconciliation/lines?scopeId=${scopeNh}`, { method: 'POST', key: 'reconciliation-line-duplicate', body: { accountId: bank.id, postedDate: '2026-08-01', amountMinor: 1250, currency: 'BRL', externalId: 'statement-001' } }); assert.equal(duplicate.response.status, 409);
  const suggestions = await request(ctx.env, ctx.actor, `/reconciliation/lines/${line.body.line.id}/suggestions?scopeId=${scopeNh}`, { method: 'POST', key: 'reconciliation-suggest', body: {} }); assert.equal(suggestions.response.status, 201, JSON.stringify(suggestions.body)); assert.deepEqual(suggestions.body.suggestedMovementIds, [incoming.body.movement.id]);
  const mismatch = await request(ctx.env, ctx.actor, `/reconciliation/lines/${line.body.line.id}/matches?scopeId=${scopeNh}`, { method: 'POST', key: 'reconciliation-mismatch', body: { movementId: outgoing.body.movement.id, decision: 'confirm' } }); assert.equal(mismatch.response.status, 400);
  const confirmed = await request(ctx.env, ctx.actor, `/reconciliation/lines/${line.body.line.id}/matches?scopeId=${scopeNh}`, { method: 'POST', key: 'reconciliation-confirm', body: { movementId: incoming.body.movement.id, decision: 'confirm' } }); assert.equal(confirmed.response.status, 201, JSON.stringify(confirmed.body));
  const movement = await request(ctx.env, ctx.actor, `/movements/${incoming.body.movement.id}?scopeId=${scopeNh}`); assert.equal(movement.body.movement.operational_status, 'reconciled');
  const listed = await request(ctx.env, ctx.actor, `/reconciliation/lines?scopeId=${scopeNh}&accountId=${bank.id}`); assert.equal(listed.body.lines[0].matches[0].status, 'confirmed');
  const audit = await request(ctx.env, ctx.actor, `/audit?scopeId=${scopeNh}&entityId=${confirmed.body.matchId}&entityType=reconciliation_match`); assert.equal(audit.body.events.some((event) => event.action === 'RECONCILIATION_MATCH_CONFIRMED'), true);
  assert.equal((await request(ctx.env, ctx.actor, `/reconciliation/lines/${line.body.line.id}/suggestions?scopeId=${scopeBss}`, { method: 'POST', key: 'reconciliation-cross-scope', body: {} })).response.status, 404);
  await assert.rejects(ctx.DB.prepare(`DELETE FROM finance_reconciliation_lines WHERE id=?`).bind(line.body.line.id).run(), /append-only/);
});

test('D1 local: concurrent identical idempotency keys converge on one persisted operation', async (t) => {
  const ctx = await fixture(); t.after(() => ctx.mf.dispose()); await grant(ctx.DB, 'pilot', scopeNh);
  const payload = { name: 'Conta concorrente', type: 'bank', currency: 'BRL' };
  const [left, right] = await Promise.all([
    request(ctx.env, ctx.actor, `/accounts?scopeId=${scopeNh}`, { method: 'POST', key: 'concurrent-account', body: payload }),
    request(ctx.env, ctx.actor, `/accounts?scopeId=${scopeNh}`, { method: 'POST', key: 'concurrent-account', body: payload }),
  ]);
  assert.equal(left.response.status, 201, JSON.stringify(left.body)); assert.equal(right.response.status, 201, JSON.stringify(right.body));
  assert.equal(left.body.account.id, right.body.account.id);
  const persisted = await ctx.DB.prepare(`SELECT COUNT(*) count FROM finance_accounts WHERE scope_id=? AND name=?`).bind(scopeNh, 'Conta concorrente').first();
  assert.equal(Number(persisted.count), 1);
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
  const secondFileSameRow = await request(ctx.env, ctx.actor, `/imports?scopeId=${scopeNh}`, { method: 'POST', key: 'file-three', body: { filename: 'three.csv', csv: `data,descricao,valor,tipo,conta\n2026-07-21,Teste,10.00,receita,\n` } });
  assert.equal(secondFileSameRow.response.status, 201);
  const duplicates = await ctx.DB.prepare(`SELECT COUNT(*) count FROM finance_import_duplicate_candidates`).first();
  assert.equal(Number(duplicates.count), 1);
});

test('D1 local: CSV workflow retains source, maps Brazilian rows, records decisions, commits idempotently and undoes by reversal', async (t) => {
  const ctx = await fixture(); t.after(() => ctx.mf.dispose()); await grant(ctx.DB, 'pilot', scopeNh);
  const bank = await account(ctx.env, ctx.actor, scopeNh, 'Banco NH', 'csv-bank'); const clearing = await account(ctx.env, ctx.actor, scopeNh, 'Cartão', 'csv-clearing');
  const income = await category(ctx.env, ctx.actor, scopeNh, 'Receitas', 'income', 'csv-income'); const expense = await category(ctx.env, ctx.actor, scopeNh, 'Despesas', 'expense', 'csv-expense');
  const csv = 'Data;Descrição;Valor;Conta;Categoria;Moeda;Observação;Identificador Externo\n01/07/2026;Consulta estética;1.250,50;Banco NH;Receitas;BRL;Pagamento cartão;ef-1001\n02/07/2026;Transferência;-200,00;Cartão;Despesas;BRL;Mover saldo;ef-1002\n02/07/2026;Transferência;-200,00;Cartão;Despesas;BRL;Mover saldo;ef-1002\n';
  const staged = await request(ctx.env, ctx.actor, `/imports?scopeId=${scopeNh}`, { method: 'POST', key: 'csv-stage', body: { filename: 'extrato-br.csv', csv, encoding: 'utf-8' } });
  assert.equal(staged.response.status, 201, JSON.stringify(staged.body)); assert.equal(staged.body.analysis.delimiter, ';'); assert.equal(staged.body.analysis.dateFormat, 'DD/MM/YYYY');
  let loaded = await request(ctx.env, ctx.actor, `/imports/${staged.body.batchId}?scopeId=${scopeNh}`); assert.equal(loaded.body.batch.source_csv, undefined); assert.equal(loaded.body.batch.sourceRetained, true); assert.equal(loaded.body.rows.filter((row) => row.status === 'exact_duplicate').length, 1);
  const transferRow = loaded.body.rows.find((row) => JSON.parse(row.normalized_json || '{}').description === 'Transferência' && row.status === 'valid');
  const decision = await request(ctx.env, ctx.actor, `/imports/${staged.body.batchId}/decisions?scopeId=${scopeNh}`, { method: 'POST', key: 'csv-decision', body: { rowId: transferRow.id, decision: 'import', transferAccountId: clearing.id } });
  assert.equal(decision.response.status, 201, JSON.stringify(decision.body));
  const committed = await request(ctx.env, ctx.actor, `/imports/${staged.body.batchId}/commit?scopeId=${scopeNh}`, { method: 'POST', key: 'csv-commit', body: { defaultAccountId: bank.id, incomeCategoryId: income.id, expenseCategoryId: expense.id } });
  assert.equal(committed.response.status, 201, JSON.stringify(committed.body)); assert.equal(committed.body.committed, 2);
  const replay = await request(ctx.env, ctx.actor, `/imports/${staged.body.batchId}/commit?scopeId=${scopeNh}`, { method: 'POST', key: 'csv-commit', body: { defaultAccountId: bank.id, incomeCategoryId: income.id, expenseCategoryId: expense.id } }); assert.equal(replay.body.replayed, true);
  loaded = await request(ctx.env, ctx.actor, `/imports/${staged.body.batchId}?scopeId=${scopeNh}`); assert.equal(loaded.body.decisions.length, 1); assert.equal(loaded.body.rows.filter((row) => row.status === 'committed').length, 2);
  const undo = await request(ctx.env, ctx.actor, `/imports/${staged.body.batchId}/undo?scopeId=${scopeNh}`, { method: 'POST', key: 'csv-undo', body: { reason: 'Arquivo incorreto' } }); assert.equal(undo.response.status, 201, JSON.stringify(undo.body));
  const movements = await ctx.DB.prepare(`SELECT operational_status FROM finance_movements WHERE source='csv'`).all(); assert.deepEqual(movements.results.map((row) => row.operational_status), ['cancelled', 'cancelled']);
  const operations = await ctx.DB.prepare(`SELECT kind FROM finance_import_operations WHERE batch_id=? ORDER BY created_at`).bind(staged.body.batchId).all(); assert.deepEqual(operations.results.map((row) => row.kind), ['commit', 'undo']);
});

test('D1 local: MoneyWiz adapter stages source metadata and transfer candidates without posting either side', async (t) => {
  const ctx = await fixture(); t.after(() => ctx.mf.dispose()); await grant(ctx.DB, 'pilot', scopeNh);
  await account(ctx.env, ctx.actor, scopeNh, 'Conta Principal', 'mw-source'); await account(ctx.env, ctx.actor, scopeNh, 'Cartão Corporativo', 'mw-destination');
  const csv = await readFile(new URL('./fixtures/moneywiz-transactions-comma.csv', import.meta.url), 'utf8');
  const staged = await request(ctx.env, ctx.actor, `/imports?scopeId=${scopeNh}`, { method: 'POST', key: 'moneywiz-stage', body: { filename: 'moneywiz.csv', csv, sourceType: 'moneywiz', encoding: 'utf-8' } });
  assert.equal(staged.response.status, 201, JSON.stringify(staged.body)); assert.equal(staged.body.analysis.sourceType, 'moneywiz');
  const loaded = await request(ctx.env, ctx.actor, `/imports/${staged.body.batchId}?scopeId=${scopeNh}`); assert.equal(loaded.body.batch.source_type, 'moneywiz'); assert.equal(loaded.body.batch.source_metadata_json.includes('transfers'), true);
  assert.equal(loaded.body.transferCandidates.length, 2); assert.equal(loaded.body.rows.filter((row) => row.status === 'exact_duplicate').length, 1); assert.equal(loaded.body.rows.filter((row) => JSON.parse(row.normalized_json || '{}').transferAccountName).every((row) => row.decision === 'review'), true);
  const ledger = await ctx.DB.prepare(`SELECT COUNT(*) count FROM finance_movements`).first(); assert.equal(Number(ledger.count), 0);
});

test('D1 local: Caixa EF delivery stays scoped, auditable, idempotent and sends cancellations to human review', async (t) => {
  const ctx = await fixture(); t.after(() => ctx.mf.dispose()); await grant(ctx.DB, 'pilot', scopeNh); await grant(ctx.DB, 'pilot', scopeBss);
  const bank = await account(ctx.env, ctx.actor, scopeNh, 'Banco NH Caixa EF', 'ef-caixa-bank'); const income = await category(ctx.env, ctx.actor, scopeNh, 'Receitas Caixa EF', 'income', 'ef-caixa-income'); const expense = await category(ctx.env, ctx.actor, scopeNh, 'Despesas Caixa EF', 'expense', 'ef-caixa-expense');
  const delivery = JSON.parse(await readFile(new URL('./fixtures/ef-caixa-delivery-nh.json', import.meta.url), 'utf8'));
  const staged = await request(ctx.env, ctx.actor, `/imports?scopeId=${scopeNh}`, { method: 'POST', key: 'ef-caixa-stage', body: { filename: 'caixa-ef.json', sourceType: 'ef-caixa', efCaixa: delivery } });
  assert.equal(staged.response.status, 201, JSON.stringify(staged.body)); assert.equal(staged.body.analysis.sourceType, 'ef-caixa');
  const loaded = await request(ctx.env, ctx.actor, `/imports/${staged.body.batchId}?scopeId=${scopeNh}`); assert.equal(loaded.body.batch.source_adapter, 'ef-caixa/v1'); assert.equal(loaded.body.batch.sourceMetadata.executionId, 'ef-run-20260731-nh'); assert.equal(loaded.body.rows.filter((row) => row.decision === 'review').length, 2);
  const cancelled = loaded.body.rows.find((row) => JSON.parse(row.normalized_json || '{}').externalId === 'ef-sale-cancelled');
  const unsafe = await request(ctx.env, ctx.actor, `/imports/${staged.body.batchId}/decisions?scopeId=${scopeNh}`, { method: 'POST', key: 'ef-caixa-cancelled', body: { rowId: cancelled.id, decision: 'import' } }); assert.equal(unsafe.response.status, 400);
  const reprocessed = await request(ctx.env, ctx.actor, `/imports?scopeId=${scopeNh}`, { method: 'POST', key: 'ef-caixa-repeat', body: { filename: 'caixa-ef-repeat.json', sourceType: 'ef-caixa', efCaixa: { ...delivery, source: { ...delivery.source, executionId: 'ef-run-reprocessed' } } } }); assert.equal(reprocessed.body.alreadyStaged, true);
  const wrongUnit = await request(ctx.env, ctx.actor, `/imports?scopeId=${scopeBss}`, { method: 'POST', key: 'ef-caixa-wrong-unit', body: { filename: 'caixa-ef.json', sourceType: 'ef-caixa', efCaixa: delivery } }); assert.equal(wrongUnit.response.status, 403);
  const ledger = await ctx.DB.prepare(`SELECT COUNT(*) count FROM finance_movements WHERE source='ef-caixa'`).first(); assert.equal(Number(ledger.count), 0);
  const committed = await request(ctx.env, ctx.actor, `/imports/${staged.body.batchId}/commit?scopeId=${scopeNh}`, { method: 'POST', key: 'ef-caixa-commit', body: { defaultAccountId: bank.id, incomeCategoryId: income.id, expenseCategoryId: expense.id } }); assert.equal(committed.response.status, 201, JSON.stringify(committed.body)); assert.equal(committed.body.committed, 1);
  const movement = await ctx.DB.prepare(`SELECT source,external_id FROM finance_movements WHERE source='ef-caixa'`).first(); assert.deepEqual(movement, { source: 'ef-caixa', external_id: 'ef-sale-1001' });
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

test('D1 local: only a pending draft can be revised atomically with an optimistic revision and audit trail', async (t) => {
  const ctx = await fixture(); t.after(() => ctx.mf.dispose()); await grant(ctx.DB, 'pilot', scopeNh);
  const bank = await account(ctx.env, ctx.actor, scopeNh, 'Banco revisável', 'draft-revision-bank');
  const originalCategory = await category(ctx.env, ctx.actor, scopeNh, 'Receita original', 'income', 'draft-revision-original');
  const revisedCategory = await category(ctx.env, ctx.actor, scopeNh, 'Receita revisada', 'income', 'draft-revision-revised');
  const created = await request(ctx.env, ctx.actor, `/movements?scopeId=${scopeNh}`, { method: 'POST', key: 'draft-revision-create', body: { type: 'income', operationalStatus: 'pending', accountId: bank.id, categoryId: originalCategory.id, description: 'Rascunho original', amountMinor: 1_000, currency: 'BRL', competenceDate: '2026-07-21', installments: [{ dueDate: '2026-08-01', amountMinor: 1_000 }] } });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const movementId = created.body.movement.id;
  const revisedPayload = { expectedRevision: 1, type: 'income', accountId: bank.id, categoryId: revisedCategory.id, description: 'Rascunho revisado', amountMinor: 2_500, currency: 'BRL', competenceDate: '2026-07-22', dueDate: '2026-08-02', installments: [{ dueDate: '2026-08-02', amountMinor: 2_500 }] };
  const revised = await request(ctx.env, ctx.actor, `/movements/${movementId}?scopeId=${scopeNh}`, { method: 'PUT', key: 'draft-revision-save', body: revisedPayload });
  assert.equal(revised.response.status, 201, JSON.stringify(revised.body)); assert.equal(revised.body.revision, 2);
  const replay = await request(ctx.env, ctx.actor, `/movements/${movementId}?scopeId=${scopeNh}`, { method: 'PUT', key: 'draft-revision-save', body: revisedPayload });
  assert.equal(replay.response.status, 201); assert.equal(replay.body.replayed, true);
  const detail = await request(ctx.env, ctx.actor, `/movements/${movementId}?scopeId=${scopeNh}`);
  assert.equal(detail.body.movement.description, 'Rascunho revisado'); assert.equal(detail.body.movement.amount_minor, 2_500); assert.equal(detail.body.movement.revision, 2); assert.equal(detail.body.splits[0].category_id, revisedCategory.id); assert.equal(detail.body.installments[0].amount_minor, 2_500);
  const stale = await request(ctx.env, ctx.actor, `/movements/${movementId}?scopeId=${scopeNh}`, { method: 'PUT', key: 'draft-revision-stale', body: revisedPayload });
  assert.equal(stale.response.status, 409); assert.equal(stale.body.error, 'DRAFT_REVISION_CONFLICT');
  const audit = await request(ctx.env, ctx.actor, `/audit?scopeId=${scopeNh}&entityId=${movementId}&entityType=movement`);
  assert.equal(audit.body.events.some((event) => event.action === 'MOVEMENT_DRAFT_REVISED'), true);
  const confirmed = await request(ctx.env, ctx.actor, `/movements/${movementId}/confirm?scopeId=${scopeNh}`, { method: 'POST', key: 'draft-revision-confirm', body: {} }); assert.equal(confirmed.response.status, 201);
  const prohibited = await request(ctx.env, ctx.actor, `/movements/${movementId}?scopeId=${scopeNh}`, { method: 'PUT', key: 'draft-revision-posted', body: { ...revisedPayload, expectedRevision: 2 } });
  assert.equal(prohibited.response.status, 400);
  await assert.rejects(ctx.DB.prepare(`UPDATE finance_movements SET description='alteração indevida' WHERE id=?`).bind(movementId).run(), /immutable/);
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
  const nhMovement = await request(ctx.env, ctx.actor, `/movements?scopeId=${scopeNh}`, { method: 'POST', key: 'nh-direct-url', body: { type: 'income', accountId: nhAccount.id, categoryId: nhCategory.id, description: 'Somente NH', amountMinor: 100, currency: 'BRL', competenceDate: '2026-07-21' } });
  assert.equal(nhMovement.response.status, 201, JSON.stringify(nhMovement.body));
  const enumerated = await request(ctx.env, ctx.actor, `/movements/${nhMovement.body.movement.id}?scopeId=${scopeBss}`);
  assert.equal(enumerated.response.status, 404);
  const first = await request(ctx.env, ctx.actor, `/accounts?scopeId=${scopeNh}`, { method: 'POST', key: 'cross-scope-key', body: { name: 'Chave NH', type: 'cash', currency: 'BRL' } });
  const reused = await request(ctx.env, ctx.actor, `/accounts?scopeId=${scopeBss}`, { method: 'POST', key: 'cross-scope-key', body: { name: 'Chave NH', type: 'cash', currency: 'BRL' } });
  assert.equal(first.response.status, 201); assert.equal(reused.response.status, 409);
  const filtered = await request(ctx.env, ctx.actor, `/movements?scopeId=${scopeNh}&accountId=${bssAccount.id}`);
  assert.equal(filtered.response.status, 200); assert.equal(filtered.body.movements.length, 0);
});

test('D1 local: unsafe metadata, oversized payloads and internal D1 failures do not leak or cross boundaries', async (t) => {
  const ctx = await fixture(); t.after(() => ctx.mf.dispose()); await grant(ctx.DB, 'pilot', scopeNh);
  const invalidAttachment = await request(ctx.env, ctx.actor, `/attachments?scopeId=${scopeNh}`, { method: 'POST', key: 'unsafe-attachment', body: { objectKey: '../other-scope/secret.pdf', filename: 'secret.pdf', contentType: 'application/pdf', sizeBytes: 1 } });
  assert.equal(invalidAttachment.response.status, 400);
  const tooLarge = await handler(new Request(`https://api.skincos.com.br/finance/accounts?scopeId=${scopeNh}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'too-large', 'content-length': String(9 * 1024 * 1024) }, body: '{}' }), ctx.env, {}, { actor: ctx.actor });
  assert.equal(tooLarge.status, 413);
  await ctx.DB.exec(`DROP TABLE finance_accounts`);
  const failed = await request(ctx.env, ctx.actor, `/accounts?scopeId=${scopeNh}`);
  assert.equal(failed.response.status, 500); assert.equal(failed.body.error, 'FINANCE_INTERNAL_ERROR'); assert.equal(failed.body.message, 'Não foi possível concluir a operação financeira.');
});

test('D1 local: failed import commit is atomic and leaves no partial ledger state', async (t) => {
  const ctx = await fixture(); t.after(() => ctx.mf.dispose()); await grant(ctx.DB, 'pilot', scopeNh);
  const bank = await account(ctx.env, ctx.actor, scopeNh, 'Banco atômico', 'atomic-bank'); const income = await category(ctx.env, ctx.actor, scopeNh, 'Receita atômica', 'income', 'atomic-income'); const expense = await category(ctx.env, ctx.actor, scopeNh, 'Despesa atômica', 'expense', 'atomic-expense');
  const csv = 'Data,Descrição,Valor,Tipo,External_ID\n2026-07-21,Primeiro,10.00,receita,external-collision\n2026-07-22,Segundo,20.00,receita,external-collision\n';
  const staged = await request(ctx.env, ctx.actor, `/imports?scopeId=${scopeNh}`, { method: 'POST', key: 'atomic-stage', body: { filename: 'atomic.csv', csv } });
  assert.equal(staged.response.status, 201, JSON.stringify(staged.body));
  const committed = await request(ctx.env, ctx.actor, `/imports/${staged.body.batchId}/commit?scopeId=${scopeNh}`, { method: 'POST', key: 'atomic-commit', body: { defaultAccountId: bank.id, incomeCategoryId: income.id, expenseCategoryId: expense.id } });
  assert.equal(committed.response.status, 500); assert.equal(committed.body.message, 'Não foi possível concluir a operação financeira.');
  const movements = await ctx.DB.prepare(`SELECT COUNT(*) count FROM finance_movements WHERE scope_id=?`).bind(scopeNh).first();
  const batch = await ctx.DB.prepare(`SELECT status FROM finance_import_batches WHERE id=?`).bind(staged.body.batchId).first();
  assert.equal(Number(movements.count), 0); assert.equal(batch.status, 'staged');
});

test('D1 local: movement search and audit details remain scoped and paginated', async (t) => {
  const ctx = await fixture(); t.after(() => ctx.mf.dispose()); await grant(ctx.DB, 'pilot', scopeNh);
  const bank = await account(ctx.env, ctx.actor, scopeNh, 'Banco', 'search-bank');
  const categoryRow = await category(ctx.env, ctx.actor, scopeNh, 'Procedimentos', 'income', 'search-category');
  const costCenter = await request(ctx.env, ctx.actor, `/cost-centers?scopeId=${scopeNh}`, { method: 'POST', key: 'search-center', body: { name: 'Unidade clínica' } });
  const payee = await request(ctx.env, ctx.actor, `/payees?scopeId=${scopeNh}`, { method: 'POST', key: 'search-payee', body: { name: 'Paciente Ana' } });
  const created = await request(ctx.env, ctx.actor, `/movements?scopeId=${scopeNh}`, { method: 'POST', key: 'search-movement', body: { type: 'income', accountId: bank.id, categoryId: categoryRow.id, costCenterId: costCenter.body.costCenter.id, payeeId: payee.body.payee.id, description: 'Procedimento facial', amountMinor: 12000, currency: 'BRL', competenceDate: '2026-07-21' } });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const byDescription = await request(ctx.env, ctx.actor, `/movements?scopeId=${scopeNh}&q=facial&limit=1`);
  assert.equal(byDescription.response.status, 200); assert.equal(byDescription.body.total, 1); assert.equal(byDescription.body.movements[0].id, created.body.movement.id);
  const byPayee = await request(ctx.env, ctx.actor, `/movements?scopeId=${scopeNh}&q=ana`);
  assert.equal(byPayee.body.movements.length, 1); assert.equal(byPayee.body.movements[0].payee_name, 'Paciente Ana');
  const byCategory = await request(ctx.env, ctx.actor, `/movements?scopeId=${scopeNh}&categoryId=${categoryRow.id}`);
  const byCostCenter = await request(ctx.env, ctx.actor, `/movements?scopeId=${scopeNh}&costCenterId=${costCenter.body.costCenter.id}`);
  assert.equal(byCategory.body.movements[0].id, created.body.movement.id); assert.equal(byCostCenter.body.movements[0].id, created.body.movement.id);
  const audit = await request(ctx.env, ctx.actor, `/audit?scopeId=${scopeNh}&entityId=${created.body.movement.id}&entityType=movement`);
  assert.equal(audit.response.status, 200); assert.equal(audit.body.total, 1); assert.equal(audit.body.events[0].action, 'MOVEMENT_CREATED');
  const denied = await request(ctx.env, ctx.actor, `/audit?scopeId=${scopeBss}&entityId=${created.body.movement.id}`);
  assert.equal(denied.response.status, 403);
});

test('D1 local: posted journal evidence is balanced and immutable at the database boundary', async (t) => {
  const ctx = await fixture(); t.after(() => ctx.mf.dispose()); await grant(ctx.DB, 'pilot', scopeNh);
  const source = await account(ctx.env, ctx.actor, scopeNh, 'Caixa protegido', 'protected-source'); const destination = await account(ctx.env, ctx.actor, scopeNh, 'Banco protegido', 'protected-destination');
  const posted = await request(ctx.env, ctx.actor, `/movements?scopeId=${scopeNh}`, { method: 'POST', key: 'protected-transfer', body: { type: 'transfer', accountId: source.id, destinationAccountId: destination.id, description: 'Transferência protegida', amountMinor: 100, currency: 'BRL', competenceDate: '2026-07-21' } });
  assert.equal(posted.response.status, 201, JSON.stringify(posted.body));
  const entry = await ctx.DB.prepare(`SELECT id FROM finance_journal_entries`).first();
  await assert.rejects(ctx.DB.exec(`UPDATE finance_journal_lines SET amount_minor=999`), /append-only/);
  await assert.rejects(ctx.DB.exec(`UPDATE finance_movements SET amount_minor=999`), /immutable/);
  await assert.rejects(ctx.DB.prepare(`INSERT INTO finance_journal_entries(id,scope_id,movement_id,status,created_at) VALUES(?,?,?,?,?)`).bind('unbalanced-entry', scopeNh, posted.body.movement.id, 'posted', new Date().toISOString()).run(), /start draft/);
  const income = await category(ctx.env, ctx.actor, scopeNh, 'Receita pendente', 'income', 'protected-income');
  const pending = await request(ctx.env, ctx.actor, `/movements?scopeId=${scopeNh}`, { method: 'POST', key: 'protected-pending', body: { type: 'income', accountId: source.id, categoryId: income.id, description: 'Pendente para teste', amountMinor: 100, currency: 'BRL', competenceDate: '2026-07-21', operationalStatus: 'pending' } });
  const ledger = await ctx.DB.prepare(`SELECT ledger_account_id FROM finance_accounts WHERE id=?`).bind(source.id).first();
  await ctx.DB.prepare(`INSERT INTO finance_journal_entries(id,scope_id,movement_id,status,created_at) VALUES(?,?,?,?,?)`).bind('unbalanced-entry', scopeNh, pending.body.movement.id, 'draft', new Date().toISOString()).run();
  await ctx.DB.prepare(`INSERT INTO finance_journal_lines(id,entry_id,ledger_account_id,direction,amount_minor,currency,created_at) VALUES(?,?,?,?,?,?,?)`).bind('unbalanced-line', 'unbalanced-entry', ledger.ledger_account_id, 'debit', 100, 'BRL', new Date().toISOString()).run();
  await assert.rejects(ctx.DB.prepare(`UPDATE finance_journal_entries SET status='posted' WHERE id=?`).bind('unbalanced-entry').run(), /balanced/);
  assert.ok(entry.id);
});

test('D1 local: AP/AR obligations settle only through scoped confirmed ledger evidence', async (t) => {
  const ctx = await fixture(); t.after(() => ctx.mf.dispose()); await grant(ctx.DB, 'pilot', scopeNh); await grant(ctx.DB, 'pilot', scopeBss);
  const bank = await account(ctx.env, ctx.actor, scopeNh, 'Banco de títulos', 'obligation-bank');
  const expense = await category(ctx.env, ctx.actor, scopeNh, 'Fornecedores', 'expense', 'obligation-expense');
  const payee = await request(ctx.env, ctx.actor, `/payees?scopeId=${scopeNh}`, { method: 'POST', key: 'obligation-payee', body: { name: 'Fornecedor auditável' } }); assert.equal(payee.response.status, 201);
  const created = await request(ctx.env, ctx.actor, `/obligations?scopeId=${scopeNh}`, { method: 'POST', key: 'obligation-create', body: { kind: 'payable', categoryId: expense.id, payeeId: payee.body.payee.id, description: 'Aluguel agosto', amountMinor: 10_000, currency: 'BRL', competenceDate: '2026-08-01', dueDate: '2026-08-10' } });
  assert.equal(created.response.status, 201, JSON.stringify(created.body)); const obligationId = created.body.obligation.id;
  const replay = await request(ctx.env, ctx.actor, `/obligations?scopeId=${scopeNh}`, { method: 'POST', key: 'obligation-create', body: { kind: 'payable', categoryId: expense.id, payeeId: payee.body.payee.id, description: 'Aluguel agosto', amountMinor: 10_000, currency: 'BRL', competenceDate: '2026-08-01', dueDate: '2026-08-10' } }); assert.equal(replay.body.replayed, true);
  assert.equal((await request(ctx.env, ctx.actor, `/obligations/${obligationId}?scopeId=${scopeBss}`)).response.status, 404);
  const payment = await request(ctx.env, ctx.actor, `/movements?scopeId=${scopeNh}`, { method: 'POST', key: 'obligation-payment-one', body: { type: 'expense', accountId: bank.id, categoryId: expense.id, payeeId: payee.body.payee.id, description: 'Pagamento parcial aluguel', amountMinor: 7_500, currency: 'BRL', competenceDate: '2026-08-10', paidDate: '2026-08-10' } }); assert.equal(payment.response.status, 201, JSON.stringify(payment.body));
  const firstSettlementPayload = { movementId: payment.body.movement.id, principalAmountMinor: 8_000, discountMinor: 500, paidDate: '2026-08-10' };
  const settlement = await request(ctx.env, ctx.actor, `/obligations/${obligationId}/settlements?scopeId=${scopeNh}`, { method: 'POST', key: 'obligation-settlement-one', body: firstSettlementPayload }); assert.equal(settlement.response.status, 201, JSON.stringify(settlement.body)); assert.equal(settlement.body.status, 'partially_settled'); assert.equal(settlement.body.remainingMinor, 2_000);
  const settlementReplay = await request(ctx.env, ctx.actor, `/obligations/${obligationId}/settlements?scopeId=${scopeNh}`, { method: 'POST', key: 'obligation-settlement-one', body: firstSettlementPayload }); assert.equal(settlementReplay.body.replayed, true);
  const duplicateMovement = await request(ctx.env, ctx.actor, `/obligations/${obligationId}/settlements?scopeId=${scopeNh}`, { method: 'POST', key: 'obligation-settlement-duplicate', body: firstSettlementPayload }); assert.equal(duplicateMovement.response.status, 409); assert.equal(duplicateMovement.body.error, 'DUPLICATE_SETTLEMENT');
  const finalPayment = await request(ctx.env, ctx.actor, `/movements?scopeId=${scopeNh}`, { method: 'POST', key: 'obligation-payment-two', body: { type: 'expense', accountId: bank.id, categoryId: expense.id, payeeId: payee.body.payee.id, description: 'Saldo aluguel', amountMinor: 2_000, currency: 'BRL', competenceDate: '2026-08-11', paidDate: '2026-08-11' } }); assert.equal(finalPayment.response.status, 201, JSON.stringify(finalPayment.body));
  const finalSettlement = await request(ctx.env, ctx.actor, `/obligations/${obligationId}/settlements?scopeId=${scopeNh}`, { method: 'POST', key: 'obligation-settlement-two', body: { movementId: finalPayment.body.movement.id, principalAmountMinor: 2_000, paidDate: '2026-08-11' } }); assert.equal(finalSettlement.response.status, 201, JSON.stringify(finalSettlement.body)); assert.equal(finalSettlement.body.status, 'settled');
  const detail = await request(ctx.env, ctx.actor, `/obligations/${obligationId}?scopeId=${scopeNh}`); assert.equal(detail.body.remainingMinor, 0); assert.equal(detail.body.settlements.length, 2); await assert.rejects(ctx.DB.exec(`UPDATE finance_obligation_settlements SET principal_amount_minor=1`), /append-only/); await assert.rejects(ctx.DB.exec(`DELETE FROM finance_obligations WHERE id='${obligationId}'`), /cannot be deleted/);
  const cancellable = await request(ctx.env, ctx.actor, `/obligations?scopeId=${scopeNh}`, { method: 'POST', key: 'obligation-cancellable', body: { kind: 'payable', description: 'Contrato cancelado', amountMinor: 1_000, currency: 'BRL', competenceDate: '2026-08-01', dueDate: '2026-08-12' } }); const cancelled = await request(ctx.env, ctx.actor, `/obligations/${cancellable.body.obligation.id}/cancel?scopeId=${scopeNh}`, { method: 'POST', key: 'obligation-cancel', body: { reason: 'Contrato não aprovado' } }); assert.equal(cancelled.response.status, 201); const audit = await request(ctx.env, ctx.actor, `/audit?scopeId=${scopeNh}&entityId=${obligationId}&entityType=obligation`); assert.equal(audit.body.events.some((event) => event.action === 'OBLIGATION_SETTLED'), true);
});
