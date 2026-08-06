import test from 'node:test'
import assert from 'node:assert/strict'

import { __testables, createAtendimentoRouter } from '../routes.js'

function captureRoutes(commercialDataQualityStore) {
    const routes = new Map()
    const router = {
        use() { return router },
        get(path, handler) { routes.set(`GET ${path}`, handler); return router },
        post(path, handler) { routes.set(`POST ${path}`, handler); return router },
        put(path, handler) { routes.set(`PUT ${path}`, handler); return router },
        patch(path, handler) { routes.set(`PATCH ${path}`, handler); return router },
        delete(path, handler) { routes.set(`DELETE ${path}`, handler); return router },
    }
    createAtendimentoRouter({
        store: {},
        commercialDataQualityStore,
        routerFactory: () => router,
    })
    return routes
}

function response() {
    const state = { status: null, body: null }
    return {
        state,
        status(value) { state.status = value; return this },
        set() { return this },
        json(value) { state.body = value; return this },
    }
}

test('exposes the commercial data quality queue exclusively to a GESTOR', async () => {
    const calls = []
    const qualityStore = {
        async list(query, actor) {
            calls.push({ operation: 'list', query, actor })
            return { findings: [], metrics: { currentFindings: 0 } }
        },
        async refresh(actor) {
            calls.push({ operation: 'refresh', actor })
            return { refreshed: 12, findings: [] }
        },
        async update(id, payload, actor) {
            calls.push({ operation: 'update', id, payload, actor })
            return { finding: { id, status: 'acknowledged', revision: 2 } }
        },
        async events(id, query, actor) {
            calls.push({ operation: 'events', id, query, actor })
            return { events: [] }
        },
    }
    const routes = captureRoutes(qualityStore)
    const actor = { id: 'gestor-1', role: 'GESTOR', allowedModules: ['clientes'] }
    const findingId = '4bd4ef58-66a2-4e57-a818-fd482d241101'

    const list = response()
    await routes.get('GET /commercial/data-quality')({ atendimentoActor: actor, query: { severity: 'high' } }, list)
    assert.equal(list.state.status, 200)
    assert.deepEqual(list.state.body, { ok: true, findings: [], metrics: { currentFindings: 0 } })

    const refresh = response()
    await routes.get('POST /commercial/data-quality/refresh')({ atendimentoActor: actor }, refresh)
    assert.equal(refresh.state.status, 200)
    assert.equal(refresh.state.body.ok, true)
    assert.equal(refresh.state.body.refreshed, 12)

    const update = response()
    await routes.get('PATCH /commercial/data-quality/:id')({
        atendimentoActor: actor,
        params: { id: findingId },
        body: { expectedRevision: 1, status: 'acknowledged' },
    }, update)
    assert.deepEqual(update.state.body, { ok: true, finding: { id: findingId, status: 'acknowledged', revision: 2 } })

    const events = response()
    await routes.get('GET /commercial/data-quality/:id/events')({
        atendimentoActor: actor,
        params: { id: findingId },
        query: { limit: '20' },
    }, events)
    assert.deepEqual(events.state.body, { ok: true, events: [] })
    assert.deepEqual(calls.map((item) => item.operation), ['list', 'refresh', 'update', 'events'])
})

test('blocks a non-GESTOR before it reaches any data quality mutation or read', async () => {
    let called = false
    const routes = captureRoutes({
        async list() { called = true },
        async refresh() { called = true },
        async update() { called = true },
        async events() { called = true },
    })
    const blockedActor = { id: 'operator-1', role: 'INJETOR' }

    for (const [route, request] of [
        ['GET /commercial/data-quality', { query: {} }],
        ['POST /commercial/data-quality/refresh', {}],
        ['PATCH /commercial/data-quality/:id', { params: { id: '4bd4ef58-66a2-4e57-a818-fd482d241101' }, body: { expectedRevision: 1, status: 'acknowledged' } }],
        ['GET /commercial/data-quality/:id/events', { params: { id: '4bd4ef58-66a2-4e57-a818-fd482d241101' }, query: {} }],
    ]) {
        const res = response()
        await routes.get(route)({ atendimentoActor: blockedActor, ...request }, res)
        assert.equal(res.state.status, 403)
        assert.deepEqual(res.state.body, { ok: false, error: 'FORBIDDEN' })
    }
    assert.equal(called, false)
})

test('preserves a signed ADMIN global exception while retaining a declared unit scope', () => {
    const encoded = Buffer.from(JSON.stringify({ id: 'admin-1', role: 'ADMIN', allowedUnits: [] })).toString('base64url')
    const actor = __testables.parseActorHeader({ headers: { 'x-crm-user': encoded } })

    assert.equal(actor?.role, 'GESTOR')
    assert.equal(actor?.isGlobalAdmin, true)
    assert.equal(actor?.allowedUnitsDeclared, true)
})

test('marks an omitted GESTOR unit claim as absent rather than an empty scope', () => {
    const encoded = Buffer.from(JSON.stringify({ id: 'gestor-1', role: 'GESTOR' })).toString('base64url')
    const actor = __testables.parseActorHeader({ headers: { 'x-crm-user': encoded } })

    assert.equal(actor?.role, 'GESTOR')
    assert.equal(actor?.allowedUnits, undefined)
    assert.equal(actor?.allowedUnitsDeclared, false)
})
