import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { toAuthenticatedActor } from '../../shared/identity-contract/index.js';
import {
  IDENTITY_CRM_DELIVERY_AUDIENCE,
  IDENTITY_CRM_DELIVERY_ISSUER,
  IDENTITY_CRM_DELIVERY_VERSION,
  prepareCrmIdentityDeliveryV1,
} from '../delivery/crm-envelope-v1.js';

const baseInput = Object.freeze({
  enabled: true,
  identity: Object.freeze({
    identitySubject: 'idn:fixture_identity_actor_0001',
    role: 'GESTOR',
    scopes: Object.freeze({
      units: Object.freeze(['novo-hamburgo']),
      modules: Object.freeze(['clients', 'finance']),
      permissions: Object.freeze(['module.clients.access', 'module.finance.access']),
    }),
  }),
  requestBinding: Object.freeze({
    method: 'POST',
    target: '/api/crm/leads?unit=novo-hamburgo',
    bodyDigest: 'a'.repeat(64),
  }),
  issuedAt: 1788292800,
  ttlSeconds: 60,
  jti: 'fixture_nonce_00000001',
  keyId: 'identity-test-2026-09',
});

function input(overrides = {}) {
  return { ...baseInput, ...overrides };
}

test('the private CRM delivery preparation is disabled unless a caller explicitly opts in', () => {
  assert.throws(() => prepareCrmIdentityDeliveryV1(input({ enabled: false })), /IDENTITY_CRM_DELIVERY_DISABLED/);
  assert.throws(() => prepareCrmIdentityDeliveryV1({}), /IDENTITY_CRM_DELIVERY_DISABLED/);
});

test('the preparation returns only the minimized Identity CRM delivery input', () => {
  const prepared = prepareCrmIdentityDeliveryV1(input());

  assert.deepEqual(prepared.protectedHeader, {
    alg: 'EdDSA',
    kid: 'identity-test-2026-09',
    typ: 'skincos-identity-delivery+jws',
  });
  assert.deepEqual(prepared.claims, {
    version: IDENTITY_CRM_DELIVERY_VERSION,
    actorContractVersion: 'identity-actor/v1',
    iss: IDENTITY_CRM_DELIVERY_ISSUER,
    aud: IDENTITY_CRM_DELIVERY_AUDIENCE,
    sub: 'idn:fixture_identity_actor_0001',
    role: 'GESTOR',
    scopes: {
      units: ['novo-hamburgo'],
      modules: ['clients', 'finance'],
      permissions: ['module.clients.access', 'module.finance.access'],
    },
    iat: 1788292800,
    exp: 1788292860,
    jti: 'fixture_nonce_00000001',
    htm: 'POST',
    htu: '/api/crm/leads?unit=novo-hamburgo',
    bdh: 'a'.repeat(64),
  });
  assert.doesNotMatch(JSON.stringify(prepared), /email|username|displayname|cookie|session|csrf/i);
  assert.equal(Object.isFrozen(prepared), true);
  assert.equal(Object.isFrozen(prepared.claims.scopes), true);
});

test('legacy actors cannot be promoted to a CRM delivery subject', () => {
  const legacyActor = toAuthenticatedActor({
    username: 'pilot',
    email: 'pilot@example.test',
    role: 'GESTOR',
    allowedUnits: ['novo-hamburgo'],
    allowedModules: ['finance'],
    permissions: ['finance:read'],
  });

  assert.throws(() => prepareCrmIdentityDeliveryV1(input({ identity: legacyActor })), /IDENTITY_ACTOR_INVALID/);
});

test('the preparation fails closed for invalid opaque identity, scopes, request binding and lifetime', () => {
  assert.throws(() => prepareCrmIdentityDeliveryV1(input({ identity: { ...baseInput.identity, identitySubject: 'pilot' } })), /IDENTITY_SUBJECT_REQUIRED/);
  assert.throws(() => prepareCrmIdentityDeliveryV1(input({ identity: { ...baseInput.identity, role: 'gestor' } })), /IDENTITY_ROLE_INVALID/);
  assert.throws(() => prepareCrmIdentityDeliveryV1(input({ identity: { ...baseInput.identity, email: 'pilot@example.test' } })), /IDENTITY_ACTOR_INVALID/);
  assert.throws(() => prepareCrmIdentityDeliveryV1({ ...input(), extra: 'rejected' }), /IDENTITY_CRM_DELIVERY_INPUT_INVALID/);
  assert.throws(() => prepareCrmIdentityDeliveryV1(input({ identity: { ...baseInput.identity, scopes: { ...baseInput.identity.scopes, units: ['NH'] } } })), /IDENTITY_SCOPE_UNITS_INVALID/);
  assert.throws(() => prepareCrmIdentityDeliveryV1(input({ identity: { ...baseInput.identity, scopes: { ...baseInput.identity.scopes, modules: ['finance', 'finance'] } } })), /IDENTITY_SCOPE_MODULES_INVALID/);
  assert.throws(() => prepareCrmIdentityDeliveryV1(input({ identity: { ...baseInput.identity, scopes: { ...baseInput.identity.scopes, modules: ['finance', 'clients'] } } })), /IDENTITY_SCOPE_MODULES_INVALID/);
  assert.throws(() => prepareCrmIdentityDeliveryV1(input({ requestBinding: { ...baseInput.requestBinding, method: 'post' } })), /CRM_METHOD_INVALID/);
  assert.throws(() => prepareCrmIdentityDeliveryV1(input({ requestBinding: { ...baseInput.requestBinding, extra: 'rejected' } })), /CRM_REQUEST_BINDING_INVALID/);
  assert.throws(() => prepareCrmIdentityDeliveryV1(input({ requestBinding: { ...baseInput.requestBinding, target: 'https://crm.example.test/api/crm/leads' } })), /CRM_TARGET_INVALID/);
  assert.throws(() => prepareCrmIdentityDeliveryV1(input({ requestBinding: { ...baseInput.requestBinding, target: '/api/crm/admin/%2E%2E/leads' } })), /CRM_TARGET_INVALID/);
  assert.doesNotThrow(() => prepareCrmIdentityDeliveryV1(input({ requestBinding: { ...baseInput.requestBinding, target: '/api/crm/clients?q=ACME%2Ffilial' } })));
  assert.throws(() => prepareCrmIdentityDeliveryV1(input({ requestBinding: { ...baseInput.requestBinding, bodyDigest: 'A'.repeat(64) } })), /CRM_BODY_DIGEST_INVALID/);
  assert.throws(() => prepareCrmIdentityDeliveryV1(input({ ttlSeconds: 61 })), /IDENTITY_TTL_INVALID/);
  assert.throws(() => prepareCrmIdentityDeliveryV1(input({ issuedAt: Number.MAX_SAFE_INTEGER })), /IDENTITY_EXPIRES_AT_INVALID/);
});

test('the preparation rejects hidden, symbolic, inherited and accessor input fields', () => {
  const hidden = input();
  Object.defineProperty(hidden, 'hidden', { value: true, enumerable: false });
  assert.throws(() => prepareCrmIdentityDeliveryV1(hidden), /IDENTITY_CRM_DELIVERY_INPUT_INVALID/);

  const symbolic = input();
  symbolic[Symbol('hidden')] = true;
  assert.throws(() => prepareCrmIdentityDeliveryV1(symbolic), /IDENTITY_CRM_DELIVERY_INPUT_INVALID/);

  const inherited = Object.create(input());
  assert.throws(() => prepareCrmIdentityDeliveryV1(inherited), /IDENTITY_CRM_DELIVERY_INPUT_INVALID/);

  const accessor = input();
  Object.defineProperty(accessor, 'jti', { enumerable: true, get: () => baseInput.jti });
  assert.throws(() => prepareCrmIdentityDeliveryV1(accessor), /IDENTITY_CRM_DELIVERY_INPUT_INVALID/);
});

test('the preparation snapshots scope array data before validation and output', () => {
  const source = ['module.clients.access'];
  let indexGets = 0;
  const proxied = new Proxy(source, {
    get(target, property, receiver) {
      if (property === '0') indexGets += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  const prepared = prepareCrmIdentityDeliveryV1(input({
    identity: { ...baseInput.identity, scopes: { ...baseInput.identity.scopes, permissions: proxied } },
  }));
  assert.deepEqual(prepared.claims.scopes.permissions, ['module.clients.access']);
  assert.equal(indexGets, 0);

  const accessorScope = [];
  Object.defineProperty(accessorScope, '0', { enumerable: true, get: () => 'module.clients.access' });
  assert.throws(() => prepareCrmIdentityDeliveryV1(input({
    identity: { ...baseInput.identity, scopes: { ...baseInput.identity.scopes, permissions: accessorScope } },
  })), /IDENTITY_SCOPE_PERMISSIONS_INVALID/);
});

test('the source-only helper is not connected to the legacy public runtime or a secret', async () => {
  const [helper, authRoutes, inventoryWorker] = await Promise.all([
    readFile(new URL('../delivery/crm-envelope-v1.js', import.meta.url), 'utf8'),
    readFile(new URL('../routes/auth.js', import.meta.url), 'utf8'),
    readFile(new URL('../../inventory/src/worker.js', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(helper, /SESSION_SECRET|resolveIdentityActor|crypto\.subtle/i);
  assert.doesNotMatch(helper, /from ['"]cloudflare:workers['"]/i);
  assert.doesNotMatch(authRoutes, /crm-envelope-v1/);
  assert.doesNotMatch(inventoryWorker, /crm-envelope-v1/);

  const authMeStart = authRoutes.indexOf('// GET /auth/me');
  const authRefreshStart = authRoutes.indexOf('// POST /auth/refresh', authMeStart);
  assert.ok(authMeStart >= 0 && authRefreshStart > authMeStart, 'expected the legacy /auth/me boundary');
  assert.doesNotMatch(authRoutes.slice(authMeStart, authRefreshStart), /\bidentitySubject\b/);
});
