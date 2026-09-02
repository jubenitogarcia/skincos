import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const workflow = fileURLToPath(new URL('../../.github/workflows/insumos-production-smoke-identity.yml', import.meta.url));

test('the manual production Identity smoke verifies the opaque subject schema before it can mutate a synthetic user', () => {
  const source = readFileSync(workflow, 'utf8');

  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /const identitySubject = `idn:\$\{crypto\.randomBytes\(16\)\.toString\('hex'\)\}`/);
  assert.match(source, /const schema = `SELECT identity_subject FROM crm_users WHERE 1 = 0;\\n`/);
  assert.match(source, /name: Verify CRM identity subject schema before mutation/);
  assert.match(source, /identity_subject\)\\nSELECT/);
  assert.match(source, /identity_subject LIKE 'idn:%'/);
  assert.match(source, /opaque_subjects/);
  assert.match(source, /SMOKE_IDENTITY_OPAQUE_SUBJECT_COUNT/);
  assert.ok(
    source.indexOf('Verify CRM identity subject schema before mutation') < source.indexOf('Apply exact synthetic identity mutation'),
    'schema-sensitive preflight must remain before the production mutation',
  );
  assert.ok(
    source.indexOf('Read collision state after lease check') < source.indexOf('Apply exact synthetic identity mutation'),
    'collision read must remain before the provision mutation',
  );
});
