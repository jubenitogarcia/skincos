import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiGateway, handleGatewayRequest } from '../../api/src/gateway.js';
import { resolveIdentityActor } from '../../identity/session/actor.js';
import { resetBoundServiceResilienceForTest } from '../../shared/service-adapters/cloudflare-service-binding.js';
import { handleFinance } from '../../finance/worker.js';
import timekeepingWorker from '../../workforce/timekeeping/worker.js';
import { withRollbackTransaction } from '../../shared/resilience/transaction.js';
import { d1OutboxInsert } from '../../shared/events/d1.js';
import { callOptionalDependency, createDependencyState } from '../../shared/resilience/dependency.js';
import { evolutionOrchestrator } from '../../crm/api/services/evolutionOrchestrator.js';
import { whatsappOrchestrator } from '../../crm/api/services/whatsappOrchestrator.js';

const originalFetch = global.fetch;
const originalEvolutionUrl = process.env.EVOLUTION_API_URL;
const originalEvolutionKey = process.env.EVOLUTION_API_KEY;

function actor() { return { actor: { username: 'chaos-pilot', allowedModules: ['finance'] }, csrf: 'chaos-csrf' }; }

async function signedSessionCookie(secret) {
  const payload = btoa(JSON.stringify({ username: 'chaos-pilot', csrf: 'chaos-csrf', sv: 0, exp: Date.now() + 60_000 })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `session=${payload}.${signature}`;
}

test('chaos: Identity D1 outage is marked unavailable and contained to Finance', async () => {
  const cookie = await signedSessionCookie('chaos-session-secret');
  const identity = await resolveIdentityActor(new Request('https://api.local/', { headers: { cookie } }), { SESSION_SECRET: 'chaos-session-secret', DB: { prepare: () => { throw new Error('D1 unavailable'); } } });
  assert.equal(identity.unavailable, true);
  let financeCalls = 0;
  const gateway = createApiGateway({
    inventoryHandler: async () => new Response('inventory-ok'),
    resolveActor: async () => identity,
    financeDomainHandler: async () => { financeCalls += 1; return new Response('must-not-run'); },
  });
  const affected = await gateway(new Request('https://api.local/finance/overview'), {}, {});
  assert.equal(affected.status, 503);
  assert.equal((await affected.json()).error, 'IDENTITY_UNAVAILABLE');
  assert.equal(financeCalls, 0);
  const control = await gateway(new Request('https://api.local/inventory/insumos'), {}, {});
  assert.equal(control.status, 200);
});

test('chaos: Inventory binding outage affects only Inventory', async () => {
  resetBoundServiceResilienceForTest();
  const affected = await handleGatewayRequest(new Request('https://api.local/inventory/insumos'), {}, {});
  assert.equal(affected.status, 503);
  assert.equal((await affected.json()).pendingSynchronization, true);
  const control = await handleGatewayRequest(new Request('https://api.local/health'), {}, {});
  assert.equal(control.status, 200);
});

test('chaos: Finance binding outage affects only Finance', async () => {
  resetBoundServiceResilienceForTest();
  const gateway = createApiGateway({ inventoryHandler: async () => new Response('inventory-ok'), resolveActor: async () => actor() });
  const affected = await gateway(new Request('https://api.local/finance/overview'), { FINANCE_SERVICE_AUTH_SECRET: 'chaos-secret' }, {});
  assert.equal(affected.status, 503);
  assert.equal((await affected.json()).error, 'domain_service_degraded');
  const control = await gateway(new Request('https://api.local/inventory/insumos'), {}, {});
  assert.equal(control.status, 200);
});

test('chaos: PostgreSQL failure rolls back its transaction without affecting gateway health', async () => {
  const calls = [];
  const pool = { connect: async () => ({ query: async (sql) => { calls.push(sql); if (sql === 'SELECT fail') throw new Error('postgres unavailable'); }, release: () => calls.push('release') }) };
  await assert.rejects(() => withRollbackTransaction(pool, async (client) => client.query('SELECT fail')), /postgres unavailable/);
  assert.deepEqual(calls, ['begin', 'SELECT fail', 'rollback', 'release']);
  const control = await handleGatewayRequest(new Request('https://api.local/health'), {}, {});
  assert.equal(control.status, 200);
});

test('chaos: D1 outage fails readiness for D1-owned modules only', async () => {
  const finance = await handleFinance(new Request('https://finance.local/readiness'), {}, {});
  assert.equal(finance.status, 503);
  const ponto = await timekeepingWorker.fetch(new Request('https://ponto.local/api/ponto/readiness'), {});
  assert.equal(ponto.status, 503);
  const control = await handleGatewayRequest(new Request('https://api.local/health'), {}, {});
  assert.equal(control.status, 200);
});

test('chaos: Queue outage cannot block a transactional outbox producer', () => {
  let sends = 0;
  const db = { prepare: (sql) => ({ bind: (...values) => ({ sql, values }) }) };
  const event = { contractVersion: 'skincos-event/v1', id: 'evt-chaos', type: 'finance.movement-posted.v1', version: 1, producer: { module: 'finance', service: 'finance-worker' }, subject: { type: 'finance-movement', id: 'movement-chaos' }, data: { scopeId: 'chaos-unit' }, correlationId: 'corr-chaos', idempotencyKey: 'idem-chaos', occurredAt: '2026-07-23T00:00:00.000Z' };
  const outbox = d1OutboxInsert({ db, table: 'finance_event_outbox', event, queue: { send: () => { sends += 1; throw new Error('queue unavailable'); } } });
  assert.match(outbox.sql, /INSERT OR IGNORE INTO finance_event_outbox/);
  assert.equal(sends, 0);
});

test('chaos: WhatsApp provider outage degrades status without removing the native channel contract', async () => {
  process.env.EVOLUTION_API_URL = 'http://whatsapp.invalid'; process.env.EVOLUTION_API_KEY = 'chaos-key';
  global.fetch = async () => { throw new TypeError('fetch failed'); };
  try {
    const affected = await evolutionOrchestrator.getStatus();
    assert.equal(affected.providerOnline, false);
    assert.equal(affected.channels.length, 9);
    assert.equal(whatsappOrchestrator.getAllChannels().length, 9);
  } finally {
    global.fetch = originalFetch;
    if (originalEvolutionUrl == null) delete process.env.EVOLUTION_API_URL; else process.env.EVOLUTION_API_URL = originalEvolutionUrl;
    if (originalEvolutionKey == null) delete process.env.EVOLUTION_API_KEY; else process.env.EVOLUTION_API_KEY = originalEvolutionKey;
  }
});

test('chaos: external integration timeout returns an explicit degraded fallback', async () => {
  const result = await callOptionalDependency({ dependency: 'external-chaos', state: createDependencyState(), timeoutMs: 5, failureThreshold: 1, invoke: () => new Promise(() => {}), fallback: () => ({ operation: 'retained-for-reconciliation' }) });
  assert.equal(result.mode, 'degraded');
  assert.equal(result.pendingSynchronization, true);
  assert.deepEqual(result.value, { operation: 'retained-for-reconciliation' });
});

test('chaos: Cloudflare module-control binding outage enters Finance maintenance without taking down gateway health', async () => {
  const affected = await handleFinance(new Request('https://finance.local/overview'), { MODULE_CONTROL: { get: async () => { throw new Error('KV unavailable'); } } }, {});
  assert.equal(affected.status, 503);
  assert.equal((await affected.json()).error, 'MODULE_MAINTENANCE');
  const control = await handleGatewayRequest(new Request('https://api.local/health'), {}, {});
  assert.equal(control.status, 200);
});
