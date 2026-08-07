import { requireCrmUser } from '../../_lib/crmAuth'
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

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

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

function newActorNonce(): string | null {
  try {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    return b64UrlEncodeBytes(bytes.buffer)
  } catch {
    return null
  }
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

function actorSignatureMessage(timestamp: string, nonce: string, method: string, requestPath: string, encodedActor: string): string {
  return `atendimento-actor/v2.${timestamp}.${nonce}.${method}.${requestPath}.${encodedActor}`
}

function buildTargetUrl(targetOrigin: string, requestUrl: string, rest: string): string {
  const incoming = new URL(requestUrl)
  const target = new URL(targetOrigin)
  const basePath = target.pathname.replace(/\/$/, '')
  target.pathname = `${basePath}/api/atendimento${rest.startsWith('/') ? '' : '/'}${rest}`
  target.search = incoming.search
  return target.toString()
}

function signedPath(targetUrl: string): string {
  const target = new URL(targetUrl)
  return `${target.pathname}${target.search}`
}

function resolveAtendimentoTarget(env: Record<string, unknown> = {}): string {
  const configured = String(env.ATENDIMENTO_API_TARGET || '').trim()
  if (!configured || configured.length > 1024) return ''
  try {
    const target = new URL(configured)
    const local = target.hostname === 'localhost' || target.hostname === '127.0.0.1' || target.hostname === '::1'
    if (target.username || target.password || (target.protocol !== 'https:' && !(local && target.protocol === 'http:'))) return ''
    return target.toString()
  } catch {
    return ''
  }
}

function buildUpstreamHeaders(request: Request, requestId: string): Headers {
  const allow = new Set([
    'accept',
    'content-type',
    'idempotency-key',
    'cache-control',
    'pragma',
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

function isPublicHealthPath(restPath: string): boolean {
  return restPath === '/health' || restPath === '/health/'
}

function isInternalPath(restPath: string): boolean {
  return restPath === '/internal' || restPath.startsWith('/internal/')
}

function upstreamUnavailableResponse(requestId: string): Response {
  // The upstream message can contain internal hostnames, ports or transport
  // details. Keep correlation through x-request-id and server-side logs.
  return json(502, { ok: false, error: 'UPSTREAM_UNREACHABLE' }, { 'x-request-id': requestId })
}

function unavailableResponse(requestId: string): Response {
  return json(503, { ok: false, error: 'ATENDIMENTO_RUNTIME_UNAVAILABLE' }, { 'x-request-id': requestId })
}

function sanitizedResponseHeaders(upstream: Response, requestId: string): Headers {
  const headers = new Headers(upstream.headers)
  headers.delete('set-cookie')
  headers.delete('server')
  headers.delete('x-powered-by')
  headers.delete('www-authenticate')
  headers.set('cache-control', 'no-store')
  headers.set('x-request-id', requestId)
  return headers
}

async function forwardHealth(request: Request, targetOrigin: string, requestId: string, rest: string): Promise<Response> {
  const headers = buildUpstreamHeaders(request, requestId)
  const upstream = await fetch(new Request(buildTargetUrl(targetOrigin, request.url, rest), {
    method: 'GET',
    headers,
    redirect: 'manual',
  })).catch((error: unknown) => error instanceof Error ? error : new Error(String(error)))
  if (upstream instanceof Error) return upstreamUnavailableResponse(requestId)
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: sanitizedResponseHeaders(upstream, requestId),
  })
}

export async function onRequest(context: AtendimentoProxyContext): Promise<Response> {
  const request: Request = context.request
  const url = new URL(request.url)
  const requestId = newRequestId()
  const env = context.env || {}
  const prefix = '/api/atendimento'
  const rest = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) || '/' : url.pathname
  const targetOrigin = resolveAtendimentoTarget(env)

  // Readiness and metrics are loopback-and-token only at the isolated
  // runtime. Do not turn the Pages proxy into a second public interface.
  if (isInternalPath(rest)) return json(404, { ok: false, error: 'NOT_FOUND' }, { 'x-request-id': requestId })

  // This is the one intentionally public surface. The isolated runtime emits
  // a PII-free liveness payload and does not query PostgreSQL for it.
  if (isPublicHealthPath(rest)) {
    if (!targetOrigin) return unavailableResponse(requestId)
    return forwardHealth(request, targetOrigin, requestId, rest)
  }

  // The client-facing gateway is permanently read-only in this tranche. The
  // isolated upstream repeats the guard, so an accidental future proxy change
  // cannot re-enable a commercial or Atendimento mutation by itself.
  const method = (request.method || 'GET').toUpperCase()
  if (!READ_METHODS.has(method)) {
    return json(405, { ok: false, error: 'READ_ONLY_RUNTIME' }, {
      allow: 'GET, HEAD, OPTIONS',
      'x-request-id': requestId,
    })
  }

  const userOrRes = await requireCrmUser(context)
  if (userOrRes instanceof Response) return userOrRes
  if (!hasModuleAccess(userOrRes)) {
    return json(403, { ok: false, error: 'FORBIDDEN' }, { 'x-request-id': requestId })
  }
  if (!hasCommercialAccess(userOrRes, rest)) {
    return json(403, { ok: false, error: 'FORBIDDEN' }, { 'x-request-id': requestId })
  }

  const actorKey = resolveAtendimentoActorHmacKey(env)
  if (rest === '/_proxy-status' || rest === '/_proxy-status/') {
    return json(200, {
      ok: true,
      isolatedTargetConfigured: !!targetOrigin,
      actorKeyConfigured: !!actorKey,
      signatureVersion: 2,
      readOnly: true,
    }, { 'x-request-id': requestId })
  }

  if (!targetOrigin || !actorKey) return unavailableResponse(requestId)

  const actor = toAtendimentoActor(userOrRes as CrmUserLike)
  const actorB64 = b64UrlEncodeString(JSON.stringify(actor))
  const actorTs = String(Date.now())
  const actorNonce = newActorNonce()
  if (!actorNonce) return unavailableResponse(requestId)
  const targetUrl = buildTargetUrl(targetOrigin, request.url, rest)
  const headers = buildUpstreamHeaders(request, requestId)
  headers.set('x-crm-user', actorB64)
  headers.set('x-crm-ts', actorTs)
  headers.set('x-crm-nonce', actorNonce)
  headers.set('x-crm-signature-version', '2')
  headers.set('x-crm-signature', await signHmacSha256B64Url(
    actorKey,
    actorSignatureMessage(actorTs, actorNonce, method, signedPath(targetUrl), actorB64),
  ))

  const upstream: Response | Error = await fetch(new Request(targetUrl, {
    method,
    headers,
    redirect: 'manual',
  })).catch((error: unknown) => error instanceof Error ? error : new Error(String(error)))

  if (upstream instanceof Error) return upstreamUnavailableResponse(requestId)
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: sanitizedResponseHeaders(upstream, requestId),
  })
}

export const __testables = {
  actorSignatureMessage,
  buildUpstreamHeaders,
  buildTargetUrl,
  hasCommercialAccess,
  hasModuleAccess,
  isInternalPath,
  isPublicHealthPath,
  newActorNonce,
  normalizeRole,
  resolveAtendimentoActorHmacKey,
  resolveAtendimentoTarget,
  signedPath,
  toAtendimentoActor,
  unavailableResponse,
  upstreamUnavailableResponse,
}

function resolveAtendimentoActorHmacKey(env: Record<string, unknown> = {}) {
  return sanitizeEnvSecret(env.ATENDIMENTO_ACTOR_HMAC_KEY)
}
