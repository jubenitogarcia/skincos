#!/usr/bin/env node
// Controlled staging-only import probe. Credentials are supplied only by the
// operator environment; no password, cookie, or production default is kept in
// this repository. It stages one normalized source by default; commit and undo
// need explicit arguments and identifiers from the controlled staging window.
import { readFile } from 'node:fs/promises';
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
if (process.env.FINANCE_STAGING_SMOKE_ACK !== '1') throw new Error('FINANCE_STAGING_SMOKE_ACK=1 is required');

const baseUrl = required('FINANCE_SMOKE_BASE_URL').replace(/\/$/, '');
if (!/^https:\/\/api-staging\.skincos\.com\.br$/i.test(baseUrl)) throw new Error('FINANCE_SMOKE_BASE_URL must be the staging gateway');
const username = required('FINANCE_SMOKE_USERNAME');
const password = required('FINANCE_SMOKE_PASSWORD');
const scopeId = required('FINANCE_SMOKE_SCOPE_ID');
const sourceType = arg('--source', 'generic');
if (!['generic', 'moneywiz', 'ef-caixa'].includes(sourceType)) throw new Error('--source must be generic, moneywiz, or ef-caixa');
const fixture = arg('--fixture');
if (!fixture) throw new Error('--fixture is required');
const commitRequested = process.argv.includes('--commit');
const undoRequested = process.argv.includes('--undo');
if (undoRequested && !commitRequested) throw new Error('--undo requires --commit');

const deadline = (signal) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('request timeout')), timeoutMs);
  signal?.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
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

const raw = await readFile(resolve(fixture), 'utf8');
const payload = sourceType === 'ef-caixa'
  ? { filename: 'staging-ef-smoke.json', sourceType, efCaixa: JSON.parse(raw) }
  : { filename: `staging-${sourceType}-smoke.csv`, sourceType, csv: raw, encoding: 'utf-8' };
const key = `staging-import-smoke:${sourceType}:${scopeId}:${Date.now()}`;
const staged = await request(`/finance/imports?scopeId=${encodeURIComponent(scopeId)}`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json', cookie, origin: 'https://crm-staging.skincos.com.br',
    'x-csrf-token': loginBody.csrfToken, 'idempotency-key': key,
  },
  body: JSON.stringify(payload),
});
const body = await json(staged);
const batchId = String(body.batchId || '').trim();
if (!batchId) throw new Error('staging did not return batchId');
const authHeaders = (idempotencyKey) => ({ 'content-type': 'application/json', cookie, origin: 'https://crm-staging.skincos.com.br', 'x-csrf-token': loginBody.csrfToken, ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) });
const loadBatch = async () => json(await request(`/finance/imports/${encodeURIComponent(batchId)}?scopeId=${encodeURIComponent(scopeId)}`, { headers: authHeaders() }));
const stateSummary = (loaded) => {
  const counts = {};
  for (const row of loaded.rows || []) counts[`${row.status}:${row.decision}`] = (counts[`${row.status}:${row.decision}`] || 0) + 1;
  return { batchStatus: loaded.batch?.status || null, rows: counts, decisions: (loaded.decisions || []).length };
};
const result = { ok: true, sourceType, status: staged.status, batchId, alreadyStaged: Boolean(body.alreadyStaged), analysis: body.analysis ? { sourceType: body.analysis.sourceType, rows: Number(body.analysis.rows?.length || 0) } : null };
let loaded = await loadBatch();
result.before = stateSummary(loaded);
if (commitRequested) {
  if (body.alreadyStaged) throw new Error(`batch ${batchId} already exists; refusing to mutate a deduplicated import`);
  if (loaded.batch?.status !== 'staged') throw new Error(`batch ${batchId} is not staged (${loaded.batch?.status || 'unknown'}); refusing commit`);
  const candidate = (loaded.rows || []).find((row) => row.status === 'valid');
  if (!candidate) throw new Error(`no valid import row after staging: ${JSON.stringify(stateSummary(loaded))}`);
  const defaultAccountId = required('FINANCE_SMOKE_DEFAULT_ACCOUNT_ID');
  const incomeCategoryId = required('FINANCE_SMOKE_INCOME_CATEGORY_ID');
  const expenseCategoryId = required('FINANCE_SMOKE_EXPENSE_CATEGORY_ID');
  const decision = await request(`/finance/imports/${encodeURIComponent(batchId)}/decisions?scopeId=${encodeURIComponent(scopeId)}`, {
    method: 'POST', headers: authHeaders(`${key}:decision`),
    body: JSON.stringify({ rowId: candidate.id, decision: 'import' }),
  });
  const decisionBody = await json(decision);
  loaded = await loadBatch();
  const persisted = (loaded.rows || []).find((row) => row.id === candidate.id);
  if (!persisted || persisted.status !== 'valid' || persisted.decision !== 'import') throw new Error(`import decision did not persist: ${JSON.stringify(stateSummary(loaded))}`);
  const preview = await request(`/finance/imports/${encodeURIComponent(batchId)}/preview?scopeId=${encodeURIComponent(scopeId)}`, { method: 'POST', headers: authHeaders(`${key}:preview`), body: '{}' });
  const previewBody = await json(preview);
  if (Number(previewBody.ready || 0) < 1) throw new Error(`no approved rows after explicit decision: ${JSON.stringify({ decision: decisionBody.decision?.decision || null, state: stateSummary(loaded), preview: { ready: Number(previewBody.ready || 0), summary: previewBody.summary || {} } })}`);
  const commitPayload = { defaultAccountId, incomeCategoryId, expenseCategoryId };
  const commit = await request(`/finance/imports/${encodeURIComponent(batchId)}/commit?scopeId=${encodeURIComponent(scopeId)}`, { method: 'POST', headers: authHeaders(`${key}:commit`), body: JSON.stringify(commitPayload) });
  const commitBody = await json(commit);
  loaded = await loadBatch();
  const committedRows = (loaded.rows || []).filter((row) => row.status === 'committed' && row.movement_id);
  if (loaded.batch?.status !== 'committed' || !committedRows.length) throw new Error(`commit did not produce committed rows: ${JSON.stringify(stateSummary(loaded))}`);
  const replay = await request(`/finance/imports/${encodeURIComponent(batchId)}/commit?scopeId=${encodeURIComponent(scopeId)}`, { method: 'POST', headers: authHeaders(`${key}:commit`), body: JSON.stringify(commitPayload) });
  const replayBody = await json(replay);
  if (!replayBody.replayed) throw new Error('repeat commit did not replay the original operation');
  result.decision = { status: decision.status, rowId: candidate.id, persisted: true };
  result.preview = { status: preview.status, ready: Number(previewBody.ready || 0) };
  result.commit = { status: commit.status, operationId: commitBody.operationId || null, committed: Number(commitBody.committed || 0), replayed: Boolean(replayBody.replayed) };
  result.afterCommit = stateSummary(loaded);
  if (undoRequested) {
    const undo = await request(`/finance/imports/${encodeURIComponent(batchId)}/undo?scopeId=${encodeURIComponent(scopeId)}`, { method: 'POST', headers: authHeaders(`${key}:undo`), body: JSON.stringify({ reason: 'Controlled staging smoke reversal' }) });
    const undoBody = await json(undo);
    loaded = await loadBatch();
    result.undo = { status: undo.status, operationId: undoBody.operationId || null, undone: Number(undoBody.undone || 0), replayed: Boolean(undoBody.replayed), batchStatus: loaded.batch?.status || null, movementsCompensated: (loaded.rows || []).filter((row) => row.movement_id).length };
  }
}
console.log(JSON.stringify(result));
