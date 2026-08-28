import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflow = fs.readFileSync(new URL('../workflows/deploy-core-workers.yml', import.meta.url), 'utf8');
const start = workflow.indexOf('          if [[ "$UNIT" == "api" || "$UNIT" == "all" ]]; then');
const end = workflow.indexOf('            [[ "$TIMEKEEPING_VERSION_ID"', start);
assert.ok(start >= 0 && end > start, 'API deployment block is missing');
const guard = workflow.slice(start, end);

test('API deploy waits for a stable Inventory RPC-capable release before cutover', () => {
  assert.match(guard, /if \[\[ "\$RELEASE_SCOPE" == "general" \]\]; then/);
  assert.match(guard, /if \[\[ "\$UNIT" == "all" \]\]; then\s+expected_inventory_sha="\$RELEASE_SHA"/);
  assert.match(guard, /expected_inventory_sha="\$INVENTORY_LEGACY_JOBS_RELEASE_SHA"/);
  assert.match(guard, /node --input-type=module - "\$expected_inventory_sha" "\$inventory_health_url"/);
  assert.match(guard, /const propagationDeadline = Date\.now\(\) \+ 75_000/);
  assert.match(guard, /while \(Date\.now\(\) <= propagationDeadline\)/);
  assert.match(guard, /AbortSignal\.timeout\(15_000\)/);
  assert.match(guard, /'cache-control': 'no-cache'/);
  assert.match(guard, /probe\.searchParams\.set\('legacy_jobs_release_probe'/);
  assert.match(guard, /health\?\.ready === true/);
  assert.match(guard, /String\(health\?\.version \|\| ''\)\.toLowerCase\(\) === expectedSha\.toLowerCase\(\)/);
  assert.match(guard, /health\?\.legacyApiJobsRpc === 'legacy-api-jobs-rpc\/v1'/);
  assert.match(guard, /if \(consecutiveValidSamples >= 2\)/);
  assert.match(guard, /Math\.min\(5_000, remainingMs\)/);
});

test('API rollback remains ordered before Inventory rollback', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../../shared/domain-boundaries.json', import.meta.url), 'utf8'));
  const binding = manifest.statefulServiceBindings.find((entry) => entry.id === 'api-inventory-legacy-jobs-rpc-v1');

  assert.deepEqual(binding.deployOrder, ['inventory', 'api']);
  assert.deepEqual(binding.rollbackOrder, ['api', 'inventory']);
  assert.equal(binding.healthCapability, 'legacy-api-jobs-rpc/v1');
});
