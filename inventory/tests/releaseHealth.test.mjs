import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/worker.js';

test('Identity/Inventory health exposes immutable release and Worker version metadata', async () => {
  const releaseSha = 'a'.repeat(40);
  const response = await worker.fetch(new Request('https://api-staging.skincos.com.br/health'), {
    DB: {},
    APP_ORIGIN: 'https://crm-staging.skincos.com.br',
    APP_VERSION: releaseSha,
    ENVIRONMENT: 'staging',
    CF_VERSION_METADATA: {
      id: '11111111-1111-4111-8111-111111111111',
      tag: `ponto:identityWorkforce:${releaseSha}`,
    },
  }, {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.version, releaseSha);
  assert.equal(body.environment, 'staging');
  assert.deepEqual(body.workerVersion, {
    id: '11111111-1111-4111-8111-111111111111',
    tag: `ponto:identityWorkforce:${releaseSha}`,
  });
});

test('Identity/Inventory exposes a fail-closed read-only Workforce contract probe', async () => {
  const releaseSha = 'a'.repeat(40);
  const identityVersionId = '33333333-3333-4333-8333-333333333333';
  const timekeepingVersionId = '11111111-1111-4111-8111-111111111111';
  const response = await worker.fetch(new Request('https://api-staging.skincos.com.br/health/workforce-contract', {
    headers: { 'x-skincos-release-probe': 'ponto-v1' },
  }), {
    DB: {},
    APP_ORIGIN: 'https://crm-staging.skincos.com.br',
    APP_VERSION: releaseSha,
    ENVIRONMENT: 'staging',
    CF_VERSION_METADATA: { id: identityVersionId },
    TIMEKEEPING_VERSION_ID: timekeepingVersionId,
    IDENTITY_WORKFORCE_HMAC_KEY: 'synthetic-identity-workforce-key',
    WORKFORCE: {
      async fetch() {
        return new Response(JSON.stringify({
          ok: true,
          data: {
            contract: 'identity-workforce-hmac-v2',
            matched: true,
            releaseSha,
            environment: 'staging',
            timekeepingVersionId,
            identityReleaseSha: releaseSha,
            identityVersionId,
          },
        }), { headers: { 'content-type': 'application/json' } });
      },
    },
  }, {});

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.ready, true);
  assert.equal(body.workerVersionId, identityVersionId);
  assert.deepEqual(body.data, {
    contract: 'identity-workforce-hmac-v2',
    matched: true,
  });
  assert.equal('environment' in body, false);
  assert.equal('timekeepingVersionId' in body.data, false);
});

test('Identity/Inventory hides the contract probe and avoids Workforce calls without the release marker', async () => {
  let workforceCalls = 0;
  const response = await worker.fetch(new Request('https://api-staging.skincos.com.br/health/workforce-contract'), {
    DB: {},
    APP_ORIGIN: 'https://crm-staging.skincos.com.br',
    APP_VERSION: 'a'.repeat(40),
    ENVIRONMENT: 'staging',
    CF_VERSION_METADATA: { id: '33333333-3333-4333-8333-333333333333' },
    TIMEKEEPING_VERSION_ID: '11111111-1111-4111-8111-111111111111',
    IDENTITY_WORKFORCE_HMAC_KEY: 'synthetic-identity-workforce-key',
    WORKFORCE: {
      async fetch() {
        workforceCalls += 1;
        throw new Error('WORKFORCE_MUST_NOT_BE_CALLED');
      },
    },
  }, {});

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    ok: false,
    ready: false,
    code: 'NOT_FOUND',
  });
  assert.equal(workforceCalls, 0);
});
