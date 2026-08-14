import { createGatewayHandler } from '../src/router.js';
import { prepareTimekeepingRequest } from '../src/gateway.js';
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

const TIMEKEEPING_READ_TIMEOUT_MS = 3_000;
const TIMEKEEPING_WRITE_TIMEOUT_MS = 5_000;

function timekeepingTimeout(request) {
    return ['GET', 'HEAD'].includes(request.method)
        ? TIMEKEEPING_READ_TIMEOUT_MS
        : TIMEKEEPING_WRITE_TIMEOUT_MS;
}

function isPontoReadiness(request) {
    return request.method === 'GET' && new URL(request.url).pathname === '/api/ponto/readiness';
}

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
    timekeepingHandler: (request, env) => fetchBoundService(
        prepareTimekeepingRequest(request, env),
        env,
        'TIMEKEEPING',
        {
            timeoutMs: timekeepingTimeout(request),
            // A 503 from the Timekeeping readiness route is the authoritative
            // fail-closed Ponto contract, not a transport outage. Preserve its
            // release identity, dependencies and maintenance reason end-to-end.
            passThroughErrorStatuses: isPontoReadiness(request) ? [503] : [],
        },
    ),
});

export default {
    fetch(request, env, ctx) {
        if (String(env?.PONTO_ROUTE_ONLY || '').trim() !== 'true') {
            return invalidConfiguration();
        }
        return handlePontoCoreRequest(request, env, ctx);
    },
};
