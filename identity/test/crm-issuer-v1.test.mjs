import assert from 'node:assert/strict';
import test from 'node:test';

import * as identityDeliveryContract from '@jubenitogarcia/skincos-identity-contracts/identity-crm-delivery';
import {
  IDENTITY_CRM_DELIVERY_AUDIENCE,
  IDENTITY_CRM_DELIVERY_ISSUER,
  IDENTITY_CRM_DELIVERY_TYPE,
  IDENTITY_CRM_DELIVERY_VERSION,
  createCrmIdentityDeliveryIssuer,
  createCrmIdentityDeliveryKeyRing,
  createCrmIdentityEd25519Signer,
  projectCrmIdentityActor,
} from '../delivery/crm-issuer-v1.js';

const nowSeconds = 1_788_292_800;
const baseInput = Object.freeze({
  identity: Object.freeze({
    identitySubject: 'idn:fixture_identity_actor_0001',
    role: 'GESTOR',
    scopes: Object.freeze({
      units: Object.freeze(['novo-hamburgo']),
      modules: Object.freeze(['clients', 'finance']),
      permissions: Object.freeze(['clients:read', 'finance:read']),
    }),
  }),
  request: Object.freeze({
    method: 'POST',
    target: '/api/crm/leads?unit=novo-hamburgo',
    body: 'fixture-body',
  }),
});

async function keyPair(extractable = false) {
  return crypto.subtle.generateKey({ name: 'Ed25519' }, extractable, ['sign', 'verify']);
}

async function keyRecord(kid, privateKey) {
  return { kid, sign: createCrmIdentityEd25519Signer(privateKey) };
}

test('issuer is fail-closed and disabled without requiring contracts, keys or secrets', async () => {
  const issuer = createCrmIdentityDeliveryIssuer();
  assert.deepEqual(issuer.status(), {
    enabled: false,
    issuer: IDENTITY_CRM_DELIVERY_ISSUER,
    audience: IDENTITY_CRM_DELIVERY_AUDIENCE,
  });
  await assert.rejects(() => issuer.issue(baseInput), /IDENTITY_CRM_DELIVERY_DISABLED/);
});

test('issuer projects only an opaque actor and emits a compact EdDSA envelope', async () => {
  const pair = await keyPair();
  const keyRing = createCrmIdentityDeliveryKeyRing({ active: await keyRecord('identity-test-2026-09', pair.privateKey) });
  const issuer = createCrmIdentityDeliveryIssuer({
    enabled: true,
    keyRing,
    nowSeconds,
    jtiFactory: () => 'fixture_nonce_00000001',
  });

  assert.deepEqual(projectCrmIdentityActor({ ...baseInput.identity, username: 'pilot', email: 'pilot@example.test' }), baseInput.identity);
  const result = await issuer.issue(baseInput);
  const segments = result.compact.split('.');
  assert.equal(segments.length, 3);
  assert.equal(result.keyId, 'identity-test-2026-09');
  assert.deepEqual(result.protectedHeader, {
    alg: 'EdDSA',
    kid: 'identity-test-2026-09',
    typ: IDENTITY_CRM_DELIVERY_TYPE,
  });
  assert.equal(result.claims.iss, IDENTITY_CRM_DELIVERY_ISSUER);
  assert.equal(result.claims.aud, IDENTITY_CRM_DELIVERY_AUDIENCE);
  assert.equal(result.claims.sub, baseInput.identity.identitySubject);
  assert.equal(result.claims.iat, nowSeconds);
  assert.equal(result.claims.exp, nowSeconds + 60);
  assert.equal(result.claims.bdh, 'c7183c384504fd060c8a5d4b1b6545b830716de8bffbdc2989923a2244f6697d');
  assert.doesNotMatch(result.compact, /pilot@example|username|displayName|cookie|session/i);

  const padding = '='.repeat((4 - (segments[2].length % 4)) % 4);
  const signature = Uint8Array.from(atob(segments[2].replace(/-/g, '+').replace(/_/g, '/') + padding), (char) => char.charCodeAt(0));
  const verified = await crypto.subtle.verify(
    { name: 'Ed25519' },
    pair.publicKey,
    signature,
    new TextEncoder().encode(`${segments[0]}.${segments[1]}`),
  );
  assert.equal(verified, true);
});

test('issuer binds the actual method, target and body bytes before signing', async () => {
  const pair = await keyPair();
  const keyRing = createCrmIdentityDeliveryKeyRing({ active: await keyRecord('identity-test-request', pair.privateKey) });
  const issuer = createCrmIdentityDeliveryIssuer({
    enabled: true,
    keyRing,
    nowSeconds,
    jtiFactory: () => 'fixture_nonce_request_0001',
  });

  const result = await issuer.issue({
    ...baseInput,
    request: { method: ' post ', target: '/api/crm/leads', body: new Uint8Array([1, 2, 3]) },
  });
  assert.equal(result.claims.htm, 'POST');
  assert.equal(result.claims.htu, '/api/crm/leads');
  assert.equal(result.claims.bdh, '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81');

  await assert.rejects(() => issuer.issue({
    ...baseInput,
    requestBinding: { method: 'POST', target: '/api/crm/leads', bodyDigest: 'a'.repeat(64) },
  }), /IDENTITY_CRM_ISSUER_INPUT_INVALID/);
  await assert.rejects(() => issuer.issue({
    ...baseInput,
    request: { method: 'TRACE', target: '/api/crm/leads', body: '' },
  }), /IDENTITY_REQUEST_METHOD_INVALID/);
  await assert.rejects(() => issuer.issue({
    ...baseInput,
    request: { method: 'POST', target: 'https://crm.example.test/api/crm/leads', body: '' },
  }), /CRM_TARGET_INVALID/);
  await assert.rejects(() => issuer.issue({
    ...baseInput,
    request: { method: 'POST', target: '/api/crm/leads', body: { hidden: true } },
  }), /IDENTITY_REQUEST_BODY_INVALID/);
});

test('issuer enforces clock skew, TTL and opaque identity subject before signing', async () => {
  const pair = await keyPair();
  const keyRing = createCrmIdentityDeliveryKeyRing({ active: await keyRecord('identity-test-2026-09', pair.privateKey) });
  const issuer = createCrmIdentityDeliveryIssuer({
    enabled: true,
    keyRing,
    nowSeconds,
    clockSkewSeconds: 5,
    jtiFactory: () => 'fixture_nonce_00000002',
  });

  await assert.rejects(() => issuer.issue({ ...baseInput, issuedAt: nowSeconds + 6 }), /IDENTITY_ISSUED_AT_IN_FUTURE/);
  await assert.rejects(() => issuer.issue({ ...baseInput, issuedAt: nowSeconds - 6, ttlSeconds: 1 }), /IDENTITY_DELIVERY_EXPIRED/);
  await assert.rejects(() => issuer.issue({ ...baseInput, identity: { ...baseInput.identity, identitySubject: 'pilot' } }), /IDENTITY_SUBJECT_REQUIRED/);
  await assert.rejects(() => issuer.issue({ ...baseInput, ttlSeconds: 61 }), /IDENTITY_TTL_INVALID/);
});

test('key ring rotates active kid and refuses active, unknown, revoked and exportable keys', async () => {
  const first = await keyPair();
  const second = await keyPair();
  const third = await keyPair();
  const keyRing = createCrmIdentityDeliveryKeyRing({ active: await keyRecord('identity-key-a', first.privateKey) });
  const issuer = (jti) => createCrmIdentityDeliveryIssuer({
    enabled: true,
    keyRing,
    nowSeconds,
    jtiFactory: () => jti,
  });

  assert.equal((await issuer('fixture_nonce_key_a').issue(baseInput)).keyId, 'identity-key-a');
  assert.equal(keyRing.rotate(await keyRecord('identity-key-b', second.privateKey)).kid, 'identity-key-b');
  assert.equal((await issuer('fixture_nonce_key_b').issue(baseInput)).keyId, 'identity-key-b');
  assert.equal(keyRing.list().find((key) => key.kid === 'identity-key-a').status, 'overlap');
  assert.throws(() => keyRing.revoke('identity-key-b'), /IDENTITY_KEY_ACTIVE_REQUIRES_ROTATION/);
  assert.equal(keyRing.rotate(await keyRecord('identity-key-c', third.privateKey)).kid, 'identity-key-c');
  assert.equal(keyRing.revoke('identity-key-b').status, 'revoked');
  assert.equal((await issuer('fixture_nonce_key_c').issue(baseInput)).keyId, 'identity-key-c');
  assert.throws(() => keyRing.revoke('identity-key-unknown'), /IDENTITY_KEY_UNKNOWN/);

  const extractable = await keyPair(true);
  assert.throws(() => createCrmIdentityEd25519Signer(extractable.privateKey), /IDENTITY_ED25519_PRIVATE_KEY_INVALID/);
  assert.throws(() => createCrmIdentityDeliveryKeyRing({ active: { kid: 'identity-key-a', privateKey: 'never', sign() {} } }), /IDENTITY_KEY_RECORD_INVALID/);
});

test('issuer requires an atomic replay reservation when a replay adapter is supplied', async () => {
  const pair = await keyPair();
  const keyRing = createCrmIdentityDeliveryKeyRing({ active: await keyRecord('identity-test-2026-09', pair.privateKey) });
  const calls = [];
  const issuer = createCrmIdentityDeliveryIssuer({
    enabled: true,
    keyRing,
    nowSeconds,
    jtiFactory: () => 'fixture_nonce_replay_0001',
    replay: { reserve: async (receipt) => { calls.push(receipt); return 'reserved'; } },
  });

  await issuer.issue(baseInput);
  assert.deepEqual(calls, [{
    jti: 'fixture_nonce_replay_0001',
    issuer: IDENTITY_CRM_DELIVERY_ISSUER,
    audience: IDENTITY_CRM_DELIVERY_AUDIENCE,
    expiresAt: new Date((nowSeconds + 60) * 1000).toISOString(),
  }]);

  const replayed = createCrmIdentityDeliveryIssuer({
    enabled: true,
    keyRing,
    nowSeconds,
    jtiFactory: () => 'fixture_nonce_replay_0002',
    replay: { reserve: async () => 'replayed' },
  });
  await assert.rejects(() => replayed.issue(baseInput), /IDENTITY_JTI_REPLAY/);
});

test('issuer refuses a contract adapter that is not the pinned identity-crm-delivery contract', () => {
  return keyPair().then(async (pair) => {
    const keyRing = createCrmIdentityDeliveryKeyRing({ active: await keyRecord('identity-test-2026-09', pair.privateKey) });
    assert.throws(() => createCrmIdentityDeliveryIssuer({
      enabled: true,
      contracts: { ...identityDeliveryContract, IDENTITY_CRM_DELIVERY_AUDIENCE: 'wrong-audience' },
      keyRing,
      nowSeconds,
    }), /IDENTITY_CRM_CONTRACT_MISMATCH/);
  });
});

test('issuer output round-trips through the pinned published contract when installed', async (t) => {
  let contracts;
  try {
    contracts = await import('@jubenitogarcia/skincos-identity-contracts/identity-crm-delivery');
  } catch {
    t.skip('private contract package is installed by the dedicated CI workflow');
    return;
  }

  const pair = await keyPair();
  const keyRing = createCrmIdentityDeliveryKeyRing({ active: await keyRecord('identity-published-2026', pair.privateKey) });
  const issuer = createCrmIdentityDeliveryIssuer({
    enabled: true,
    contracts,
    keyRing,
    nowSeconds,
    jtiFactory: () => 'fixture_nonce_published_01',
  });
  const result = await issuer.issue(baseInput);
  const parsed = contracts.parseIdentityCrmDeliveryCompact(result.compact, { nowSeconds });
  assert.equal(parsed.claims.iss, IDENTITY_CRM_DELIVERY_ISSUER);
  assert.equal(parsed.claims.aud, IDENTITY_CRM_DELIVERY_AUDIENCE);
  assert.equal(await crypto.subtle.verify(
    { name: 'Ed25519' },
    pair.publicKey,
    parsed.signature,
    new TextEncoder().encode(parsed.signingInput),
  ), true);
});
