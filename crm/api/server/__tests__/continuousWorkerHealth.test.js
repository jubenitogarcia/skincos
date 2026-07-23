import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { createWorkerHealthServer } from '../workers/healthServer.js'

function request(port, path) {
    return new Promise((resolve, reject) => {
        const req = http.get({ host: '127.0.0.1', port, path }, (res) => {
            let body = ''
            res.on('data', (chunk) => { body += chunk })
            res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }))
        })
        req.on('error', reject)
    })
}

test('continuous worker reports health while readiness is unavailable', async () => {
    const runtime = createWorkerHealthServer({
        service: 'crm-continuous-workers',
        getStatus: () => ({ enabled: true, ready: false, dependencies: { database: 'unavailable' } }),
    })
    const address = await runtime.listen({ port: 0 })
    try {
        const health = await request(address.port, '/health')
        const readiness = await request(address.port, '/readiness')
        assert.equal(health.status, 200)
        assert.equal(health.body.ok, true)
        assert.equal(readiness.status, 503)
        assert.equal(readiness.body.ok, false)
        assert.equal(readiness.body.worker.dependencies.database, 'unavailable')
    } finally {
        await runtime.close()
    }
})

test('continuous worker readiness exposes only a ready worker', async () => {
    const runtime = createWorkerHealthServer({
        service: 'crm-continuous-workers',
        getStatus: () => ({ enabled: true, ready: true, dependencies: { database: 'ok' } }),
    })
    const address = await runtime.listen({ port: 0 })
    try {
        const readiness = await request(address.port, '/readiness')
        assert.equal(readiness.status, 200)
        assert.equal(readiness.body.status, 'ready')
    } finally {
        await runtime.close()
    }
})
