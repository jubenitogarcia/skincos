import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const EXPECTED_ORIGIN = 'https://api-staging.skincos.com.br';
const ERROR_PATTERN = /^[A-Z0-9_]{3,120}$/;

function fail(code) {
  throw new Error(code);
}

function plainObject(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  return value;
}

function exactKeys(value, keys, code) {
  plainObject(value, code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code);
  return value;
}

function parseJson(text, code) {
  try {
    return JSON.parse(text);
  } catch {
    fail(code);
  }
}

function assertStagingOrigin(value) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    fail('CRM_SESSION_SMOKE_ORIGIN_INVALID');
  }
  if (url.origin !== EXPECTED_ORIGIN || url.pathname !== '/' || url.search || url.hash) fail('CRM_SESSION_SMOKE_ORIGIN_INVALID');
  return url.origin;
}

function loadScenario(fixturesPath) {
  if (typeof fixturesPath !== 'string' || !fixturesPath) fail('CRM_SESSION_SMOKE_FIXTURES_REQUIRED');
  const fixtures = parseJson(fs.readFileSync(fixturesPath, 'utf8'), 'CRM_SESSION_SMOKE_FIXTURES_INVALID');
  plainObject(fixtures, 'CRM_SESSION_SMOKE_FIXTURES_INVALID');
  if (fixtures.environment !== 'staging' || !Array.isArray(fixtures.scenarios)) fail('CRM_SESSION_SMOKE_FIXTURES_INVALID');
  const scenario = fixtures.scenarios.find((candidate) => candidate?.id === 'nh');
  exactKeys(scenario, ['allowedUnits', 'email', 'expectedUnits', 'id', 'identitySubject', 'password', 'role', 'username'], 'CRM_SESSION_SMOKE_FIXTURES_INVALID');
  if (
    typeof scenario.email !== 'string'
    || typeof scenario.password !== 'string'
    || typeof scenario.username !== 'string'
    || typeof scenario.identitySubject !== 'string'
    || !/^idn:[A-Za-z0-9_-]{16,160}$/.test(scenario.identitySubject)
    || typeof scenario.role !== 'string'
    || !Array.isArray(scenario.expectedUnits)
  ) fail('CRM_SESSION_SMOKE_FIXTURES_INVALID');
  return scenario;
}

function setCookies(response) {
  if (typeof response?.headers?.getSetCookie === 'function') return response.headers.getSetCookie();
  const fallback = response?.headers?.get('set-cookie');
  return fallback ? [fallback] : [];
}

function cookieHeader(response) {
  const pairs = setCookies(response).map((line) => String(line).split(';', 1)[0]).filter(Boolean);
  if (!pairs.length || pairs.some((pair) => !/^[^=;\s]+=[^;\s]+$/.test(pair))) fail('CRM_SESSION_SMOKE_LOGIN_COOKIE_MISSING');
  return pairs.join('; ');
}

function assertNoCookie(response, code) {
  if (setCookies(response).length || response.headers.get('set-cookie')) fail(code);
}

async function jsonResponse(response, code) {
  if (!response || typeof response.status !== 'number') fail(code);
  return parseJson(await response.text(), code);
}

function assertGatewayError(payload, expected) {
  exactKeys(payload, ['error', 'ok'], 'CRM_SESSION_SMOKE_GATEWAY_RESPONSE_INVALID');
  if (payload.ok !== false || payload.error !== expected) fail('CRM_SESSION_SMOKE_GATEWAY_RESPONSE_INVALID');
}

function assertVerifiedSession(payload, scenario) {
  exactKeys(payload, ['identity', 'ok', 'requestId'], 'CRM_SESSION_SMOKE_RESPONSE_INVALID');
  if (payload.ok !== true || typeof payload.requestId !== 'string' || !payload.requestId) fail('CRM_SESSION_SMOKE_RESPONSE_INVALID');
  exactKeys(payload.identity, ['identitySubject', 'role', 'scopes'], 'CRM_SESSION_SMOKE_RESPONSE_INVALID');
  const { identity } = payload;
  if (identity.identitySubject !== scenario.identitySubject || identity.role !== scenario.role) fail('CRM_SESSION_SMOKE_ACTOR_MISMATCH');
  exactKeys(identity.scopes, ['modules', 'permissions', 'units'], 'CRM_SESSION_SMOKE_RESPONSE_INVALID');
  for (const scope of Object.values(identity.scopes)) {
    if (!Array.isArray(scope) || scope.some((item) => typeof item !== 'string')) fail('CRM_SESSION_SMOKE_RESPONSE_INVALID');
  }
  if (JSON.stringify(identity.scopes.units) !== JSON.stringify(scenario.expectedUnits)) fail('CRM_SESSION_SMOKE_SCOPE_MISMATCH');
  return identity;
}

function safeFailureCode(error) {
  const candidate = error instanceof Error ? error.message : '';
  return ERROR_PATTERN.test(candidate) ? candidate : 'CRM_SESSION_SMOKE_FAILED';
}

function writeReport(reportPath, report) {
  if (typeof reportPath !== 'string' || !reportPath) return;
  fs.mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

/**
 * Runs a staging-only, synthetic end-to-end check. The ephemeral session cookie
 * remains only in this process and is deliberately never saved, logged, passed
 * to CRM Core, or represented in the sanitised report.
 */
export async function runCrmIdentityStagingSessionSmoke({
  fetchImpl = globalThis.fetch,
  fixturesPath = process.env.CRM_IDENTITY_SMOKE_FIXTURES,
  reportPath = process.env.CRM_IDENTITY_SMOKE_REPORT,
  apiOrigin = process.env.CRM_IDENTITY_SMOKE_API_ORIGIN || EXPECTED_ORIGIN,
  now = () => new Date().toISOString(),
} = {}) {
  if (typeof fetchImpl !== 'function') fail('CRM_SESSION_SMOKE_FETCH_UNAVAILABLE');
  const origin = assertStagingOrigin(apiOrigin);
  const scenario = loadScenario(fixturesPath);
  const report = {
    schemaVersion: 1,
    environment: 'staging',
    apiOrigin: origin,
    at: now(),
    credentialMaterialIncluded: false,
    piiIncluded: false,
  };

  try {
    const anonymous = await fetchImpl(`${origin}/crm/session`, {
      method: 'GET', headers: { accept: 'application/json', 'cache-control': 'no-store' }, redirect: 'manual',
    });
    assertNoCookie(anonymous, 'CRM_SESSION_SMOKE_ANONYMOUS_SET_COOKIE');
    if (anonymous.status !== 401) fail('CRM_SESSION_SMOKE_ANONYMOUS_STATUS_INVALID');
    assertGatewayError(await jsonResponse(anonymous, 'CRM_SESSION_SMOKE_ANONYMOUS_RESPONSE_INVALID'), 'CRM_IDENTITY_REQUIRED');

    const query = await fetchImpl(`${origin}/crm/session?unexpected=1`, {
      method: 'GET', headers: { accept: 'application/json', 'cache-control': 'no-store' }, redirect: 'manual',
    });
    assertNoCookie(query, 'CRM_SESSION_SMOKE_QUERY_SET_COOKIE');
    if (query.status !== 400) fail('CRM_SESSION_SMOKE_QUERY_STATUS_INVALID');
    assertGatewayError(await jsonResponse(query, 'CRM_SESSION_SMOKE_QUERY_RESPONSE_INVALID'), 'CRM_SESSION_QUERY_NOT_ALLOWED');

    const method = await fetchImpl(`${origin}/crm/session`, {
      method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', 'cache-control': 'no-store' }, body: '{}', redirect: 'manual',
    });
    assertNoCookie(method, 'CRM_SESSION_SMOKE_METHOD_SET_COOKIE');
    if (method.status !== 405) fail('CRM_SESSION_SMOKE_METHOD_STATUS_INVALID');
    assertGatewayError(await jsonResponse(method, 'CRM_SESSION_SMOKE_METHOD_RESPONSE_INVALID'), 'CRM_SESSION_METHOD_NOT_ALLOWED');

    const login = await fetchImpl(`${origin}/auth/login`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'cache-control': 'no-store' },
      body: JSON.stringify({ email: scenario.email, password: scenario.password }),
      redirect: 'manual',
    });
    if (login.status !== 200) fail('CRM_SESSION_SMOKE_LOGIN_STATUS_INVALID');
    const loginPayload = await jsonResponse(login, 'CRM_SESSION_SMOKE_LOGIN_RESPONSE_INVALID');
    if (!loginPayload || typeof loginPayload !== 'object' || loginPayload.success === false) fail('CRM_SESSION_SMOKE_LOGIN_RESPONSE_INVALID');
    const cookie = cookieHeader(login);

    const session = await fetchImpl(`${origin}/crm/session`, {
      method: 'GET', headers: { accept: 'application/json', cookie, 'cache-control': 'no-store' }, redirect: 'manual',
    });
    assertNoCookie(session, 'CRM_SESSION_SMOKE_SESSION_SET_COOKIE');
    if (session.status !== 200) fail('CRM_SESSION_SMOKE_SESSION_STATUS_INVALID');
    const identity = assertVerifiedSession(await jsonResponse(session, 'CRM_SESSION_SMOKE_RESPONSE_INVALID'), scenario);

    const repeated = await fetchImpl(`${origin}/crm/session`, {
      method: 'GET', headers: { accept: 'application/json', cookie, 'cache-control': 'no-store' }, redirect: 'manual',
    });
    assertNoCookie(repeated, 'CRM_SESSION_SMOKE_REPEATED_SET_COOKIE');
    if (repeated.status !== 200) fail('CRM_SESSION_SMOKE_REPEATED_STATUS_INVALID');
    assertVerifiedSession(await jsonResponse(repeated, 'CRM_SESSION_SMOKE_REPEATED_RESPONSE_INVALID'), scenario);

    Object.assign(report, {
      result: 'verified',
      anonymousStatus: anonymous.status,
      queryStatus: query.status,
      methodStatus: method.status,
      authenticatedStatus: session.status,
      repeatedStatus: repeated.status,
      identity: {
        opaqueSubject: true,
        unitCount: identity.scopes.units.length,
        moduleCount: identity.scopes.modules.length,
        permissionCount: identity.scopes.permissions.length,
      },
    });
    writeReport(reportPath, report);
    return report;
  } catch (error) {
    const failed = { ...report, result: 'failed', failure: safeFailureCode(error) };
    writeReport(reportPath, failed);
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runCrmIdentityStagingSessionSmoke()
    .then((report) => process.stdout.write(`${JSON.stringify(report)}\n`))
    .catch((error) => {
      process.stderr.write(`[crm-identity-staging-session-smoke] ${safeFailureCode(error)}\n`);
      process.exitCode = 1;
    });
}
