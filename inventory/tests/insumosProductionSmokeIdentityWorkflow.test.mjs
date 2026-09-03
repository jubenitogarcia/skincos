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
  const schemaStepStart = source.indexOf('name: Verify CRM identity subject schema before mutation');
  const schemaStepEnd = source.indexOf('name: Check synthetic identity collision');
  assert.ok(schemaStepEnd > schemaStepStart, 'schema preflight step must have a bounded workflow scope');
  const schemaStep = source.slice(schemaStepStart, schemaStepEnd);
  assert.match(schemaStep, /schema_command="\$\(<"\$\{RUNNER_TEMP_DIR\}\/schema\.sql"\)"/);
  assert.doesNotMatch(
    schemaStep,
    /\n\s+if:/,
    'schema preflight must run for cleanup as well as provision',
  );
  assert.ok(
    schemaStepStart < source.indexOf('Apply exact synthetic identity mutation'),
    'schema-sensitive preflight must remain before the production mutation',
  );
  assert.ok(
    source.indexOf('Read collision state after lease check') < source.indexOf('Apply exact synthetic identity mutation'),
    'collision read must remain before the provision mutation',
  );
});
