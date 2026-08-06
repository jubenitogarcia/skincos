import http from 'node:http'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1'])

function isLoopbackAddress(value) {
    const normalized = String(value || '').replace(/^::ffff:/i, '')
    return LOOPBACK_HOSTS.has(normalized)
}

function json(res, statusCode, payload) {
    const body = JSON.stringify(payload)
    res.writeHead(statusCode, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(body),
    })
    res.end(body)
}

export function createClientesSourceHealthServer({
    host = '127.0.0.1',
    port = 8103,
    getHealth = async () => ({ status: 'ok' }),
    getReadiness = async () => ({ ready: false, reason: 'not_configured' }),
    getOperationalView = async () => [],
    clock = () => new Date(),
} = {}) {
    if (!LOOPBACK_HOSTS.has(String(host))) throw new Error('CLIENTES_SOURCE_HEALTH_HOST_NOT_LOOPBACK')
    const startedAt = clock()
    const server = http.createServer(async (request, response) => {
        if (!isLoopbackAddress(request.socket.remoteAddress)) {
            json(response, 403, { error: 'loopback_only' })
            return
        }
        if (request.method !== 'GET') {
            response.setHeader('allow', 'GET')
            json(response, 405, { error: 'method_not_allowed' })
            return
        }
        const path = String(request.url || '').split('?')[0]
        try {
            if (path === '/health') {
                const payload = await getHealth()
                json(response, 200, { service: 'crm-clientes-source-operations', uptimeSeconds: Math.max(0, (clock().getTime() - startedAt.getTime()) / 1000), ...payload })
                return
            }
            if (path === '/readiness') {
                const payload = await getReadiness()
                json(response, payload?.ready === true ? 200 : 503, { service: 'crm-clientes-source-operations', ...payload })
                return
            }
            if (path === '/sources') {
                const payload = await getOperationalView()
                json(response, 200, { service: 'crm-clientes-source-operations', generatedAt: clock().toISOString(), sources: payload })
                return
            }
            json(response, 404, { error: 'not_found' })
        } catch (error) {
            json(response, path === '/readiness' || path === '/sources' ? 503 : 500, {
                error: path === '/readiness' ? 'readiness_unavailable' : 'operational_view_unavailable',
            })
        }
    })

    return {
        server,
        async listen() {
            await new Promise((resolve, reject) => {
                const onError = (error) => { server.off('listening', onListening); reject(error) }
                const onListening = () => { server.off('error', onError); resolve() }
                server.once('error', onError)
                server.once('listening', onListening)
                server.listen({ host, port })
            })
            return server.address()
        },
        async close() {
            if (!server.listening) return
            await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
        },
        address: () => server.address(),
    }
}

export const __testables = { isLoopbackAddress }
