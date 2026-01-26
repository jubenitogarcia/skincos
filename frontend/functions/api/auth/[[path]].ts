export async function onRequest(context: any): Promise<Response> {
    const request: Request = context.request
    const url = new URL(request.url)

    // Incoming:  /api/auth/<rest>
    // Outgoing:  https://api.skincos.com.br/insumos/auth/<rest>
    const prefix = '/api/auth'
    const rest = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) || '/' : url.pathname

    const targetOrigin = (context.env?.INSUMOS_API_TARGET as string | undefined) || 'https://api.skincos.com.br'
    const targetUrl = new URL(targetOrigin)
    targetUrl.pathname = `/insumos/auth${rest.startsWith('/') ? '' : '/'}${rest}`
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

    const outHeaders = new Headers(upstream.headers)
    outHeaders.set('Cache-Control', 'no-store')

    try {
        const splitSetCookie = (headerValue: string): string[] => {
            const raw = String(headerValue || '').trim()
            if (!raw) return []

            const out: string[] = []
            let start = 0
            let inExpires = false

            for (let i = 0; i < raw.length; i++) {
                const ch = raw[i]
                if (!inExpires && (ch === 'e' || ch === 'E')) {
                    const maybe = raw.slice(i, i + 8).toLowerCase()
                    if (maybe === 'expires=') inExpires = true
                }
                if (inExpires && ch === ';') inExpires = false
                if (!inExpires && ch === ',') {
                    const part = raw.slice(start, i).trim()
                    if (part) out.push(part)
                    start = i + 1
                }
            }

            const tail = raw.slice(start).trim()
            if (tail) out.push(tail)
            return out
        }

        const getSetCookie = (upstream.headers as any).getSetCookie
        const getSetCookieMethod = (upstream.headers as any).getSetCookie?.bind?.(upstream.headers)
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

        if (typeof getSetCookieMethod === 'function') {
            const cookies = getSetCookieMethod() as string[]
            applyCookies(cookies)
        } else {
            const single = upstream.headers.get('set-cookie')
            if (single) applyCookies(splitSetCookie(single))
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
