import { getLocalDevAuthUser, isLocalDevAuthBypassEnabled } from '../../_lib/crmAuth'
import { copySetCookieHeaders, proxyRequestBody, sanitizeProxyRequestHeaders } from '../../_lib/proxy'

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
            const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' })
            headers.append('Set-Cookie', 'crm.localAuth=off; Path=/; Max-Age=31536000; SameSite=Lax')
            return new Response(
                JSON.stringify({ ok: true }),
                { status: 200, headers }
            )
        }
    }

    const targetOrigin = (context.env?.INSUMOS_API_TARGET as string | undefined) || 'https://api.skincos.com.br'
    const authPrefix = String((context.env?.AUTH_PATH_PREFIX as string | undefined) || '/insumos/auth')
    const targetUrl = new URL(targetOrigin)
    targetUrl.pathname = `${authPrefix}${rest.startsWith('/') ? '' : '/'}${rest}`
    targetUrl.search = url.search

    const headers = sanitizeProxyRequestHeaders(request.headers)
    const clientIp = headers.get('cf-connecting-ip') || headers.get('x-forwarded-for')?.split(',')?.[0]?.trim()
    if (clientIp) headers.set('x-skincos-client-ip', clientIp)

    const body = proxyRequestBody(method, request)

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
        copySetCookieHeaders(upstream.headers, outHeaders, rewriteCookie)

        // Backward-compat: old deployments could have host-only auth cookies.
        // On logout, clear both host-only and shared-domain variants.
        if (rest === '/logout' && method === 'POST') {
            const secureAttr = url.protocol === 'https:' ? '; Secure' : ''
            const sameSite = url.protocol === 'https:' ? 'None' : 'Lax'
            outHeaders.append('Set-Cookie', `session=deleted; Path=/; Max-Age=0; SameSite=${sameSite}${secureAttr}; HttpOnly`)
            outHeaders.append('Set-Cookie', `csrfToken=deleted; Path=/; Max-Age=0; SameSite=${sameSite}${secureAttr}`)
            outHeaders.append('Set-Cookie', 'crm.localAuth=off; Path=/; Max-Age=31536000; SameSite=Lax')
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
