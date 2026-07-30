import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { validateOnboardingInput } from '../../../shared/identity-runtime/inventory-compat.js';

const script = new URL('./ponto-staging-journey-fixtures.mjs', import.meta.url);
const inventoryMigrations = new URL('../../../inventory/migrations/', import.meta.url);

function generate(action, paths, fixtureId = '') {
  const argv = [
    script.pathname,
    '--action', action,
    '--run-id', '123456789',
    ...(fixtureId ? ['--fixture-id', fixtureId] : []),
    '--fixtures', paths.fixture,
    '--core-sql', paths.core,
    '--timekeeping-sql', paths.timekeeping,
  ];
  execFileSync(process.execPath, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

test('staging fixture SQL is run-scoped, secret-free, and teardown preserves audit', () => {
  const directory = mkdtempSync(join(tmpdir(), 'skincos-ponto-fixture-'));
  const paths = {
    fixture: join(directory, 'fixture.json'),
    core: join(directory, 'core.sql'),
    timekeeping: join(directory, 'timekeeping.sql'),
  };

  try {
    generate('provision', paths);
    const fixture = JSON.parse(readFileSync(paths.fixture, 'utf8'));
    const provisionCore = readFileSync(paths.core, 'utf8');
    const provisionTimekeeping = readFileSync(paths.timekeeping, 'utf8');

    assert.deepEqual(fixture.allowedModules, ['atendimento', 'ponto']);
    assert.deepEqual(fixture.allowedUnits, ['novo-hamburgo']);
    assert.equal(fixture.unitId, 'novo-hamburgo');
    assert.equal(fixture.forbiddenUnitId, 'barra-shopping-sul');
    assert.equal(fixture.role, 'CONSULTOR');
    assert.match(fixture.onboardingId, /^[0-9a-f]{64}$/);
    assert.deepEqual(validateOnboardingInput({
      fullName: 'Synthetic Ponto Supervisor',
      corporateEmail: fixture.onboardingCorporateEmail,
      personalEmail: fixture.onboardingPersonalEmail,
      mobilePhone: fixture.onboardingPhone,
      jobTitle: 'supervisor',
      department: fixture.onboardingDepartment,
      units: [fixture.unitId],
    }), {
      fullName: 'Synthetic Ponto Supervisor',
      corporateEmail: fixture.onboardingCorporateEmail,
      personalEmail: fixture.onboardingPersonalEmail,
      mobilePhone: fixture.onboardingPhone,
      units: ['novo-hamburgo'],
      department: fixture.onboardingDepartment,
      profile: 'SUPERVISOR',
      rank: 2,
      modules: [],
      accountStatus: 'PENDING_ACCESS',
    });
    if (process.platform !== 'win32') {
      assert.equal(statSync(paths.fixture).mode & 0o777, 0o600);
    }
    for (const secret of [fixture.password, fixture.adminPassword, fixture.pin]) {
      assert.equal(provisionCore.includes(secret), false);
      assert.equal(provisionTimekeeping.includes(secret), false);
    }
    assert.match(provisionCore, /Synthetic Ponto CONSULTOR/);
    assert.match(provisionCore, /Synthetic Ponto GESTOR/);
    assert.match(provisionCore, /'GESTOR'.*'\["insumos"\]'/);
    assert.equal((provisionCore.match(/DELETE FROM crm_identity_sessions/g) || []).length, 2);
    assert.match(provisionTimekeeping, new RegExp(fixture.employeeId));
    assert.match(provisionTimekeeping, new RegExp(fixture.unitId));
    assert.match(provisionTimekeeping, /INSERT OR IGNORE INTO timekeeping_unit_presence_policies/);
    assert.doesNotMatch(provisionTimekeeping, /(?:INSERT INTO|DELETE FROM) workforce_units/);

    const database = new DatabaseSync(':memory:');
    try {
      for (const migration of readdirSync(inventoryMigrations).filter((name) => name.endsWith('.sql')).sort()) {
        database.exec(readFileSync(new URL(migration, inventoryMigrations), 'utf8'));
      }
      database.exec(provisionCore);
      const insertSession = database.prepare(`
        INSERT INTO crm_identity_sessions
          (id, username, session_version, created_at, last_seen_at)
        VALUES (?, ?, 0, ?, ?)
      `);
      insertSession.run(`${fixture.prefix}-consultor-session`, fixture.username, fixture.createdAt, fixture.createdAt);
      insertSession.run(`${fixture.prefix}-admin-session`, fixture.adminUsername, fixture.createdAt, fixture.createdAt);
      database.prepare(`
        INSERT INTO crm_employee_onboarding
          (id, full_name, corporate_email, personal_email_encrypted, personal_email_hash,
           mobile_phone_encrypted, mobile_phone_hash, profile, job_title, department_name,
           units_json, account_status, created_by, created_at, updated_at)
        VALUES (?, 'Synthetic Ponto Supervisor', ?, 'ciphertext', 'personal-hash',
                'ciphertext', 'phone-hash', 'SUPERVISOR', 'supervisor', ?,
                '["novo-hamburgo"]', 'PENDING_ACCESS', ?, ?, ?)
      `).run(
        fixture.onboardingId,
        fixture.onboardingCorporateEmail,
        fixture.onboardingDepartment,
        fixture.adminUsername,
        fixture.createdAt,
        fixture.createdAt,
      );
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM crm_users WHERE username IN (?, ?)').get(
        fixture.username,
        fixture.adminUsername,
      ).count, 2);
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM crm_identity_sessions WHERE username IN (?, ?)').get(
        fixture.username,
        fixture.adminUsername,
      ).count, 2);

      fixture.teardownRequestIds = ['request-incumbent-1', 'request-incumbent-2'];
      writeFileSync(paths.fixture, JSON.stringify(fixture), { mode: 0o600 });
      generate('teardown', paths);
      const teardownCore = readFileSync(paths.core, 'utf8');
      const teardownTimekeeping = readFileSync(paths.timekeeping, 'utf8');

      database.exec(teardownCore);
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM crm_users WHERE username IN (?, ?)').get(
        fixture.username,
        fixture.adminUsername,
      ).count, 0);
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM crm_identity_sessions WHERE username IN (?, ?)').get(
        fixture.username,
        fixture.adminUsername,
      ).count, 0);
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM crm_employee_onboarding WHERE id = ?').get(
        fixture.onboardingId,
      ).count, 0);
      assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE entity = 'staging_synthetic_ponto'").get().count, 2);

      for (const secret of [fixture.password, fixture.adminPassword, fixture.pin]) {
        assert.equal(teardownCore.includes(secret), false);
        assert.equal(teardownTimekeeping.includes(secret), false);
      }
      assert.match(teardownCore, /STAGING_SYNTHETIC_PONTO_TORN_DOWN/);
      assert(
        teardownCore.indexOf('STAGING_SYNTHETIC_PONTO_TORN_DOWN') > teardownCore.lastIndexOf('DELETE FROM crm_users'),
        'teardown audit must be appended only after operational deletes',
      );
      assert.equal((teardownCore.match(/DELETE FROM crm_identity_sessions/g) || []).length, 2);
      assert.equal(teardownTimekeeping.includes('DELETE FROM audit_log'), false);
      assert.match(teardownTimekeeping, new RegExp(`identity:${fixture.onboardingId}`));
      assert.match(teardownTimekeeping, /DELETE FROM timekeeping_request_nonces WHERE request_id IN \('request-incumbent-1','request-incumbent-2'\)/);
      assert.match(teardownTimekeeping, /updated_by = 'stg-ponto-123456789:presence-policy'/);
      assert.doesNotMatch(teardownTimekeeping, /DELETE FROM workforce_units/);
    } finally {
      database.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rollback drill fixtures are fresh, independently scoped, and cannot cross-teardown', () => {
  const directory = mkdtempSync(join(tmpdir(), 'skincos-ponto-rollback-fixtures-'));
  const incumbent = {
    fixture: join(directory, 'incumbent.json'),
    core: join(directory, 'incumbent-core.sql'),
    timekeeping: join(directory, 'incumbent-timekeeping.sql'),
  };
  const candidate = {
    fixture: join(directory, 'candidate.json'),
    core: join(directory, 'candidate-core.sql'),
    timekeeping: join(directory, 'candidate-timekeeping.sql'),
  };

  try {
    generate('provision', incumbent, 'incumbent');
    generate('provision', candidate, 'candidate');
    const incumbentFixture = JSON.parse(readFileSync(incumbent.fixture, 'utf8'));
    const candidateFixture = JSON.parse(readFileSync(candidate.fixture, 'utf8'));

    assert.equal(incumbentFixture.fixtureId, 'incumbent');
    assert.equal(candidateFixture.fixtureId, 'candidate');
    assert.equal(incumbentFixture.runId, candidateFixture.runId);
    assert.notEqual(incumbentFixture.prefix, candidateFixture.prefix);
    assert.notEqual(incumbentFixture.username, candidateFixture.username);
    assert.notEqual(incumbentFixture.email, candidateFixture.email);
    assert.notEqual(incumbentFixture.password, candidateFixture.password);
    assert.notEqual(incumbentFixture.pin, candidateFixture.pin);

    assert.throws(() => generate('teardown', incumbent, 'candidate'));
    generate('teardown', incumbent, 'incumbent');
    generate('teardown', candidate, 'candidate');
    assert.match(readFileSync(incumbent.core, 'utf8'), /stg-ponto-123456789-incumbent/);
    assert.match(readFileSync(candidate.core, 'utf8'), /stg-ponto-123456789-candidate/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
