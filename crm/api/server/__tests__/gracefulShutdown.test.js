import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import http from 'node:http'
import { installGracefulShutdown } from '../gracefulShutdown.js'

test('graceful shutdown closes the HTTP listener after SIGTERM', async () => {
    const server = http.createServer((_req, res) => res.end('ok'))
    const signals = new EventEmitter()
    const logs = []
    let exitCode = null
    installGracefulShutdown({
        server,
        signalSource: signals,
        exit: (code) => { exitCode = code },
        logger: { log: (line) => logs.push(line) },
        timeoutMs: 1000,
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.equal(typeof address?.port, 'number')
    signals.emit('SIGTERM')
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(exitCode, 0)
    assert.equal(server.listening, false)
    assert.equal(logs.length, 2)
})
