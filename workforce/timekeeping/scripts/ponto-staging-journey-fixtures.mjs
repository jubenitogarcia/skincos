/*
 * Generates one runner-private, synthetic CONSULTOR for the Ponto staging
 * journey. The output intentionally contains credentials only in the private
 * fixture JSON; SQL contains salted hashes, never the raw password or PIN.
 */
import { pbkdf2Sync, randomBytes, randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const usage = 'usage: node workforce/timekeeping/scripts/ponto-staging-journey-fixtures.mjs --action provision|teardown --run-id <github-run-id> --fixtures <private-json> --core-sql <sql-file> --timekeeping-sql <sql-file>';
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const action = String(args.get('--action') || '');
const runId = String(args.get('--run-id') || '');
const fixturesPath = args.get('--fixtures');
const coreSqlPath = args.get('--core-sql');
const timekeepingSqlPath = args.get('--timekeeping-sql');

if (!['provision', 'teardown'].includes(action) || !/^\d{1,20}$/.test(runId) || !fixturesPath || !coreSqlPath || !timekeepingSqlPath) {
  throw new Error(usage);
}

const sql = (value) => `'${String(value).replaceAll("'", "''")}'`;
const prefix = `stg-ponto-${runId}`;
const now = new Date().toISOString();
const password = () => `StgPonto-${randomBytes(18).toString('base64url')}`;
const pin = () => String(randomInt(100000, 1_000_000));
const passwordHash = (value) => {
  const salt = randomBytes(16);
  const digest = pbkdf2Sync(value, salt, 100_000, 32, 'sha256');
  return `pbkdf2_sha256$100000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
};
const pinCredential = (value) => {
  const salt = randomBytes(16);
  const iterations = 150_000;
  const digest = pbkdf2Sync(value, salt, iterations, 32, 'sha256');
  return { algorithm: 'PBKDF2-SHA256', iterations, saltB64: salt.toString('base64url'), hashB64: digest.toString('base64url') };
};

function audit(actionName, actor, detail) {
  return `INSERT INTO audit_log (ts, actor, role, action, entity, entity_id, unidade, ip, user_agent, idempotency_key, before_json, after_json) VALUES (${sql(now)}, ${sql(actor)}, 'SYSTEM', ${sql(actionName)}, 'staging_synthetic_ponto', ${sql(actor)}, '', '', 'github-actions', ${sql(`${prefix}:${actionName}`)}, NULL, ${sql(JSON.stringify(detail))});`;
}

function privateFixture() {
  const userName = `${prefix}-consultor`;
  const userPassword = password();
  const userPin = pin();
  return {
    schemaVersion: 1,
    environment: 'staging',
    runId,
    prefix,
    createdAt: now,
    username: userName,
    email: `${userName}@staging.invalid`,
    password: userPassword,
    pin: userPin,
    role: 'CONSULTOR',
    allowedModules: ['atendimento', 'ponto'],
    allowedUnits: [`${prefix}-unit`],
    unitId: `${prefix}-unit`,
    forbiddenUnitId: `${prefix}-other-unit`,
    employeeId: `${prefix}-employee`,
  };
}

function controlledFixture() {
  const fixture = JSON.parse(readFileSync(fixturesPath, 'utf8'));
  if (fixture?.environment !== 'staging' || fixture?.prefix !== prefix || fixture?.role !== 'CONSULTOR') {
    throw new Error('fixture file is not a matching Ponto staging fixture');
  }
  for (const field of ['username', 'email', 'password', 'pin', 'employeeId', 'unitId']) {
    if (!String(fixture[field] || '').startsWith(prefix) && !['password', 'pin'].includes(field)) throw new Error(`fixture ${field} escaped controlled prefix`);
  }
  if (!/^\d{6}$/.test(String(fixture.pin || ''))) throw new Error('fixture PIN is invalid');
  if (JSON.stringify(fixture.allowedModules) !== JSON.stringify(['atendimento', 'ponto'])) throw new Error('fixture modules drifted');
  return fixture;
}

if (action === 'provision') {
  const fixture = privateFixture();
  const credential = pinCredential(fixture.pin);
  mkdirSync(dirname(resolve(fixturesPath)), { recursive: true });
  writeFileSync(fixturesPath, JSON.stringify(fixture), { mode: 0o600 });

  const coreStatements = [
    `DELETE FROM crm_users WHERE username = ${sql(fixture.username)};`,
    `INSERT INTO crm_users (username, email, display_name, password_hash, role, photo_url, allowed_units_json, allowed_modules_json, ativo, created_at, updated_at, session_version) VALUES (${sql(fixture.username)}, ${sql(fixture.email)}, ${sql('Synthetic Ponto CONSULTOR')}, ${sql(passwordHash(fixture.password))}, 'CONSULTOR', '', ${sql(JSON.stringify(fixture.allowedUnits))}, ${sql(JSON.stringify(fixture.allowedModules))}, 1, ${sql(now)}, ${sql(now)}, 0);`,
    audit('STAGING_SYNTHETIC_PONTO_PROVISIONED', fixture.username, { runId, role: fixture.role, modules: fixture.allowedModules, unitCount: 1 }),
  ];
  const timekeepingStatements = [
    `DELETE FROM timekeeping_punch_evidence WHERE event_id IN (SELECT id FROM timekeeping_events WHERE employee_id = ${sql(fixture.employeeId)});`,
    `DELETE FROM timekeeping_corrections WHERE event_id IN (SELECT id FROM timekeeping_events WHERE employee_id = ${sql(fixture.employeeId)});`,
    `DELETE FROM timekeeping_events WHERE employee_id = ${sql(fixture.employeeId)};`,
    `DELETE FROM timekeeping_pin_failures WHERE employee_id = ${sql(fixture.employeeId)};`,
    `DELETE FROM timekeeping_pin_credentials WHERE employee_id = ${sql(fixture.employeeId)};`,
    `DELETE FROM timekeeping_employee_units WHERE employee_id = ${sql(fixture.employeeId)};`,
    `DELETE FROM workforce_employee_profiles WHERE employee_id = ${sql(fixture.employeeId)};`,
    `DELETE FROM workforce_employee_unit_hierarchy WHERE employee_id = ${sql(fixture.employeeId)};`,
    `DELETE FROM workforce_employees WHERE id = ${sql(fixture.employeeId)};`,
    `DELETE FROM timekeeping_unit_presence_policies WHERE unit_id = ${sql(fixture.unitId)};`,
    `DELETE FROM workforce_units WHERE id = ${sql(fixture.unitId)};`,
    `INSERT INTO workforce_units (id, canonical_unit_id, display_name, timezone, active, created_at, updated_at) VALUES (${sql(fixture.unitId)}, ${sql(fixture.unitId)}, 'Synthetic Ponto staging unit', 'America/Sao_Paulo', 1, ${sql(now)}, ${sql(now)});`,
    `INSERT INTO workforce_employees (id, canonical_employee_id, login_email, display_name, status, access_state, metadata_json, created_at, updated_at) VALUES (${sql(fixture.employeeId)}, ${sql(fixture.employeeId)}, ${sql(fixture.email)}, 'Synthetic Ponto CONSULTOR', 'ACTIVE', 'ACTIVE', '{}', ${sql(now)}, ${sql(now)});`,
    `INSERT INTO timekeeping_employee_units (id, employee_id, unit_id, effective_from, effective_to, created_at) VALUES (${sql(`${fixture.employeeId}-unit`)}, ${sql(fixture.employeeId)}, ${sql(fixture.unitId)}, '2020-01-01', NULL, ${sql(now)});`,
    `INSERT INTO timekeeping_unit_presence_policies (unit_id, presence_mode, geofence_latitude, geofence_longitude, geofence_radius_meters, created_at, updated_at, updated_by) VALUES (${sql(fixture.unitId)}, 'FLEXIBLE', NULL, NULL, 150, ${sql(now)}, ${sql(now)}, 'github-actions-synthetic');`,
    `INSERT INTO timekeeping_pin_credentials (employee_id, algorithm, salt_b64, hash_b64, iterations, updated_by, updated_at) VALUES (${sql(fixture.employeeId)}, ${sql(credential.algorithm)}, ${sql(credential.saltB64)}, ${sql(credential.hashB64)}, ${credential.iterations}, 'github-actions-synthetic', ${sql(now)});`,
  ];
  writeFileSync(coreSqlPath, `${coreStatements.join('\n')}\n`, { mode: 0o600 });
  writeFileSync(timekeepingSqlPath, `${timekeepingStatements.join('\n')}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ action, environment: 'staging', role: fixture.role, modules: fixture.allowedModules, credentialsWrittenToPrivateFile: true }));
} else {
  const fixture = controlledFixture();
  const coreStatements = [
    audit('STAGING_SYNTHETIC_PONTO_TORN_DOWN', fixture.username, { runId, result: 'deleted' }),
    `DELETE FROM auth_attempts WHERE username = ${sql(fixture.username)};`,
    `DELETE FROM crm_user_prefs WHERE username = ${sql(fixture.username)};`,
    `DELETE FROM crm_users WHERE username = ${sql(fixture.username)};`,
  ];
  // Preserve the immutable timekeeping audit ledger. Only synthetic operational
  // records with this exact run-scoped employee/unit may be removed.
  const timekeepingStatements = [
    `DELETE FROM timekeeping_punch_evidence WHERE event_id IN (SELECT id FROM timekeeping_events WHERE employee_id = ${sql(fixture.employeeId)});`,
    `DELETE FROM timekeeping_corrections WHERE event_id IN (SELECT id FROM timekeeping_events WHERE employee_id = ${sql(fixture.employeeId)});`,
    `DELETE FROM timekeeping_events WHERE employee_id = ${sql(fixture.employeeId)};`,
    `DELETE FROM timekeeping_pin_failures WHERE employee_id = ${sql(fixture.employeeId)};`,
    `DELETE FROM timekeeping_pin_credentials WHERE employee_id = ${sql(fixture.employeeId)};`,
    `DELETE FROM timekeeping_employee_units WHERE employee_id = ${sql(fixture.employeeId)};`,
    `DELETE FROM workforce_employee_profiles WHERE employee_id = ${sql(fixture.employeeId)};`,
    `DELETE FROM workforce_employee_unit_hierarchy WHERE employee_id = ${sql(fixture.employeeId)};`,
    `DELETE FROM workforce_employees WHERE id = ${sql(fixture.employeeId)};`,
    `DELETE FROM timekeeping_unit_presence_policies WHERE unit_id = ${sql(fixture.unitId)};`,
    `DELETE FROM workforce_units WHERE id = ${sql(fixture.unitId)};`,
  ];
  writeFileSync(coreSqlPath, `${coreStatements.join('\n')}\n`, { mode: 0o600 });
  writeFileSync(timekeepingSqlPath, `${timekeepingStatements.join('\n')}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ action, environment: 'staging', syntheticOperationalRecordsRemoved: true, timekeepingAuditPreserved: true }));
}
