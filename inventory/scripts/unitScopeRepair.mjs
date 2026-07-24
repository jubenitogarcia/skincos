import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeAllowedUnits, unknownUnitScopes } from '../../shared/identity-contract/index.js';

const TARGET_UNITS = ['novo-hamburgo', 'barra-shopping-sul'];
const INVENTORY_CONFIG = fileURLToPath(new URL('../wrangler.toml', import.meta.url));

const subjectId = (value) => createHash('sha256').update(String(value || '')).digest('hex').slice(0, 12);
const sql = (value) => `'${String(value ?? '').replace(/'/g, "''")}'`;

export function planAliasNormalization(rows) {
  const normalize = [];
  const review = [];
  for (const row of rows || []) {
    const raw = row?.allowed_units_json ?? '';
    const units = normalizeAllowedUnits(raw);
    const unknown = unknownUnitScopes(raw);
    const rawItems = typeof raw === 'string' && raw.trim() ? (() => { try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : [raw]; } catch { return raw.split(/[,;|]/g); } })() : [];
    const currentJson = JSON.stringify(rawItems.map(String).map((item) => item.trim()).filter(Boolean));
    const nextJson = JSON.stringify(units);
    const subject = subjectId(row?.username);
    if (!rawItems.length) {
      review.push({ subject, reason: 'EMPTY_SCOPE' });
    } else if (unknown.length) {
      review.push({ subject, reason: 'UNKNOWN_UNIT', unknownCount: unknown.length });
    } else if (currentJson !== nextJson) {
      // Keep the raw stored value as the optimistic-concurrency predicate. This
      // also supports legacy comma-delimited rows, whose JSON rendering differs.
      normalize.push({ username: String(row.username), subject, before: currentJson, beforeRaw: String(raw), after: nextJson });
    }
  }
  return { normalize, review };
}

export function buildAliasNormalizationSql(item, now = new Date().toISOString()) {
  const audit = JSON.stringify({ allowedUnits: JSON.parse(item.after), repair: 'canonical-alias-normalization' });
  return `BEGIN;
UPDATE crm_users SET allowed_units_json=${sql(item.after)}, updated_at=${sql(now)} WHERE username=${sql(item.username)} AND COALESCE(allowed_units_json, '')=${sql(item.beforeRaw ?? item.before)};
INSERT INTO audit_log (ts, actor, role, action, entity, entity_id, unidade, ip, user_agent, idempotency_key, before_json, after_json)
SELECT ${sql(now)}, 'system:unit-scope-repair', 'SYSTEM', 'IDENTITY_UNIT_SCOPE_NORMALIZED', 'crm_users', ${sql(item.username)}, '', '', '', '', ${sql(JSON.stringify({ allowedUnits: JSON.parse(item.before) }))}, ${sql(audit)} WHERE changes()=1;
COMMIT;`;
}

function runWrangler(args) {
  return execFileSync('npx', ['--yes', 'wrangler@4.114.0', ...args], { encoding: 'utf8' });
}

function parsedD1(command, database, environment) {
  const args = ['d1', 'execute', database, '--remote', '--config', INVENTORY_CONFIG, '--command', command, '--json'];
  if (environment) args.push('--env', environment);
  const output = runWrangler(args);
  return JSON.parse(output)[0]?.results || [];
}

function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply');
  const database = process.env.INVENTORY_D1_DATABASE || 'skincos-db';
  const environment = process.env.INVENTORY_D1_ENV || '';
  const rows = parsedD1('SELECT username, allowed_units_json FROM crm_users ORDER BY username', database, environment);
  const plan = planAliasNormalization(rows);
  for (const item of plan.normalize) {
    if (apply) parsedD1(buildAliasNormalizationSql(item), database, environment);
  }
  console.log(JSON.stringify({ mode: apply ? 'applied' : 'dry-run', database, normalized: plan.normalize.map(({ subject }) => ({ subject })), review: plan.review }, null, 2));
  if (!apply) console.log('Run again with --apply only after reviewing the pseudonymous plan. Empty scopes are never changed.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
