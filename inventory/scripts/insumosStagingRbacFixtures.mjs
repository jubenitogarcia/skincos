import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const usage = 'usage: node inventory/scripts/insumosStagingRbacFixtures.mjs --action provision|teardown --run-id <github-run-id> --fixtures <private-json> --sql <sql-file>';
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const action = String(args.get('--action') || '');
const runId = String(args.get('--run-id') || '');
const fixturesPath = args.get('--fixtures');
const sqlPath = args.get('--sql');

if (!['provision', 'teardown'].includes(action) || !/^\d{1,20}$/.test(runId) || !fixturesPath || !sqlPath) {
  throw new Error(usage);
}

const sql = (value) => `'${String(value).replaceAll("'", "''")}'`;
const prefix = `stg-rbac-${runId}`;
const now = new Date().toISOString();
const password = () => `StgRbac-${randomBytes(18).toString('base64url')}`;
const passwordHash = (value) => {
  const salt = randomBytes(16);
  const digest = pbkdf2Sync(value, salt, 100_000, 32, 'sha256');
  return `pbkdf2_sha256$100000$${salt.toString('base64url')}$${digest.toString('base64url')}`;
};
const definitions = [
  { id: 'nh', role: 'GESTOR', allowedUnits: ['novo-hamburgo'], expectedUnits: ['novo-hamburgo'] },
  { id: 'bss', role: 'GESTOR', allowedUnits: ['barra-shopping-sul'], expectedUnits: ['barra-shopping-sul'] },
  { id: 'both', role: 'GESTOR', allowedUnits: ['novo-hamburgo', 'barra-shopping-sul'], expectedUnits: ['novo-hamburgo', 'barra-shopping-sul'] },
  { id: 'empty', role: 'GESTOR', allowedUnits: [], expectedUnits: [] },
  { id: 'admin', role: 'ADMIN', allowedUnits: [], expectedUnits: [] },
  // This intentionally persists only a recognized legacy alias. The auth boundary
  // must normalize it, without widening it to an unrelated scope.
  { id: 'alias', role: 'GESTOR', allowedUnits: ['NH'], expectedUnits: ['novo-hamburgo'] },
];

function privateFixtures() {
  return {
    schemaVersion: 1,
    environment: 'staging',
    runId,
    prefix,
    createdAt: now,
    scenarios: definitions.map((definition) => ({
      ...definition,
      username: `${prefix}-${definition.id}`,
      email: `${prefix}-${definition.id}@staging.invalid`,
      password: password(),
    })),
  };
}

function audit(actionName, actor, detail) {
  return `INSERT INTO audit_log (ts, actor, role, action, entity, entity_id, unidade, ip, user_agent, idempotency_key, before_json, after_json) VALUES (${sql(now)}, ${sql(actor)}, 'SYSTEM', ${sql(actionName)}, 'staging_synthetic_identity', ${sql(actor)}, '', '', 'github-actions', ${sql(`${prefix}:${actionName}`)}, NULL, ${sql(JSON.stringify(detail))});`;
}

if (action === 'provision') {
  const fixtures = privateFixtures();
  mkdirSync(dirname(resolve(fixturesPath)), { recursive: true });
  writeFileSync(fixturesPath, JSON.stringify(fixtures), { mode: 0o600 });
  // Remote D1 rejects SQL BEGIN/COMMIT statements. Wrangler imports this file as
  // a supported D1 batch; each statement remains idempotent for this run id.
  const statements = [];
  for (const scenario of fixtures.scenarios) {
    statements.push(`DELETE FROM crm_users WHERE username = ${sql(scenario.username)};`);
    // `insumos` is the runtime module permission enforced by the Inventory
    // Worker. `inventory` is a domain label, not an authorization scope.
    statements.push(`INSERT INTO crm_users (username, email, display_name, password_hash, role, photo_url, allowed_units_json, allowed_modules_json, ativo, created_at, updated_at, session_version) VALUES (${sql(scenario.username)}, ${sql(scenario.email)}, ${sql(`Synthetic Insumos RBAC ${scenario.id}`)}, ${sql(passwordHash(scenario.password))}, ${sql(scenario.role)}, '', ${sql(JSON.stringify(scenario.allowedUnits))}, ${sql(JSON.stringify(['insumos']))}, 1, ${sql(now)}, ${sql(now)}, 0);`);
    statements.push(audit('STAGING_SYNTHETIC_IDENTITY_PROVISIONED', scenario.username, { runId, scope: scenario.allowedUnits, role: scenario.role }));
  }
  writeFileSync(sqlPath, `${statements.join('\n')}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ action, environment: 'staging', scenarioCount: fixtures.scenarios.length, credentialsWrittenToPrivateFile: true }));
} else {
  const fixtures = JSON.parse(await import('node:fs/promises').then(({ readFile }) => readFile(fixturesPath, 'utf8')));
  if (fixtures?.environment !== 'staging' || fixtures?.prefix !== prefix || !Array.isArray(fixtures?.scenarios)) {
    throw new Error('fixture file is not a matching staging fixture');
  }
  const statements = [];
  for (const scenario of fixtures.scenarios) {
    const username = String(scenario.username || '');
    if (!username.startsWith(`${prefix}-`)) throw new Error('fixture username escaped controlled prefix');
    statements.push(audit('STAGING_SYNTHETIC_IDENTITY_TORN_DOWN', username, { runId, result: 'deleted' }));
    statements.push(`DELETE FROM auth_attempts WHERE username = ${sql(username)};`);
    statements.push(`DELETE FROM crm_user_prefs WHERE username = ${sql(username)};`);
    statements.push(`DELETE FROM crm_users WHERE username = ${sql(username)};`);
  }
  writeFileSync(sqlPath, `${statements.join('\n')}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ action, environment: 'staging', scenarioCount: fixtures.scenarios.length, identitiesRemoved: true }));
}
