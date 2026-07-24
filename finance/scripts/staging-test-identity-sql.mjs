#!/usr/bin/env node
// Generates sensitive SQL only into an explicitly chosen private operator path.
// It never connects to Cloudflare and never prints a password or its hash.
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const [action] = process.argv.slice(2);
const outputIndex = process.argv.indexOf('--output');
const output = outputIndex >= 0 ? String(process.argv[outputIndex + 1] || '').trim() : '';
const password = String(process.env.FINANCE_STAGING_TEST_PASSWORD || '');
const username = 'finance-staging-monitor';
const scopeId = 'finance-scope-novo-hamburgo';
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;

if (!['create', 'rotate', 'revoke'].includes(action) || !output) {
  throw new Error('Usage: FINANCE_STAGING_TEST_PASSWORD=<private> node finance/scripts/staging-test-identity-sql.mjs create|rotate|revoke --output <private.sql>');
}
if (process.env.FINANCE_STAGING_IDENTITY_ACK !== '1') throw new Error('FINANCE_STAGING_IDENTITY_ACK=1 is required');
if (['create', 'rotate'].includes(action) && password.length < 24) throw new Error('FINANCE_STAGING_TEST_PASSWORD must contain at least 24 characters');

const now = new Date().toISOString();
const base64url = (value) => value.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const passwordHash = () => {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(password, salt, 100_000, 32, 'sha256');
  return `pbkdf2_sha256$100000$${base64url(salt)}$${base64url(derived)}`;
};

let sql;
if (action === 'create') {
  sql = [
    `INSERT INTO crm_users(username,email,display_name,password_hash,role,photo_url,allowed_units_json,allowed_modules_json,ativo,created_at,updated_at,session_version) VALUES(${quote(username)},${quote('finance-staging-monitor@staging.invalid')},${quote('Finance staging monitor (synthetic)')},${quote(passwordHash())},'CONSULTOR','',${quote(JSON.stringify(['novo-hamburgo']))},${quote(JSON.stringify(['finance']))},1,${quote(now)},${quote(now)},0);`,
    `INSERT INTO finance_access_grants(id,username,scope_id,permission,created_at,created_by) VALUES(${quote('finance-staging-monitor-viewer-nh')},${quote(username)},${quote(scopeId)},'viewer',${quote(now)},${quote('@skincos/finance')});`,
  ].join('\n');
} else if (action === 'rotate') {
  sql = `UPDATE crm_users SET password_hash=${quote(passwordHash())},session_version=COALESCE(session_version,0)+1,updated_at=${quote(now)} WHERE username=${quote(username)} AND ativo=1;`;
} else {
  // Invalidate the session before removing the grant. Either completed statement denies Finance access.
  sql = [
    `UPDATE crm_users SET ativo=0,session_version=COALESCE(session_version,0)+1,updated_at=${quote(now)} WHERE username=${quote(username)};`,
    `DELETE FROM finance_access_grants WHERE username=${quote(username)};`,
  ].join('\n');
}

mkdirSync(dirname(resolve(output)), { recursive: true });
writeFileSync(resolve(output), `${sql}\n`, { mode: 0o600 });
console.log(JSON.stringify({ ok: true, action, username, scopeId, environment: 'staging', output: resolve(output) }));
