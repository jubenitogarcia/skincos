import {
  SCHEDULE_PUBLIC_READ_CONTRACT_VERSION,
  SCHEDULE_PUBLIC_READ_CORE_SERVICE,
  SCHEDULE_PUBLIC_READ_EDGE_SERVICE,
  SCHEDULE_PUBLIC_READ_MAX_SKEW_MS,
  createSchedulePublicReadHeaders,
  normalizeSchedulePublicReadSecret,
  verifySchedulePublicReadRequest,
} from './public-read-contract.js'

const PUBLIC_PREFIX = '/schedule-public-read/v1'
const CORE_PREFIX = '/api/escala/internal/schedule-public-read/v1'

function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-skincos-schedule-public-read-contract': SCHEDULE_PUBLIC_READ_CONTRACT_VERSION,
      ...(init.headers || {}),
    },
  })
}

function requestId(request) {
  return String(request.headers.get('x-request-id') || crypto.randomUUID())
}

function runtimeConfigured(env) {
  const edgeKey = normalizeSchedulePublicReadSecret(env?.SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY)
  const coreKey = normalizeSchedulePublicReadSecret(env?.SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY)
  return String(env?.SCHEDULE_PUBLIC_READ_ENABLED || '').trim().toLowerCase() === 'true'
    && Boolean(edgeKey)
    && Boolean(coreKey)
    && edgeKey !== coreKey
    && typeof env?.SCHEDULE_PUBLIC_READ_NONCE_GUARD?.getByName === 'function'
    && typeof env?.SCHEDULE_CORE?.fetch === 'function'
}

function unavailable(id) {
  return json({
    ok: false,
    contract: SCHEDULE_PUBLIC_READ_CONTRACT_VERSION,
    ready: false,
    error: 'SCHEDULE_PUBLIC_READ_UNAVAILABLE',
  }, { status: 503, headers: { 'x-request-id': id } })
}

function notFound(id) {
  return json({ ok: false, error: 'NOT_FOUND' }, { status: 404, headers: { 'x-request-id': id } })
}

function methodNotAllowed(id) {
  return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, { status: 405, headers: { 'x-request-id': id } })
}

function unauthorized(id) {
  return json({ ok: false, error: 'SCHEDULE_PUBLIC_READ_UNAUTHORIZED' }, { status: 401, headers: { 'x-request-id': id } })
}

function replayed(id) {
  return json({ ok: false, error: 'SCHEDULE_PUBLIC_READ_REPLAYED' }, { status: 409, headers: { 'x-request-id': id } })
}

function signedNonceExpiry(timestamp) {
  const signedAt = Number(timestamp)
  const expiresAt = signedAt + SCHEDULE_PUBLIC_READ_MAX_SKEW_MS
  return Number.isSafeInteger(expiresAt) ? expiresAt : null
}

async function consumeEdgeNonce(request, env, expiresAt) {
  const nonce = String(request.headers.get('x-skincos-schedule-read-nonce') || '')
  try {
    const guard = env.SCHEDULE_PUBLIC_READ_NONCE_GUARD.getByName(nonce)
    const result = await guard.consume({ expiresAt })
    if (result?.ok === true) return { ok: true }
    if (result?.code === 'REPLAYED') return { ok: false, code: 'REPLAYED' }
  } catch {
    // A replay guard failure is an availability failure, never a bypass.
  }
  return { ok: false, code: 'UNAVAILABLE' }
}

async function requestCore(request, env, corePath, id) {
  const target = new URL(`https://schedule-core.internal${corePath}`)
  const headers = new Headers(await createSchedulePublicReadHeaders({
    secret: normalizeSchedulePublicReadSecret(env.SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY),
    url: target,
    method: 'GET',
    service: SCHEDULE_PUBLIC_READ_CORE_SERVICE,
  }))
  headers.set('x-request-id', id)
  let response
  try {
    response = await env.SCHEDULE_CORE.fetch(new Request(target.toString(), { method: 'GET', headers }))
  } catch {
    return unavailable(id)
  }
  const outputHeaders = new Headers(response.headers)
  outputHeaders.set('cache-control', 'no-store')
  outputHeaders.set('x-request-id', id)
  outputHeaders.set('x-skincos-schedule-public-read-contract', SCHEDULE_PUBLIC_READ_CONTRACT_VERSION)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: outputHeaders,
  })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const id = requestId(request)

    if (url.pathname === '/health') {
      if (request.method !== 'GET') return methodNotAllowed(id)
      if (!runtimeConfigured(env)) return unavailable(id)
      return json({ ok: true, contract: SCHEDULE_PUBLIC_READ_CONTRACT_VERSION, ready: true }, { headers: { 'x-request-id': id } })
    }

    if (!url.pathname.startsWith(PUBLIC_PREFIX)) return notFound(id)
    if (request.method !== 'GET') return methodNotAllowed(id)
    if (!runtimeConfigured(env)) return unavailable(id)

    const authorization = await verifySchedulePublicReadRequest(
      request,
      normalizeSchedulePublicReadSecret(env.SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY),
      { allowedService: SCHEDULE_PUBLIC_READ_EDGE_SERVICE },
    )
    if (!authorization.ok) return unauthorized(id)

    const nonce = await consumeEdgeNonce(request, env, signedNonceExpiry(authorization.timestamp))
    if (nonce.code === 'REPLAYED') return replayed(id)
    if (!nonce.ok) return unavailable(id)

    const suffix = url.pathname.slice(PUBLIC_PREFIX.length)
    if (!['/readiness', '/availability', '/professionals'].includes(suffix)) return notFound(id)
    return requestCore(request, env, `${CORE_PREFIX}${suffix}${url.search}`, id)
  },
}

export const __testables = { consumeEdgeNonce, runtimeConfigured, signedNonceExpiry }
