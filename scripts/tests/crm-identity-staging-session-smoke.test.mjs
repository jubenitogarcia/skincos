import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createGatewayHandler } from '../../api/src/router.js';
import { runCrmIdentityStagingSessionSmoke } from '../crm-identity-staging-session-smoke.mjs';

function fixtures(directory) {
  const fixturePath = join(directory, 'fixtures.json');
  writeFileSync(fixturePath, JSON.stringify({
    environment: 'staging',
    scenarios: [{
      id: 'nh', username: 'synthetic-user', email: 'synthetic@example.invalid', password: 'synthetic-password',
      identitySubject: 'idn:synthetic_identity_subject_0001', role: 'GESTOR', allowedUnits: ['novo-hamburgo'], expectedUnits: ['novo-hamburgo'],
    }],
  }));
  return fixturePath;
}

function response(payload, status, headers = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json', ...headers } });
}

test('staging session smoke uses a synthetic cookie only at the gateway and writes a sanitised proof', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'crm-identity-smoke-'));
  try {
    const fixturePath = fixtures(directory);
    const reportPath = join(directory, 'report.json');
    const calls = [];
    const inventoryRequests = [];
    const gateway = createGatewayHandler({
      inventoryHandler: async (request) => {
        inventoryRequests.push({ method: request.method, pathname: new URL(request.url).pathname });
        return response({ success: true }, 200, { 'set-cookie': 'session=synthetic-cookie; HttpOnly; Secure' });
      },
    });
    const fetchImpl = async (url, init) => {
      calls.push({ url, method: init.method, hasCookie: Boolean(init.headers?.cookie) });
      const path = new URL(url).pathname;
      if (path === '/inventory/auth/login') return gateway(new Request(url, init), {}, {});
      if (url.endsWith('/crm/session?unexpected=1')) return response({ ok: false, error: 'CRM_SESSION_QUERY_NOT_ALLOWED' }, 400);
      if (init.method === 'POST' && path === '/crm/session') return response({ ok: false, error: 'CRM_SESSION_METHOD_NOT_ALLOWED' }, 405);
      if (!init.headers?.cookie) return response({ ok: false, error: 'CRM_IDENTITY_REQUIRED' }, 401);
      return response({
        ok: true,
        identity: {
          identitySubject: 'idn:synthetic_identity_subject_0001', role: 'GESTOR',
          scopes: { units: ['novo-hamburgo'], modules: ['insumos'], permissions: ['insumos:read'] },
        },
        requestId: 'synthetic-request-id',
      }, 200);
    };
    const report = await runCrmIdentityStagingSessionSmoke({ profile: 'session', fetchImpl, fixturesPath: fixturePath, reportPath, now: () => '2026-09-07T00:00:00.000Z' });
    assert.equal(report.result, 'verified');
    assert.equal(report.authenticatedStatus, 200);
    assert.deepEqual(calls.map((call) => [new URL(call.url).pathname, call.method, call.hasCookie]), [
      ['/crm/session', 'GET', false], ['/crm/session', 'GET', false], ['/crm/session', 'POST', false], ['/inventory/auth/login', 'POST', false], ['/crm/session', 'GET', true], ['/crm/session', 'GET', true],
    ]);
    assert.deepEqual(inventoryRequests, [{ method: 'POST', pathname: '/auth/login' }]);
    const persisted = readFileSync(reportPath, 'utf8');
    assert.doesNotMatch(persisted, /synthetic@example\.invalid|synthetic-password|synthetic-cookie|idn:/);
    assert.match(persisted, /"credentialMaterialIncluded": false/);
    assert.deepEqual(Object.keys(JSON.parse(persisted)).sort(), [
      'anonymousStatus', 'apiOrigin', 'at', 'authenticatedStatus', 'credentialMaterialIncluded', 'environment',
      'identity', 'methodStatus', 'piiIncluded', 'queryStatus', 'repeatedStatus', 'result', 'schemaVersion',
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('staging session smoke refuses a session response that tries to return a cookie', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'crm-identity-smoke-'));
  try {
    const fixturePath = fixtures(directory);
    const reportPath = join(directory, 'report.json');
    const fetchImpl = async (url, init) => {
      const path = new URL(url).pathname;
      if (path === '/inventory/auth/login') return response({ success: true }, 200, { 'set-cookie': 'session=synthetic-cookie; HttpOnly; Secure' });
      if (url.endsWith('/crm/session?unexpected=1')) return response({ ok: false, error: 'CRM_SESSION_QUERY_NOT_ALLOWED' }, 400);
      if (init.method === 'POST' && path === '/crm/session') return response({ ok: false, error: 'CRM_SESSION_METHOD_NOT_ALLOWED' }, 405);
      if (!init.headers?.cookie) return response({ ok: false, error: 'CRM_IDENTITY_REQUIRED' }, 401);
      return response({ ok: true, identity: {}, requestId: 'unexpected' }, 200, { 'set-cookie': 'unexpected=value' });
    };
    await assert.rejects(
      runCrmIdentityStagingSessionSmoke({ profile: 'session', fetchImpl, fixturesPath: fixturePath, reportPath }),
      /CRM_SESSION_SMOKE_SESSION_SET_COOKIE/,
    );
    const persisted = JSON.parse(readFileSync(reportPath, 'utf8'));
    assert.equal(persisted.result, 'failed');
    assert.equal(persisted.failure, 'CRM_SESSION_SMOKE_SESSION_SET_COOKIE');
    assert.equal(persisted.credentialMaterialIncluded, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the public API exposes the Identity login only through the Inventory mount', async () => {
  const forwarded = [];
  const gateway = createGatewayHandler({
    inventoryHandler: async (request) => {
      forwarded.push(new URL(request.url).pathname);
      return response({ success: true }, 200);
    },
  });

  const mounted = await gateway(new Request('https://api-staging.skincos.com.br/inventory/auth/login', { method: 'POST' }), {}, {});
  assert.equal(mounted.status, 200);
  assert.deepEqual(forwarded, ['/auth/login']);

  const unmounted = await gateway(new Request('https://api-staging.skincos.com.br/auth/login', { method: 'POST' }), {}, {});
  assert.equal(unmounted.status, 404);
  assert.equal((await unmounted.json()).error, 'route_not_found');
  assert.deepEqual(forwarded, ['/auth/login']);
});

test('staging session smoke records only an allowlisted login failure stage and HTTP status', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'crm-identity-smoke-'));
  try {
    const fixturePath = fixtures(directory);
    const reportPath = join(directory, 'report.json');
    const fetchImpl = async (url, init) => {
      const path = new URL(url).pathname;
      if (path === '/inventory/auth/login') return response({ error: 'route_not_found', syntheticSecret: 'must-not-persist' }, 404);
      if (url.endsWith('/crm/session?unexpected=1')) return response({ ok: false, error: 'CRM_SESSION_QUERY_NOT_ALLOWED' }, 400);
      if (init.method === 'POST' && path === '/crm/session') return response({ ok: false, error: 'CRM_SESSION_METHOD_NOT_ALLOWED' }, 405);
      return response({ ok: false, error: 'CRM_IDENTITY_REQUIRED' }, 401);
    };
    await assert.rejects(
      runCrmIdentityStagingSessionSmoke({ profile: 'session', fetchImpl, fixturesPath: fixturePath, reportPath }),
      /CRM_SESSION_SMOKE_LOGIN_STATUS_INVALID/,
    );
    const persisted = JSON.parse(readFileSync(reportPath, 'utf8'));
    assert.equal(persisted.failure, 'CRM_SESSION_SMOKE_LOGIN_STATUS_INVALID');
    assert.equal(persisted.failureStage, 'login');
    assert.equal(persisted.failureHttpStatus, 404);
    assert.doesNotMatch(JSON.stringify(persisted), /route_not_found|must-not-persist|synthetic@example\.invalid|synthetic-password/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the extended runtime profile still requires a separate projection report before any request', async () => {
  await assert.rejects(runCrmIdentityStagingSessionSmoke({
    profile: 'session-and-projections', projectionReportPath: '',
    fetchImpl: async () => assert.fail('missing projection report must fail before any request'),
  }), /CRM_SESSION_SMOKE_PROJECTION_REPORT_REQUIRED/);
});
