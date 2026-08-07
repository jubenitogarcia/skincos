import assert from 'node:assert/strict'
import test from 'node:test'

import { assertWorkerHealthHost, createWorkerHealthServer } from '../workers/healthServer.js'

test('health interface refuses non-loopback bindings', () => {
    assert.throws(() => createWorkerHealthServer({ host: '0.0.0.0' }), (error) => error.code === 'WORKER_HEALTH_HOST_NOT_ALLOWED')
    assert.equal(assertWorkerHealthHost('127.0.0.1'), '127.0.0.1')
    assert.equal(assertWorkerHealthHost('::1'), '::1')
})

test('continuous worker health and readiness endpoints expose safe status', async () => {
    let status = { ready: false, mode: 'observe' }
    const health = createWorkerHealthServer({ getStatus: () => status, port: 0 })
    const address = await health.listen()
    const base = `http://127.0.0.1:${address.port}`

    const healthResponse = await fetch(`${base}/health`)
    assert.equal(healthResponse.status, 200)
    assert.equal((await healthResponse.json()).status.mode, 'observe')

    const notReady = await fetch(`${base}/readiness`)
    assert.equal(notReady.status, 503)

    status = { ready: true, mode: 'observe' }
    const ready = await fetch(`${base}/readiness`)
    assert.equal(ready.status, 200)
    assert.equal((await ready.json()).ok, true)

    const missing = await fetch(`${base}/unknown`)
    assert.equal(missing.status, 404)
    await health.close()
})

test('health never reflects an exception message', async () => {
    const health = createWorkerHealthServer({
        getStatus: () => { throw new Error('database password or stack detail') },
        port: 0,
    })
    const address = await health.listen()
    const response = await fetch(`http://127.0.0.1:${address.port}/health`)
    const body = await response.json()
    assert.equal(body.status.error, 'status_unavailable')
    assert.equal(JSON.stringify(body).includes('database password'), false)
    await health.close()
})
