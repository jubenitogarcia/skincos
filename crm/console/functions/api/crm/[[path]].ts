import { copySetCookieHeaders, proxyRequestBody, sanitizeProxyRequestHeaders } from '../../_lib/proxy'

export async function onRequest(context: any): Promise<Response> {
  const request: Request = context.request
  const url = new URL(request.url)

  // Incoming:  /api/crm/<rest>
  // Outgoing:  https://api.skincos.com.br/<rest>
  const prefix = '/api/crm'
  const rest = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) || '/' : url.pathname

  const targetOrigin = (context.env?.INSUMOS_API_TARGET as string | undefined) || 'https://api.skincos.com.br'
  const targetUrl = new URL(targetOrigin)
  targetUrl.pathname = `${rest.startsWith('/') ? '' : '/'}${rest}`
  targetUrl.search = url.search

  const headers = sanitizeProxyRequestHeaders(request.headers)

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

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders
  })
}
