import { resolveCrmCoreProductionRouteReceipt } from './crm-identity-issuer-client.js';

const RECEIPT_CONTRACT = 'skincos-crm/production-route-receipt/v1';
const CRM_CORE_SERVICE = 'skincos-crm-core';
const CRM_IDENTITY_ISSUER_SERVICE = 'skincos-identity-crm-delivery-production';
const RECEIPT_KEY_PREFIX = 'crm-production-route-receipt-';
const VERSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RELEASE_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const KEY_ID_RE = /^[A-Za-z0-9._-]{3,96}$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const RECEIPT_KEYS = Object.freeze([
    'contract',
    'receiptId',
    'environment',
    'gatewayVersionId',
    'service',
    'workerVersionId',
    'identityWorkerVersionId',
    'release',
    'artifactDigest',
    'keyId',
    'signature',
]);
const TEXT_ENCODER = new TextEncoder();
const CRM_CORE_PROBE_TIMEOUT_MS = 3_000;
const authorizedReceipts = new WeakMap();

function exactRecord(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
        return null;
    }
    return value;
}

function parseJson(value, maxLength = 16 * 1024) {
    if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) return null;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function normalizedText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeReceipt(value) {
    const record = exactRecord(value, RECEIPT_KEYS);
    if (!record) return null;

    const receiptId = normalizedText(record.receiptId);
    const gatewayVersionId = normalizedText(record.gatewayVersionId).toLowerCase();
    const workerVersionId = normalizedText(record.workerVersionId).toLowerCase();
    const identityWorkerVersionId = normalizedText(record.identityWorkerVersionId).toLowerCase();
    const release = normalizedText(record.release).toLowerCase();
    const artifactDigest = normalizedText(record.artifactDigest).toLowerCase();
    const keyId = normalizedText(record.keyId);
    const signature = normalizedText(record.signature);
    if (record.contract !== RECEIPT_CONTRACT
        || record.environment !== 'production'
        || record.service !== CRM_CORE_SERVICE
        || !/^[A-Za-z0-9._:-]{8,200}$/.test(receiptId)
        || !VERSION_ID_RE.test(gatewayVersionId)
        || !VERSION_ID_RE.test(workerVersionId)
        || !VERSION_ID_RE.test(identityWorkerVersionId)
        || !RELEASE_RE.test(release)
        || !DIGEST_RE.test(artifactDigest)
        || !KEY_ID_RE.test(keyId)
        || !keyId.startsWith(RECEIPT_KEY_PREFIX)
        || !BASE64URL_RE.test(signature)) {
        return null;
    }
    return Object.freeze({
        contract: RECEIPT_CONTRACT,
        receiptId,
        environment: 'production',
        gatewayVersionId,
        service: CRM_CORE_SERVICE,
        workerVersionId,
        identityWorkerVersionId,
        release,
        artifactDigest,
        keyId,
        signature,
    });
}

function normalizePublicKeys(value) {
    const record = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    if (!record) return null;
    const entries = Object.entries(record);
    if (entries.length === 0 || entries.length > 8) return null;
    const keys = new Map();
    for (const [keyId, key] of entries) {
        if (!KEY_ID_RE.test(keyId) || !keyId.startsWith(RECEIPT_KEY_PREFIX)
            || !key || typeof key !== 'object' || Array.isArray(key)
            || Object.hasOwn(key, 'd') || key.kty !== 'OKP' || key.crv !== 'Ed25519'
            || typeof key.x !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(key.x)) {
            return null;
        }
        keys.set(keyId, Object.freeze({ ...key }));
    }
    return keys;
}

function signatureBytes(value) {
    if (typeof globalThis.atob !== 'function' || !BASE64URL_RE.test(value)) return null;
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
    try {
        return Uint8Array.from(globalThis.atob(padded), (character) => character.charCodeAt(0));
    } catch {
        return null;
    }
}

/**
 * The signed receipt binds the production gateway, Core, and private Identity
 * issuer versions to the Core artifact identity. It is deliberately not a set
 * of independently switchable regex-shaped variables.
 */
export function createCrmCoreProductionReceiptSigningInput(receipt) {
    const normalized = normalizeReceipt(receipt);
    if (!normalized) throw new TypeError('CRM_CORE_PRODUCTION_RECEIPT_INVALID');
    return [
        normalized.contract,
        normalized.receiptId,
        normalized.environment,
        normalized.gatewayVersionId,
        normalized.service,
        normalized.workerVersionId,
        normalized.identityWorkerVersionId,
        normalized.release,
        normalized.artifactDigest,
        normalized.keyId,
    ].join('\n');
}

async function verifiesReceiptSignature(receipt, publicKeys) {
    const key = publicKeys.get(receipt.keyId);
    const signature = signatureBytes(receipt.signature);
    const subtle = globalThis.crypto?.subtle;
    if (!key || !signature || !subtle?.importKey || !subtle?.verify) return false;
    try {
        const publicKey = await subtle.importKey('jwk', key, { name: 'Ed25519' }, false, ['verify']);
        return await subtle.verify(
            { name: 'Ed25519' },
            publicKey,
            signature,
            TEXT_ENCODER.encode(createCrmCoreProductionReceiptSigningInput(receipt)),
        ) === true;
    } catch {
        return false;
    }
}

async function receiptFromEnvironment(env) {
    if (String(env?.ENVIRONMENT || '').trim().toLowerCase() !== 'production'
        || String(env?.CRM_CORE_PRODUCTION_ENABLED || '').trim() !== 'true') {
        return null;
    }
    const publicKeys = normalizePublicKeys(parseJson(env?.CRM_CORE_PRODUCTION_RECEIPT_PUBLIC_KEYS_JSON));
    const gatewayVersionId = normalizedText(env?.CF_VERSION_METADATA?.id).toLowerCase();
    if (!publicKeys || !VERSION_ID_RE.test(gatewayVersionId)) {
        return null;
    }
    let rawReceipt;
    try {
        // The receipt is deliberately read from the private Identity service,
        // not from a value bound into the same API version it must authorize.
        // Do not cache this response: withdrawing it is the immediate
        // fail-closed rollback for the production CRM route.
        rawReceipt = await resolveCrmCoreProductionRouteReceipt(env, gatewayVersionId);
    } catch {
        return null;
    }
    const receipt = normalizeReceipt(parseJson(rawReceipt));
    if (!receipt || receipt.gatewayVersionId !== gatewayVersionId) return null;
    return { receipt, publicKeys };
}

function probeRequest(request, receipt) {
    const url = new URL(request.url);
    url.pathname = '/ready';
    url.search = '';
    const suppliedRequestId = normalizedText(request.headers.get('x-request-id'));
    const requestId = /^[A-Za-z0-9._:-]{1,96}$/.test(suppliedRequestId)
        ? `${suppliedRequestId}.crm-receipt`
        : 'crm-production-receipt-probe';
    return new Request(url.toString(), {
        method: 'GET',
        headers: {
            accept: 'application/json',
            'x-request-id': requestId.slice(0, 120),
            'cloudflare-workers-version-overrides': `${receipt.service}="${receipt.workerVersionId}"`,
        },
    });
}

async function fetchProbe(binding, request) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CRM_CORE_PROBE_TIMEOUT_MS);
    try {
        return await binding.fetch(new Request(request, { signal: controller.signal }));
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function provesReceiptTarget(request, env, receipt) {
    const binding = env?.CRM_CORE;
    if (!binding || typeof binding.fetch !== 'function') return false;
    const response = await fetchProbe(binding, probeRequest(request, receipt));
    if (!response || !response.ok) {
        if (response?.body) await response.body.cancel().catch(() => {});
        return false;
    }
    let body;
    try {
        body = await response.json();
    } catch {
        return false;
    }
    return body?.ok === true
        && body?.ready === true
        && body?.unit === 'crm-core'
        && body?.environment === 'production'
        && String(body?.release || '').trim().toLowerCase() === receipt.release
        && String(body?.version || '').trim().toLowerCase() === receipt.release
        && String(body?.artifact_digest || '').trim().toLowerCase() === receipt.artifactDigest
        && String(body?.artifactDigest || '').trim().toLowerCase() === receipt.artifactDigest;
}

/**
 * Resolves a custody-signed receipt through private Identity, verifies it
 * locally, pins the Core service fetch to its immutable Worker version, and
 * proves the pinned target's ready identity.
 */
export async function authorizeCrmCoreProductionRoute(request, env) {
    const configured = await receiptFromEnvironment(env);
    if (!configured || !await verifiesReceiptSignature(configured.receipt, configured.publicKeys)) return null;
    if (!await provesReceiptTarget(request, env, configured.receipt)) return null;
    authorizedReceipts.set(configured.receipt, env);
    return configured.receipt;
}

export function isCrmCoreStagingEnvironment(env) {
    return String(env?.ENVIRONMENT || '').trim().toLowerCase() === 'staging';
}

export function isAuthorizedCrmCoreProductionReceipt(receipt, env) {
    return Boolean(receipt && typeof receipt === 'object' && authorizedReceipts.get(receipt) === env);
}

/** A fresh header set ensures a browser cannot select the bound Worker version. */
export function crmCoreVersionOverride(receipt, env) {
    if (!isAuthorizedCrmCoreProductionReceipt(receipt, env)
        || receipt.service !== CRM_CORE_SERVICE || !VERSION_ID_RE.test(receipt.workerVersionId)) {
        throw new TypeError('CRM_CORE_PRODUCTION_RECEIPT_INVALID');
    }
    return `${receipt.service}="${receipt.workerVersionId}"`;
}

/**
 * The Identity receipt resolver is intentionally unpinned because it is only
 * a delivery channel for an externally signed receipt. Every identity
 * envelope issued after authorization is pinned to this exact receipt-bound
 * Identity Worker version instead.
 */
export function crmIdentityIssuerVersionOverride(receipt, env) {
    if (!isAuthorizedCrmCoreProductionReceipt(receipt, env)
        || !VERSION_ID_RE.test(receipt.identityWorkerVersionId)) {
        throw new TypeError('CRM_CORE_PRODUCTION_RECEIPT_INVALID');
    }
    return `${CRM_IDENTITY_ISSUER_SERVICE}="${receipt.identityWorkerVersionId}"`;
}
