import test from 'node:test'
import assert from 'node:assert/strict'

import { createAtendimentoRouter } from '../routes.js'

function captureRoutes(store) {
    const routes = new Map()
    const router = {
        use() { return router },
        get(path, handler) { routes.set(`GET ${path}`, handler); return router },
        post(path, handler) { routes.set(`POST ${path}`, handler); return router },
        put(path, handler) { routes.set(`PUT ${path}`, handler); return router },
        patch(path, handler) { routes.set(`PATCH ${path}`, handler); return router },
        delete(path, handler) { routes.set(`DELETE ${path}`, handler); return router },
    }
    createAtendimentoRouter({ store, commercialDataQualityStore: {}, routerFactory: () => router })
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

test('canary routes are GESTOR-only and preserve the separate rollout contract', async () => {
    const calls = []
    const store = {
        async commercialCanaryState(query, actor) { calls.push(['state', query, actor]); return { canary: { ready: true } } },
        async commercialCanaryCandidates(query, actor) { calls.push(['candidates', query, actor]); return { candidates: [] } },
        async previewCommercialCanary(payload, actor) { calls.push(['preview', payload, actor]); return { canApply: false } },
        async validateCommercialCanaryIdentity(payload, actor) { calls.push(['validate', payload, actor]); return { validation: { revision: 1 } } },
        async saveCommercialCanary(payload, actor) { calls.push(['save', payload, actor]); return { commercialWritesEnabled: false, messagesSent: 0 } },
        async removeCommercialCanary(payload, actor) { calls.push(['remove', payload, actor]); return { commercialWritesEnabled: false, messagesSent: 0 } },
        async emergencyOffCommercialCanary(payload, actor) { calls.push(['off', payload, actor]); return { emergencyOff: true, messagesSent: 0 } },
    }
    const routes = captureRoutes(store)
    const actor = { id: 'gestor-1', role: 'GESTOR', allowedModules: ['clientes'] }
    const payload = { unit: 'centro', confirmed: true }
    const cases = [
        ['GET /commercial/canary/state', { query: { unit: 'centro' } }, 'state'],
        ['GET /commercial/canary/candidates', { query: { unit: 'centro' } }, 'candidates'],
        ['POST /commercial/canary/preview', { body: payload }, 'preview'],
        ['POST /commercial/canary/identities/validate', { body: payload }, 'validate'],
        ['POST /commercial/canary', { body: payload }, 'save'],
        ['POST /commercial/canary/remove', { body: payload }, 'remove'],
        ['POST /commercial/canary/emergency-off', { body: payload }, 'off'],
    ]
    for (const [route, request, operation] of cases) {
        const res = response()
        await routes.get(route)({ atendimentoActor: actor, ...request }, res)
        assert.equal(res.state.status, 200, route)
        assert.equal(res.state.body.ok, true, route)
        assert.equal(calls.at(-1)[0], operation)
    }
    assert.equal(calls.find(([operation]) => operation === 'save')[1], payload)
})

test('a non-GESTOR cannot query, simulate or mutate a commercial canary', async () => {
    let called = false
    const store = new Proxy({}, { get() { return async () => { called = true } } })
    const routes = captureRoutes(store)
    const blocked = { id: 'operator-1', role: 'INJETOR' }
    for (const [route, request] of [
        ['GET /commercial/canary/state', { query: {} }],
        ['GET /commercial/canary/candidates', { query: {} }],
        ['POST /commercial/canary/preview', { body: {} }],
        ['POST /commercial/canary/identities/validate', { body: {} }],
        ['POST /commercial/canary', { body: {} }],
        ['POST /commercial/canary/remove', { body: {} }],
        ['POST /commercial/canary/emergency-off', { body: {} }],
    ]) {
        const res = response()
        await routes.get(route)({ atendimentoActor: blocked, ...request }, res)
        assert.equal(res.state.status, 403, route)
        assert.deepEqual(res.state.body, { ok: false, error: 'FORBIDDEN' })
    }
    assert.equal(called, false)
})
