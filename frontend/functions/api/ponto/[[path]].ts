import { getInsumosUser } from '../../_lib/insumosAuth'

const json = (status: number, body: any, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  })

function newRequestId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`
  }
}

function buildUpstreamHeaders(request: Request, requestId: string, proxyToken: string, forwardAuthorization: boolean): Headers {
  const allow = new Set([
    'accept',
    'content-type',
    'range',
    'if-none-match',
    'if-modified-since',
    'cache-control',
    'pragma',
    'user-agent',
    'x-idempotency-key',
  ])

  const headers = new Headers()
  for (const [k, v] of request.headers.entries()) {
    const key = k.toLowerCase()
    if (key === 'authorization' && !forwardAuthorization) continue
    if (!allow.has(key) && key !== 'authorization') continue
    headers.set(k, v)
  }

  headers.set('x-request-id', requestId)
  if (proxyToken) headers.set('x-ponto-proxy-token', proxyToken)
  return headers
}

function b64UrlEncodeBytes(bytes: ArrayBuffer): string {
  const bin = String.fromCharCode(...new Uint8Array(bytes))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function b64UrlEncodeString(input: string): string {
  const bytes = new TextEncoder().encode(input)
  return b64UrlEncodeBytes(bytes.buffer)
}

async function signHmacSha256B64Url(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return b64UrlEncodeBytes(sig)
}

export async function onRequest(context: any): Promise<Response> {
  const request: Request = context.request
  const url = new URL(request.url)
  const requestId = newRequestId()

  // Incoming:  /api/ponto/<rest>
  // Outgoing:  <PONTO_API_TARGET>/api/ponto/<rest>
  const prefix = '/api/ponto'
  const rest = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) || '/' : url.pathname

  if (rest === '/_proxy-status' || rest === '/_proxy-status/') {
    const targetOrigin = (context.env?.PONTO_API_TARGET as string | undefined) || ''
    const proxyToken = (context.env?.PONTO_PROXY_TOKEN as string | undefined) || ''
    const actorKey = (context.env?.PONTO_ACTOR_HMAC_KEY as string | undefined) || proxyToken || ''
    return json(
      200,
      {
        ok: true,
        targetConfigured: !!targetOrigin,
        proxyTokenConfigured: !!proxyToken,
        actorKeyConfigured: !!actorKey,
        hint: !targetOrigin
          ? 'Configure PONTO_API_TARGET no Cloudflare Pages/Functions para apontar para o backend do Ponto.'
          : undefined,
      },
      { 'x-request-id': requestId },
    )
  }

  const targetOrigin = (context.env?.PONTO_API_TARGET as string | undefined) || ''
  if (!targetOrigin) {
    return json(
      503,
      {
        ok: false,
        error: 'PONTO_API_TARGET nao configurado',
        hint: 'Defina PONTO_API_TARGET (ex: https://crm-api.seudominio.com) no Cloudflare Pages/Functions.',
      },
      { 'x-request-id': requestId },
    )
  }

  const isEmployeeRoute = rest === '/me' || rest.startsWith('/me/')
  const isAdminRoute = rest === '/admin' || rest.startsWith('/admin/')

  let actorB64 = ''
  let actorTs = ''
  let actorSig = ''

  const proxyToken = (context.env?.PONTO_PROXY_TOKEN as string | undefined) || ''
  const actorKey = String((context.env?.PONTO_ACTOR_HMAC_KEY as string | undefined) || proxyToken || '').trim()
  const adminToken = String((context.env?.PONTO_ADMIN_TOKEN as string | undefined) || '').trim()
  let isAdminUser = false

  if (isEmployeeRoute || isAdminRoute) {
    const user = await getInsumosUser(context)
    if (!user) {
      return json(
        401,
        { ok: false, error: 'UNAUTHORIZED', hint: 'Faça login no CRM para continuar.' },
        { 'x-request-id': requestId },
      )
    }
    if (isEmployeeRoute) {
      const actor = {
        id: String(user.id || ''),
        email: user.email ? String(user.email) : undefined,
        name: user.displayName ? String(user.displayName) : (user.name ? String(user.name) : undefined),
      }
      actorB64 = b64UrlEncodeString(JSON.stringify(actor))
      actorTs = String(Date.now())
      if (actorKey) {
        actorSig = await signHmacSha256B64Url(actorKey, `${actorTs}.${actorB64}`)
      }
    }
    if (isAdminRoute) {
      const role = String(user.role || '').toUpperCase()
      isAdminUser = role === 'ADMIN' || role === 'GESTOR' || role === 'GERENTE'
      if (!isAdminUser) {
        return json(
          403,
          { ok: false, error: 'FORBIDDEN', hint: 'Acesso restrito a administradores.' },
          { 'x-request-id': requestId },
        )
      }
    }
  }

  const targetUrl = new URL(targetOrigin)
  const basePath = targetUrl.pathname.replace(/\/$/, '')
  targetUrl.pathname = `${basePath}/api/ponto${rest.startsWith('/') ? '' : '/'}${rest}`
  targetUrl.search = url.search

  // For employee routes, do NOT forward Authorization; for admin/device routes, allow it.
  const headers = buildUpstreamHeaders(request, requestId, proxyToken, !isEmployeeRoute)
  if (isEmployeeRoute) {
    headers.set('x-skincos-actor', actorB64)
    headers.set('x-skincos-actor-ts', actorTs)
    if (actorSig) headers.set('x-skincos-actor-sig', actorSig)
  }
  if (isAdminRoute && isAdminUser) {
    if (!adminToken) {
      return json(
        503,
        { ok: false, error: 'ADMIN_TOKEN_NOT_CONFIGURED', hint: 'Configure PONTO_ADMIN_TOKEN nas variáveis do Pages.' },
        { 'x-request-id': requestId },
      )
    }
    headers.set('authorization', `Admin ${adminToken}`)
  }

  const method = (request.method || 'GET').toUpperCase()
  const body = method === 'GET' || method === 'HEAD' ? undefined : request.body

  const upstreamRequest = new Request(targetUrl.toString(), {
    method,
    headers,
    body,
    redirect: 'manual',
  })

  const upstream = await fetch(upstreamRequest)

  const outHeaders = new Headers(upstream.headers)
  outHeaders.set('Cache-Control', 'no-store')
  outHeaders.set('x-request-id', requestId)

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  })
}
