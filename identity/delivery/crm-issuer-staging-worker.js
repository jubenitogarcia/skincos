import {
  createCrmIdentityDeliveryIssuer,
  createCrmIdentityDeliveryKeyRing,
  createCrmIdentityEd25519Signer,
} from './crm-issuer-v1.js';

const ISSUE_PATH = '/internal/identity-crm-delivery/v1/issue';
const PUBLIC_KEYS_PATH = '/.well-known/identity-crm-delivery/v1/keys';
const MAX_REQUEST_BYTES = 1_048_576;
const BASE64_URL_PATTERN = /^[A-Za-z0-9_-]*$/;
const TEXT_ENCODER = new TextEncoder();

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

function parseJwkSecret(raw) {
  const value = parseJson(raw, 'IDENTITY_PRIVATE_JWK_INVALID');
  const allowed = ['kty', 'crv', 'x', 'd', 'alg', 'key_ops', 'ext'];
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string' || !allowed.includes(key))
    || !['kty', 'crv', 'x', 'd'].every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    fail('IDENTITY_PRIVATE_JWK_INVALID');
  }
  if (value.kty !== 'OKP' || value.crv !== 'Ed25519'
    || (value.alg !== undefined && value.alg !== 'EdDSA')
    || (value.key_ops !== undefined && (value.key_ops.length !== 1 || value.key_ops[0] !== 'sign'))
    || (value.ext !== undefined && value.ext !== false)) fail('IDENTITY_PRIVATE_JWK_INVALID');
  decodeBase64Url(value.x, 'IDENTITY_PRIVATE_JWK_INVALID', 32);
  decodeBase64Url(value.d, 'IDENTITY_PRIVATE_JWK_INVALID', 32);
  return Object.freeze({ kty: value.kty, crv: value.crv, x: value.x, d: value.d, alg: 'EdDSA', key_ops: ['sign'], ext: false });
}

function parsePublicJwk(raw) {
  const value = parseJson(raw, 'IDENTITY_PUBLIC_JWK_INVALID');
  const allowed = ['kty', 'crv', 'x', 'alg', 'use', 'key_ops', 'ext'];
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string' || !allowed.includes(key))
    || !['kty', 'crv', 'x'].every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    fail('IDENTITY_PUBLIC_JWK_INVALID');
  }
  if (value.kty !== 'OKP' || value.crv !== 'Ed25519'
    || (value.alg !== undefined && value.alg !== 'EdDSA')
    || (value.use !== undefined && value.use !== 'sig')
    || (value.key_ops !== undefined && (value.key_ops.length !== 1 || value.key_ops[0] !== 'verify'))) {
    fail('IDENTITY_PUBLIC_JWK_INVALID');
  }
  decodeBase64Url(value.x, 'IDENTITY_PUBLIC_JWK_INVALID', 32);
  return Object.freeze({ kty: value.kty, crv: value.crv, x: value.x, alg: 'EdDSA', use: 'sig' });
}

function assertKid(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{1,160}$/.test(value)) fail('IDENTITY_KEY_ID_INVALID');
  return value;
}

function stagingEnabled(env) {
  return env?.IDENTITY_CRM_DELIVERY_ENABLED === 'true'
    && env?.IDENTITY_CRM_DELIVERY_ENVIRONMENT === 'staging';
}

function loadStagingMaterial(env) {
  if (!stagingEnabled(env)) return null;
  const kid = assertKid(env.IDENTITY_CRM_DELIVERY_KID);
  if (typeof env.IDENTITY_CRM_DELIVERY_PRIVATE_JWK !== 'string'
    || typeof env.IDENTITY_CRM_DELIVERY_PUBLIC_JWK !== 'string'
    || typeof env.IDENTITY_CRM_DELIVERY_REQUEST_HMAC !== 'string') {
    fail('IDENTITY_STAGING_CUSTODY_UNAVAILABLE');
  }
  const privateJwk = parseJwkSecret(env.IDENTITY_CRM_DELIVERY_PRIVATE_JWK);
  const publicJwk = parsePublicJwk(env.IDENTITY_CRM_DELIVERY_PUBLIC_JWK);
  if (privateJwk.x !== publicJwk.x) fail('IDENTITY_PUBLIC_KEY_MISMATCH');
  if (new TextEncoder().encode(env.IDENTITY_CRM_DELIVERY_REQUEST_HMAC).byteLength < 32) {
    fail('IDENTITY_STAGING_REQUEST_AUTH_INVALID');
  }
  return Object.freeze({ kid, privateJwk, publicJwk, requestHmac: env.IDENTITY_CRM_DELIVERY_REQUEST_HMAC });
}

async function importPrivateKey(privateJwk) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.importKey !== 'function') fail('IDENTITY_STAGING_CRYPTO_UNAVAILABLE');
  return subtle.importKey('jwk', privateJwk, { name: 'Ed25519' }, false, ['sign']);
}

async function importRequestHmac(secret) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.importKey !== 'function') fail('IDENTITY_STAGING_CRYPTO_UNAVAILABLE');
  return subtle.importKey('raw', TEXT_ENCODER.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
}

function decodeRequestBody(value) {
  const bytes = decodeBase64Url(value, 'IDENTITY_REQUEST_BODY_INVALID');
  if (bytes.byteLength > MAX_REQUEST_BYTES) fail('IDENTITY_REQUEST_BODY_TOO_LARGE');
  return bytes;
}

async function isAuthorizedIssueRequest(request, rawBody, secret) {
  const supplied = request.headers.get('x-skincos-identity-issuer-auth');
  if (!supplied) return false;
  const signature = decodeBase64Url(supplied, 'IDENTITY_STAGING_REQUEST_AUTH_INVALID', 32);
  const key = await importRequestHmac(secret);
  return globalThis.crypto.subtle.verify('HMAC', key, signature, TEXT_ENCODER.encode(rawBody));
}

async function createEnabledIssuer(material) {
  const privateKey = await importPrivateKey(material.privateJwk);
  const keyRing = createCrmIdentityDeliveryKeyRing({
    active: {
      kid: material.kid,
      sign: createCrmIdentityEd25519Signer(privateKey),
    },
  });
  return createCrmIdentityDeliveryIssuer({ enabled: true, keyRing });
}

function publicKeyResponse(material) {
  return json({
    version: 'identity-crm-delivery/v1',
    keys: [{ ...material.publicJwk, kid: material.kid }],
  }, 200, { 'cache-control': 'no-store' });
}

/**
 * Staging-only service-binding surface. It has no production route or data
 * binding: the config intentionally leaves routes/workers.dev disabled. The
 * private JWK and request HMAC are supplied as staging secrets at runtime;
 * neither is read from source control. Public-key publication is explicit and
 * read-only so CRM can pin the `kid`/JWK out of band before accepting tokens.
 */
export async function handleIdentityCrmIssuerStagingRequest(request, env = {}) {
  if (!stagingEnabled(env)) {
    return request.method === 'HEAD' ? noContent(503) : json({ ok: false, error: 'IDENTITY_CRM_DELIVERY_DISABLED' }, 503);
  }

  let material;
  try {
    material = loadStagingMaterial(env);
  } catch {
    return request.method === 'HEAD' ? noContent(503) : json({ ok: false, error: 'IDENTITY_STAGING_CUSTODY_UNAVAILABLE' }, 503);
  }

  const url = new URL(request.url);
  if (url.pathname === PUBLIC_KEYS_PATH && (request.method === 'GET' || request.method === 'HEAD')) {
    if (request.method === 'HEAD') return noContent(200, { 'cache-control': 'no-store' });
    return publicKeyResponse(material);
  }
  if (url.pathname !== ISSUE_PATH || request.method !== 'POST') {
    return json({ ok: false, error: 'NOT_FOUND' }, 404);
  }

  const declaredLength = request.headers.get('content-length');
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_REQUEST_BYTES) {
    return json({ ok: false, error: 'REQUEST_TOO_LARGE' }, 413);
  }
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) return json({ ok: false, error: 'REQUEST_TOO_LARGE' }, 413);
  try {
    if (!await isAuthorizedIssueRequest(request, rawBody, material.requestHmac)) return json({ ok: false, error: 'UNAUTHORIZED' }, 401);
  } catch {
    return json({ ok: false, error: 'UNAUTHORIZED' }, 401);
  }

  try {
    const payload = parseJson(rawBody, 'IDENTITY_ISSUE_PAYLOAD_INVALID');
    exactKeys(payload, ['identity', 'request', 'jti'], 'IDENTITY_ISSUE_PAYLOAD_INVALID');
    exactKeys(payload.identity, ['identitySubject', 'role', 'scopes'], 'IDENTITY_ISSUE_ACTOR_INVALID');
    exactKeys(payload.request, ['method', 'target', 'bodyBase64'], 'IDENTITY_ISSUE_REQUEST_INVALID');
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
}

export default { fetch: handleIdentityCrmIssuerStagingRequest };
