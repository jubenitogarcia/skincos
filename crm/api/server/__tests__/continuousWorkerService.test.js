import assert from 'node:assert/strict'
import test from 'node:test'

import { createContinuousWorkerService } from '../workers/continuousService.js'

async function eventuallyRefuses(url) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
            await fetch(url)
        } catch {
            return
        }
        await new Promise((resolve) => setTimeout(resolve, 5))
    }
    assert.fail('the health port remained open after shutdown')
}

test('health stays live while readiness reflects a database outage, then SIGTERM frees the port', async () => {
    let databaseReady = false
    let jobsReady = false
    let harmoniaStopped = false
    const harmonia = {
        getStatus: () => ({
            ready: databaseReady,
            running: !harmoniaStopped,
            database: { configured: true, reachable: databaseReady },
            queue: { oldestPendingAt: null, oldestProcessingAt: null },
            lastSuccessAt: databaseReady ? new Date().toISOString() : null,
            errorCount: databaseReady ? 0 : 1,
        }),
        stop: async () => { harmoniaStopped = true },
    }
    const runner = {
        jobs: [{ id: 'clientes.fake', intervalMs: 1000, required: true }],
        start: async () => {},
        stop: async () => {},
        getStatus: () => ({
            ready: jobsReady,
            running: true,
            jobs: {},
            metrics: { errors: 0, retries: 0, lastExecutionAt: null },
            statePersistence: { configured: true, ready: true },
        }),
    }
    const service = createContinuousWorkerService({
        env: {
            CRM_CONTINUOUS_WORKERS_ENABLED: '1',
            CRM_CONTINUOUS_WORKERS_MODE: 'observe',
            CRM_CONTINUOUS_JOBS_ENABLED: '1',
            CRM_CONTINUOUS_WORKER_HOST: '127.0.0.1',
            CRM_CONTINUOUS_WORKER_PORT: '0',
            DATABASE_URL: 'postgresql://local.test/crm',
        },
        harmoniaFactory: () => harmonia,
        poolFactory: () => ({ end: async () => {} }),
        jobsFactory: () => [],
        runnerFactory: () => runner,
    })

    const { address } = await service.start()
    const base = `http://127.0.0.1:${address.port}`
    const health = await fetch(`${base}/health`)
    assert.equal(health.status, 200)
    const notReady = await fetch(`${base}/readiness`)
    assert.equal(notReady.status, 503)

    databaseReady = true
    jobsReady = true
    const ready = await fetch(`${base}/readiness`)
    assert.equal(ready.status, 200)
    assert.equal((await ready.json()).status.dependencies.database.reachable, true)

    await service.stop()
    assert.equal(harmoniaStopped, true)
    await eventuallyRefuses(`${base}/health`)
})
