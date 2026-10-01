/**
 * Versioned, public-only key-registry contract for Identity CRM delivery.
 *
 * This is deliberately separate from the compact-envelope contract. It gives
 * a controlled promotion job enough state to pin an active key, retain a
 * bounded overlap key during rotation, and explicitly reject revoked keys.
 * It is not a request-path discovery mechanism for CRM.
 */
export const IDENTITY_CRM_DELIVERY_KEY_REGISTRY_VERSION = 'identity-crm-delivery/key-registry/v1';

const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,160}$/;
const BASE64_URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const ED25519_PUBLIC_KEY_BYTES = 32;

function fail(code = 'IDENTITY_CRM_KEY_REGISTRY_INVALID') {
  throw new TypeError(code);
}

function exactKeys(value, allowed, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== allowed.length || keys.some((key) => typeof key !== 'string' || !allowed.includes(key))) fail(code);
  for (const key of allowed) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || descriptor.enumerable !== true) fail(code);
  }
  return value;
}

function exactArrayValues(value) {
  if (!Array.isArray(value)) fail();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes('length')) fail();
  const values = [];
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || descriptor.enumerable !== true) fail();
    values.push(descriptor.value);
  }
  return values;
}

function decodeCanonicalBase64Url(value, code) {
  if (typeof value !== 'string' || !BASE64_URL_PATTERN.test(value) || value.length % 4 === 1) fail(code);
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  let binary;
  try {
    binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding);
  } catch {
    fail(code);
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  let canonicalBinary = '';
  for (const byte of bytes) canonicalBinary += String.fromCharCode(byte);
  const canonical = btoa(canonicalBinary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  if (canonical !== value || bytes.byteLength !== ED25519_PUBLIC_KEY_BYTES) fail(code);
}

function assertEnvironment(value) {
  if (value !== 'staging' && value !== 'production') fail();
  return value;
}

function assertKid(value, environment) {
  if (typeof value !== 'string' || !KEY_ID_PATTERN.test(value) || !value.startsWith(`crm-${environment}-`)) fail();
  return value;
}

function normalizePublicJwk(value) {
  exactKeys(value, ['kty', 'crv', 'x', 'alg', 'use']);
  if (value.kty !== 'OKP' || value.crv !== 'Ed25519' || value.alg !== 'EdDSA' || value.use !== 'sig') fail();
  decodeCanonicalBase64Url(value.x, 'IDENTITY_CRM_KEY_REGISTRY_INVALID');
  return Object.freeze({ kty: 'OKP', crv: 'Ed25519', x: value.x, alg: 'EdDSA', use: 'sig' });
}

function normalizeActive(value, environment) {
  exactKeys(value, ['kid', 'jwk']);
  return Object.freeze({
    kid: assertKid(value.kid, environment),
    jwk: normalizePublicJwk(value.jwk),
  });
}

function normalizeOverlap(value, environment, nowSeconds) {
  exactKeys(value, ['kid', 'jwk', 'notAfter']);
  if (!Number.isSafeInteger(value.notAfter) || value.notAfter <= nowSeconds) fail('IDENTITY_CRM_KEY_OVERLAP_EXPIRED');
  return Object.freeze({
    kid: assertKid(value.kid, environment),
    jwk: normalizePublicJwk(value.jwk),
    notAfter: value.notAfter,
  });
}

function normalizeRevoked(value, environment) {
  const seen = new Set();
  const revoked = exactArrayValues(value).map((kid) => {
    const normalized = assertKid(kid, environment);
    if (seen.has(normalized)) fail();
    seen.add(normalized);
    return normalized;
  });
  return Object.freeze(revoked.sort());
}

function normalizeNowSeconds(value) {
  const nowSeconds = value === undefined ? Math.floor(Date.now() / 1000) : value;
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) fail('IDENTITY_CRM_KEY_REGISTRY_INVALID');
  return nowSeconds;
}

/**
 * Validates and canonicalizes the registry document that Identity can publish.
 * Expired overlap keys, private key fields and cross-environment kids are all
 * rejected before they could be exposed to a CRM verifier.
 */
export function createIdentityCrmDeliveryKeyRegistry(input = {}, { nowSeconds } = {}) {
  exactKeys(input, ['environment', 'active', 'overlap', 'revoked']);
  const { environment, active, overlap, revoked } = input;
  const normalizedEnvironment = assertEnvironment(environment);
  const normalizedNowSeconds = normalizeNowSeconds(nowSeconds);
  const normalizedActive = normalizeActive(active, normalizedEnvironment);
  const normalizedRevoked = normalizeRevoked(revoked, normalizedEnvironment);
  if (normalizedRevoked.includes(normalizedActive.kid)) fail('IDENTITY_CRM_ACTIVE_KEY_REVOKED');
  const seen = new Set([normalizedActive.kid, ...normalizedRevoked]);
  const normalizedOverlap = exactArrayValues(overlap).map((entry) => {
    const normalized = normalizeOverlap(entry, normalizedEnvironment, normalizedNowSeconds);
    if (seen.has(normalized.kid)) fail();
    seen.add(normalized.kid);
    return normalized;
  });

  return Object.freeze({
    version: IDENTITY_CRM_DELIVERY_KEY_REGISTRY_VERSION,
    environment: normalizedEnvironment,
    active: normalizedActive,
    overlap: Object.freeze(normalizedOverlap),
    revoked: normalizedRevoked,
  });
}

/**
 * Validates a fully published registry document. Consumers use this form when
 * promoting a registry into their own static configuration: the version is
 * mandatory and cannot be silently downgraded.
 */
export function assertIdentityCrmDeliveryKeyRegistry(input, { nowSeconds } = {}) {
  exactKeys(input, ['version', 'environment', 'active', 'overlap', 'revoked']);
  if (input.version !== IDENTITY_CRM_DELIVERY_KEY_REGISTRY_VERSION) fail();
  return createIdentityCrmDeliveryKeyRegistry({
    environment: input.environment,
    active: input.active,
    overlap: input.overlap,
    revoked: input.revoked,
  }, { nowSeconds });
}

/**
 * Derives the exact verification set from a validated registry. The active
 * key appears first for deterministic pinning; unexpired overlap keys are the
 * only additional eligible verification keys. Revoked keys have no JWK and
 * can never be returned here.
 */
export function acceptedIdentityCrmDeliveryVerificationKeys(registry, { nowSeconds } = {}) {
  const normalized = assertIdentityCrmDeliveryKeyRegistry(registry, { nowSeconds });
  return Object.freeze([
    Object.freeze({ ...normalized.active.jwk, kid: normalized.active.kid }),
    ...normalized.overlap.map(({ kid, jwk }) => Object.freeze({ ...jwk, kid })),
  ]);
}
