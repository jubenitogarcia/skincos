import { copySetCookieHeaders, proxyRequestBody, sanitizeProxyRequestHeaders } from '../../_lib/proxy'
import { getCrmUser, isLocalDevAuthBypassEnabled } from '../../_lib/crmAuth'

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function isLoopbackTarget(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  } catch {
    return false
  }
}

export function buildCrmTargetUrl(targetOrigin: string, rest: string, search: string): string {
  const targetUrl = new URL(targetOrigin)
  const basePath = targetUrl.pathname.replace(/\/$/, '')
  // Hosted Core owns the /inventory mount. The local CRM adapter exposes its
  // admin routes directly, so adding that prefix to a loopback target would
  // turn a valid /admin/team request into a guaranteed 404.
  const mountPath = isLoopbackTarget(targetOrigin) ? '' : '/inventory'
  targetUrl.pathname = `${basePath}${mountPath}${rest.startsWith('/') ? '' : '/'}${rest}`
  targetUrl.search = search
  return targetUrl.toString()
}

export async function onRequest(context: any): Promise<Response> {
  const request: Request = context.request
  const url = new URL(request.url)

  // Incoming:  /api/crm/<rest>
  // Outgoing:  https://api.skincos.com.br/inventory/<rest>
  //
  // The Core gateway owns the public domain and mounts the Inventory/Identity
  // Worker at /inventory. Keeping this boundary explicit prevents the CRM
  // console from silently falling through to the gateway's route_not_found
  // response when Users, onboarding or admin status routes are called.
  const prefix = '/api/crm'
  const rest = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) || '/' : url.pathname

  const targetOrigin = (context.env?.CRM_API_TARGET as string | undefined)
    || (context.env?.INSUMOS_API_TARGET as string | undefined)
    || 'https://api.skincos.com.br'
  const targetUrl = new URL(buildCrmTargetUrl(targetOrigin, rest, url.search))

  const headers = sanitizeProxyRequestHeaders(request.headers)

  // Local auth is intentionally sessionless at the Pages boundary. When the
  // target is the loopback adapter, pass the synthetic actor explicitly so
  // local CRUD can be exercised without creating a production-like session.
  // Hosted/prod targets never receive this header.
  if (isLoopbackTarget(targetOrigin) && isLocalDevAuthBypassEnabled(context)) {
    const localUser = await getCrmUser(context)
    if (localUser) {
      const csrfToken = String(headers.get('x-csrf-token') || 'local-dev-csrf').trim()
      headers.set('x-skincos-local-crm-actor', encodeBase64Url(JSON.stringify({ user: localUser, csrfToken })))
      headers.set('x-skincos-local-crm-csrf', csrfToken)
    }
  }

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
