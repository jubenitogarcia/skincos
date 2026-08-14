import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createGatewayHandler } from '../src/router.js';
import { createApiGateway, forwardFinanceProbe, forwardFinanceToService, handleGatewayRequest, prepareTimekeepingRequest } from '../src/gateway.js';
import pontoCoreWorker from '../workers/ponto.js';
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

test('Ponto route-only health and readiness use only the Timekeeping binding', async () => {
    const probePaths = [];
    const isolated = createGatewayHandler({
        inventoryHandler: async () => new Response('must-not-run'),
        timekeepingHandler: async (request) => {
            probePaths.push(new URL(request.url).pathname);
            return new Response(JSON.stringify({ ok: true, ready: true }), {
                headers: {
                    'content-type': 'application/json',
                    'x-skincos-timekeeping-release-sha': 'a'.repeat(40),
                    'x-skincos-timekeeping-version-id': '33333333-3333-4333-8333-333333333333',
                    'x-skincos-timekeeping-environment': 'staging',
                },
            });
        },
    });
    const env = {
        PONTO_ROUTE_ONLY: 'true',
        TIMEKEEPING: { fetch: async () => new Response('unused') },
        APP_VERSION: 'a'.repeat(40),
        ENVIRONMENT: 'staging',
        CF_VERSION_METADATA: { id: '22222222-2222-4222-8222-222222222222', tag: 'baseline-tag' },
    };

    const health = await isolated(new Request('https://ponto-core.invalid/health', { headers: { 'x-request-id': 'ponto-health-1' } }), env, {});
    assert.equal(health.status, 200);
    const healthBody = await health.json();
    assert.equal(healthBody.unit, 'ponto-core');
    assert.equal(healthBody.ready, true);
    assert.equal(healthBody.dependencies.timekeeping.state, 'configured');
    assert.equal(healthBody.dependencies.d1, undefined);
    assert.deepEqual(healthBody.version_metadata, { id: '22222222-2222-4222-8222-222222222222', tag: 'baseline-tag' });
    assert.equal(health.headers.get('x-skincos-gateway-release-sha'), 'a'.repeat(40));
    assert.equal(health.headers.get('x-skincos-gateway-version-id'), '22222222-2222-4222-8222-222222222222');

    const readiness = await isolated(new Request('https://ponto-core.invalid/readiness?ignored=true'), env, {});
    assert.equal(readiness.status, 200);
    assert.equal((await readiness.json()).dependencies.timekeeping.state, 'healthy');
    assert.equal(readiness.headers.get('x-skincos-gateway-release-sha'), 'a'.repeat(40));
    assert.equal(readiness.headers.get('x-skincos-gateway-environment'), 'staging');
    assert.equal(readiness.headers.get('x-skincos-gateway-version-id'), '22222222-2222-4222-8222-222222222222');
    assert.equal(readiness.headers.get('x-skincos-timekeeping-release-sha'), 'a'.repeat(40));
    assert.equal(readiness.headers.get('x-skincos-timekeeping-version-id'), '33333333-3333-4333-8333-333333333333');
    assert.equal(readiness.headers.get('x-skincos-timekeeping-environment'), 'staging');
    assert.deepEqual(probePaths, ['/api/ponto/readiness']);
});

test('Ponto route-only readiness fails closed without a healthy Timekeeping service', async () => {
    const isolated = createGatewayHandler({
        inventoryHandler: async () => new Response('must-not-run'),
        timekeepingHandler: async () => new Response(JSON.stringify({ ok: false }), { status: 503 }),
    });
    const baseEnv = { PONTO_ROUTE_ONLY: 'true', TIMEKEEPING: { fetch: async () => new Response('unused') } };

    const degraded = await isolated(new Request('https://ponto-core.invalid/readiness'), baseEnv, {});
    assert.equal(degraded.status, 503);
    assert.equal((await degraded.json()).dependencies.timekeeping.state, 'degraded');

    const absent = await isolated(new Request('https://ponto-core.invalid/readiness'), { PONTO_ROUTE_ONLY: 'true' }, {});
    assert.equal(absent.status, 503);
    assert.equal((await absent.json()).dependencies.timekeeping.state, 'unavailable');
});

test('Ponto route-only mode denies every non-Ponto and non-probe route before sibling handlers', async () => {
    let siblingCalls = 0;
    const isolated = createGatewayHandler({
        inventoryHandler: async () => { siblingCalls += 1; return new Response('inventory'); },
        timekeepingHandler: async () => { siblingCalls += 1; return new Response('timekeeping'); },
        financeHandler: async () => { siblingCalls += 1; return new Response('finance'); },
    });
    const env = { PONTO_ROUTE_ONLY: 'true', TIMEKEEPING: { fetch: async () => new Response('unused') } };

    for (const [path, method] of [['/inventory/insumos', 'GET'], ['/finance/health', 'GET'], ['/internal/orb/dispatch', 'POST'], ['/health', 'POST'], ['/unknown', 'GET']]) {
        const response = await isolated(new Request(`https://ponto-core.invalid${path}`, { method }), env, {});
        assert.equal(response.status, 404);
        assert.equal((await response.json()).error, 'ponto_route_only');
    }
    assert.equal(siblingCalls, 0);
});

test('dedicated Ponto entrypoint requires the route-only guard and never exposes sibling mounts', async () => {
    resetBoundServiceResilienceForTest();
    let bindingCalls = 0;
    let forwardedRequest = null;
    const binding = { fetch: async (request) => {
        bindingCalls += 1;
        forwardedRequest = request;
        return new Response(JSON.stringify({ ok: true, service: 'workforce-timekeeping' }), { headers: { 'content-type': 'application/json' } });
    } };

    const invalid = await pontoCoreWorker.fetch(new Request('https://ponto-core.invalid/api/ponto/health'), { TIMEKEEPING: binding }, {});
    assert.equal(invalid.status, 503);
    assert.equal((await invalid.json()).error, 'PONTO_CORE_CONFIG_INVALID');
    assert.equal(bindingCalls, 0);

    const denied = await pontoCoreWorker.fetch(new Request('https://ponto-core.invalid/inventory/insumos'), { PONTO_ROUTE_ONLY: 'true', TIMEKEEPING: binding }, {});
    assert.equal(denied.status, 404);
    assert.equal((await denied.json()).error, 'ponto_route_only');
    assert.equal(bindingCalls, 0);

    const forwarded = await pontoCoreWorker.fetch(new Request('https://ponto-core.invalid/api/ponto/health', {
        headers: {
            'x-skincos-gateway-release-sha': 'browser-controlled',
            'x-skincos-gateway-environment': 'production',
            'cloudflare-workers-version-overrides': 'skincos-timekeeping="browser-controlled"',
            'cloudflare-workers-version-key': `v1:${'b'.repeat(43)}`,
            'x-skincos-actor': 'server-generated-actor',
            'x-skincos-actor-sig': 'c'.repeat(43),
            'x-skincos-network-context': `v1:${'b'.repeat(43)}`,
            'x-skincos-network-ts': '1785355200000',
            'x-skincos-network-sig': 'd'.repeat(43),
            'x-skincos-network-signature-version': '2',
        },
    }), {
        PONTO_ROUTE_ONLY: 'true',
        TIMEKEEPING: binding,
        APP_VERSION: 'a'.repeat(40),
        ENVIRONMENT: 'staging',
        TIMEKEEPING_VERSION_ID: '33333333-3333-4333-8333-333333333333',
        CF_VERSION_METADATA: { id: '22222222-2222-4222-8222-222222222222' },
    }, {});
    assert.equal(forwarded.status, 200);
    assert.equal((await forwarded.json()).service, 'workforce-timekeeping');
    assert.equal(bindingCalls, 1);
    assert.equal(forwardedRequest.headers.get('x-skincos-gateway-release-sha'), 'a'.repeat(40));
    assert.equal(forwardedRequest.headers.get('x-skincos-gateway-environment'), 'staging');
    assert.equal(forwardedRequest.headers.get('x-skincos-gateway-version-id'), '22222222-2222-4222-8222-222222222222');
    assert.equal(forwardedRequest.headers.get('x-skincos-actor'), 'server-generated-actor');
    assert.equal(forwardedRequest.headers.get('x-skincos-actor-sig'), 'c'.repeat(43));
    assert.equal(forwardedRequest.headers.get('x-skincos-network-context'), `v1:${'b'.repeat(43)}`);
    assert.equal(forwardedRequest.headers.get('cloudflare-workers-version-key'), `v1:${'b'.repeat(43)}`);
    assert.equal(
        forwardedRequest.headers.get('cloudflare-workers-version-overrides'),
        'skincos-timekeeping-staging="33333333-3333-4333-8333-333333333333"',
    );
});

test('dedicated Ponto entrypoint gives authenticated Timekeeping writes a bounded cold-start budget', async () => {
    resetBoundServiceResilienceForTest();
    const startedAt = Date.now();
    const binding = {
        fetch: async () => {
            await new Promise((resolve) => setTimeout(resolve, 900));
            return new Response(JSON.stringify({ ok: false, error: 'PIN_INVALID' }), {
                status: 401,
                headers: { 'content-type': 'application/json' },
            });
        },
    };
    const response = await pontoCoreWorker.fetch(new Request('https://ponto-core.invalid/api/ponto/me/punch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin: '000000', unit: 'synthetic-unit' }),
    }), {
        PONTO_ROUTE_ONLY: 'true',
        TIMEKEEPING: binding,
        APP_VERSION: 'a'.repeat(40),
        ENVIRONMENT: 'staging',
        TIMEKEEPING_VERSION_ID: '33333333-3333-4333-8333-333333333333',
        CF_VERSION_METADATA: { id: '22222222-2222-4222-8222-222222222222' },
    }, {});
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, 'PIN_INVALID');
    assert.ok(Date.now() - startedAt >= 850);
    resetBoundServiceResilienceForTest();
});

test('dedicated Ponto readiness preserves the authoritative maintenance contract', async () => {
    resetBoundServiceResilienceForTest();
    let bindingCalls = 0;
    const response = await pontoCoreWorker.fetch(new Request('https://ponto-core.invalid/api/ponto/readiness'), {
        PONTO_ROUTE_ONLY: 'true',
        TIMEKEEPING: {
            fetch: async () => {
                bindingCalls += 1;
                return new Response(JSON.stringify({
                    service: 'workforce-timekeeping',
                    ok: false,
                    ready: false,
                    code: 'MODULE_MAINTENANCE',
                    availability: { state: 'maintenance', source: 'control' },
                    versionMetadata: { releaseSha: 'a'.repeat(40) },
                }), {
                    status: 503,
                    headers: { 'content-type': 'application/json; charset=utf-8' },
                });
            },
        },
        APP_VERSION: 'a'.repeat(40),
        ENVIRONMENT: 'staging',
        TIMEKEEPING_VERSION_ID: '33333333-3333-4333-8333-333333333333',
        CF_VERSION_METADATA: { id: '22222222-2222-4222-8222-222222222222' },
    }, {});

    assert.equal(response.status, 503);
    assert.equal(response.headers.get('x-skincos-dependency-status'), 'live');
    const body = await response.json();
    assert.equal(body.service, 'workforce-timekeeping');
    assert.equal(body.ready, false);
    assert.equal(body.code, 'MODULE_MAINTENANCE');
    assert.equal(body.availability.state, 'maintenance');
    assert.equal(body.versionMetadata.releaseSha, 'a'.repeat(40));
    assert.equal(bindingCalls, 1);
    resetBoundServiceResilienceForTest();
});

test('dedicated Ponto Wrangler config has private, independent staging and production services', async () => {
    const config = await readFile(new URL('../wrangler.ponto.toml', import.meta.url), 'utf8');
    assert.match(config, /^name = "skincos-ponto-core"$/m);
    assert.match(config, /^\[env\.staging\]\r?\nname = "skincos-ponto-core-staging"$/m);
    assert.match(config, /^main = "workers\/ponto\.js"$/m);
    assert.equal((config.match(/^workers_dev = false$/gm) || []).length, 2);
    assert.equal((config.match(/^preview_urls = false$/gm) || []).length, 2);
    assert.equal((config.match(/^PONTO_ROUTE_ONLY = "true"$/gm) || []).length, 2);
    assert.doesNotMatch(config, /^\s*(?:route|routes)\s*=/m);
    assert.doesNotMatch(config, /\b(?:d1_databases|durable_objects|r2_buckets)\b/);
    assert.doesNotMatch(config, /\bbinding = "(?:DB|FINANCE|INVENTORY|BACKUP_BUCKET|RATE_LIMITER|JOB_QUEUE)"\b/);
    assert.match(config, /service = "skincos-timekeeping"/);
    assert.match(config, /service = "skincos-timekeeping-staging"/);
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

test('default gateway tolerates stateful Inventory binding latency beyond the public probe budget', async () => {
    resetBoundServiceResilienceForTest();
    const response = await handleGatewayRequest(
        new Request('https://api.skincos.com.br/inventory/auth/me'),
        {
            INVENTORY: {
                fetch: async () => {
                    await new Promise((resolve) => setTimeout(resolve, 1_000));
                    return new Response('inventory-auth-result', { status: 401 });
                },
            },
        },
        {},
    );
    assert.equal(response.status, 401);
    assert.equal(await response.text(), 'inventory-auth-result');
    assert.equal(response.headers.get('x-skincos-dependency-status'), 'live');
});

test('default gateway gives unified team reads a bounded readiness budget', async () => {
    resetBoundServiceResilienceForTest();
    const response = await handleGatewayRequest(
        new Request('https://api.skincos.com.br/inventory/admin/team?mode=config'),
        {
            INVENTORY: {
                fetch: async (request) => {
                    assert.equal(new URL(request.url).pathname, '/admin/team');
                    await new Promise((resolve) => setTimeout(resolve, 3_200));
                    return new Response('team-config-result');
                },
            },
        },
        {},
    );
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'team-config-result');
    assert.equal(response.headers.get('x-skincos-dependency-status'), 'live');
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

test('canonical public Ponto readiness preserves the authoritative maintenance contract', async () => {
    resetBoundServiceResilienceForTest();
    const releaseSha = 'a'.repeat(40);
    const timekeepingVersionId = '33333333-3333-4333-8333-333333333333';
    let forwarded = null;
    const response = await handleGatewayRequest(new Request('https://api-staging.skincos.com.br/api/ponto/readiness'), {
        APP_VERSION: 'b'.repeat(40),
        ENVIRONMENT: 'staging',
        TIMEKEEPING: {
            fetch: async (request) => {
                forwarded = request;
                return new Response(JSON.stringify({
                    service: 'workforce-timekeeping',
                    ok: false,
                    ready: false,
                    code: 'MODULE_MAINTENANCE',
                    availability: { state: 'maintenance', source: 'control' },
                    versionMetadata: { releaseSha },
                }), {
                    status: 503,
                    headers: {
                        'content-type': 'application/json; charset=utf-8',
                        'x-skincos-timekeeping-release-sha': releaseSha,
                        'x-skincos-timekeeping-version-id': timekeepingVersionId,
                        'x-skincos-timekeeping-environment': 'staging',
                    },
                });
            },
        },
    }, {});

    assert.equal(response.status, 503);
    assert.equal(new URL(forwarded.url).pathname, '/api/ponto/readiness');
    assert.equal(response.headers.get('x-skincos-dependency-status'), 'live');
    assert.equal(response.headers.get('x-skincos-timekeeping-release-sha'), releaseSha);
    assert.equal(response.headers.get('x-skincos-timekeeping-version-id'), timekeepingVersionId);
    assert.equal(response.headers.get('x-skincos-timekeeping-environment'), 'staging');
    const body = await response.json();
    assert.equal(body.service, 'workforce-timekeeping');
    assert.equal(body.ready, false);
    assert.equal(body.code, 'MODULE_MAINTENANCE');
    assert.equal(body.availability.state, 'maintenance');
    assert.equal(body.versionMetadata.releaseSha, releaseSha);
    resetBoundServiceResilienceForTest();
});

test('workforce owns the canonical public Ponto mount', async () => {
    const response = await gateway(new Request('https://api.skincos.com.br/api/ponto/health', { headers: { 'x-request-id': 'ponto-1' } }), {}, {});
    assert.equal(response.status, 200);
    assert.equal((await response.json()).service, 'workforce-timekeeping');
    assert.equal(calls.at(-1).pathname, '/api/ponto/health');
    assert.equal(response.headers.get('x-request-id'), 'ponto-1');
});

test('private Ponto Core exposes only Ponto plus operational probes', async () => {
    resetBoundServiceResilienceForTest();
    const env = {
        PONTO_ROUTE_ONLY: 'true',
        TIMEKEEPING: {
            fetch: async () => new Response(JSON.stringify({ ok: true, service: 'workforce-timekeeping' }), {
                headers: { 'content-type': 'application/json' },
            }),
        },
    };

    for (const path of ['/inventory/insumos', '/finance/health', '/internal/orb/dispatch', '/unknown']) {
        const response = await handleGatewayRequest(new Request(`https://ponto-core.invalid${path}`), env, {});
        assert.equal(response.status, 404, path);
        assert.equal((await response.json()).error, 'ponto_route_only', path);
    }

    const ponto = await handleGatewayRequest(new Request('https://ponto-core.invalid/api/ponto/health'), env, {});
    assert.equal(ponto.status, 200);
    assert.equal((await ponto.json()).service, 'workforce-timekeeping');
    assert.equal((await handleGatewayRequest(new Request('https://ponto-core.invalid/health'), env, {})).status, 200);
});

test('Core replaces browser release and version overrides with deployment-owned Timekeeping routing', async () => {
    let received = null;
    const securedGateway = createApiGateway({
        inventoryHandler: async () => new Response('inventory'),
        timekeepingHandler: async (request) => {
            received = request;
            return new Response('ponto-ok', {
                headers: {
                    'x-skincos-gateway-release-sha': 'spoofed-by-upstream',
                    'x-skincos-gateway-environment': 'spoofed-by-upstream',
                    'x-skincos-gateway-version-id': 'spoofed-by-upstream',
                },
            });
        },
    });
    const releaseSha = 'a'.repeat(40);
    const coreVersionId = '22222222-2222-4222-8222-222222222222';
    const timekeepingVersionId = '33333333-3333-4333-8333-333333333333';
    const networkContext = `v1:${'b'.repeat(43)}`;
    const response = await securedGateway(new Request('https://api-staging.skincos.com.br/api/ponto/me/records', {
        headers: {
            'cloudflare-workers-version-key': networkContext,
            'cloudflare-workers-version-overrides': `skincos-api-staging="${coreVersionId}"`,
            'x-skincos-gateway-release-sha': 'browser-release',
            'x-skincos-gateway-environment': 'production',
            'x-skincos-actor': 'eyJpZCI6InBpbG90In0',
            'x-skincos-actor-sig': 'c'.repeat(43),
            'x-skincos-network-context': networkContext,
            'x-skincos-network-ts': '1785355200000',
            'x-skincos-network-sig': 'd'.repeat(43),
            'x-skincos-network-signature-version': '2',
        },
    }), {
        APP_VERSION: releaseSha,
        ENVIRONMENT: 'staging',
        TIMEKEEPING_VERSION_ID: timekeepingVersionId,
        CF_VERSION_METADATA: { id: coreVersionId, tag: 'ponto-candidate' },
    }, {});

    assert.equal(response.status, 200);
    assert.equal(received.headers.get('x-skincos-gateway-release-sha'), releaseSha);
    assert.equal(received.headers.get('x-skincos-gateway-environment'), 'staging');
    assert.equal(received.headers.get('x-skincos-gateway-version-id'), coreVersionId);
    assert.equal(received.headers.get('cloudflare-workers-version-key'), networkContext);
    assert.equal(
        received.headers.get('cloudflare-workers-version-overrides'),
        `skincos-timekeeping-staging="${timekeepingVersionId}"`,
    );
    assert.equal(response.headers.get('x-skincos-gateway-release-sha'), releaseSha);
    assert.equal(response.headers.get('x-skincos-gateway-environment'), 'staging');
    assert.equal(response.headers.get('x-skincos-gateway-version-id'), coreVersionId);
    assert.equal(response.headers.get('x-skincos-gateway-version-tag'), 'ponto-candidate');
});

test('Core rejects standalone browser affinity and never forwards a browser-selected override', () => {
    const request = prepareTimekeepingRequest(new Request('https://api.skincos.com.br/api/ponto/health', {
        headers: {
            'cloudflare-workers-version-key': 'browser-affinity',
            'cloudflare-workers-version-overrides': 'skincos-timekeeping="browser-version"',
            'x-skincos-gateway-release-sha': 'browser-release',
        },
    }), { APP_VERSION: 'e'.repeat(40), ENVIRONMENT: 'production' });

    assert.equal(request.headers.get('cloudflare-workers-version-key'), null);
    assert.equal(request.headers.get('cloudflare-workers-version-overrides'), null);
    assert.equal(request.headers.get('x-skincos-gateway-release-sha'), 'e'.repeat(40));
    assert.equal(request.headers.get('x-skincos-gateway-environment'), 'production');
});

test('Core strips external version-routing and gateway headers from non-Ponto domain calls', async () => {
    let received = null;
    const sanitizedGateway = createGatewayHandler({
        inventoryHandler: async (request) => {
            received = request;
            return new Response('inventory-ok');
        },
    });
    const response = await sanitizedGateway(new Request('https://api.skincos.com.br/inventory/insumos', {
        headers: {
            'cloudflare-workers-version-key': 'browser-affinity',
            'cloudflare-workers-version-overrides': 'skincos-insumos="browser-version"',
            'x-skincos-gateway-release-sha': 'browser-release',
            'x-skincos-gateway-environment': 'browser-environment',
        },
    }), {}, {});

    assert.equal(response.status, 200);
    assert.equal(received.headers.get('cloudflare-workers-version-key'), null);
    assert.equal(received.headers.get('cloudflare-workers-version-overrides'), null);
    assert.equal(received.headers.get('x-skincos-gateway-release-sha'), null);
    assert.equal(received.headers.get('x-skincos-gateway-environment'), null);
});

test('gateway health exposes immutable release and Cloudflare Worker version metadata', async () => {
    const releaseSha = 'f'.repeat(40);
    const response = await gateway(new Request('https://api.skincos.com.br/health'), {
        APP_VERSION: releaseSha,
        ENVIRONMENT: 'production',
        CF_VERSION_METADATA: { id: '44444444-4444-4444-8444-444444444444', tag: 'ponto-release' },
    }, {});
    const body = await response.json();
    assert.equal(body.version, releaseSha);
    assert.equal(body.release_sha, releaseSha);
    assert.deepEqual(body.worker_version, {
        id: '44444444-4444-4444-8444-444444444444',
        tag: 'ponto-release',
    });
});

test('finance is mounted by the gateway without taking ownership of domain rules', async () => {
    const response = await gateway(new Request('https://api.skincos.com.br/finance/overview', { headers: { 'x-request-id': 'finance-1' } }), {}, {});
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'finance-ok');
    assert.equal(response.headers.get('x-request-id'), 'finance-1');
});

test('missing production Finance binding stays isolated while Ponto remains available', async () => {
    resetBoundServiceResilienceForTest();
    const finance = await handleGatewayRequest(new Request('https://api.skincos.com.br/finance/health'), {
        APP_VERSION: 'a'.repeat(40),
        ENVIRONMENT: 'production',
    }, {});
    assert.equal(finance.status, 503);
    assert.equal(finance.headers.get('x-skincos-dependency-status'), 'unavailable');

    const ponto = await handleGatewayRequest(new Request('https://api.skincos.com.br/api/ponto/health'), {
        APP_VERSION: 'a'.repeat(40),
        ENVIRONMENT: 'production',
        TIMEKEEPING: { fetch: async () => new Response(JSON.stringify({ ok: true, service: 'workforce-timekeeping' }), { headers: { 'content-type': 'application/json' } }) },
    }, {});
    assert.equal(ponto.status, 200);
    assert.equal((await ponto.json()).service, 'workforce-timekeeping');
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

test('Finance operations preserve slow successful binding responses but stay bounded', async () => {
  resetBoundServiceResilienceForTest();
  const bootstrapStartedAt = Date.now();
  const bootstrap = await forwardFinanceToService(new Request('https://api.skincos.com.br/bootstrap', {
    headers: { cookie: 'session=private', 'x-csrf-token': 'csrf-ok', 'x-request-id': 'finance-bootstrap-timeout' },
  }), {
    FINANCE_SERVICE_AUTH_SECRET: 'finance-secret',
    FINANCE: { fetch: async () => { await new Promise((resolve) => setTimeout(resolve, 1_050)); return new Response(JSON.stringify({ ok: true, canAccess: true }), { headers: { 'content-type': 'application/json' } }); } },
  }, {}, { actor: { username: 'pilot', allowedModules: ['finance'] }, csrf: 'csrf-ok' });
  assert.equal(bootstrap.status, 200);
  assert.ok(Date.now() - bootstrapStartedAt >= 1_000);

  resetBoundServiceResilienceForTest();
  const auditStartedAt = Date.now();
  const audit = await forwardFinanceToService(new Request('https://api.skincos.com.br/audit?scopeId=finance-scope-novo-hamburgo', {
    headers: { cookie: 'session=private', 'x-csrf-token': 'csrf-ok', 'x-request-id': 'finance-audit-timeout' },
  }), {
    FINANCE_SERVICE_AUTH_SECRET: 'finance-secret',
    FINANCE: { fetch: async () => { await new Promise((resolve) => setTimeout(resolve, 1_050)); return new Response(JSON.stringify({ ok: true, total: 2 }), { headers: { 'content-type': 'application/json' } }); } },
  }, {}, { actor: { username: 'pilot', allowedModules: ['finance'] }, csrf: 'csrf-ok' });
  assert.equal(audit.status, 200);
  assert.ok(Date.now() - auditStartedAt >= 1_000);

  resetBoundServiceResilienceForTest();
  const write = await forwardFinanceToService(new Request('https://api.skincos.com.br/tags?scopeId=finance-scope-novo-hamburgo', {
    method: 'POST', headers: { cookie: 'session=private', 'x-csrf-token': 'csrf-ok', 'x-request-id': 'finance-write-timeout' },
  }), {
    FINANCE_SERVICE_AUTH_SECRET: 'finance-secret',
    FINANCE: { fetch: async () => { await new Promise((resolve) => setTimeout(resolve, 1_050)); return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } }); } },
  }, {}, { actor: { username: 'pilot', allowedModules: ['finance'] }, csrf: 'csrf-ok' });
  assert.equal(write.status, 200);

  resetBoundServiceResilienceForTest();
  const timedOutRead = await forwardFinanceToService(new Request('https://api.skincos.com.br/audit?scopeId=finance-scope-novo-hamburgo', {
    headers: { cookie: 'session=private', 'x-csrf-token': 'csrf-ok', 'x-request-id': 'finance-read-bounded-timeout' },
  }), {
    FINANCE_SERVICE_AUTH_SECRET: 'finance-secret',
    FINANCE: { fetch: async () => { await new Promise((resolve) => setTimeout(resolve, 3_100)); return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } }); } },
  }, {}, { actor: { username: 'pilot', allowedModules: ['finance'] }, csrf: 'csrf-ok' });
  assert.equal(timedOutRead.status, 503);

  resetBoundServiceResilienceForTest();
  const coldWrite = await forwardFinanceToService(new Request('https://api.skincos.com.br/tags?scopeId=finance-scope-novo-hamburgo', {
    method: 'POST', headers: { cookie: 'session=private', 'x-csrf-token': 'csrf-ok', 'x-request-id': 'finance-write-cold-start' },
  }), {
    FINANCE_SERVICE_AUTH_SECRET: 'finance-secret',
    FINANCE: { fetch: async () => { await new Promise((resolve) => setTimeout(resolve, 3_100)); return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } }); } },
  }, {}, { actor: { username: 'pilot', allowedModules: ['finance'] }, csrf: 'csrf-ok' });
  assert.equal(coldWrite.status, 200);

  resetBoundServiceResilienceForTest();
  const timedOut = await forwardFinanceToService(new Request('https://api.skincos.com.br/tags?scopeId=finance-scope-novo-hamburgo', {
    method: 'POST', headers: { cookie: 'session=private', 'x-csrf-token': 'csrf-ok', 'x-request-id': 'finance-write-bounded-timeout' },
  }), {
    FINANCE_SERVICE_AUTH_SECRET: 'finance-secret',
    FINANCE: { fetch: async () => { await new Promise((resolve) => setTimeout(resolve, 5_100)); return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } }); } },
  }, {}, { actor: { username: 'pilot', allowedModules: ['finance'] }, csrf: 'csrf-ok' });
  assert.equal(timedOut.status, 503);
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
