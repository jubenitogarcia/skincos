import { isCanonicalUnitScope, isOpaqueIdentitySubject } from '../../shared/identity-contract/index.js';
import { fetchBoundService } from '../../shared/service-adapters/cloudflare-service-binding.js';

const IDENTITY_ISSUER_BINDING = 'IDENTITY_CRM_ISSUER';
const IDENTITY_ISSUER_PATH = '/internal/identity-crm-delivery/v1/issue';
const IDENTITY_ISSUER_ORIGIN = 'https://identity-crm-issuer.internal';
const IDENTITY_ISSUER_CALLER_ID = 'crm-api-staging-v1';
const IDENTITY_ISSUER_CALLER_HEADER = 'x-skincos-identity-issuer-caller';
const IDENTITY_ISSUER_AUTH_HEADER = 'x-skincos-identity-issuer-auth';
const CRM_SESSION_PATH = '/crm/session';
const CRM_SESSION_TARGET = '/api/crm/session';
const CRM_PROJECTION_PATH = '/crm/projections';
const CRM_PROJECTION_TARGET = '/api/crm/projections';
const MAX_PROJECTION_QUERY_BYTES = 2048;
const TEXT_ENCODER = new TextEncoder();
const ROLE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const SCOPE_ITEM_PATTERN = /^[a-z][a-z0-9:-]{0,159}$/;
const JTI_PATTERN = /^[A-Za-z0-9_-]{16,160}$/;
const KEY_ID_PATTERN = /^crm-staging-[A-Za-z0-9._-]{1,148}$/;
const COMPACT_JWS_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const MAX_COMPACT_JWS_LENGTH = 16_384;
const ISSUE_TIMEOUT_MS = 3_000;

function fail(code) {
    throw new TypeError(code);
}
function assertPlainObject(value, code) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(code);
    return value;
}

function assertExactKeys(value, allowed, code) {
    assertPlainObject(value, code);
    const keys = Reflect.ownKeys(value);
    if (keys.length !== allowed.length || keys.some((key) => typeof key !== 'string' || !allowed.includes(key))) fail(code);
    for (const key of allowed) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) fail(code);
    }
    return value;
}

function ownData(value, key, code) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) fail(code);
    return descriptor.value;
}

function strictScopeItems(value, code, pattern, additionalValidation = null) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 64) fail(code);
    const expectedKeys = new Set(Array.from({ length: value.length }, (_, index) => String(index)));
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || keys.some((key) => key !== 'length' && (typeof key !== 'string' || !expectedKeys.has(key)))) fail(code);

    const items = [];
    for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) fail(code);
        const item = descriptor.value;
        if (typeof item !== 'string' || !item || !pattern.test(item) || (additionalValidation && !additionalValidation(item))) fail(code);
        items.push(item);
    }
    if (new Set(items).size !== items.length) fail(code);
    return Object.freeze(items.sort());
}

function trustedIdentityProjection(actor) {
    assertPlainObject(actor, 'CRM_IDENTITY_REQUIRED');
    const identitySubject = ownData(actor, 'identitySubject', 'CRM_IDENTITY_SUBJECT_REQUIRED');
    const role = ownData(actor, 'role', 'CRM_IDENTITY_ROLE_INVALID');
    const scopes = ownData(actor, 'scopes', 'CRM_IDENTITY_SCOPES_INVALID');
    if (!isOpaqueIdentitySubject(identitySubject)) fail('CRM_IDENTITY_SUBJECT_REQUIRED');
    if (typeof role !== 'string' || !ROLE_PATTERN.test(role)) fail('CRM_IDENTITY_ROLE_INVALID');
    assertExactKeys(scopes, ['units', 'modules', 'permissions'], 'CRM_IDENTITY_SCOPES_INVALID');

    return Object.freeze({
        identitySubject,
        role,
        scopes: Object.freeze({
            units: strictScopeItems(ownData(scopes, 'units', 'CRM_IDENTITY_SCOPES_INVALID'), 'CRM_IDENTITY_SCOPE_UNITS_INVALID', /^[a-z][a-z0-9-]{0,159}$/, isCanonicalUnitScope),
            modules: strictScopeItems(ownData(scopes, 'modules', 'CRM_IDENTITY_SCOPES_INVALID'), 'CRM_IDENTITY_SCOPE_MODULES_INVALID', SCOPE_ITEM_PATTERN),
            permissions: strictScopeItems(ownData(scopes, 'permissions', 'CRM_IDENTITY_SCOPES_INVALID'), 'CRM_IDENTITY_SCOPE_PERMISSIONS_INVALID', SCOPE_ITEM_PATTERN),
        }),
    });
}

function loadCallerConfiguration(env) {
    if (String(env?.ENVIRONMENT || '').trim().toLowerCase() !== 'staging'
        || env?.CRM_IDENTITY_ISSUER_CALLER_ENABLED !== 'true') {
        fail('CRM_IDENTITY_DELIVERY_UNAVAILABLE');
    }
    const callerId = String(env?.CRM_IDENTITY_ISSUER_CALLER_ID || '').trim();
    const secret = env?.CRM_IDENTITY_ISSUER_CALLER_HMAC;
    if (callerId !== IDENTITY_ISSUER_CALLER_ID
        || typeof secret !== 'string'
        || secret.trim() !== secret
        || TEXT_ENCODER.encode(secret).byteLength < 32) {
        fail('CRM_IDENTITY_DELIVERY_UNAVAILABLE');
    }
    return Object.freeze({ callerId, secret });
}

function createJti() {
    const randomUuid = globalThis.crypto?.randomUUID;
    if (typeof randomUuid !== 'function') fail('CRM_IDENTITY_DELIVERY_UNAVAILABLE');
    const jti = String(randomUuid.call(globalThis.crypto)).replaceAll('-', '');
    if (!JTI_PATTERN.test(jti)) fail('CRM_IDENTITY_DELIVERY_UNAVAILABLE');
    return jti;
}

function encodeBase64Url(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function requestAuthentication(secret, rawBody) {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle || typeof subtle.importKey !== 'function' || typeof subtle.sign !== 'function') fail('CRM_IDENTITY_DELIVERY_UNAVAILABLE');
    const key = await subtle.importKey('raw', TEXT_ENCODER.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await subtle.sign('HMAC', key, TEXT_ENCODER.encode(rawBody));
    return encodeBase64Url(new Uint8Array(signature));
}

function parseIssuerResponse(value) {
    assertExactKeys(value, ['ok', 'version', 'keyId', 'compact'], 'CRM_IDENTITY_DELIVERY_UNAVAILABLE');
    if (value.ok !== true
        || value.version !== 'identity-crm-delivery/v1'
        || typeof value.keyId !== 'string'
        || !KEY_ID_PATTERN.test(value.keyId)
        || typeof value.compact !== 'string'
        || value.compact.length > MAX_COMPACT_JWS_LENGTH
        || !COMPACT_JWS_PATTERN.test(value.compact)) {
        fail('CRM_IDENTITY_DELIVERY_UNAVAILABLE');
    }
    return value.compact;
}

export function isCrmSessionPath(request) {
    return new URL(request.url).pathname === CRM_SESSION_PATH;
}

export function isCrmSessionRequest(request) {
    const url = new URL(request.url);
    return request.method === 'GET' && url.pathname === CRM_SESSION_PATH && !url.search;
}

export function isCrmProjectionPath(request) {
    return new URL(request.url).pathname === CRM_PROJECTION_PATH;
}

function crmProjectionTarget(request) {
    const url = new URL(request.url);
    if (url.pathname !== CRM_PROJECTION_PATH) fail('CRM_PROJECTION_REQUEST_INVALID');
    const prefix = '?units=';
    if (!url.search.startsWith(prefix)) fail('CRM_PROJECTION_REQUEST_INVALID');
    const rawUnits = url.search.slice(prefix.length);
    if (rawUnits.length === 0 || rawUnits.length > MAX_PROJECTION_QUERY_BYTES) fail('CRM_PROJECTION_REQUEST_INVALID');
    const units = rawUnits.split(',');
    if (units.length === 0 || units.length > 64
        || units.some((unit) => unit !== unit.trim() || !isCanonicalUnitScope(unit))
        || new Set(units).size !== units.length) {
        fail('CRM_PROJECTION_REQUEST_INVALID');
    }
    const sorted = [...units].sort();
    if (sorted.some((unit, index) => unit !== units[index])) fail('CRM_PROJECTION_REQUEST_INVALID');
    const canonical = sorted.join(',');
    if (url.search !== `${prefix}${canonical}`) fail('CRM_PROJECTION_REQUEST_INVALID');
    return `${CRM_PROJECTION_TARGET}${prefix}${canonical}`;
}

export function isCrmProjectionRequest(request) {
    if (request.method !== 'GET' || !isCrmProjectionPath(request)) return false;
    try {
        crmProjectionTarget(request);
        return true;
    } catch {
        return false;
    }
}

export function crmProjectionRequestUnits(request) {
    if (!isCrmProjectionRequest(request)) fail('CRM_PROJECTION_REQUEST_INVALID');
    return Object.freeze(new URL(request.url).search.slice('?units='.length).split(','));
}

export function isCrmProjectionPreflightRequest(request) {
    if (request.method !== 'OPTIONS' || !isCrmProjectionPath(request)) return false;
    try {
        crmProjectionTarget(request);
        return true;
    } catch {
        return false;
    }
}

async function issueCrmIdentityDelivery(request, env, actor, target) {
    const caller = loadCallerConfiguration(env);
    const identity = trustedIdentityProjection(actor);
    const rawBody = JSON.stringify({
        identity,
        request: { method: 'GET', target, bodyBase64: '' },
        jti: createJti(),
    });
    const authorization = await requestAuthentication(caller.secret, rawBody);
    const issuerRequest = new Request(`${IDENTITY_ISSUER_ORIGIN}${IDENTITY_ISSUER_PATH}`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json; charset=utf-8',
            [IDENTITY_ISSUER_CALLER_HEADER]: caller.callerId,
            [IDENTITY_ISSUER_AUTH_HEADER]: authorization,
        },
        body: rawBody,
    });

    const response = await fetchBoundService(issuerRequest, env, IDENTITY_ISSUER_BINDING, { timeoutMs: ISSUE_TIMEOUT_MS });
    if (response.status !== 200) fail('CRM_IDENTITY_DELIVERY_UNAVAILABLE');
    try {
        return parseIssuerResponse(await response.json());
    } catch (error) {
        if (error instanceof TypeError && error.message === 'CRM_IDENTITY_DELIVERY_UNAVAILABLE') throw error;
        fail('CRM_IDENTITY_DELIVERY_UNAVAILABLE');
    }
}

/**
 * The public gateway is the only component that may resolve a browser
 * session. It turns the resulting server-owned actor into a minimal, signed
 * delivery envelope, then discards the browser credential before CRM Core is
 * called. This route is intentionally a GET-only session capability.
 */
export async function issueCrmSessionIdentityDelivery(request, env, actor) {
    if (!isCrmSessionRequest(request)) fail('CRM_SESSION_REQUEST_INVALID');
    return issueCrmIdentityDelivery(request, env, actor, CRM_SESSION_TARGET);
}

/**
 * Projection reads use the same private caller boundary as the session
 * capability, but bind the signed envelope to one explicit, sorted set of
 * canonical units. The browser never supplies an envelope or chooses an
 * alternate internal target spelling.
 */
export async function issueCrmProjectionIdentityDelivery(request, env, actor) {
    if (!isCrmProjectionRequest(request)) fail('CRM_PROJECTION_REQUEST_INVALID');
    const identity = trustedIdentityProjection(actor);
    if (crmProjectionRequestUnits(request).some((unit) => !identity.scopes.units.includes(unit))) {
        fail('CRM_PROJECTION_SCOPE_FORBIDDEN');
    }
    return issueCrmIdentityDelivery(request, env, identity, crmProjectionTarget(request));
}
