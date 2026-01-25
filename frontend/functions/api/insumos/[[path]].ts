export async function onRequest(context: any): Promise<Response> {
    const request: Request = context.request
    const url = new URL(request.url)

    // Incoming:  /api/insumos/<rest>
    // Outgoing:  https://api.skincos.com.br/insumos/<rest>
    const prefix = '/api/insumos'
    const rest = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) || '/' : url.pathname

    const targetOrigin = (context.env?.INSUMOS_API_TARGET as string | undefined) || 'https://api.skincos.com.br'
    const targetUrl = new URL(targetOrigin)
    targetUrl.pathname = `/insumos${rest.startsWith('/') ? '' : '/'}${rest}`
    targetUrl.search = url.search

    const headers = new Headers(request.headers)
    headers.delete('host')
    headers.delete('content-length')
    headers.delete('content-encoding')
    headers.delete('transfer-encoding')
    headers.delete('connection')

    const method = (request.method || 'GET').toUpperCase()
    const body = method === 'GET' || method === 'HEAD' ? undefined : request.body

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

    // Cloudflare-specific: preserve multiple Set-Cookie headers.
    try {
        const getSetCookie = (upstream.headers as any).getSetCookie
        const rewriteCookie = (cookie: string) => {
            if (!cookie) return cookie
            const parts = cookie.split(';').map(part => part.trim()).filter(Boolean)
            if (!parts.length) return cookie
            const [nameValue, ...attrs] = parts
            const filtered = attrs.filter(attr => !attr.toLowerCase().startsWith('domain='))
            return [nameValue, ...filtered].join('; ')
        }
        const applyCookies = (cookies: string[]) => {
            if (!Array.isArray(cookies) || !cookies.length) return
            outHeaders.delete('set-cookie')
            for (const c of cookies) outHeaders.append('Set-Cookie', rewriteCookie(c))
        }

        if (typeof getSetCookie === 'function') {
            const cookies = getSetCookie.call(upstream.headers) as string[]
            applyCookies(cookies)
        } else {
            const single = upstream.headers.get('set-cookie')
            if (single) applyCookies([single])
        }
    } catch {
        // ignore
    }

    return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: outHeaders
    })
}
