const json = (status, payload, requestId) =>
    new Response(JSON.stringify(payload), {
        status,
        headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
            'x-request-id': requestId,
        },
    });

function requestIdFor(request) {
    return String(request.headers.get('x-request-id') || request.headers.get('cf-ray') || crypto.randomUUID()).trim();
}

function mountedRequest(request, mount) {
    const url = new URL(request.url);
    url.pathname = url.pathname.slice(mount.length) || '/';
    return new Request(url.toString(), request);
}

function isInternalServiceRequest(request, env) {
    const expected = String(env.INTERNAL_API_TOKEN || '').trim();
    if (!expected) return false;
    const received = String(request.headers.get('x-skincos-service-token') || '').trim();
    return received.length === expected.length && received === expected;
}

function operationalPayload(env, requestId, ready, dependencies) {
    return {
        ok: Boolean(ready),
        service: 'api',
        unit: 'api',
        version: String(env.APP_VERSION || 'unknown'),
        environment: String(env.ENVIRONMENT || 'production'),
        ready: Boolean(ready),
        dependencies,
        request_id: requestId,
        // Legacy compatibility while consumers move to the snake_case contract.
        requestId,
    };
}

function operationalLog(env, requestId, status, route) {
    console.log({
        domain: 'api',
        version: String(env.APP_VERSION || 'unknown'),
        environment: String(env.ENVIRONMENT || 'production'),
        request_id: requestId,
        duration_ms: 0,
        status,
        route,
    });
}

/**
 * Creates the public HTTP boundary for domain-owned handlers.
 *
 * Domain code remains outside `api`. The gateway deliberately owns only mount
 * selection, request tracing and the human/service access boundary; it must
 * not grow domain persistence or business rules.
 */
export function createGatewayHandler({ inventoryHandler, timekeepingHandler, financeHandler }) {
    if (typeof inventoryHandler !== 'function') throw new TypeError('inventoryHandler is required');

    return async function handleGatewayRequest(request, env, ctx) {
        const requestId = requestIdFor(request);
        const url = new URL(request.url);

        if (url.pathname === '/health') {
            const dependencies = { d1: { required: true, state: env.DB ? 'configured' : 'unavailable' } };
            operationalLog(env, requestId, 200, '/health');
            return json(200, operationalPayload(env, requestId, true, dependencies), requestId);
        }

        if (url.pathname === '/readiness') {
            try {
                if (!env.DB?.prepare) throw new Error('DB_NOT_CONFIGURED');
                await env.DB.prepare('SELECT 1 AS ok').first();
                const dependencies = { d1: { required: true, state: 'healthy' } };
                operationalLog(env, requestId, 200, '/readiness');
                return json(200, operationalPayload(env, requestId, true, dependencies), requestId);
            } catch {
                const dependencies = { d1: { required: true, state: 'unavailable' } };
                operationalLog(env, requestId, 503, '/readiness');
                return json(503, operationalPayload(env, requestId, false, dependencies), requestId);
            }
        }

        if (url.pathname === '/api/ponto' || url.pathname.startsWith('/api/ponto/')) {
            if (typeof timekeepingHandler !== 'function') {
                return json(503, { ok: false, error: 'workforce_unavailable', requestId }, requestId);
            }
            const response = await timekeepingHandler(request, env, ctx);
            const headers = new Headers(response.headers);
            headers.set('x-request-id', requestId);
            return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
        }

        if (url.pathname === '/inventory' || url.pathname.startsWith('/inventory/')) {
            const response = await inventoryHandler(mountedRequest(request, '/inventory'), env, ctx);
            const headers = new Headers(response.headers);
            headers.set('x-request-id', requestId);
            return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
        }

        if (url.pathname === '/finance' || url.pathname.startsWith('/finance/')) {
            if (typeof financeHandler !== 'function') return json(503, { ok: false, error: 'finance_handler_unavailable', requestId }, requestId);
            const response = await financeHandler(mountedRequest(request, '/finance'), env, ctx);
            const headers = new Headers(response.headers);
            headers.set('x-request-id', requestId);
            return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
        }

        if (url.pathname.startsWith('/internal/')) {
            if (!isInternalServiceRequest(request, env)) {
                return json(401, { ok: false, error: 'service_identity_required', requestId }, requestId);
            }
            return json(404, { ok: false, error: 'internal_route_not_found', requestId }, requestId);
        }

        return json(404, { ok: false, error: 'route_not_found', requestId }, requestId);
    };
}
