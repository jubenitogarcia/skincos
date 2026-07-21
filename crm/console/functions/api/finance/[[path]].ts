import { proxyRequestBody, sanitizeProxyRequestHeaders } from '../../_lib/proxy'

// Pages owns browser-origin forwarding only. Authorization remains in the API
// gateway/Finance handler and the proxy deliberately adds no finance rules.
export async function onRequest(context: any): Promise<Response> {
  const request: Request = context.request
  const incoming = new URL(request.url)
  const prefix = '/api/finance'
  const rest = incoming.pathname.startsWith(prefix) ? incoming.pathname.slice(prefix.length) || '/' : incoming.pathname
  const target = new URL((context.env?.FINANCE_API_TARGET as string | undefined) || 'https://api.skincos.com.br')
  target.pathname = `/finance${rest.startsWith('/') ? '' : '/'}${rest}`
  target.search = incoming.search
  const headers = sanitizeProxyRequestHeaders(request.headers)
  const method = request.method.toUpperCase()
  const upstream = await fetch(new Request(target, { method, headers, body: proxyRequestBody(method, request), redirect: 'manual' }))
  const out = new Headers(upstream.headers)
  out.set('cache-control', 'no-store')
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out })
}
