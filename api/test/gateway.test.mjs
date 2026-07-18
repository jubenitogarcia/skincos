import assert from 'node:assert/strict';
import test from 'node:test';
import { createGatewayHandler } from '../src/router.js';

const calls = [];
const gateway = createGatewayHandler({
    inventoryHandler: async (request) => {
        calls.push(new URL(request.url));
        return new Response('inventory-ok', { status: 200, headers: { 'x-owner': 'inventory' } });
    },
    timekeepingHandler: async (request) => {
        calls.push(new URL(request.url));
        return new Response(JSON.stringify({ ok: true, service: 'workforce-timekeeping' }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
});

test('health is owned by the gateway', async () => {
    const response = await gateway(new Request('https://api.skincos.com.br/health', { headers: { 'x-request-id': 'health-1' } }), {}, {});
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, service: 'api', requestId: 'health-1' });
});

test('inventory is mounted without retaining the legacy public prefix', async () => {
    const response = await gateway(new Request('https://api.skincos.com.br/inventory/insumos?unidade=nh', { headers: { 'x-request-id': 'inventory-1' } }), {}, {});
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'inventory-ok');
    assert.equal(response.headers.get('x-owner'), 'inventory');
    assert.equal(response.headers.get('x-request-id'), 'inventory-1');
    assert.equal(calls.at(-1).pathname, '/insumos');
    assert.equal(calls.at(-1).search, '?unidade=nh');
});

test('workforce owns the canonical public Ponto mount', async () => {
    const response = await gateway(new Request('https://api.skincos.com.br/api/ponto/health', { headers: { 'x-request-id': 'ponto-1' } }), {}, {});
    assert.equal(response.status, 200);
    assert.equal((await response.json()).service, 'workforce-timekeeping');
    assert.equal(calls.at(-1).pathname, '/api/ponto/health');
    assert.equal(response.headers.get('x-request-id'), 'ponto-1');
});

test('internal paths require a private service identity', async () => {
    const request = new Request('https://api.skincos.com.br/internal/orb/dispatch', { headers: { 'x-request-id': 'internal-1' } });
    const denied = await gateway(request, { INTERNAL_API_TOKEN: 'private-token' }, {});
    assert.equal(denied.status, 401);
    assert.equal((await denied.json()).error, 'service_identity_required');

    const permitted = await gateway(new Request(request, { headers: { 'x-request-id': 'internal-2', 'x-skincos-service-token': 'private-token' } }), { INTERNAL_API_TOKEN: 'private-token' }, {});
    assert.equal(permitted.status, 404);
    assert.equal((await permitted.json()).error, 'internal_route_not_found');
});
