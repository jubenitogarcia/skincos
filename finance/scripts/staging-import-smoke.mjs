#!/usr/bin/env node
// Controlled staging-only import journey. It creates only synthetic reference
// records, compensates the imported movement, and archives its references.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const required = (name) => {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const arg = (name, fallback = '') => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : fallback;
};
const timeoutMs = Number(arg('--timeout-ms', '15000'));
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) throw new Error('--timeout-ms must be between 1000 and 60000');
if (process.env.FINANCE_SMOKE_ACK !== '1') throw new Error('FINANCE_SMOKE_ACK=1 is required');

const baseUrl = required('FINANCE_SMOKE_BASE_URL').replace(/\/$/, '');
if (!/^https:\/\/api-staging\.skincos\.com\.br$/i.test(baseUrl)) throw new Error('FINANCE_SMOKE_BASE_URL must be the staging gateway');
const username = required('FINANCE_SMOKE_USERNAME');
const password = required('FINANCE_SMOKE_PASSWORD');
const scopeId = required('FINANCE_SMOKE_SCOPE_ID');
const sourceType = arg('--source', 'generic');
if (!['generic', 'moneywiz', 'ef-caixa'].includes(sourceType)) throw new Error('--source must be generic, moneywiz, or ef-caixa');
const fixture = arg('--fixture');
if (!fixture) throw new Error('--fixture is required');
const reportFile = arg('--report');
const commitRequested = process.argv.includes('--commit');
const undoRequested = process.argv.includes('--undo');
if (undoRequested && !commitRequested) throw new Error('--undo requires --commit');
const nonce = `finance-staging-smoke-${Date.now()}`;

const deadline = () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('request timeout')), timeoutMs);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
};
async function request(path, init = {}) {
  const timer = deadline();
  try { return await fetch(`${baseUrl}${path}`, { ...init, signal: timer.signal }); }
  finally { timer.done(); }
}
const json = async (response) => {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${body?.error || 'unexpected response'}`);
  return body;
};

const login = await request('/insumos/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://crm-staging.skincos.com.br' },
  body: JSON.stringify({ username, password }),
});
const loginBody = await json(login);
const setCookies = typeof login.headers.getSetCookie === 'function' ? login.headers.getSetCookie() : [login.headers.get('set-cookie') || ''];
const cookie = setCookies.map((value) => value.split(';', 1)[0]).filter(Boolean).join('; ');
if (!cookie || !loginBody.csrfToken) throw new Error('staging auth did not issue session and CSRF cookies');
const authHeaders = (idempotencyKey) => ({ 'content-type': 'application/json', cookie, origin: 'https://crm-staging.skincos.com.br', 'x-csrf-token': loginBody.csrfToken, ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) });
const key = `staging-import-smoke:${sourceType}:${scopeId}:${nonce}`;
const created = [];
const createRegistration = async (collection, value, idempotencyKey) => {
  const response = await request(`/finance/${collection}?scopeId=${encodeURIComponent(scopeId)}`, {
    method: 'POST', headers: authHeaders(idempotencyKey), body: JSON.stringify(value),
  });
  const createdBody = await json(response);
  const entity = collection === 'accounts' ? createdBody.account : createdBody.category;
  if (!entity?.id) throw new Error(`staging did not create synthetic ${collection}`);
  created.push({ collection, id: entity.id });
  return entity;
};
const cleanup = async () => {
  const results = [];
  for (const entity of [...created].reverse()) {
    const response = await request(`/finance/${entity.collection}/${encodeURIComponent(entity.id)}/archive?scopeId=${encodeURIComponent(scopeId)}`, {
      method: 'POST', headers: authHeaders(`${key}:cleanup:${entity.collection}:${entity.id}`), body: JSON.stringify({ reason: 'Controlled staging smoke cleanup' }),
    });
    const archived = await json(response);
    if (archived.active !== false) throw new Error(`synthetic ${entity.collection} cleanup was not confirmed`);
    results.push(entity.collection);
  }
  return results;
};
const stateSummary = (loaded) => {
  const counts = {};
  for (const row of loaded.rows || []) counts[`${row.status}:${row.decision}`] = (counts[`${row.status}:${row.decision}`] || 0) + 1;
  return { batchStatus: loaded.batch?.status || null, rows: counts, decisions: (loaded.decisions || []).length };
};
const result = { ok: false, sourceType, scope: 'synthetic-novo-hamburgo' };

try {
  const raw = (await readFile(resolve(fixture), 'utf8')).replaceAll('__SMOKE_NONCE__', nonce);
  const payload = sourceType === 'ef-caixa'
    ? { filename: 'staging-ef-smoke.json', sourceType, efCaixa: JSON.parse(raw) }
    : { filename: `staging-${sourceType}-smoke.csv`, sourceType, csv: raw, encoding: 'utf-8' };
  const staged = await request(`/finance/imports?scopeId=${encodeURIComponent(scopeId)}`, {
    method: 'POST', headers: authHeaders(key), body: JSON.stringify(payload),
  });
  const stagedBody = await json(staged);
  const batchId = String(stagedBody.batchId || '').trim();
  if (!batchId) throw new Error('staging did not return batchId');
  const loadBatch = async () => json(await request(`/finance/imports/${encodeURIComponent(batchId)}?scopeId=${encodeURIComponent(scopeId)}`, { headers: authHeaders() }));
  result.stage = { status: staged.status, alreadyStaged: Boolean(stagedBody.alreadyStaged), rows: Number(stagedBody.analysis?.rows?.length || 0) };
  let loaded = await loadBatch();
  result.before = stateSummary(loaded);
  if (commitRequested) {
    if (stagedBody.alreadyStaged) throw new Error('synthetic import unexpectedly reused a previous batch');
    if (loaded.batch?.status !== 'staged') throw new Error(`batch is not staged (${loaded.batch?.status || 'unknown'}); refusing commit`);
    const analyzed = await request(`/finance/imports/${encodeURIComponent(batchId)}/analyze?scopeId=${encodeURIComponent(scopeId)}`, {
      method: 'POST', headers: authHeaders(`${key}:analyze`), body: JSON.stringify(payload),
    });
    const analysisBody = await json(analyzed);
    if (!analysisBody.analysis?.rows?.length) throw new Error('import analyze did not return rows');
    result.analyze = { status: analyzed.status, rows: Number(analysisBody.analysis.rows.length) };
    loaded = await loadBatch();
    const candidate = (loaded.rows || []).find((row) => row.status === 'valid');
    if (!candidate) throw new Error(`no valid import row after staging: ${JSON.stringify(stateSummary(loaded))}`);
    const account = await createRegistration('accounts', { name: `Conta sintética ${nonce}`, type: 'bank', currency: 'BRL', openingBalanceMinor: 0 }, `${key}:account`);
    const income = await createRegistration('categories', { name: `Receita sintética ${nonce}`, direction: 'income' }, `${key}:income`);
    const expense = await createRegistration('categories', { name: `Despesa sintética ${nonce}`, direction: 'expense' }, `${key}:expense`);
    const decision = await request(`/finance/imports/${encodeURIComponent(batchId)}/decisions?scopeId=${encodeURIComponent(scopeId)}`, {
      method: 'POST', headers: authHeaders(`${key}:decision`), body: JSON.stringify({ rowId: candidate.id, decision: 'import' }),
    });
    await json(decision);
    loaded = await loadBatch();
    const persisted = (loaded.rows || []).find((row) => row.id === candidate.id);
    if (!persisted || persisted.status !== 'valid' || persisted.decision !== 'import') throw new Error(`import decision did not persist: ${JSON.stringify(stateSummary(loaded))}`);
    const preview = await request(`/finance/imports/${encodeURIComponent(batchId)}/preview?scopeId=${encodeURIComponent(scopeId)}`, { method: 'POST', headers: authHeaders(`${key}:preview`), body: '{}' });
    const previewBody = await json(preview);
    if (Number(previewBody.ready || 0) < 1) throw new Error('no approved rows after explicit decision');
    const commitPayload = { defaultAccountId: account.id, incomeCategoryId: income.id, expenseCategoryId: expense.id };
    const commit = await request(`/finance/imports/${encodeURIComponent(batchId)}/commit?scopeId=${encodeURIComponent(scopeId)}`, { method: 'POST', headers: authHeaders(`${key}:commit`), body: JSON.stringify(commitPayload) });
    const commitBody = await json(commit);
    loaded = await loadBatch();
    const committedRows = (loaded.rows || []).filter((row) => row.status === 'committed' && row.movement_id);
    if (loaded.batch?.status !== 'committed' || !committedRows.length) throw new Error(`commit did not produce committed rows: ${JSON.stringify(stateSummary(loaded))}`);
    const replay = await request(`/finance/imports/${encodeURIComponent(batchId)}/commit?scopeId=${encodeURIComponent(scopeId)}`, { method: 'POST', headers: authHeaders(`${key}:commit`), body: JSON.stringify(commitPayload) });
    const replayBody = await json(replay);
    if (!replayBody.replayed) throw new Error('repeat commit did not replay the original operation');
    const conflict = await request(`/finance/imports/${encodeURIComponent(batchId)}/commit?scopeId=${encodeURIComponent(scopeId)}`, { method: 'POST', headers: authHeaders(`${key}:commit`), body: JSON.stringify({ ...commitPayload, expenseCategoryId: income.id }) });
    const conflictBody = await conflict.json().catch(() => null);
    if (conflict.status !== 409 || conflictBody?.error !== 'IDEMPOTENCY_CONFLICT') throw new Error(`incompatible second confirmation did not conflict: ${conflict.status}`);
    const audit = await request(`/finance/audit?scopeId=${encodeURIComponent(scopeId)}&entityType=import_batch&entityId=${encodeURIComponent(batchId)}`, { headers: authHeaders() });
    const auditBody = await json(audit);
    if (Number(auditBody.total || 0) < 2) throw new Error('import audit trail is incomplete');
    result.decision = { status: decision.status, persisted: true };
    result.preview = { status: preview.status, ready: Number(previewBody.ready || 0) };
    result.commit = { status: commit.status, committed: Number(commitBody.committed || 0), replayed: Boolean(replayBody.replayed), conflictStatus: conflict.status };
    result.audit = { status: audit.status, events: Number(auditBody.total || 0) };
    result.afterCommit = stateSummary(loaded);
    if (undoRequested) {
      const undo = await request(`/finance/imports/${encodeURIComponent(batchId)}/undo?scopeId=${encodeURIComponent(scopeId)}`, { method: 'POST', headers: authHeaders(`${key}:undo`), body: JSON.stringify({ reason: 'Controlled staging smoke reversal' }) });
      const undoBody = await json(undo);
      loaded = await loadBatch();
      if (loaded.batch?.status !== 'undone') throw new Error('import undo did not reach the compensated state');
      result.undo = { status: undo.status, undone: Number(undoBody.undone || 0), replayed: Boolean(undoBody.replayed), batchStatus: loaded.batch.status, movementsCompensated: (loaded.rows || []).filter((row) => row.movement_id).length };
    }
  }
  result.ok = true;
} catch (error) {
  result.error = String(error?.message || error).replace(/[\r\n]/g, ' ').slice(0, 180);
  throw error;
} finally {
  let cleanupFailure = null;
  try {
    if (created.length) result.cleanup = await cleanup();
  } catch (error) {
    cleanupFailure = error;
    result.cleanupError = String(error?.message || error).replace(/[\r\n]/g, ' ').slice(0, 180);
  }
  if (reportFile) await writeFile(resolve(reportFile), `${JSON.stringify(result, null, 2)}\n`);
  if (cleanupFailure) throw cleanupFailure;
}

console.log(JSON.stringify(result));
