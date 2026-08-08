import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import test from 'node:test';
import { probeIdentityWorkforceContract, syncIdentityWorkforceOnboarding } from './workforce-onboarding.js';

const testHmacKey = randomBytes(32).toString('base64url');

test('Identity signs Workforce onboarding with the v2 nonce, method, path and body contract', async () => {
  const secret = testHmacKey;
  const releaseSha = 'a'.repeat(40);
  const identityVersionId = '33333333-3333-4333-8333-333333333333';
  const payload = { onboardingId: 'synthetic-onboarding', accountStatus: 'ACTIVE' };
  let captured;
  const env = {
    IDENTITY_WORKFORCE_HMAC_KEY: secret,
    APP_VERSION: releaseSha,
    CF_VERSION_METADATA: { id: identityVersionId },
    WORKFORCE: {
      async fetch(url, init) {
        captured = { url, init };
        return new Response(JSON.stringify({ ok: true, data: { idempotent: true } }), {
          headers: { 'content-type': 'application/json' },
        });
      },
    },
  };

  await syncIdentityWorkforceOnboarding(env, payload, 'synthetic-request');

  const bodyHash = createHash('sha256').update(captured.init.body).digest('hex');
  const timestamp = captured.init.headers['x-skincos-workforce-ts'];
  const nonce = captured.init.headers['x-skincos-workforce-nonce'];
  const signedPayload = `v2.${timestamp}.${nonce}.POST./api/ponto/internal/onboarding.${bodyHash}.${releaseSha}.${identityVersionId}`;
  const expected = createHmac('sha256', secret).update(signedPayload).digest('base64url');
  assert.equal(captured.url, 'https://workforce/api/ponto/internal/onboarding');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers['x-skincos-workforce-signature-version'], '2');
  assert.equal(captured.init.headers['x-skincos-identity-release-sha'], releaseSha);
  assert.equal(captured.init.headers['x-skincos-identity-version-id'], identityVersionId);
  assert.equal(captured.init.headers['x-skincos-workforce-sig'], expected);

  const changedNonce = createHmac('sha256', secret)
    .update(`v2.${timestamp}.different-nonce.POST./api/ponto/internal/onboarding.${bodyHash}.${releaseSha}.${identityVersionId}`)
    .digest('base64url');
  assert.notEqual(changedNonce, expected);
});

test('Identity preserves a stable Workforce dependency code over a generic transport error', async () => {
  const env = {
    IDENTITY_WORKFORCE_HMAC_KEY: testHmacKey,
    APP_VERSION: 'a'.repeat(40),
    CF_VERSION_METADATA: { id: '33333333-3333-4333-8333-333333333333' },
    WORKFORCE: {
      async fetch() {
        return new Response(JSON.stringify({ ok: false, error: 'NOT_READY', code: 'DATABASE_UNAVAILABLE' }), { status: 503 });
      },
    },
  };

  await assert.rejects(
    syncIdentityWorkforceOnboarding(env, { onboardingId: 'synthetic-dependency-code' }, 'synthetic-dependency-code-request'),
    (error) => error?.message === 'DATABASE_UNAVAILABLE' && error?.status === 503 && error?.upstreamError === 'NOT_READY',
  );
});

test('Identity uses a deliberate local-only version identity when Cloudflare metadata is unavailable', async () => {
  const releaseSha = 'a'.repeat(40);
  const localIdentityVersionId = '00000000-0000-4000-8000-000000000001';
  let captured;
  const env = {
    IDENTITY_WORKFORCE_HMAC_KEY: testHmacKey,
    APP_VERSION: releaseSha,
    ENVIRONMENT: 'local',
    LOCAL_IDENTITY_VERSION_ID: localIdentityVersionId,
    WORKFORCE: {
      async fetch(url, init) {
        captured = { url, init };
        return new Response(JSON.stringify({ ok: true, data: { idempotent: true } }), {
          headers: { 'content-type': 'application/json' },
        });
      },
    },
  };

  await syncIdentityWorkforceOnboarding(
    env,
    { onboardingId: 'synthetic-local-onboarding', accountStatus: 'ACTIVE' },
    'synthetic-local-request',
  );

  assert.equal(captured.url, 'https://workforce/api/ponto/internal/onboarding');
  assert.equal(captured.init.headers['x-skincos-identity-release-sha'], releaseSha);
  assert.equal(captured.init.headers['x-skincos-identity-version-id'], localIdentityVersionId);
});

test('Identity never accepts the local version identity in a hosted environment', async () => {
  await assert.rejects(
    syncIdentityWorkforceOnboarding({
      IDENTITY_WORKFORCE_HMAC_KEY: testHmacKey,
      APP_VERSION: 'a'.repeat(40),
      ENVIRONMENT: 'staging',
      LOCAL_IDENTITY_VERSION_ID: '00000000-0000-4000-8000-000000000001',
      WORKFORCE: {
        async fetch() {
          throw new Error('WORKFORCE_MUST_NOT_BE_CALLED');
        },
      },
    }, {
      onboardingId: 'synthetic-hosted-onboarding',
      accountStatus: 'ACTIVE',
    }, 'synthetic-hosted-request'),
    /IDENTITY_WORKFORCE_RELEASE_IDENTITY_UNAVAILABLE/,
  );
});

test('Identity contract probe pins the exact Timekeeping candidate and authenticates the read-only request', async () => {
  const secret = testHmacKey;
  const releaseSha = 'a'.repeat(40);
  const identityVersionId = '33333333-3333-4333-8333-333333333333';
  const timekeepingVersionId = '11111111-1111-4111-8111-111111111111';
  let captured;
  const env = {
    IDENTITY_WORKFORCE_HMAC_KEY: secret,
    APP_VERSION: releaseSha,
    ENVIRONMENT: 'staging',
    CF_VERSION_METADATA: { id: identityVersionId },
    TIMEKEEPING_VERSION_ID: timekeepingVersionId,
    WORKFORCE: {
      async fetch(url, init) {
        captured = { url, init };
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
  };

  const data = await probeIdentityWorkforceContract(env, 'synthetic-contract-probe');
  const path = '/api/ponto/internal/onboarding/contract-probe';
  const timestamp = captured.init.headers['x-skincos-workforce-ts'];
  const nonce = captured.init.headers['x-skincos-workforce-nonce'];
  const bodyHash = createHash('sha256').update('').digest('hex');
  const signedPayload = `v2.${timestamp}.${nonce}.GET.${path}.${bodyHash}.${releaseSha}.${identityVersionId}`;
  const expected = createHmac('sha256', secret).update(signedPayload).digest('base64url');

  assert.equal(captured.url, `https://workforce${path}`);
  assert.equal(captured.init.method, 'GET');
  assert.equal(captured.init.headers['cloudflare-workers-version-overrides'], `skincos-timekeeping-staging="${timekeepingVersionId}"`);
  assert.equal(captured.init.headers['x-skincos-workforce-sig'], expected);
  assert.equal(data.matched, true);
  assert.equal(data.timekeepingVersionId, timekeepingVersionId);
});
