import assert from 'node:assert/strict';
import test from 'node:test';

import * as adapters from '../src/index.js';

test('aggregate public API exposes portable edge adapter contracts', () => {
  assert.equal(typeof adapters.callOptionalDependency, 'function');
  assert.equal(typeof adapters.fetchBoundService, 'function');
  assert.equal(typeof adapters.createSignedDomainContext, 'function');
  assert.equal(typeof adapters.verifySignedDomainContext, 'function');
  assert.equal(typeof adapters.createDependencyState, 'function');
});

test('resilience state remains local to the package consumer', () => {
  const state = adapters.createDependencyState();
  assert.ok(state instanceof Map);
  assert.equal(state.size, 0);
  assert.equal(new adapters.DependencyUnavailableError('service', 'offline').dependency, 'service');
});

test('every declared edge entrypoint resolves from the package source', async () => {
  const entries = [
    '../src/cloudflare-service-binding.js',
    '../src/signed-domain-context.js',
    '../src/resilience.js',
  ];

  for (const entry of entries) {
    const imported = await import(entry);
    assert.ok(Object.keys(imported).length > 0, 'entrypoint must export an adapter');
  }
});
