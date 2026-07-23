import assert from 'node:assert/strict';
import test from 'node:test';
import { createSignedDomainContext, verifySignedDomainContext } from './signed-domain-context.js';

test('signed domain context preserves only the authenticated actor and expires quickly', async () => {
  const now = 1_700_000_000_000;
  const headers = await createSignedDomainContext({ actor: { username: 'pilot', allowedModules: ['finance'] }, csrf: 'csrf', requestId: 'req-1' }, 'secret', 'finance', now);
  const request = new Request('https://finance.internal/overview', { headers });
  assert.deepEqual(await verifySignedDomainContext(request, 'secret', 'finance', { now }), { actor: { username: 'pilot', allowedModules: ['finance'] }, csrf: 'csrf', requestId: 'req-1' });
  assert.equal(await verifySignedDomainContext(request, 'wrong', 'finance', { now }), null);
  assert.equal(await verifySignedDomainContext(request, 'secret', 'finance', { now: now + 60_001 }), null);
});
