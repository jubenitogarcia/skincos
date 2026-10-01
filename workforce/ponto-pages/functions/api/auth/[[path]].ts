import { getLocalDevAuthUser, isLocalDevAuthBypassEnabled } from '../../_lib/pontoAuth'
import { copySetCookieHeaders, proxyRequestBody, sanitizeProxyRequestHeaders } from '../../_lib/proxy'

const json = (status: number, error: string) => new Response(JSON.stringify({ ok: false, error }), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
})

function targetOrigin(context: any, requestUrl: URL): string | null {
  const env = context?.env || {}
  const expectedByEnvironment: Record<string, string> = {
    production: 'https://api.skincos.com.br',
    staging: 'https://api-staging.skincos.com.br',
  }
  const environment = String(env.SKINCOS_DEPLOYMENT_ENV || '').trim().toLowerCase()
  const expected = expectedByEnvironment[environment]
  const raw = String(env.AUTH_API_TARGET || env.INSUMOS_API_TARGET || '').trim()
  if (!expected || raw !== expected) return null
  try {
    const target = new URL(raw)
    if (target.origin === requestUrl.origin || target.protocol !== 'https:' || target.username || target.password || target.pathname !== '/' || target.search || target.hash) return null
    return target.origin
  } catch {
    return null
  }
}

function authPrefix(value: unknown): string | null {
  let prefix = String(value || '').trim() || '/insumos/auth'
  if (!prefix.startsWith('/')) prefix = `/${prefix}`
  prefix = prefix.replace(/\/$/, '')
  return /^\/[A-Za-z0-9/_-]+$/.test(prefix) ? prefix : null
}

export async function onRequest(context: any): Promise<Response> {
  const request: Request = context.request
  const requestUrl = new URL(request.url)
  const requestPrefix = '/api/auth'
  const rest = requestUrl.pathname.startsWith(requestPrefix) ? requestUrl.pathname.slice(requestPrefix.length) || '/' : requestUrl.pathname
  const method = String(request.method || 'GET').toUpperCase()

  if (isLocalDevAuthBypassEnabled(context)) {
    const user = getLocalDevAuthUser(context)
    if (rest === '/me' && method === 'GET') {
      return new Response(JSON.stringify({ ok: true, user, csrfToken: 'local-dev-csrf' }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
    }
    if (['/login', '/register', '/refresh'].includes(rest) && method === 'POST') {
      return new Response(JSON.stringify({ ok: true, user, csrfToken: 'local-dev-csrf' }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
    }
    if (rest === '/logout' && method === 'POST') {
      const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' })
      headers.append('Set-Cookie', 'crm.localAuth=off; Path=/; Max-Age=31536000; SameSite=Lax')
      return new Response(JSON.stringify({ ok: true }), { headers })
    }
  }

  const origin = targetOrigin(context, requestUrl)
  const prefix = authPrefix(context?.env?.AUTH_PATH_PREFIX)
  if (!origin || !prefix) return json(503, 'PONTO_AUTH_PROXY_UNCONFIGURED')
  const target = new URL(origin)
  target.pathname = `${prefix}${rest.startsWith('/') ? '' : '/'}${rest}`
  target.search = requestUrl.search

  const headers = sanitizeProxyRequestHeaders(request.headers)
  const clientIp = headers.get('cf-connecting-ip') || headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (clientIp) headers.set('x-skincos-client-ip', clientIp)
  const upstream = await fetch(new Request(target.toString(), {
    method,
    headers,
    body: proxyRequestBody(method, request),
    redirect: 'manual',
  })).catch(() => null)
  if (!upstream) return json(502, 'PONTO_AUTH_UPSTREAM_UNAVAILABLE')

  const outHeaders = new Headers(upstream.headers)
  outHeaders.set('cache-control', 'no-store')
  const sharedDomain = requestUrl.hostname === 'skincos.com.br' || requestUrl.hostname.endsWith('.skincos.com.br') ? '.skincos.com.br' : ''
  const rewriteCookie = (cookie: string) => {
    const pieces = cookie.split(';').map((part) => part.trim()).filter(Boolean)
    if (!pieces.length || !sharedDomain) return cookie
    const [nameValue, ...attributes] = pieces
    return [nameValue, ...attributes.filter((attribute) => !attribute.toLowerCase().startsWith('domain=')), `Domain=${sharedDomain}`].join('; ')
  }
  copySetCookieHeaders(upstream.headers, outHeaders, rewriteCookie)
  const secure = requestUrl.protocol === 'https:' ? '; Secure' : ''
  const sameSite = requestUrl.protocol === 'https:' ? 'None' : 'Lax'
  if (sharedDomain && (outHeaders.get('set-cookie') || '').includes('session=')) {
    outHeaders.append('Set-Cookie', `session=deleted; Path=/; Max-Age=0; SameSite=${sameSite}${secure}; HttpOnly`)
    outHeaders.append('Set-Cookie', `csrfToken=deleted; Path=/; Max-Age=0; SameSite=${sameSite}${secure}`)
  }
  if (rest === '/logout' && method === 'POST') {
    outHeaders.append('Set-Cookie', `session=deleted; Path=/; Max-Age=0; SameSite=${sameSite}${secure}; HttpOnly`)
    outHeaders.append('Set-Cookie', `csrfToken=deleted; Path=/; Max-Age=0; SameSite=${sameSite}${secure}`)
    outHeaders.append('Set-Cookie', 'crm.localAuth=off; Path=/; Max-Age=31536000; SameSite=Lax')
  }
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: outHeaders })
}
