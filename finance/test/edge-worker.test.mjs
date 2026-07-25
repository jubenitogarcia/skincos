import assert from 'node:assert/strict';
import test from 'node:test';
import { handleFinance } from '../worker.js';
import { canaryBucket, canUseCanary } from '../../shared/module-availability/worker.js';

test('Finance exposes health without a public domain route and honors runtime maintenance', async () => {
  const health = await handleFinance(new Request('https://finance.internal/health'), {}, {});
  assert.equal(health.status, 200);
  const body = await health.json();
  assert.equal(body.availability.state, 'active');
  assert.equal(body.version, 'unreleased');

  const maintenance = await handleFinance(new Request('https://finance.internal/overview'), {
    MODULE_CONTROL: { get: async () => ({ state: 'maintenance', message: 'janela' }) },
  }, {});
  assert.equal(maintenance.status, 503);
  assert.equal((await maintenance.json()).error, 'MODULE_MAINTENANCE');
});

test('Finance readiness fails closed when its D1 binding is unavailable', async () => {
  const readiness = await handleFinance(new Request('https://finance.internal/readiness'), {}, {});
  assert.equal(readiness.status, 503);
  const body = await readiness.json();
  assert.equal(body.ready, false);
  assert.equal(body.dependencies.d1.state, 'unavailable');
});

test('Finance canary rejects a non-pilot before domain data is touched', async () => {
  const encoder = new TextEncoder();
  const payload = btoa(JSON.stringify({ v: 1, audience: 'finance', issuedAt: Date.now(), actor: { username: 'non-pilot', allowedModules: ['finance'] }, csrf: '' })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const key = await crypto.subtle.importKey('raw', encoder.encode('test-secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload))))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const response = await handleFinance(new Request('https://finance.internal/overview', { headers: { 'x-skincos-domain-context': payload, 'x-skincos-domain-signature': signature } }), {
    APP_VERSION: 'a'.repeat(40), FINANCE_SERVICE_AUTH_SECRET: 'test-secret', MODULE_CONTROL: { get: async () => ({ state: 'canary', pilotActors: ['pilot'], pilotUnits: ['novo-hamburgo'], percentage: 100, releaseSha: 'a'.repeat(40), syntheticOnly: true }) },
  }, {});
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'FINANCE_CANARY_NOT_GRANTED');
});

test('Finance canary requires actor allowlist, unit cohort and deterministic percentage', () => {
  const availability = { state: 'canary', pilotActors: ['pilot'], pilotUnits: ['novo-hamburgo'], percentage: 100 };
  assert.equal(canUseCanary(availability, { username: 'pilot', allowedUnits: ['novo-hamburgo'] }), true);
  assert.equal(canUseCanary(availability, { username: 'pilot', allowedUnits: ['barra-shopping-sul'] }), false);
  assert.equal(canUseCanary({ ...availability, percentage: 0 }, { username: 'pilot', allowedUnits: ['novo-hamburgo'] }), false);
  assert.equal(canaryBucket('pilot'), canaryBucket('pilot'));
});

test('Finance canary fails closed when its selected artifact is not the promoted SHA', async () => {
  const response = await handleFinance(new Request('https://finance.internal/overview'), {
    APP_VERSION: 'b'.repeat(40), MODULE_CONTROL: { get: async () => ({ state: 'canary', pilotActors: ['pilot'], pilotUnits: ['novo-hamburgo'], percentage: 100, releaseSha: 'a'.repeat(40) }) },
  }, {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'FINANCE_CANARY_VERSION_MISMATCH');
});
