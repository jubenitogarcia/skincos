import http from 'node:http'

function json(res, statusCode, body) {
    const payload = JSON.stringify(body)
    res.statusCode = statusCode
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.setHeader('content-length', Buffer.byteLength(payload))
    res.end(payload)
}

function readStatus(getStatus) {
    try {
        const value = typeof getStatus === 'function' ? getStatus() : getStatus
        return value && typeof value === 'object' ? value : { ready: false, error: 'status unavailable' }
    } catch {
        // Health is a public operational boundary. Never reflect exception
        // messages or stack details into its response.
        return { ready: false, error: 'status_unavailable' }
    }
}

export function createWorkerHealthServer({
    getStatus,
    host = process.env.CRM_CONTINUOUS_WORKER_HOST || '127.0.0.1',
    port = Number.parseInt(process.env.CRM_CONTINUOUS_WORKER_PORT || '8102', 10),
} = {}) {
    const server = http.createServer((req, res) => {
        const pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname
        if (req.method !== 'GET') {
            res.setHeader('allow', 'GET')
            return json(res, 405, { ok: false, error: 'method_not_allowed' })
        }

        if (pathname === '/health') {
            const status = readStatus(getStatus)
            return json(res, 200, { ok: true, status })
        }

        if (pathname === '/readiness') {
            const status = readStatus(getStatus)
            const ready = status.ready === true
            return json(res, ready ? 200 : 503, { ok: ready, status })
        }

        return json(res, 404, { ok: false, error: 'not_found' })
    })

    return {
        server,
        listen() {
            return new Promise((resolve, reject) => {
                const onError = (error) => {
                    server.off('listening', onListening)
                    reject(error)
                }
                const onListening = () => {
                    server.off('error', onError)
                    resolve(server.address())
                }
                server.once('error', onError)
                server.once('listening', onListening)
                server.listen(Number.isFinite(port) ? port : 8102, host)
            })
        },
        close() {
            if (!server.listening) return Promise.resolve()
            return new Promise((resolve, reject) => {
                server.close((error) => error ? reject(error) : resolve())
            })
        },
    }
}
