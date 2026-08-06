import test from 'node:test'
import assert from 'node:assert/strict'
import { createClientesSourceOperationsService, isClientesSourceRuntimeDestinationSafe } from '../sourceService.js'

function healthDouble() {
    return { async listen() {}, async close() {}, address() { return { address: '127.0.0.1', port: 8103 } } }
}

test('service owns readiness and starts source runner only after dependencies are ready', async () => {
    let runnerRunning = false; let starts = 0; let stops = 0
    const runner = { isRunning: () => runnerRunning, getActiveSources: () => [], async start() { starts += 1; runnerRunning = true }, async stop() { stops += 1; runnerRunning = false } }
    const store = { async dependencyStatus() { return { ready: true, missing: [], database: 'synthetic', user: 'technical' } }, async refreshFindings() {}, async getOperationalView() { return [] } }
    const service = createClientesSourceOperationsService({ enabled: true, mode: 'dry-run', store, runner, healthServer: healthDouble() })
    await service.start()
    assert.equal(service.readiness().ready, true); assert.equal(starts, 1); assert.equal(service.health().jobs.catalog.length, 3)
    await service.stop(); assert.equal(stops, 1); assert.equal(service.readiness().ready, false)
})

test('runtime destination boundary rejects production and accepts loopback local/staging', () => {
    assert.equal(isClientesSourceRuntimeDestinationSafe('postgresql:///skincos_crm_local?host=/var/run/postgresql', 'local'), true)
    assert.equal(isClientesSourceRuntimeDestinationSafe('postgresql://skincos_staging_crm_app:synthetic@127.0.0.1:5432/skincos_staging?sslmode=require', 'staging'), true)
    assert.equal(isClientesSourceRuntimeDestinationSafe('postgresql://prod.example/skincos', 'local'), false)
    assert.throws(() => createClientesSourceOperationsService({ databaseUrl: 'postgresql://prod.example/prod', target: 'production' }), /TARGET_INVALID/)
})
