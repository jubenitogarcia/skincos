import { requireCrmUser } from '../../_lib/crmAuth'

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

function normalizeRole(value: unknown): string {
  const raw = String(value || '').trim().toUpperCase()
  if (!raw) return ''
  if (raw === 'ADMIN') return 'GESTOR'
  if (raw === 'OPERADOR') return 'INJETOR'
  return raw
}

function buildUpstreamHeaders(request: Request, requestId: string): Headers {
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

  const userOrRes = await requireCrmUser(context)
  if (userOrRes instanceof Response) return userOrRes

  const role = normalizeRole((userOrRes as any)?.role)
  if (!(role === 'GESTOR' || role === 'GERENTE')) {
    return json(
      403,
      { ok: false, error: 'FORBIDDEN', hint: 'Acesso restrito a gestores.' },
      { 'x-request-id': requestId },
    )
  }

  const actor = {
    id: String((userOrRes as any).id || ''),
    username: (userOrRes as any).username ? String((userOrRes as any).username) : undefined,
    email: (userOrRes as any).email ? String((userOrRes as any).email) : undefined,
    name: (userOrRes as any).displayName ? String((userOrRes as any).displayName) : undefined,
    role,
    allowedUnits: Array.isArray((userOrRes as any).allowedUnits) ? (userOrRes as any).allowedUnits : undefined,
  }

  const actorB64 = b64UrlEncodeString(JSON.stringify(actor))
  const actorTs = String(Date.now())
  const actorKey = String(context?.env?.ESCALA_ACTOR_HMAC_KEY || '').trim()

  const prefix = '/api/escala'
  const rest = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) || '/' : url.pathname

  if (rest === '/_proxy-status' || rest === '/_proxy-status/') {
    const targetOrigin = (context.env?.ESCALA_API_TARGET as string | undefined) || ''
    return json(
      200,
      {
        ok: true,
        targetConfigured: !!targetOrigin,
        actorKeyConfigured: !!actorKey,
        hint: !targetOrigin
          ? 'Configure ESCALA_API_TARGET no Cloudflare Pages/Functions (ex: https://escala-api.skincos.com.br).'
          : undefined,
      },
      { 'x-request-id': requestId },
    )
  }

  const targetOrigin = (context.env?.ESCALA_API_TARGET as string | undefined) || ''
  if (!targetOrigin) {
    return json(
      503,
      {
        ok: false,
        error: 'ESCALA_API_TARGET nao configurado',
        hint: 'Defina ESCALA_API_TARGET no Cloudflare Pages/Functions.',
      },
      { 'x-request-id': requestId },
    )
  }
  if (!actorKey) {
    return json(
      503,
      {
        ok: false,
        error: 'ESCALA_ACTOR_HMAC_KEY nao configurado',
        hint: 'Defina ESCALA_ACTOR_HMAC_KEY no Cloudflare Pages/Functions.',
      },
      { 'x-request-id': requestId },
    )
  }

  const targetUrl = new URL(targetOrigin)
  const basePath = targetUrl.pathname.replace(/\/$/, '')
  targetUrl.pathname = `${basePath}/api/escala${rest.startsWith('/') ? '' : '/'}${rest}`
  targetUrl.search = url.search

  const headers = buildUpstreamHeaders(request, requestId)
  headers.set('x-crm-user', actorB64)
  headers.set('x-crm-ts', actorTs)
  const sig = await signHmacSha256B64Url(actorKey, `${actorTs}.${actorB64}`)
  headers.set('x-crm-signature', sig)

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
