import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import test from 'node:test';

import * as deliveryContract from '@jubenitogarcia/skincos-identity-contracts/identity-crm-delivery';
import { handleIdentityCrmIssuerStagingRequest } from '../delivery/crm-issuer-staging-worker.js';

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

const issueUrl = 'https://identity-crm-delivery-staging.example/internal/identity-crm-delivery/v1/issue';
const keysUrl = 'https://identity-crm-delivery-staging.example/.well-known/identity-crm-delivery/v1/keys';
const secret = 'synthetic-staging-request-hmac-secret-2026';

function encodeBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function authHeader(body) {
  const key = await webcrypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await webcrypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return encodeBase64Url(new Uint8Array(signature));
}

async function stagingEnv() {
  const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const privateJwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
  const publicJwk = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
  const publicKey = { kty: 'OKP', crv: 'Ed25519', x: publicJwk.x, alg: 'EdDSA', use: 'sig' };
  const privateKey = { kty: 'OKP', crv: 'Ed25519', x: privateJwk.x, d: privateJwk.d, alg: 'EdDSA', key_ops: ['sign'], ext: false };
  return {
    pair,
    env: {
      IDENTITY_CRM_DELIVERY_ENABLED: 'true',
      IDENTITY_CRM_DELIVERY_ENVIRONMENT: 'staging',
      IDENTITY_CRM_DELIVERY_KID: 'identity-staging-2026-09',
      IDENTITY_CRM_DELIVERY_PRIVATE_JWK: JSON.stringify(privateKey),
      IDENTITY_CRM_DELIVERY_PUBLIC_JWK: JSON.stringify(publicKey),
      IDENTITY_CRM_DELIVERY_REQUEST_HMAC: secret,
    },
    publicKey,
  };
}

function issuePayload() {
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
      bodyBase64: encodeBase64Url(new TextEncoder().encode('{"lead":"staging"}')),
    },
    jti: 'staging_nonce_0000001',
  };
}

test('staging issuer is disabled unless the explicit staging flag is enabled', async () => {
  const response = await handleIdentityCrmIssuerStagingRequest(
    new Request(issueUrl, { method: 'POST', body: '{}' }),
    { IDENTITY_CRM_DELIVERY_ENABLED: 'false', IDENTITY_CRM_DELIVERY_ENVIRONMENT: 'staging' },
  );
  assert.equal(response.status, 503);
  assert.match(await response.text(), /IDENTITY_CRM_DELIVERY_DISABLED/);
});

test('staging manifest has no production route or data binding and keeps signing disabled', async () => {
  const manifest = await readFile(new URL('../wrangler.staging.toml', import.meta.url), 'utf8');
  assert.match(manifest, /IDENTITY_CRM_DELIVERY_ENABLED\s*=\s*"false"/);
  assert.doesNotMatch(manifest, /^routes\s*=/m);
  assert.doesNotMatch(manifest, /^\[\[d1_databases\]\]/m);
  assert.doesNotMatch(manifest, /^\[\[kv_namespaces\]\]/m);
  assert.doesNotMatch(manifest, /^\[\[r2_buckets\]\]/m);
});

test('staging service surface publishes only the public key and signs an authenticated request', async () => {
  const { env, pair, publicKey } = await stagingEnv();
  const payload = JSON.stringify(issuePayload());
  const auth = await authHeader(payload);
  const response = await handleIdentityCrmIssuerStagingRequest(new Request(issueUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-skincos-identity-issuer-auth': auth },
    body: payload,
  }), env);

  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(result.version, 'identity-crm-delivery/v1');
  assert.equal(result.keyId, env.IDENTITY_CRM_DELIVERY_KID);
  assert.doesNotMatch(JSON.stringify(result), /private|email|username|cookie|session|"d"/i);

  const keysResponse = await handleIdentityCrmIssuerStagingRequest(new Request(keysUrl), env);
  assert.equal(keysResponse.status, 200);
  const keyDocument = await keysResponse.json();
  assert.deepEqual(keyDocument, {
    version: 'identity-crm-delivery/v1',
    keys: [{ ...publicKey, kid: env.IDENTITY_CRM_DELIVERY_KID }],
  });
  assert.equal(Object.hasOwn(keyDocument.keys[0], 'd'), false);

  const parsed = deliveryContract.parseIdentityCrmDeliveryCompact(result.compact);
  const importedPublic = await webcrypto.subtle.importKey('jwk', publicKey, { name: 'Ed25519' }, false, ['verify']);
  assert.equal(await webcrypto.subtle.verify(
    { name: 'Ed25519' },
    importedPublic,
    parsed.signature,
    new TextEncoder().encode(parsed.signingInput),
  ), true);

  const head = await handleIdentityCrmIssuerStagingRequest(new Request(keysUrl, { method: 'HEAD' }), env);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(pair.publicKey.type, 'public');
});

test('staging issue endpoint rejects unauthenticated callers and unknown routes', async () => {
  const { env } = await stagingEnv();
  const payload = JSON.stringify(issuePayload());
  const unauthenticated = await handleIdentityCrmIssuerStagingRequest(new Request(issueUrl, { method: 'POST', body: payload }), env);
  assert.equal(unauthenticated.status, 401);

  const wrongAuth = await handleIdentityCrmIssuerStagingRequest(new Request(issueUrl, {
    method: 'POST',
    headers: { 'x-skincos-identity-issuer-auth': encodeBase64Url(new Uint8Array(32)) },
    body: payload,
  }), env);
  assert.equal(wrongAuth.status, 401);

  const unknown = await handleIdentityCrmIssuerStagingRequest(new Request('https://identity-crm-delivery-staging.example/internal/other', { method: 'POST' }), env);
  assert.equal(unknown.status, 404);
});
