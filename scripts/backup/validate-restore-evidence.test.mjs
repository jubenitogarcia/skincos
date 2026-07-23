import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const script = join(process.cwd(), 'scripts/backup/validate-restore-evidence.mjs');
const evidence = (target) => ({ asset: 'postgres', sourceSnapshot: 'snapshot-1', target, startedAt: '2026-07-23T00:00:00Z', completedAt: '2026-07-23T00:03:00Z', checksum: 'a'.repeat(64), restoreVerified: true, validation: { schema: true, counts: true }, operator: 'backup-drill' });
const writeEvidence = (value) => { const file = join(mkdtempSync(join(tmpdir(), 'skincos-restore-evidence-')), 'evidence.json'); writeFileSync(file, JSON.stringify(value)); return file; };

test('accepts a verified scratch restore evidence', () => {
  const output = execFileSync(process.execPath, [script, writeEvidence(evidence({ kind: 'scratch', environment: 'staging' }))], { encoding: 'utf8' });
  assert.match(output, /"ok":true/);
});

test('rejects production as a restore-drill target', () => {
  assert.throws(() => execFileSync(process.execPath, [script, writeEvidence(evidence({ kind: 'isolated', environment: 'production' }))], { encoding: 'utf8', stdio: 'pipe' }));
});
