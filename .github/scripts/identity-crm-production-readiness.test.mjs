import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  IDENTITY_CRM_DELIVERY_PROTOCOL,
  PRODUCTION_WORKER_NAME,
  REQUIRED_PRODUCTION_SECRET_NAMES,
  runIdentityCrmProductionReadiness,
} from './identity-crm-production-readiness.mjs';

const accountId = '0123456789abcdef0123456789abcdef';
const zoneId = 'fedcba9876543210fedcba9876543210';
const apiToken = 'read-only-token-used-only-by-test';
const workerUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${PRODUCTION_WORKER_NAME}`;
const routesUrl = `https://api.cloudflare.com/client/v4/zones/${zoneId}/workers/routes?per_page=1000`;
const workerUrls = ['settings', 'deployments', 'secrets', 'subdomain'].map((endpoint) => `${workerUrl}/${endpoint}`);

function assertReadCalls(calls, expectedUrls = [...workerUrls, routesUrl]) {
  assert.deepEqual(calls.map(({ url }) => url), expectedUrls);
  for (const { url, options } of calls) {
    assert.equal(options.method, 'GET');
    assert.equal(options.body, undefined);
    assert.deepEqual(options.headers, { authorization: `Bearer ${apiToken}`, accept: 'application/json' });
    assert.ok(!url.includes(apiToken));
  }
}

function completeEnvironment(overrides = {}) {
  return {
    CLOUDFLARE_ACCOUNT_ID: accountId,
    CLOUDFLARE_API_TOKEN: apiToken,
    CLOUDFLARE_ZONE_ID: zoneId,
    IDENTITY_CRM_DELIVERY_PRODUCTION_CUSTODY_REF: 'vault://identity/crm-delivery/production',
    IDENTITY_CRM_DELIVERY_PRODUCTION_CUSTODY_ATTESTED: 'true',
    IDENTITY_CRM_DELIVERY_PRODUCTION_CALLER_ATTESTED: 'true',
    IDENTITY_CRM_DELIVERY_PRODUCTION_REPLAY_ATTESTED: 'true',
    IDENTITY_CRM_DELIVERY_PRODUCTION_ROTATION_ATTESTED: 'true',
    ...overrides,
  };
}

function cloudflareResponse(result, status = 200) {
  return new Response(JSON.stringify({ success: status >= 200 && status < 300, result, errors: [] }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('production defaults are distinct from staging and protocol values are fixed', () => {
  assert.equal(PRODUCTION_WORKER_NAME, 'skincos-identity-crm-delivery-production');
  assert.notEqual(PRODUCTION_WORKER_NAME, 'skincos-identity-crm-delivery-staging');
  assert.deepEqual(IDENTITY_CRM_DELIVERY_PROTOCOL, {
    version: 'identity-crm-delivery/v1',
    issuer: 'skincos-identity',
    audience: 'skincos-crm-core',
    algorithm: 'EdDSA',
    type: 'skincos-identity-delivery+jws',
    maxTtlSeconds: 60,
    targetPrefix: '/api/crm',
  });
  assert.deepEqual(REQUIRED_PRODUCTION_SECRET_NAMES, [
    'IDENTITY_CRM_DELIVERY_PRODUCTION_KID',
    'IDENTITY_CRM_DELIVERY_PRODUCTION_PRIVATE_JWK',
    'IDENTITY_CRM_DELIVERY_PRODUCTION_PUBLIC_JWK',
    'IDENTITY_CRM_DELIVERY_PRODUCTION_REQUEST_HMAC',
  ]);
});

test('missing external credentials produces a blocked, non-mutating report', async () => {
  const report = await runIdentityCrmProductionReadiness({
    env: { IDENTITY_CRM_PRODUCTION_READINESS_STRICT: 'false' },
    fetchImpl: async () => {
      throw new Error('fetch must not be called without credentials');
    },
  });
  assert.equal(report.result, 'blocked');
  assert.equal(report.readOnly.mutationsAttempted, false);
  assert.equal(report.readOnly.productionDeploymentAttempted, false);
  assert.equal(report.readOnly.secretValuesReadOrEmitted, false);
  assert.equal(report.cloudflare.credentials.apiTokenPresent, false);
  assert.match(report.blockers.join('\n'), /CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID/);
});

test('complete external readback is eligible only when all attestations are present', async () => {
  const calls = [];
  const privateMarker = 'synthetic-private-value-not-for-report';
  const report = await runIdentityCrmProductionReadiness({
    env: completeEnvironment(),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url === `${workerUrl}/settings`) {
        return cloudflareResponse({
          compatibility_date: '2026-03-02',
          usage_model: 'standard',
          workers_dev: false,
          bindings: [
            { name: 'CRM_DELIVERY_SIGNER', type: 'service', service: 'identity-signer' },
            { name: 'SYNTHETIC_SECRET', type: 'secret_text', text: privateMarker },
          ],
        });
      }
      if (url === `${workerUrl}/deployments`) {
        return cloudflareResponse([{ id: 'version-20260907', source: 'wrangler', strategy: 'percentage', created_on: '2026-09-07T12:00:00Z' }]);
      }
      if (url === `${workerUrl}/secrets`) {
        return cloudflareResponse(REQUIRED_PRODUCTION_SECRET_NAMES.map((name) => ({ name, type: 'secret_text', value: privateMarker })));
      }
      if (url === `${workerUrl}/subdomain`) return cloudflareResponse({ enabled: false, previews_enabled: false });
      if (url === routesUrl) return cloudflareResponse([{ script: 'unrelated-worker', pattern: privateMarker }]);
      throw new Error(`unexpected URL ${url}`);
    },
  });
  assert.equal(report.result, 'eligible-for-approved-cutover');
  assert.deepEqual(report.blockers, []);
  assert.equal(report.cloudflare.secretInventory.valuesReadOrEmitted, false);
  assert.equal(report.cloudflare.routeReadback.count, 0);
  assertReadCalls(calls);
  assert.doesNotMatch(JSON.stringify(report), new RegExp(apiToken));
  assert.doesNotMatch(JSON.stringify(report), new RegExp(privateMarker));
});

for (const responseKind of ['json-error', 'non-json-error']) {
  test(`zone-scoped ${responseKind} remains blocked and sanitized`, async () => {
    const calls = [];
    const privateMarker = `synthetic-private-${responseKind}`;
    const report = await runIdentityCrmProductionReadiness({
      env: completeEnvironment(),
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        if (url !== routesUrl) return cloudflareResponse([]);
        if (responseKind === 'non-json-error') return new Response(`${privateMarker} ${apiToken}`, { status: 502 });
        return new Response(JSON.stringify({
          success: false,
          errors: [{ code: 10000, message: `${privateMarker} ${apiToken}` }],
          result: { value: privateMarker },
        }), { status: 403 });
      },
    });
    assertReadCalls(calls);
    assert.equal(report.result, 'blocked');
    assert.equal(report.cloudflare.routeInventory, 'unavailable');
    assert.ok(report.blockers.includes('production Worker route inventory could not be read'));
    assert.deepEqual(report.cloudflare.routeReadback, { count: 0, patterns: [] });
    assert.doesNotMatch(JSON.stringify(report), new RegExp(`${privateMarker}|${apiToken}`));
  });
}

for (const invalidZone of ['', 'invalid-zone']) {
  test(`missing or malformed zone (${invalidZone || 'empty'}) makes no route request`, async () => {
    const calls = [];
    const report = await runIdentityCrmProductionReadiness({
      env: completeEnvironment({ CLOUDFLARE_ZONE_ID: invalidZone }),
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return cloudflareResponse([]);
      },
    });
    assertReadCalls(calls, workerUrls);
    assert.equal(report.result, 'blocked');
    assert.equal(report.cloudflare.routeInventory, 'not-configured');
    assert.ok(report.blockers.includes('production Worker route inventory could not be read'));
  });
}

test('production Worker absence remains blocked and only error codes are retained', async () => {
  const report = await runIdentityCrmProductionReadiness({
    env: completeEnvironment(),
    fetchImpl: async (url) => {
      if (url.endsWith('/settings')) return cloudflareResponse({ code: 10090 }, 404);
      return cloudflareResponse({ code: 10090 }, 404);
    },
  });
  assert.equal(report.result, 'blocked');
  assert.equal(report.cloudflare.settings, 'not-found');
  assert.ok(report.blockers.some((blocker) => blocker.includes('settings')));
  assert.doesNotMatch(JSON.stringify(report), /read-only-token-used-only-by-test/);
});

test('workflow is dispatch-only, production-scoped and read-only', async () => {
  const workflow = await readFile(new URL('../workflows/identity-crm-delivery-production-readiness.yml', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /permissions:\s*\n\s+contents: read/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /identity-crm-production-readiness\.mjs/);
  assert.match(workflow, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/);
  assert.doesNotMatch(workflow, /wrangler\s+(deploy|secret\s+put)|workers\/scripts.*(?:POST|PUT|PATCH|DELETE)/i);
  assert.doesNotMatch(workflow, /IDENTITY_CRM_DELIVERY_PRODUCTION_PRIVATE_JWK:\s*[^$\n]/);
});

test('existing Identity issuer tests retain Ed25519, expiry, replay and key readback gates', async () => {
  const issuerTests = await readFile(new URL('../../identity/test/crm-issuer-v1.test.mjs', import.meta.url), 'utf8');
  const stagingTests = await readFile(new URL('../../identity/test/crm-issuer-staging-worker.test.mjs', import.meta.url), 'utf8');
  assert.match(issuerTests, /crypto\.subtle\.verify/);
  assert.match(issuerTests, /IDENTITY_DELIVERY_EXPIRED/);
  assert.match(issuerTests, /IDENTITY_JTI_REPLAY/);
  assert.match(issuerTests, /key ring rotates active kid/);
  assert.match(stagingTests, /public key and signs an authenticated request/);
  assert.match(stagingTests, /\.well-known\/identity-crm-delivery\/v1\/keys/);
});
