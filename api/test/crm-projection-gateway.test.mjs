import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiGateway } from '../src/gateway.js';
import { resetBoundServiceResilienceForTest } from '../../shared/service-adapters/cloudflare-service-binding.js';

const origins = ['https://crm-core-staging.skincos.com.br', 'https://crm-staging.skincos.com.br'];
const paths = ['/crm/session', '/crm/projections?units=novo-hamburgo'];
const actor = { identitySubject: 'idn:synthetic_gateway_actor_0001', role: 'CONSULTOR',
    scopes: { units: ['novo-hamburgo'], modules: ['clients'], permissions: [] } };

function setup({ auth = { actor }, coreResponse } = {}) {
    const observed = { resolver: 0, issuer: 0, core: 0 };
    const gateway = createApiGateway({
        inventoryHandler: async () => { throw new Error('Inventory fallback is forbidden'); },
        resolveActor: async () => { observed.resolver += 1; if (auth instanceof Error) throw auth; return auth; },
    });
    const env = {
        ENVIRONMENT: 'staging', CRM_IDENTITY_ISSUER_CALLER_ENABLED: 'true',
        CRM_IDENTITY_ISSUER_CALLER_ID: 'crm-api-staging-v1',
        CRM_IDENTITY_ISSUER_CALLER_HMAC: 'synthetic_gateway_caller_hmac_for_unit_tests_only',
        IDENTITY_CRM_ISSUER: { fetch: async () => {
            observed.issuer += 1;
            return new Response(JSON.stringify({ ok: true, version: 'identity-crm-delivery/v1',
                keyId: 'crm-staging-gateway-test', compact: 'test.header.signature' }), { headers: { 'content-type': 'application/json' } });
        } },
        CRM_CORE: { fetch: async (request) => {
            observed.core += 1;
            for (const name of ['cookie', 'authorization', 'x-csrf-token']) assert.equal(request.headers.get(name), null);
            assert.equal(request.headers.get('x-identity-delivery'), 'test.header.signature');
            if (coreResponse) return coreResponse(request);
            const requestId = request.headers.get('x-request-id');
            const value = new URL(request.url).pathname === '/crm/session'
                ? { ok: true, identity: actor, requestId }
                : { ok: true, contractVersion: 'crm-core/projection-read/v2', state: 'available',
                    scope: { mode: 'intersection', units: ['novo-hamburgo'] }, projections: [], count: 0, requestId };
            return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json', 'set-cookie': 'must-not-cross' } });
        } },
    };
    return { observed, env, call: (path, init = {}) => gateway(new Request(`https://api-staging.skincos.com.br${path}`, init), env, {}) };
}

test('both exact staging origins receive credentialed session and validated projection results', async () => {
    resetBoundServiceResilienceForTest();
    for (const origin of origins) for (const path of paths) {
        const fixture = setup();
        const result = await fixture.call(path, { headers: { origin, cookie: 'session=synthetic', authorization: 'synthetic',
            'x-identity-delivery': 'forged.browser.value' } });
        assert.equal(result.status, 200);
        assert.equal(result.headers.get('access-control-allow-origin'), origin);
        assert.equal(result.headers.get('access-control-allow-credentials'), 'true');
        assert.equal(result.headers.get('vary'), 'Origin');
        assert.equal(result.headers.get('set-cookie'), null);
        assert.deepEqual(fixture.observed, { resolver: 1, issuer: 1, core: 1 });
    }
    resetBoundServiceResilienceForTest();
});

test('both exact staging origins have bounded preflight without identity or Core calls', async () => {
    for (const origin of origins) for (const path of paths) {
        const fixture = setup();
        const allowed = await fixture.call(path, { method: 'OPTIONS', headers: { origin,
            'access-control-request-method': 'GET', 'access-control-request-headers': 'Accept, Cache-Control' } });
        assert.equal(allowed.status, 204);
        assert.equal(allowed.headers.get('access-control-allow-origin'), origin);
        assert.equal(allowed.headers.get('access-control-allow-methods'), 'GET');
        assert.equal(allowed.headers.get('access-control-allow-headers'), 'accept, cache-control');
        for (const headers of [
            { 'access-control-request-method': 'POST' },
            { 'access-control-request-method': 'GET', 'access-control-request-headers': 'x-identity-delivery' },
            { 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' },
        ]) {
            const denied = await fixture.call(path, { method: 'OPTIONS', headers: { origin, ...headers } });
            assert.equal(denied.status, 400);
            assert.equal(denied.headers.get('access-control-allow-origin'), origin);
        }
        assert.deepEqual(fixture.observed, { resolver: 0, issuer: 0, core: 0 });
    }
});

test('Pages previews, production, wildcard, null and lookalike origins fail before identity', async () => {
    for (const origin of [
        'https://skincos-crm-core-staging.pages.dev', 'https://7ffda591.skincos-crm-core-staging.pages.dev',
        'https://crm.skincos.com.br', 'https://crm-core-staging.skincos.com.br.evil.test',
        'https://crm-core-staging.skincos.com.br:444', 'http://crm-core-staging.skincos.com.br', '*', 'null',
    ]) for (const path of paths) for (const method of ['GET', 'OPTIONS']) {
        const fixture = setup();
        const denied = await fixture.call(path, { method, headers: { origin, 'access-control-request-method': 'GET' } });
        assert.equal(denied.status, 403, `${origin} ${method} ${path}`);
        assert.equal(denied.headers.get('access-control-allow-origin'), null);
        assert.equal(denied.headers.get('access-control-allow-credentials'), null);
        assert.deepEqual(fixture.observed, { resolver: 0, issuer: 0, core: 0 });
    }
});

test('allowed origins retain CORS on missing session and Identity resolver failures', async () => {
    for (const origin of origins) for (const path of paths) for (const [auth, status] of [
        [{ actor: null }, 401], [{ unavailable: true }, 503], [new Error('private resolver details'), 503],
    ]) {
        const fixture = setup({ auth });
        const result = await fixture.call(path, { headers: { origin } });
        assert.equal(result.status, status);
        assert.equal(result.headers.get('access-control-allow-origin'), origin);
        assert.equal(result.headers.get('access-control-allow-credentials'), 'true');
        assert.equal(fixture.observed.issuer, 0); assert.equal(fixture.observed.core, 0);
        assert.doesNotMatch(await result.text(), /private resolver/);
    }
});

test('projection query and methods fail closed with CORS before resolving identity', async () => {
    for (const path of [
        '/crm/projections', '/crm/projections?units=', '/crm/projections?units=all',
        '/crm/projections?units=unknown', '/crm/projections?units=nh', '/crm/projections?units=novo-hamburgo&units=barra-shopping-sul',
        '/crm/projections?units=novo-hamburgo%20', '/crm/projections?units=novo-hamburgo&extra=1',
    ]) for (const method of ['GET', 'OPTIONS']) {
        const fixture = setup();
        const result = await fixture.call(path, { method, headers: { origin: origins[0], 'access-control-request-method': 'GET' } });
        assert.equal(result.status, 400, `${method} ${path}`);
        assert.equal(result.headers.get('access-control-allow-origin'), origins[0]);
        assert.deepEqual(fixture.observed, { resolver: 0, issuer: 0, core: 0 });
    }
    for (const method of ['HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']) {
        const fixture = setup();
        const result = await fixture.call(paths[1], { method, headers: { origin: origins[0] } });
        assert.equal(result.status, 405);
        assert.deepEqual(fixture.observed, { resolver: 0, issuer: 0, core: 0 });
    }
});

test('projection scope cannot widen the server-owned actor even for ADMIN', async () => {
    for (const units of [[], ['barra-shopping-sul']]) {
        const fixture = setup({ auth: { actor: { ...actor, role: 'ADMIN', scopes: { ...actor.scopes, units } } } });
        const result = await fixture.call(paths[1], { headers: { origin: origins[0] } });
        assert.equal(result.status, 403);
        assert.equal((await result.json()).error, 'CRM_PROJECTION_SCOPE_FORBIDDEN');
        assert.equal(result.headers.get('access-control-allow-origin'), origins[0]);
        assert.deepEqual(fixture.observed, { resolver: 1, issuer: 0, core: 0 });
    }
});

test('projection contract failures are redacted and still expose exact-origin CORS', async () => {
    resetBoundServiceResilienceForTest();
    const fixture = setup({ coreResponse: () => new Response(JSON.stringify({ ok: true, email: 'private@example.test' }), {
        headers: { 'content-type': 'application/json', 'set-cookie': 'private', 'x-identity-delivery': 'private' },
    }) });
    const result = await fixture.call(paths[1], { headers: { origin: origins[0] } });
    assert.equal(result.status, 503);
    assert.equal(result.headers.get('access-control-allow-origin'), origins[0]);
    assert.equal(result.headers.get('access-control-allow-credentials'), 'true');
    assert.equal(result.headers.get('x-identity-delivery'), null);
    assert.equal(result.headers.get('set-cookie'), null);
    assert.deepEqual(await result.json(), { ok: false, error: 'CRM_PROJECTION_RESPONSE_INVALID' });
    resetBoundServiceResilienceForTest();
});
