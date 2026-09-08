import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCrmProjectionPayload, validatedCrmProjectionResponse } from '../src/crm-projection-response.js';

const expected = { units: ['novo-hamburgo'], requestId: 'projection-read-test-1' };
const event = () => ({
    contractVersion: 'crm-projection-event/v2', id: 'event:synthetic_test_0001',
    projection: { reference: 'projection:synthetic_test_0001', kind: 'client-reference' },
    source: { owner: 'atendimento', reference: 'source:synthetic_test_0001' },
    unitScope: { unitSlug: 'novo-hamburgo' }, revision: 1, operation: 'upsert', occurredAt: '2026-09-08T00:00:00.000Z',
});
const payload = () => ({
    ok: true, contractVersion: 'crm-core/projection-read/v2', state: 'available',
    scope: { mode: 'intersection', units: ['novo-hamburgo'] }, projections: [event()], count: 1, requestId: expected.requestId,
});
const response = (value, options = {}) => new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' }, ...options,
});

test('projection gateway reconstructs the closed opaque v2 response without upstream headers', async () => {
    const value = payload();
    const result = await validatedCrmProjectionResponse(response(value, { headers: {
        'content-type': 'application/json', 'set-cookie': 'must-not-cross', 'x-identity-delivery': 'must-not-cross',
        'x-private': 'must-not-cross', 'location': 'https://untrusted.test', 'access-control-allow-origin': '*',
    } }), expected);
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), value);
    assert.deepEqual([...result.headers.keys()], ['cache-control', 'content-type']);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    const cloned = validateCrmProjectionPayload(value, expected);
    assert.notEqual(cloned, value);
    assert.notEqual(cloned.projections[0], value.projections[0]);
    assert.notEqual(cloned.scope.units, value.scope.units);
});

test('projection response rejects extra fields, v1, scope drift and malformed opaque events', async (t) => {
    const mutations = {
        'top-level PII': (v) => { v.email = 'private@example.test'; },
        'event PII': (v) => { v.projections[0].email = 'private@example.test'; },
        'nested PII': (v) => { v.projections[0].source.name = 'private name'; },
        'v1 response': (v) => { v.contractVersion = 'crm-core/projection-read/v1'; },
        'v1 event': (v) => { v.projections[0].contractVersion = 'crm-projection-event/v1'; },
        'wrong request': (v) => { v.requestId = 'another-request'; },
        'wrong scope': (v) => { v.scope.units = ['barra-shopping-sul']; },
        'wrong mode': (v) => { v.scope.mode = 'all'; },
        'missing scope': (v) => { v.scope.units = []; },
        'duplicate scope': (v) => { v.scope.units.push('novo-hamburgo'); },
        'wrong event unit': (v) => { v.projections[0].unitScope.unitSlug = 'barra-shopping-sul'; },
        'padded event unit': (v) => { v.projections[0].unitScope.unitSlug = ' novo-hamburgo '; },
        'wrong owner': (v) => { v.projections[0].source.owner = 'inventory'; },
        'invalid event id': (v) => { v.projections[0].id = 'private@example.test'; },
        'invalid projection id': (v) => { v.projections[0].projection.reference = 'user:private'; },
        'invalid source id': (v) => { v.projections[0].source.reference = 'user:private'; },
        'unknown kind': (v) => { v.projections[0].projection.kind = 'customer'; },
        'zero revision': (v) => { v.projections[0].revision = 0; },
        'fractional revision': (v) => { v.projections[0].revision = 1.5; },
        'unsafe revision': (v) => { v.projections[0].revision = Number.MAX_SAFE_INTEGER + 1; },
        'string revision': (v) => { v.projections[0].revision = '1'; },
        'unknown operation': (v) => { v.projections[0].operation = 'delete'; },
        'noncanonical date': (v) => { v.projections[0].occurredAt = '2026-09-08'; },
        'impossible date': (v) => { v.projections[0].occurredAt = '2026-02-31T00:00:00.000Z'; },
        'duplicate projection': (v) => { v.projections.push({ ...event(), id: 'event:synthetic_test_0002' }); v.count = 2; },
        'duplicate event id': (v) => { v.projections.push({ ...event(), projection: { reference: 'projection:synthetic_test_0002', kind: 'client-reference' } }); v.count = 2; },
        'count mismatch': (v) => { v.count = 0; },
        'oversized count': (v) => { v.projections = Array.from({ length: 101 }, event); v.count = 101; },
    };
    for (const [name, mutate] of Object.entries(mutations)) await t.test(name, async () => {
        const value = payload(); mutate(value);
        const result = await validatedCrmProjectionResponse(response(value), expected);
        assert.equal(result.status, 503);
        assert.deepEqual(await result.json(), { ok: false, error: 'CRM_PROJECTION_RESPONSE_INVALID' });
    });
});

test('projection response permits revoke and an empty authorized result', () => {
    const value = payload(); value.projections[0].operation = 'revoke';
    assert.equal(validateCrmProjectionPayload(value, expected).projections[0].operation, 'revoke');
    value.projections = []; value.count = 0;
    assert.deepEqual(validateCrmProjectionPayload(value, expected), value);
});

test('projection error bodies and redirects are never reflected to the browser', async () => {
    for (const status of [201, 301, 400, 401, 403, 404, 429, 500, 503]) {
        const result = await validatedCrmProjectionResponse(response({ email: 'private@example.test', compact: 'sensitive' }, { status }), expected);
        assert.equal(result.status, [400, 401, 403].includes(status) ? status : 503);
        assert.doesNotMatch(await result.text(), /private|sensitive|compact|email/);
        assert.deepEqual([...result.headers.keys()], ['cache-control', 'content-type']);
    }
});

test('projection response enforces content type, actual byte limit, UTF-8 and JSON syntax', async () => {
    const cases = [
        new Response('{}', { headers: { 'content-type': 'text/plain' } }),
        new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '131073' } }),
        new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '-1' } }),
        new Response(' '.repeat(128 * 1024 + 1), { headers: { 'content-type': 'application/json' } }),
        new Response(new Uint8Array([0xff, 0xfe]), { headers: { 'content-type': 'application/json' } }),
        new Response('{broken', { headers: { 'content-type': 'application/json' } }),
        new Response(null, { headers: { 'content-type': 'application/json' } }),
    ];
    for (const invalid of cases) assert.equal((await validatedCrmProjectionResponse(invalid, expected)).status, 503);
});

test('projection response cancels an unfinished body within its deadline', async () => {
    let cancelled = false;
    const stream = new ReadableStream({ start() {}, cancel() { cancelled = true; } });
    const result = await validatedCrmProjectionResponse(new Response(stream, { headers: { 'content-type': 'application/json' } }), expected, { timeoutMs: 5 });
    assert.equal(result.status, 503);
    assert.equal(cancelled, true);
});
