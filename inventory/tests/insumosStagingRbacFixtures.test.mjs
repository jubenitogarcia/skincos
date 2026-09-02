import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const fixtureScript = fileURLToPath(new URL('../scripts/insumosStagingRbacFixtures.mjs', import.meta.url));

test('staging RBAC fixtures are bounded, synthetic and auditable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skincos-rbac-fixtures-'));
  const fixture = join(dir, 'fixture.json');
  const sql = join(dir, 'provision.sql');
  try {
    const out = spawnSync(process.execPath, [fixtureScript, '--action', 'provision', '--run-id', '123456', '--fixtures', fixture, '--sql', sql], { encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    const data = JSON.parse(readFileSync(fixture, 'utf8'));
    assert.equal(data.environment, 'staging');
    assert.equal(data.scenarios.length, 7);
    assert.deepEqual(data.scenarios.find((item) => item.id === 'alias').allowedUnits, ['NH']);
    assert.equal(data.scenarios.find((item) => item.id === 'consultor').role, 'CONSULTOR');
    const subjects = data.scenarios.map((item) => String(item.identitySubject || ''));
    assert.ok(subjects.every((subject) => /^idn:[A-Za-z0-9_-]{16,160}$/.test(subject)));
    assert.equal(new Set(subjects).size, data.scenarios.length);
    assert.deepEqual(data.teamMembers.map((item) => item.units), [['novo-hamburgo'], ['barra-shopping-sul'], ['novo-hamburgo', 'barra-shopping-sul']]);
    const statement = readFileSync(sql, 'utf8');
    assert.match(statement, /STAGING_SYNTHETIC_IDENTITY_PROVISIONED/);
    assert.match(statement, /STAGING_SYNTHETIC_TEAM_PROVISIONED/);
    assert.match(statement, /crm_employee_onboarding/);
    assert.match(statement, /crm_employee_team/);
    assert.match(statement, /identity_subject/);
    for (const subject of subjects) assert.match(statement, new RegExp(subject));
    assert.match(statement, /\["insumos"\]/);
    assert.doesNotMatch(statement, /\["inventory"\]/);
    assert.doesNotMatch(statement, /BEGIN TRANSACTION|COMMIT;/);
    assert.doesNotMatch(statement, /api\.skincos\.com\.br/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
