import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import test from 'node:test';

import * as deliveryContract from '@jubenitogarcia/skincos-identity-contracts/identity-crm-delivery';
import { handleIdentityCrmIssuerProductionRequest } from '../delivery/crm-issuer-production-worker.js';

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

const issueUrl = 'https://identity-crm-delivery-production.example/internal/identity-crm-delivery/v1/issue';
const keysUrl = 'https://identity-crm-delivery-production.example/.well-known/identity-crm-delivery/v1/keys';
const routeReceiptUrl = 'https://identity-crm-delivery-production.example/internal/crm-production-route-receipt/v1/resolve';
const requestHmac = 'synthetic-production-request-hmac-secret-2026';
const activeKid = 'crm-production-identity-2026-09';
const overlapKid = 'crm-production-identity-2026-08';
const callerId = 'crm-api-production-v1';
const gatewayVersionId = '11111111-1111-4111-8111-111111111111';
const routeReceipt = JSON.stringify({
  contract: 'skincos-crm/production-route-receipt/v1',
  receiptId: 'crm-production-route-receipt-test-20260909',
  environment: 'production',
  gatewayVersionId,
  service: 'skincos-crm-core',
  workerVersionId: '22222222-2222-4222-8222-222222222222',
  identityWorkerVersionId: '33333333-3333-4333-8333-333333333333',
  release: 'a'.repeat(40),
  artifactDigest: `sha256:${'b'.repeat(64)}`,
  keyId: 'crm-production-route-receipt-test',
  signature: 'synthetic_externally_signed_route_receipt',
});

function encodeBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function authHeader(body) {
  const key = await webcrypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(requestHmac),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await webcrypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return encodeBase64Url(new Uint8Array(signature));
}

async function productionEnv({
  activeKeyId = activeKid,
  overlap = true,
  revoked = [],
  enabled = true,
  environment = 'production',
  issuerEnabled = true,
  routeReceiptResolverEnabled = false,
} = {}) {
  const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const oldPair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const privateJwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
  const signingKey = await webcrypto.subtle.importKey('jwk', privateJwk, { name: 'Ed25519' }, false, ['sign']);
  const publicJwk = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
  const oldPublicJwk = await webcrypto.subtle.exportKey('jwk', oldPair.publicKey);
  const activePublic = { kty: 'OKP', crv: 'Ed25519', x: publicJwk.x, alg: 'EdDSA', use: 'sig' };
  const overlapPublic = { kty: 'OKP', crv: 'Ed25519', x: oldPublicJwk.x, alg: 'EdDSA', use: 'sig' };
  const now = Math.floor(Date.now() / 1000);
  const publicRing = {
    active: { kid: activeKeyId, jwk: activePublic },
    overlap: overlap ? [{ kid: overlapKid, jwk: overlapPublic, notAfter: now + 300 }].filter(({ kid }) => kid !== activeKeyId) : [],
    revoked,
  };
  return {
    pair,
    signingKey,
    activePublic,
    overlapPublic,
    env: {
      IDENTITY_CRM_DELIVERY_ENABLED: enabled ? 'true' : 'false',
      IDENTITY_CRM_DELIVERY_ENVIRONMENT: environment,
      IDENTITY_CRM_DELIVERY_PRODUCTION_KID: activeKeyId,
      IDENTITY_CRM_DELIVERY_PRODUCTION_SIGNING_KEY: signingKey,
      IDENTITY_CRM_DELIVERY_PRODUCTION_PUBLIC_JWK: JSON.stringify(publicRing),
      IDENTITY_CRM_DELIVERY_PRODUCTION_CALLER_HMAC: requestHmac,
      IDENTITY_CRM_DELIVERY_PRODUCTION_CALLER_ENABLED: 'true',
      IDENTITY_CRM_DELIVERY_PRODUCTION_CALLER_ID: callerId,
      IDENTITY_CRM_DELIVERY_PRODUCTION_ISSUER_ENABLED: issuerEnabled ? 'true' : 'false',
      IDENTITY_CRM_DELIVERY_PRODUCTION_ROUTE_RECEIPT_RESOLVER_ENABLED: routeReceiptResolverEnabled ? 'true' : 'false',
      IDENTITY_CRM_CORE_PRODUCTION_ROUTE_RECEIPT: routeReceipt,
    },
    now,
  };
}

async function routeReceiptRequest(env, value = gatewayVersionId, headers = {}) {
  const body = JSON.stringify({ gatewayVersionId: value });
  return handleIdentityCrmIssuerProductionRequest(new Request(routeReceiptUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-skincos-identity-issuer-caller': callerId,
      'x-skincos-identity-issuer-auth': await authHeader(body),
      ...headers,
    },
    body,
  }), env);
}

function issuePayload(jti = 'production_nonce_000001') {
  return {
    identity: {
      identitySubject: 'idn:fixture_identity_actor_0001',
      role: 'GESTOR',
      scopes: {
        units: ['novo-hamburgo'],
        modules: ['clients'],
        permissions: ['clients:read'],
      },
    },
    request: {
      method: 'POST',
      target: '/api/crm/leads',
      bodyBase64: encodeBase64Url(new TextEncoder().encode('{"lead":"production"}')),
    },
    jti,
  };
}

async function signedRequest(env, payload = issuePayload()) {
  const body = JSON.stringify(payload);
  return handleIdentityCrmIssuerProductionRequest(new Request(issueUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-skincos-identity-issuer-caller': callerId,
      'x-skincos-identity-issuer-auth': await authHeader(body),
    },
    body,
  }), env);
}

test('production Worker is disabled unless both production flag and environment match', async () => {
  const disabled = await handleIdentityCrmIssuerProductionRequest(
    new Request(issueUrl, { method: 'POST', body: '{}' }),
    { IDENTITY_CRM_DELIVERY_ENABLED: 'false', IDENTITY_CRM_DELIVERY_ENVIRONMENT: 'production' },
  );
  assert.equal(disabled.status, 503);
  assert.match(await disabled.text(), /IDENTITY_CRM_DELIVERY_DISABLED/);

  const wrongEnvironment = await handleIdentityCrmIssuerProductionRequest(
    new Request(issueUrl, { method: 'POST', body: '{}' }),
    { IDENTITY_CRM_DELIVERY_ENABLED: 'true', IDENTITY_CRM_DELIVERY_ENVIRONMENT: 'staging' },
  );
  assert.equal(wrongEnvironment.status, 503);
  assert.match(await wrongEnvironment.text(), /IDENTITY_CRM_DELIVERY_DISABLED/);
});

test('production Worker rejects non-production key ids and malformed custody', async () => {
  const { env } = await productionEnv({ activeKeyId: 'crm-staging-identity-2026-09' });
  const response = await handleIdentityCrmIssuerProductionRequest(new Request(keysUrl), env);
  assert.equal(response.status, 503);
  assert.match(await response.text(), /IDENTITY_PRODUCTION_CUSTODY_UNAVAILABLE/);
});

test('production Worker requires a non-extractable signing-key binding that matches its active public key', async () => {
  const missing = await productionEnv();
  delete missing.env.IDENTITY_CRM_DELIVERY_PRODUCTION_SIGNING_KEY;
  const missingResponse = await handleIdentityCrmIssuerProductionRequest(new Request(keysUrl), missing.env);
  assert.equal(missingResponse.status, 503);
  assert.match(await missingResponse.text(), /IDENTITY_PRODUCTION_CUSTODY_UNAVAILABLE/);

  const extractable = await productionEnv();
  extractable.env.IDENTITY_CRM_DELIVERY_PRODUCTION_SIGNING_KEY = extractable.pair.privateKey;
  const extractableResponse = await handleIdentityCrmIssuerProductionRequest(new Request(keysUrl), extractable.env);
  assert.equal(extractableResponse.status, 503);
  assert.match(await extractableResponse.text(), /IDENTITY_PRODUCTION_CUSTODY_UNAVAILABLE/);

  const mismatch = await productionEnv();
  const different = await productionEnv();
  mismatch.env.IDENTITY_CRM_DELIVERY_PRODUCTION_SIGNING_KEY = different.signingKey;
  const mismatchResponse = await handleIdentityCrmIssuerProductionRequest(new Request(keysUrl), mismatch.env);
  assert.equal(mismatchResponse.status, 503);
  assert.match(await mismatchResponse.text(), /IDENTITY_PRODUCTION_CUSTODY_UNAVAILABLE/);
});

test('production Worker requires the configured private caller and never falls back to a generic HMAC', async () => {
  const { env } = await productionEnv();
  const body = JSON.stringify(issuePayload('production_nonce_caller_01'));
  const missingCaller = await handleIdentityCrmIssuerProductionRequest(new Request(issueUrl, {
    method: 'POST',
    headers: { 'x-skincos-identity-issuer-auth': await authHeader(body) },
    body,
  }), env);
  assert.equal(missingCaller.status, 401);

  const wrongCaller = await handleIdentityCrmIssuerProductionRequest(new Request(issueUrl, {
    method: 'POST',
    headers: {
      'x-skincos-identity-issuer-caller': 'crm-api-staging-v1',
      'x-skincos-identity-issuer-auth': await authHeader(body),
    },
    body,
  }), env);
  assert.equal(wrongCaller.status, 401);

  const callerDisabled = { ...env, IDENTITY_CRM_DELIVERY_PRODUCTION_CALLER_ENABLED: 'false' };
  const callerDisabledResponse = await handleIdentityCrmIssuerProductionRequest(new Request(keysUrl), callerDisabled);
  assert.equal(callerDisabledResponse.status, 503);
  assert.match(await callerDisabledResponse.text(), /IDENTITY_PRODUCTION_CUSTODY_UNAVAILABLE/);
});

test('production route-receipt resolver returns only the external receipt for its exact private caller without loading a delivery signer', async () => {
  const { env } = await productionEnv({ issuerEnabled: false, routeReceiptResolverEnabled: true });
  // The resolver is not a signing path. It stays available to deliver the
  // external receipt even when the delivery signing key is absent; API still
  // verifies the separate Ed25519 signature before it accepts the route.
  delete env.IDENTITY_CRM_DELIVERY_PRODUCTION_SIGNING_KEY;
  const issueResponse = await signedRequest(env);
  assert.equal(issueResponse.status, 404);
  const response = await routeReceiptRequest(env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    version: 'crm-production-route-receipt/v1',
    receipt: routeReceipt,
  });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('production route-receipt resolver rejects browser-shaped, wrong-version and malformed-custody requests without disclosing the receipt', async () => {
  const { env } = await productionEnv({ issuerEnabled: false, routeReceiptResolverEnabled: true });
  const body = JSON.stringify({ gatewayVersionId });
  const anonymous = await handleIdentityCrmIssuerProductionRequest(new Request(routeReceiptUrl, {
    method: 'POST',
    headers: {
      cookie: 'browser-session-must-not-authorize',
      authorization: 'Bearer browser-must-not-authorize',
    },
    body,
  }), env);
  assert.equal(anonymous.status, 401);
  assert.doesNotMatch(await anonymous.text(), /crm-production-route-receipt-test-20260909/);

  const mismatched = await routeReceiptRequest(env, '44444444-4444-4444-8444-444444444444');
  assert.equal(mismatched.status, 404);
  assert.doesNotMatch(await mismatched.text(), /crm-production-route-receipt-test-20260909/);

  const malformed = { ...env, IDENTITY_CRM_CORE_PRODUCTION_ROUTE_RECEIPT: '{"not":"a receipt"}' };
  const malformedResponse = await routeReceiptRequest(malformed);
  assert.equal(malformedResponse.status, 503);
  assert.doesNotMatch(await malformedResponse.text(), /crm-production-route-receipt-test-20260909/);

  const get = await handleIdentityCrmIssuerProductionRequest(new Request(routeReceiptUrl), env);
  assert.equal(get.status, 404);
});

test('production envelope issuer cannot resolve a route receipt, even if the resolver secret is mistakenly present', async () => {
  const { env } = await productionEnv({ issuerEnabled: true, routeReceiptResolverEnabled: false });
  const resolverResponse = await routeReceiptRequest(env);
  assert.equal(resolverResponse.status, 404);
  assert.doesNotMatch(await resolverResponse.text(), /crm-production-route-receipt-test-20260909/);

  const issueResponse = await signedRequest(env, issuePayload('production_nonce_issuer_only_01'));
  assert.equal(issueResponse.status, 200);
});

test('production refuses a dual-capability role configuration before signing or resolving', async () => {
  const { env } = await productionEnv({ issuerEnabled: true, routeReceiptResolverEnabled: true });
  const resolverResponse = await routeReceiptRequest(env);
  assert.equal(resolverResponse.status, 404);
  assert.doesNotMatch(await resolverResponse.text(), /crm-production-route-receipt-test-20260909/);

  const issueResponse = await signedRequest(env, issuePayload('production_nonce_dual_role_01'));
  assert.equal(issueResponse.status, 404);

  const keysResponse = await handleIdentityCrmIssuerProductionRequest(new Request(keysUrl), env);
  assert.equal(keysResponse.status, 404);
});

test('production manifest is disabled, route-free and data-binding-free', async () => {
  const manifest = await readFile(new URL('../wrangler.production.toml', import.meta.url), 'utf8');
  const worker = await readFile(new URL('../delivery/crm-issuer-production-worker.js', import.meta.url), 'utf8');
  assert.match(manifest, /^name\s*=\s*"skincos-identity-crm-delivery-production"/m);
  assert.match(manifest, /^main\s*=\s*"delivery\/crm-issuer-production-worker\.js"/m);
  assert.match(manifest, /IDENTITY_CRM_DELIVERY_ENABLED\s*=\s*"false"/);
  assert.match(manifest, /IDENTITY_CRM_DELIVERY_PRODUCTION_ISSUER_ENABLED\s*=\s*"false"/);
  assert.match(manifest, /IDENTITY_CRM_DELIVERY_PRODUCTION_ROUTE_RECEIPT_RESOLVER_ENABLED\s*=\s*"false"/);
  assert.match(manifest, /^workers_dev\s*=\s*false/m);
  assert.doesNotMatch(manifest, /^routes\s*=/m);
  assert.doesNotMatch(manifest, /^\[\[d1_databases\]\]/m);
  assert.doesNotMatch(manifest, /^\[\[kv_namespaces\]\]/m);
  assert.doesNotMatch(manifest, /^\[\[r2_buckets\]\]/m);
  assert.doesNotMatch(manifest, /^\[\[env\.production\.services\]\]/m);
  assert.match(worker, /IDENTITY_CRM_DELIVERY_PRODUCTION_SIGNING_KEY/);
  assert.match(manifest, /IDENTITY_CRM_CORE_PRODUCTION_ROUTE_RECEIPT/);
  assert.match(worker, /IDENTITY_CRM_CORE_PRODUCTION_ROUTE_RECEIPT/);
  assert.match(worker, /IDENTITY_CRM_DELIVERY_PRODUCTION_ISSUER_ENABLED/);
  assert.match(worker, /IDENTITY_CRM_DELIVERY_PRODUCTION_ROUTE_RECEIPT_RESOLVER_ENABLED/);
  assert.doesNotMatch(worker, /IDENTITY_CRM_DELIVERY_PRODUCTION_PRIVATE_JWK|IDENTITY_CRM_DELIVERY_PRODUCTION_REQUEST_HMAC/);
});

test('production Worker signs Ed25519 delivery and publishes active plus overlap keys without private material', async () => {
  const { env, pair, activePublic, overlapPublic } = await productionEnv();
  const response = await signedRequest(env);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(result.version, 'identity-crm-delivery/v1');
  assert.equal(result.keyId, activeKid);
  assert.doesNotMatch(JSON.stringify(result), /private|email|username|cookie|session|"d"/i);

  const parsed = deliveryContract.parseIdentityCrmDeliveryCompact(result.compact);
  assert.equal(parsed.claims.iss, 'skincos-identity');
  assert.equal(parsed.claims.aud, 'skincos-crm-core');
  assert.equal(parsed.claims.sub, 'idn:fixture_identity_actor_0001');
  assert.equal(parsed.claims.jti, 'production_nonce_000001');
  const importedPublic = await webcrypto.subtle.importKey('jwk', activePublic, { name: 'Ed25519' }, false, ['verify']);
  assert.equal(await webcrypto.subtle.verify(
    { name: 'Ed25519' },
    importedPublic,
    parsed.signature,
    new TextEncoder().encode(parsed.signingInput),
  ), true);

  const keysResponse = await handleIdentityCrmIssuerProductionRequest(new Request(keysUrl), env);
  assert.equal(keysResponse.status, 200);
  const keyDocument = await keysResponse.json();
  assert.deepEqual(keyDocument, {
    version: 'identity-crm-delivery/v1',
    keys: [
      { ...activePublic, kid: activeKid },
      { ...overlapPublic, kid: overlapKid },
    ],
  });
  assert.equal(Object.hasOwn(keyDocument.keys[0], 'd'), false);

  const head = await handleIdentityCrmIssuerProductionRequest(new Request(keysUrl, { method: 'HEAD' }), env);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');

  // The compact envelope stays valid only inside the contract's 60-second
  // lifetime. CRM must perform this check before its replay reservation.
  assert.throws(
    () => deliveryContract.parseIdentityCrmDeliveryCompact(result.compact, { nowSeconds: parsed.claims.exp + 1 }),
    /expired/i,
  );
});

test('production key ring fails closed for active revocation, duplicate overlap and expired overlap', async () => {
  const revokedActive = await productionEnv({ revoked: [activeKid] });
  const revokedResponse = await handleIdentityCrmIssuerProductionRequest(new Request(keysUrl), revokedActive.env);
  assert.equal(revokedResponse.status, 503);

  const duplicateRevoked = await productionEnv({ revoked: ['crm-production-revoked-2026'] });
  const duplicateRevokedRing = JSON.parse(duplicateRevoked.env.IDENTITY_CRM_DELIVERY_PRODUCTION_PUBLIC_JWK);
  duplicateRevokedRing.revoked.push('crm-production-revoked-2026');
  duplicateRevoked.env.IDENTITY_CRM_DELIVERY_PRODUCTION_PUBLIC_JWK = JSON.stringify(duplicateRevokedRing);
  const duplicateRevokedResponse = await handleIdentityCrmIssuerProductionRequest(new Request(keysUrl), duplicateRevoked.env);
  assert.equal(duplicateRevokedResponse.status, 503);

  const duplicate = await productionEnv();
  const duplicateRing = JSON.parse(duplicate.env.IDENTITY_CRM_DELIVERY_PRODUCTION_PUBLIC_JWK);
  duplicateRing.overlap.push({ ...duplicateRing.overlap[0], kid: activeKid });
  duplicate.env.IDENTITY_CRM_DELIVERY_PRODUCTION_PUBLIC_JWK = JSON.stringify(duplicateRing);
  const duplicateResponse = await handleIdentityCrmIssuerProductionRequest(new Request(keysUrl), duplicate.env);
  assert.equal(duplicateResponse.status, 503);

  const expired = await productionEnv();
  const expiredRing = JSON.parse(expired.env.IDENTITY_CRM_DELIVERY_PRODUCTION_PUBLIC_JWK);
  expiredRing.overlap[0].notAfter = expired.now;
  expired.env.IDENTITY_CRM_DELIVERY_PRODUCTION_PUBLIC_JWK = JSON.stringify(expiredRing);
  const expiredResponse = await handleIdentityCrmIssuerProductionRequest(new Request(keysUrl), expired.env);
  assert.equal(expiredResponse.status, 503);
});

test('production issue surface requires HMAC caller proof, canonical JTI and forwards replay identity', async () => {
  const { env } = await productionEnv();
  const payload = issuePayload('production_nonce_replay_01');
  const body = JSON.stringify(payload);
  const unauthenticated = await handleIdentityCrmIssuerProductionRequest(new Request(issueUrl, { method: 'POST', body }), env);
  assert.equal(unauthenticated.status, 401);

  const wrongAuth = await handleIdentityCrmIssuerProductionRequest(new Request(issueUrl, {
    method: 'POST',
    headers: { 'x-skincos-identity-issuer-auth': encodeBase64Url(new Uint8Array(32)) },
    body,
  }), env);
  assert.equal(wrongAuth.status, 401);

  const first = await signedRequest(env, payload);
  const second = await signedRequest(env, payload);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const firstCompact = (await first.json()).compact;
  const secondCompact = (await second.json()).compact;
  assert.equal(deliveryContract.parseIdentityCrmDeliveryCompact(firstCompact).claims.jti, payload.jti);
  assert.equal(deliveryContract.parseIdentityCrmDeliveryCompact(secondCompact).claims.jti, payload.jti);

  const invalidJti = await signedRequest(env, { ...payload, jti: 'short' });
  assert.equal(invalidJti.status, 400);
  assert.match(await invalidJti.text(), /IDENTITY_JTI_INVALID/);

  const unknown = await handleIdentityCrmIssuerProductionRequest(new Request('https://identity-crm-delivery-production.example/internal/other', { method: 'POST' }), env);
  assert.equal(unknown.status, 404);
});
