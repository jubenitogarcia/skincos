import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import test from 'node:test';

import * as deliveryContract from '@jubenitogarcia/skincos-identity-contracts/identity-crm-delivery';
import { handleIdentityCrmIssuerProductionRequest } from '../delivery/crm-issuer-production-worker.js';

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

const issueUrl = 'https://identity-crm-delivery-production.example/internal/identity-crm-delivery/v1/issue';
const keysUrl = 'https://identity-crm-delivery-production.example/.well-known/identity-crm-delivery/v1/keys';
const requestHmac = 'synthetic-production-request-hmac-secret-2026';
const activeKid = 'crm-production-identity-2026-09';
const overlapKid = 'crm-production-identity-2026-08';

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

async function productionEnv({ activeKeyId = activeKid, overlap = true, revoked = [], enabled = true, environment = 'production' } = {}) {
  const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const oldPair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const privateJwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
  const publicJwk = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
  const oldPublicJwk = await webcrypto.subtle.exportKey('jwk', oldPair.publicKey);
  const activePublic = { kty: 'OKP', crv: 'Ed25519', x: publicJwk.x, alg: 'EdDSA', use: 'sig' };
  const overlapPublic = { kty: 'OKP', crv: 'Ed25519', x: oldPublicJwk.x, alg: 'EdDSA', use: 'sig' };
  const privateKey = { kty: 'OKP', crv: 'Ed25519', x: privateJwk.x, d: privateJwk.d, alg: 'EdDSA', key_ops: ['sign'], ext: false };
  const now = Math.floor(Date.now() / 1000);
  const publicRing = {
    active: { kid: activeKeyId, jwk: activePublic },
    overlap: overlap ? [{ kid: overlapKid, jwk: overlapPublic, notAfter: now + 300 }].filter(({ kid }) => kid !== activeKeyId) : [],
    revoked,
  };
  return {
    pair,
    activePublic,
    overlapPublic,
    env: {
      IDENTITY_CRM_DELIVERY_ENABLED: enabled ? 'true' : 'false',
      IDENTITY_CRM_DELIVERY_ENVIRONMENT: environment,
      IDENTITY_CRM_DELIVERY_PRODUCTION_KID: activeKeyId,
      IDENTITY_CRM_DELIVERY_PRODUCTION_PRIVATE_JWK: JSON.stringify(privateKey),
      IDENTITY_CRM_DELIVERY_PRODUCTION_PUBLIC_JWK: JSON.stringify(publicRing),
      IDENTITY_CRM_DELIVERY_PRODUCTION_REQUEST_HMAC: requestHmac,
    },
    now,
  };
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
    headers: { 'content-type': 'application/json', 'x-skincos-identity-issuer-auth': await authHeader(body) },
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

test('production manifest is disabled, route-free and data-binding-free', async () => {
  const manifest = await readFile(new URL('../wrangler.production.toml', import.meta.url), 'utf8');
  assert.match(manifest, /^name\s*=\s*"skincos-identity-crm-delivery-production"/m);
  assert.match(manifest, /^main\s*=\s*"delivery\/crm-issuer-production-worker\.js"/m);
  assert.match(manifest, /IDENTITY_CRM_DELIVERY_ENABLED\s*=\s*"false"/);
  assert.match(manifest, /^workers_dev\s*=\s*false/m);
  assert.doesNotMatch(manifest, /^routes\s*=/m);
  assert.doesNotMatch(manifest, /^\[\[d1_databases\]\]/m);
  assert.doesNotMatch(manifest, /^\[\[kv_namespaces\]\]/m);
  assert.doesNotMatch(manifest, /^\[\[r2_buckets\]\]/m);
  assert.doesNotMatch(manifest, /^\[\[env\.production\.services\]\]/m);
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
