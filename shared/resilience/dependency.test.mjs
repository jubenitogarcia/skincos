import assert from 'node:assert/strict';
import test from 'node:test';
import { callOptionalDependency, createDependencyState } from './dependency.js';

test('optional dependency times out, degrades and opens its circuit without blocking the caller', async () => {
  const state = createDependencyState();
  const result = await callOptionalDependency({ dependency: 'inventory', state, timeoutMs: 5, failureThreshold: 1, cooldownMs: 1000, invoke: () => new Promise(() => {}), fallback: ({ mode }) => ({ ok: false, mode }) });
  assert.equal(result.mode, 'degraded');
  assert.equal(result.pendingSynchronization, true);
  const open = await callOptionalDependency({ dependency: 'inventory', state, invoke: () => { throw new Error('must not be called while open'); }, fallback: ({ mode }) => ({ ok: false, mode }) });
  assert.equal(open.mode, 'circuit-open');
});

test('safe cached projection is returned with pending synchronization when optional dependency fails', async () => {
  const cache = new Map(); const state = createDependencyState(); let clock = 1;
  const live = await callOptionalDependency({ dependency: 'ads', state, cache, cacheKey: 'ads:report', cacheTtlMs: 1000, now: () => clock, invoke: async () => ({ report: 'snapshot' }), fallback: () => null });
  assert.equal(live.mode, 'live');
  clock += 1;
  const stale = await callOptionalDependency({ dependency: 'ads', state, cache, cacheKey: 'ads:report', cacheTtlMs: 1000, now: () => clock, invoke: async () => { throw new Error('offline'); }, fallback: () => null });
  assert.equal(stale.mode, 'degraded');
  assert.deepEqual(stale.value, { report: 'snapshot' });
  assert.equal(stale.pendingSynchronization, true);
});
