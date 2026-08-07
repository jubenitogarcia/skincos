import assert from 'node:assert/strict'
import test from 'node:test'

import { createAtendimentoRouter } from '../routes.js'

function captureRoutes(commercialSourceOperationsStore) {
    const routes = new Map()
    const router = {
        use() { return router },
        get(path, handler) { routes.set(`GET ${path}`, handler); return router },
        post() { return router },
        put() { return router },
        patch() { return router },
        delete() { return router },
    }
    createAtendimentoRouter({
        store: {},
        commercialDataQualityStore: {},
        commercialSourceOperationsStore,
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

test('source operations route projects only its operational allowlist', async () => {
    let calls = 0
    const routes = captureRoutes({
        async getOperationalView() {
            calls += 1
            return [{
                sourceId: 'atendimento.local_mirror', domain: 'atendimento', label: 'Espelho', required: true,
                requiredFor: ['identity'], status: 'complete', freshness: 'healthy', recordsRead: 2, recordsApplied: 1,
                snapshotComplete: true, retries: 0, error: { code: 'SOURCE_TIMEOUT', retryable: true },
                fingerprint: 'sha256:private', snapshotProof: { scopeHash: 'sha256:private' }, backupReference: 'backup.private',
                checkpoint: { cursorHash: 'sha256:private' }, rawRecord: 'must-not-appear',
            }]
        },
    })
    const res = response()
    await routes.get('GET /commercial/source-operations')({ atendimentoActor: { id: 'gestor-1', role: 'GESTOR' } }, res)
    assert.equal(res.state.status, 200)
    assert.equal(calls, 1)
    assert.deepEqual(res.state.body.sources, [{
        sourceId: 'atendimento.local_mirror', domain: 'atendimento', label: 'Espelho', required: true, requiredFor: ['identity'],
        status: 'complete', freshness: 'healthy', lastExecution: null, lastRead: null, lastSuccess: null, lastApplied: null,
        nextExecution: null, recordsRead: 2, recordsApplied: 1, divergences: 0, snapshotComplete: true, retries: 0,
        errors: 0, error: { code: 'SOURCE_TIMEOUT', retryable: true }, durationMs: 0, reconciliationRequired: false,
    }])
    assert.doesNotMatch(JSON.stringify(res.state.body), /private|must-not-appear/)
})

test('source operations denies non-managers and declared unit scopes before the store', async () => {
    let called = false
    const routes = captureRoutes({ async getOperationalView() { called = true; return [] } })
    for (const actor of [
        { id: 'operator-1', role: 'INJETOR' },
        { id: 'gestor-unit-1', role: 'GESTOR', allowedUnits: ['unit-a'], allowedUnitsDeclared: true },
    ]) {
        const res = response()
        await routes.get('GET /commercial/source-operations')({ atendimentoActor: actor }, res)
        assert.equal(res.state.status, 403)
    }
    assert.equal(called, false)
})

test('source operations fails closed without exposing a dependency failure', async () => {
    const routes = captureRoutes({ async getOperationalView() { throw new Error('postgres://private message') } })
    const res = response()
    await routes.get('GET /commercial/source-operations')({ atendimentoActor: { id: 'gestor-1', role: 'GESTOR' } }, res)
    assert.deepEqual(res.state, {
        status: 503,
        body: { ok: false, error: 'COMMERCIAL_SOURCE_OPERATIONS_UNAVAILABLE' },
    })
})
