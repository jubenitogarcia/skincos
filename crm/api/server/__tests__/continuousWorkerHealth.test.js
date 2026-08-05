import assert from 'node:assert/strict'
import test from 'node:test'

import { createWorkerHealthServer } from '../workers/healthServer.js'

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
