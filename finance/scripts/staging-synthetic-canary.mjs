#!/usr/bin/env node
// This script is deliberately staging-only. It never prints credentials,
// cookies, tokens, usernames, request bodies, or synthetic record IDs.
import { writeFile } from 'node:fs/promises';

const reportFile = process.argv.includes('--report') ? process.argv[process.argv.indexOf('--report') + 1] : '';
if (!reportFile) throw new Error('--report is required');
const report = { ok: false, generatedAt: new Date().toISOString(), samples: [], errors: 0, authenticationFailures: 0, journeyFailures: 0, dataDivergences: 0, auditFailures: 0, dependencyFailures: 0 };
const required = (name) => { const item = String(process.env[name] || '').trim(); if (!item) throw new Error(`${name} is required`); return item; };
const finish = async (ok, cause) => {
  report.ok = ok;
  if (cause) report.failure = String(cause.message || cause).replace(/[\r\n]/g, ' ').slice(0, 180);
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  if (!ok) process.exitCode = 1;
};
try {
  if (process.env.FINANCE_STAGING_CANARY_ACK !== '1') throw new Error('FINANCE_STAGING_CANARY_ACK=1 is required');
  const baseUrl = required('FINANCE_CANARY_BASE_URL').replace(/\/$/, '');
  if (baseUrl !== 'https://api-staging.skincos.com.br') throw new Error('canary base URL must be staging gateway');
  const username = required('FINANCE_CANARY_USERNAME');
  if (username !== 'finance-staging-monitor') throw new Error('only registered synthetic actor may run canary');
  const password = required('FINANCE_CANARY_PASSWORD');
  const scopeId = required('FINANCE_CANARY_SCOPE_ID');
  if (scopeId !== 'finance-scope-novo-hamburgo') throw new Error('only synthetic Novo Hamburgo scope is allowed');
  const request = async (name, path, init = {}) => {
    const started = Date.now();
    try {
      const response = await fetch(`${baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(15_000) });
      report.samples.push({ name, status: response.status, durationMs: Date.now() - started });
      return response;
    } catch (cause) {
      report.samples.push({ name, status: 0, durationMs: Date.now() - started });
      report.errors += 1; report.dependencyFailures += 1; throw cause;
    }
  };
  const expect = async (name, path, init = {}, status = 200) => {
    const response = await request(name, path, init);
    const body = await response.json().catch(() => null);
    if (response.status !== status) { report.errors += 1; if (status === 200 && response.status === 401) report.authenticationFailures += 1; throw new Error(`${name} returned ${response.status}`); }
    return body;
  };
  const loginResponse = await request('login', '/insumos/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://crm-staging.skincos.com.br' }, body: JSON.stringify({ username, password }) });
  const login = await loginResponse.json().catch(() => null);
  if (loginResponse.status !== 200) { report.authenticationFailures += 1; throw new Error(`login returned ${loginResponse.status}`); }
  const cookie = (typeof loginResponse.headers.getSetCookie === 'function' ? loginResponse.headers.getSetCookie() : [loginResponse.headers.get('set-cookie') || '']).map((item) => item.split(';', 1)[0]).filter(Boolean).join('; ');
  if (!cookie || !login?.csrfToken) { report.authenticationFailures += 1; throw new Error('synthetic staging login did not issue session'); }
  const headers = { cookie, origin: 'https://crm-staging.skincos.com.br', 'x-csrf-token': login.csrfToken };
  const expectedSha = required('FINANCE_CANARY_RELEASE_SHA');
  if (!/^[0-9a-f]{40}$/.test(expectedSha)) throw new Error('FINANCE_CANARY_RELEASE_SHA must be a full SHA');
  const health = await expect('health', '/finance/health', { headers: { origin: 'https://crm-staging.skincos.com.br' } });
  if (health.version !== expectedSha) { report.dependencyFailures += 1; throw new Error('Finance Worker version does not match canary SHA'); }
  const bootstrap = await expect('bootstrap', `/finance/bootstrap?scopeId=${encodeURIComponent(scopeId)}`, { headers });
  if (bootstrap.moduleEnabled !== true || bootstrap.canAccess !== true || !Array.isArray(bootstrap.grants) || bootstrap.grants.length !== 1 || bootstrap.grants[0]?.scope_id !== scopeId || bootstrap.grants[0]?.unit_slug !== 'novo-hamburgo' || bootstrap.grants[0]?.permission !== 'operator') throw new Error('synthetic canary scope or grant mismatch');
  const readiness = await expect('readiness', '/finance/readiness', { headers: { origin: 'https://crm-staging.skincos.com.br' } });
  if (!readiness.ready || readiness.dependencies?.d1?.state !== 'healthy') { report.dependencyFailures += 1; throw new Error('Finance dependency is not ready'); }
  await expect('accounts', `/finance/accounts?scopeId=${encodeURIComponent(scopeId)}`, { headers });
  await expect('categories', `/finance/categories?scopeId=${encodeURIComponent(scopeId)}`, { headers });
  const nonce = `canary-${Date.now()}`;
  const tag = await expect('synthetic-audit-create', `/finance/tags?scopeId=${encodeURIComponent(scopeId)}`, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json', 'idempotency-key': `${nonce}:create` }, body: JSON.stringify({ name: nonce }),
  }, 201);
  const tagId = String(tag.tag?.id || '').trim();
  if (!tagId) { report.auditFailures += 1; throw new Error('synthetic audit probe did not return an identifier'); }
  const archived = await expect('synthetic-audit-compensate', `/finance/tags/${encodeURIComponent(tagId)}/archive?scopeId=${encodeURIComponent(scopeId)}`, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json', 'idempotency-key': `${nonce}:archive` }, body: JSON.stringify({ reason: 'Synthetic canary compensation' }),
  }, 201);
  if (archived.active !== false) { report.dataDivergences += 1; throw new Error('synthetic canary compensation did not archive its record'); }
  const audit = await expect('audit', `/finance/audit?scopeId=${encodeURIComponent(scopeId)}&entityType=tag&entityId=${encodeURIComponent(tagId)}`, { headers });
  if (Number(audit.total || 0) < 2) { report.auditFailures += 1; throw new Error('synthetic canary audit trail is incomplete'); }
  const denied = await request('cross-unit-denied', '/finance/accounts?scopeId=finance-scope-barra-shopping-sul', { headers });
  if (denied.status !== 403) { report.journeyFailures += 1; throw new Error('cross-unit access was not denied'); }
  // The only write is a synthetic tag and its compensating archive; no real
  // actor, unit, financial movement, import or personal scope is touched.
  report.ok = true;
  await finish(true);
} catch (cause) {
  if (!report.journeyFailures && !report.authenticationFailures && !report.dependencyFailures) report.journeyFailures += 1;
  await finish(false, cause);
}
