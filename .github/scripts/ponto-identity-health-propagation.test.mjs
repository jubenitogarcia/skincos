import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflow = fs.readFileSync(new URL('../workflows/deploy-core-workers.yml', import.meta.url), 'utf8');
const start = workflow.indexOf('      - name: Probe and attest exact staging Identity version');
const end = workflow.indexOf('      - name: Restore staging Identity incumbent after failure or cancellation', start);
assert.ok(start >= 0 && end > start, 'staging Identity health proof block is missing');
const proof = workflow.slice(start, end);

test('staging Identity health proof waits for bounded edge propagation and stable candidate samples', () => {
  assert.match(proof, /node --input-type=module/);
  assert.match(proof, /const propagationDeadline = Date\.now\(\) \+ 75_000/);
  assert.match(proof, /while \(Date\.now\(\) <= propagationDeadline\)/);
  assert.match(proof, /AbortSignal\.timeout\(15_000\)/);
  assert.match(proof, /"cache-control": "no-cache"/);
  assert.match(proof, /probe\.searchParams\.set\("identity_release_probe"/);
  assert.match(proof, /let consecutiveValidSamples = 0/);
  assert.match(proof, /if \(consecutiveValidSamples >= 2\)/);
  assert.match(proof, /Math\.min\(5_000, remainingMs\)/);
  assert.match(proof, /health\?\.version === process\.env\.RELEASE_SHA/);
  assert.match(proof, /health\?\.environment === "staging"/);
  assert.match(proof, /workerVersionId === String\(process\.env\.CANDIDATE_ID \|\| ""\)\.toLowerCase\(\)/);
  assert.match(proof, /workerVersionTag === expectedTag/);
});
