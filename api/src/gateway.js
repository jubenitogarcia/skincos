import { createGatewayHandler } from './router.js';
import { csrfErrorFor, resolveCrmActor } from '../../shared/crm-auth/worker.js';
import { fetchBoundService } from '../../shared/service-adapters/cloudflare-service-binding.js';
import { createSignedDomainContext } from '../../shared/service-adapters/signed-domain-context.js';

const gatewayError = (status, error) => new Response(JSON.stringify({ ok: false, error }), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const isOperationalProbe = (request) => request.method === 'GET' && ['/health', '/readiness'].includes(new URL(request.url).pathname);
const FINANCE_PROBE_TIMEOUT_MS = 3_000;
const FINANCE_AUDIT_READ_TIMEOUT_MS = 3_000;

function financeServiceTimeout(request) {
    // Audit is an authenticated, read-only, paginated D1 query.  It must have
    // the same bounded observation window as health/readiness so a legitimate
    // slow audit lookup is not turned into a fabricated gateway 503.  Writes
    // and all other Finance routes retain the short 800 ms dependency budget.
    return request.method === 'GET' && new URL(request.url).pathname === '/audit'
        ? FINANCE_AUDIT_READ_TIMEOUT_MS
        : 800;
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
        timekeepingHandler,
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
    inventoryHandler: (request, env) => fetchBoundService(request, env, 'INVENTORY', { timeoutMs: 800 }),
    timekeepingHandler: (request, env) => fetchBoundService(request, env, 'TIMEKEEPING', { timeoutMs: 800 }),
    financeDomainHandler: forwardFinanceToService,
});
