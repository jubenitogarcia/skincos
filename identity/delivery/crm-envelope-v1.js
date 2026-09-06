import { isCanonicalUnitScope } from '../../shared/identity-contract/index.js';

export const IDENTITY_CRM_DELIVERY_VERSION = 'identity-crm-delivery/v1';
export const IDENTITY_CRM_DELIVERY_ISSUER = 'skincos-identity';
export const IDENTITY_CRM_DELIVERY_AUDIENCE = 'skincos-crm-core';
export const IDENTITY_CRM_DELIVERY_MAX_TTL_SECONDS = 60;

const DELIVERY_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const OPAQUE_SUBJECT_PATTERN = /^idn:[A-Za-z0-9_-]{16,160}$/;
const ROLE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const SCOPE_ITEM_PATTERN = /^[a-z][a-z0-9:-]{0,159}$/;
// Keep the issuer-side preparation exactly aligned with the published
// identity-crm-delivery contract. Dots belong to module grants in the CRM
// shell; delivery permissions use the portable colon-delimited vocabulary.
const PERMISSION_ITEM_PATTERN = /^[a-z][a-z0-9:-]{0,159}$/;
const JTI_PATTERN = /^[A-Za-z0-9_-]{16,160}$/;
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,160}$/;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

function fail(code) {
  throw new TypeError(code);
}

function assertOnlyKeys(value, allowedKeys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))) fail(code);
  if (keys.some((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return !descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value');
  })) fail(code);
}

function assertExactKeys(value, allowedKeys, code) {
  assertOnlyKeys(value, allowedKeys, code);
  if (Reflect.ownKeys(value).length !== allowedKeys.length) fail(code);
}

function assertEnabled(value) {
  if (value !== true) fail('IDENTITY_CRM_DELIVERY_DISABLED');
}

function assertEpochSeconds(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${name}_INVALID`);
  return value;
}

function assertOpaqueSubject(value) {
  if (typeof value !== 'string' || !OPAQUE_SUBJECT_PATTERN.test(value)) {
    fail('IDENTITY_SUBJECT_REQUIRED');
  }
  return value;
}

function assertRole(value) {
  if (typeof value !== 'string' || !ROLE_PATTERN.test(value)) fail('IDENTITY_ROLE_INVALID');
  return value;
}

function strictSortedScope(value, name, pattern) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 64) fail(`${name}_INVALID`);
  const length = value.length;
  const expectedKeys = new Set(Array.from({ length }, (_, index) => String(index)));
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1 || keys.some((key) => key !== 'length' && (typeof key !== 'string' || !expectedKeys.has(key)))) {
    fail(`${name}_INVALID`);
  }
  const items = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) fail(`${name}_INVALID`);
    items.push(descriptor.value);
  }
  if (items.some((item) => typeof item !== 'string' || !item || !pattern.test(item))) fail(`${name}_INVALID`);
  if (items.some((item, index) => index > 0 && items[index - 1] >= item)) fail(`${name}_INVALID`);
  return Object.freeze(items);
}

function assertScopes(value) {
  assertExactKeys(value, ['units', 'modules', 'permissions'], 'IDENTITY_SCOPES_INVALID');
  const units = strictSortedScope(value.units, 'IDENTITY_SCOPE_UNITS', /^[a-z][a-z0-9-]{0,159}$/);
  if (units.some((unit) => !isCanonicalUnitScope(unit))) fail('IDENTITY_SCOPE_UNITS_INVALID');
  return Object.freeze({
    units,
    modules: strictSortedScope(value.modules, 'IDENTITY_SCOPE_MODULES', SCOPE_ITEM_PATTERN),
    permissions: strictSortedScope(value.permissions, 'IDENTITY_SCOPE_PERMISSIONS', PERMISSION_ITEM_PATTERN),
  });
}

function assertCanonicalTarget(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 2048) fail('CRM_TARGET_INVALID');
  if (!value.startsWith('/api/crm') || !['/', '?', undefined].includes(value.at(8))) fail('CRM_TARGET_INVALID');
  if (value.includes('#') || value.includes('\\') || /[^\x21-\x7e]/.test(value)) fail('CRM_TARGET_INVALID');
  const queryIndex = value.indexOf('?');
  const pathname = queryIndex === -1 ? value : value.slice(0, queryIndex);
  if (value.endsWith('?') || /\/{2,}|\/(?:\.{1,2})(?:\/|$)/.test(pathname)) fail('CRM_TARGET_INVALID');
  if (/%(?![0-9A-F]{2})/.test(value) || /%(?:2E|2F|5C)/.test(pathname)) fail('CRM_TARGET_INVALID');
  return value;
}

function assertRequestBinding(value) {
  assertExactKeys(value, ['method', 'target', 'bodyDigest'], 'CRM_REQUEST_BINDING_INVALID');
  const method = value.method;
  if (typeof method !== 'string' || !DELIVERY_METHODS.has(method)) fail('CRM_METHOD_INVALID');
  const bodyDigest = value.bodyDigest;
  if (typeof bodyDigest !== 'string') fail('CRM_BODY_DIGEST_INVALID');
  if (!SHA256_HEX_PATTERN.test(bodyDigest)) fail('CRM_BODY_DIGEST_INVALID');
  return Object.freeze({
    htm: method,
    htu: assertCanonicalTarget(value.target),
    bdh: bodyDigest,
  });
}

/**
 * Produces only the minimal, unsigned input for a future private Identity
 * WorkerEntrypoint. It deliberately does not read runtime configuration,
 * resolve a session, serialize a JWS, sign, route, persist, or publish.
 * The published contracts package remains the canonical parser, serializer and
 * validator when this preparation is later connected through a clean install.
 */
export function prepareCrmIdentityDeliveryV1(input = {}) {
  assertOnlyKeys(input, [
    'enabled', 'identity', 'requestBinding', 'issuedAt', 'ttlSeconds', 'jti', 'keyId',
  ], 'IDENTITY_CRM_DELIVERY_INPUT_INVALID');
  const {
    enabled,
    identity,
    requestBinding,
    issuedAt,
    ttlSeconds = IDENTITY_CRM_DELIVERY_MAX_TTL_SECONDS,
    jti,
    keyId,
  } = input;
  assertEnabled(enabled);
  assertExactKeys(identity, ['identitySubject', 'role', 'scopes'], 'IDENTITY_ACTOR_INVALID');
  const iat = assertEpochSeconds(issuedAt, 'IDENTITY_ISSUED_AT');
  const ttl = assertEpochSeconds(ttlSeconds, 'IDENTITY_TTL');
  if (ttl < 1 || ttl > IDENTITY_CRM_DELIVERY_MAX_TTL_SECONDS) fail('IDENTITY_TTL_INVALID');
  const exp = assertEpochSeconds(iat + ttl, 'IDENTITY_EXPIRES_AT');
  if (typeof jti !== 'string' || !JTI_PATTERN.test(jti)) fail('IDENTITY_JTI_INVALID');
  if (typeof keyId !== 'string' || !KEY_ID_PATTERN.test(keyId)) fail('IDENTITY_KEY_ID_INVALID');

  const request = assertRequestBinding(requestBinding);
  const protectedHeader = Object.freeze({
    alg: 'EdDSA',
    kid: keyId,
    typ: 'skincos-identity-delivery+jws',
  });
  const claims = Object.freeze({
    version: IDENTITY_CRM_DELIVERY_VERSION,
    actorContractVersion: 'identity-actor/v1',
    iss: IDENTITY_CRM_DELIVERY_ISSUER,
    aud: IDENTITY_CRM_DELIVERY_AUDIENCE,
    sub: assertOpaqueSubject(identity.identitySubject),
    role: assertRole(identity.role),
    scopes: assertScopes(identity.scopes),
    iat,
    exp,
    jti,
    ...request,
  });

  return Object.freeze({ protectedHeader, claims });
}
