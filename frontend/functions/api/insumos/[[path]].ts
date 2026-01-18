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

    const upstreamRequest = new Request(targetUrl.toString(), {
        method: request.method,
        headers,
        body: request.body,
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
        if (typeof getSetCookie === 'function') {
            const cookies = getSetCookie.call(upstream.headers) as string[]
            if (Array.isArray(cookies) && cookies.length) {
                outHeaders.delete('set-cookie')
                for (const c of cookies) outHeaders.append('Set-Cookie', c)
            }
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
