import inventoryWorker from '../../inventory/src/worker.js';
import { createGatewayHandler } from './router.js';
import { createFinanceHandler } from '../../finance/api/worker.js';
import { csrfErrorFor, resolveCrmActor } from '../../shared/crm-auth/worker.js';

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

export { createGatewayHandler } from './router.js';

export const handleGatewayRequest = createGatewayHandler({
    inventoryHandler: inventoryWorker.fetch.bind(inventoryWorker),
    financeHandler: async (request, env, ctx) => {
        const auth = await resolveFinanceActor(request, env);
        const csrfError = csrfErrorFor(request, auth.csrf);
        if (csrfError) return csrfError;
        return createFinanceHandler()(request, env, ctx, auth);
    },
});
