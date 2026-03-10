import { copySetCookieHeaders, proxyRequestBody, sanitizeProxyRequestHeaders } from '../../_lib/proxy'

export async function onRequest(context: any): Promise<Response> {
    const request: Request = context.request
    const url = new URL(request.url)

    // Incoming:  /api/insumos/<rest>
    // Outgoing:  https://api.skincos.com.br/insumos/<rest>
    const prefix = '/api/insumos'
    const rest = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) || '/' : url.pathname

    const targetOrigin = (context.env?.INSUMOS_API_TARGET as string | undefined) || 'https://api.skincos.com.br'
    const isProductionTarget = (() => {
        const raw = String(targetOrigin || '').trim().toLowerCase()
        return raw === 'https://api.skincos.com.br' || raw.endsWith('.skincos.com.br')
    })()

    if (rest === '/_proxy-status' || rest === '/_proxy-status/') {
        return new Response(
            JSON.stringify({
                ok: true,
                localDirect: false,
                target: targetOrigin,
                isProductionTarget,
                localSafeMode: false,
                mutationsBlocked: false
            }),
            {
                status: 200,
                headers: {
                    'content-type': 'application/json',
                    'cache-control': 'no-store'
                }
            }
        )
    }

    const targetUrl = new URL(targetOrigin)
    targetUrl.pathname = `/insumos${rest.startsWith('/') ? '' : '/'}${rest}`
    targetUrl.search = url.search

    const headers = sanitizeProxyRequestHeaders(request.headers)
    const clientIp = headers.get('cf-connecting-ip') || headers.get('x-forwarded-for')?.split(',')?.[0]?.trim()
    if (clientIp) headers.set('x-skincos-client-ip', clientIp)

    const method = (request.method || 'GET').toUpperCase()
    const body = proxyRequestBody(method, request)

    const upstreamRequest = new Request(targetUrl.toString(), {
        method,
        headers,
        body,
        redirect: 'manual'
    })

    const upstream = await fetch(upstreamRequest)

    // Ensure Set-Cookie survives the proxy (needed for session auth).
    const outHeaders = new Headers(upstream.headers)

    // Avoid caching API and especially auth routes.
    outHeaders.set('Cache-Control', 'no-store')

    try {
        const rewriteCookie = (cookie: string) => {
            if (!cookie) return cookie
            const parts = cookie.split(';').map(part => part.trim()).filter(Boolean)
            if (!parts.length) return cookie
            const [nameValue, ...attrs] = parts
            const filtered = attrs.filter(attr => !attr.toLowerCase().startsWith('domain='))
            return [nameValue, ...filtered].join('; ')
        }
        copySetCookieHeaders(upstream.headers, outHeaders, rewriteCookie)
    } catch {
        // ignore
    }

    if (rest.startsWith('/share/history') && upstream.status === 404) {
        return new Response(
            JSON.stringify({ success: true, data: [], source: 'proxy-fallback', error: 'NOT_AVAILABLE' }),
            { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }
        )
    }

    return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: outHeaders
    })
}
