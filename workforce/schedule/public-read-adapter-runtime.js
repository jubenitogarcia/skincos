import {
  SCHEDULE_PUBLIC_READ_CONTRACT_VERSION,
  SCHEDULE_PUBLIC_READ_CORE_SERVICE,
  SCHEDULE_PUBLIC_READ_EDGE_SERVICE,
  SCHEDULE_PUBLIC_READ_MAX_SKEW_MS,
  createSchedulePublicReadHeaders,
  normalizeSchedulePublicReadSecret,
  verifySchedulePublicReadRequest,
} from './public-read-contract.js'
import { SCHEDULE_PUBLIC_READ_DATA_LIMITS, normalizeSchedulePublicReadUnit, isSchedulePublicReadDate, validateSchedulePublicReadDto, assertSchedulePublicReadResponseBudget } from './public-read-projection.js'

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
  const supplied = request.headers.get('x-request-id')
  return typeof supplied === 'string' && /^[A-Za-z0-9._:-]{1,120}$/.test(supplied) ? supplied : crypto.randomUUID()
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

function queryContext(url, suffix) {
  const permitted = suffix === '/availability' ? ['unit', 'date'] : suffix === '/professionals' ? ['unit'] : []
  if ([...url.searchParams.keys()].some((key) => !permitted.includes(key))
    || permitted.some((key) => url.searchParams.getAll(key).length !== 1)) return { error: 'INVALID_QUERY' }
  if (suffix === '/readiness') return { suffix }
  const unit = normalizeSchedulePublicReadUnit(url.searchParams.get('unit'))
  if (!unit) return { error: 'INVALID_UNIT' }
  const date = suffix === '/availability' ? url.searchParams.get('date') : undefined
  if (suffix === '/availability' && !isSchedulePublicReadDate(date)) return { error: 'INVALID_DATE' }
  return { suffix, unit, date }
}

export const SCHEDULE_PUBLIC_READ_CORE_TIMEOUT_MS = 4_000
async function requestCore(request, env, corePath, id, expected) {
  const target = new URL('https://schedule-core.internal' + corePath)
  const controller = new AbortController()
  let reader, cancelled = false, rejectCancellation
  const cancellation = new Promise((_resolve, reject) => { rejectCancellation = reject })
  void cancellation.catch(() => {})
  const cancel = () => {
    cancelled = true; controller.abort(); rejectCancellation(new Error('schedule_core_unavailable'))
    try { void reader?.cancel().catch(() => {}) } catch { /* No source cause escapes. */ }
  }
  const timer = setTimeout(cancel, SCHEDULE_PUBLIC_READ_CORE_TIMEOUT_MS)
  request.signal.addEventListener('abort', cancel, { once: true })
  if (request.signal.aborted) cancel()
  const bounded = (operation) => {
    if (cancelled) throw new Error('schedule_core_unavailable')
    return Promise.race([operation(), cancellation])
  }
  try {
    const headers = new Headers(await bounded(() => createSchedulePublicReadHeaders({
      secret: normalizeSchedulePublicReadSecret(env.SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY),
      url: target, method: 'GET', service: SCHEDULE_PUBLIC_READ_CORE_SERVICE,
    })))
    headers.set('x-request-id', id)
    const response = await bounded(() => Promise.resolve(env.SCHEDULE_CORE.fetch(new Request(target.toString(), { method: 'GET', headers, signal: controller.signal }))).then((result) => {
      if (cancelled) { try { void result.body?.cancel().catch(() => {}) } catch { /* Late response after cancellation. */ } }
      return result
    }))
    if (response.status !== 200 || response.redirected
      || response.headers.get('x-skincos-schedule-public-read-contract') !== SCHEDULE_PUBLIC_READ_CONTRACT_VERSION
      || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) {
      try { void response.body?.cancel().catch(() => {}) } catch { /* Never read provider errors. */ }
      return unavailable(id)
    }
    const declared = response.headers.get('content-length')
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > SCHEDULE_PUBLIC_READ_DATA_LIMITS.maxResponseBytes)) {
      try { void response.body?.cancel().catch(() => {}) } catch { /* Invalid declared budget. */ }
      return unavailable(id)
    }
    reader = response.body?.getReader()
    if (!reader) return unavailable(id)
    const chunks = []; let size = 0
    while (true) {
      const chunk = await bounded(() => reader.read())
      if (chunk.done) break
      if (!(chunk.value instanceof Uint8Array)) throw new Error('schedule_core_unavailable')
      size += chunk.value.byteLength
      if (size > SCHEDULE_PUBLIC_READ_DATA_LIMITS.maxResponseBytes) throw new Error('schedule_core_unavailable')
      chunks.push(chunk.value)
    }
    const bytes = new Uint8Array(size); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    const dto = assertSchedulePublicReadResponseBudget(validateSchedulePublicReadDto(body, expected))
    // Rebuild the response from public fields; never forward arbitrary headers,
    // cookies, profile contacts or a body lacking the genuine core marker.
    return json(dto, { headers: { 'x-request-id': id } })
  } catch { return unavailable(id) }
  finally {
    clearTimeout(timer); request.signal.removeEventListener('abort', cancel)
    try { void reader?.cancel().catch(() => {}) } catch { /* Bounded cleanup only. */ }
    try { reader?.releaseLock() } catch { /* Cancellation closes pending reads. */ }
  }
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
    const expected = queryContext(url, suffix)
    if (expected.error) return json({ ok: false, error: expected.error }, { status: 400, headers: { 'x-request-id': id } })
    return requestCore(request, env, `${CORE_PREFIX}${suffix}${url.search}`, id, expected)
  },
}

export const __testables = { consumeEdgeNonce, runtimeConfigured, signedNonceExpiry }
