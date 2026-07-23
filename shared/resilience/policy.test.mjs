import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { callOptionalDependency, createDependencyState, requiredDependencyFailure } from './dependency.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const policy = JSON.parse(fs.readFileSync(path.join(root, 'ops/resilience/dependency-policy.json'), 'utf8'));

for (const [module, config] of Object.entries(policy.modules)) {
  for (const dependency of config.hard) {
    test(`${module} contains failure of required ${dependency} without claiming pending sync`, () => {
      const response = requiredDependencyFailure({ dependency, requestId: 'test-request' });
      assert.equal(response.error, 'required_dependency_unavailable');
      assert.equal(response.pendingSynchronization, false);
    });
  }
  for (const dependency of Object.keys(config.optional)) {
    test(`${module} remains operational when optional ${dependency} is down`, async () => {
      const result = await callOptionalDependency({
        dependency: `${module}:${dependency}`,
        state: createDependencyState(),
        timeoutMs: 5,
        failureThreshold: 1,
        invoke: async () => { throw new Error('dependency deliberately down'); },
        fallback: ({ dependency: name }) => ({ module, dependency: name, capability: 'degraded' }),
      });
      assert.equal(result.mode, 'degraded');
      assert.equal(result.pendingSynchronization, true);
      assert.equal(result.value.capability, 'degraded');
    });
  }
}
