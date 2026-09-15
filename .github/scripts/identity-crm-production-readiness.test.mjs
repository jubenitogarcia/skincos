import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  CANDIDATE_INERT_PRODUCTION_RUNTIME_BINDINGS,
  IDENTITY_CRM_DELIVERY_PROTOCOL,
  IDENTITY_CRM_PRODUCTION_READINESS_STATES,
  CRM_IDENTITY_READBACK_CREDENTIAL_SOURCE,
  PRODUCTION_WORKER_NAME,
  PRODUCTION_ROLE_FORBIDDEN_SECRET_NAMES,
  PRODUCTION_ROLE_SECRET_TYPES,
  REQUIRED_PRODUCTION_SECRET_NAMES,
  REQUIRED_PRODUCTION_SECRET_KEY_METADATA,
  REQUIRED_PRODUCTION_RUNTIME_BINDINGS,
  REQUIRED_PRODUCTION_SECRET_TYPES,
  runIdentityCrmProductionReadiness,
  sanitizeDeployments,
} from './identity-crm-production-readiness.mjs';

const accountId = '0123456789abcdef0123456789abcdef';
const zoneId = 'fedcba9876543210fedcba9876543210';
const secondZoneId = '00112233445566778899aabbccddeeff';
const apiToken = 'read-only-token-used-only-by-test';
const workerUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${PRODUCTION_WORKER_NAME}`;
const workerUrls = ['settings', 'deployments', 'secrets', 'subdomain'].map((endpoint) => `${workerUrl}/${endpoint}`);
const deploymentId = '11111111-1111-4111-8111-111111111111';
const resolverVersionId = '22222222-2222-4222-8222-222222222222';
const issuerVersionId = '33333333-3333-4333-8333-333333333333';
const versionUrls = [resolverVersionId, issuerVersionId].map((versionId) => `${workerUrl}/versions/${versionId}`);
const workerReadbackUrls = [...workerUrls, ...versionUrls];
const zonesUrl = `https://api.cloudflare.com/client/v4/zones?account.id=${accountId}&page=1&per_page=50`;
const zonesSecondPageUrl = `https://api.cloudflare.com/client/v4/zones?account.id=${accountId}&page=2&per_page=50`;
const routesUrl = `https://api.cloudflare.com/client/v4/zones/${zoneId}/workers/routes`;
const secondRoutesUrl = `https://api.cloudflare.com/client/v4/zones/${secondZoneId}/workers/routes`;
const domainsUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/domains?page=1&per_page=50`;
const domainsSecondPageUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/domains?page=2&per_page=50`;
const completeReadUrls = [...workerReadbackUrls, zonesUrl, domainsUrl, routesUrl];

function requiredSecretInventory(overrides = {}) {
  return REQUIRED_PRODUCTION_SECRET_NAMES.map((name) => ({
    name,
    type: REQUIRED_PRODUCTION_SECRET_TYPES[name],
    ...(name === 'IDENTITY_CRM_DELIVERY_PRODUCTION_SIGNING_KEY'
      ? { algorithm: { name: 'Ed25519' }, usages: ['sign'], format: 'jwk' }
      : {}),
    ...overrides,
  }));
}

function roleSecretInventory(role, overrides = {}) {
  return Object.entries(PRODUCTION_ROLE_SECRET_TYPES[role]).map(([name, type]) => ({
    name,
    type,
    ...(name === 'IDENTITY_CRM_DELIVERY_PRODUCTION_SIGNING_KEY'
      ? { algorithm: { name: 'Ed25519' }, usages: ['sign'], format: 'jwk' }
      : {}),
    ...overrides,
  }));
}

function requiredRuntimeBindings(overrides = {}) {
  return Object.entries(REQUIRED_PRODUCTION_RUNTIME_BINDINGS).map(([name, text]) => ({
    name,
    type: 'plain_text',
    text,
    ...overrides,
  }));
}

function candidateInertRuntimeBindings(overrides = {}) {
  return Object.entries(CANDIDATE_INERT_PRODUCTION_RUNTIME_BINDINGS).map(([name, text]) => ({
    name,
    type: 'plain_text',
    text,
    ...overrides,
  }));
}

function roleBindings(role) {
  const roleFlags = role === 'R'
    ? [
      { name: 'IDENTITY_CRM_DELIVERY_PRODUCTION_ISSUER_ENABLED', type: 'plain_text', text: 'false' },
      { name: 'IDENTITY_CRM_DELIVERY_PRODUCTION_ROUTE_RECEIPT_RESOLVER_ENABLED', type: 'plain_text', text: 'true' },
    ]
    : [
      { name: 'IDENTITY_CRM_DELIVERY_PRODUCTION_ISSUER_ENABLED', type: 'plain_text', text: 'true' },
      { name: 'IDENTITY_CRM_DELIVERY_PRODUCTION_ROUTE_RECEIPT_RESOLVER_ENABLED', type: 'plain_text', text: 'false' },
    ];
  // Cloudflare exposes each active version's complete binding set. Keep the
  // fixture representative so a version-level audit cannot inherit proof from
  // the mutable Worker-wide settings or secret inventory.
  return [...requiredRuntimeBindings(), ...roleSecretInventory(role), ...roleFlags];
}

function versionResponse(versionId, role, bindings = roleBindings(role)) {
  return cloudflareResponse({
    id: versionId,
    resources: {
      bindings,
    },
  });
}

function assertReadCalls(calls, expectedUrls = completeReadUrls, expectedApiToken = apiToken) {
  assert.deepEqual(calls.map(({ url }) => url), expectedUrls);
  for (const { url, options } of calls) {
    assert.equal(options.method, 'GET');
    assert.equal(options.body, undefined);
    assert.deepEqual(options.headers, { authorization: `Bearer ${expectedApiToken}`, accept: 'application/json' });
    assert.ok(!url.includes(expectedApiToken));
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

function cloudflareResponse(result, status = 200, resultInfo = null) {
  return new Response(JSON.stringify({ success: status >= 200 && status < 300, result, errors: [], ...(resultInfo ? { result_info: resultInfo } : {}) }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function completeWorkerResponse(url, { previewsEnabled = false, runtimeBindings = requiredRuntimeBindings() } = {}) {
  if (url === `${workerUrl}/settings`) {
    return cloudflareResponse({ compatibility_date: '2026-03-02', usage_model: 'standard', workers_dev: false, bindings: runtimeBindings });
  }
  if (url === `${workerUrl}/deployments`) {
    return cloudflareResponse({ deployments: [{
      id: deploymentId,
      source: 'wrangler',
      strategy: 'percentage',
      created_on: '2026-09-07T12:00:00Z',
      versions: [
        { version_id: resolverVersionId, percentage: 100 },
        { version_id: issuerVersionId, percentage: 0 },
      ],
    }] });
  }
  if (url === `${workerUrl}/versions/${resolverVersionId}`) return versionResponse(resolverVersionId, 'R');
  if (url === `${workerUrl}/versions/${issuerVersionId}`) return versionResponse(issuerVersionId, 'I');
  if (url === `${workerUrl}/secrets`) return cloudflareResponse(requiredSecretInventory());
  if (url === `${workerUrl}/subdomain`) return cloudflareResponse({ enabled: false, previews_enabled: previewsEnabled });
  return null;
}

function candidateInertWorkerResponse(url, { secrets = [] } = {}) {
  if (url === `${workerUrl}/settings`) {
    return cloudflareResponse({
      compatibility_date: '2026-03-02',
      usage_model: 'standard',
      workers_dev: false,
      bindings: candidateInertRuntimeBindings(),
    });
  }
  if (url === `${workerUrl}/deployments`) return cloudflareResponse({ deployments: [] });
  if (url === `${workerUrl}/secrets`) return cloudflareResponse(secrets);
  if (url === `${workerUrl}/subdomain`) return cloudflareResponse({ enabled: false, previews_enabled: false });
  return null;
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
    'IDENTITY_CRM_DELIVERY_PRODUCTION_SIGNING_KEY',
    'IDENTITY_CRM_DELIVERY_PRODUCTION_PUBLIC_JWK',
    'IDENTITY_CRM_DELIVERY_PRODUCTION_CALLER_HMAC',
  ]);
  assert.deepEqual(REQUIRED_PRODUCTION_SECRET_TYPES, {
    IDENTITY_CRM_DELIVERY_PRODUCTION_KID: 'secret_text',
    IDENTITY_CRM_DELIVERY_PRODUCTION_SIGNING_KEY: 'secret_key',
    IDENTITY_CRM_DELIVERY_PRODUCTION_PUBLIC_JWK: 'secret_text',
    IDENTITY_CRM_DELIVERY_PRODUCTION_CALLER_HMAC: 'secret_text',
  });
  assert.deepEqual(REQUIRED_PRODUCTION_SECRET_KEY_METADATA, {
    IDENTITY_CRM_DELIVERY_PRODUCTION_SIGNING_KEY: {
      algorithm: 'Ed25519',
      usages: ['sign'],
    },
  });
  assert.deepEqual(PRODUCTION_ROLE_SECRET_TYPES, {
    R: {
      IDENTITY_CRM_DELIVERY_PRODUCTION_CALLER_HMAC: 'secret_text',
      IDENTITY_CRM_CORE_PRODUCTION_ROUTE_RECEIPT: 'secret_text',
    },
    I: REQUIRED_PRODUCTION_SECRET_TYPES,
  });
  assert.deepEqual(PRODUCTION_ROLE_FORBIDDEN_SECRET_NAMES, {
    R: [
      'IDENTITY_CRM_DELIVERY_PRODUCTION_KID',
      'IDENTITY_CRM_DELIVERY_PRODUCTION_SIGNING_KEY',
      'IDENTITY_CRM_DELIVERY_PRODUCTION_PUBLIC_JWK',
    ],
    I: ['IDENTITY_CRM_CORE_PRODUCTION_ROUTE_RECEIPT'],
  });
  assert.deepEqual(REQUIRED_PRODUCTION_RUNTIME_BINDINGS, {
    IDENTITY_CRM_DELIVERY_ENABLED: 'true',
    IDENTITY_CRM_DELIVERY_ENVIRONMENT: 'production',
    IDENTITY_CRM_DELIVERY_PRODUCTION_CALLER_ENABLED: 'true',
    IDENTITY_CRM_DELIVERY_PRODUCTION_CALLER_ID: 'crm-api-production-v1',
  });
  assert.equal(IDENTITY_CRM_PRODUCTION_READINESS_STATES.CANDIDATE_INERT, 'candidate-inert');
  assert.equal(IDENTITY_CRM_PRODUCTION_READINESS_STATES.ACTIVATION_READY, 'activation-ready');
  assert.deepEqual(CANDIDATE_INERT_PRODUCTION_RUNTIME_BINDINGS, {
    IDENTITY_CRM_DELIVERY_ENABLED: 'false',
    IDENTITY_CRM_DELIVERY_ENVIRONMENT: 'production',
    IDENTITY_CRM_DELIVERY_PRODUCTION_ISSUER_ENABLED: 'false',
    IDENTITY_CRM_DELIVERY_PRODUCTION_ROUTE_RECEIPT_RESOLVER_ENABLED: 'false',
  });
});

test('deployment readback uses nested Cloudflare version assignments without inventing a flat version id', () => {
  const nested = sanitizeDeployments({ deployments: [{
    id: deploymentId,
    source: 'wrangler',
    strategy: 'percentage',
    versions: [
      { version_id: resolverVersionId, percentage: 100 },
      { version_id: issuerVersionId, percentage: 0 },
    ],
  }] });
  assert.deepEqual(nested.active?.roles, {
    R: { versionId: resolverVersionId, percentage: 100 },
    I: { versionId: issuerVersionId, percentage: 0 },
  });
  assert.equal(sanitizeDeployments({ deployments: [{
    id: deploymentId,
    strategy: 'percentage',
    version_id: resolverVersionId,
    percentage: 100,
  }] }).active, null);
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

test('dedicated CRM readback credentials never fall back to generic Cloudflare credentials', async () => {
  const genericToken = 'generic-token-that-must-not-be-used';
  let calls = 0;
  const report = await runIdentityCrmProductionReadiness({
    env: completeEnvironment({
      IDENTITY_CRM_PRODUCTION_READBACK_CREDENTIAL_SOURCE: CRM_IDENTITY_READBACK_CREDENTIAL_SOURCE,
      CLOUDFLARE_ACCOUNT_ID: accountId,
      CLOUDFLARE_API_TOKEN: genericToken,
      CRM_IDENTITY_READBACK_ACCOUNT_ID: '',
      CRM_IDENTITY_READBACK_API_TOKEN: '',
    }),
    fetchImpl: async () => {
      calls += 1;
      throw new Error('fetch must not use generic fallback credentials');
    },
  });
  assert.equal(calls, 0);
  assert.equal(report.result, 'blocked');
  assert.equal(report.cloudflare.credentials.source, CRM_IDENTITY_READBACK_CREDENTIAL_SOURCE);
  assert.equal(report.cloudflare.credentials.apiTokenPresent, false);
  assert.match(report.blockers.join('\n'), /CRM_IDENTITY_READBACK_API_TOKEN and CRM_IDENTITY_READBACK_ACCOUNT_ID/);
  assert.doesNotMatch(JSON.stringify(report), new RegExp(genericToken));
});

test('dedicated CRM readback credentials are used only when explicitly selected', async () => {
  const calls = [];
  const dedicatedToken = 'dedicated-readback-token-used-only-by-test';
  const report = await runIdentityCrmProductionReadiness({
    env: completeEnvironment({
      IDENTITY_CRM_PRODUCTION_READBACK_CREDENTIAL_SOURCE: CRM_IDENTITY_READBACK_CREDENTIAL_SOURCE,
      CLOUDFLARE_ACCOUNT_ID: accountId,
      CLOUDFLARE_API_TOKEN: 'generic-token-that-must-not-be-used',
      CRM_IDENTITY_READBACK_ACCOUNT_ID: accountId,
      CRM_IDENTITY_READBACK_API_TOKEN: dedicatedToken,
    }),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const workerResponse = completeWorkerResponse(url);
      if (workerResponse) return workerResponse;
      if (url === zonesUrl) return cloudflareResponse([{ id: zoneId, account: { id: accountId } }]);
      if (url === routesUrl || url === domainsUrl) return cloudflareResponse([]);
      throw new Error(`unexpected URL ${url}`);
    },
  });
  assert.equal(report.result, 'eligible-for-approved-cutover');
  assert.equal(report.targetState, 'activation-ready');
  assert.equal(report.candidateState, null);
  assert.equal(report.activationState, 'activation-ready');
  assert.equal(report.cloudflare.credentials.source, CRM_IDENTITY_READBACK_CREDENTIAL_SOURCE);
  assertReadCalls(calls, completeReadUrls, dedicatedToken);
  assert.doesNotMatch(JSON.stringify(report), /generic-token-that-must-not-be-used/);
});

test('candidate-inert target proves disabled Identity delivery bindings without becoming activation-ready', async () => {
  const calls = [];
  const report = await runIdentityCrmProductionReadiness({
    env: completeEnvironment({
      IDENTITY_CRM_PRODUCTION_READINESS_TARGET_STATE: IDENTITY_CRM_PRODUCTION_READINESS_STATES.CANDIDATE_INERT,
    }),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const workerResponse = candidateInertWorkerResponse(url);
      if (workerResponse) return workerResponse;
      if (url === zonesUrl) return cloudflareResponse([{ id: zoneId, account: { id: accountId } }]);
      if (url === routesUrl || url === domainsUrl) return cloudflareResponse([]);
      throw new Error(`unexpected URL ${url}`);
    },
  });
  assert.equal(report.result, 'candidate-inert');
  assert.equal(report.state, 'candidate-inert');
  assert.equal(report.targetState, 'candidate-inert');
  assert.equal(report.candidateState, 'candidate-inert');
  assert.equal(report.activationState, 'not-authorized');
  assert.equal(report.candidateInertEvidence.deploymentAbsent, true);
  assert.equal(report.candidateInertEvidence.routeReceiptAbsent, true);
  assert.equal(report.candidateInertEvidence.proven, true);
  assert.deepEqual(report.blockers, []);
  assertReadCalls(calls, [...workerUrls, zonesUrl, domainsUrl, routesUrl]);
});

test('candidate-inert accepts a verified absent Worker only when account-wide public exposure is empty', async () => {
  const report = await runIdentityCrmProductionReadiness({
    env: completeEnvironment({
      IDENTITY_CRM_PRODUCTION_READINESS_TARGET_STATE: IDENTITY_CRM_PRODUCTION_READINESS_STATES.CANDIDATE_INERT,
    }),
    fetchImpl: async (url) => {
      if (workerUrls.includes(url)) return cloudflareResponse([], 404);
      if (url === zonesUrl) return cloudflareResponse([{ id: zoneId, account: { id: accountId } }]);
      if (url === routesUrl || url === domainsUrl) return cloudflareResponse([]);
      throw new Error(`unexpected URL ${url}`);
    },
  });
  assert.equal(report.result, 'candidate-inert');
  assert.equal(report.candidateState, 'candidate-inert');
  assert.equal(report.candidateInertEvidence.settingsAbsentOrDisabled, true);
  assert.equal(report.candidateInertEvidence.deploymentAbsent, true);
  assert.equal(report.candidateInertEvidence.publicSubdomainAbsentOrDisabled, true);
  assert.equal(report.candidateInertEvidence.proven, true);
});

test('candidate-inert rejects public traffic and activation-ready runtime state', async () => {
  const publicTraffic = await runIdentityCrmProductionReadiness({
    env: completeEnvironment({
      IDENTITY_CRM_PRODUCTION_READINESS_TARGET_STATE: IDENTITY_CRM_PRODUCTION_READINESS_STATES.CANDIDATE_INERT,
    }),
    fetchImpl: async (url) => {
      const workerResponse = candidateInertWorkerResponse(url);
      if (workerResponse) return workerResponse;
      if (url === zonesUrl) return cloudflareResponse([{ id: zoneId, account: { id: accountId } }]);
      if (url === routesUrl) return cloudflareResponse([{ script: PRODUCTION_WORKER_NAME, pattern: 'crm.example/*' }]);
      if (url === domainsUrl) return cloudflareResponse([]);
      throw new Error(`unexpected URL ${url}`);
    },
  });
  assert.equal(publicTraffic.result, 'blocked');
  assert.equal(publicTraffic.candidateInertEvidence.publicRoutesAbsent, false);
  assert.ok(publicTraffic.blockers.includes('candidate-inert Worker has a route; private custody must not have public traffic'));

  const activationState = await runIdentityCrmProductionReadiness({
    env: completeEnvironment({
      IDENTITY_CRM_PRODUCTION_READINESS_TARGET_STATE: IDENTITY_CRM_PRODUCTION_READINESS_STATES.CANDIDATE_INERT,
    }),
    fetchImpl: async (url) => {
      const workerResponse = completeWorkerResponse(url);
      if (workerResponse) return workerResponse;
      if (url === zonesUrl) return cloudflareResponse([{ id: zoneId, account: { id: accountId } }]);
      if (url === routesUrl || url === domainsUrl) return cloudflareResponse([]);
      throw new Error(`unexpected URL ${url}`);
    },
  });
  assert.equal(activationState.result, 'blocked');
  assert.equal(activationState.candidateState, null);
  assert.equal(activationState.activationState, 'not-authorized');
  assert.equal(activationState.candidateInertEvidence.deploymentAbsent, false);
  assert.ok(activationState.blockers.some((blocker) => blocker.startsWith('candidate-inert Worker has runtime bindings that are missing or not disabled:')));
});

test('candidate-inert rejects route-receipt custody without emitting its value', async () => {
  const routeReceiptValue = 'route-receipt-secret-that-must-not-escape';
  const report = await runIdentityCrmProductionReadiness({
    env: completeEnvironment({
      IDENTITY_CRM_PRODUCTION_READINESS_TARGET_STATE: IDENTITY_CRM_PRODUCTION_READINESS_STATES.CANDIDATE_INERT,
    }),
    fetchImpl: async (url) => {
      const workerResponse = candidateInertWorkerResponse(url, {
        secrets: [{
          name: 'IDENTITY_CRM_CORE_PRODUCTION_ROUTE_RECEIPT',
          type: 'secret_text',
          value: routeReceiptValue,
        }],
      });
      if (workerResponse) return workerResponse;
      if (url === zonesUrl) return cloudflareResponse([{ id: zoneId, account: { id: accountId } }]);
      if (url === routesUrl || url === domainsUrl) return cloudflareResponse([]);
      throw new Error(`unexpected URL ${url}`);
    },
  });
  assert.equal(report.result, 'blocked');
  assert.equal(report.candidateInertEvidence.routeReceiptAbsent, false);
  assert.ok(report.blockers.includes('candidate-inert Worker already has route-receipt material; resolver R is activation-only'));
  assert.doesNotMatch(JSON.stringify(report), new RegExp(routeReceiptValue));
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
            ...requiredRuntimeBindings(),
          ],
        });
      }
      if (url === `${workerUrl}/deployments`) {
        return cloudflareResponse({ deployments: [{
          id: deploymentId,
          source: 'wrangler',
          strategy: 'percentage',
          created_on: '2026-09-07T12:00:00Z',
          versions: [
            { version_id: resolverVersionId, percentage: 100 },
            { version_id: issuerVersionId, percentage: 0 },
          ],
        }] });
      }
      if (url === `${workerUrl}/versions/${resolverVersionId}`) return versionResponse(resolverVersionId, 'R');
      if (url === `${workerUrl}/versions/${issuerVersionId}`) return versionResponse(issuerVersionId, 'I');
      if (url === `${workerUrl}/secrets`) {
        return cloudflareResponse(requiredSecretInventory({ value: privateMarker }));
      }
      if (url === `${workerUrl}/subdomain`) return cloudflareResponse({ enabled: false, previews_enabled: false });
      if (url === zonesUrl) return cloudflareResponse([{ id: zoneId, account: { id: accountId } }]);
      if (url === routesUrl) return cloudflareResponse([{ script: 'unrelated-worker', pattern: privateMarker }]);
      if (url === domainsUrl) return cloudflareResponse([{ service: 'unrelated-worker', hostname: privateMarker }]);
      throw new Error(`unexpected URL ${url}`);
    },
  });
  assert.equal(report.result, 'eligible-for-approved-cutover');
  assert.deepEqual(report.blockers, []);
  assert.deepEqual(report.cloudflare.subdomainReadback, { enabled: false, previewsEnabled: false });
  assert.equal(report.cloudflare.secretInventory.valuesReadOrEmitted, false);
  assert.deepEqual(report.cloudflare.routeReadback, { zonesInspected: 1, count: 0, patterns: [] });
  assert.deepEqual(report.cloudflare.customDomainReadback, { count: 0 });
  assert.deepEqual(report.cloudflare.deploymentBaseline.active, {
    id: deploymentId,
    source: 'wrangler',
    strategy: 'percentage',
    createdOn: '2026-09-07T12:00:00Z',
    versions: [
      { versionId: resolverVersionId, percentage: 100 },
      { versionId: issuerVersionId, percentage: 0 },
    ],
    roles: {
      R: { versionId: resolverVersionId, percentage: 100 },
      I: { versionId: issuerVersionId, percentage: 0 },
    },
  });
  assert.deepEqual(report.cloudflare.versionBindingAudit.roles, {
    R: { versionId: resolverVersionId, percentage: 100 },
    I: { versionId: issuerVersionId, percentage: 0 },
  });
  assertReadCalls(calls);
  assert.doesNotMatch(JSON.stringify(report), new RegExp(apiToken));
  assert.doesNotMatch(JSON.stringify(report), new RegExp(privateMarker));
});

test('version-override issuer I must retain an exact zero-percent assignment', async () => {
  const calls = [];
  const report = await runIdentityCrmProductionReadiness({
    env: completeEnvironment(),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url === `${workerUrl}/deployments`) {
        return cloudflareResponse({ deployments: [{
          id: deploymentId,
          source: 'wrangler',
          strategy: 'percentage',
          created_on: '2026-09-07T12:00:00Z',
          versions: [
            { version_id: resolverVersionId, percentage: 99.99 },
            { version_id: issuerVersionId, percentage: 0.01 },
          ],
        }] });
      }
      const workerResponse = completeWorkerResponse(url);
      if (workerResponse) return workerResponse;
      if (url === zonesUrl) return cloudflareResponse([{ id: zoneId, account: { id: accountId } }]);
      if (url === routesUrl || url === domainsUrl) return cloudflareResponse([]);
      throw new Error(`unexpected URL ${url}`);
    },
  });
  assert.equal(report.result, 'blocked');
  assert.ok(report.blockers.includes('production Worker must keep resolver R at 100% and issuer I at 0% for the private version override'));
  assert.deepEqual(report.cloudflare.versionBindingAudit.roles, {
    R: { versionId: resolverVersionId, percentage: 99.99 },
    I: { versionId: issuerVersionId, percentage: 0.01 },
  });
  assertReadCalls(calls);
});

test('production readiness requires exact private-caller runtime bindings without emitting their values', async () => {
  for (const { expectedName, expectedStatus, mutate } of [
    {
      expectedName: 'IDENTITY_CRM_DELIVERY_PRODUCTION_CALLER_ENABLED',
      expectedStatus: 'missing',
      mutate: (bindings) => bindings.filter((binding) => binding.name !== 'IDENTITY_CRM_DELIVERY_PRODUCTION_CALLER_ENABLED'),
    },
    {
      expectedName: 'IDENTITY_CRM_DELIVERY_PRODUCTION_CALLER_ID',
      expectedStatus: 'incorrect',
      mutate: (bindings) => bindings.map((binding) => binding.name === 'IDENTITY_CRM_DELIVERY_PRODUCTION_CALLER_ID'
      ? { ...binding, text: 'incorrect-caller' }
        : binding),
    },
    {
      expectedName: 'IDENTITY_CRM_DELIVERY_ENABLED',
      expectedStatus: 'incorrect',
      mutate: (bindings) => bindings.map((binding) => binding.name === 'IDENTITY_CRM_DELIVERY_ENABLED'
      ? { ...binding, text: 'false' }
        : binding),
    },
  ]) {
    const report = await runIdentityCrmProductionReadiness({
      env: completeEnvironment(),
      fetchImpl: async (url) => {
        if (url === `${workerUrl}/settings`) {
          return cloudflareResponse({
            compatibility_date: '2026-03-02',
            usage_model: 'standard',
            workers_dev: false,
            bindings: mutate(requiredRuntimeBindings()),
          });
        }
        const workerResponse = completeWorkerResponse(url);
        if (workerResponse) return workerResponse;
        if (url === zonesUrl) return cloudflareResponse([{ id: zoneId, account: { id: accountId } }]);
        if (url === routesUrl || url === domainsUrl) return cloudflareResponse([]);
        throw new Error(`unexpected URL ${url}`);
      },
    });
    assert.equal(report.result, 'blocked');
    assert.ok(report.blockers.some((blocker) => blocker.startsWith('production Worker has required runtime bindings that are missing or incorrect:')));
    assert.doesNotMatch(JSON.stringify(report), /incorrect-caller/);
    assert.equal(report.cloudflare.workerSettings.requiredRuntimeBindings[expectedName], expectedStatus);
  }
});

test('production readiness verifies required runtime and secret bindings on each active version', async () => {
  for (const { versionId, role, mutate, expectedBlocker, verifyAudit } of [
    {
      versionId: resolverVersionId,
      role: 'R',
      mutate: (bindings) => bindings.filter((binding) => binding.name !== 'IDENTITY_CRM_DELIVERY_PRODUCTION_CALLER_ENABLED'),
      expectedBlocker: 'production Worker resolver R version has required runtime bindings that are missing or incorrect: IDENTITY_CRM_DELIVERY_PRODUCTION_CALLER_ENABLED',
      verifyAudit: (audit) => assert.equal(audit.requiredRuntimeBindings.IDENTITY_CRM_DELIVERY_PRODUCTION_CALLER_ENABLED, 'missing'),
    },
    {
      versionId: issuerVersionId,
      role: 'I',
      mutate: (bindings) => bindings.map((binding) => binding.name === 'IDENTITY_CRM_DELIVERY_PRODUCTION_SIGNING_KEY'
        ? { ...binding, type: 'secret_text' }
        : binding),
      expectedBlocker: 'production Worker issuer I version has required secret bindings with incorrect types: IDENTITY_CRM_DELIVERY_PRODUCTION_SIGNING_KEY (expected secret_key)',
      verifyAudit: (audit) => assert.equal(audit.secretInventory.types.IDENTITY_CRM_DELIVERY_PRODUCTION_SIGNING_KEY, 'secret_text'),
    },
  ]) {
    const report = await runIdentityCrmProductionReadiness({
      env: completeEnvironment(),
      fetchImpl: async (url) => {
        if (url === `${workerUrl}/versions/${versionId}`) return versionResponse(versionId, role, mutate(roleBindings(role)));
        const workerResponse = completeWorkerResponse(url);
        if (workerResponse) return workerResponse;
        if (url === zonesUrl) return cloudflareResponse([{ id: zoneId, account: { id: accountId } }]);
        if (url === routesUrl || url === domainsUrl) return cloudflareResponse([]);
        throw new Error(`unexpected URL ${url}`);
      },
    });
    assert.equal(report.result, 'blocked');
    assert.ok(report.blockers.includes(expectedBlocker));
    const entry = report.cloudflare.versionBindingAudit.entries.find((candidate) => candidate.versionId === versionId);
    assert.equal(entry.state, 'available');
    assert.equal(entry.audit.role, role);
    verifyAudit(entry.audit);
    assert.equal(JSON.stringify(report).includes('incorrect-caller'), false);
    assert.equal(entry.audit.secretInventory.valuesReadOrEmitted, false);
  }
});

test('production readiness keeps resolver and issuer secret custody separated by immutable version', async () => {
  for (const { versionId, role, mutate, expectedBlocker } of [
    {
      versionId: resolverVersionId,
      role: 'R',
      mutate: (bindings) => bindings.filter((binding) => binding.name !== 'IDENTITY_CRM_CORE_PRODUCTION_ROUTE_RECEIPT'),
      expectedBlocker: 'production Worker resolver R version is missing required secret names: IDENTITY_CRM_CORE_PRODUCTION_ROUTE_RECEIPT',
    },
    {
      versionId: issuerVersionId,
      role: 'I',
      mutate: (bindings) => bindings.filter((binding) => binding.name !== 'IDENTITY_CRM_DELIVERY_PRODUCTION_KID'),
      expectedBlocker: 'production Worker issuer I version is missing required secret names: IDENTITY_CRM_DELIVERY_PRODUCTION_KID',
    },
    {
      versionId: resolverVersionId,
      role: 'R',
      mutate: (bindings) => [...bindings, {
        name: 'IDENTITY_CRM_DELIVERY_PRODUCTION_SIGNING_KEY',
        type: 'secret_key',
        algorithm: { name: 'Ed25519' },
        usages: ['sign'],
      }],
      expectedBlocker: 'production Worker resolver R version carries forbidden Identity CRM secret names: IDENTITY_CRM_DELIVERY_PRODUCTION_SIGNING_KEY',
    },
    {
      versionId: issuerVersionId,
      role: 'I',
      mutate: (bindings) => [...bindings, {
        name: 'IDENTITY_CRM_CORE_PRODUCTION_ROUTE_RECEIPT',
        type: 'secret_text',
      }],
      expectedBlocker: 'production Worker issuer I version carries forbidden Identity CRM secret names: IDENTITY_CRM_CORE_PRODUCTION_ROUTE_RECEIPT',
    },
  ]) {
    const report = await runIdentityCrmProductionReadiness({
      env: completeEnvironment(),
      fetchImpl: async (url) => {
        if (url === `${workerUrl}/versions/${versionId}`) return versionResponse(versionId, role, mutate(roleBindings(role)));
        const workerResponse = completeWorkerResponse(url);
        if (workerResponse) return workerResponse;
        if (url === zonesUrl) return cloudflareResponse([{ id: zoneId, account: { id: accountId } }]);
        if (url === routesUrl || url === domainsUrl) return cloudflareResponse([]);
        throw new Error(`unexpected URL ${url}`);
      },
    });
    assert.equal(report.result, 'blocked');
    assert.ok(report.blockers.includes(expectedBlocker));
    assert.equal(report.readOnly.secretValuesReadOrEmitted, false);
  }
});

test('production readiness rejects a textual signing binding before approving cutover', async () => {
  const report = await runIdentityCrmProductionReadiness({
    env: completeEnvironment(),
    fetchImpl: async (url) => {
      if (url === `${workerUrl}/secrets`) {
        return cloudflareResponse(requiredSecretInventory().map((entry) => entry.name === 'IDENTITY_CRM_DELIVERY_PRODUCTION_SIGNING_KEY'
          ? { ...entry, type: 'secret_text' }
          : entry));
      }
      const workerResponse = completeWorkerResponse(url);
      if (workerResponse) return workerResponse;
      if (url === zonesUrl) return cloudflareResponse([{ id: zoneId, account: { id: accountId } }]);
      if (url === routesUrl || url === domainsUrl) return cloudflareResponse([]);
      throw new Error(`unexpected URL ${url}`);
    },
  });
  assert.equal(report.result, 'blocked');
  assert.ok(report.blockers.includes('production Worker has required secret bindings with incorrect types: IDENTITY_CRM_DELIVERY_PRODUCTION_SIGNING_KEY (expected secret_key)'));
  assert.equal(report.cloudflare.secretInventory.types.IDENTITY_CRM_DELIVERY_PRODUCTION_SIGNING_KEY, 'secret_text');
  assert.equal(report.cloudflare.secretInventory.valuesReadOrEmitted, false);
});

test('production readiness rejects a signing key with a non-Ed25519 algorithm or unsafe usages', async () => {
  for (const replacement of [
    { algorithm: { name: 'HMAC' }, usages: ['sign'] },
    { algorithm: { name: 'Ed25519' }, usages: ['verify'] },
    { algorithm: { name: 'Ed25519' }, usages: ['sign', 'verify'] },
  ]) {
    const report = await runIdentityCrmProductionReadiness({
      env: completeEnvironment(),
      fetchImpl: async (url) => {
        if (url === `${workerUrl}/secrets`) {
          return cloudflareResponse(requiredSecretInventory().map((entry) => entry.name === 'IDENTITY_CRM_DELIVERY_PRODUCTION_SIGNING_KEY'
            ? { ...entry, ...replacement }
            : entry));
        }
        const workerResponse = completeWorkerResponse(url);
        if (workerResponse) return workerResponse;
        if (url === zonesUrl) return cloudflareResponse([{ id: zoneId, account: { id: accountId } }]);
        if (url === routesUrl || url === domainsUrl) return cloudflareResponse([]);
        throw new Error(`unexpected URL ${url}`);
      },
    });
    assert.equal(report.result, 'blocked');
    assert.ok(report.blockers.includes('production Worker has required secret-key metadata: IDENTITY_CRM_DELIVERY_PRODUCTION_SIGNING_KEY (expected Ed25519 with usages sign)'));
    assert.deepEqual(report.cloudflare.secretInventory.keyMetadata.IDENTITY_CRM_DELIVERY_PRODUCTION_SIGNING_KEY,
      { algorithm: replacement.algorithm.name, usages: [...replacement.usages].sort() });
    assert.equal(report.cloudflare.secretInventory.valuesReadOrEmitted, false);
  }
});

test('route readback paginates every account zone and blocks a matching route in a later zone', async () => {
  const calls = [];
  const report = await runIdentityCrmProductionReadiness({
    env: completeEnvironment(),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const workerResponse = completeWorkerResponse(url);
      if (workerResponse) return workerResponse;
      if (url === zonesUrl) {
        return cloudflareResponse([{ id: zoneId, account: { id: accountId } }], 200, {
          page: 1, total_pages: 2, total_count: 2,
        });
      }
      if (url === zonesSecondPageUrl) {
        return cloudflareResponse([{ id: secondZoneId, account: { id: accountId } }], 200, {
          page: 2, total_pages: 2, total_count: 2,
        });
      }
      if (url === domainsUrl || url === routesUrl) return cloudflareResponse([]);
      if (url === secondRoutesUrl) return cloudflareResponse([{ script: PRODUCTION_WORKER_NAME, pattern: 'private.example/crm/*' }]);
      throw new Error(`unexpected URL ${url}`);
    },
  });
  assert.equal(report.result, 'blocked');
  assert.ok(report.blockers.includes('production Worker has a route; private Identity delivery must not have a public route'));
  assert.deepEqual(report.cloudflare.routeReadback, {
    zonesInspected: 2,
    count: 1,
    patterns: ['private.example/crm/*'],
  });
  assertReadCalls(calls, [...workerReadbackUrls, zonesUrl, zonesSecondPageUrl, domainsUrl, routesUrl, secondRoutesUrl]);
});

test('custom-domain inventory paginates and blocks a matching production Worker on page two', async () => {
  const calls = [];
  const report = await runIdentityCrmProductionReadiness({
    env: completeEnvironment(),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const workerResponse = completeWorkerResponse(url);
      if (workerResponse) return workerResponse;
      if (url === zonesUrl) return cloudflareResponse([{ id: zoneId, account: { id: accountId } }]);
      if (url === routesUrl) return cloudflareResponse([]);
      if (url === domainsUrl) {
        return cloudflareResponse([{ service: 'unrelated-worker', hostname: 'unrelated.example' }], 200, {
          page: 1, total_pages: 2, total_count: 2,
        });
      }
      if (url === domainsSecondPageUrl) {
        return cloudflareResponse([{ service: PRODUCTION_WORKER_NAME, hostname: 'private.example' }], 200, {
          page: 2, total_pages: 2, total_count: 2,
        });
      }
      throw new Error(`unexpected URL ${url}`);
    },
  });
  assert.equal(report.result, 'blocked');
  assert.ok(report.blockers.includes('production Worker has a custom domain; private Identity delivery must not have a public domain'));
  assert.deepEqual(report.cloudflare.customDomainReadback, { count: 1 });
  assertReadCalls(calls, [...workerReadbackUrls, zonesUrl, domainsUrl, routesUrl, domainsSecondPageUrl]);
});

test('custom-domain pagination without total_pages reads through total_count and remains eligible when unmatched', async () => {
  const calls = [];
  const report = await runIdentityCrmProductionReadiness({
    env: completeEnvironment(),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const workerResponse = completeWorkerResponse(url);
      if (workerResponse) return workerResponse;
      if (url === zonesUrl) return cloudflareResponse([{ id: zoneId, account: { id: accountId } }]);
      if (url === routesUrl) return cloudflareResponse([]);
      if (url === domainsUrl) {
        return cloudflareResponse([{ service: 'unrelated-worker-one', hostname: 'unrelated-one.example' }], 200, {
          page: 1, per_page: 50, count: 1, total_count: 2,
        });
      }
      if (url === domainsSecondPageUrl) {
        return cloudflareResponse([{ service: 'unrelated-worker-two', hostname: 'unrelated-two.example' }], 200, {
          page: 2, per_page: 50, count: 1, total_count: 2,
        });
      }
      throw new Error(`unexpected URL ${url}`);
    },
  });
  assert.equal(report.result, 'eligible-for-approved-cutover');
  assert.deepEqual(report.blockers, []);
  assert.deepEqual(report.cloudflare.customDomainReadback, { count: 0 });
  assertReadCalls(calls, [...workerReadbackUrls, zonesUrl, domainsUrl, routesUrl, domainsSecondPageUrl]);
});

test('account-zone inventory rejects count-only pagination metadata', async () => {
  const calls = [];
  const report = await runIdentityCrmProductionReadiness({
    env: completeEnvironment(),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const workerResponse = completeWorkerResponse(url);
      if (workerResponse) return workerResponse;
      if (url === zonesUrl) {
        return cloudflareResponse([{ id: zoneId, account: { id: accountId } }], 200, {
          page: 1, per_page: 50, count: 1, total_count: 1,
        });
      }
      throw new Error(`unexpected URL ${url}`);
    },
  });
  assert.equal(report.result, 'blocked');
  assert.equal(report.cloudflare.routeInventory, 'unavailable');
  assert.ok(report.blockers.includes('account-wide production Worker route inventory could not be read'));
  assertReadCalls(calls, [...workerReadbackUrls, zonesUrl]);
});

test('unavailable custom-domain inventory fails closed without retaining API error text', async () => {
  const privateMarker = 'synthetic-domain-api-error';
  const report = await runIdentityCrmProductionReadiness({
    env: completeEnvironment(),
    fetchImpl: async (url) => {
      const workerResponse = completeWorkerResponse(url);
      if (workerResponse) return workerResponse;
      if (url === zonesUrl) return cloudflareResponse([{ id: zoneId, account: { id: accountId } }]);
      if (url === routesUrl) return cloudflareResponse([]);
      if (url === domainsUrl) return new Response(privateMarker, { status: 502 });
      throw new Error(`unexpected URL ${url}`);
    },
  });
  assert.equal(report.cloudflare.customDomains, 'unavailable');
  assert.ok(report.blockers.includes('production Worker custom-domain inventory could not be read'));
  assert.doesNotMatch(JSON.stringify(report), new RegExp(privateMarker));
});

test('enabled preview URLs and inconsistent account-zone pagination each fail closed', async () => {
  const previewReport = await runIdentityCrmProductionReadiness({
    env: completeEnvironment(),
    fetchImpl: async (url) => {
      const workerResponse = completeWorkerResponse(url, { previewsEnabled: true });
      if (workerResponse) return workerResponse;
      if (url === zonesUrl) return cloudflareResponse([{ id: zoneId, account: { id: accountId } }]);
      if (url === routesUrl || url === domainsUrl) return cloudflareResponse([]);
      throw new Error(`unexpected URL ${url}`);
    },
  });
  assert.ok(previewReport.blockers.includes('production Worker preview URLs are not proven disabled'));
  const paginationReport = await runIdentityCrmProductionReadiness({
    env: completeEnvironment(),
    fetchImpl: async (url) => {
      const workerResponse = completeWorkerResponse(url);
      if (workerResponse) return workerResponse;
      if (url === zonesUrl) {
        return cloudflareResponse([{ id: zoneId, account: { id: accountId } }], 200, {
          page: 1, total_pages: 2, total_count: 1,
        });
      }
      if (url === zonesSecondPageUrl) {
        return cloudflareResponse([], 200, { page: 2, total_pages: 1, total_count: 1 });
      }
      throw new Error(`unexpected URL ${url}`);
    },
  });
  assert.equal(paginationReport.cloudflare.routeInventory, 'unavailable');
  assert.ok(paginationReport.blockers.includes('account-wide production Worker route inventory could not be read'));
});

test('a malformed route list is blocked after every zone is discovered via GET-only route reads', async () => {
  const calls = [];
  const report = await runIdentityCrmProductionReadiness({
    env: completeEnvironment(),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const workerResponse = completeWorkerResponse(url);
      if (workerResponse) return workerResponse;
      if (url === zonesUrl) return cloudflareResponse([{ id: zoneId, account: { id: accountId } }]);
      if (url === domainsUrl) return cloudflareResponse([]);
      if (url === routesUrl) return cloudflareResponse({ routes: 'not-an-array' });
      throw new Error(`unexpected URL ${url}`);
    },
  });
  assert.equal(report.result, 'blocked');
  assert.equal(report.cloudflare.routeInventory, 'unavailable');
  assert.ok(report.blockers.includes('account-wide production Worker route inventory could not be read'));
  assertReadCalls(calls);
});

for (const responseKind of ['json-error', 'non-json-error']) {
  test(`account-wide zone inventory ${responseKind} remains blocked and sanitized`, async () => {
    const calls = [];
    const privateMarker = `synthetic-private-${responseKind}`;
    const report = await runIdentityCrmProductionReadiness({
      env: completeEnvironment(),
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        if (url !== zonesUrl) return cloudflareResponse([]);
        if (responseKind === 'non-json-error') return new Response(`${privateMarker} ${apiToken}`, { status: 502 });
        return new Response(JSON.stringify({
          success: false,
          errors: [{ code: 10000, message: `${privateMarker} ${apiToken}` }],
          result: { value: privateMarker },
        }), { status: 403 });
      },
    });
    assertReadCalls(calls, [...workerUrls, zonesUrl]);
    assert.equal(report.result, 'blocked');
    assert.equal(report.cloudflare.routeInventory, 'unavailable');
    assert.ok(report.blockers.includes('account-wide production Worker route inventory could not be read'));
    assert.deepEqual(report.cloudflare.routeReadback, { zonesInspected: 0, count: 0, patterns: [] });
    assert.doesNotMatch(JSON.stringify(report), new RegExp(`${privateMarker}|${apiToken}`));
  });
}

for (const configuredZone of ['', 'invalid-zone']) {
  test(`configured zone (${configuredZone || 'empty'}) cannot narrow the account-wide route inventory`, async () => {
    const calls = [];
    const report = await runIdentityCrmProductionReadiness({
      env: completeEnvironment({ CLOUDFLARE_ZONE_ID: configuredZone }),
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        if (url === zonesUrl) return cloudflareResponse([{ id: zoneId, account: { id: accountId } }]);
        if (url === routesUrl || url === domainsUrl) return cloudflareResponse([]);
        if (url.endsWith('/subdomain')) return cloudflareResponse({ enabled: false, previews_enabled: false });
        if (url.endsWith('/secrets')) return cloudflareResponse(requiredSecretInventory());
        return cloudflareResponse([]);
      },
    });
    assertReadCalls(calls, [...workerUrls, zonesUrl, domainsUrl, routesUrl]);
    assert.equal(report.result, 'blocked');
    assert.equal(report.cloudflare.routeInventory, 'available');
    assert.ok(!report.blockers.includes('account-wide production Worker route inventory could not be read'));
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
  assert.doesNotMatch(workflow, /CLOUDFLARE_ZONE_ID/);
  assert.doesNotMatch(workflow, /IDENTITY_CRM_DELIVERY_PRODUCTION_SIGNING_KEY:\s*[^$\n]/);
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
