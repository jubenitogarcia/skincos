import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createApiGateway } from '../../api/src/gateway.js';
import { runCrmIdentityStagingSessionSmoke } from '../crm-identity-staging-session-smoke.mjs';
import { runCrmIdentityStagingProjectionSmoke, validateCrmProjectionSmokeReport } from '../crm-identity-staging-projection-smoke.mjs';
import { resetBoundServiceResilienceForTest } from '../../shared/service-adapters/cloudflare-service-binding.js';

const pins = { sourceSha: 'a'.repeat(40), coreReleaseSha: 'b'.repeat(40), coreArtifactDigest: `sha256:${'c'.repeat(64)}`,
  gatewayVersionId: '11111111-1111-4111-8111-111111111111', issuerVersionId: '22222222-2222-4222-8222-222222222222' };
const NH = 'novo-hamburgo'; const BSS = 'barra-shopping-sul';
const json = (body, headers = {}) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
const event = (index) => ({ contractVersion: 'crm-projection-event/v2', id: `event:synthetic_event_${index}`,
  projection: { kind: 'client-reference', reference: `projection:synthetic_projection_${index}` },
  source: { owner: 'atendimento', reference: `source:synthetic_source_${index}` }, unitScope: { unitSlug: NH },
  revision: 1, operation: 'upsert', occurredAt: '2026-09-08T00:00:00.000Z' });

function fixture(directory, { changeResponse, permissionCount = 0 } = {}) {
  resetBoundServiceResilienceForTest();
  const scenarios = [['nh', [NH]], ['bss', [BSS]], ['both', [NH, BSS]], ['admin', []]].map(([id, units]) => ({
    id, username: `synthetic-${id}`, email: `synthetic-${id}@example.invalid`, password: 'synthetic-password',
    identitySubject: `idn:synthetic_identity_subject_${id}`, role: id === 'admin' ? 'ADMIN' : 'GESTOR',
    allowedUnits: units, expectedUnits: units,
  }));
  const fixturesPath = join(directory, 'fixtures.json');
  writeFileSync(fixturesPath, JSON.stringify({ environment: 'staging', scenarios }));
  const calls = { issuer: 0, coreDeliveries: 0, login: [] };
  const delivered = new Map();
  const gateway = createApiGateway({
    inventoryHandler: async (request) => {
      assert.equal(new URL(request.url).pathname, '/auth/login');
      const input = await request.json(); const scenario = scenarios.find((entry) => entry.email === input.email);
      assert.equal(input.password, scenario.password); calls.login.push(scenario.id);
      return json({ success: true }, { 'set-cookie': `session=${scenario.id}; Path=/; HttpOnly; Secure; SameSite=None` });
    },
    resolveActor: async (request) => {
      const cookie = request.headers.get('cookie'); const scenario = scenarios.find((entry) => cookie === `session=${entry.id}`);
      return { actor: scenario ? { identitySubject: scenario.identitySubject, role: scenario.role,
        scopes: { units: [...scenario.allowedUnits].sort(), modules: ['insumos'], permissions: permissionCount ? ['insumos:read'] : [] } } : null };
    },
  });
  const env = {
    ENVIRONMENT: 'staging', APP_VERSION: pins.sourceSha, CF_VERSION_METADATA: { id: pins.gatewayVersionId },
    CRM_IDENTITY_ISSUER_CALLER_ENABLED: 'true', CRM_IDENTITY_ISSUER_CALLER_ID: 'crm-api-staging-v1',
    CRM_IDENTITY_ISSUER_CALLER_HMAC: 'synthetic_caller_hmac_for_offline_smoke_tests_only',
    IDENTITY_CRM_ISSUER: { fetch: async (request) => {
      assert.equal(request.headers.has('cookie'), false); const body = await request.json(); calls.issuer += 1;
      const compact = `synthetic.${body.jti}.signature`; delivered.set(compact, body);
      return json({ ok: true, version: 'identity-crm-delivery/v1', keyId: 'crm-staging-test', compact });
    } },
    CRM_CORE: { fetch: async (request) => {
      assert.equal(request.headers.has('cookie'), false); assert.equal(request.headers.has('authorization'), false);
      const url = new URL(request.url); const requestId = request.headers.get('x-request-id');
      if (url.pathname === '/crm/ready') return json({ ok: true, reason: 'CRM_STAGING_READY', environment: 'staging', release: pins.coreReleaseSha, artifactDigest: pins.coreArtifactDigest });
      const delivery = delivered.get(request.headers.get('x-identity-delivery')); assert.ok(delivery); calls.coreDeliveries += 1;
      if (url.pathname === '/crm/session') return json({ ok: true, identity: delivery.identity, requestId });
      const units = url.search.slice('?units='.length).split(',');
      assert.equal(delivery.request.target, `/api/crm/projections?units=${units.join(',')}`);
      const projections = units.includes(NH) ? [event(1), event(2)] : [];
      return json({ ok: true, contractVersion: 'crm-core/projection-read/v2', state: 'available',
        scope: { mode: 'intersection', units }, projections, count: projections.length, requestId });
    } },
  };
  return { calls, fixturesPath, fetchImpl: async (url, init) => {
    const response = await gateway(new Request(url, init), env, {});
    return changeResponse ? changeResponse(response, url, init) : response;
  } };
}

test('extended canonical fixture smoke keeps session v1 and proves new/old origins with exactly six deliveries', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'crm-extended-smoke-'));
  try {
    const f = fixture(directory); const reportPath = join(directory, 'session.json'); const projectionReportPath = join(directory, 'projections.json');
    const result = await runCrmIdentityStagingSessionSmoke({ ...f, reportPath, projectionReportPath, projectionPins: pins, profile: 'session-and-projections' });
    assert.equal(result.schemaVersion, 1); assert.equal(result.identity.permissionCount, 0);
    assert.equal(result.authenticatedStatus, 200); assert.equal(result.repeatedStatus, 200);
    assert.deepEqual(f.calls.login, ['nh', 'bss', 'both', 'admin']);
    assert.equal(f.calls.issuer, 6); assert.equal(f.calls.coreDeliveries, 6);
    const projections = JSON.parse(readFileSync(projectionReportPath, 'utf8'));
    validateCrmProjectionSmokeReport(projections, pins);
    assert.deepEqual(projections.counts, { novoHamburgo: 2, barraShoppingSul: 0, both: 2, repeated: 2 });
    assert.equal(projections.expectedIdentityReceiptDelta, 4);
    for (const report of [reportPath, projectionReportPath]) {
      assert.doesNotMatch(readFileSync(report, 'utf8'), /idn:|event:|projection:|source:|synthetic-password|example.invalid|session=|\.signature/);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('original session profile still generates only two deliveries and needs no projection pins', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'crm-session-compat-'));
  try {
    const f = fixture(directory); const result = await runCrmIdentityStagingSessionSmoke({ ...f, profile: 'session', reportPath: join(directory, 'session.json') });
    assert.equal(result.result, 'verified'); assert.equal(f.calls.coreDeliveries, 2); assert.deepEqual(f.calls.login, ['nh']);
    assert.equal(Object.hasOwn(result, 'counts'), false); assert.equal(Object.hasOwn(result, 'sourceSha'), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('extended smoke rejects permission widening of the canonical zero-permission fixture', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'crm-permission-smoke-'));
  try {
    const f = fixture(directory, { permissionCount: 1 });
    await assert.rejects(runCrmIdentityStagingSessionSmoke({ ...f, projectionReportPath: join(directory, 'projection.json'), projectionPins: pins,
      profile: 'session-and-projections' }), /FIXTURE_PERMISSION_MISMATCH/);
    assert.equal(f.calls.coreDeliveries, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('projection smoke refuses version drift, missing CORS, cookie leaks and malformed opaque responses', async (t) => {
  for (const [label, mutation] of [
    ['gateway source drift', (response) => response.headers.set('x-skincos-gateway-release-sha', 'd'.repeat(40))],
    ['missing CORS', (response) => response.headers.delete('access-control-allow-origin')],
    ['cookie leak', (response) => response.headers.set('set-cookie', 'synthetic=must-not-persist')],
    ['extra payload field', async (response) => {
      const body = await response.json(); body.customerEmail = 'private@example.invalid';
      return new Response(JSON.stringify(body), { status: response.status, headers: response.headers });
    }],
  ]) await t.test(label, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'crm-invalid-projection-'));
    try {
      const f = fixture(directory, { changeResponse: async (response, url) => {
        if (url.includes('/crm/projections') && response.status === 200) return await mutation(response) || response;
        return response;
      } });
      const reportPath = join(directory, 'report.json');
      await assert.rejects(runCrmIdentityStagingProjectionSmoke({ ...f, pins, reportPath, getCookie: async (id) => `session=${id}` }));
      const report = JSON.parse(readFileSync(reportPath, 'utf8'));
      assert.equal(report.result, 'failed'); assert.doesNotMatch(JSON.stringify(report), /private@|must-not-persist/);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

test('strict receipt parser refuses extra fields, wrong pins, stale evidence and inconsistent aggregate counts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'crm-projection-report-'));
  try {
    const f = fixture(directory); const report = await runCrmIdentityStagingProjectionSmoke({ ...f, pins,
      reportPath: join(directory, 'report.json'), getCookie: async (id) => `session=${id}`, now: () => '2026-09-08T00:00:00.000Z' });
    assert.throws(() => validateCrmProjectionSmokeReport({ ...report, secret: 'unexpected' }, pins), /REPORT_INVALID/);
    assert.throws(() => validateCrmProjectionSmokeReport(report, { ...pins, sourceSha: 'f'.repeat(40) }), /REPORT_INVALID/);
    assert.throws(() => validateCrmProjectionSmokeReport(report, { ...pins, notBefore: '2026-09-08T00:00:01.000Z' }), /REPORT_INVALID/);
    assert.throws(() => validateCrmProjectionSmokeReport({ ...report, counts: { ...report.counts, both: 0 } }, pins), /REPORT_INVALID/);
    for (const at of ['2026-02-30T00:00:00.000Z', '2026-09-08T00:00:00Z', '2026-09-08T00:00:00.000+00:00']) {
      assert.throws(() => validateCrmProjectionSmokeReport({ ...report, at }, pins), /REPORT_INVALID/);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
