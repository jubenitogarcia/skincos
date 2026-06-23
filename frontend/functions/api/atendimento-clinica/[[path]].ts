import { requireCrmUser } from '../../_lib/crmAuth'

type JsonBody = Record<string, unknown>

type CrmUserLike = {
  id?: unknown
  username?: unknown
  email?: unknown
  displayName?: unknown
  role?: unknown
  allowedUnits?: unknown
  allowedModules?: unknown
}

type AtendimentoActorHeader = {
  id: string
  username?: string
  email?: string
  name?: string
  role: string
  allowedUnits?: string[]
  allowedModules?: string[]
}

type AtendimentoProxyContext = {
  request: Request
  env?: Record<string, unknown>
}

const json = (status: number, body: JsonBody, extraHeaders: Record<string, string> = {}) =>
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
  if (raw === 'ADMIN') return 'GESTOR'
  if (raw === 'OPERADOR') return 'INJETOR'
  return raw
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

function buildTargetUrl(targetOrigin: string, requestUrl: string, rest: string): string {
  const incoming = new URL(requestUrl)
  const target = new URL(targetOrigin)
  const basePath = target.pathname.replace(/\/$/, '')
  target.pathname = `${basePath}/api/atendimento-clinica${rest.startsWith('/') ? '' : '/'}${rest}`
  target.search = incoming.search
  return target.toString()
}

function buildUpstreamHeaders(request: Request, requestId: string): Headers {
  const allow = new Set([
    'accept',
    'content-type',
    'cache-control',
    'pragma',
    'user-agent',
  ])
  const headers = new Headers()
  for (const [key, value] of request.headers.entries()) {
    if (!allow.has(key.toLowerCase())) continue
    headers.set(key, value)
  }
  headers.set('x-request-id', requestId)
  return headers
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : undefined
}

function toAtendimentoActor(user: CrmUserLike): AtendimentoActorHeader {
  return {
    id: String(user.id || ''),
    username: user.username ? String(user.username) : undefined,
    email: user.email ? String(user.email) : undefined,
    name: user.displayName ? String(user.displayName) : undefined,
    role: normalizeRole(user.role),
    allowedUnits: stringArray(user.allowedUnits),
    allowedModules: stringArray(user.allowedModules),
  }
}

function hasModuleAccess(user: CrmUserLike): boolean {
  const role = normalizeRole(user?.role)
  if (role === 'GESTOR' || role === 'GERENTE') return true
  const allowed = stringArray(user?.allowedModules) || []
  if (!allowed.length) return true
  return allowed.includes('atendimento-clinica')
}

export async function onRequest(context: AtendimentoProxyContext): Promise<Response> {
  const request: Request = context.request
  const url = new URL(request.url)
  const requestId = newRequestId()
  const userOrRes = await requireCrmUser(context)
  if (userOrRes instanceof Response) return userOrRes
  if (!hasModuleAccess(userOrRes)) {
    return json(403, { ok: false, error: 'FORBIDDEN' }, { 'x-request-id': requestId })
  }

  const env = context.env || {}
  const targetOrigin = String(env.ATENDIMENTO_CLINICA_API_TARGET || env.CRM_API_TARGET || env.INSUMOS_API_TARGET || '').trim()
  const actorKey = String(env.ATENDIMENTO_CLINICA_ACTOR_HMAC_KEY || '').trim()
  const prefix = '/api/atendimento-clinica'
  const rest = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) || '/' : url.pathname

  if (rest === '/_proxy-status' || rest === '/_proxy-status/') {
    return json(200, {
      ok: true,
      targetConfigured: !!targetOrigin,
      actorKeyConfigured: !!actorKey,
      mode: 'upstream',
      hint: !targetOrigin
        ? 'Configure ATENDIMENTO_CLINICA_API_TARGET ou CRM_API_TARGET no Cloudflare Pages/Functions.'
        : (!actorKey ? 'Configure ATENDIMENTO_CLINICA_ACTOR_HMAC_KEY para assinar o ator do CRM.' : undefined),
    }, { 'x-request-id': requestId })
  }

  if (!targetOrigin) {
    return json(503, {
      ok: false,
      error: 'ATENDIMENTO_CLINICA_API_TARGET nao configurado',
      hint: 'Defina ATENDIMENTO_CLINICA_API_TARGET ou CRM_API_TARGET no Cloudflare Pages/Functions.',
    }, { 'x-request-id': requestId })
  }
  if (!actorKey) {
    return json(503, {
      ok: false,
      error: 'ATENDIMENTO_CLINICA_ACTOR_HMAC_KEY nao configurado',
      hint: 'Defina ATENDIMENTO_CLINICA_ACTOR_HMAC_KEY no Cloudflare Pages/Functions.',
    }, { 'x-request-id': requestId })
  }

  const actor = toAtendimentoActor(userOrRes as CrmUserLike)
  const actorB64 = b64UrlEncodeString(JSON.stringify(actor))
  const actorTs = String(Date.now())
  const headers = buildUpstreamHeaders(request, requestId)
  headers.set('x-crm-user', actorB64)
  headers.set('x-crm-ts', actorTs)
  headers.set('x-crm-signature', await signHmacSha256B64Url(actorKey, `${actorTs}.${actorB64}`))

  const method = (request.method || 'GET').toUpperCase()
  const upstream: Response | Error = await fetch(new Request(buildTargetUrl(targetOrigin, request.url, rest), {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : request.body,
    redirect: 'manual',
  })).catch((error: unknown) => error instanceof Error ? error : new Error(String(error)))

  if (upstream instanceof Error) {
    return json(502, { ok: false, error: 'UPSTREAM_UNREACHABLE', detail: upstream.message }, { 'x-request-id': requestId })
  }

  const outHeaders = new Headers(upstream.headers)
  outHeaders.set('cache-control', 'no-store')
  outHeaders.set('x-request-id', requestId)
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  })
}

export const __testables = {
  buildUpstreamHeaders,
  buildTargetUrl,
  hasModuleAccess,
  normalizeRole,
  toAtendimentoActor,
}
