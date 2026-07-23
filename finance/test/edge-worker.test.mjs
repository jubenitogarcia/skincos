import assert from 'node:assert/strict';
import test from 'node:test';
import { handleFinance } from '../worker.js';

test('Finance exposes health without a public domain route and honors runtime maintenance', async () => {
  const health = await handleFinance(new Request('https://finance.internal/health'), {}, {});
  assert.equal(health.status, 200);
  assert.equal((await health.json()).availability.state, 'active');

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
