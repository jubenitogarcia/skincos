import inventoryWorker from '../../inventory/src/worker.js';
import { createGatewayHandler } from './router.js';
import { createFinanceHandler } from '../../finance/api/worker.js';
import { csrfErrorFor, resolveCrmActor } from '../../shared/crm-auth/worker.js';

export { createGatewayHandler } from './router.js';

export const handleGatewayRequest = createGatewayHandler({
    inventoryHandler: inventoryWorker.fetch.bind(inventoryWorker),
    timekeepingHandler: async (request, env) => {
        if (!env.TIMEKEEPING?.fetch) {
            return new Response(JSON.stringify({ ok: false, error: 'workforce_unavailable' }), {
                status: 503,
                headers: { 'content-type': 'application/json; charset=utf-8' },
            });
        }
        return env.TIMEKEEPING.fetch(request);
    },
    financeHandler: async (request, env, ctx) => {
        const auth = await resolveCrmActor(request, env);
        const csrfError = csrfErrorFor(request, auth.csrf);
        if (csrfError) return csrfError;
        return createFinanceHandler()(request, env, ctx, auth);
    },
});
