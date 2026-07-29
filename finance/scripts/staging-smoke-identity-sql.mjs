#!/usr/bin/env node
// Produces staging-only SQL in explicitly chosen private paths. It never
// connects to Cloudflare or writes credential material to stdout.
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const [action] = process.argv.slice(2);
const value = (flag) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
};
const coreOutput = value('--core-output');
const financeOutput = value('--finance-output');
const expiresAt = value('--expires-at');
const password = String(process.env.FINANCE_SMOKE_PASSWORD || '');
const username = 'finance-staging-smoke';
const scopeId = 'finance-scope-novo-hamburgo';
const technicalActor = '@skincos/finance-smoke';

if (!['provision', 'rotate', 'revoke'].includes(action) || !coreOutput || !financeOutput || !expiresAt) {
  throw new Error('Usage: FINANCE_SMOKE_IDENTITY_ACK=1 [FINANCE_SMOKE_PASSWORD=<private>] node finance/scripts/staging-smoke-identity-sql.mjs provision|rotate|revoke --expires-at <ISO-8601> --core-output <private.sql> --finance-output <private.sql>');
}
if (process.env.FINANCE_SMOKE_IDENTITY_ACK !== '1') throw new Error('FINANCE_SMOKE_IDENTITY_ACK=1 is required');
if (!Number.isFinite(Date.parse(expiresAt))) throw new Error('--expires-at must be ISO-8601');
if (['provision', 'rotate'].includes(action) && password.length < 24) throw new Error('FINANCE_SMOKE_PASSWORD must contain at least 24 characters');

const quote = (item) => `'${String(item).replaceAll("'", "''")}'`;
const now = new Date().toISOString();
const json = (item) => quote(JSON.stringify(item));
const base64url = (item) => item.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const passwordHash = () => {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(password, salt, 100_000, 32, 'sha256');
  return `pbkdf2_sha256$100000$${base64url(salt)}$${base64url(derived)}`;
};
const audit = (actionName, before, after) => `INSERT INTO audit_log(ts,actor,role,action,entity,entity_id,unidade,idempotency_key,before_json,after_json) VALUES(${quote(now)},${quote(technicalActor)},'SYSTEM',${quote(actionName)},'crm_users',${quote(username)},'novo-hamburgo',${quote(`finance-smoke:${action}:${now}`)},${json(before)},${json(after)});`;
const financeAudit = (actionName, before, after) => `INSERT INTO finance_audit_events(id,scope_id,actor,action,entity_type,entity_id,request_id,before_json,after_json,created_at) VALUES(${quote(`finance-smoke-${action}-${randomBytes(8).toString('hex')}`)},${quote(scopeId)},${quote(technicalActor)},${quote(actionName)},'finance_access_grant',${quote(username)},${quote(`finance-smoke:${action}:${now}`)},${json(before)},${json(after)},${quote(now)});`;

let coreSql;
let financeSql;
const baseline = { username, environment: 'staging', expiresAt, allowedUnits: ['novo-hamburgo'], allowedModules: ['finance'] };
if (action === 'provision') {
  coreSql = [
    'BEGIN IMMEDIATE;',
    `INSERT INTO crm_users(username,email,display_name,password_hash,role,photo_url,allowed_units_json,allowed_modules_json,ativo,created_at,updated_at,session_version) VALUES(${quote(username)},${quote('finance-staging-smoke@staging.invalid')},${quote('Finance staging smoke (synthetic)')},${quote(passwordHash())},'CONSULTOR','',${quote(JSON.stringify(['novo-hamburgo']))},${quote(JSON.stringify(['finance']))},1,${quote(now)},${quote(now)},1);`,
    audit('FINANCE_SMOKE_IDENTITY_PROVISIONED', null, { ...baseline, active: true }),
    'COMMIT;',
  ].join('\n');
  financeSql = [
    'BEGIN IMMEDIATE;',
    `INSERT INTO finance_access_grants(id,username,scope_id,permission,created_at,created_by) VALUES(${quote('finance-staging-smoke-operator-nh')},${quote(username)},${quote(scopeId)},'operator',${quote(now)},${quote(technicalActor)});`,
    financeAudit('FINANCE_SMOKE_GRANT_PROVISIONED', null, { ...baseline, permission: 'operator' }),
    'COMMIT;',
  ].join('\n');
} else if (action === 'rotate') {
  coreSql = [
    'BEGIN IMMEDIATE;',
    `UPDATE crm_users SET password_hash=${quote(passwordHash())},session_version=COALESCE(session_version,0)+1,updated_at=${quote(now)} WHERE username=${quote(username)} AND ativo=1;`,
    audit('FINANCE_SMOKE_IDENTITY_ROTATED', { active: true }, { ...baseline, active: true }),
    'COMMIT;',
  ].join('\n');
  financeSql = [
    'BEGIN IMMEDIATE;',
    financeAudit('FINANCE_SMOKE_GRANT_ROTATION_CONFIRMED', { permission: 'operator' }, { ...baseline, permission: 'operator' }),
    'COMMIT;',
  ].join('\n');
} else {
  coreSql = [
    'BEGIN IMMEDIATE;',
    `UPDATE crm_users SET ativo=0,session_version=COALESCE(session_version,0)+1,updated_at=${quote(now)} WHERE username=${quote(username)};`,
    audit('FINANCE_SMOKE_IDENTITY_REVOKED', { active: true }, { ...baseline, active: false }),
    'COMMIT;',
  ].join('\n');
  financeSql = [
    'BEGIN IMMEDIATE;',
    `DELETE FROM finance_access_grants WHERE username=${quote(username)};`,
    financeAudit('FINANCE_SMOKE_GRANT_REVOKED', { permission: 'operator' }, { ...baseline, permission: null }),
    'COMMIT;',
  ].join('\n');
}

for (const [file, sql] of [[coreOutput, coreSql], [financeOutput, financeSql]]) {
  const target = resolve(file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${sql}\n`, { mode: 0o600 });
}
console.log(JSON.stringify({ ok: true, action, username, scopeId, environment: 'staging', expiresAt, coreOutput: resolve(coreOutput), financeOutput: resolve(financeOutput) }));
