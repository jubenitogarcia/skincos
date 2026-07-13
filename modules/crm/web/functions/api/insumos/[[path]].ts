import { copySetCookieHeaders, proxyRequestBody, sanitizeProxyRequestHeaders } from '../../_lib/proxy'
import { getLocalDevAuthUser, isLocalDevAuthBypassEnabled } from '../../_lib/crmAuth'

export async function onRequest(context: any): Promise<Response> {
    const request: Request = context.request
    const url = new URL(request.url)

    // Incoming:  /api/insumos/<rest>
    // Outgoing:  https://api.skincos.com.br/insumos/<rest>
    const prefix = '/api/insumos'
    const rest = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) || '/' : url.pathname
    const method = (request.method || 'GET').toUpperCase()

    if (rest === '/auth/me' && method === 'GET' && isLocalDevAuthBypassEnabled(context)) {
        return new Response(
            JSON.stringify({ success: true, user: getLocalDevAuthUser(context), csrfToken: 'local-dev-csrf' }),
            { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }
        )
    }

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
    if (isLocalDevAuthBypassEnabled(context)) {
        headers.set('x-skincos-local-dev-auth', '1')
    }
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

    // Ensure Set-Cookie survives the proxy (needed for session auth).
    const outHeaders = new Headers(upstream.headers)

    // Avoid caching API and especially auth routes.
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

        // Backward-compat: older proxy behavior could leave host-only auth cookies
        // alongside the shared-domain cookies. Clear the host-only variants once the
        // worker refreshes auth cookies to keep session/csrf pairs aligned.
        const hasAuthCookies =
          rest.startsWith('/auth/') &&
          (outHeaders.get('set-cookie') || '').includes('session=')
        if (sharedDomain && hasAuthCookies) {
          const secureAttr = url.protocol === 'https:' ? '; Secure' : ''
          const sameSite = url.protocol === 'https:' ? 'None' : 'Lax'
          outHeaders.append('Set-Cookie', `session=deleted; Path=/; Max-Age=0; SameSite=${sameSite}${secureAttr}; HttpOnly`)
          outHeaders.append('Set-Cookie', `csrfToken=deleted; Path=/; Max-Age=0; SameSite=${sameSite}${secureAttr}`)
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
