import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('canary evaluator separates authentication cold-start from Finance p95 latency', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'finance-canary-'));
  const policy = join(directory, 'policy.json'); const report = join(directory, 'report.json'); const output = join(directory, 'decision.json');
  await writeFile(policy, JSON.stringify({ module: 'finance', environment: 'staging', limits: { minimumSamples: 1, errors: 0, p95LatencyMs: 1000, authenticationFailures: 0, journeyFailures: 0, dataDivergences: 0, auditFailures: 0, dependencyFailures: 0 } }));
  await writeFile(report, JSON.stringify({ ok: true, samples: [{ name: 'login', durationMs: 2500 }, { name: 'health', durationMs: 100 }, { name: 'bootstrap', durationMs: 450 }], errors: 0, authenticationFailures: 0, journeyFailures: 0, dataDivergences: 0, auditFailures: 0, dependencyFailures: 0 }));
  execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/evaluate-canary.mjs', import.meta.url)), '--policy', policy, '--report', report, '--output', output]);
  const decision = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(decision.ok, true); assert.equal(decision.measured.p95LatencyMs, 450); assert.equal(decision.measured.authenticationLatencyMs, 2500);
});
