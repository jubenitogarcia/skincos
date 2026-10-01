import { createGatewayHandler } from './router.js';
import { csrfErrorFor, resolveCrmActor } from '../../shared/crm-auth/worker.js';
import { fetchBoundService } from '../../shared/service-adapters/cloudflare-service-binding.js';
import { createSignedDomainContext } from '../../shared/service-adapters/signed-domain-context.js';
import {
    authorizeCrmCoreProductionRoute,
    crmCoreVersionOverride,
    isAuthorizedCrmCoreProductionReceipt,
    isCrmCoreStagingEnvironment,
} from './crm-core-production-receipt.js';
import { isCrmSessionPath, isCrmSessionRequest, issueCrmSessionIdentityDelivery } from './crm-identity-issuer-client.js';

const gatewayError = (status, error) => new Response(JSON.stringify({ ok: false, error }), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const isOperationalProbe = (request) => request.method === 'GET' && ['/health', '/readiness'].includes(new URL(request.url).pathname);
const isPontoReadinessProbe = (request) => request.method === 'GET' && new URL(request.url).pathname === '/api/ponto/readiness';
const FINANCE_PROBE_TIMEOUT_MS = 3_000;
const FINANCE_READ_TIMEOUT_MS = 3_000;
const FINANCE_WRITE_TIMEOUT_MS = 5_000;
const CRM_CORE_TIMEOUT_MS = 3_000;
const CRM_IDENTITY_DELIVERY_HEADER_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const CRM_IDENTITY_DELIVERY_HEADER_MAX_LENGTH = 16_384;
const CRM_SESSION_STAGING_ORIGIN = 'https://crm-staging.skincos.com.br';
const CRM_SESSION_CORS_REQUEST_HEADERS = new Set(['accept', 'cache-control']);
const CRM_CORE_REQUEST_HEADER_ALLOWLIST = Object.freeze([
    'accept',
    'content-type',
    'origin',
    'x-request-id',
    'x-identity-delivery',
]);
// Inventory's authenticated routes traverse the service's rate-limiter
// Durable Object before reaching D1. Keep the normal budget bounded, but give
// the unified team route a separate budget because its readiness/config read
// intentionally checks several D1 tables before returning.
const INVENTORY_READ_TIMEOUT_MS = 3_000;
const INVENTORY_TEAM_TIMEOUT_MS = 8_000;
const CLOUDFLARE_VERSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NETWORK_CONTEXT_RE = /^v1:[A-Za-z0-9_-]{43}$/;
const B64URL_SHA256_RE = /^[A-Za-z0-9_-]{43}$/;

function crmSessionCorsHeaders(request, env) {
    if (!isCrmCoreStagingEnvironment(env)) return null;
    if (String(request.headers.get('origin') || '').trim() !== CRM_SESSION_STAGING_ORIGIN) return null;
    return {
        'access-control-allow-origin': CRM_SESSION_STAGING_ORIGIN,
        'access-control-allow-credentials': 'true',
        vary: 'Origin',
    };
}

function crmSessionOriginAllowed(request) {
    const origin = String(request.headers.get('origin') || '').trim();
    return !origin || origin === CRM_SESSION_STAGING_ORIGIN;
}

function withCrmSessionCors(response, request, env) {
    const cors = crmSessionCorsHeaders(request, env);
    if (!cors) return response;
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(cors)) {
        if (name !== 'vary') headers.set(name, value);
    }
    const vary = headers.get('vary');
    if (!vary) headers.set('vary', 'Origin');
    else if (!vary.split(',').some((value) => value.trim().toLowerCase() === 'origin')) {
        headers.set('vary', `${vary}, Origin`);
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function crmSessionError(request, env, status, error) {
    return withCrmSessionCors(gatewayError(status, error), request, env);
}

function crmSessionCorsPreflightAllowed(request) {
    const url = new URL(request.url);
    if (request.method !== 'OPTIONS' || url.pathname !== '/crm/session' || url.search) return false;
    if (String(request.headers.get('access-control-request-method') || '').trim().toUpperCase() !== 'GET') return false;
    const requestedHeaders = String(request.headers.get('access-control-request-headers') || '')
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
    return requestedHeaders.every((name) => CRM_SESSION_CORS_REQUEST_HEADERS.has(name));
}

function crmSessionPreflight(request, env) {
    const cors = crmSessionCorsHeaders(request, env);
    if (!cors) return gatewayError(403, 'CRM_SESSION_CORS_ORIGIN_NOT_ALLOWED');
    if (!crmSessionCorsPreflightAllowed(request)) return crmSessionError(request, env, 400, 'CRM_SESSION_CORS_PREFLIGHT_INVALID');
    return new Response(null, {
        status: 204,
        headers: {
            ...cors,
            'access-control-allow-methods': 'GET',
            'access-control-allow-headers': 'accept, cache-control',
            'access-control-max-age': '300',
            'cache-control': 'no-store',
        },
    });
}

function timekeepingServiceName(env) {
    return String(env?.ENVIRONMENT || '').trim().toLowerCase() === 'staging'
        ? 'skincos-timekeeping-staging'
        : 'skincos-timekeeping';
}

/**
 * The public request cannot select a Worker version. Pages may provide a
 * deterministic affinity key only as part of its signed Ponto envelope; every
 * version override is generated here from deployment-owned configuration.
 */
export function prepareTimekeepingRequest(request, env) {
    const headers = new Headers(request.headers);
    const requestedAffinity = String(headers.get('cloudflare-workers-version-key') || '').trim();
    const networkContext = String(headers.get('x-skincos-network-context') || '').trim();
    const hasSignedNetworkEnvelope =
        NETWORK_CONTEXT_RE.test(networkContext)
        && requestedAffinity === networkContext
        && /^\d{13}$/.test(String(headers.get('x-skincos-network-ts') || '').trim())
        && B64URL_SHA256_RE.test(String(headers.get('x-skincos-network-sig') || '').trim())
        && String(headers.get('x-skincos-network-signature-version') || '').trim() === '2'
        && Boolean(String(headers.get('x-skincos-actor') || '').trim())
        && B64URL_SHA256_RE.test(String(headers.get('x-skincos-actor-sig') || '').trim());

    headers.delete('cloudflare-workers-version-key');
    headers.delete('cloudflare-workers-version-overrides');
    headers.delete('x-skincos-gateway-release-sha');
    headers.delete('x-skincos-gateway-environment');

    if (hasSignedNetworkEnvelope) {
        headers.set('cloudflare-workers-version-key', networkContext);
    }

    const releaseSha = String(env?.APP_VERSION || 'unknown').trim().toLowerCase();
    const environment = String(env?.ENVIRONMENT || 'production').trim().toLowerCase();
    const gatewayVersionId = String(env?.CF_VERSION_METADATA?.id || '').trim();
    headers.set('x-skincos-gateway-release-sha', releaseSha);
    headers.set('x-skincos-gateway-environment', environment);
    if (CLOUDFLARE_VERSION_ID_RE.test(gatewayVersionId)) {
        headers.set('x-skincos-gateway-version-id', gatewayVersionId);
    } else {
        headers.delete('x-skincos-gateway-version-id');
    }

    const downstreamVersionId = String(env?.TIMEKEEPING_VERSION_ID || '').trim();
    if (CLOUDFLARE_VERSION_ID_RE.test(downstreamVersionId)) {
        headers.set(
            'cloudflare-workers-version-overrides',
            `${timekeepingServiceName(env)}="${downstreamVersionId}"`,
        );
    }

    return new Request(request, { headers });
}

function financeServiceTimeout(request) {
    // State-changing Finance routes carry mandatory idempotency keys. Give
    // write methods a wider, still-bounded D1 cold-start window so a committed
    // operation is not converted into a fabricated gateway 503. Reads retain
    // the tighter deadline and every real upstream 5xx still fails closed.
    return ['GET', 'HEAD'].includes(request.method) ? FINANCE_READ_TIMEOUT_MS : FINANCE_WRITE_TIMEOUT_MS;
}

function inventoryServiceTimeout(request) {
    const pathname = new URL(request.url).pathname;
    return pathname === '/admin/team' || pathname.startsWith('/admin/team/')
        ? INVENTORY_TEAM_TIMEOUT_MS
        : INVENTORY_READ_TIMEOUT_MS;
}

function isProductionEnvironment(env) {
    return String(env?.ENVIRONMENT || '').trim().toLowerCase() === 'production';
}

/**
 * This is a fresh allowlist, never a mutation of public request headers.
 * CRM Core needs only browser representation/CORS metadata, correlation and
 * a delivery envelope that the gateway itself obtained over its private
 * Identity binding. In particular, no browser-supplied envelope, legacy
 * session, service token, proxy, Cloudflare or future credential-shaped header
 * can cross this boundary. For the staging session capability, a fresh
 * internally issued envelope replaces any browser-supplied value.
 */
export function prepareCrmCoreRequest(request, productionReceipt = null, env = null, identityDelivery = null) {
    const headers = new Headers();
    for (const name of CRM_CORE_REQUEST_HEADER_ALLOWLIST) {
        const value = request.headers.get(name);
        if (value !== null) headers.set(name, value);
    }
    if (isCrmCoreStagingEnvironment(env) || identityDelivery !== null) headers.delete('x-identity-delivery');
    if (productionReceipt) {
        headers.set('cloudflare-workers-version-overrides', crmCoreVersionOverride(productionReceipt, env));
    }
    if (typeof identityDelivery === 'string'
        && identityDelivery.length <= CRM_IDENTITY_DELIVERY_HEADER_MAX_LENGTH
        && CRM_IDENTITY_DELIVERY_HEADER_PATTERN.test(identityDelivery)) {
        headers.set('x-identity-delivery', identityDelivery);
    }
    return new Request(request, { headers });
}

function crmCoreForwardContext(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)
        && Object.prototype.hasOwnProperty.call(value, 'identityDelivery')) {
        return { productionReceipt: null, identityDelivery: value.identityDelivery };
    }
    return { productionReceipt: value, identityDelivery: null };
}

export async function forwardCrmCoreToService(request, env, ctx, authorizedProductionReceipt = null) {
    const { productionReceipt: suppliedProductionReceipt, identityDelivery } = crmCoreForwardContext(authorizedProductionReceipt);
    const staging = isCrmCoreStagingEnvironment(env);
    if (!staging && identityDelivery !== null) return gatewayError(404, 'CRM_CORE_STAGING_ONLY');
    let productionReceipt = staging ? null : suppliedProductionReceipt;
    if (!staging && !isAuthorizedCrmCoreProductionReceipt(productionReceipt, env)) {
        productionReceipt = await authorizeCrmCoreProductionRoute(request, env);
    }
    if (!staging && !productionReceipt) {
        return gatewayError(404, isProductionEnvironment(env) ? 'CRM_CORE_PRODUCTION_NOT_AUTHORIZED' : 'CRM_CORE_STAGING_ONLY');
    }
    return fetchBoundService(prepareCrmCoreRequest(request, productionReceipt, env, identityDelivery), env, 'CRM_CORE', {
        timeoutMs: CRM_CORE_TIMEOUT_MS,
    });
}

export async function forwardFinanceProbe(request, env) {
    // This route is read-only and is itself evaluated by the external monitor's
    // latency budget. Keep the service-binding deadline above that budget so a
    // slow response is reported as degraded latency instead of a fabricated 503.
    return fetchBoundService(request, env, 'FINANCE', { timeoutMs: FINANCE_PROBE_TIMEOUT_MS });
}

export async function forwardFinanceToService(request, env, ctx, auth) {
    const secret = String(env?.FINANCE_SERVICE_AUTH_SECRET || '').trim();
    if (!secret) return gatewayError(503, 'FINANCE_SERVICE_IDENTITY_UNAVAILABLE');
    const headers = new Headers(request.headers);
    headers.delete('cookie');
    headers.delete('x-csrf-token');
    try {
        const signed = await createSignedDomainContext({ actor: auth.actor, csrf: auth.csrf, requestId: request.headers.get('x-request-id') }, secret, 'finance');
        for (const [name, value] of Object.entries(signed)) headers.set(name, value);
        return fetchBoundService(new Request(request, { headers }), env, 'FINANCE', { timeoutMs: financeServiceTimeout(request) });
    } catch {
        return gatewayError(503, 'FINANCE_SERVICE_UNAVAILABLE');
    }
}

/**
 * The gateway owns only the cross-domain envelope: session authentication,
 * CSRF, correlation and the signed service hand-off. Finance owns every
 * domain decision (including scope, availability, maintenance and throttling).
 */
export function createApiGateway({
    inventoryHandler,
    timekeepingHandler,
    financeDomainHandler = forwardFinanceToService,
    crmCoreHandler = forwardCrmCoreToService,
    resolveActor = resolveCrmActor,
} = {}) {
    if (typeof inventoryHandler !== 'function') throw new TypeError('inventoryHandler is required');
    return createGatewayHandler({
        inventoryHandler,
        timekeepingHandler: typeof timekeepingHandler === 'function'
            ? (request, env, ctx) => timekeepingHandler(prepareTimekeepingRequest(request, env), env, ctx)
            : undefined,
        financeHandler: async (request, env, ctx) => {
            // Health and readiness contain no actor or financial data. They stay
            // available to external monitors while every domain operation uses
            // the signed authenticated envelope below.
            if (isOperationalProbe(request)) return forwardFinanceProbe(request, env);
            let auth;
            try {
                auth = await resolveActor(request, env);
            } catch {
                // Identity is required only for the authenticated Finance
                // capability. Contain an unexpected resolver failure here so
                // the gateway, Inventory and Workforce mounts remain usable.
                return gatewayError(503, 'IDENTITY_UNAVAILABLE');
            }
            if (auth?.unavailable) return gatewayError(503, 'IDENTITY_UNAVAILABLE');
            const csrfError = csrfErrorFor(request, auth.csrf);
            if (csrfError) return csrfError;
            return financeDomainHandler(request, env, ctx, auth);
        },
        crmCoreHandler: typeof crmCoreHandler === 'function'
            ? async (request, env, ctx, productionReceipt = null) => {
                if (!isCrmSessionPath(request)) return crmCoreHandler(request, env, ctx, productionReceipt);
                if (!isCrmCoreStagingEnvironment(env)) return gatewayError(404, 'CRM_CORE_STAGING_ONLY');
                if (!crmSessionOriginAllowed(request)) return gatewayError(403, 'CRM_SESSION_CORS_ORIGIN_NOT_ALLOWED');
                if (request.method === 'OPTIONS') return crmSessionPreflight(request, env);
                if (!isCrmSessionRequest(request)) {
                    return request.method === 'GET'
                        ? crmSessionError(request, env, 400, 'CRM_SESSION_QUERY_NOT_ALLOWED')
                        : crmSessionError(request, env, 405, 'CRM_SESSION_METHOD_NOT_ALLOWED');
                }
                let auth;
                try {
                    auth = await resolveActor(request, env);
                } catch {
                    return crmSessionError(request, env, 503, 'IDENTITY_UNAVAILABLE');
                }
                if (auth?.unavailable) return crmSessionError(request, env, 503, 'IDENTITY_UNAVAILABLE');
                if (!auth?.actor) return crmSessionError(request, env, 401, 'CRM_IDENTITY_REQUIRED');
                try {
                    const identityDelivery = await issueCrmSessionIdentityDelivery(request, env, auth.actor);
                    return withCrmSessionCors(await crmCoreHandler(request, env, ctx, { identityDelivery }), request, env);
                } catch (error) {
                    if (error instanceof TypeError && error.message === 'CRM_IDENTITY_SUBJECT_REQUIRED') {
                        return crmSessionError(request, env, 403, 'CRM_IDENTITY_SUBJECT_REQUIRED');
                    }
                    return crmSessionError(request, env, 503, 'CRM_IDENTITY_DELIVERY_UNAVAILABLE');
                }
            }
            : undefined,
    });
}

export { createGatewayHandler } from './router.js';

export const handleGatewayRequest = createApiGateway({
    inventoryHandler: (request, env) => fetchBoundService(request, env, 'INVENTORY', { timeoutMs: inventoryServiceTimeout(request) }),
    timekeepingHandler: (request, env) => fetchBoundService(request, env, 'TIMEKEEPING', {
        timeoutMs: 800,
        // A failed Ponto readiness probe is often the authoritative
        // maintenance contract. Preserve that body and its release identity
        // instead of replacing it with the generic dependency fallback.
        passThroughErrorStatuses: isPontoReadinessProbe(request) ? [503] : [],
    }),
    financeDomainHandler: forwardFinanceToService,
    crmCoreHandler: forwardCrmCoreToService,
});
