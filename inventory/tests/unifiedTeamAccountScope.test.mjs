import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test, { after, before, beforeEach } from 'node:test';
import wrangler from 'wrangler';

import { handleAdminRoutes } from '../src/routes/admin.js';

const { getPlatformProxy } = wrangler;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const actor = { username: 'test-gestor', role: 'ADMIN', allowedUnits: [] };
const identityVersionId = '11111111-1111-4111-a111-111111111111';
const appOrigin = 'https://test.local';

function splitMigrationSql(sql) {
  const statements = [];
  let buffer = '';
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  let compound = false;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1] || '';
    if (lineComment) {
      if (char === '\n') { buffer += char; lineComment = false; }
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') { blockComment = false; index += 1; }
      continue;
    }
    if (!quote && char === '-' && next === '-') { lineComment = true; buffer += '\n'; index += 1; continue; }
    if (!quote && char === '/' && next === '*') { blockComment = true; index += 1; continue; }
    if (quote) {
      buffer += char;
      if (char === quote && sql[index - 1] !== '\\') quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; buffer += char; continue; }
    buffer += char;
    if (!compound && /CREATE\s+TRIGGER[\s\S]*\bBEGIN\s*$/i.test(buffer)) compound = true;
    if (char === ';' && (!compound || /\bEND\s*;\s*$/i.test(buffer))) {
      const statement = buffer.slice(0, -1).trim();
      if (statement) statements.push(statement);
      buffer = '';
      compound = false;
    }
  }
  if (buffer.trim()) statements.push(buffer.trim());
  return statements;
}

const schemaMigrations = [
  '0001_init.sql', '0002_backups.sql', '0003_share_history.sql', '0004_insumos_d1.sql',
  '0005_invites.sql', '0006_categories_policy.sql', '0007_user_prefs.sql', '0008_auth_attempts.sql',
  '0009_password_resets.sql', '0010_ponto.sql', '0011_crm_users_and_modules.sql',
  '0012_item_policy.sql', '0013_insumos_barcodes.sql', '0014_insumos_movements_agg.sql',
  '0015_password_reset_codes.sql', '0016_personal_invites.sql', '0017_employee_onboarding.sql',
  '0018_onboarding_consistency.sql', '0024_unified_team_identity.sql',
  '0025_onboarding_idempotency_fingerprint.sql', '0026_unified_invite_identity.sql',
  '0027_crm_employee_account_links.sql', '0028_unified_team_query_indexes.sql',
];

let proxy;
let env;

function workforceBinding(ok = true) {
  return {
    fetch: async () => new Response(JSON.stringify(ok ? { ok: true, data: {} } : { ok: false, code: 'WORKFORCE_TEST_FAILURE' }), {
      status: ok ? 200 : 503,
      headers: { 'content-type': 'application/json' },
    }),
  };
}

function workforceBindingWithEmployee(employeeId) {
  return {
    fetch: async () => new Response(JSON.stringify({ ok: true, data: { employeeId } }), {
      headers: { 'content-type': 'application/json' },
    }),
  };
}

function bytesToBase64Url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

async function encryptPii(value) {
  const rawKey = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('test-pii-key'));
  const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(value));
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(encrypted))}`;
}

function routeEnv({ workforce = workforceBinding(true), unifiedTeamEnabled = 'true', DB = env.DB } = {}) {
  return {
    ...env,
    DB,
    WORKFORCE: workforce,
    UNIFIED_TEAM_ENABLED: unifiedTeamEnabled,
  };
}

async function callRoute(path, { body = {}, envOverride = {}, method = 'PUT' } = {}) {
  const url = new URL(path, appOrigin);
  const request = new Request(url, {
    method,
    headers: { 'content-type': 'application/json', 'x-request-id': `test-${Date.now()}-${Math.random()}` },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  const response = await handleAdminRoutes({
    request,
    url,
    env: routeEnv(envOverride),
    appOrigin,
    withCORS: (payload, init) => new Response(payload, init),
    requireRoles: async () => ({ ok: true, user: actor }),
    appendAuditLog: async () => {},
    ip: '127.0.0.1',
    userAgent: 'unified-team-test',
    idempotencyKey: '',
    bcrypt: null,
    validateUsername: (value) => /^[a-z0-9][a-z0-9._-]{2,39}$/.test(String(value || '')),
  });
  assert.ok(response, `route did not handle ${method} ${path}`);
  return { response, body: await response.json() };
}

async function applySchema(database) {
  for (const name of schemaMigrations) {
    const sql = await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
    for (const statement of splitMigrationSql(sql)) await database.prepare(statement).run();
  }
}

async function seedFixture() {
  const now = '2026-08-11T20:00:00.000Z';
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO crm_users
      (username, email, display_name, password_hash, role, allowed_units_json, ativo, created_at, updated_at, session_version)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 0)`)
      .bind('hellenmelo', 'hellenmelo@espacofacial.com', 'Hellen Gabriele Lisboa Melo', 'hash', 'INJETOR', JSON.stringify(['barra-shopping-sul']), now, now),
    env.DB.prepare(`INSERT INTO crm_users
      (username, email, display_name, password_hash, role, allowed_units_json, ativo, created_at, updated_at, session_version)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 0)`)
      .bind('unlinkeduser', 'unlinkeduser@espacofacial.com', 'Usuário sem vínculo', 'hash', 'CONSULTOR', JSON.stringify(['barra-shopping-sul']), now, now),
    env.DB.prepare(`INSERT INTO crm_employee_onboarding
      (id, full_name, corporate_email, personal_email_encrypted, personal_email_hash, mobile_phone_encrypted, mobile_phone_hash,
       profile, job_title, department_name, units_json, account_status, workforce_employee_id, created_by, created_at, updated_at,
       requested_username, provisioning_state, request_fingerprint)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, 'COMPLETED', ?)`)
      .bind('hellenmelo-employee', 'Hellen Gabriele Lisboa Melo', 'hellenmelo@espacofacial.com', 'encrypted', 'personal-hash', 'encrypted', 'phone-hash', 'INJETOR', 'Injetor', 'Atendimento', JSON.stringify(['barra-shopping-sul']), 'wf-hellenmelo', 'test', now, now, 'hellenmelo', 'fingerprint-hellen'),
    env.DB.prepare(`INSERT INTO crm_employee_onboarding
      (id, full_name, corporate_email, personal_email_encrypted, personal_email_hash, mobile_phone_encrypted, mobile_phone_hash,
       profile, job_title, department_name, units_json, account_status, workforce_employee_id, created_by, created_at, updated_at,
       requested_username, provisioning_state, request_fingerprint)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, 'COMPLETED', ?)`)
      .bind('unlinked-employee', 'Usuário sem vínculo', 'unlinkeduser@espacofacial.com', 'encrypted', 'personal-hash-2', 'encrypted', 'phone-hash-2', 'CONSULTOR', 'Consultor', 'Comercial', JSON.stringify(['barra-shopping-sul']), 'wf-unlinked', 'test', now, now, 'unlinkeduser', 'fingerprint-unlinked'),
    env.DB.prepare(`INSERT INTO crm_employee_team
      (workforce_employee_id, onboarding_id, units_json, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind('wf-hellenmelo', 'hellenmelo-employee', JSON.stringify(['barra-shopping-sul']), 'test', now, now),
    env.DB.prepare(`INSERT INTO crm_employee_team
      (workforce_employee_id, onboarding_id, units_json, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind('wf-unlinked', 'unlinked-employee', JSON.stringify(['barra-shopping-sul']), 'test', now, now),
    env.DB.prepare(`INSERT INTO crm_employee_account_links
      (id, workforce_employee_id, onboarding_id, crm_username, link_method, review_status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'EXPLICIT_CRM_USERNAME', 'CONFIRMED', ?, ?, ?)`)
      .bind('account-link-hellenmelo', 'wf-hellenmelo', 'hellenmelo-employee', 'hellenmelo', 'test', now, now),
  ]);
}

async function readMemberState(id = 'hellenmelo-employee', username = 'hellenmelo') {
  const onboarding = await env.DB.prepare('SELECT units_json, compensation_state, last_error_code FROM crm_employee_onboarding WHERE id=?').bind(id).first();
  const team = await env.DB.prepare('SELECT units_json FROM crm_employee_team WHERE onboarding_id=?').bind(id).first();
  const user = await env.DB.prepare('SELECT allowed_units_json, session_version FROM crm_users WHERE username=?').bind(username).first();
  return {
    onboardingUnits: JSON.parse(onboarding.units_json),
    teamUnits: JSON.parse(team.units_json),
    accountUnits: JSON.parse(user.allowed_units_json),
    sessionVersion: Number(user.session_version),
    compensationState: onboarding.compensation_state || null,
    lastErrorCode: onboarding.last_error_code || null,
  };
}

before(async () => {
  proxy = await getPlatformProxy({
    configPath: fileURLToPath(new URL('../wrangler.toml', import.meta.url)),
    persist: false,
    remoteBindings: false,
  });
  env = {
    DB: proxy.env.DB,
    APP_ORIGIN: appOrigin,
    ENVIRONMENT: 'test',
    APP_VERSION: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    CF_VERSION_METADATA: { id: identityVersionId },
    IDENTITY_WORKFORCE_HMAC_KEY: 'test-hmac-key',
    IDENTITY_PII_KEY: 'test-pii-key',
    UNIFIED_TEAM_ENABLED: 'true',
    WORKFORCE: workforceBinding(true),
  };
  await applySchema(env.DB);
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM crm_employee_account_links'),
    env.DB.prepare('DELETE FROM crm_employee_team'),
    env.DB.prepare('DELETE FROM crm_employee_onboarding'),
    env.DB.prepare('DELETE FROM crm_users'),
  ]);
  await seedFixture();
});

after(async () => {
  await env?.DB?.prepare('DROP TRIGGER IF EXISTS test_fail_crm_scope_update').run().catch(() => {});
  await proxy?.dispose?.();
});

test('team edit atomically tracks confirmed CRM account scope for one and multiple units', async () => {
  let result = await callRoute('/admin/team/hellenmelo-employee', { body: { units: ['novo-hamburgo'] } });
  assert.equal(result.response.status, 200);
  assert.deepEqual((await readMemberState()).onboardingUnits, ['novo-hamburgo']);
  assert.deepEqual((await readMemberState()).teamUnits, ['novo-hamburgo']);
  assert.deepEqual((await readMemberState()).accountUnits, ['novo-hamburgo']);
  assert.equal((await readMemberState()).sessionVersion, 1);

  result = await callRoute('/admin/team/hellenmelo-employee', { body: { units: ['novo-hamburgo', 'barra-shopping-sul'] } });
  assert.equal(result.response.status, 200);
  assert.deepEqual((await readMemberState()).accountUnits, ['novo-hamburgo', 'barra-shopping-sul']);
  assert.equal((await readMemberState()).sessionVersion, 2);

  result = await callRoute('/admin/team/hellenmelo-employee', { body: { units: ['barra-shopping-sul'] } });
  assert.equal(result.response.status, 200);
  const finalState = await readMemberState();
  assert.deepEqual(finalState.onboardingUnits, ['barra-shopping-sul']);
  assert.deepEqual(finalState.teamUnits, ['barra-shopping-sul']);
  assert.deepEqual(finalState.accountUnits, ['barra-shopping-sul']);
  assert.equal(finalState.sessionVersion, 3);
});

test('team edit does not infer or create access when no explicit CRM account link exists', async () => {
  const result = await callRoute('/admin/team/unlinked-employee', { body: { units: ['novo-hamburgo'] } });
  assert.equal(result.response.status, 200);
  const state = await readMemberState('unlinked-employee', 'unlinkeduser');
  assert.deepEqual(state.onboardingUnits, ['novo-hamburgo']);
  assert.deepEqual(state.teamUnits, ['novo-hamburgo']);
  assert.deepEqual(state.accountUnits, ['barra-shopping-sul']);
  assert.equal(state.sessionVersion, 0);
  const link = await env.DB.prepare('SELECT id FROM crm_employee_account_links WHERE onboarding_id=?').bind('unlinked-employee').first();
  assert.equal(link, null);
});

test('manager contact inspection decrypts only the scoped edit payload', async () => {
  const personalEmail = await encryptPii('pessoa@example.com');
  const mobilePhone = await encryptPii('+5551999999999');
  await env.DB.prepare('UPDATE crm_employee_onboarding SET personal_email_encrypted=?, mobile_phone_encrypted=? WHERE id=?')
    .bind(personalEmail, mobilePhone, 'hellenmelo-employee').run();

  const result = await callRoute('/admin/team/hellenmelo-employee/contact', { method: 'GET' });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body.data, { personalEmail: 'pessoa@example.com', mobilePhone: '+5551999999999' });
  const listed = await callRoute('/admin/team?status=ALL', { method: 'GET' });
  assert.equal(listed.response.status, 200);
  assert.equal('personalEmail' in listed.body.data[0], false);
  assert.equal('mobilePhone' in listed.body.data[0], false);
});

test('failed effective-scope write is not reported as success and rolls back the D1 batch', async () => {
  await env.DB.prepare(`CREATE TRIGGER test_fail_crm_scope_update
    BEFORE UPDATE OF allowed_units_json ON crm_users
    WHEN NEW.username='hellenmelo'
    BEGIN SELECT RAISE(ABORT, 'TEST_SCOPE_FAILURE'); END`).run();
  const result = await callRoute('/admin/team/hellenmelo-employee', { body: { units: ['novo-hamburgo'] } });
  assert.equal(result.response.status, 503);
  assert.equal(result.body.success, false);
  const state = await readMemberState();
  assert.deepEqual(state.onboardingUnits, ['barra-shopping-sul']);
  assert.deepEqual(state.teamUnits, ['barra-shopping-sul']);
  assert.deepEqual(state.accountUnits, ['barra-shopping-sul']);
  assert.equal(state.sessionVersion, 0);
  assert.equal(state.compensationState, 'LOCAL_TEAM_UPDATE_PENDING');
  await env.DB.prepare('DROP TRIGGER test_fail_crm_scope_update').run();
});

test('feature-flag-off path rejects legacy PUT explicitly', async () => {
  const result = await callRoute('/admin/onboarding', {
    body: { units: ['novo-hamburgo'] },
    envOverride: { unifiedTeamEnabled: 'false' },
  });
  assert.equal(result.response.status, 410);
  assert.equal(result.body.code, 'UNIFIED_TEAM_ROUTE_DISABLED');
});

test('workforce failure prevents any local team or account scope write', async () => {
  const result = await callRoute('/admin/team/hellenmelo-employee', {
    body: { units: ['novo-hamburgo'] },
    envOverride: { workforce: workforceBinding(false) },
  });
  assert.equal(result.response.status, 503);
  assert.equal(result.body.success, false);
  const state = await readMemberState();
  assert.deepEqual(state.onboardingUnits, ['barra-shopping-sul']);
  assert.deepEqual(state.teamUnits, ['barra-shopping-sul']);
  assert.deepEqual(state.accountUnits, ['barra-shopping-sul']);
  assert.equal(state.sessionVersion, 0);
});

test('backend Workforce reconciliation repairs a pending invite without activation or delivery', async () => {
  await env.DB.batch([
    env.DB.prepare("UPDATE crm_employee_onboarding SET account_status='INVITED', workforce_employee_id=NULL, invite_id='pending-hellen-invite', provisioning_state='FAILED', last_error_code='WORKFORCE_SYNC_FAILED' WHERE id=?").bind('hellenmelo-employee'),
    env.DB.prepare('DELETE FROM crm_employee_team WHERE onboarding_id=?').bind('hellenmelo-employee'),
    env.DB.prepare('UPDATE crm_users SET ativo=0 WHERE username=?').bind('hellenmelo'),
  ]);

  const result = await callRoute('/admin/team/hellenmelo-employee/workforce/reconcile', {
    method: 'POST',
    envOverride: { workforce: workforceBindingWithEmployee('wf-hellen-repaired') },
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.success, true);
  const onboarding = await env.DB.prepare('SELECT account_status, workforce_employee_id, provisioning_state FROM crm_employee_onboarding WHERE id=?').bind('hellenmelo-employee').first();
  const team = await env.DB.prepare('SELECT workforce_employee_id FROM crm_employee_team WHERE onboarding_id=?').bind('hellenmelo-employee').first();
  const crmUser = await env.DB.prepare('SELECT ativo FROM crm_users WHERE username=?').bind('hellenmelo').first();
  assert.equal(onboarding.account_status, 'INVITED');
  assert.equal(onboarding.workforce_employee_id, 'wf-hellen-repaired');
  assert.equal(onboarding.provisioning_state, 'INVITE_PENDING');
  assert.equal(team.workforce_employee_id, 'wf-hellen-repaired');
  assert.equal(Number(crmUser.ativo), 0);
});

test('resend automatically reconciles a missing Workforce binding before guarded delivery', async () => {
  await env.DB.batch([
    env.DB.prepare("UPDATE crm_employee_onboarding SET account_status='INVITED', workforce_employee_id=NULL, invite_id='pending-hellen-invite', provisioning_state='FAILED' WHERE id=?").bind('hellenmelo-employee'),
    env.DB.prepare('DELETE FROM crm_employee_team WHERE onboarding_id=?').bind('hellenmelo-employee'),
  ]);
  const result = await callRoute('/admin/team/hellenmelo-employee/invite/resend', {
    method: 'POST',
    envOverride: { workforce: workforceBindingWithEmployee('wf-hellen-recovered') },
  });
  assert.equal(result.response.status, 503);
  assert.equal(result.body.code, 'INVITEE_EMAIL_UNAVAILABLE');
  const onboarding = await env.DB.prepare('SELECT account_status, workforce_employee_id, invite_id, provisioning_state, last_error_code FROM crm_employee_onboarding WHERE id=?').bind('hellenmelo-employee').first();
  const team = await env.DB.prepare('SELECT workforce_employee_id FROM crm_employee_team WHERE onboarding_id=?').bind('hellenmelo-employee').first();
  assert.equal(onboarding.account_status, 'INVITED');
  assert.equal(onboarding.workforce_employee_id, 'wf-hellen-recovered');
  assert.equal(onboarding.invite_id, 'pending-hellen-invite');
  assert.equal(onboarding.provisioning_state, 'INVITE_PENDING');
  assert.equal(onboarding.last_error_code, null);
  assert.equal(team.workforce_employee_id, 'wf-hellen-recovered');
});

test('resend keeps the prior invite untouched when automatic Workforce reconciliation fails', async () => {
  await env.DB.prepare("UPDATE crm_employee_onboarding SET account_status='INVITED', workforce_employee_id=NULL, invite_id='pending-hellen-invite', provisioning_state='FAILED' WHERE id=?").bind('hellenmelo-employee').run();
  const result = await callRoute('/admin/team/hellenmelo-employee/invite/resend', {
    method: 'POST',
    envOverride: { workforce: workforceBinding(false) },
  });
  assert.equal(result.response.status, 503);
  assert.equal(result.body.code, 'WORKFORCE_TEST_FAILURE');
  const onboarding = await env.DB.prepare('SELECT account_status, workforce_employee_id, invite_id, provisioning_state, last_error_code FROM crm_employee_onboarding WHERE id=?').bind('hellenmelo-employee').first();
  assert.equal(onboarding.account_status, 'INVITED');
  assert.equal(onboarding.workforce_employee_id, null);
  assert.equal(onboarding.invite_id, 'pending-hellen-invite');
  assert.equal(onboarding.provisioning_state, 'FAILED');
  assert.equal(onboarding.last_error_code, 'WORKFORCE_TEST_FAILURE');
});

test('resend rejects a conflicting automatic Workforce binding before invitation mutation', async () => {
  await env.DB.prepare("UPDATE crm_employee_onboarding SET account_status='INVITED', workforce_employee_id=NULL, invite_id='pending-hellen-invite', provisioning_state='FAILED' WHERE id=?").bind('hellenmelo-employee').run();
  const result = await callRoute('/admin/team/hellenmelo-employee/invite/resend', {
    method: 'POST',
    envOverride: { workforce: workforceBindingWithEmployee('wf-unlinked') },
  });
  assert.equal(result.response.status, 409);
  assert.equal(result.body.code, 'TEAM_WORKFORCE_BINDING_CONFLICT');
  const onboarding = await env.DB.prepare('SELECT account_status, workforce_employee_id, invite_id FROM crm_employee_onboarding WHERE id=?').bind('hellenmelo-employee').first();
  assert.equal(onboarding.account_status, 'INVITED');
  assert.equal(onboarding.workforce_employee_id, null);
  assert.equal(onboarding.invite_id, 'pending-hellen-invite');
});

test('Workforce reconciliation fails closed when the returned employee belongs to another onboarding', async () => {
  await env.DB.batch([
    env.DB.prepare("UPDATE crm_employee_onboarding SET account_status='INVITED', workforce_employee_id=NULL, provisioning_state='FAILED' WHERE id=?").bind('hellenmelo-employee'),
    env.DB.prepare('DELETE FROM crm_employee_team WHERE onboarding_id=?').bind('hellenmelo-employee'),
  ]);
  const result = await callRoute('/admin/team/hellenmelo-employee/workforce/reconcile', {
    method: 'POST',
    envOverride: { workforce: workforceBindingWithEmployee('wf-unlinked') },
  });
  assert.equal(result.response.status, 409);
  assert.equal(result.body.code, 'TEAM_WORKFORCE_BINDING_CONFLICT');
  const onboarding = await env.DB.prepare('SELECT workforce_employee_id FROM crm_employee_onboarding WHERE id=?').bind('hellenmelo-employee').first();
  const team = await env.DB.prepare('SELECT onboarding_id FROM crm_employee_team WHERE workforce_employee_id=?').bind('wf-unlinked').first();
  assert.equal(onboarding.workforce_employee_id, null);
  assert.equal(team.onboarding_id, 'unlinked-employee');
});

test('team edits persist the Workforce employee returned by the idempotent backend sync', async () => {
  await env.DB.prepare('UPDATE crm_employee_onboarding SET workforce_employee_id=NULL WHERE id=?').bind('hellenmelo-employee').run();
  const result = await callRoute('/admin/team/hellenmelo-employee', {
    body: { units: ['barra-shopping-sul'] },
    envOverride: { workforce: workforceBindingWithEmployee('wf-hellenmelo') },
  });
  assert.equal(result.response.status, 200);
  const onboarding = await env.DB.prepare('SELECT workforce_employee_id FROM crm_employee_onboarding WHERE id=?').bind('hellenmelo-employee').first();
  assert.equal(onboarding.workforce_employee_id, 'wf-hellenmelo');
});
