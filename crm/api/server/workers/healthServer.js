import http from 'node:http'

function sendJson(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
}

export function createWorkerHealthServer({ service, getStatus }) {
    if (typeof getStatus !== 'function') throw new Error('getStatus is required')
    const server = http.createServer(async (req, res) => {
        const path = new URL(req.url || '/', 'http://localhost').pathname
        if (req.method !== 'GET' || !['/health', '/readiness'].includes(path)) {
            return sendJson(res, 404, { ok: false, error: 'NOT_FOUND' })
        }

        if (path === '/health') {
            return sendJson(res, 200, { ok: true, status: 'healthy', service, timestamp: new Date().toISOString() })
        }

        try {
            const worker = await getStatus()
            const ready = worker?.ready === true
            return sendJson(res, ready ? 200 : 503, {
                ok: ready,
                status: ready ? 'ready' : 'not_ready',
                service,
                worker,
                timestamp: new Date().toISOString(),
            })
        } catch {
            return sendJson(res, 503, { ok: false, status: 'not_ready', service, error: 'STATUS_UNAVAILABLE' })
        }
    })

    return {
        server,
        listen({ host = '127.0.0.1', port }) {
            return new Promise((resolve, reject) => {
                server.once('error', reject)
                server.listen(port, host, () => {
                    server.off('error', reject)
                    resolve(server.address())
                })
            })
        },
        close() {
            return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
        },
    }
}
