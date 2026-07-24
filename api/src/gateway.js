import { createGatewayHandler } from './router.js';
import { csrfErrorFor, resolveCrmActor } from '../../shared/crm-auth/worker.js';
import { fetchBoundService } from '../../shared/service-adapters/cloudflare-service-binding.js';
import { createSignedDomainContext } from '../../shared/service-adapters/signed-domain-context.js';

const financeRateLimitResponse = (status, error) => new Response(JSON.stringify({ ok: false, error }), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const digest = async (value) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map((item) => item.toString(16).padStart(2, '0')).join('');

async function resolveFinanceActor(request, env) {
    const auth = await resolveCrmActor(request, env);
    // This bypass exists only when the private runner injects its local-only
    // Worker binding. Production configuration never defines that binding.
    if (auth.actor || String(env?.LOCAL_FINANCE_AUTH_BYPASS || '') !== 'true') return auth;
    const username = String(request.headers.get('x-skincos-local-finance-actor') || env?.LOCAL_FINANCE_ACTOR || '').trim();
    const csrf = String(env?.LOCAL_FINANCE_CSRF_TOKEN || request.headers.get('x-csrf-token') || 'local-loopback-csrf').trim();
    if (!username || !csrf) return auth;
    const allowedModules = String(request.headers.get('x-skincos-local-finance-modules') || env?.LOCAL_FINANCE_ALLOWED_MODULES || '').split(',').map((value) => value.trim()).filter(Boolean);
    return { actor: { username, role: String(env?.LOCAL_FINANCE_ACTOR_ROLE || 'GESTOR').toUpperCase(), allowedModules }, csrf };
}

export async function enforceFinanceRateLimit(request, env, actor) {
    // The production gateway binds RATE_LIMITER as a Durable Object. Local tests
    // intentionally omit it; production must keep the binding declared in
    // api/wrangler.toml before Finance is enabled.
    if (!env?.RATE_LIMITER) return null;
    const path = new URL(request.url).pathname;
    const write = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method.toUpperCase());
    const importWrite = write && path.startsWith('/imports');
    const limit = importWrite ? 12 : write ? 60 : 240;
    const bucket = importWrite ? 'import' : write ? 'write' : 'read';
    const remote = String(request.headers.get('cf-connecting-ip') || '').trim();
    const actorKey = String(actor?.username || 'anonymous').trim();
    const identity = await digest(`finance:${actorKey}:${remote || 'no-ip'}`);
    try {
        const id = env.RATE_LIMITER.idFromName(`finance:${identity}`);
        const response = await env.RATE_LIMITER.get(id).fetch(`https://rate-limiter/?key=finance:${bucket}&limit=${limit}&window=60`);
        const result = await response.json().catch(() => null);
        if (!response.ok || !result || typeof result.allowed !== 'boolean') return financeRateLimitResponse(503, 'FINANCE_RATE_LIMIT_UNAVAILABLE');
        if (!result.allowed) return financeRateLimitResponse(429, 'FINANCE_RATE_LIMITED');
        return null;
    } catch {
        // Finance writes fail closed when the configured distributed limiter is
        // unhealthy; a degraded limiter must not turn into an import flood.
        return financeRateLimitResponse(503, 'FINANCE_RATE_LIMIT_UNAVAILABLE');
    }
}

export async function forwardFinanceToService(request, env, ctx, auth) {
    const secret = String(env?.FINANCE_SERVICE_AUTH_SECRET || '').trim();
    if (!secret) return financeRateLimitResponse(503, 'FINANCE_SERVICE_IDENTITY_UNAVAILABLE');
    const headers = new Headers(request.headers);
    headers.delete('cookie');
    headers.delete('x-csrf-token');
    try {
        const signed = await createSignedDomainContext({ actor: auth.actor, csrf: auth.csrf, requestId: request.headers.get('x-request-id') }, secret, 'finance');
        for (const [name, value] of Object.entries(signed)) headers.set(name, value);
        return fetchBoundService(new Request(request, { headers }), env, 'FINANCE', { timeoutMs: 800 });
    } catch {
        return financeRateLimitResponse(503, 'FINANCE_SERVICE_UNAVAILABLE');
    }
}

export function createApiGateway({ inventoryHandler, timekeepingHandler, financeDomainHandler = forwardFinanceToService, resolveActor = resolveFinanceActor, rateLimit = enforceFinanceRateLimit } = {}) {
    if (typeof inventoryHandler !== 'function') throw new TypeError('inventoryHandler is required');
    return createGatewayHandler({
        inventoryHandler,
        timekeepingHandler,
        financeHandler: async (request, env, ctx) => {
            let auth;
            try {
                auth = await resolveActor(request, env);
            } catch {
                // Identity is required only for the authenticated Finance
                // capability. Contain an unexpected resolver failure here so
                // the gateway, Inventory and Workforce mounts remain usable.
                return financeRateLimitResponse(503, 'IDENTITY_UNAVAILABLE');
            }
            if (auth?.unavailable) return financeRateLimitResponse(503, 'IDENTITY_UNAVAILABLE');
            const csrfError = csrfErrorFor(request, auth.csrf);
            if (csrfError) return csrfError;
            const rateLimitError = await rateLimit(request, env, auth.actor);
            if (rateLimitError) return rateLimitError;
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
