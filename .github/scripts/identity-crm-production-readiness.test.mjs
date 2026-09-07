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
const apiToken = 'read-only-token-used-only-by-test';

function completeEnvironment(overrides = {}) {
  return {
    CLOUDFLARE_ACCOUNT_ID: accountId,
    CLOUDFLARE_API_TOKEN: apiToken,
    CLOUDFLARE_ZONE_ID: accountId,
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
  const report = await runIdentityCrmProductionReadiness({
    env: completeEnvironment(),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/settings')) {
        return cloudflareResponse({
          compatibility_date: '2026-03-02',
          usage_model: 'standard',
          workers_dev: false,
          bindings: [{ name: 'CRM_DELIVERY_SIGNER', type: 'service', service: 'identity-signer' }],
        });
      }
      if (url.endsWith('/deployments')) {
        return cloudflareResponse([{ id: 'version-20260907', source: 'wrangler', strategy: 'percentage', created_on: '2026-09-07T12:00:00Z' }]);
      }
      if (url.endsWith('/secrets')) {
        return cloudflareResponse(REQUIRED_PRODUCTION_SECRET_NAMES.map((name) => ({ name, type: 'secret_text' })));
      }
      if (url.endsWith('/subdomain')) return cloudflareResponse({ enabled: false, previews_enabled: false });
      if (url.includes('/workers/routes')) return cloudflareResponse([]);
      throw new Error(`unexpected URL ${url}`);
    },
  });
  assert.equal(report.result, 'eligible-for-approved-cutover');
  assert.deepEqual(report.blockers, []);
  assert.equal(report.cloudflare.secretInventory.valuesReadOrEmitted, false);
  assert.equal(report.cloudflare.routeReadback.count, 0);
  assert.equal(calls.length, 5);
  assert.ok(calls.every(({ options }) => options.method === 'GET'));
  assert.ok(calls.every(({ url }) => !url.includes(apiToken)));
  assert.doesNotMatch(JSON.stringify(report), new RegExp(apiToken));
});

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
