import test from 'node:test'
import assert from 'node:assert/strict'
import { createAtendimentoRouter } from '../routes.js'

function capture(store) {
    const routes = new Map()
    const router = {
        use() { return router },
        get(path, handler) { routes.set(`GET ${path}`, handler); return router },
        post(path, handler) { routes.set(`POST ${path}`, handler); return router },
        put(path, handler) { routes.set(`PUT ${path}`, handler); return router },
        patch(path, handler) { routes.set(`PATCH ${path}`, handler); return router },
        delete(path, handler) { routes.set(`DELETE ${path}`, handler); return router },
    }
    createAtendimentoRouter({ store, routerFactory: () => router })
    return routes
}

function response() {
    const state = { status: null, body: null }
    return { state, status(value) { state.status = value; return this }, set() { return this }, json(value) { state.body = value; return this } }
}

test('keeps all canary routes behind the commercial manager boundary and forwards the actor', async () => {
    const calls = []
    const store = Object.fromEntries([
        ['commercialCanaryState', async (actor) => { calls.push(['state', actor]); return { ready: true } }],
        ['commercialCanaryCandidates', async (query, actor) => { calls.push(['candidates', query, actor]); return { candidates: [] } }],
        ['commercialCanaryPreview', async (body, actor) => { calls.push(['preview', body, actor]); return { preview: {} } }],
        ['validateCommercialCanaryIdentity', async (body, actor) => { calls.push(['validate', body, actor]); return { validationStatus: 'explicit_approved' } }],
        ['saveCommercialCanary', async (body, actor) => { calls.push(['save', body, actor]); return { messagesSent: 0 } }],
        ['removeCommercialCanary', async (body, actor) => { calls.push(['remove', body, actor]); return { messagesSent: 0 } }],
        ['emergencyOffCommercialCanary', async (body, actor) => { calls.push(['off', body, actor]); return { messagesSent: 0 } }],
        ['rollbackCommercialCanary', async (body, actor) => { calls.push(['rollback', body, actor]); return { messagesSent: 0 } }],
    ])
    const routes = capture(store)
    const actor = { id: 'gestor-1', role: 'GESTOR' }
    const requests = [
        ['GET /commercial/canary/state', { query: {} }],
        ['GET /commercial/canary/candidates', { query: { q: 'Ana' } }],
        ['POST /commercial/canary/preview', { body: { candidateRefs: ['ref'] } }],
        ['POST /commercial/canary/identities/validate', { body: { candidateRef: 'ref' } }],
        ['POST /commercial/canary', { body: { candidateRefs: ['ref'] } }],
        ['POST /commercial/canary/remove', { body: {} }],
        ['POST /commercial/canary/emergency-off', { body: {} }],
        ['POST /commercial/canary/rollback', { body: {} }],
    ]
    for (const [path, request] of requests) {
        const res = response()
        await routes.get(path)({ atendimentoActor: actor, ...request }, res)
        assert.equal(res.state.status, 200, path)
    }
    assert.deepEqual(calls.map((call) => call[0]), ['state', 'candidates', 'preview', 'validate', 'save', 'remove', 'off', 'rollback'])
    assert.ok(calls.every((call) => call.at(-1) === actor))

    const blocked = response()
    await routes.get('GET /commercial/canary/state')({ atendimentoActor: { id: 'operator-1', role: 'GERENTE' }, query: {} }, blocked)
    assert.equal(blocked.state.status, 403)
    assert.deepEqual(blocked.state.body, { ok: false, error: 'FORBIDDEN' })
})
