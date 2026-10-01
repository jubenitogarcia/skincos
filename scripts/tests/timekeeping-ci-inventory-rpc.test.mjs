import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflow = fs.readFileSync(new URL('../../.github/workflows/timekeeping-ci.yml', import.meta.url), 'utf8');
const triggerSection = workflow.slice(0, workflow.indexOf('\npermissions:'));

function triggerBlock(name) {
  const start = triggerSection.indexOf(`  ${name}:`);
  assert.ok(start >= 0, `${name} trigger is missing`);
  const rest = triggerSection.slice(start + name.length + 4);
  const next = /\n  [A-Za-z_][A-Za-z0-9_-]*:/.exec(rest);
  return rest.slice(0, next?.index);
}

test('Inventory/API RPC surfaces trigger Timekeeping CI for pull requests and main pushes', () => {
  const requiredPaths = [
    'api/workers/legacy-inventory-durable-objects.js',
    'api/wrangler.toml',
    'inventory/src/legacy-api-jobs.js',
    'inventory/workers/**',
    'inventory/tests/legacyApiJobsContract.test.mjs',
    'inventory/wrangler.toml',
    '.github/scripts/inventory-legacy-jobs-release-guard.test.mjs',
    'scripts/tests/timekeeping-ci-inventory-rpc.test.mjs',
  ];

  for (const trigger of ['pull_request', 'push']) {
    const block = triggerBlock(trigger);
    for (const entry of requiredPaths) {
      assert.match(block, new RegExp(`- '${entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
    }
  }
});

test('Inventory/API RPC gate executes the contract test and both Inventory dry-runs', () => {
  const start = workflow.indexOf('      - name: Test gateway routing');
  const end = workflow.indexOf('      - name: Test governed Ponto release contracts', start);
  assert.ok(start >= 0 && end > start, 'gateway routing gate is missing');
  const gate = workflow.slice(start, end);

  assert.match(gate, /node --test inventory\/tests\/legacyApiJobsContract\.test\.mjs/);
  assert.match(
    gate,
    /inventory\/node_modules\/\.bin\/wrangler deploy --dry-run --config inventory\/wrangler\.toml --outdir "\$RUNNER_TEMP\/inventory-production-dry-run"/,
  );
  assert.match(
    gate,
    /inventory\/node_modules\/\.bin\/wrangler deploy --dry-run --config inventory\/wrangler\.toml --env staging --outdir "\$RUNNER_TEMP\/inventory-staging-dry-run"/,
  );
});
