// Lightweight mock webhook + token proxy server (for local dev only)
// @ts-ignore - Node environment when executed directly. For type safety install @types/node.
// Run with: ts-node or compile via ts-node-dev (not included). Illustrative only.
// Using require fallback to avoid bundler complaints if imported accidentally in browser bundle.
// @ts-ignore
const http = typeof require !== 'undefined' ? require('http') : null
// @ts-ignore
const { parse } = typeof require !== 'undefined' ? require('url') : { parse: () => ({ pathname: '' }) }
// @ts-ignore
const crypto = typeof require !== 'undefined' ? require('crypto') : { createHash: () => ({ update: () => ({ digest: () => 'hash' }) }) }
// @ts-ignore
const https = typeof require !== 'undefined' ? require('https') : null

let messages: any[] = []
let lastHashes = new Set<string>()

function hashMessage(m: any) {
    const base = `${m.id || ''}|${m.timestamp || ''}|${m.from || ''}|${m.text || ''}`
    return crypto.createHash('sha1').update(base).digest('hex')
}

function addMessage(m: any) {
    const h = hashMessage(m)
    if (lastHashes.has(h)) return false
    if (lastHashes.size > 5000) { // rotate
        lastHashes = new Set(Array.from(lastHashes).slice(-2500))
    }
    lastHashes.add(h)
    messages.push(m)
    return true
}

const server = http ? http.createServer(async (req: any, res: any) => {
    const url = parse(req.url || '', true)
    if (req.method === 'GET' && url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ ok: true }))
    }
    if (req.method === 'GET' && url.pathname === '/api/dm') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
        return res.end(JSON.stringify({ messages }))
    }
    if (req.method === 'POST' && url.pathname === '/api/ingest-dm') {
        let body = ''
        req.on('data', c => body += c)
        req.on('end', () => {
            try {
                const payload = JSON.parse(body || '{}')
                payload.timestamp = payload.timestamp || new Date().toISOString()
                addMessage(payload)
            } catch { }
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
            res.end(JSON.stringify({ ok: true }))
        })
        return
    }
    if (req.method === 'POST' && url.pathname === '/api/token/extend') {
        let body = ''
        req.on('data', c => body += c)
        req.on('end', () => {
            try {
                const { shortLivedToken, appId, appSecret } = JSON.parse(body || '{}')
                if (!shortLivedToken || !appId || !appSecret) {
                    res.writeHead(400); return res.end('missing params')
                }
                const exchangeUrl = `https://graph.facebook.com/v20.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortLivedToken}`
                https.get(exchangeUrl, r => {
                    let d = ''; r.on('data', c => d += c); r.on('end', () => {
                        res.writeHead(r.statusCode || 200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
                        res.end(d)
                    })
                }).on('error', err => { res.writeHead(500); res.end(JSON.stringify({ error: err.message })) })
            } catch (e: any) { res.writeHead(500); res.end(e.message) }
        })
        return
    }
    if (req.method === 'POST' && url.pathname === '/webhook/instagram') {
        let body = ''
        req.on('data', c => body += c)
        req.on('end', () => {
            try { const payload = JSON.parse(body || '{}'); addMessage({ id: Date.now(), ...payload }) } catch { }
            res.writeHead(200); res.end('ok')
        })
        return
    }
    res.writeHead(404); res.end('not found')
}) : { listen: () => { } }

try {
    // @ts-ignore
    if (typeof require !== 'undefined' && require.main === module) {
        // @ts-ignore
        const port = process.env.PORT || 7070
        server.listen(port, () => console.log('Mock webhook server listening on', port))
    }
} catch { }

export default server
