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
    // Cloudflare Workers runtime supports crypto.randomUUID().
    return crypto.randomUUID()
  } catch {
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`
  }
}

function parseCsvEnv(value: unknown): string[] {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function isAllowedActor(user: any, env: any): { ok: true } | { ok: false; reason: string } {
  const email = String(user?.email || user?.id || '').trim().toLowerCase()
  const domain = email.includes('@') ? email.split('@').pop() || '' : ''

  const allowedEmails = new Set(parseCsvEnv(env?.UNIT_MONITOR_ALLOWED_EMAILS).map((s) => s.toLowerCase()))
  const allowedDomains = new Set(parseCsvEnv(env?.UNIT_MONITOR_ALLOWED_DOMAINS).map((s) => s.toLowerCase()))

  if (allowedEmails.size === 0 && allowedDomains.size === 0) return { ok: true }

  if (email && allowedEmails.has(email)) return { ok: true }
  if (domain && allowedDomains.has(domain)) return { ok: true }

  return { ok: false, reason: 'FORBIDDEN' }
}

function buildUpstreamHeaders(request: Request, requestId: string, proxyToken: string): Headers {
  // Do NOT forward cookies or Authorization to the gateway.
  // The gateway is authenticated only via the shared proxy token.
  const allow = new Set([
    'accept',
    'content-type',
    'range',
    'if-none-match',
    'if-modified-since',
    'cache-control',
    'pragma',
    'user-agent',
  ])

  const headers = new Headers()
  for (const [k, v] of request.headers.entries()) {
    const key = k.toLowerCase()
    if (!allow.has(key)) continue
    headers.set(k, v)
  }

  headers.set('x-request-id', requestId)
  if (proxyToken) headers.set('x-unit-monitor-proxy-token', proxyToken)
  return headers
}

function b64UrlEncodeBytes(bytes: ArrayBuffer): string {
  const bin = String.fromCharCode(...new Uint8Array(bytes))
  // btoa expects latin1; the Uint8Array->string conversion above is intentional.
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

  const user = await getInsumosUser(context)
  if (!user) {
    return json(
      401,
      { ok: false, error: 'UNAUTHORIZED', hint: 'Faça login para usar o Unit Monitor.' },
      { 'x-request-id': requestId },
    )
  }
  const allowed = isAllowedActor(user, context?.env)
  if (!allowed.ok) {
    return json(
      403,
      { ok: false, error: 'FORBIDDEN', hint: 'Seu usuario nao tem permissao para operar o Unit Monitor.' },
      { 'x-request-id': requestId },
    )
  }

  const actor = {
    id: String(user.id || ''),
    email: user.email ? String(user.email) : undefined,
    name: user.name ? String(user.name) : undefined,
  }
  const actorB64 = b64UrlEncodeString(JSON.stringify(actor))
  const actorTs = String(Date.now())
  const actorKey = String(context?.env?.UNIT_MONITOR_ACTOR_HMAC_KEY || context?.env?.UNIT_MONITOR_PROXY_TOKEN || '').trim()

  // Incoming:  /api/unit-monitor/<rest>
  // Outgoing:  <UNIT_MONITOR_API_TARGET>/api/unit-monitor/<rest>
  const prefix = '/api/unit-monitor'
  const rest = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) || '/' : url.pathname

  if (rest === '/_proxy-status' || rest === '/_proxy-status/') {
    const targetOrigin = (context.env?.UNIT_MONITOR_API_TARGET as string | undefined) || ''
    const proxyToken = (context.env?.UNIT_MONITOR_PROXY_TOKEN as string | undefined) || ''
    return json(
      200,
      {
        ok: true,
        targetConfigured: !!targetOrigin,
        proxyTokenConfigured: !!proxyToken,
        hint: !targetOrigin
          ? 'Configure UNIT_MONITOR_API_TARGET no Cloudflare Pages para apontar para o gateway (URL publica do tunnel).'
          : undefined,
      },
      { 'x-request-id': requestId },
    )
  }

  const targetOrigin = (context.env?.UNIT_MONITOR_API_TARGET as string | undefined) || ''
  if (!targetOrigin) {
    return json(
      503,
      {
        ok: false,
        error: 'UNIT_MONITOR_API_TARGET nao configurado',
        hint:
          'Defina UNIT_MONITOR_API_TARGET (ex: https://unit-monitor-gw.seudominio.com) no Cloudflare Pages/Functions.',
      },
      { 'x-request-id': requestId },
    )
  }
  const targetUrl = new URL(targetOrigin)
  const basePath = targetUrl.pathname.replace(/\/$/, '')
  targetUrl.pathname = `${basePath}/api/unit-monitor${rest.startsWith('/') ? '' : '/'}${rest}`
  targetUrl.search = url.search

  const proxyToken = (context.env?.UNIT_MONITOR_PROXY_TOKEN as string | undefined) || ''
  const headers = buildUpstreamHeaders(request, requestId, proxyToken)
  headers.set('x-skincos-actor', actorB64)
  headers.set('x-skincos-actor-ts', actorTs)
  if (actorKey) {
    const sig = await signHmacSha256B64Url(actorKey, `${actorTs}.${actorB64}`)
    headers.set('x-skincos-actor-sig', sig)
  }

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
  outHeaders.set('x-request-id', requestId)

  try {
    const getSetCookie = (upstream.headers as any).getSetCookie
    if (typeof getSetCookie === 'function') {
      const cookies = getSetCookie.call(upstream.headers) as string[]
      if (Array.isArray(cookies) && cookies.length) {
        outHeaders.delete('set-cookie')
        for (const c of cookies) outHeaders.append('Set-Cookie', c)
      }
    }
  } catch {}

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders
  })
}
