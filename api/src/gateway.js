import { createGatewayHandler } from './router.js';
import { csrfErrorFor, resolveCrmActor } from '../../shared/crm-auth/worker.js';
import { fetchBoundService } from '../../shared/service-adapters/cloudflare-service-binding.js';
import { createSignedDomainContext } from '../../shared/service-adapters/signed-domain-context.js';

const gatewayError = (status, error) => new Response(JSON.stringify({ ok: false, error }), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const isOperationalProbe = (request) => request.method === 'GET' && ['/health', '/readiness'].includes(new URL(request.url).pathname);
const FINANCE_PROBE_TIMEOUT_MS = 3_000;
const FINANCE_READ_TIMEOUT_MS = 3_000;
const FINANCE_WRITE_TIMEOUT_MS = 5_000;
// Inventory's authenticated routes traverse the service's rate-limiter
// Durable Object before reaching D1. Keep this bounded, but above the public
// probe budget so normal cold-start latency is not turned into a fabricated
// 503 by the Core gateway.
const INVENTORY_READ_TIMEOUT_MS = 3_000;
const CLOUDFLARE_VERSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NETWORK_CONTEXT_RE = /^v1:[A-Za-z0-9_-]{43}$/;
const B64URL_SHA256_RE = /^[A-Za-z0-9_-]{43}$/;

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
export function createApiGateway({ inventoryHandler, timekeepingHandler, financeDomainHandler = forwardFinanceToService, resolveActor = resolveCrmActor } = {}) {
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
    });
}

export { createGatewayHandler } from './router.js';

export const handleGatewayRequest = createApiGateway({
    inventoryHandler: (request, env) => fetchBoundService(request, env, 'INVENTORY', { timeoutMs: INVENTORY_READ_TIMEOUT_MS }),
    timekeepingHandler: (request, env) => fetchBoundService(request, env, 'TIMEKEEPING', { timeoutMs: 800 }),
    financeDomainHandler: forwardFinanceToService,
});
