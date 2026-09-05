import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = new URL('../scripts/staging-smoke-identity-sql.mjs', import.meta.url);
const monitorScript = new URL('../scripts/staging-test-identity-sql.mjs', import.meta.url);
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
  assert.match(provision.core, /UPDATE crm_users SET/);
  assert.match(provision.core, /WHERE username='finance-staging-smoke' AND ativo=0/);
  assert.match(provision.core, /WHERE NOT EXISTS \(SELECT 1 FROM crm_users/);
  assert.match(provision.core, /identity_subject=CASE WHEN identity_subject IS NULL OR trim\(identity_subject\) = '' THEN 'idn:[0-9a-f]{32}' ELSE identity_subject END/);
  assert.match(provision.core, /identity_subject\) SELECT/);
  assert.doesNotMatch(provision.core, /'CONSULTOR'/);
  assert.match(rotation.core, /role='INJETOR'/);
  assert.match(rotation.core, /allowed_modules_json='\["finance"\]'/);
  assert.match(rotation.core, /identity_subject=CASE WHEN identity_subject IS NULL OR trim\(identity_subject\) = '' THEN 'idn:[0-9a-f]{32}' ELSE identity_subject END/);
  assert.match(provision.finance, /ON CONFLICT\(username,scope_id\) DO UPDATE/);
  assert.match(rotation.finance, /ON CONFLICT\(username,scope_id\) DO UPDATE/);
  assert.match(rotation.finance, /finance_access_grant/);
});

test('the independent Finance monitor fixture creates an opaque subject and repairs only an absent legacy subject', () => {
  const directory = mkdtempSync(join(tmpdir(), 'skincos-finance-monitor-'));
  const output = join(directory, 'monitor.sql');
  try {
    const env = {
      ...process.env,
      FINANCE_STAGING_IDENTITY_ACK: '1',
      FINANCE_STAGING_TEST_PASSWORD: password,
    };
    const create = spawnSync(process.execPath, [monitorScript.pathname, 'create', '--output', output], { env, encoding: 'utf8' });
    assert.equal(create.status, 0, create.stderr);
    const createdSql = readFileSync(output, 'utf8');
    assert.match(createdSql, /identity_subject\) VALUES\([^\n]*'idn:[0-9a-f]{32}'\)/);

    const rotate = spawnSync(process.execPath, [monitorScript.pathname, 'rotate', '--output', output], { env, encoding: 'utf8' });
    assert.equal(rotate.status, 0, rotate.stderr);
    const rotateSql = readFileSync(output, 'utf8');
    assert.match(rotateSql, /identity_subject=CASE WHEN identity_subject IS NULL OR trim\(identity_subject\) = '' THEN 'idn:[0-9a-f]{32}' ELSE identity_subject END/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
