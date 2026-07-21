import inventoryWorker from '../../inventory/src/worker.js';
import { createGatewayHandler } from './router.js';
import { createFinanceHandler } from '../../finance/api/worker.js';
import { d1GetUserByUsername } from '../../inventory/src/d1Store.js';
import { csrfErrorFor, resolveCrmActor } from '../../shared/crm-auth/worker.js';

function isLoopbackRequest(request) {
    try {
        const host = new URL(request.url).hostname;
        return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
    } catch { return false; }
}

async function resolveFinanceActor(request, env) {
    const auth = await resolveCrmActor(request, env);
    if (auth.actor || String(env?.LOCAL_FINANCE_AUTH_BYPASS || '') !== 'true' || !isLoopbackRequest(request)) return auth;
    const username = String(request.headers.get('x-skincos-local-finance-actor') || '').trim();
    const csrf = String(env?.LOCAL_FINANCE_CSRF_TOKEN || '').trim();
    if (!username || !csrf) return auth;
    const actor = await d1GetUserByUsername(env, username);
    return actor?.ativo ? { actor: { ...actor, role: String(actor.role || 'CONSULTOR').toUpperCase() }, csrf } : auth;
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
