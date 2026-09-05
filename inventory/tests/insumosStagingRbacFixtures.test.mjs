import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const fixtureScript = fileURLToPath(new URL('../scripts/insumosStagingRbacFixtures.mjs', import.meta.url));
const migrations = new URL('../migrations/', import.meta.url);

function applySchema(database) {
  for (const name of readdirSync(migrations).filter((file) => /^\d{4}_.+\.sql$/.test(file)).sort()) {
    database.exec(readFileSync(new URL(name, migrations), 'utf8'));
  }
}

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

    const database = new DatabaseSync(':memory:');
    try {
      applySchema(database);
      database.exec(statement);
      const firstScenario = data.scenarios[0];
      database.prepare(`
        INSERT INTO crm_identity_sessions (id, username, session_version, created_at, last_seen_at)
        VALUES ('fixture-session', ?, 0, '2026-09-05T00:00:00.000Z', '2026-09-05T00:00:00.000Z')
      `).run(firstScenario.username);

      const teardownSql = join(dir, 'teardown.sql');
      const teardown = spawnSync(process.execPath, [fixtureScript, '--action', 'teardown', '--run-id', '123456', '--fixtures', fixture, '--sql', teardownSql], { encoding: 'utf8' });
      assert.equal(teardown.status, 0, teardown.stderr);
      database.exec(readFileSync(teardownSql, 'utf8'));
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM crm_users WHERE username=?').get(firstScenario.username).count, 0);
      assert.equal(database.prepare('SELECT session_version FROM crm_identity_session_epochs WHERE username=?').get(firstScenario.username).session_version, 0);
      const revoked = database.prepare('SELECT revoked_at, revoke_reason FROM crm_identity_sessions WHERE id=?').get('fixture-session');
      assert.ok(revoked.revoked_at);
      assert.equal(revoked.revoke_reason, 'USERNAME_RETIRED');

      const reprovisionSql = join(dir, 'reprovision.sql');
      const reprovision = spawnSync(process.execPath, [fixtureScript, '--action', 'provision', '--run-id', '123456', '--fixtures', fixture, '--sql', reprovisionSql], { encoding: 'utf8' });
      assert.equal(reprovision.status, 0, reprovision.stderr);
      database.exec(readFileSync(reprovisionSql, 'utf8'));
      assert.ok(database.prepare('SELECT session_version FROM crm_users WHERE username=?').get(firstScenario.username).session_version >= 1);
    } finally {
      database.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
