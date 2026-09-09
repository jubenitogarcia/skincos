import {
  createCrmIdentityDeliveryIssuer,
  createCrmIdentityDeliveryKeyRing,
  createCrmIdentityEd25519Signer,
} from './crm-issuer-v1.js';

export const IDENTITY_CRM_DELIVERY_ISSUE_PATH = '/internal/identity-crm-delivery/v1/issue';
export const IDENTITY_CRM_DELIVERY_PUBLIC_KEYS_PATH = '/.well-known/identity-crm-delivery/v1/keys';

const MAX_REQUEST_BYTES = 1_048_576;
const BASE64_URL_PATTERN = /^[A-Za-z0-9_-]*$/;
const TEXT_ENCODER = new TextEncoder();
const ED25519_PUBLIC_KEY_BYTES = 32;
const ED25519_PRIVATE_KEY_BYTES = 32;
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,160}$/;
const JTI_PATTERN = /^[A-Za-z0-9_-]{16,160}$/;

function fail(code) {
  throw new TypeError(code);
}

function json(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}

function noContent(status, extraHeaders = {}) {
  return new Response(null, { status, headers: extraHeaders });
}

function parseJson(raw, code) {
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(code);
    return value;
  } catch (error) {
    if (error instanceof TypeError && error.message === code) throw error;
    fail(code);
  }
}

function exactKeys(value, allowed, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== allowed.length || keys.some((key) => typeof key !== 'string' || !allowed.includes(key))) fail(code);
  return value;
}

function decodeBase64Url(value, code, expectedLength = null) {
  if (typeof value !== 'string' || !BASE64_URL_PATTERN.test(value) || value.length % 4 === 1) fail(code);
  if (expectedLength !== null && value.length > Math.ceil(expectedLength * 4 / 3)) fail(code);
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
  if (canonical !== value || (expectedLength !== null && bytes.byteLength !== expectedLength)) fail(code);
  return bytes;
}

function parsePrivateJwk(raw) {
  const value = typeof raw === 'string'
    ? parseJson(raw, 'IDENTITY_PRIVATE_JWK_INVALID')
    : raw;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail('IDENTITY_PRIVATE_JWK_INVALID');
  }
  const allowed = ['kty', 'crv', 'x', 'd', 'alg', 'key_ops', 'ext'];
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string' || !allowed.includes(key))
    || !['kty', 'crv', 'x', 'd'].every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    fail('IDENTITY_PRIVATE_JWK_INVALID');
  }
  if (value.kty !== 'OKP' || value.crv !== 'Ed25519'
    || (value.alg !== undefined && value.alg !== 'EdDSA')
    || (value.key_ops !== undefined && (!Array.isArray(value.key_ops) || value.key_ops.length !== 1 || value.key_ops[0] !== 'sign'))
    || (value.ext !== undefined && value.ext !== false)) fail('IDENTITY_PRIVATE_JWK_INVALID');
  decodeBase64Url(value.x, 'IDENTITY_PRIVATE_JWK_INVALID', ED25519_PUBLIC_KEY_BYTES);
  decodeBase64Url(value.d, 'IDENTITY_PRIVATE_JWK_INVALID', ED25519_PRIVATE_KEY_BYTES);
  return Object.freeze({ kty: value.kty, crv: value.crv, x: value.x, d: value.d, alg: 'EdDSA', key_ops: ['sign'], ext: false });
}

function parsePublicJwk(raw) {
  const value = typeof raw === 'string'
    ? parseJson(raw, 'IDENTITY_PUBLIC_JWK_INVALID')
    : raw;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail('IDENTITY_PUBLIC_JWK_INVALID');
  }
  const allowed = ['kty', 'crv', 'x', 'alg', 'use', 'key_ops', 'ext'];
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string' || !allowed.includes(key))
    || !['kty', 'crv', 'x'].every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    fail('IDENTITY_PUBLIC_JWK_INVALID');
  }
  if (value.kty !== 'OKP' || value.crv !== 'Ed25519'
    || (value.alg !== undefined && value.alg !== 'EdDSA')
    || (value.use !== undefined && value.use !== 'sig')
    || (value.key_ops !== undefined && (!Array.isArray(value.key_ops) || value.key_ops.length !== 1 || value.key_ops[0] !== 'verify'))
    || (value.ext !== undefined && value.ext !== false)) {
    fail('IDENTITY_PUBLIC_JWK_INVALID');
  }
  decodeBase64Url(value.x, 'IDENTITY_PUBLIC_JWK_INVALID', ED25519_PUBLIC_KEY_BYTES);
  return Object.freeze({ kty: value.kty, crv: value.crv, x: value.x, alg: 'EdDSA', use: 'sig' });
}

function assertKeyId(value, prefix, code = 'IDENTITY_KEY_ID_INVALID') {
  if (typeof value !== 'string' || !KEY_ID_PATTERN.test(value) || !value.startsWith(prefix)) fail(code);
  return value;
}

function assertJti(value) {
  if (typeof value !== 'string' || !JTI_PATTERN.test(value)) fail('IDENTITY_JTI_INVALID');
  return value;
}

function parsePublicKeyRing(raw, activeKid, keyIdPrefix, nowSeconds) {
  const value = typeof raw === 'string' ? parseJson(raw, 'IDENTITY_PUBLIC_JWK_INVALID') : raw;

  // Production requires the explicit ring shape from the first key onward so
  // every release evaluates overlap and revocation invariants. The staging
  // profile intentionally uses the simpler single-JWK parser below.
  exactKeys(value, ['active', 'overlap', 'revoked'], 'IDENTITY_PUBLIC_KEY_RING_INVALID');
  exactKeys(value.active, ['kid', 'jwk'], 'IDENTITY_PUBLIC_KEY_RING_INVALID');
  const activeRingKid = assertKeyId(value.active.kid, keyIdPrefix, 'IDENTITY_PUBLIC_KEY_RING_INVALID');
  if (activeRingKid !== activeKid) fail('IDENTITY_PUBLIC_KEY_RING_INVALID');
  const activeJwk = parsePublicJwk(value.active.jwk);
  const revoked = value.revoked;
  if (!Array.isArray(revoked) || revoked.some((kid) => typeof kid !== 'string')) fail('IDENTITY_PUBLIC_KEY_RING_INVALID');
  const revokedKids = new Set(revoked.map((kid) => assertKeyId(kid, keyIdPrefix, 'IDENTITY_PUBLIC_KEY_RING_INVALID')));
  if (revokedKids.size !== revoked.length) fail('IDENTITY_PUBLIC_KEY_RING_INVALID');
  if (revokedKids.has(activeKid)) fail('IDENTITY_ACTIVE_KEY_REVOKED');

  if (!Array.isArray(value.overlap)) fail('IDENTITY_PUBLIC_KEY_RING_INVALID');
  const seen = new Set([activeKid, ...revokedKids]);
  const overlap = value.overlap.map((entry) => {
    exactKeys(entry, ['kid', 'jwk', 'notAfter'], 'IDENTITY_PUBLIC_KEY_RING_INVALID');
    const kid = assertKeyId(entry.kid, keyIdPrefix, 'IDENTITY_PUBLIC_KEY_RING_INVALID');
    if (seen.has(kid)) fail('IDENTITY_PUBLIC_KEY_RING_INVALID');
    seen.add(kid);
    if (!Number.isSafeInteger(entry.notAfter) || entry.notAfter <= nowSeconds) fail('IDENTITY_KEY_OVERLAP_EXPIRED');
    const jwk = parsePublicJwk(entry.jwk);
    return Object.freeze({ kid, jwk, notAfter: entry.notAfter });
  });

  const keys = [
    { ...activeJwk, kid: activeKid },
    ...overlap.map(({ kid, jwk }) => ({ ...jwk, kid })),
  ];
  return Object.freeze({ activeJwk, keys: Object.freeze(keys) });
}

function assertPayloadShape(payload) {
  exactKeys(payload, ['identity', 'request', 'jti'], 'IDENTITY_ISSUE_PAYLOAD_INVALID');
  exactKeys(payload.identity, ['identitySubject', 'role', 'scopes'], 'IDENTITY_ISSUE_ACTOR_INVALID');
  exactKeys(payload.request, ['method', 'target', 'bodyBase64'], 'IDENTITY_ISSUE_REQUEST_INVALID');
  assertJti(payload.jti);
  return payload;
}

function decodeRequestBody(value) {
  const bytes = decodeBase64Url(value, 'IDENTITY_REQUEST_BODY_INVALID');
  if (bytes.byteLength > MAX_REQUEST_BYTES) fail('IDENTITY_REQUEST_BODY_TOO_LARGE');
  return bytes;
}

async function importPrivateKey(privateJwk, cryptoErrorCode) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.importKey !== 'function') fail(cryptoErrorCode);
  return subtle.importKey('jwk', privateJwk, { name: 'Ed25519' }, false, ['sign']);
}

async function importRequestHmac(secret, cryptoErrorCode) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.importKey !== 'function') fail(cryptoErrorCode);
  return subtle.importKey('raw', TEXT_ENCODER.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
}

async function isAuthorizedIssueRequest(request, rawBody, secret, authErrorCode, cryptoErrorCode) {
  const supplied = request.headers.get('x-skincos-identity-issuer-auth');
  if (!supplied) return false;
  const signature = decodeBase64Url(supplied, authErrorCode, 32);
  const key = await importRequestHmac(secret, cryptoErrorCode);
  return globalThis.crypto.subtle.verify('HMAC', key, signature, TEXT_ENCODER.encode(rawBody));
}

function assertSecretNames(secretNames) {
  const required = ['kid', 'publicJwk', 'requestHmac'];
  if (!secretNames || required.some((name) => typeof secretNames[name] !== 'string' || !secretNames[name])) {
    throw new TypeError('IDENTITY_SECRET_NAMES_INVALID');
  }
  const hasPrivateJwk = typeof secretNames.privateJwk === 'string' && secretNames.privateJwk.length > 0;
  const hasSigningKey = typeof secretNames.signingKey === 'string' && secretNames.signingKey.length > 0;
  if (hasPrivateJwk === hasSigningKey) throw new TypeError('IDENTITY_SECRET_NAMES_INVALID');
  return Object.freeze({ ...secretNames, hasPrivateJwk, hasSigningKey });
}

function assertCallerConfig(caller) {
  if (caller === undefined || caller === null) return null;
  const required = ['enabled', 'id', 'hmac', 'expectedId', 'header'];
  if (!caller || typeof caller !== 'object'
    || required.some((name) => typeof caller[name] !== 'string' || !caller[name])) {
    throw new TypeError('IDENTITY_CALLER_CONFIG_INVALID');
  }
  return Object.freeze({
    enabled: caller.enabled,
    id: caller.id,
    hmac: caller.hmac,
    expectedId: caller.expectedId,
    header: caller.header,
    required: caller.required === true,
  });
}

async function createVerifiedSigner(privateKey, activePublicJwk, cryptoErrorCode) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.importKey !== 'function' || typeof subtle.verify !== 'function') fail(cryptoErrorCode);
  const signer = createCrmIdentityEd25519Signer(privateKey);
  const challenge = 'skincos/identity-crm-delivery/custody-proof/v1';
  const publicKey = await subtle.importKey('jwk', activePublicJwk, { name: 'Ed25519' }, false, ['verify']);
  const signature = await signer(challenge);
  if (!await subtle.verify({ name: 'Ed25519' }, publicKey, signature, TEXT_ENCODER.encode(challenge))) {
    fail('IDENTITY_PUBLIC_KEY_MISMATCH');
  }
  return signer;
}

/**
 * Creates an isolated Identity CRM delivery Worker handler. The profile is
 * deliberately explicit: a Worker can enable signing only when both its
 * environment name and flag match, and all key material arrives as runtime
 * secrets. No profile owns routing, CRM data or Inventory authentication.
 */
export function createIdentityCrmIssuerWorker({
  environment,
  keyIdPrefix,
  publicKeyMode = 'single',
  errorCodes = {
    custody: 'IDENTITY_RUNTIME_CUSTODY_UNAVAILABLE',
    auth: 'IDENTITY_REQUEST_AUTH_INVALID',
    crypto: 'IDENTITY_RUNTIME_CRYPTO_UNAVAILABLE',
  },
  secretNames = {
    kid: 'IDENTITY_CRM_DELIVERY_KID',
    privateJwk: 'IDENTITY_CRM_DELIVERY_PRIVATE_JWK',
    publicJwk: 'IDENTITY_CRM_DELIVERY_PUBLIC_JWK',
    requestHmac: 'IDENTITY_CRM_DELIVERY_REQUEST_HMAC',
  },
  caller = null,
} = {}) {
  if (typeof environment !== 'string' || !environment) throw new TypeError('IDENTITY_WORKER_ENVIRONMENT_INVALID');
  if (typeof keyIdPrefix !== 'string' || !keyIdPrefix) throw new TypeError('IDENTITY_KEY_PREFIX_INVALID');
  if (!['single', 'production-ring'].includes(publicKeyMode)) throw new TypeError('IDENTITY_PUBLIC_KEY_MODE_INVALID');
  const names = assertSecretNames(secretNames);
  const callerConfig = assertCallerConfig(caller);

  function enabled(env) {
    return env?.IDENTITY_CRM_DELIVERY_ENABLED === 'true'
      && env?.IDENTITY_CRM_DELIVERY_ENVIRONMENT === environment;
  }

  async function loadMaterial(env, nowSeconds) {
    if (!enabled(env)) return null;
    const kid = assertKeyId(env[names.kid], keyIdPrefix);
    if (typeof env[names.publicJwk] !== 'string'
      || typeof env[names.requestHmac] !== 'string') {
      fail(errorCodes.custody);
    }
    const publicKeyRing = publicKeyMode === 'production-ring'
      ? parsePublicKeyRing(env[names.publicJwk], kid, keyIdPrefix, nowSeconds)
      : (() => {
        const activeJwk = parsePublicJwk(env[names.publicJwk]);
        return Object.freeze({ activeJwk, keys: Object.freeze([{ ...activeJwk, kid }]) });
      })();
    const privateKey = names.hasSigningKey
      ? env[names.signingKey]
      : await importPrivateKey(parsePrivateJwk(env[names.privateJwk]), errorCodes.crypto);
    const signer = await createVerifiedSigner(privateKey, publicKeyRing.activeJwk, errorCodes.crypto);
    if (TEXT_ENCODER.encode(env[names.requestHmac]).byteLength < 32) fail(errorCodes.auth);
    let callerMaterial = null;
    if (callerConfig && env[callerConfig.enabled] === 'true') {
      const callerId = String(env[callerConfig.id] || '').trim();
      const callerHmac = env[callerConfig.hmac];
      if (callerId !== callerConfig.expectedId
        || typeof callerHmac !== 'string'
        || callerHmac.trim() !== callerHmac
        || TEXT_ENCODER.encode(callerHmac).byteLength < 32) {
        fail(errorCodes.custody);
      }
      callerMaterial = Object.freeze({ id: callerId, hmac: callerHmac, header: callerConfig.header });
    }
    if (callerConfig?.required && !callerMaterial) fail(errorCodes.custody);
    return Object.freeze({
      kid,
      signer,
      publicKeys: publicKeyRing.keys,
      requestHmac: env[names.requestHmac],
      caller: callerMaterial,
    });
  }

  function createEnabledIssuer(material) {
    const keyRing = createCrmIdentityDeliveryKeyRing({
      active: {
        kid: material.kid,
        sign: material.signer,
      },
    });
    return createCrmIdentityDeliveryIssuer({ enabled: true, keyRing });
  }

  function publicKeyResponse(material) {
    return json({
      version: 'identity-crm-delivery/v1',
      keys: material.publicKeys,
    }, 200, { 'cache-control': 'no-store' });
  }

  return async function handleIdentityCrmIssuerRequest(request, env = {}) {
    if (!enabled(env)) {
      return request.method === 'HEAD' ? noContent(503) : json({ ok: false, error: 'IDENTITY_CRM_DELIVERY_DISABLED' }, 503);
    }

    let material;
    try {
      material = await loadMaterial(env, Math.floor(Date.now() / 1000));
    } catch {
      return request.method === 'HEAD' ? noContent(503) : json({ ok: false, error: errorCodes.custody }, 503);
    }

    const url = new URL(request.url);
    if (url.pathname === IDENTITY_CRM_DELIVERY_PUBLIC_KEYS_PATH && (request.method === 'GET' || request.method === 'HEAD')) {
      if (request.method === 'HEAD') return noContent(200, { 'cache-control': 'no-store' });
      return publicKeyResponse(material);
    }
    if (url.pathname !== IDENTITY_CRM_DELIVERY_ISSUE_PATH || request.method !== 'POST') {
      return json({ ok: false, error: 'NOT_FOUND' }, 404);
    }

    const declaredLength = request.headers.get('content-length');
    if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_REQUEST_BYTES) {
      return json({ ok: false, error: 'REQUEST_TOO_LARGE' }, 413);
    }
    const rawBody = await request.text();
    if (TEXT_ENCODER.encode(rawBody).byteLength > MAX_REQUEST_BYTES) return json({ ok: false, error: 'REQUEST_TOO_LARGE' }, 413);
    try {
      const requestedCallerId = callerConfig ? request.headers.get(callerConfig.header) : null;
      const requestHmac = callerConfig?.required
        ? material.caller?.id === requestedCallerId
          ? material.caller.hmac
          : null
        : requestedCallerId === null
          ? material.requestHmac
          : material.caller?.id === requestedCallerId
            ? material.caller.hmac
            : null;
      if (!requestHmac || !await isAuthorizedIssueRequest(request, rawBody, requestHmac, errorCodes.auth, errorCodes.crypto)) return json({ ok: false, error: 'UNAUTHORIZED' }, 401);
    } catch {
      return json({ ok: false, error: 'UNAUTHORIZED' }, 401);
    }

    try {
      const payload = assertPayloadShape(parseJson(rawBody, 'IDENTITY_ISSUE_PAYLOAD_INVALID'));
      const issuer = await createEnabledIssuer(material);
      const result = await issuer.issue({
        identity: payload.identity,
        request: {
          method: payload.request.method,
          target: payload.request.target,
          body: decodeRequestBody(payload.request.bodyBase64),
        },
        jti: payload.jti,
      });
      return json({ ok: true, version: 'identity-crm-delivery/v1', keyId: result.keyId, compact: result.compact }, 200, { 'cache-control': 'no-store' });
    } catch (error) {
      const code = error instanceof TypeError ? error.message : 'IDENTITY_ISSUE_FAILED';
      return json({ ok: false, error: code }, code === 'IDENTITY_CRM_DELIVERY_DISABLED' ? 503 : 400);
    }
  };
}
