import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import test from 'node:test';

import { handleAuthRoutes } from '../routes/auth.js';
import { createIdentityD1Store, getIdentityProfessionalLinkByUsername } from '../store/d1.js';

// Boundary tests only: D1 methods are doubles. No database, Worker, login
// endpoint, cookie transport, or external service is started by this suite.
const USERNAME = 'synthetic.account';
const EMAIL = 'synthetic-login@example.test';
const EMPLOYEE_ID = 'synthetic-workforce-employee-1';
const PASSWORD = 'synthetic-password-used-only-by-this-test';
const SALT = Buffer.from('synthetic-password-test-salt');
const PASSWORD_HASH = `pbkdf2_sha256$50000$${SALT.toString('base64url')}$${pbkdf2Sync(PASSWORD, SALT, 50000, 32, 'sha256').toString('base64url')}`;
const USER_ROW = Object.freeze({
  username: USERNAME,
  email: EMAIL,
  display_name: 'Synthetic Account',
  password_hash: PASSWORD_HASH,
  role: 'CONSULTOR',
  photo_url: '',
  allowed_units_json: '["barra-shopping-sul"]',
  allowed_modules_json: '["atendimento"]',
  ativo: 1,
  session_version: 7,
});
const CONFIRMED_LINK = Object.freeze({
  crm_username: USERNAME,
  workforce_employee_id: EMPLOYEE_ID,
  review_status: 'CONFIRMED',
});

function d1Double({ userRow = USER_ROW, linkRows = [CONFIRMED_LINK], tableRows, linkError, linkResult } = {}) {
  const calls = [];
  const DB = {
    prepare(sql) {
      let values = [];
      const record = (method) => calls.push({ sql, values: [...values], method });
      return {
        bind(...nextValues) { values = nextValues; return this; },
        async first() {
          record('first');
          if (sql.includes('sqlite_master')) return { type: 'table' };
          if (/FROM (crm_users|insumos_users)\b/.test(sql)) {
            const requested = values.map((value) => String(value).toLowerCase());
            return userRow && requested.some((value) => [userRow.username, userRow.email].some((account) => String(account).toLowerCase() === value))
              ? { ...userRow }
              : null;
          }
          if (sql.includes('FROM auth_attempts')) return { n: 0 };
          return null;
        },
        async all() {
          record('all');
          if (sql.startsWith('PRAGMA table_info')) return { results: [
            { name: 'id' }, { name: 'allowed_modules_json' }, { name: 'identity_subject' },
            { name: 'invitee_email' }, { name: 'corporate_email' }, { name: 'requested_username' },
          ] };
          if (sql.includes('FROM crm_employee_account_links')) {
            if (linkError) throw linkError;
            if (tableRows) {
              // Model only the D1 query boundary (key equality and review
              // predicate), leaving all identity validation to the real reader.
              const exactKey = /WHERE\s+crm_username\s*=\s*\?/.test(sql);
              const confirmedOnly = /AND review_status\s*=\s*'CONFIRMED'/.test(sql);
              const selected = tableRows.filter((row) => (
                exactKey ? row.crm_username === values[0]
                  : String(row.crm_username).toLowerCase() === String(values[0]).toLowerCase()
              ) && (!confirmedOnly || row.review_status === 'CONFIRMED'));
              return { success: true, results: selected.slice(0, 2) };
            }
            return linkResult === undefined ? { success: true, results: linkRows } : linkResult;
          }
          return { results: [] };
        },
        async run() { record('run'); return { meta: { changes: 1 } }; },
      };
    },
  };
  return { DB, calls };
}

const linkCalls = (calls) => calls.filter(({ sql }) => sql.includes('crm_employee_account_links') && !sql.startsWith('PRAGMA'));

function assertLinkRead(calls, username = USERNAME) {
  const reads = linkCalls(calls);
  assert.equal(reads.length, 1, 'one reviewed-link lookup for the persisted authenticated account');
  assert.equal(reads[0].method, 'all');
  assert.match(reads[0].sql, /^\s*SELECT\b/);
  assert.match(reads[0].sql, /WHERE\s+crm_username\s*=\s*\?/);
  assert.doesNotMatch(reads[0].sql, /LOWER\(crm_username\)/);
  assert.match(reads[0].sql, /AND review_status\s*=\s*'CONFIRMED'/);
  assert.match(reads[0].sql, /LIMIT 2\b/);
  assert.deepEqual(reads[0].values, [username]);
  assert.ok(reads.every(({ sql }) => !/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/.test(sql)), 'link source remains read-only');
}

async function auth(path, {
  sessionUsername = USERNAME,
  sessionVersion = 7,
  body,
  ...databaseOptions
} = {}) {
  const database = d1Double(databaseOptions);
  const env = { DB: database.DB, AUTH_PBKDF2_ITERS: '50000' };
  const cookieCalls = [];
  const method = path === '/auth/me' ? 'GET' : 'POST';
  const request = new Request(`https://identity.test${path}?workforceEmployeeId=forged-query-employee`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-crm-user': JSON.stringify({ username: 'forged-account', workforceEmployeeId: 'forged-header-employee' }),
    },
    ...(method === 'POST' ? { body: JSON.stringify(body ?? {
      username: EMAIL, password: PASSWORD,
      workforceEmployeeId: 'forged-body-employee', professionalId: 'forged-professional',
    }) } : {}),
  });
  const response = await handleAuthRoutes({
    request,
    url: new URL(request.url),
    env,
    appOrigin: 'https://crm.test',
    withCORS: (content, init) => new Response(content, init),
    sessionUsername,
    sessionVersion,
    sessionId: 'synthetic-session',
    sessionCsrf: 'synthetic-existing-csrf',
    cookies: { csrfToken: 'synthetic-existing-csrf' },
    bcrypt: { compare: async () => { throw new Error('unexpected bcrypt path'); } },
    issueAuthCookies: async (claim) => {
      cookieCalls.push(claim);
      return { headers: new Headers({ 'set-cookie': 'synthetic-session=rotated; HttpOnly' }), csrf: 'synthetic-rotated-csrf' };
    },
    deleteAuthCookies: () => new Headers({ 'set-cookie': 'synthetic-session=; Max-Age=0' }),
    validateUsername: () => true,
    MAX_PROFILE_PHOTO_URL_CHARS: 45000,
    devBypass: false,
    devBypassUser: null,
    d1: createIdentityD1Store(env),
    appendAuditLog: async () => {},
    ip: '192.0.2.1',
    userAgent: 'synthetic-link-contract-test',
  });
  return { response, body: await response.json(), calls: database.calls, cookieCalls };
}

test('reviewed link resolves only the authenticated account and exposes Workforce ID, not a professional UUID', async () => {
  const database = d1Double({ tableRows: [
    { ...CONFIRMED_LINK, professional_id: 'untrusted-extra-column' },
    { ...CONFIRMED_LINK, crm_username: USERNAME.toUpperCase(), workforce_employee_id: 'different-reviewed-employee' },
  ] });
  assert.deepEqual(await getIdentityProfessionalLinkByUsername({ DB: database.DB }, USERNAME), { workforceEmployeeId: EMPLOYEE_ID });
  assertLinkRead(database.calls);
});

test('a reviewed link for a case-distinct account cannot bind the persisted authenticated username', async () => {
  for (const tableRows of [
    [{ ...CONFIRMED_LINK, crm_username: USERNAME.toUpperCase() }],
    [
      { ...CONFIRMED_LINK, review_status: 'PENDING_REVIEW' },
      { ...CONFIRMED_LINK, crm_username: USERNAME.toUpperCase() },
    ],
  ]) {
    const database = d1Double({ tableRows });
    assert.deepEqual(await getIdentityProfessionalLinkByUsername({ DB: database.DB }, USERNAME), {});
    assertLinkRead(database.calls);
    const result = await auth('/auth/me', { tableRows });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.user.username, USERNAME);
    assert.equal(Object.hasOwn(result.body.user, 'workforceEmployeeId'), false);
    assert.equal(Object.hasOwn(result.body.user, 'professionalId'), false);
    assert.equal(result.body.user.professionalIdentityStatus, 'UNLINKED');
    assertLinkRead(result.calls);
  }
});

test('absent, pending, rejected and malformed Workforce links remain unlinked', async () => {
  const unlinked = [
    [],
    [{ ...CONFIRMED_LINK, review_status: 'PENDING_REVIEW' }],
    [{ ...CONFIRMED_LINK, review_status: 'REJECTED' }],
    ...[null, undefined, '', ' ', 0, 1, {}, 'bad employee', 'employee\nforged', '../employee'].map((id) => [{ ...CONFIRMED_LINK, workforce_employee_id: id }]),
  ];
  for (const linkRows of unlinked) {
    const database = d1Double({ linkRows });
    assert.deepEqual(await getIdentityProfessionalLinkByUsername({ DB: database.DB }, USERNAME), {});
    assertLinkRead(database.calls);
  }
});

test('unavailable or ambiguous link source is a typed failure rather than a missing relationship', async () => {
  const cases = [
    { linkError: new Error('synthetic DB unavailable') },
    { linkError: new Error('no such table: crm_employee_account_links') },
    { linkRows: [CONFIRMED_LINK, CONFIRMED_LINK] },
    { linkRows: [{ ...CONFIRMED_LINK, crm_username: 'different-account' }] },
    { linkResult: null },
    { linkResult: { results: {} } },
    { linkResult: { success: false, results: [] } },
  ];
  for (const options of cases) {
    const database = d1Double(options);
    await assert.rejects(getIdentityProfessionalLinkByUsername({ DB: database.DB }, USERNAME), { code: 'IDENTITY_PROFESSIONAL_LINK_UNAVAILABLE' });
    assertLinkRead(database.calls);
  }
  await assert.rejects(getIdentityProfessionalLinkByUsername({}, USERNAME), { code: 'IDENTITY_PROFESSIONAL_LINK_UNAVAILABLE' });
});

test('/me auth handler preserves legacy profile and scopes without rotating cookies or writing', async () => {
  const result = await auth('/auth/me');
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, {
    success: true,
    user: {
      name: 'Synthetic Account', displayName: 'Synthetic Account', username: USERNAME, email: EMAIL,
      role: 'CONSULTOR', photoUrl: '', allowedUnits: ['barra-shopping-sul'], allowedModules: ['atendimento'],
      workforceEmployeeId: EMPLOYEE_ID,
      professionalIdentityStatus: 'CONFIRMED',
    },
    csrfToken: 'synthetic-existing-csrf',
  });
  assert.equal(result.response.headers.has('set-cookie'), false);
  assert.deepEqual(result.cookieCalls, []);
  assert.equal(result.calls.some(({ method }) => method === 'run'), false);
  assertLinkRead(result.calls);
});

test('/me omits professional identity for unresolved links even when request fields suggest a match', async () => {
  for (const linkRows of [[], [{ ...CONFIRMED_LINK, review_status: 'PENDING_REVIEW' }], [{ ...CONFIRMED_LINK, review_status: 'REJECTED' }], [{ ...CONFIRMED_LINK, workforce_employee_id: 'bad employee' }]]) {
    const result = await auth('/auth/me', { linkRows });
    assert.equal(result.response.status, 200);
    assert.equal(Object.hasOwn(result.body.user, 'workforceEmployeeId'), false);
    assert.equal(Object.hasOwn(result.body.user, 'professionalId'), false);
    assert.equal(result.body.user.username, USERNAME);
    assert.equal(result.body.user.professionalIdentityStatus, 'UNLINKED');
    assertLinkRead(result.calls);
  }
});

test('/me and refresh reject missing, invalidated or inactive sessions before querying any professional link', async () => {
  for (const path of ['/auth/me', '/auth/refresh']) {
    for (const options of [
      { sessionUsername: null }, // Upstream session verification cleared an absent/expired token.
      { sessionVersion: 6 }, // Persisted version changed when the account revoked its sessions.
      { userRow: { ...USER_ROW, ativo: 0 } },
      { userRow: null },
    ]) {
      const result = await auth(path, options);
      assert.equal(result.response.status, 401);
      assert.equal(result.body.error, 'Not authenticated');
      assert.deepEqual(linkCalls(result.calls), []);
      assert.deepEqual(result.cookieCalls, []);
    }
  }
});

test('refresh and login return the same reviewed identity as /me, using the persisted username rather than request aliases', async () => {
  const me = await auth('/auth/me');
  for (const path of ['/auth/refresh', '/auth/login']) {
    const result = await auth(path, { sessionUsername: path === '/auth/login' ? null : USERNAME });
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body.user, me.body.user);
    assertLinkRead(result.calls);
    assert.equal(result.cookieCalls.length, 1);
    assert.equal(result.cookieCalls[0].username, USERNAME);
    assert.equal(result.cookieCalls[0].sv, 7);
    assert.equal(result.body.csrfToken, 'synthetic-rotated-csrf');
    assert.ok(result.response.headers.has('set-cookie'));
  }
});

test('login proves credentials and account state before the link lookup or cookie issue', async () => {
  for (const options of [
    { body: { username: EMAIL, password: 'synthetic-wrong-password', workforceEmployeeId: EMPLOYEE_ID } },
    { userRow: null },
    { userRow: { ...USER_ROW, ativo: 0 } },
    { userRow: { ...USER_ROW, password_hash: '' } },
  ]) {
    const result = await auth('/auth/login', { sessionUsername: null, ...options });
    assert.equal(result.response.status, 401);
    assert.equal(result.body.error, 'Invalid credentials');
    assert.deepEqual(linkCalls(result.calls), []);
    assert.deepEqual(result.cookieCalls, []);
  }
});

test('optional link source failure preserves authenticated CONSULTOR profile and login/refresh cookies without an invented ID', async () => {
  for (const path of ['/auth/me', '/auth/refresh', '/auth/login']) {
    const result = await auth(path, { linkError: new Error('synthetic-private-binding-detail-do-not-echo') });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.success, true);
    assert.equal(result.body.user.professionalIdentityStatus, 'UNAVAILABLE');
    assert.equal(result.body.user.username, USERNAME);
    assert.equal(result.body.user.role, 'CONSULTOR');
    assert.deepEqual(result.body.user.allowedUnits, ['barra-shopping-sul']);
    assert.deepEqual(result.body.user.allowedModules, ['atendimento']);
    assert.equal(Object.hasOwn(result.body.user, 'workforceEmployeeId'), false);
    assert.equal(Object.hasOwn(result.body.user, 'professionalId'), false);
    assert.equal(result.response.headers.has('set-cookie'), path !== '/auth/me');
    assert.equal(result.cookieCalls.length, path === '/auth/me' ? 0 : 1);
    if (path !== '/auth/me') {
      assert.equal(result.cookieCalls[0].username, USERNAME);
      assert.equal(result.cookieCalls[0].sv, 7);
      assert.equal(result.body.csrfToken, 'synthetic-rotated-csrf');
    } else {
      assert.equal(result.body.csrfToken, 'synthetic-existing-csrf');
      assert.equal(result.calls.some(({ method }) => method === 'run'), false);
    }
    assert.equal(JSON.stringify(result.body).includes('synthetic-private-binding-detail'), false);
    assertLinkRead(result.calls);
  }
});

test('GESTOR, ADMIN, INJETOR and other roles authenticate without consulting the optional professional-link source', async () => {
  for (const role of ['GESTOR', 'ADMIN', 'INJETOR', 'OUTRO_PAPEL']) {
    for (const path of ['/auth/me', '/auth/refresh', '/auth/login']) {
      const result = await auth(path, {
        userRow: { ...USER_ROW, role },
        linkError: new Error('synthetic-link-source-unavailable'),
      });
      assert.equal(result.response.status, 200);
      assert.equal(result.body.success, true);
      assert.deepEqual(result.body.user, {
        name: 'Synthetic Account', displayName: 'Synthetic Account', username: USERNAME, email: EMAIL,
        role, photoUrl: '', allowedUnits: ['barra-shopping-sul'], allowedModules: ['atendimento'],
      });
      assert.deepEqual(linkCalls(result.calls), []);
      assert.equal(result.response.headers.has('set-cookie'), path !== '/auth/me');
      assert.equal(result.cookieCalls.length, path === '/auth/me' ? 0 : 1);
      if (path !== '/auth/me') assert.equal(result.cookieCalls[0].username, USERNAME);
    }
  }
});
