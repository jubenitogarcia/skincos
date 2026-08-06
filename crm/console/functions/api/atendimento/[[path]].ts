import { isLocalDevAuthBypassEnabled, requireCrmUser } from '../../_lib/crmAuth'
import { sanitizeEnvSecret } from '../../_lib/envPlaceholders'
import { effectiveAllowedModules, normalizeCrmRole } from '../../../authPolicy'

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
  isGlobalAdmin?: boolean
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
  return normalizeCrmRole(value)
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

function actorSignatureMessage(version: string, timestamp: string, nonce: string, method: string, path: string, encoded: string): string {
  if (String(version) === '2') {
    return `atendimento-actor/v2.${timestamp}.${nonce}.${method}.${path}.${encoded}`
  }
  return `${timestamp}.${encoded}`
}

function buildTargetUrl(targetOrigin: string, requestUrl: string, rest: string): string {
  const incoming = new URL(requestUrl)
  const target = new URL(targetOrigin)
  const basePath = target.pathname.replace(/\/$/, '')
  target.pathname = `${basePath}/api/atendimento${rest.startsWith('/') ? '' : '/'}${rest}`
  target.search = incoming.search
  return target.toString()
}

function buildUpstreamHeaders(request: Request, requestId: string): Headers {
  const allow = new Set([
    'accept',
    'content-type',
    'idempotency-key',
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
  const rawRole = String(user.role || '').trim().toUpperCase()
  return {
    id: String(user.id || ''),
    username: user.username ? String(user.username) : undefined,
    email: user.email ? String(user.email) : undefined,
    name: user.displayName ? String(user.displayName) : undefined,
    role: normalizeRole(user.role),
    // The upstream normalizes ADMIN to GESTOR for its public module role, but
    // Clientes needs the original break-glass provenance to distinguish it
    // from a unit-scoped manager.
    isGlobalAdmin: rawRole === 'ADMIN',
    allowedUnits: stringArray(user.allowedUnits),
    allowedModules: effectiveAllowedModules(user.role, user.allowedModules),
  }
}

function hasModuleAccess(user: CrmUserLike): boolean {
  const role = normalizeRole(user?.role)
  if (role === 'CONSULTOR') return true
  if (role === 'GESTOR' || role === 'GERENTE') return true
  const allowed = effectiveAllowedModules(user?.role, user?.allowedModules)
  if (!allowed.length) return true
  return allowed.includes('atendimento')
}

function hasCommercialAccess(user: CrmUserLike, restPath: string): boolean {
  const path = String(restPath || '')
  if (path !== '/commercial' && !path.startsWith('/commercial/')) return true
  // The module registry exposes Clientes only to GESTOR. Reject at the edge
  // as well, before minting a signed actor header for the upstream API.
  return normalizeRole(user?.role) === 'GESTOR'
}

function shouldAllowUnsignedLocalProxy(context: AtendimentoProxyContext, actorKey: string): boolean {
  return !actorKey && isLocalDevAuthBypassEnabled(context)
}

function upstreamUnavailableResponse(requestId: string): Response {
  // The upstream message can contain internal hostnames, ports or transport
  // details. Keep correlation through x-request-id and server-side logs.
  return json(502, { ok: false, error: 'UPSTREAM_UNREACHABLE' }, { 'x-request-id': requestId })
}

function publicHealthPayload(value: unknown): JsonBody {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const control = input.moduleControl && typeof input.moduleControl === 'object'
    ? input.moduleControl as Record<string, unknown>
    : {}
  const cleanToken = (candidate: unknown, max = 128) => {
    const text = String(candidate || '').trim()
    return /^[A-Za-z0-9_.:-]+$/.test(text) ? text.slice(0, max) : undefined
  }
  const releaseSha = /^[0-9a-f]{40}$/i.test(String(control.releaseSha || ''))
    ? String(control.releaseSha).toLowerCase()
    : undefined
  return {
    ok: input.ok === true,
    databaseConfigured: input.databaseConfigured === true,
    readOnlyRuntime: input.readOnlyRuntime === true,
    moduleControl: {
      configured: control.configured === true,
      module: cleanToken(control.module, 32) || 'atendimento',
      state: cleanToken(control.state, 32) || 'unknown',
      ready: control.ready === true,
      syntheticOnly: control.syntheticOnly === true,
      ...(releaseSha ? { releaseSha } : {}),
      ...(cleanToken(control.updatedAt, 64) ? { updatedAt: cleanToken(control.updatedAt, 64) } : {}),
      ...(cleanToken(control.reason, 128) ? { reason: cleanToken(control.reason, 128) } : {}),
    },
  }
}

async function forwardPublicHealth(targetOrigin: string, request: Request, rest: string, requestId: string): Promise<Response> {
  if (!['GET', 'HEAD'].includes((request.method || 'GET').toUpperCase())) {
    return json(405, { ok: false, error: 'METHOD_NOT_ALLOWED' }, { allow: 'GET, HEAD', 'x-request-id': requestId })
  }
  if (!targetOrigin) return json(503, { ok: false, error: 'UPSTREAM_NOT_CONFIGURED' }, { 'x-request-id': requestId })
  const upstreamUrl = buildTargetUrl(targetOrigin, request.url, rest)
  const upstream = await fetch(new Request(upstreamUrl, {
    method: request.method,
    headers: { accept: 'application/json', 'x-request-id': requestId },
    redirect: 'manual',
  })).catch(() => null)
  if (!upstream) return upstreamUnavailableResponse(requestId)
  let payload: unknown = {}
  try { payload = await upstream.clone().json() } catch { payload = {} }
  const safeBody = publicHealthPayload(payload)
  return json(upstream.status, safeBody, { 'x-request-id': requestId })
}

export async function onRequest(context: AtendimentoProxyContext): Promise<Response> {
  const request: Request = context.request
  const url = new URL(request.url)
  const requestId = newRequestId()
  const env = context.env || {}
  // Atendimento is an isolated runtime. Falling back to a shared CRM or
  // Insumos target would make a missing production route look healthy and
  // could reintroduce cross-module writes, so the dedicated target is the
  // only accepted upstream for this proxy.
  const targetOrigin = String(env.ATENDIMENTO_API_TARGET || '').trim()
  const prefix = '/api/atendimento'
  const rest = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) || '/' : url.pathname
  if (rest === '/health' || rest === '/health/') {
    return forwardPublicHealth(targetOrigin, request, rest, requestId)
  }
  const userOrRes = await requireCrmUser(context)
  if (userOrRes instanceof Response) return userOrRes
  if (!hasModuleAccess(userOrRes)) {
    return json(403, { ok: false, error: 'FORBIDDEN' }, { 'x-request-id': requestId })
  }

  const actorKey = resolveAtendimentoActorHmacKey(env)
  const unsignedLocalProxyAllowed = shouldAllowUnsignedLocalProxy(context, actorKey)

  if (!hasCommercialAccess(userOrRes, rest)) {
    return json(403, { ok: false, error: 'FORBIDDEN' }, { 'x-request-id': requestId })
  }

  if ((rest === '/local-mirror/status' || rest === '/local-mirror/status/') && !isLocalDevAuthBypassEnabled(context)) {
    return json(404, { ok: false, error: 'NOT_FOUND' }, { 'x-request-id': requestId })
  }

  if (rest === '/_proxy-status' || rest === '/_proxy-status/') {
    return json(200, {
      ok: true,
      targetConfigured: !!targetOrigin,
      actorKeyConfigured: !!actorKey || unsignedLocalProxyAllowed,
      mode: unsignedLocalProxyAllowed ? 'upstream-local-bypass' : 'upstream',
      hint: !targetOrigin
        ? 'Configure ATENDIMENTO_API_TARGET no Cloudflare Pages/Functions.'
        : (!actorKey && !unsignedLocalProxyAllowed
          ? 'Configure ATENDIMENTO_ACTOR_HMAC_KEY ou ESCALA_ACTOR_HMAC_KEY para assinar o ator do CRM.'
          : undefined),
    }, { 'x-request-id': requestId })
  }

  if (!targetOrigin) {
    return json(503, {
      ok: false,
      error: 'ATENDIMENTO_API_TARGET nao configurado',
      hint: 'Defina ATENDIMENTO_API_TARGET no Cloudflare Pages/Functions.',
    }, { 'x-request-id': requestId })
  }
  if (!actorKey && !unsignedLocalProxyAllowed) {
    return json(503, {
      ok: false,
      error: 'ATENDIMENTO_ACTOR_HMAC_KEY ou ESCALA_ACTOR_HMAC_KEY nao configurado',
      hint: 'Defina ATENDIMENTO_ACTOR_HMAC_KEY ou ESCALA_ACTOR_HMAC_KEY no Cloudflare Pages/Functions.',
    }, { 'x-request-id': requestId })
  }

  const actor = toAtendimentoActor(userOrRes as CrmUserLike)
  const actorB64 = b64UrlEncodeString(JSON.stringify(actor))
  const method = (request.method || 'GET').toUpperCase()
  const signingPath = `${url.pathname}${url.search}`
  const headers = buildUpstreamHeaders(request, requestId)
  headers.set('x-crm-user', actorB64)
  if (actorKey) {
    const actorTs = String(Date.now())
    const actorSignatureVersion = String(env.ATENDIMENTO_ACTOR_SIGNATURE_VERSION || '1').trim()
    const actorNonce = actorSignatureVersion === '2' ? (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(16).slice(2)}`) : ''
    headers.set('x-crm-ts', actorTs)
    headers.set('x-crm-signature-version', actorSignatureVersion)
    if (actorNonce) headers.set('x-crm-nonce', actorNonce)
    headers.set('x-crm-signature', await signHmacSha256B64Url(actorKey, actorSignatureMessage(actorSignatureVersion, actorTs, actorNonce, method, signingPath, actorB64)))
  }
  const body = method === 'GET' || method === 'HEAD' ? undefined : request.body
  // Node's fetch implementation requires this marker for a streamed request
  // body, while the Pages runtime safely ignores it.
  const upstreamInit: RequestInit & { duplex?: 'half' } = {
    method,
    headers,
    body,
    redirect: 'manual',
  }
  if (body) {
    upstreamInit.duplex = 'half'
  }
  const upstream: Response | Error = await fetch(new Request(buildTargetUrl(targetOrigin, request.url, rest), upstreamInit))
    .catch((error: unknown) => error instanceof Error ? error : new Error(String(error)))

  if (upstream instanceof Error) {
    return upstreamUnavailableResponse(requestId)
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
  actorSignatureMessage,
  buildUpstreamHeaders,
  buildTargetUrl,
  hasCommercialAccess,
  hasModuleAccess,
  normalizeRole,
  resolveAtendimentoActorHmacKey,
  shouldAllowUnsignedLocalProxy,
  toAtendimentoActor,
  publicHealthPayload,
  forwardPublicHealth,
  upstreamUnavailableResponse,
}

function resolveAtendimentoActorHmacKey(env: Record<string, unknown> = {}) {
  return (
    sanitizeEnvSecret(env.ATENDIMENTO_ACTOR_HMAC_KEY) ||
    sanitizeEnvSecret(env.ESCALA_ACTOR_HMAC_KEY) ||
    sanitizeEnvSecret(env.CRM_ESCALA_HMAC_KEY)
  )
}
