import assert from 'node:assert/strict';
import test from 'node:test';
import { createGatewayHandler } from '../src/router.js';
import { createApiGateway, enforceFinanceRateLimit } from '../src/gateway.js';

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
    financeHandler: async (request) => new Response(new URL(request.url).pathname === '/overview' ? 'finance-ok' : 'bad-finance-path', { status: 200 }),
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

test('finance is mounted by the gateway without taking ownership of domain rules', async () => {
    const response = await gateway(new Request('https://api.skincos.com.br/finance/overview', { headers: { 'x-request-id': 'finance-1' } }), {}, {});
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'finance-ok');
    assert.equal(response.headers.get('x-request-id'), 'finance-1');
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

test('finance gateway enforces CSRF before the domain and fails closed when its distributed limiter rejects', async () => {
  let domainCalls = 0;
  const rateLimited = createApiGateway({
    inventoryHandler: async () => new Response('inventory'),
    financeDomainHandler: async () => { domainCalls += 1; return new Response('finance'); },
    resolveActor: async () => ({ actor: { username: 'pilot', allowedModules: ['finance'] }, csrf: 'csrf-ok' }),
  });
  const csrfDenied = await rateLimited(new Request('https://api.skincos.com.br/finance/accounts', { method: 'POST', headers: { 'idempotency-key': 'x' } }), {}, {});
  assert.equal(csrfDenied.status, 403); assert.equal(domainCalls, 0);

  const limiter = { idFromName: () => 'finance-limiter', get: () => ({ fetch: async () => new Response(JSON.stringify({ allowed: false }), { headers: { 'content-type': 'application/json' } }) }) };
  const blocked = await rateLimited(new Request('https://api.skincos.com.br/finance/imports', { method: 'POST', headers: { 'x-csrf-token': 'csrf-ok', 'idempotency-key': 'x' } }), { RATE_LIMITER: limiter }, {});
  assert.equal(blocked.status, 429); assert.equal((await blocked.json()).error, 'FINANCE_RATE_LIMITED'); assert.equal(domainCalls, 0);
});

test('finance gateway passes only an authenticated, CSRF-valid request after the limiter allows it', async () => {
  let seenPath = null;
  const gateway = createApiGateway({
    inventoryHandler: async () => new Response('inventory'),
    financeDomainHandler: async (request) => { seenPath = new URL(request.url).pathname; return new Response('finance-ok'); },
    resolveActor: async () => ({ actor: { username: 'pilot', allowedModules: ['finance'] }, csrf: 'csrf-ok' }),
  });
  const limiter = { idFromName: () => 'finance-limiter', get: () => ({ fetch: async () => new Response(JSON.stringify({ allowed: true }), { headers: { 'content-type': 'application/json' } }) }) };
  const allowed = await gateway(new Request('https://api.skincos.com.br/finance/imports', { method: 'POST', headers: { 'x-csrf-token': 'csrf-ok', 'idempotency-key': 'x' } }), { RATE_LIMITER: limiter }, {});
  assert.equal(allowed.status, 200); assert.equal(seenPath, '/imports');
});

test('finance rate limits reads, writes and imports in independent buckets', async () => {
  const limiterRequests = [];
  const limiter = { idFromName: () => 'finance-limiter', get: () => ({ fetch: async (input) => { limiterRequests.push(String(input)); return new Response(JSON.stringify({ allowed: true }), { headers: { 'content-type': 'application/json' } }); } }) };
  const env = { RATE_LIMITER: limiter };
  const actor = { username: 'pilot' };
  await enforceFinanceRateLimit(new Request('https://api.skincos.com.br/overview'), env, actor);
  await enforceFinanceRateLimit(new Request('https://api.skincos.com.br/accounts', { method: 'POST' }), env, actor);
  await enforceFinanceRateLimit(new Request('https://api.skincos.com.br/imports', { method: 'POST' }), env, actor);
  expectQuery(limiterRequests[0], 'key=finance:read&limit=240');
  expectQuery(limiterRequests[1], 'key=finance:write&limit=60');
  expectQuery(limiterRequests[2], 'key=finance:import&limit=12');
});

function expectQuery(url, expected) { assert.ok(url.includes(expected), `${url} should include ${expected}`); }
