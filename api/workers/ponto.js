import { createGatewayHandler } from '../src/router.js';
import { fetchBoundService } from '../../shared/service-adapters/cloudflare-service-binding.js';

const invalidConfiguration = () => new Response(
    JSON.stringify({ ok: false, error: 'PONTO_CORE_CONFIG_INVALID' }),
    {
        status: 503,
        headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
        },
    },
);

const handlePontoCoreRequest = createGatewayHandler({
    // The route-only guard makes this handler unreachable. Keeping an explicit
    // fail-closed implementation also prevents a future router refactor from
    // silently restoring an Inventory surface in this dedicated bundle.
    inventoryHandler: async () => new Response(
        JSON.stringify({ ok: false, error: 'ponto_route_only' }),
        {
            status: 404,
            headers: {
                'content-type': 'application/json; charset=utf-8',
                'cache-control': 'no-store',
            },
        },
    ),
    timekeepingHandler: (request, env) => fetchBoundService(request, env, 'TIMEKEEPING', { timeoutMs: 800 }),
});

export default {
    fetch(request, env, ctx) {
        if (String(env?.PONTO_ROUTE_ONLY || '').trim() !== 'true') {
            return invalidConfiguration();
        }
        return handlePontoCoreRequest(request, env, ctx);
    },
};
