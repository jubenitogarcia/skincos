import { requireCrmUser } from '../../_lib/crmAuth'
import { sanitizeEnvSecret } from '../../_lib/envPlaceholders'

const BROWSER_PREFIX = '/api/influencer-intelligence'
const SERVICE_PREFIX = '/internal/influencer-intelligence/v1'
const MAX_REQUEST_BYTES = 64 * 1024
const MAX_RESPONSE_BYTES = 512 * 1024
const MAX_CONCURRENT_REQUESTS = 4
const MAX_REQUESTS_PER_MINUTE = 60
const REQUEST_TIMEOUT_MS = 12_000
const INFLUENCER_INTELLIGENCE_GRANT = 'module.influencer-intelligence.access'
const SAFE_CREATOR_KEY = /^[A-Za-z0-9._:-]{1,128}$/
const SAFE_HANDLE = /^@?[A-Za-z0-9._]{1,30}$/
const SENSITIVE_KEY = /(?:access[_-]?token|refresh[_-]?token|authorization|cookie|credential|secret|password|api[_-]?key|session|email|phone|telephone|cpf|raw|provider.?account|comment.?text|caption|media.?url|image.?url|video.?url|binary|sql|shell|command|prompt|completion)/i
const SENSITIVE_TEXT = /(?:bearer\s+[A-Za-z0-9._-]{8,}|(?:access[_-]?token|refresh[_-]?token|api[_-]?key|password|authorization|cookie)\s*[:=]|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b)/i

const rateWindows = new Map<string, number[]>()
let activeRequests = 0

type JsonRecord = Record<string, unknown>

const json = (status: number, body: JsonRecord, requestId: string) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-request-id': requestId,
  },
})

function newRequestId(): string {
  try { return crypto.randomUUID() } catch { return `${Date.now()}-${Math.random().toString(16).slice(2)}` }
}

function parseBoolean(value: unknown): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

function hasGrant(user: { allowedModules?: string[]; grants?: string[] }): boolean {
  const grants = Array.isArray(user.grants) ? user.grants.map(String) : []
  const explicitModules = Array.isArray(user.allowedModules) ? user.allowedModules.map(String) : []
  return [...grants, ...explicitModules].includes('module.influencer-intelligence.access')
}

function resolveTarget(value: unknown): string {
  const raw = String(value || '').trim()
  if (!raw || raw.length > 1024) return ''
  try {
    const url = new URL(raw)
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase())
    if (url.username || url.password || (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))) return ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return ''
  }
}

function normalizedServicePath(requestPath: string): string | null {
  const path = String(requestPath || '')
  if (path === '/v1') return '/'
  if (!path.startsWith('/v1/')) return null
  return path.slice('/v1'.length)
}

function isCreatorProjectionRoute(path: string, projection: 'analysis' | 'coverage'): boolean {
  const match = path.match(/^\/creators\/([^/]{1,256})\/(analysis|coverage)$/)
  if (!match || match[2] !== projection) return false
  try { return SAFE_CREATOR_KEY.test(decodeURIComponent(match[1])) } catch { return false }
}

function isAllowedRoute(requestPath: string, method: string): boolean {
  const path = normalizedServicePath(requestPath)
  const verb = String(method || 'GET').toUpperCase()
  if (!path) return false
  if (path === '/creators') return verb === 'GET' || verb === 'POST'
  if (path === '/compare') return verb === 'POST'
  if (path === '/campaign-fit') return verb === 'POST'
  if (isCreatorProjectionRoute(path, 'analysis')) return verb === 'GET'
  if (isCreatorProjectionRoute(path, 'coverage')) return verb === 'GET'
  return false
}

function validateSearchQuery(url: URL): boolean {
  const allowed = new Set(['query', 'limit'])
  for (const key of url.searchParams.keys()) if (!allowed.has(key)) return false
  const query = url.searchParams.get('query') || ''
  const limit = url.searchParams.get('limit') || '20'
  return query.length <= 80 && /^[A-Za-z0-9._@ -]*$/.test(query) && /^([1-9]|[1-4]\d|50)$/.test(limit)
}

function validateBody(path: string, body: unknown): body is JsonRecord {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false
  const record = body as JsonRecord
  const keys = Object.keys(record)
  if (path === '/creators') {
    return keys.length === 1 && keys[0] === 'handle' && typeof record.handle === 'string' && SAFE_HANDLE.test(record.handle)
  }
  if (path === '/compare') {
    if (keys.length !== 1 || keys[0] !== 'creatorKeys' || !Array.isArray(record.creatorKeys)) return false
    const creatorKeys = record.creatorKeys
    return creatorKeys.length >= 1 && creatorKeys.length <= 20 && new Set(creatorKeys).size === creatorKeys.length && creatorKeys.every((key) => typeof key === 'string' && SAFE_CREATOR_KEY.test(key))
  }
  if (path === '/campaign-fit') {
    if (keys.some((key) => !['campaignKey', 'campaignVersion', 'creatorKeys'].includes(key))) return false
    if (typeof record.campaignKey !== 'string' || !SAFE_CREATOR_KEY.test(record.campaignKey)) return false
    const campaignVersion = record.campaignVersion
    if (campaignVersion !== undefined) {
      if (typeof campaignVersion !== 'number' || !Number.isSafeInteger(campaignVersion)) return false
      if (campaignVersion < 1 || campaignVersion > 100_000) return false
    }
    if (record.creatorKeys !== undefined) {
      if (!Array.isArray(record.creatorKeys) || record.creatorKeys.length > 20 || new Set(record.creatorKeys).size !== record.creatorKeys.length) return false
      if (!record.creatorKeys.every((key) => typeof key === 'string' && SAFE_CREATOR_KEY.test(key))) return false
    }
    return true
  }
  return false
}

async function readJsonBody(request: Request): Promise<{ ok: true; body: unknown; bytes: number } | { ok: false; code: string }> {
  const declared = Number(request.headers.get('content-length') || 0)
  if (declared > MAX_REQUEST_BYTES) return { ok: false, code: 'REQUEST_TOO_LARGE' }
  try {
    const raw = new Uint8Array(await request.arrayBuffer())
    if (raw.byteLength > MAX_REQUEST_BYTES) return { ok: false, code: 'REQUEST_TOO_LARGE' }
    const text = new TextDecoder().decode(raw)
    return { ok: true, body: text ? JSON.parse(text) : null, bytes: raw.byteLength }
  } catch {
    return { ok: false, code: 'INVALID_INPUT' }
  }
}

function allowRate(key: string): boolean {
  const now = Date.now()
  const active = (rateWindows.get(key) || []).filter((stamp) => now - stamp < 60_000)
  if (active.length >= MAX_REQUESTS_PER_MINUTE) {
    rateWindows.set(key, active)
    return false
  }
  active.push(now)
  rateWindows.set(key, active)
  if (rateWindows.size > 10_000) rateWindows.delete(rateWindows.keys().next().value || key)
  return true
}

function base64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function digestScope(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function signActor(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message))
  return base64Url(String.fromCharCode(...new Uint8Array(signature)))
}

function upstreamHeaders(request: Request, requestId: string): Headers {
  const headers = new Headers()
  const accept = request.headers.get('accept')
  const contentType = request.headers.get('content-type')
  if (accept) headers.set('accept', 'application/json')
  if (contentType) headers.set('content-type', 'application/json')
  headers.set('cache-control', 'no-store')
  headers.set('x-request-id', requestId)
  headers.set('x-influencer-audit', 'required')
  headers.set('x-crm-grant', INFLUENCER_INTELLIGENCE_GRANT)
  return headers
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[truncated-depth]'
  if (typeof value === 'string') return SENSITIVE_TEXT.test(value) ? '[redacted]' : value.slice(0, 800)
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeValue(item, depth + 1))
  if (!value || typeof value !== 'object') return null
  const output: JsonRecord = {}
  for (const [key, child] of Object.entries(value as JsonRecord).slice(0, 100)) {
    if (SENSITIVE_KEY.test(key)) continue
    output[key.slice(0, 120)] = sanitizeValue(child, depth + 1)
  }
  return output
}

function sanitizeResponse(text: string): { ok: true; body: string } | { ok: false; code: string } {
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) return { ok: false, code: 'RESPONSE_TOO_LARGE' }
  if (!text) return { ok: true, body: '{}' }
  try {
    const parsed = JSON.parse(text)
    const sanitized = sanitizeValue(parsed)
    const body = JSON.stringify(sanitized)
    if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES || SENSITIVE_TEXT.test(body)) return { ok: false, code: 'SANITIZATION_FAILED' }
    return { ok: true, body }
  } catch {
    return { ok: false, code: 'INVALID_SERVICE_RESPONSE' }
  }
}

function targetUrl(targetOrigin: string, requestPath: string, search: string): string | null {
  const path = normalizedServicePath(requestPath)
  if (!path) return null
  const url = new URL(targetOrigin)
  const base = url.pathname.replace(/\/$/, '')
  const internalPath = path.replace(/\/analysis$/, '/dashboard')
  url.pathname = `${base}${SERVICE_PREFIX}${internalPath === '/' ? '' : internalPath}`
  url.search = search
  return url.toString()
}

export async function onRequest(context: { request: Request; env?: Record<string, unknown> }): Promise<Response> {
  const request = context.request
  const env = context.env || {}
  const requestId = newRequestId()
  const incoming = new URL(request.url)
  const requestPath = incoming.pathname.startsWith(BROWSER_PREFIX) ? incoming.pathname.slice(BROWSER_PREFIX.length) || '/' : incoming.pathname
  const method = request.method.toUpperCase()

  // The default is deliberately fail-closed. The presence of a catalog entry
  // or client-side navigation state never activates the server capability.
  if (!parseBoolean(env.INFLUENCER_INTELLIGENCE_ENABLED)) return json(404, { ok: false, error: 'NOT_FOUND' }, requestId)
  if (!isAllowedRoute(requestPath, method)) return json(404, { ok: false, error: 'NOT_FOUND' }, requestId)
  if (method === 'GET' && !validateSearchQuery(incoming) && normalizedServicePath(requestPath) === '/creators') return json(400, { ok: false, error: 'INVALID_INPUT' }, requestId)

  const userOrResponse = await requireCrmUser(context)
  if (userOrResponse instanceof Response) return userOrResponse
  if (!hasGrant(userOrResponse)) return json(403, { ok: false, error: 'GRANT_REQUIRED' }, requestId)
  const actorKey = sanitizeEnvSecret(env.INFLUENCER_INTELLIGENCE_ACTOR_HMAC_KEY)
  const targetOrigin = resolveTarget(env.INFLUENCER_INTELLIGENCE_API_TARGET)
  if (!actorKey || !targetOrigin) return json(503, { ok: false, error: 'UNAVAILABLE' }, requestId)
  if (!allowRate(String(userOrResponse.id || 'unknown'))) return json(429, { ok: false, error: 'RATE_LIMITED' }, requestId)
  if (activeRequests >= MAX_CONCURRENT_REQUESTS) return json(429, { ok: false, error: 'TOO_MANY_CONCURRENT_REQUESTS' }, requestId)

  const servicePath = normalizedServicePath(requestPath)
  let bodyBytes: Uint8Array | undefined
  if (method !== 'GET' && method !== 'HEAD') {
    const parsed = await readJsonBody(request)
    if (!parsed.ok) return json(parsed.code === 'REQUEST_TOO_LARGE' ? 413 : 400, { ok: false, error: parsed.code }, requestId)
    if (!validateBody(servicePath || '', parsed.body)) return json(400, { ok: false, error: 'INVALID_INPUT' }, requestId)
    bodyBytes = new TextEncoder().encode(JSON.stringify(parsed.body))
  }

  const outgoingUrl = targetUrl(targetOrigin, requestPath, incoming.search)
  if (!outgoingUrl || !servicePath) return json(404, { ok: false, error: 'NOT_FOUND' }, requestId)
  const actorScope = await digestScope(String(userOrResponse.id || 'unknown'))
  const timestamp = String(Date.now())
  const signature = await signActor(actorKey, `2.${timestamp}.${actorScope}.${method}.${new URL(outgoingUrl).pathname}${incoming.search}.${INFLUENCER_INTELLIGENCE_GRANT}`)
  const headers = upstreamHeaders(request, requestId)
  headers.set('x-crm-actor-scope', actorScope)
  headers.set('x-crm-actor-role', String(userOrResponse.role || ''))
  headers.set('x-crm-ts', timestamp)
  headers.set('x-crm-signature-version', '2')
  headers.set('x-crm-signature', signature)

  activeRequests += 1
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const upstream = await fetch(new Request(outgoingUrl, { method, headers, body: bodyBytes, redirect: 'manual', signal: controller.signal }))
    const text = await upstream.text()
    const safe = sanitizeResponse(text)
    if (!safe.ok) return json(502, { ok: false, error: safe.code }, requestId)
    return new Response(safe.body, { status: upstream.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-request-id': requestId } })
  } catch (error) {
    return json((error as { name?: string })?.name === 'AbortError' ? 504 : 502, { ok: false, error: (error as { name?: string })?.name === 'AbortError' ? 'TIMEOUT' : 'UPSTREAM_UNREACHABLE' }, requestId)
  } finally {
    clearTimeout(timer)
    activeRequests = Math.max(0, activeRequests - 1)
  }
}

export const __testables = Object.freeze({
  hasGrant,
  isAllowedRoute,
  normalizedServicePath,
  resolveTarget,
  sanitizeResponse,
  targetUrl,
  validateBody,
  validateSearchQuery,
})
