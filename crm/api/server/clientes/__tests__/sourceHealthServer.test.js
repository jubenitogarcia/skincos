import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createClientesSourceHealthServer } from '../sourceHealthServer.js'

function request(port, path) {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, path }, (response) => {
            let body = ''; response.setEncoding('utf8'); response.on('data', (chunk) => { body += chunk }); response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }))
        })
        req.on('error', reject); req.end()
    })
}

test('health stays available while readiness reports database outage', async () => {
    const service = createClientesSourceHealthServer({ port: 0, getHealth: () => ({ database: { reachable: false } }), getReadiness: () => ({ ready: false, database: { reachable: false }, dependencies: { missing: ['database'] } }) })
    const address = await service.listen()
    try {
        const health = await request(address.port, '/health')
        const readiness = await request(address.port, '/readiness')
        assert.equal(health.status, 200); assert.equal(health.body.database.reachable, false)
        assert.equal(readiness.status, 503); assert.equal(readiness.body.ready, false)
    } finally { await service.close() }
})

test('readiness is 200 with database and dependencies available', async () => {
    const service = createClientesSourceHealthServer({ port: 0, getReadiness: () => ({ ready: true, database: { reachable: true }, queues: { ready: true }, dependencies: { ready: true } }), getOperationalView: () => [{ sourceId: 'source.test', recordsRead: 2 }] })
    const address = await service.listen()
    try {
        const readiness = await request(address.port, '/readiness')
        const sources = await request(address.port, '/sources')
        assert.equal(readiness.status, 200); assert.equal(readiness.body.queues.ready, true)
        assert.equal(sources.status, 200); assert.equal(sources.body.sources[0].sourceId, 'source.test')
    } finally { await service.close() }
})

test('health server rejects non-loopback bind and close releases the port', async () => {
    assert.throws(() => createClientesSourceHealthServer({ host: '0.0.0.0' }), /HOST_NOT_LOOPBACK/)
    const service = createClientesSourceHealthServer({ port: 0 })
    const address = await service.listen(); await service.close()
    const second = createClientesSourceHealthServer({ port: address.port })
    await second.listen(); await second.close()
})
