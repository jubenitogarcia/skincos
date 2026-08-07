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

test('SIGTERM closes the health listener before an in-flight job completes its graceful drain', async () => {
    let releaseDrain
    let signalDrainStarted
    const drainStarted = new Promise((resolve) => { signalDrainStarted = resolve })
    const drain = new Promise((resolve) => { releaseDrain = resolve })
    const harmonia = {
        getStatus: () => ({ ready: true, running: true, database: { configured: true, reachable: true }, queue: null }),
        stop: async () => {},
    }
    const runner = {
        jobs: [],
        start: async () => {},
        stop: async () => {
            signalDrainStarted()
            await drain
        },
        getStatus: () => ({ ready: true, running: true, jobs: {}, metrics: { errors: 0, retries: 0, lastExecutionAt: null }, statePersistence: { configured: true, ready: true } }),
    }
    const service = createContinuousWorkerService({
        env: {
            CRM_CONTINUOUS_WORKERS_ENABLED: '1',
            CRM_CONTINUOUS_JOBS_ENABLED: '0',
            CRM_CONTINUOUS_WORKER_HOST: '127.0.0.1',
            CRM_CONTINUOUS_WORKER_PORT: '0',
            DATABASE_URL: 'postgresql://local.test/crm',
        },
        harmoniaFactory: () => harmonia,
        runnerFactory: () => runner,
    })
    const { address } = await service.start()
    const base = `http://127.0.0.1:${address.port}`
    const stopping = service.stop()
    await drainStarted
    await eventuallyRefuses(`${base}/health`)
    releaseDrain()
    await stopping
})

test('continuous worker pins a requested assisted mode to read-only observe', async () => {
    let receivedMode = null
    const harmonia = {
        getStatus: () => ({ ready: true, running: true, database: { configured: true, reachable: true }, queue: null }),
        stop: async () => {},
    }
    const runner = {
        jobs: [],
        start: async () => {},
        stop: async () => {},
        getStatus: () => ({ ready: true, running: true, jobs: {}, metrics: { errors: 0, retries: 0, lastExecutionAt: null }, statePersistence: { configured: true, ready: true } }),
    }
    const service = createContinuousWorkerService({
        env: {
            CRM_CONTINUOUS_WORKERS_ENABLED: '1',
            CRM_CONTINUOUS_WORKERS_MODE: 'assisted',
            CRM_CONTINUOUS_WORKERS_ASSISTED_CONFIRMED: '1',
            CRM_CONTINUOUS_JOBS_ENABLED: '0',
            CRM_CONTINUOUS_WORKER_HOST: '127.0.0.1',
            CRM_CONTINUOUS_WORKER_PORT: '0',
            DATABASE_URL: 'postgresql://local.test/crm',
        },
        harmoniaFactory: ({ mode }) => {
            receivedMode = mode
            return harmonia
        },
        runnerFactory: () => runner,
    })
    await service.start()
    assert.equal(receivedMode, 'observe')
    assert.equal(service.getStatus().mode, 'observe')
    assert.equal(service.getStatus().assistedBlocked, true)
    await service.stop()
})

test('invalid or disabled modes never enable scheduled jobs', async () => {
    const received = []
    const harmonia = {
        getStatus: () => ({ ready: false, running: false, database: { configured: true, reachable: false }, queue: null }),
        stop: async () => {},
    }
    const runner = {
        jobs: [],
        start: async () => { received.push('start') },
        stop: async () => {},
        getStatus: () => ({ ready: false, running: false, jobs: {}, metrics: {}, statePersistence: { configured: true, ready: true } }),
    }
    const service = createContinuousWorkerService({
        env: {
            CRM_CONTINUOUS_WORKERS_ENABLED: '1',
            CRM_CONTINUOUS_WORKERS_MODE: 'unexpected',
            CRM_CONTINUOUS_JOBS_ENABLED: '1',
            CRM_CONTINUOUS_WORKER_HOST: '127.0.0.1',
            CRM_CONTINUOUS_WORKER_PORT: '0',
            DATABASE_URL: 'postgresql://local.test/crm',
        },
        harmoniaFactory: () => harmonia,
        runnerFactory: ({ enabled }) => {
            received.push(enabled ? 'enabled' : 'disabled')
            return runner
        },
    })
    await service.start()
    assert.deepEqual(received, ['disabled', 'start'])
    assert.equal(service.getStatus().mode, 'disabled')
    assert.equal(service.getStatus().invalidMode, true)
    await service.stop()
})
