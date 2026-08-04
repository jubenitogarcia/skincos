/*
 * Generates one runner-private, synthetic CONSULTOR for the Ponto staging
 * journey. The output intentionally contains credentials only in the private
 * fixture JSON; SQL contains salted hashes, never the raw password or PIN.
 */
import { createHash, pbkdf2Sync, randomBytes, randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DEFAULT_PIN_ITERATIONS, hashPin } from '../security.js';

const usage = 'usage: node workforce/timekeeping/scripts/ponto-staging-journey-fixtures.mjs --action provision|teardown --run-id <github-run-id> [--fixture-id <label>] --fixtures <private-json> --core-sql <sql-file> --timekeeping-sql <sql-file>';
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const action = String(args.get('--action') || '');
const runId = String(args.get('--run-id') || '');
const fixtureId = String(args.get('--fixture-id') || '');
const fixturesPath = args.get('--fixtures');
const coreSqlPath = args.get('--core-sql');
const timekeepingSqlPath = args.get('--timekeeping-sql');

if (
  !['provision', 'teardown'].includes(action)
  || !/^\d{1,20}$/.test(runId)
  || (fixtureId && !/^[a-z][a-z0-9-]{0,31}$/.test(fixtureId))
  || !fixturesPath
  || !coreSqlPath
  || !timekeepingSqlPath
) {
  throw new Error(usage);
}

const sql = (value) => `'${String(value).replaceAll("'", "''")}'`;
const prefix = `stg-ponto-${runId}${fixtureId ? `-${fixtureId}` : ''}`;
const now = new Date().toISOString();
const password = () => `StgPonto-${randomBytes(18).toString('base64url')}`;
const pin = () => String(randomInt(100000, 1_000_000));
const passwordHash = (value) => {
  const salt = randomBytes(16);
  const digest = pbkdf2Sync(value, salt, 100_000, 32, 'sha256');
  return `pbkdf2_sha256$100000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
};
const pinCredential = (value) => hashPin(value, DEFAULT_PIN_ITERATIONS);

function audit(actionName, actor, detail) {
  return `INSERT INTO audit_log (ts, actor, role, action, entity, entity_id, unidade, ip, user_agent, idempotency_key, before_json, after_json) VALUES (${sql(now)}, ${sql(actor)}, 'SYSTEM', ${sql(actionName)}, 'staging_synthetic_ponto', ${sql(actor)}, '', '', 'github-actions', ${sql(`${prefix}:${actionName}`)}, NULL, ${sql(JSON.stringify(detail))});`;
}

function privateFixture() {
  const userName = `${prefix}-consultor`;
  const userPassword = password();
  const adminUsername = `${prefix}-admin`;
  const adminPassword = password();
  const userPin = pin();
  const onboardingCorporateEmail = `${prefix}-onboarding@staging.invalid`;
  return {
    schemaVersion: 1,
    environment: 'staging',
    runId,
    fixtureId,
    prefix,
    createdAt: now,
    username: userName,
    email: `${userName}@staging.invalid`,
    password: userPassword,
    adminUsername,
    adminEmail: `${adminUsername}@staging.invalid`,
    adminPassword,
    pin: userPin,
    role: 'CONSULTOR',
    allowedModules: ['atendimento', 'ponto'],
    // Identity is deliberately fail-closed to the two canonical clinic unit
    // scopes. Synthetic actors use those scopes while their employee IDs and
    // data remain run-scoped.
    allowedUnits: ['novo-hamburgo'],
    unitId: 'novo-hamburgo',
    forbiddenUnitId: 'barra-shopping-sul',
    employeeId: `${prefix}-employee`,
    onboardingId: createHash('sha256').update(`employee-onboarding:v1:${onboardingCorporateEmail}`).digest('hex'),
    onboardingCorporateEmail,
    onboardingPersonalEmail: `${prefix}-personal@staging.invalid`,
    onboardingPhone: '+5551999999999',
    onboardingDepartment: `${prefix}-department`,
    teardownRequestIds: [],
    teardownEventIds: [],
  };
}

function controlledFixture() {
  const fixture = JSON.parse(readFileSync(fixturesPath, 'utf8'));
  if (
    fixture?.environment !== 'staging'
    || fixture?.runId !== runId
    || String(fixture?.fixtureId || '') !== fixtureId
    || fixture?.prefix !== prefix
    || fixture?.role !== 'CONSULTOR'
  ) {
    throw new Error('fixture file is not a matching Ponto staging fixture');
  }
  for (const field of ['username', 'email', 'password', 'adminUsername', 'adminEmail', 'adminPassword', 'pin', 'employeeId', 'onboardingCorporateEmail', 'onboardingPersonalEmail', 'onboardingDepartment']) {
    if (!String(fixture[field] || '').startsWith(prefix) && !['password', 'adminPassword', 'pin'].includes(field)) throw new Error(`fixture ${field} escaped controlled prefix`);
  }
  if (fixture.unitId !== 'novo-hamburgo' || fixture.forbiddenUnitId !== 'barra-shopping-sul' || JSON.stringify(fixture.allowedUnits) !== JSON.stringify(['novo-hamburgo'])) throw new Error('fixture unit scope drifted');
  if (!/^[0-9a-f]{64}$/.test(String(fixture.onboardingId || ''))) throw new Error('fixture onboardingId is invalid');
  if (fixture.onboardingPhone !== '+5551999999999') throw new Error('fixture onboardingPhone is invalid');
  if (
    !Array.isArray(fixture.teardownRequestIds || [])
    || (fixture.teardownRequestIds || []).some((value) => !/^[A-Za-z0-9._:-]{1,180}$/.test(String(value)))
  ) throw new Error('fixture teardown request ids are invalid');
  if (
    !Array.isArray(fixture.teardownEventIds || [])
    || (fixture.teardownEventIds || []).some((value) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value)))
  ) throw new Error('fixture teardown event ids are invalid');
  if (!/^\d{6}$/.test(String(fixture.pin || ''))) throw new Error('fixture PIN is invalid');
  if (JSON.stringify(fixture.allowedModules) !== JSON.stringify(['atendimento', 'ponto'])) throw new Error('fixture modules drifted');
  return fixture;
}

if (action === 'provision') {
  const fixture = privateFixture();
  const credential = await pinCredential(fixture.pin);
  mkdirSync(dirname(resolve(fixturesPath)), { recursive: true });
  writeFileSync(fixturesPath, JSON.stringify(fixture), { mode: 0o600 });

  const coreStatements = [
    `DELETE FROM crm_identity_sessions WHERE username = ${sql(fixture.username)};`,
    `DELETE FROM crm_identity_sessions WHERE username = ${sql(fixture.adminUsername)};`,
    `DELETE FROM crm_users WHERE username = ${sql(fixture.username)};`,
    `DELETE FROM crm_users WHERE username = ${sql(fixture.adminUsername)};`,
    `DELETE FROM crm_employee_onboarding WHERE id = ${sql(fixture.onboardingId)};`,
    `INSERT INTO crm_users (username, email, display_name, password_hash, role, photo_url, allowed_units_json, allowed_modules_json, ativo, created_at, updated_at, session_version) VALUES (${sql(fixture.username)}, ${sql(fixture.email)}, ${sql('Synthetic Ponto CONSULTOR')}, ${sql(passwordHash(fixture.password))}, 'CONSULTOR', '', ${sql(JSON.stringify(fixture.allowedUnits))}, ${sql(JSON.stringify(fixture.allowedModules))}, 1, ${sql(now)}, ${sql(now)}, 0);`,
    `INSERT INTO crm_users (username, email, display_name, password_hash, role, photo_url, allowed_units_json, allowed_modules_json, ativo, created_at, updated_at, session_version) VALUES (${sql(fixture.adminUsername)}, ${sql(fixture.adminEmail)}, ${sql('Synthetic Ponto GESTOR')}, ${sql(passwordHash(fixture.adminPassword))}, 'GESTOR', '', ${sql(JSON.stringify(fixture.allowedUnits))}, ${sql(JSON.stringify(['insumos']))}, 1, ${sql(now)}, ${sql(now)}, 0);`,
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
    `DELETE FROM timekeeping_unit_presence_policies WHERE unit_id = ${sql(fixture.unitId)} AND updated_by = ${sql(`${prefix}:presence-policy`)};`,
    `INSERT INTO workforce_employees (id, canonical_employee_id, login_email, display_name, status, access_state, metadata_json, created_at, updated_at) VALUES (${sql(fixture.employeeId)}, ${sql(fixture.employeeId)}, ${sql(fixture.email)}, 'Synthetic Ponto CONSULTOR', 'ACTIVE', 'ACTIVE', ${sql(JSON.stringify({ synthetic: true, runId }))}, ${sql(now)}, ${sql(now)});`,
    `INSERT INTO timekeeping_employee_units (id, employee_id, unit_id, effective_from, effective_to, created_at) VALUES (${sql(`${fixture.employeeId}-unit`)}, ${sql(fixture.employeeId)}, ${sql(fixture.unitId)}, '2020-01-01', NULL, ${sql(now)});`,
    `INSERT OR IGNORE INTO timekeeping_unit_presence_policies (unit_id, presence_mode, geofence_latitude, geofence_longitude, geofence_radius_meters, created_at, updated_at, updated_by) VALUES (${sql(fixture.unitId)}, 'FLEXIBLE', NULL, NULL, 150, ${sql(now)}, ${sql(now)}, ${sql(`${prefix}:presence-policy`)});`,
    `INSERT INTO timekeeping_pin_credentials (employee_id, algorithm, salt_b64, hash_b64, iterations, updated_by, updated_at) VALUES (${sql(fixture.employeeId)}, ${sql(credential.algorithm)}, ${sql(credential.saltB64)}, ${sql(credential.hashB64)}, ${credential.iterations}, 'github-actions-synthetic', ${sql(now)});`,
  ];
  writeFileSync(coreSqlPath, `${coreStatements.join('\n')}\n`, { mode: 0o600 });
  writeFileSync(timekeepingSqlPath, `${timekeepingStatements.join('\n')}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ action, environment: 'staging', role: fixture.role, modules: fixture.allowedModules, credentialsWrittenToPrivateFile: true }));
} else {
  const fixture = controlledFixture();
  const requestIds = Array.from(new Set(fixture.teardownRequestIds || []));
  const requestIdList = requestIds.length ? requestIds.map(sql).join(',') : "''";
  const eventIds = Array.from(new Set(fixture.teardownEventIds || []));
  const eventIdList = eventIds.length ? eventIds.map(sql).join(',') : "''";
  const coreStatements = [
    `DELETE FROM crm_identity_sessions WHERE username = ${sql(fixture.username)};`,
    `DELETE FROM crm_identity_sessions WHERE username = ${sql(fixture.adminUsername)};`,
    `DELETE FROM auth_attempts WHERE username = ${sql(fixture.username)};`,
    `DELETE FROM auth_attempts WHERE username = ${sql(fixture.adminUsername)};`,
    `DELETE FROM crm_user_prefs WHERE username = ${sql(fixture.username)};`,
    `DELETE FROM crm_user_prefs WHERE username = ${sql(fixture.adminUsername)};`,
    `DELETE FROM crm_employee_onboarding WHERE id = ${sql(fixture.onboardingId)};`,
    `DELETE FROM crm_users WHERE username = ${sql(fixture.username)};`,
    `DELETE FROM crm_users WHERE username = ${sql(fixture.adminUsername)};`,
    // Record teardown only after every operational delete above succeeded.
    audit('STAGING_SYNTHETIC_PONTO_TORN_DOWN', fixture.username, { runId, fixtureId, result: 'deleted' }),
    `SELECT
      (SELECT COUNT(*) FROM crm_users WHERE username IN (${sql(fixture.username)},${sql(fixture.adminUsername)})) AS users,
      (SELECT COUNT(*) FROM crm_identity_sessions WHERE username IN (${sql(fixture.username)},${sql(fixture.adminUsername)})) AS sessions,
      (SELECT COUNT(*) FROM auth_attempts WHERE username IN (${sql(fixture.username)},${sql(fixture.adminUsername)})) AS auth_attempts,
      (SELECT COUNT(*) FROM crm_user_prefs WHERE username IN (${sql(fixture.username)},${sql(fixture.adminUsername)})) AS prefs,
      (SELECT COUNT(*) FROM crm_employee_onboarding WHERE id=${sql(fixture.onboardingId)}) AS onboarding,
      (SELECT COUNT(*) FROM audit_log WHERE entity='staging_synthetic_ponto' AND entity_id=${sql(fixture.username)}) AS audit_count,
      (SELECT COUNT(*) FROM audit_log WHERE entity='staging_synthetic_ponto' AND entity_id=${sql(fixture.username)} AND action='STAGING_SYNTHETIC_PONTO_TORN_DOWN') AS teardown_audit;`,
  ];
  // Preserve the immutable timekeeping audit ledger. Only synthetic operational
  // records with this exact run-scoped employee/unit may be removed.
  const timekeepingStatements = [
    `DELETE FROM timekeeping_request_nonces WHERE request_id IN (${requestIdList});`,
    `DELETE FROM timekeeping_employee_units WHERE employee_id IN (SELECT id FROM workforce_employees WHERE canonical_employee_id = ${sql(`identity:${fixture.onboardingId}`)});`,
    `DELETE FROM workforce_employee_profiles WHERE employee_id IN (SELECT id FROM workforce_employees WHERE canonical_employee_id = ${sql(`identity:${fixture.onboardingId}`)});`,
    `DELETE FROM workforce_employee_unit_hierarchy WHERE employee_id IN (SELECT id FROM workforce_employees WHERE canonical_employee_id = ${sql(`identity:${fixture.onboardingId}`)});`,
    `DELETE FROM workforce_employees WHERE canonical_employee_id = ${sql(`identity:${fixture.onboardingId}`)};`,
    `DELETE FROM workforce_departments WHERE normalized_name = ${sql(fixture.onboardingDepartment.toLowerCase())} AND NOT EXISTS (SELECT 1 FROM workforce_employee_unit_hierarchy WHERE department_id = workforce_departments.id);`,
    `DELETE FROM timekeeping_punch_evidence WHERE event_id IN (SELECT id FROM timekeeping_events WHERE employee_id = ${sql(fixture.employeeId)});`,
    `DELETE FROM timekeeping_corrections WHERE event_id IN (SELECT id FROM timekeeping_events WHERE employee_id = ${sql(fixture.employeeId)});`,
    `DELETE FROM timekeeping_events WHERE employee_id = ${sql(fixture.employeeId)};`,
    `DELETE FROM timekeeping_pin_failures WHERE employee_id = ${sql(fixture.employeeId)};`,
    `DELETE FROM timekeeping_pin_credentials WHERE employee_id = ${sql(fixture.employeeId)};`,
    `DELETE FROM timekeeping_employee_units WHERE employee_id = ${sql(fixture.employeeId)};`,
    `DELETE FROM workforce_employee_profiles WHERE employee_id = ${sql(fixture.employeeId)};`,
    `DELETE FROM workforce_employee_unit_hierarchy WHERE employee_id = ${sql(fixture.employeeId)};`,
    `DELETE FROM workforce_employees WHERE id = ${sql(fixture.employeeId)};`,
    `DELETE FROM timekeeping_unit_presence_policies WHERE unit_id = ${sql(fixture.unitId)} AND updated_by = ${sql(`${prefix}:presence-policy`)};`,
    `SELECT
      (SELECT COUNT(*) FROM workforce_employees WHERE id=${sql(fixture.employeeId)} OR canonical_employee_id=${sql(`identity:${fixture.onboardingId}`)}) AS employees,
      (SELECT COUNT(*) FROM timekeeping_employee_units WHERE employee_id=${sql(fixture.employeeId)}) AS employee_units,
      (SELECT COUNT(*) FROM workforce_employee_profiles WHERE employee_id=${sql(fixture.employeeId)}) AS profiles,
      (SELECT COUNT(*) FROM workforce_employee_unit_hierarchy WHERE employee_id=${sql(fixture.employeeId)}) AS hierarchy,
      (SELECT COUNT(*) FROM timekeeping_events WHERE employee_id=${sql(fixture.employeeId)}) AS events,
      (SELECT COUNT(*) FROM timekeeping_punch_evidence WHERE event_id IN (${eventIdList})) AS evidence,
      (SELECT COUNT(*) FROM timekeeping_corrections WHERE event_id IN (${eventIdList})) AS corrections,
      (SELECT COUNT(*) FROM timekeeping_pin_failures WHERE employee_id=${sql(fixture.employeeId)}) AS pin_failures,
      (SELECT COUNT(*) FROM timekeeping_pin_credentials WHERE employee_id=${sql(fixture.employeeId)}) AS pin_credentials,
      (SELECT COUNT(*) FROM timekeeping_request_nonces WHERE request_id IN (${requestIdList})) AS request_nonces,
      (SELECT COUNT(*) FROM workforce_departments WHERE normalized_name=${sql(fixture.onboardingDepartment.toLowerCase())}) AS departments,
      (SELECT COUNT(*) FROM timekeeping_unit_presence_policies WHERE unit_id=${sql(fixture.unitId)} AND updated_by=${sql(`${prefix}:presence-policy`)}) AS policies,
      (SELECT COUNT(*) FROM timekeeping_audit_events WHERE actor_id=${sql(fixture.username)} OR (actor_id='identity-service' AND instr(after_json, ${sql(`"onboardingId":"${fixture.onboardingId}"`)}) > 0)) AS audit_count;`,
  ];
  writeFileSync(coreSqlPath, `${coreStatements.join('\n')}\n`, { mode: 0o600 });
  writeFileSync(timekeepingSqlPath, `${timekeepingStatements.join('\n')}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ action, environment: 'staging', syntheticOperationalRecordsRemoved: true, timekeepingAuditPreserved: true }));
}
