import {
  IDENTITY_CRM_DELIVERY_AUDIENCE,
  IDENTITY_CRM_DELIVERY_ISSUER,
  IDENTITY_CRM_DELIVERY_MAX_TTL_SECONDS,
  IDENTITY_CRM_DELIVERY_VERSION,
  prepareCrmIdentityDeliveryV1,
} from './crm-envelope-v1.js';
import * as publishedIdentityCrmDeliveryContract from '@jubenitogarcia/skincos-identity-contracts/identity-crm-delivery';

const IDENTITY_CRM_DELIVERY_ALGORITHM = 'EdDSA';
const IDENTITY_CRM_DELIVERY_TYPE = 'skincos-identity-delivery+jws';
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,160}$/;
const JTI_PATTERN = /^[A-Za-z0-9_-]{16,160}$/;
const MAX_CLOCK_SKEW_SECONDS = IDENTITY_CRM_DELIVERY_MAX_TTL_SECONDS;
const KEY_STATUSES = new Set(['active', 'overlap', 'revoked']);
const DELIVERY_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const TEXT_ENCODER = new TextEncoder();

function fail(code) {
  throw new TypeError(code);
}

function assertPlainObject(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(code);
  }
  return value;
}

function assertEpochSeconds(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) fail(code);
  return value;
}

function assertClockSkew(value) {
  return assertEpochSeconds(value, 'IDENTITY_CLOCK_SKEW_INVALID') <= MAX_CLOCK_SKEW_SECONDS
    ? value
    : fail('IDENTITY_CLOCK_SKEW_INVALID');
}

function assertKeyId(value, code = 'IDENTITY_KEY_ID_INVALID') {
  if (typeof value !== 'string' || !KEY_ID_PATTERN.test(value)) fail(code);
  return value;
}

function assertJti(value) {
  if (typeof value !== 'string' || !JTI_PATTERN.test(value)) fail('IDENTITY_JTI_INVALID');
  return value;
}

function assertMethod(value) {
  if (typeof value !== 'string') fail('IDENTITY_REQUEST_METHOD_INVALID');
  const method = value.trim().toUpperCase();
  if (!DELIVERY_METHODS.has(method)) fail('IDENTITY_REQUEST_METHOD_INVALID');
  return method;
}

function requestBytes(value) {
  if (value === undefined || value === null) return new Uint8Array();
  if (typeof value === 'string') return TEXT_ENCODER.encode(value);
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  fail('IDENTITY_REQUEST_BODY_INVALID');
}

async function sha256Hex(value) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== 'function') fail('IDENTITY_REQUEST_CRYPTO_UNAVAILABLE');
  const digest = await subtle.digest('SHA-256', requestBytes(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function assertRequest(value) {
  assertPlainObject(value, 'IDENTITY_REQUEST_INVALID');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 3 || keys.some((key) => typeof key !== 'string' || !['method', 'target', 'body'].includes(key))) {
    fail('IDENTITY_REQUEST_INVALID');
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      fail('IDENTITY_REQUEST_INVALID');
    }
  }
  return value;
}

async function requestBindingFromRequest(value) {
  const request = assertRequest(value);
  return {
    method: assertMethod(request.method),
    target: request.target,
    bodyDigest: await sha256Hex(request.body),
  };
}

function normalizeKeyRecord(value, expectedStatus, code = 'IDENTITY_KEY_RECORD_INVALID') {
  assertPlainObject(value, code);
  const allowedKeys = ['kid', 'sign', 'status', 'notBefore', 'notAfter'];
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))) fail(code);
  if (!Object.prototype.hasOwnProperty.call(value, 'kid') || !Object.prototype.hasOwnProperty.call(value, 'sign')) fail(code);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) fail(code);
  }
  if (typeof value.sign !== 'function') fail('IDENTITY_KEY_SIGNER_REQUIRED');

  const kid = assertKeyId(value.kid, 'IDENTITY_KEY_ID_INVALID');
  const status = value.status === undefined ? expectedStatus : value.status;
  if (!KEY_STATUSES.has(status) || status !== expectedStatus) fail('IDENTITY_KEY_STATUS_INVALID');
  const notBefore = value.notBefore === undefined ? null : assertEpochSeconds(value.notBefore, 'IDENTITY_KEY_NOT_BEFORE_INVALID');
  const notAfter = value.notAfter === undefined ? null : assertEpochSeconds(value.notAfter, 'IDENTITY_KEY_NOT_AFTER_INVALID');
  if (notBefore !== null && notAfter !== null && notAfter <= notBefore) fail('IDENTITY_KEY_WINDOW_INVALID');

  return Object.freeze({ kid, sign: value.sign, status, notBefore, notAfter });
}

function publicKeyMetadata(key) {
  return Object.freeze({
    kid: key.kid,
    status: key.status,
    notBefore: key.notBefore,
    notAfter: key.notAfter,
  });
}

/**
 * Creates an in-memory key lifecycle state machine for synthetic tests and
 * local integration. Production must replace it with a durable Identity-owned
 * registry/custody adapter. A key record carries only a signer callback; raw
 * private key bytes, PEM/JWK material and secrets are deliberately rejected.
 */
export function createCrmIdentityDeliveryKeyRing({ active, overlap = [] } = {}) {
  const activeKey = normalizeKeyRecord(active, 'active');
  if (!Array.isArray(overlap)) fail('IDENTITY_KEY_OVERLAP_INVALID');

  const records = new Map([[activeKey.kid, activeKey]]);
  for (const candidate of overlap) {
    const key = normalizeKeyRecord(candidate, 'overlap');
    if (records.has(key.kid)) fail('IDENTITY_KEY_DUPLICATE');
    records.set(key.kid, key);
  }

  let currentKid = activeKey.kid;

  function current() {
    return records.get(currentKid);
  }

  const ring = {
    getActiveKey({ nowSeconds } = {}) {
      const now = assertEpochSeconds(nowSeconds, 'IDENTITY_NOW_INVALID');
      const key = current();
      if (!key || key.status === 'revoked') fail('IDENTITY_SIGNING_KEY_REVOKED');
      if (key.status !== 'active') fail('IDENTITY_SIGNING_KEY_UNAVAILABLE');
      if (key.notBefore !== null && now < key.notBefore) fail('IDENTITY_SIGNING_KEY_NOT_YET_VALID');
      if (key.notAfter !== null && now >= key.notAfter) fail('IDENTITY_SIGNING_KEY_EXPIRED');
      return key;
    },

    isRevoked(kid) {
      const key = records.get(assertKeyId(kid));
      return key?.status === 'revoked';
    },

    list() {
      return Object.freeze([...records.values()].map(publicKeyMetadata));
    },

    rotate(next) {
      const nextKey = normalizeKeyRecord(next, 'active');
      if (records.has(nextKey.kid)) fail('IDENTITY_KEY_DUPLICATE');
      const previous = current();
      records.set(previous.kid, Object.freeze({ ...previous, status: 'overlap' }));
      records.set(nextKey.kid, nextKey);
      currentKid = nextKey.kid;
      return publicKeyMetadata(nextKey);
    },

    revoke(kid) {
      const normalizedKid = assertKeyId(kid);
      const key = records.get(normalizedKid);
      if (!key) fail('IDENTITY_KEY_UNKNOWN');
      if (normalizedKid === currentKid) fail('IDENTITY_KEY_ACTIVE_REQUIRES_ROTATION');
      records.set(normalizedKid, Object.freeze({ ...key, status: 'revoked' }));
      return publicKeyMetadata(records.get(normalizedKid));
    },
  };

  return Object.freeze(ring);
}

function assertContractAdapter(contract) {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(contract))) {
    fail('IDENTITY_CRM_CONTRACT_UNAVAILABLE');
  }
  if (typeof contract.createIdentityCrmDeliverySigningInput !== 'function') {
    fail('IDENTITY_CRM_CONTRACT_SIGNING_INPUT_UNAVAILABLE');
  }
  if (typeof contract.assertIdentityCrmDeliveryHeader !== 'function'
    || typeof contract.assertIdentityCrmDeliveryClaims !== 'function') {
    fail('IDENTITY_CRM_CONTRACT_VALIDATORS_UNAVAILABLE');
  }
  if (contract.IDENTITY_CRM_DELIVERY_VERSION !== IDENTITY_CRM_DELIVERY_VERSION
    || contract.IDENTITY_CRM_DELIVERY_ISSUER !== IDENTITY_CRM_DELIVERY_ISSUER
    || contract.IDENTITY_CRM_DELIVERY_AUDIENCE !== IDENTITY_CRM_DELIVERY_AUDIENCE
    || contract.IDENTITY_CRM_DELIVERY_ALGORITHM !== IDENTITY_CRM_DELIVERY_ALGORITHM
    || contract.IDENTITY_CRM_DELIVERY_TYPE !== IDENTITY_CRM_DELIVERY_TYPE) {
    fail('IDENTITY_CRM_CONTRACT_MISMATCH');
  }
  return contract;
}

function nowProvider(value) {
  if (value === undefined) return () => Math.floor(Date.now() / 1000);
  if (typeof value === 'function') return value;
  const fixed = assertEpochSeconds(value, 'IDENTITY_NOW_INVALID');
  return () => fixed;
}

function defaultJti() {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID !== 'function') fail('IDENTITY_JTI_RANDOM_UNAVAILABLE');
  return String(randomUUID.call(globalThis.crypto)).replace(/-/g, '_');
}

function normalizeSignature(value) {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  fail('IDENTITY_SIGNATURE_INVALID');
}

function assertEd25519PrivateKey(value) {
  if (!value || typeof value !== 'object' || value.type !== 'private' || value.algorithm?.name !== 'Ed25519'
    || value.extractable !== false || !Array.isArray(value.usages) || !value.usages.includes('sign')) {
    fail('IDENTITY_ED25519_PRIVATE_KEY_INVALID');
  }
  return value;
}

/**
 * Adapts a non-exportable WebCrypto Ed25519 key to the key-ring callback.
 * The key never crosses the callback boundary as bytes, PEM or JWK.
 */
export function createCrmIdentityEd25519Signer(privateKey) {
  const key = assertEd25519PrivateKey(privateKey);
  return async (signingInput) => {
    if (typeof signingInput !== 'string' || !signingInput) fail('IDENTITY_SIGNING_INPUT_INVALID');
    const subtle = globalThis.crypto?.subtle;
    if (!subtle || typeof subtle.sign !== 'function') fail('IDENTITY_SIGNING_CRYPTO_UNAVAILABLE');
    return new Uint8Array(await subtle.sign(
      { name: 'Ed25519' },
      key,
      TEXT_ENCODER.encode(signingInput),
    ));
  };
}

/**
 * Projects an authenticated Identity actor into the exact minimized shape
 * accepted by the delivery contract. PII and compatibility aliases are
 * intentionally ignored, while a missing opaque subject fails closed.
 */
export function projectCrmIdentityActor(actor) {
  assertPlainObject(actor, 'IDENTITY_ACTOR_REQUIRED');
  if (!Object.prototype.hasOwnProperty.call(actor, 'identitySubject')
    || !Object.prototype.hasOwnProperty.call(actor, 'role')
    || !Object.prototype.hasOwnProperty.call(actor, 'scopes')) {
    fail('IDENTITY_ACTOR_REQUIRED');
  }
  return Object.freeze({
    identitySubject: actor.identitySubject,
    role: actor.role,
    scopes: actor.scopes,
  });
}

function encodeBase64Url(bytes) {
  if (typeof btoa !== 'function') fail('IDENTITY_BASE64URL_UNAVAILABLE');
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function assertSignerResult(value) {
  const signature = normalizeSignature(value);
  if (signature.byteLength !== 64) fail('IDENTITY_SIGNATURE_LENGTH_INVALID');
  return signature;
}

function assertReplayAdapter(replay) {
  if (replay === undefined) return null;
  assertPlainObject(replay, 'IDENTITY_REPLAY_ADAPTER_INVALID');
  if (typeof replay.reserve !== 'function') fail('IDENTITY_REPLAY_RESERVE_UNAVAILABLE');
  return replay;
}

/**
 * Builds the issuer boundary without owning routing, sessions, persistence or
 * key custody. The exact private contracts package is the default canonical
 * signing-input validator. An explicit adapter is accepted only for isolated
 * contract tests and is checked against fixed identity-crm-delivery constants.
 *
 * `keyRing` returns a signer callback backed by an external non-exportable
 * CryptoKey/secret manager. This module never accepts or serializes private
 * key material. `replay.reserve`, when supplied, is an optional issuer-side
 * uniqueness guard; CRM's durable atomic jti ledger remains mandatory for the
 * recipient and is not replaced by this process-local boundary.
 */
export function createCrmIdentityDeliveryIssuer(options = {}) {
  assertPlainObject(options, 'IDENTITY_CRM_ISSUER_OPTIONS_INVALID');
  const allowedKeys = ['enabled', 'contracts', 'keyRing', 'nowSeconds', 'clockSkewSeconds', 'jtiFactory', 'replay'];
  const keys = Reflect.ownKeys(options);
  if (keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key))) fail('IDENTITY_CRM_ISSUER_OPTIONS_INVALID');

  const enabled = options.enabled === true;
  const clockSkewSeconds = assertClockSkew(options.clockSkewSeconds ?? 0);
  const nowSeconds = nowProvider(options.nowSeconds);

  if (!enabled) {
    return Object.freeze({
      async issue() {
        fail('IDENTITY_CRM_DELIVERY_DISABLED');
      },
      status() {
        return Object.freeze({ enabled: false, issuer: IDENTITY_CRM_DELIVERY_ISSUER, audience: IDENTITY_CRM_DELIVERY_AUDIENCE });
      },
    });
  }

  // The pinned published package is the default. Keeping an explicit override
  // only for isolated tests lets a future WorkerEntrypoint inject an adapter
  // while preventing a mutable or undeclared wire-contract implementation.
  const contracts = assertContractAdapter(options.contracts ?? publishedIdentityCrmDeliveryContract);
  const keyRing = options.keyRing;
  if (!keyRing || typeof keyRing.getActiveKey !== 'function' || typeof keyRing.isRevoked !== 'function') {
    fail('IDENTITY_KEY_RING_UNAVAILABLE');
  }
  const replay = assertReplayAdapter(options.replay);
  const jtiFactory = options.jtiFactory === undefined ? defaultJti : options.jtiFactory;
  if (typeof jtiFactory !== 'function') fail('IDENTITY_JTI_FACTORY_UNAVAILABLE');

  return Object.freeze({
    async issue(input = {}) {
      assertPlainObject(input, 'IDENTITY_CRM_ISSUER_INPUT_INVALID');
      const inputKeys = ['identity', 'request', 'issuedAt', 'ttlSeconds', 'jti'];
      const ownKeys = Reflect.ownKeys(input);
      if (ownKeys.some((key) => typeof key !== 'string' || !inputKeys.includes(key))) fail('IDENTITY_CRM_ISSUER_INPUT_INVALID');
      if (!Object.prototype.hasOwnProperty.call(input, 'request')) fail('IDENTITY_REQUEST_REQUIRED');

      const now = assertEpochSeconds(await nowSeconds(), 'IDENTITY_NOW_INVALID');
      const issuedAt = input.issuedAt === undefined ? now : assertEpochSeconds(input.issuedAt, 'IDENTITY_ISSUED_AT_INVALID');
      const ttlSeconds = input.ttlSeconds === undefined ? IDENTITY_CRM_DELIVERY_MAX_TTL_SECONDS : assertEpochSeconds(input.ttlSeconds, 'IDENTITY_TTL_INVALID');
      if (ttlSeconds < 1 || ttlSeconds > IDENTITY_CRM_DELIVERY_MAX_TTL_SECONDS) fail('IDENTITY_TTL_INVALID');
      if (issuedAt > now + clockSkewSeconds) fail('IDENTITY_ISSUED_AT_IN_FUTURE');
      const expiresAt = issuedAt + ttlSeconds;
      if (expiresAt <= now - clockSkewSeconds) fail('IDENTITY_DELIVERY_EXPIRED');

      const jti = assertJti(input.jti === undefined ? await jtiFactory() : input.jti);
      const key = keyRing.getActiveKey({ nowSeconds: now });
      if (!key || typeof key !== 'object') fail('IDENTITY_SIGNING_KEY_UNAVAILABLE');
      const keyId = assertKeyId(key.kid);
      if (keyRing.isRevoked(keyId)) fail('IDENTITY_SIGNING_KEY_REVOKED');
      if (typeof key.sign !== 'function') fail('IDENTITY_KEY_SIGNER_REQUIRED');

      const prepared = prepareCrmIdentityDeliveryV1({
        enabled: true,
        identity: projectCrmIdentityActor(input.identity),
        requestBinding: await requestBindingFromRequest(input.request),
        issuedAt,
        ttlSeconds,
        jti,
        keyId,
      });

      contracts.assertIdentityCrmDeliveryHeader(prepared.protectedHeader);
      contracts.assertIdentityCrmDeliveryClaims(prepared.claims);

      const signingInput = await contracts.createIdentityCrmDeliverySigningInput({
        protectedHeader: prepared.protectedHeader,
        claims: prepared.claims,
      });
      if (typeof signingInput !== 'string' || signingInput.length < 32) fail('IDENTITY_SIGNING_INPUT_INVALID');

      const signature = assertSignerResult(await key.sign(signingInput));

      if (replay) {
        const reservation = await replay.reserve({
          jti,
          issuer: IDENTITY_CRM_DELIVERY_ISSUER,
          audience: IDENTITY_CRM_DELIVERY_AUDIENCE,
          expiresAt: new Date(expiresAt * 1000).toISOString(),
        });
        if (reservation !== 'reserved') fail('IDENTITY_JTI_REPLAY');
      }

      const compact = `${signingInput}.${encodeBase64Url(signature)}`;
      return Object.freeze({
        compact,
        protectedHeader: prepared.protectedHeader,
        claims: prepared.claims,
        keyId,
      });
    },
    status() {
      return Object.freeze({ enabled: true, issuer: IDENTITY_CRM_DELIVERY_ISSUER, audience: IDENTITY_CRM_DELIVERY_AUDIENCE });
    },
  });
}

export {
  IDENTITY_CRM_DELIVERY_ALGORITHM,
  IDENTITY_CRM_DELIVERY_AUDIENCE,
  IDENTITY_CRM_DELIVERY_ISSUER,
  IDENTITY_CRM_DELIVERY_MAX_TTL_SECONDS,
  IDENTITY_CRM_DELIVERY_TYPE,
  IDENTITY_CRM_DELIVERY_VERSION,
};
