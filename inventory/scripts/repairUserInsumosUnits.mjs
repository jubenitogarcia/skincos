import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeAllowedUnits, unknownUnitScopes } from '../../shared/identity-contract/index.js';

const TARGET_UNITS = ['novo-hamburgo', 'barra-shopping-sul'];
const INVENTORY_CONFIG = fileURLToPath(new URL('../wrangler.toml', import.meta.url));
const sql = (value) => `'${String(value ?? '').replace(/'/g, "''")}'`;
const subjectId = (value) => createHash('sha256').update(String(value || '')).digest('hex').slice(0, 12);

export function planExplicitUserUnitRepair(row) {
  if (!row) return { ok: false, reason: 'USER_NOT_FOUND' };
  const raw = row.allowed_units_json ?? '';
  if (unknownUnitScopes(raw).length) return { ok: false, reason: 'UNKNOWN_UNIT_SCOPE', subject: subjectId(row.username) };
  if (normalizeAllowedUnits(raw).length) return { ok: false, reason: 'NON_EMPTY_SCOPE_REQUIRES_REVIEW', subject: subjectId(row.username) };
  return { ok: true, subject: subjectId(row.username), before: JSON.stringify([]), after: JSON.stringify(TARGET_UNITS) };
}

export function buildExplicitUserUnitRepairSql(username, plan, now = new Date().toISOString()) {
  const after = JSON.stringify({ allowedUnits: TARGET_UNITS, repair: 'explicit-user-insumos-units' });
  return `BEGIN;
UPDATE crm_users SET allowed_units_json=${sql(plan.after)}, updated_at=${sql(now)} WHERE username=${sql(username)} AND COALESCE(allowed_units_json, '') IN ('', '[]');
INSERT INTO audit_log (ts, actor, role, action, entity, entity_id, unidade, ip, user_agent, idempotency_key, before_json, after_json)
SELECT ${sql(now)}, 'system:unit-scope-repair', 'SYSTEM', 'IDENTITY_UNIT_SCOPE_GRANTED', 'crm_users', ${sql(username)}, '', '', '', '', ${sql(JSON.stringify({ allowedUnits: [] }))}, ${sql(after)} WHERE changes()=1;
COMMIT;`;
}

function main() {
  const argv = process.argv.slice(2);
  const usernameIndex = argv.indexOf('--username');
  const username = usernameIndex >= 0 ? String(argv[usernameIndex + 1] || '').trim() : '';
  const apply = argv.includes('--apply');
  if (!username) throw new Error('USERNAME_REQUIRED: use --username <canonical-username>.');
  const database = process.env.INVENTORY_D1_DATABASE || 'skincos-db';
  const environment = process.env.INVENTORY_D1_ENV || '';
  const command = `SELECT username, role, ativo, allowed_units_json, allowed_modules_json, session_version FROM crm_users WHERE LOWER(username)=LOWER(${sql(username)}) LIMIT 1`;
  const envArgs = environment ? ['--env', environment] : [];
  const output = execFileSync('npx', ['--yes', 'wrangler@4.114.0', 'd1', 'execute', database, '--remote', '--config', INVENTORY_CONFIG, ...envArgs, '--command', command, '--json'], { encoding: 'utf8' });
  const row = JSON.parse(output)[0]?.results?.[0] || null;
  const plan = planExplicitUserUnitRepair(row);
  if (!plan.ok) throw new Error(plan.reason);
  if (apply) execFileSync('npx', ['--yes', 'wrangler@4.114.0', 'd1', 'execute', database, '--remote', '--config', INVENTORY_CONFIG, ...envArgs, '--command', buildExplicitUserUnitRepairSql(username, plan), '--json'], { encoding: 'utf8' });
  console.log(JSON.stringify({ mode: apply ? 'applied' : 'dry-run', ...plan, role: row.role, active: row.ativo, allowedModulesConfigured: Array.isArray(JSON.parse(row.allowed_modules_json || '[]')) && JSON.parse(row.allowed_modules_json || '[]').includes('insumos'), sessionVersion: row.session_version }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
