import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';

import {
  IDENTITY_CRM_DELIVERY_KEY_REGISTRY_VERSION,
  acceptedIdentityCrmDeliveryVerificationKeys,
  assertIdentityCrmDeliveryKeyRegistry,
  createIdentityCrmDeliveryKeyRegistry,
} from '../delivery/crm-key-registry-v1.js';

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

async function publicJwk() {
  const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const exported = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
  return { kty: 'OKP', crv: 'Ed25519', x: exported.x, alg: 'EdDSA', use: 'sig' };
}

async function registryFixture() {
  const [active, overlap, revoked] = await Promise.all([publicJwk(), publicJwk(), publicJwk()]);
  return {
    active,
    overlap,
    revoked,
    input: {
      environment: 'production',
      active: { kid: 'crm-production-identity-2026-10', jwk: active },
      overlap: [{ kid: 'crm-production-identity-2026-09', jwk: overlap, notAfter: 1_800_000_000 }],
      revoked: ['crm-production-identity-2026-08'],
    },
  };
}

test('key registry publishes only the active and non-expired overlap verification keys', async () => {
  const fixture = await registryFixture();
  const registry = createIdentityCrmDeliveryKeyRegistry(fixture.input, { nowSeconds: 1_700_000_000 });

  assert.deepEqual(registry, {
    version: IDENTITY_CRM_DELIVERY_KEY_REGISTRY_VERSION,
    environment: 'production',
    active: { kid: 'crm-production-identity-2026-10', jwk: fixture.active },
    overlap: [{ kid: 'crm-production-identity-2026-09', jwk: fixture.overlap, notAfter: 1_800_000_000 }],
    revoked: ['crm-production-identity-2026-08'],
  });

  const accepted = acceptedIdentityCrmDeliveryVerificationKeys(registry, { nowSeconds: 1_700_000_000 });
  assert.deepEqual(accepted, [
    { ...fixture.active, kid: 'crm-production-identity-2026-10' },
    { ...fixture.overlap, kid: 'crm-production-identity-2026-09' },
  ]);
  assert.equal(JSON.stringify(accepted).includes('crm-production-identity-2026-08'), false);
  assert.equal(JSON.stringify(registry).includes('"d"'), false);
});

test('key registry fails closed for revocation collisions, expired overlap and private material', async () => {
  const fixture = await registryFixture();
  const options = { nowSeconds: 1_700_000_000 };

  assert.throws(
    () => createIdentityCrmDeliveryKeyRegistry({ ...fixture.input, revoked: [fixture.input.active.kid] }, options),
    /IDENTITY_CRM_ACTIVE_KEY_REVOKED/,
  );
  assert.throws(
    () => createIdentityCrmDeliveryKeyRegistry({
      ...fixture.input,
      overlap: [{ ...fixture.input.overlap[0], kid: fixture.input.revoked[0] }],
    }, options),
    /IDENTITY_CRM_KEY_REGISTRY_INVALID/,
  );
  assert.throws(
    () => createIdentityCrmDeliveryKeyRegistry({
      ...fixture.input,
      overlap: [{ ...fixture.input.overlap[0], notAfter: options.nowSeconds }],
    }, options),
    /IDENTITY_CRM_KEY_OVERLAP_EXPIRED/,
  );
  assert.throws(
    () => createIdentityCrmDeliveryKeyRegistry({
      ...fixture.input,
      active: { ...fixture.input.active, jwk: { ...fixture.active, d: 'must-never-be-public' } },
    }, options),
    /IDENTITY_CRM_KEY_REGISTRY_INVALID/,
  );

  let accessorRead = false;
  const accessorActive = { kid: fixture.input.active.kid, jwk: fixture.active };
  Object.defineProperty(accessorActive, 'jwk', {
    enumerable: true,
    get() {
      accessorRead = true;
      return fixture.active;
    },
  });
  assert.throws(
    () => createIdentityCrmDeliveryKeyRegistry({ ...fixture.input, active: accessorActive }, options),
    /IDENTITY_CRM_KEY_REGISTRY_INVALID/,
  );
  assert.equal(accessorRead, false);
});

test('key registry rejects cross-environment keys and stale acceptance', async () => {
  const fixture = await registryFixture();
  const options = { nowSeconds: 1_700_000_000 };

  assert.throws(
    () => createIdentityCrmDeliveryKeyRegistry({
      ...fixture.input,
      active: { ...fixture.input.active, kid: 'crm-staging-identity-2026-10' },
    }, options),
    /IDENTITY_CRM_KEY_REGISTRY_INVALID/,
  );

  assert.throws(
    () => createIdentityCrmDeliveryKeyRegistry({ ...fixture.input, unexpected: true }, options),
    /IDENTITY_CRM_KEY_REGISTRY_INVALID/,
  );

  const registry = createIdentityCrmDeliveryKeyRegistry(fixture.input, options);
  assert.throws(
    () => assertIdentityCrmDeliveryKeyRegistry({ ...registry, version: 'identity-crm-delivery/key-registry/v0' }, options),
    /IDENTITY_CRM_KEY_REGISTRY_INVALID/,
  );
  assert.throws(
    () => acceptedIdentityCrmDeliveryVerificationKeys(registry, { nowSeconds: fixture.input.overlap[0].notAfter }),
    /IDENTITY_CRM_KEY_OVERLAP_EXPIRED/,
  );
});
