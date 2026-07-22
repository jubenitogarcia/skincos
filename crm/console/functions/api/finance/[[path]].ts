import { proxyRequestBody, sanitizeProxyRequestHeaders } from '../../_lib/proxy'

// Pages owns browser-origin forwarding only. The three LOCAL_FINANCE_* values
// are test-only bindings injected by scripts/run-local-finance.sh. They are
// never configured for Pages deployments and let the local gateway resolve the
// same D1 CRM user used by the Finance domain.
export async function onRequest(context: any): Promise<Response> {
  const request: Request = context.request
  const incoming = new URL(request.url)
  const prefix = '/api/finance'
  const rest = incoming.pathname.startsWith(prefix) ? incoming.pathname.slice(prefix.length) || '/' : incoming.pathname
  const target = new URL((context.env?.FINANCE_API_TARGET as string | undefined) || 'https://api.skincos.com.br')
  target.pathname = `/finance${rest.startsWith('/') ? '' : '/'}${rest}`
  target.search = incoming.search
  const headers = sanitizeProxyRequestHeaders(request.headers)
  const localActor = String(context.env?.LOCAL_FINANCE_ACTOR || '').trim()
  const localCsrf = String(context.env?.LOCAL_FINANCE_CSRF_TOKEN || '').trim()
  const localModules = String(context.env?.LOCAL_AUTH_ALLOWED_MODULES || '').trim()
  if (localActor) headers.set('x-skincos-local-finance-actor', localActor)
  if (localActor) headers.set('x-skincos-local-finance-modules', localModules)
  if (localCsrf && !headers.has('x-csrf-token')) headers.set('x-csrf-token', localCsrf)
  const method = request.method.toUpperCase()
  const upstream = await fetch(new Request(target, { method, headers, body: proxyRequestBody(method, request), redirect: 'manual' }))
  const out = new Headers(upstream.headers)
  out.set('cache-control', 'no-store')
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out })
}
