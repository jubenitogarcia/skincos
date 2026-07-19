import { getInsumosUser } from '../../_lib/insumosAuth'
import { requireCsrfForMutations } from '../../_lib/csrf'

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
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
    return `${Date.now()}_${hex}`
  }
}

function buildUpstreamHeaders(request: Request, requestId: string, forwardAuthorization: boolean): Headers {
  const allow = new Set([
    'accept',
    'content-type',
    'range',
    'if-none-match',
    'if-modified-since',
    'cache-control',
    'pragma',
    'user-agent',
    'idempotency-key',
    'x-idempotency-key',
    'x-request-nonce',
  ])

  const headers = new Headers()
  for (const [k, v] of request.headers.entries()) {
    const key = k.toLowerCase()
    if (key === 'authorization' && !forwardAuthorization) continue
    if (!allow.has(key) && key !== 'authorization') continue
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

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function readBodyLimited(request: Request, maxBytes = 1024 * 1024): Promise<ArrayBuffer | undefined> {
  const declaredLength = Number(request.headers.get('content-length') || 0)
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error('PAYLOAD_TOO_LARGE')
  if (!request.body) return undefined
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel('PAYLOAD_TOO_LARGE').catch(() => {})
      throw new Error('PAYLOAD_TOO_LARGE')
    }
    chunks.push(value)
  }
  if (!total) return undefined
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength }
  return out.buffer
}

function normalizeUnits(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const out: string[] = []
  for (const v of values) {
    const unit = String(v ?? '').trim()
    if (unit) out.push(unit)
  }
  return out
}

export async function onRequest(context: any): Promise<Response> {
  const request: Request = context.request
  const url = new URL(request.url)
  const requestId = newRequestId()

  // Incoming:  /api/ponto/<rest>
  // Outgoing:  <PONTO_API_TARGET>/api/ponto/<rest>
  const prefix = '/api/ponto'
  const rest = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) || '/' : url.pathname

  const env = context.env || {}
  const targetOrigin = String((env?.PONTO_API_TARGET as string | undefined) || 'https://api.skincos.com.br').trim()
  const targetFrom = (env?.PONTO_API_TARGET as string | undefined) ? 'PONTO_API_TARGET' : 'CANONICAL_DEFAULT'
  const exposeTarget = String((env?.PONTO_PROXY_EXPOSE_TARGET as string | undefined) || '').trim().toLowerCase() === 'true'
    || String((env?.NODE_ENV as string | undefined) || '').trim().toLowerCase() !== 'production'

  if (rest === '/_proxy-status' || rest === '/_proxy-status/') {
    const actorKey = (env?.PONTO_ACTOR_HMAC_KEY as string | undefined) || ''
    return json(
      200,
      {
        ok: true,
        targetConfigured: !!targetOrigin,
        targetFrom,
        ...(exposeTarget ? { targetOrigin: targetOrigin || undefined } : {}),
        actorKeyConfigured: !!String(actorKey || '').trim(),
        hint: !targetOrigin
          ? 'Configure PONTO_API_TARGET no Cloudflare Pages/Functions para apontar para o backend.'
          : undefined,
      },
      { 'x-request-id': requestId },
    )
  }

  if (!targetOrigin) {
    return json(
      503,
      {
        ok: false,
        error: 'PONTO_API_TARGET nao configurado',
        hint: 'Defina PONTO_API_TARGET no Cloudflare Pages/Functions.',
      },
      { 'x-request-id': requestId },
    )
  }

  const isPublicRoute = ['/health', '/health/', '/readiness', '/readiness/', '/_proxy-status', '/_proxy-status/'].includes(rest)
  const isDeviceRoute = rest === '/device' || rest.startsWith('/device/')
  const isAdminRoute = rest === '/admin' || rest.startsWith('/admin/')
  const requiresActor = !isPublicRoute && !isDeviceRoute

  let actorB64 = ''
  let actorTs = ''
  let actorSig = ''

  const actorKey = String((env?.PONTO_ACTOR_HMAC_KEY as string | undefined) || '').trim()
  let isAdminUser = false

  if (requiresActor) {
    const csrfResponse = requireCsrfForMutations(context)
    if (csrfResponse) return csrfResponse
    const user = await getInsumosUser(context)
    if (!user) {
      return json(
        401,
        { ok: false, error: 'UNAUTHORIZED', hint: 'Faça login no CRM para continuar.' },
        { 'x-request-id': requestId },
      )
    }
    if (!actorKey) {
      return json(
        503,
        { ok: false, error: 'ACTOR_KEY_NOT_CONFIGURED', hint: 'Configure PONTO_ACTOR_HMAC_KEY nas variáveis do Pages.' },
        { 'x-request-id': requestId },
      )
    }
    if (isAdminRoute) {
      const role = String(user.role || '').toUpperCase()
      isAdminUser = ['ADMIN', 'GESTOR', 'GERENTE', 'RH', 'AUDITOR'].includes(role)
      if (!isAdminUser) {
        return json(
          403,
          { ok: false, error: 'FORBIDDEN', hint: 'Acesso restrito a gestores.' },
          { 'x-request-id': requestId },
        )
      }
    }
    const role = String(user.role || '').toUpperCase()
    const workforceRole = role === 'GESTOR' || role === 'GERENTE'
      ? 'MANAGER'
      : role === 'RH'
        ? 'HR'
        : role || 'EMPLOYEE'
    const actor = {
      id: String(user.id || user.email || ''),
      email: user.email ? String(user.email) : undefined,
      name: user.displayName ? String(user.displayName) : (user.name ? String(user.name) : undefined),
      role: workforceRole,
      allowedUnits: normalizeUnits(user.allowedUnits),
    }
    actorB64 = b64UrlEncodeString(JSON.stringify(actor))
    actorTs = String(Date.now())
  }

  const targetUrl = new URL(targetOrigin)
  const basePath = targetUrl.pathname.replace(/\/$/, '')
  targetUrl.pathname = `${basePath}/api/ponto${rest.startsWith('/') ? '' : '/'}${rest}`
  targetUrl.search = url.search

  // Cookies and browser Authorization never cross this boundary. Device tokens are
  // accepted only on explicit device routes; CRM users receive signed actor claims.
  const headers = buildUpstreamHeaders(request, requestId, isDeviceRoute)
  const method = (request.method || 'GET').toUpperCase()
  let body: ArrayBuffer | undefined
  if (method !== 'GET' && method !== 'HEAD') {
    try { body = await readBodyLimited(request) } catch (error) {
      if ((error as Error)?.message === 'PAYLOAD_TOO_LARGE') return json(413, { ok: false, error: 'PAYLOAD_TOO_LARGE' }, { 'x-request-id': requestId })
      throw error
    }
  }
  if (requiresActor) {
    const nonce = !['GET', 'HEAD', 'OPTIONS'].includes(method) ? newRequestId() : ''
    const bodyHash = await sha256Hex(body || new ArrayBuffer(0))
    if (nonce) headers.set('x-request-nonce', nonce)
    actorSig = await signHmacSha256B64Url(actorKey, [actorTs, actorB64, method, `${targetUrl.pathname}${targetUrl.search}`, nonce, bodyHash].join('.'))
    headers.set('x-skincos-actor', actorB64)
    headers.set('x-skincos-actor-ts', actorTs)
    headers.set('x-skincos-actor-sig', actorSig)
    headers.set('x-skincos-signature-version', '2')
  }

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
