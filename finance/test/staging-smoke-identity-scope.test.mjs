import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = new URL('../scripts/staging-smoke-identity-sql.mjs', import.meta.url);
const password = 'synthetic-test-password-with-at-least-24-characters';

function generate(action) {
  const directory = mkdtempSync(join(tmpdir(), 'skincos-finance-smoke-'));
  const core = join(directory, 'core.sql');
  const finance = join(directory, 'finance.sql');
  try {
    const result = spawnSync(process.execPath, [script.pathname, action, '--expires-at', '2026-08-01T00:00:00.000Z', '--core-output', core, '--finance-output', finance], {
      env: { ...process.env, FINANCE_SMOKE_IDENTITY_ACK: '1', FINANCE_SMOKE_PASSWORD: password },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    return { core: readFileSync(core, 'utf8'), finance: readFileSync(finance, 'utf8') };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('synthetic Finance identity preserves only the explicit Finance module in the shell', () => {
  const provision = generate('provision');
  const rotation = generate('rotate');

  assert.match(provision.core, /'INJETOR'/);
  assert.match(provision.core, /'\["finance"\]'/);
  assert.doesNotMatch(provision.core, /'CONSULTOR'/);
  assert.match(rotation.core, /role='INJETOR'/);
  assert.match(rotation.core, /allowed_modules_json='\["finance"\]'/);
  assert.match(rotation.finance, /finance_access_grant/);
});
