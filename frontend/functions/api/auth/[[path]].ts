import { getLocalDevAuthUser, isLocalDevAuthBypassEnabled } from '../../_lib/crmAuth'

export async function onRequest(context: any): Promise<Response> {
    const request: Request = context.request
    const url = new URL(request.url)

    // Incoming:  /api/auth/<rest>
    // Outgoing:  https://api.skincos.com.br/auth/<rest>
    const prefix = '/api/auth'
    const rest = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) || '/' : url.pathname
    const method = (request.method || 'GET').toUpperCase()

    if (isLocalDevAuthBypassEnabled(context)) {
        const user = getLocalDevAuthUser(context)
        const csrfToken = 'local-dev-csrf'
        if (rest === '/me' && method === 'GET') {
            return new Response(
                JSON.stringify({ ok: true, user, csrfToken }),
                { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }
            )
        }
        if ((rest === '/login' || rest === '/register' || rest === '/refresh') && method === 'POST') {
            return new Response(
                JSON.stringify({ ok: true, user, csrfToken }),
                { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }
            )
        }
        if (rest === '/logout' && method === 'POST') {
            return new Response(
                JSON.stringify({ ok: true }),
                { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }
            )
        }
    }

    const targetOrigin = (context.env?.INSUMOS_API_TARGET as string | undefined) || 'https://api.skincos.com.br'
    const authPrefix = String((context.env?.AUTH_PATH_PREFIX as string | undefined) || '/insumos/auth')
    const targetUrl = new URL(targetOrigin)
    targetUrl.pathname = `${authPrefix}${rest.startsWith('/') ? '' : '/'}${rest}`
    targetUrl.search = url.search

    const headers = new Headers(request.headers)
    const clientIp = headers.get('cf-connecting-ip') || headers.get('x-forwarded-for')?.split(',')?.[0]?.trim()
    if (clientIp) headers.set('x-skincos-client-ip', clientIp)
    headers.delete('host')
    headers.delete('content-length')
    headers.delete('content-encoding')
    headers.delete('transfer-encoding')
    headers.delete('connection')

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
        const host = url.hostname
        const sharedDomain = host === 'skincos.com.br' || host.endsWith('.skincos.com.br')
          ? '.skincos.com.br'
          : ''
        const rewriteCookie = (cookie: string) => {
            if (!cookie) return cookie
            const parts = cookie.split(';').map(part => part.trim()).filter(Boolean)
            if (!parts.length) return cookie
            const [nameValue, ...attrs] = parts
            const filtered = attrs.filter(attr => !attr.toLowerCase().startsWith('domain='))
            if (sharedDomain) filtered.push(`Domain=${sharedDomain}`)
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
