import assert from 'node:assert/strict';
import test from 'node:test';
import { createGatewayHandler } from '../src/router.js';
import { createApiGateway, forwardFinanceProbe, forwardFinanceToService, handleGatewayRequest } from '../src/gateway.js';
import { verifySignedDomainContext } from '../../shared/service-adapters/signed-domain-context.js';
import { resetBoundServiceResilienceForTest } from '../../shared/service-adapters/cloudflare-service-binding.js';

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
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.unit, 'api');
    assert.equal(body.request_id, 'health-1');
    assert.equal(body.dependencies.d1.state, 'unavailable');
});

test('readiness proves D1 is available and fails closed when it is not', async () => {
    const ready = await gateway(new Request('https://api.skincos.com.br/readiness'), { DB: { prepare: () => ({ first: async () => ({ ok: 1 }) }) } }, {});
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).dependencies.d1.state, 'healthy');
    const unavailable = await gateway(new Request('https://api.skincos.com.br/readiness'), {}, {});
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).ready, false);
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

test('default gateway reaches Inventory through the explicit service binding', async () => {
    resetBoundServiceResilienceForTest();
    let receivedPath = null;
    const response = await handleGatewayRequest(
        new Request('https://api.skincos.com.br/inventory/insumos?unidade=nh', { headers: { 'x-request-id': 'inventory-binding-1' } }),
        { INVENTORY: { fetch: async (request) => { receivedPath = new URL(request.url).pathname; return new Response('inventory-binding-ok'); } } },
        {},
    );
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'inventory-binding-ok');
    assert.equal(receivedPath, '/insumos');
    assert.equal(response.headers.get('x-request-id'), 'inventory-binding-1');
});

test('an unavailable optional Inventory binding degrades only its route and leaves gateway health operational', async () => {
    resetBoundServiceResilienceForTest();
    const inventory = await handleGatewayRequest(new Request('https://api.skincos.com.br/inventory/insumos'), {}, {});
    assert.equal(inventory.status, 503);
    assert.equal((await inventory.json()).pendingSynchronization, true);
    assert.equal(inventory.headers.get('x-skincos-dependency-status'), 'unavailable');
    const health = await handleGatewayRequest(new Request('https://api.skincos.com.br/health'), {}, {});
    assert.equal(health.status, 200);
});

test('a timing-out optional Workforce binding degrades only workforce and opens a circuit', async () => {
    resetBoundServiceResilienceForTest();
    const env = { TIMEKEEPING: { fetch: () => new Promise(() => {}) } };
    const first = await handleGatewayRequest(new Request('https://api.skincos.com.br/api/ponto/health'), env, {});
    assert.equal(first.status, 503);
    assert.equal(first.headers.get('x-skincos-sync-state'), 'pending');
    const second = await handleGatewayRequest(new Request('https://api.skincos.com.br/api/ponto/health'), env, {});
    assert.equal(second.status, 503);
    const open = await handleGatewayRequest(new Request('https://api.skincos.com.br/api/ponto/health'), env, {});
    assert.equal(open.status, 503);
    assert.equal(open.headers.get('x-skincos-dependency-status'), 'circuit-open');
    const health = await handleGatewayRequest(new Request('https://api.skincos.com.br/health'), env, {});
    assert.equal(health.status, 200);
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

test('finance gateway enforces the cross-domain CSRF envelope before forwarding', async () => {
  let domainCalls = 0;
  const rateLimited = createApiGateway({
    inventoryHandler: async () => new Response('inventory'),
    financeDomainHandler: async () => { domainCalls += 1; return new Response('finance'); },
    resolveActor: async () => ({ actor: { username: 'pilot', allowedModules: ['finance'] }, csrf: 'csrf-ok' }),
  });
  const csrfDenied = await rateLimited(new Request('https://api.skincos.com.br/finance/accounts', { method: 'POST', headers: { 'idempotency-key': 'x' } }), {}, {});
  assert.equal(csrfDenied.status, 403); assert.equal(domainCalls, 0);

  const allowed = await rateLimited(new Request('https://api.skincos.com.br/finance/imports', { method: 'POST', headers: { 'x-csrf-token': 'csrf-ok', 'idempotency-key': 'x' } }), {}, {});
  assert.equal(allowed.status, 200); assert.equal(domainCalls, 1);
});

test('Finance health probes bypass user identity but remain isolated to the Finance binding', async () => {
  resetBoundServiceResilienceForTest();
  let receivedPath = null;
  const response = await handleGatewayRequest(new Request('https://api.skincos.com.br/finance/health'), {
    FINANCE: { fetch: async (request) => { receivedPath = new URL(request.url).pathname; return new Response(JSON.stringify({ ok: true, unit: 'finance' }), { headers: { 'content-type': 'application/json' } }); } },
  }, {});
  assert.equal(response.status, 200);
  assert.equal(receivedPath, '/health');
  assert.equal((await response.json()).unit, 'finance');
});

test('Finance health probes preserve a slow successful binding response for latency classification', async () => {
  resetBoundServiceResilienceForTest();
  const startedAt = Date.now();
  const response = await forwardFinanceProbe(new Request('https://api.skincos.com.br/finance/health'), {
    FINANCE: { fetch: async () => { await new Promise((resolve) => setTimeout(resolve, 900)); return new Response(JSON.stringify({ ok: true, unit: 'finance' }), { headers: { 'content-type': 'application/json' } }); } },
  });
  assert.equal(response.status, 200);
  assert.ok(Date.now() - startedAt >= 850);
  assert.equal((await response.json()).unit, 'finance');
});

test('Finance health probes still classify a genuine upstream failure as unavailable', async () => {
  resetBoundServiceResilienceForTest();
  const response = await forwardFinanceProbe(new Request('https://api.skincos.com.br/finance/health'), {
    FINANCE: { fetch: async () => new Response(JSON.stringify({ ok: false, error: 'D1_UNAVAILABLE' }), { status: 503, headers: { 'content-type': 'application/json' } }) },
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('x-skincos-dependency-status'), 'degraded');
  assert.equal((await response.json()).error, 'domain_service_degraded');
});

test('finance gateway passes only an authenticated, CSRF-valid request', async () => {
  let seenPath = null;
  const gateway = createApiGateway({
    inventoryHandler: async () => new Response('inventory'),
    financeDomainHandler: async (request) => { seenPath = new URL(request.url).pathname; return new Response('finance-ok'); },
    resolveActor: async () => ({ actor: { username: 'pilot', allowedModules: ['finance'] }, csrf: 'csrf-ok' }),
  });
  const allowed = await gateway(new Request('https://api.skincos.com.br/finance/imports', { method: 'POST', headers: { 'x-csrf-token': 'csrf-ok', 'idempotency-key': 'x' } }), {}, {});
  assert.equal(allowed.status, 200); assert.equal(seenPath, '/imports');
});

test('an unavailable Identity resolver is contained to Finance', async () => {
  let financeCalls = 0;
  const isolated = createApiGateway({
    inventoryHandler: async () => new Response('inventory-ok'),
    resolveActor: async () => ({ actor: null, csrf: null, unavailable: true }),
    financeDomainHandler: async () => { financeCalls += 1; return new Response('must-not-run'); },
  });
  const finance = await isolated(new Request('https://api.skincos.com.br/finance/overview'), {}, {});
  assert.equal(finance.status, 503);
  assert.equal((await finance.json()).error, 'IDENTITY_UNAVAILABLE');
  assert.equal(financeCalls, 0);
  const inventory = await isolated(new Request('https://api.skincos.com.br/inventory/insumos'), {}, {});
  assert.equal(inventory.status, 200);
  assert.equal(await inventory.text(), 'inventory-ok');
});

test('Finance is reached through an explicit service binding with a short-lived signed actor context', async () => {
  let received = null;
  const response = await forwardFinanceToService(new Request('https://api.skincos.com.br/overview', { headers: { cookie: 'session=private', 'x-csrf-token': 'csrf-ok', 'x-request-id': 'finance-binding-1' } }), {
    FINANCE_SERVICE_AUTH_SECRET: 'finance-secret',
    FINANCE: { fetch: async (request) => { received = request; return new Response('finance-binding-ok'); } },
  }, {}, { actor: { username: 'pilot', allowedModules: ['finance'] }, csrf: 'csrf-ok' });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'finance-binding-ok');
  assert.equal(received.headers.get('cookie'), null);
  assert.equal(received.headers.get('x-csrf-token'), null);
  assert.equal((await verifySignedDomainContext(received, 'finance-secret', 'finance')).actor.username, 'pilot');
});
