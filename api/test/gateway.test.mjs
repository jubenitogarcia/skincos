import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import { createGatewayHandler } from '../src/router.js';
import { createApiGateway, forwardCrmCoreToService, forwardFinanceProbe, forwardFinanceToService, handleGatewayRequest, prepareTimekeepingRequest } from '../src/gateway.js';
import { createCrmCoreProductionReceiptSigningInput } from '../src/crm-core-production-receipt.js';
import pontoCoreWorker from '../workers/ponto.js';
import { verifySignedDomainContext } from '../../shared/service-adapters/signed-domain-context.js';
import { resetBoundServiceResilienceForTest } from '../../shared/service-adapters/cloudflare-service-binding.js';

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

const calls = [];
const crmProductionGatewayVersionId = '11111111-1111-4111-8111-111111111111';
const crmProductionWorkerVersionId = '22222222-2222-4222-8222-222222222222';
const crmProductionReceiptKeyId = 'crm-production-route-receipt-test';
const crmProductionReceiptKeys = generateKeyPairSync('ed25519');
const crmProductionReceiptPublicKey = crmProductionReceiptKeys.publicKey.export({ format: 'jwk' });

function signedCrmProductionReceipt(overrides = {}) {
    const receipt = {
        contract: 'skincos-crm/production-route-receipt/v1',
        receiptId: 'crm-production-route-receipt-test-20260907',
        environment: 'production',
        gatewayVersionId: crmProductionGatewayVersionId,
        service: 'skincos-crm-core',
        workerVersionId: crmProductionWorkerVersionId,
        release: 'a'.repeat(40),
        artifactDigest: `sha256:${'b'.repeat(64)}`,
        keyId: crmProductionReceiptKeyId,
        signature: 'a',
        ...overrides,
    };
    receipt.signature = sign(
        null,
        Buffer.from(createCrmCoreProductionReceiptSigningInput(receipt)),
        crmProductionReceiptKeys.privateKey,
    ).toString('base64url');
    return receipt;
}

function crmProductionEnvironment(receipt = signedCrmProductionReceipt(), overrides = {}) {
    return {
        ENVIRONMENT: 'production',
        APP_VERSION: 'c'.repeat(40),
        CF_VERSION_METADATA: { id: crmProductionGatewayVersionId },
        CRM_CORE_PRODUCTION_ENABLED: 'true',
        CRM_CORE_PRODUCTION_RECEIPT: JSON.stringify(receipt),
        CRM_CORE_PRODUCTION_RECEIPT_PUBLIC_KEYS_JSON: JSON.stringify({
            [crmProductionReceiptKeyId]: crmProductionReceiptPublicKey,
        }),
        ...overrides,
    };
}

function crmCoreReceiptReadyBody(receipt, overrides = {}) {
    return {
        ok: true,
        ready: true,
        unit: 'crm-core',
        environment: 'production',
        release: receipt.release,
        version: receipt.release,
        artifact_digest: receipt.artifactDigest,
        artifactDigest: receipt.artifactDigest,
        ...overrides,
    };
}
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

test('CRM Core keeps its public staging mount with a narrow request-header allowlist', async () => {
  resetBoundServiceResilienceForTest();
  let received = null;
  const response = await handleGatewayRequest(new Request('https://api-staging.skincos.com.br/crm/ready?smoke=1', {
    headers: {
      accept: 'application/json',
      authorization: 'Bearer legacy-session',
      cookie: 'crm_session=legacy',
      'content-type': 'application/json',
      'cf-connecting-ip': '203.0.113.20',
      forwarded: 'for=203.0.113.10;proto=https',
      origin: 'https://crm-staging.skincos.com.br',
      'proxy-authorization': 'Basic synthetic-proxy-credential',
      'x-csrf-token': 'legacy-csrf',
      'x-identity-delivery': 'identity-crm-delivery/v1.synthetic-envelope',
      'x-request-id': 'crm-core-gateway-1',
      'x-skincos-actor': 'legacy-actor',
      'x-skincos-actor-sig': 'legacy-signature',
      'x-skincos-local-crm-actor': 'local-only',
      'x-skincos-network-context': 'legacy-network',
      'x-skincos-network-sig': 'legacy-signature',
      'x-skincos-network-signature-version': '2',
      'x-skincos-network-ts': '1788288000000',
      'x-skincos-service-token': 'synthetic-service-token',
      'x-unlisted-credential': 'must-not-cross',
      'x-forwarded-for': '203.0.113.10',
      'x-forwarded-host': 'legacy-proxy.invalid',
    },
  }), {
    APP_VERSION: 'a'.repeat(40),
    ENVIRONMENT: 'staging',
    CF_VERSION_METADATA: { id: '22222222-2222-4222-8222-222222222222', tag: 'crm-core-staging' },
    CRM_CORE: {
      fetch: async (request) => {
        received = request;
        return new Response(JSON.stringify({ ok: true, reason: 'CRM_STAGING_READY' }), {
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'set-cookie': 'must-not-cross-boundary=true',
          },
        });
      },
    },
  }, {});

  assert.equal(response.status, 200);
  assert.equal((await response.json()).reason, 'CRM_STAGING_READY');
  assert.equal(new URL(received.url).pathname, '/crm/ready');
  assert.equal(new URL(received.url).search, '?smoke=1');
  assert.equal(received.headers.get('accept'), 'application/json');
  assert.equal(received.headers.get('content-type'), 'application/json');
  assert.equal(received.headers.get('origin'), 'https://crm-staging.skincos.com.br');
  assert.equal(received.headers.get('x-request-id'), 'crm-core-gateway-1');
  assert.equal(received.headers.get('x-identity-delivery'), null);
  for (const name of [
    'authorization',
    'cookie',
    'x-csrf-token',
    'x-skincos-actor',
    'x-skincos-actor-sig',
    'x-skincos-local-crm-actor',
    'x-skincos-network-context',
    'x-skincos-network-sig',
    'x-skincos-network-signature-version',
    'x-skincos-network-ts',
    'x-skincos-service-token',
    'x-unlisted-credential',
    'proxy-authorization',
    'forwarded',
    'x-forwarded-for',
    'x-forwarded-host',
    'cf-connecting-ip',
  ]) assert.equal(received.headers.get(name), null, name);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('x-skincos-gateway-release-sha'), 'a'.repeat(40));
  assert.equal(response.headers.get('x-skincos-gateway-environment'), 'staging');
  assert.equal(response.headers.get('x-skincos-gateway-version-id'), '22222222-2222-4222-8222-222222222222');
  resetBoundServiceResilienceForTest();
});

test('CRM session resolves Identity only at the staging gateway and forwards its minimal signed envelope', async () => {
  resetBoundServiceResilienceForTest();
  let issuerRequest = null;
  let coreRequest = null;
  let resolverCalls = 0;
  const callerSecret = 'synthetic-crm-identity-caller-hmac-secret-2026';
  const sessionGateway = createApiGateway({
    inventoryHandler: async () => new Response('inventory-not-used'),
    resolveActor: async (request) => {
      resolverCalls += 1;
      assert.equal(request.headers.get('cookie'), 'session=browser-only');
      return {
        actor: {
          identitySubject: 'idn:session_identity_actor_0001',
          username: 'must-not-cross',
          email: 'private@example.invalid',
          displayName: 'Private Identity',
          role: 'GESTOR',
          scopes: {
            units: ['novo-hamburgo'],
            modules: ['overview', 'clients'],
            permissions: ['clients:read', 'overview:read'],
          },
        },
        csrf: 'browser-csrf-not-forwarded',
      };
    },
  });
  const response = await sessionGateway(new Request('https://api-staging.skincos.com.br/crm/session', {
    headers: {
      accept: 'application/json',
      authorization: 'Bearer browser-credential',
      cookie: 'session=browser-only',
      origin: 'https://crm-staging.skincos.com.br',
      'x-csrf-token': 'browser-csrf-not-forwarded',
      'x-identity-delivery': 'forged.browser.envelope',
      'x-request-id': 'crm-session-gateway-1',
    },
  }), {
    ENVIRONMENT: 'staging',
    CRM_IDENTITY_ISSUER_CALLER_ENABLED: 'true',
    CRM_IDENTITY_ISSUER_CALLER_ID: 'crm-api-staging-v1',
    CRM_IDENTITY_ISSUER_CALLER_HMAC: callerSecret,
    IDENTITY_CRM_ISSUER: {
      fetch: async (request) => {
        issuerRequest = request;
        return new Response(JSON.stringify({
          ok: true,
          version: 'identity-crm-delivery/v1',
          keyId: 'crm-staging-identity-2026-09',
          compact: 'test.header.signature',
        }), { headers: { 'content-type': 'application/json' } });
      },
    },
    CRM_CORE: {
      fetch: async (request) => {
        coreRequest = request;
        return new Response(JSON.stringify({ ok: true, identity: { identitySubject: 'idn:session_identity_actor_0001', role: 'GESTOR', scopes: {} }, requestId: 'crm-session-gateway-1' }), {
          headers: { 'content-type': 'application/json' },
        });
      },
    },
  }, {});

  assert.equal(response.status, 200);
  assert.equal(resolverCalls, 1);
  assert.ok(issuerRequest);
  assert.ok(coreRequest);
  assert.equal(new URL(issuerRequest.url).pathname, '/internal/identity-crm-delivery/v1/issue');
  assert.equal(issuerRequest.headers.get('x-skincos-identity-issuer-caller'), 'crm-api-staging-v1');
  assert.equal(issuerRequest.headers.get('cookie'), null);
  assert.equal(issuerRequest.headers.get('authorization'), null);
  assert.equal(issuerRequest.headers.get('x-identity-delivery'), null);
  const rawIssuerBody = await issuerRequest.text();
  const issuerPayload = JSON.parse(rawIssuerBody);
  assert.deepEqual(issuerPayload.identity, {
    identitySubject: 'idn:session_identity_actor_0001',
    role: 'GESTOR',
    scopes: {
      units: ['novo-hamburgo'],
      modules: ['clients', 'overview'],
      permissions: ['clients:read', 'overview:read'],
    },
  });
  assert.deepEqual(issuerPayload.request, { method: 'GET', target: '/api/crm/session', bodyBase64: '' });
  assert.match(issuerPayload.jti, /^[A-Za-z0-9_-]{16,160}$/);
  assert.doesNotMatch(rawIssuerBody, /must-not-cross|private@example|Private Identity|browser-csrf/i);
  const hmacKey = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(callerSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  assert.equal(await webcrypto.subtle.verify(
    'HMAC',
    hmacKey,
    Buffer.from(issuerRequest.headers.get('x-skincos-identity-issuer-auth'), 'base64url'),
    new TextEncoder().encode(rawIssuerBody),
  ), true);

  assert.equal(new URL(coreRequest.url).pathname, '/crm/session');
  assert.equal(coreRequest.headers.get('x-identity-delivery'), 'test.header.signature');
  for (const name of ['cookie', 'authorization', 'x-csrf-token']) assert.equal(coreRequest.headers.get(name), null, name);
  assert.equal(coreRequest.headers.get('x-request-id'), 'crm-session-gateway-1');
  resetBoundServiceResilienceForTest();
});

test('CRM projections signs only an explicit canonical unit query before reaching Core', async () => {
  resetBoundServiceResilienceForTest();
  let issuerRequest = null;
  let coreRequest = null;
  let resolverCalls = 0;
  const callerSecret = 'synthetic-crm-identity-caller-hmac-secret-2026';
  const projectionGateway = createApiGateway({
    inventoryHandler: async () => new Response('inventory-not-used'),
    resolveActor: async () => {
      resolverCalls += 1;
      return {
        actor: {
          identitySubject: 'idn:projection_identity_actor_0001',
          username: 'must-not-cross',
          email: 'private@example.invalid',
          displayName: 'Private Identity',
          role: 'GESTOR',
          scopes: {
            units: ['novo-hamburgo', 'barra-shopping-sul'],
            modules: ['overview', 'clients'],
            permissions: ['clients:read', 'overview:read'],
          },
        },
        csrf: 'browser-csrf-not-forwarded',
      };
    },
  });
  const response = await projectionGateway(new Request('https://api-staging.skincos.com.br/crm/projections?units=barra-shopping-sul,novo-hamburgo', {
    headers: {
      accept: 'application/json',
      authorization: 'Bearer browser-credential',
      cookie: 'session=browser-only',
      origin: 'https://crm-staging.skincos.com.br',
      'x-csrf-token': 'browser-csrf-not-forwarded',
      'x-identity-delivery': 'forged.browser.envelope',
      'x-request-id': 'crm-projection-gateway-1',
    },
  }), {
    ENVIRONMENT: 'staging',
    CRM_IDENTITY_ISSUER_CALLER_ENABLED: 'true',
    CRM_IDENTITY_ISSUER_CALLER_ID: 'crm-api-staging-v1',
    CRM_IDENTITY_ISSUER_CALLER_HMAC: callerSecret,
    IDENTITY_CRM_ISSUER: {
      fetch: async (request) => {
        issuerRequest = request;
        return new Response(JSON.stringify({
          ok: true,
          version: 'identity-crm-delivery/v1',
          keyId: 'crm-staging-identity-2026-09',
          compact: 'test.header.signature',
        }), { headers: { 'content-type': 'application/json' } });
      },
    },
    CRM_CORE: {
      fetch: async (request) => {
        coreRequest = request;
        return new Response(JSON.stringify({
          ok: true,
          contractVersion: 'crm-core/projection-read/v2',
          state: 'available',
          scope: { mode: 'intersection', units: ['barra-shopping-sul', 'novo-hamburgo'] },
          projections: [],
          count: 0,
          requestId: 'crm-projection-gateway-1',
        }), { headers: { 'content-type': 'application/json' } });
      },
    },
  }, {});

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://crm-staging.skincos.com.br');
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  assert.equal(resolverCalls, 1);
  assert.ok(issuerRequest);
  assert.ok(coreRequest);
  const rawIssuerBody = await issuerRequest.text();
  const issuerPayload = JSON.parse(rawIssuerBody);
  assert.deepEqual(issuerPayload.identity, {
    identitySubject: 'idn:projection_identity_actor_0001',
    role: 'GESTOR',
    scopes: {
      units: ['barra-shopping-sul', 'novo-hamburgo'],
      modules: ['clients', 'overview'],
      permissions: ['clients:read', 'overview:read'],
    },
  });
  assert.deepEqual(issuerPayload.request, {
    method: 'GET',
    target: '/api/crm/projections?units=barra-shopping-sul,novo-hamburgo',
    bodyBase64: '',
  });
  assert.doesNotMatch(rawIssuerBody, /must-not-cross|private@example|Private Identity|browser-csrf/i);
  const hmacKey = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(callerSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  assert.equal(await webcrypto.subtle.verify(
    'HMAC',
    hmacKey,
    Buffer.from(issuerRequest.headers.get('x-skincos-identity-issuer-auth'), 'base64url'),
    new TextEncoder().encode(rawIssuerBody),
  ), true);

  assert.equal(new URL(coreRequest.url).pathname, '/crm/projections');
  assert.equal(new URL(coreRequest.url).search, '?units=barra-shopping-sul,novo-hamburgo');
  assert.equal(coreRequest.headers.get('x-identity-delivery'), 'test.header.signature');
  for (const name of ['cookie', 'authorization', 'x-csrf-token']) assert.equal(coreRequest.headers.get(name), null, name);
  assert.equal(coreRequest.headers.get('x-request-id'), 'crm-projection-gateway-1');
  resetBoundServiceResilienceForTest();
});

test('CRM projections rejects noncanonical unit queries and non-GET requests before Identity or Core', async () => {
  let resolverCalls = 0;
  let coreCalls = 0;
  const projectionGateway = createApiGateway({
    inventoryHandler: async () => new Response('inventory-not-used'),
    resolveActor: async () => { resolverCalls += 1; return { actor: null, csrf: null }; },
    crmCoreHandler: async () => { coreCalls += 1; return new Response('must-not-run'); },
  });
  const env = { ENVIRONMENT: 'staging' };
  for (const url of [
    'https://api-staging.skincos.com.br/crm/projections',
    'https://api-staging.skincos.com.br/crm/projections?units=novo-hamburgo,barra-shopping-sul',
    'https://api-staging.skincos.com.br/crm/projections?units=novo-hamburgo,novo-hamburgo',
    'https://api-staging.skincos.com.br/crm/projections?units=barra-shopping-sul,novo-hamburgo&unexpected=true',
    'https://api-staging.skincos.com.br/crm/projections?units=barra-shopping-sul%2Cnovo-hamburgo',
  ]) {
    const response = await projectionGateway(new Request(url, { headers: { origin: 'https://crm-staging.skincos.com.br' } }), env, {});
    assert.equal(response.status, 400, url);
    assert.equal((await response.json()).error, 'CRM_PROJECTION_QUERY_INVALID', url);
  }
  const post = await projectionGateway(new Request('https://api-staging.skincos.com.br/crm/projections?units=barra-shopping-sul,novo-hamburgo', { method: 'POST' }), env, {});
  assert.equal(post.status, 405);
  assert.equal((await post.json()).error, 'CRM_PROJECTION_METHOD_NOT_ALLOWED');
  assert.equal(resolverCalls, 0);
  assert.equal(coreCalls, 0);
});

test('CRM session remains unavailable by default and rejects an Identity actor without an opaque subject', async () => {
  resetBoundServiceResilienceForTest();
  let issuerCalls = 0;
  let coreCalls = 0;
  let actor = {
    identitySubject: null,
    role: 'GESTOR',
    scopes: { units: ['novo-hamburgo'], modules: ['clients'], permissions: ['clients:read'] },
  };
  const sessionGateway = createApiGateway({
    inventoryHandler: async () => new Response('inventory-not-used'),
    resolveActor: async () => ({ actor, csrf: '' }),
  });
  const env = {
    ENVIRONMENT: 'staging',
    CRM_IDENTITY_ISSUER_CALLER_ENABLED: 'false',
    CRM_IDENTITY_ISSUER_CALLER_ID: 'crm-api-staging-v1',
    CRM_IDENTITY_ISSUER_CALLER_HMAC: 'synthetic-crm-identity-caller-hmac-secret-2026',
    IDENTITY_CRM_ISSUER: { fetch: async () => { issuerCalls += 1; return new Response('must-not-run'); } },
    CRM_CORE: { fetch: async () => { coreCalls += 1; return new Response('must-not-run'); } },
  };

  const subjectMissing = await sessionGateway(new Request('https://api-staging.skincos.com.br/crm/session'), { ...env, CRM_IDENTITY_ISSUER_CALLER_ENABLED: 'true' }, {});
  assert.equal(subjectMissing.status, 403);
  assert.equal((await subjectMissing.json()).error, 'CRM_IDENTITY_SUBJECT_REQUIRED');
  assert.equal(issuerCalls, 0);
  assert.equal(coreCalls, 0);

  actor = { ...actor, identitySubject: 'idn:session_identity_actor_0001' };
  const defaultOff = await sessionGateway(new Request('https://api-staging.skincos.com.br/crm/session'), env, {});
  assert.equal(defaultOff.status, 503);
  assert.equal((await defaultOff.json()).error, 'CRM_IDENTITY_DELIVERY_UNAVAILABLE');
  assert.equal(issuerCalls, 0);
  assert.equal(coreCalls, 0);
  resetBoundServiceResilienceForTest();
});

test('CRM session rejects query strings and non-GET requests before Identity or Core is called', async () => {
  let resolverCalls = 0;
  const sessionGateway = createApiGateway({
    inventoryHandler: async () => new Response('inventory-not-used'),
    resolveActor: async () => { resolverCalls += 1; return { actor: null, csrf: null }; },
    crmCoreHandler: async () => new Response('must-not-run'),
  });
  const query = await sessionGateway(new Request('https://api-staging.skincos.com.br/crm/session?unexpected=true'), { ENVIRONMENT: 'staging' }, {});
  assert.equal(query.status, 400);
  assert.equal((await query.json()).error, 'CRM_SESSION_QUERY_NOT_ALLOWED');
  const post = await sessionGateway(new Request('https://api-staging.skincos.com.br/crm/session', { method: 'POST' }), { ENVIRONMENT: 'staging' }, {});
  assert.equal(post.status, 405);
  assert.equal((await post.json()).error, 'CRM_SESSION_METHOD_NOT_ALLOWED');
  assert.equal(resolverCalls, 0);
});

test('CRM session has an exact staging CORS preflight and never resolves Identity for it', async () => {
  let resolverCalls = 0;
  let coreCalls = 0;
  const sessionGateway = createApiGateway({
    inventoryHandler: async () => new Response('inventory-not-used'),
    resolveActor: async () => { resolverCalls += 1; return { actor: null, csrf: null }; },
    crmCoreHandler: async () => { coreCalls += 1; return new Response('must-not-run'); },
  });
  const preflight = await sessionGateway(new Request('https://api-staging.skincos.com.br/crm/session', {
    method: 'OPTIONS',
    headers: {
      origin: 'https://crm-staging.skincos.com.br',
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'cache-control',
    },
  }), { ENVIRONMENT: 'staging' }, {});
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://crm-staging.skincos.com.br');
  assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
  assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET');
  assert.equal(preflight.headers.get('access-control-allow-headers'), 'accept, cache-control');
  assert.equal(resolverCalls, 0);
  assert.equal(coreCalls, 0);

  const projectionPreflight = await sessionGateway(new Request('https://api-staging.skincos.com.br/crm/projections?units=barra-shopping-sul,novo-hamburgo', {
    method: 'OPTIONS',
    headers: {
      origin: 'https://crm-staging.skincos.com.br',
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'accept',
    },
  }), { ENVIRONMENT: 'staging' }, {});
  assert.equal(projectionPreflight.status, 204);
  assert.equal(projectionPreflight.headers.get('access-control-allow-origin'), 'https://crm-staging.skincos.com.br');
  assert.equal(projectionPreflight.headers.get('access-control-allow-credentials'), 'true');
  assert.equal(resolverCalls, 0);
  assert.equal(coreCalls, 0);

  const deniedHeader = await sessionGateway(new Request('https://api-staging.skincos.com.br/crm/session', {
    method: 'OPTIONS',
    headers: {
      origin: 'https://crm-staging.skincos.com.br',
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'authorization',
    },
  }), { ENVIRONMENT: 'staging' }, {});
  assert.equal(deniedHeader.status, 400);
  assert.equal((await deniedHeader.json()).error, 'CRM_SESSION_CORS_PREFLIGHT_INVALID');
  assert.equal(deniedHeader.headers.get('access-control-allow-origin'), 'https://crm-staging.skincos.com.br');
  assert.equal(resolverCalls, 0);
  assert.equal(coreCalls, 0);
});

test('CRM session supplies credentialed CORS only to its exact staging origin', async () => {
  let resolverCalls = 0;
  const sessionGateway = createApiGateway({
    inventoryHandler: async () => new Response('inventory-not-used'),
    resolveActor: async () => { resolverCalls += 1; return { actor: null, csrf: null }; },
  });
  const allowed = await sessionGateway(new Request('https://api-staging.skincos.com.br/crm/session', {
    headers: { origin: 'https://crm-staging.skincos.com.br' },
  }), { ENVIRONMENT: 'staging' }, {});
  assert.equal(allowed.status, 401);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://crm-staging.skincos.com.br');
  assert.equal(allowed.headers.get('access-control-allow-credentials'), 'true');

  const denied = await sessionGateway(new Request('https://api-staging.skincos.com.br/crm/session', {
    headers: { origin: 'https://untrusted.example' },
  }), { ENVIRONMENT: 'staging' }, {});
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error, 'CRM_SESSION_CORS_ORIGIN_NOT_ALLOWED');
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
  assert.equal(resolverCalls, 1);
});

test('CRM session remains staging-only even when a production Core route is receipt-authorized', async () => {
  let resolverCalls = 0;
  let issuerCalls = 0;
  let receiptProbes = 0;
  let coreForwards = 0;
  const receipt = signedCrmProductionReceipt();
  const response = await handleGatewayRequest(new Request('https://api.skincos.com.br/crm/session'), crmProductionEnvironment(receipt, {
    CRM_IDENTITY_ISSUER_CALLER_ENABLED: 'true',
    CRM_IDENTITY_ISSUER_CALLER_HMAC: 'synthetic-crm-identity-caller-hmac-secret-2026',
    IDENTITY_CRM_ISSUER: { fetch: async () => { issuerCalls += 1; return new Response('must-not-run'); } },
    CRM_CORE: {
      fetch: async (request) => {
        if (new URL(request.url).pathname === '/ready') {
          receiptProbes += 1;
          return new Response(JSON.stringify(crmCoreReceiptReadyBody(receipt)), { headers: { 'content-type': 'application/json' } });
        }
        coreForwards += 1;
        return new Response('must-not-run');
      },
    },
  }), {});
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, 'CRM_CORE_STAGING_ONLY');
  assert.equal(receiptProbes, 1);
  assert.equal(issuerCalls, 0);
  assert.equal(coreForwards, 0);
  assert.equal(resolverCalls, 0);
});

test('CRM projections remain staging-only even when a production Core route is receipt-authorized', async () => {
  resetBoundServiceResilienceForTest();
  let issuerCalls = 0;
  let receiptProbes = 0;
  let coreForwards = 0;
  const receipt = signedCrmProductionReceipt();
  const response = await handleGatewayRequest(new Request('https://api.skincos.com.br/crm/projections?units=novo-hamburgo'), crmProductionEnvironment(receipt, {
    CRM_IDENTITY_ISSUER_CALLER_ENABLED: 'true',
    CRM_IDENTITY_ISSUER_CALLER_HMAC: 'synthetic-crm-identity-caller-hmac-secret-2026',
    IDENTITY_CRM_ISSUER: { fetch: async () => { issuerCalls += 1; return new Response('must-not-run'); } },
    CRM_CORE: {
      fetch: async (request) => {
        if (new URL(request.url).pathname === '/ready') {
          receiptProbes += 1;
          return new Response(JSON.stringify(crmCoreReceiptReadyBody(receipt)), { headers: { 'content-type': 'application/json' } });
        }
        coreForwards += 1;
        return new Response('must-not-run');
      },
    },
  }), {});
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, 'CRM_CORE_STAGING_ONLY');
  assert.equal(receiptProbes, 1);
  assert.equal(issuerCalls, 0);
  assert.equal(coreForwards, 0);
  resetBoundServiceResilienceForTest();
});

test('CRM Core keeps its Core-owned CORS origin while omitting unneeded preflight negotiation headers', async () => {
  resetBoundServiceResilienceForTest();
  let received = null;
  const response = await handleGatewayRequest(new Request('https://api-staging.skincos.com.br/crm', {
    method: 'OPTIONS',
    headers: {
      origin: 'https://crm-staging.skincos.com.br',
      'access-control-request-headers': 'content-type,x-identity-delivery',
      'access-control-request-method': 'POST',
      'x-skincos-service-token': 'synthetic-service-token',
      'x-forwarded-for': '203.0.113.10',
    },
  }), {
    ENVIRONMENT: 'staging',
    CRM_CORE: {
      fetch: async (request) => {
        received = request;
        return new Response(null, { status: 204 });
      },
    },
  }, {});

  assert.equal(response.status, 204);
  assert.equal(received.method, 'OPTIONS');
  // Core's preflight contract derives its static method/header response from
  // Origin alone; these browser negotiation headers are not part of its
  // service-binding contract and must not broaden the forwarding boundary.
  assert.equal(received.headers.get('origin'), 'https://crm-staging.skincos.com.br');
  assert.equal(received.headers.get('access-control-request-headers'), null);
  assert.equal(received.headers.get('access-control-request-method'), null);
  assert.equal(received.headers.get('x-skincos-service-token'), null);
  assert.equal(received.headers.get('x-forwarded-for'), null);
  resetBoundServiceResilienceForTest();
});

test('CRM Core never becomes a production route even if a binding is present', async () => {
  let calls = 0;
  const response = await handleGatewayRequest(new Request('https://api.skincos.com.br/crm/health'), {
    ENVIRONMENT: 'production',
    CRM_CORE: { fetch: async () => { calls += 1; return new Response('must-not-run'); } },
  }, {});
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, 'crm_core_production_not_authorized');
  assert.equal(calls, 0);
});

test('CRM Core production routing requires a signed receipt, pinned Worker version and matching live proof', async () => {
  resetBoundServiceResilienceForTest();
  const receipt = signedCrmProductionReceipt();
  let received = null;
  let probes = 0;
  const response = await handleGatewayRequest(new Request('https://api.skincos.com.br/crm/health?cutover=probe', {
    headers: {
      accept: 'application/json',
      authorization: 'must-not-cross',
      cookie: 'must-not-cross',
      'cloudflare-workers-version-overrides': 'skincos-evil="33333333-3333-4333-8333-333333333333"',
      'x-request-id': 'crm-production-gate-1',
      'x-identity-delivery': 'identity-crm-delivery/v1.synthetic-envelope',
    },
  }), crmProductionEnvironment(receipt, {
    CRM_CORE: {
      fetch: async (request) => {
        const pathname = new URL(request.url).pathname;
        assert.equal(
          request.headers.get('cloudflare-workers-version-overrides'),
          `skincos-crm-core="${receipt.workerVersionId}"`,
        );
        if (pathname === '/ready') {
          probes += 1;
          assert.equal(request.headers.get('authorization'), null);
          assert.equal(request.headers.get('cookie'), null);
          assert.equal(request.headers.get('x-identity-delivery'), null);
          return new Response(JSON.stringify(crmCoreReceiptReadyBody(receipt)), {
            headers: { 'content-type': 'application/json; charset=utf-8' },
          });
        }
        received = request;
        return new Response(JSON.stringify({ ok: true, unit: 'crm-core' }), {
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      },
    },
  }), {});

  assert.equal(response.status, 200);
  assert.equal((await response.json()).unit, 'crm-core');
  assert.equal(probes, 1);
  assert.equal(new URL(received.url).pathname, '/crm/health');
  assert.equal(new URL(received.url).search, '?cutover=probe');
  assert.equal(received.headers.get('accept'), 'application/json');
  assert.equal(received.headers.get('x-request-id'), 'crm-production-gate-1');
  assert.equal(received.headers.get('x-identity-delivery'), 'identity-crm-delivery/v1.synthetic-envelope');
  assert.equal(received.headers.get('authorization'), null);
  assert.equal(received.headers.get('cookie'), null);
  assert.equal(
    received.headers.get('cloudflare-workers-version-overrides'),
    `skincos-crm-core="${receipt.workerVersionId}"`,
  );
  resetBoundServiceResilienceForTest();
});

test('CRM Core production never probes or forwards for a format-valid but unsigned receipt', async () => {
  const receipt = signedCrmProductionReceipt();
  receipt.signature = 'a'.repeat(86);
  let calls = 0;
  const response = await handleGatewayRequest(new Request('https://api.skincos.com.br/crm/health'), crmProductionEnvironment(receipt, {
    CRM_CORE: { fetch: async () => { calls += 1; return new Response('must-not-run'); } },
  }), {});
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, 'crm_core_production_not_authorized');
  assert.equal(calls, 0);
});

test('CRM Core production receipt must pin the executing gateway version before probing', async () => {
  const receipt = signedCrmProductionReceipt();
  let calls = 0;
  const response = await handleGatewayRequest(new Request('https://api.skincos.com.br/crm/health'), crmProductionEnvironment(receipt, {
    CF_VERSION_METADATA: { id: '33333333-3333-4333-8333-333333333333' },
    CRM_CORE: { fetch: async () => { calls += 1; return new Response('must-not-run'); } },
  }), {});
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, 'crm_core_production_not_authorized');
  assert.equal(calls, 0);
});

test('direct CRM forwarding cannot trust a caller-supplied version-shaped receipt', async () => {
  let calls = 0;
  const response = await forwardCrmCoreToService(
    new Request('https://api.skincos.com.br/crm/health'),
    {
      ENVIRONMENT: 'production',
      CRM_CORE: { fetch: async () => { calls += 1; return new Response('must-not-run'); } },
    },
    undefined,
    { service: 'skincos-crm-core', workerVersionId: crmProductionWorkerVersionId },
  );
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, 'CRM_CORE_PRODUCTION_NOT_AUTHORIZED');
  assert.equal(calls, 0);
});

test('CRM Core production rejects a signed receipt when the pinned Worker proof disagrees', async () => {
  const receipt = signedCrmProductionReceipt();
  let probes = 0;
  let forwards = 0;
  const response = await handleGatewayRequest(new Request('https://api.skincos.com.br/crm/health'), crmProductionEnvironment(receipt, {
    CRM_CORE: {
      fetch: async (request) => {
        if (new URL(request.url).pathname === '/ready') {
          probes += 1;
          return new Response(JSON.stringify(crmCoreReceiptReadyBody(receipt, { artifactDigest: `sha256:${'c'.repeat(64)}` })), {
            headers: { 'content-type': 'application/json; charset=utf-8' },
          });
        }
        forwards += 1;
        return new Response('must-not-run');
      },
    },
  }), {});
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, 'crm_core_production_not_authorized');
  assert.equal(probes, 1);
  assert.equal(forwards, 0);
});

test('CRM Core rejects a production flag without receipt identity', async () => {
  let calls = 0;
  const response = await handleGatewayRequest(new Request('https://api.skincos.com.br/crm/health'), {
    ENVIRONMENT: 'production',
    CRM_CORE_PRODUCTION_ENABLED: 'true',
    CRM_CORE: { fetch: async () => { calls += 1; return new Response('must-not-run'); } },
  }, {});
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, 'crm_core_production_not_authorized');
  assert.equal(calls, 0);
});

test('CRM Core fails closed without its staging binding and never aliases legacy /api/crm', async () => {
  resetBoundServiceResilienceForTest();
  const unavailable = await handleGatewayRequest(new Request('https://api-staging.skincos.com.br/crm/health'), {
    ENVIRONMENT: 'staging',
  }, {});
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).dependency, 'CRM_CORE');

  let calls = 0;
  const legacyAlias = await handleGatewayRequest(new Request('https://api-staging.skincos.com.br/api/crm/health'), {
    ENVIRONMENT: 'staging',
    CRM_CORE: { fetch: async () => { calls += 1; return new Response('must-not-run'); } },
  }, {});
  assert.equal(legacyAlias.status, 404);
  assert.equal((await legacyAlias.json()).error, 'route_not_found');
  assert.equal(calls, 0);
  resetBoundServiceResilienceForTest();
});

test('general API Worker binds CRM Core only in the staging environment', async () => {
  const config = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
  const productionConfig = config.slice(0, config.indexOf('[env.staging]'));
  assert.doesNotMatch(productionConfig, /binding\s*=\s*"CRM_CORE"/);
  assert.doesNotMatch(productionConfig, /IDENTITY_CRM_ISSUER|CRM_IDENTITY_ISSUER_CALLER/);
  assert.match(config, /\[\[env\.staging\.services\]\]\r?\nbinding = "CRM_CORE"\r?\nservice = "skincos-crm-core-staging"/);
  assert.match(config, /CRM_IDENTITY_ISSUER_CALLER_ENABLED\s*=\s*"false"/);
  assert.match(config, /\[\[env\.staging\.services\]\]\r?\nbinding = "IDENTITY_CRM_ISSUER"\r?\nservice = "skincos-identity-crm-delivery-staging"/);
});
