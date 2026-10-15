import { createSchedulePublicReadHeaders, verifySchedulePublicReadRequest } from './public-read-contract.js'
import { SCHEDULE_PUBLIC_READ_DATA_LIMITS, validateSchedulePublicReadDto, assertSchedulePublicReadResponseBudget } from './public-read-projection.js'

export const PROBE_CONTRACT = 'schedule-public-read-production-probe/v1'
export const PROBE_SERVICE = 'schedule-production-verifier'
export const PROJECTION_PROBE_TIMEOUT_MS = 4_000
const TARGET = 'https://schedule-public-read.internal'
const READINESS = '/schedule-public-read/v1/readiness'
const PUBLIC_PREFIX = '/schedule-public-read/v1'
const MODES = new Set(['/verify/ready', '/verify/disabled', '/verify/public-projection'])
const UNIT_ALLOWLIST = Object.freeze(['novo-hamburgo', 'barra-shopping-sul'])
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/

function response(body, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}
function currentClinicDate(now) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const value = (type) => parts.find((part) => part.type === type)?.value
  return [value('year'), value('month'), value('day')].join('-')
}
async function publicDigest(dto) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(dto)))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

// This ephemeral verifier accepts only fixed authenticated checks. Its service
// binding, units and clock-derived date cannot be replaced by a caller.
export async function handleProductionProbe(request, env, { now = Date.now, timeoutMs = 10_000 } = {}) {
  const url = new URL(request.url)
  if (request.method !== 'GET' || !MODES.has(url.pathname) || url.search || request.body) {
    return response({ ok: false, error: 'PROBE_REQUEST_REJECTED' }, 404)
  }
  const mode = url.pathname.endsWith('/disabled') ? 'disabled' : url.pathname.endsWith('/public-projection') ? 'public-projection' : 'ready'
  const projection = mode === 'public-projection'
  const deadline = Number(env?.PROBE_EXPIRES_AT_MS)
  const ownKey = String(env?.SCHEDULE_PUBLIC_READ_PROBE_HMAC_KEY || '').trim()
  const edgeKey = String(env?.SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY || '').trim()
  const isCurrent = () => Number.isSafeInteger(deadline) && deadline > now()
    && deadline <= now() + (projection ? 30 : 60) * 60_000
  if (!isCurrent() || ownKey.length < 32 || (edgeKey && ownKey === edgeKey)
    || !/^[0-9a-f]{40}$/.test(env?.PROBE_SOURCE_SHA || '') || typeof env?.SCHEDULE_PUBLIC_READ?.fetch !== 'function'
    || (projection && !uuidPattern.test(env?.PROBE_NATIVE_RELEASE_ID || ''))) {
    return response({ ok: false, error: 'PROBE_UNAVAILABLE' }, 503)
  }
  const auth = await verifySchedulePublicReadRequest(request, ownKey, { allowedService: PROBE_SERVICE, now: now() })
  if (!auth.ok) return response({ ok: false, error: 'PROBE_UNAUTHORIZED' }, 401)
  if (mode !== 'disabled' && edgeKey.length < 32) return response({ ok: false, error: 'PROBE_UNAVAILABLE' }, 503)
  const controller = new AbortController()
  let timer, rejectCancellation, cancelled = false
  const cancellation = new Promise((_resolve, reject) => { rejectCancellation = reject })
  void cancellation.catch(() => {})
  const cancel = () => { cancelled = true; controller.abort(); rejectCancellation(new Error('PROBE_FAILED')) }
  const limit = projection ? Math.min(timeoutMs, PROJECTION_PROBE_TIMEOUT_MS) : timeoutMs
  timer = setTimeout(cancel, limit)
  request.signal.addEventListener('abort', cancel, { once: true })
  if (request.signal.aborted) cancel()
  const bounded = (operation) => {
    if (cancelled || !isCurrent()) throw new Error('PROBE_FAILED')
    return Promise.race([operation(), cancellation])
  }
  const call = async (path, headers, expected) => {
    const result = await bounded(() => Promise.resolve(env.SCHEDULE_PUBLIC_READ.fetch(new Request(TARGET + path, { method: 'GET', headers, signal: controller.signal }))).then((value) => {
      if (cancelled) { try { void value.body?.cancel().catch(() => {}) } catch { /* Late response after cancellation. */ } }
      return value
    }))
    const cap = projection ? SCHEDULE_PUBLIC_READ_DATA_LIMITS.maxResponseBytes : 4096
    const declared = result.headers.get('content-length')
    if (projection && (result.status !== 200 || result.redirected
      || result.headers.get('x-skincos-schedule-public-read-contract') !== 'schedule-public-read/v1'
      || !/^application\/json(?:\s*;|$)/i.test(result.headers.get('content-type') || '')
      || (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > cap)))) {
      try { void result.body?.cancel().catch(() => {}) } catch { /* No provider error is relayed. */ }
      throw new Error('PROBE_FAILED')
    }
    const reader = result.body?.getReader()
    if (!reader) throw new Error('PROBE_FAILED')
    const chunks = []; let size = 0
    const cancelReader = () => { try { void reader.cancel().catch(() => {}) } catch { /* Bounded cleanup. */ } }
    controller.signal.addEventListener('abort', cancelReader, { once: true })
    try {
      while (true) {
        const { done, value } = await bounded(() => reader.read())
        if (done) break
        if (!(value instanceof Uint8Array)) throw new Error('PROBE_FAILED')
        size += value.byteLength
        if (size > cap) throw new Error('PROBE_FAILED')
        chunks.push(value)
      }
    } finally {
      controller.signal.removeEventListener('abort', cancelReader); cancelReader()
      try { reader.releaseLock() } catch { /* A pending read is cancelled. */ }
    }
    const bytes = new Uint8Array(size); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    return { status: result.status, body: projection ? assertSchedulePublicReadResponseBudget(validateSchedulePublicReadDto(body, expected)) : body }
  }
  const expect = (value, status, error) => {
    if (value.status !== status || (error && value.body?.error !== error)) throw new Error('PROBE_FAILED')
  }
  const signedCall = async (path, expected) => {
    const headers = await bounded(() => createSchedulePublicReadHeaders({ secret: edgeKey, url: TARGET + path, timestamp: String(now()) }))
    return call(path, headers, expected)
  }
  const work = async () => {
    if (mode === 'disabled') {
      expect(await call('/health'), 503, 'SCHEDULE_PUBLIC_READ_UNAVAILABLE')
      expect(await call(READINESS), 503, 'SCHEDULE_PUBLIC_READ_UNAVAILABLE')
      return { disabled: true }
    }
    if (projection) {
      const date = currentClinicDate(now())
      const units = []
      for (const unit of UNIT_ALLOWLIST) {
        const roster = (await signedCall(PUBLIC_PREFIX + '/professionals?unit=' + unit, { suffix: '/professionals', unit })).body
        const availability = (await signedCall(PUBLIC_PREFIX + '/availability?unit=' + unit + '&date=' + date, { suffix: '/availability', unit, date })).body
        const rosterById = new Map(roster.data.professionals.map((profile) => [profile.id, profile.name]))
        if (availability.data.professionals.some((profile) => rosterById.get(profile.id) !== profile.name)) throw new Error('PROBE_FAILED')
        units.push({ unit, rosterCount: roster.data.professionals.length, availabilityCount: availability.data.professionals.length,
          closed: availability.data.closed, rosterDigest: await bounded(() => publicDigest(roster)), availabilityDigest: await bounded(() => publicDigest(availability)) })
      }
      return { publicProjection: true, date, units }
    }
    const headers = await bounded(() => createSchedulePublicReadHeaders({ secret: edgeKey, url: TARGET + READINESS, timestamp: String(now()) }))
    const ready = await call(READINESS, headers)
    expect(ready, 200)
    if (ready.body?.ok !== true || ready.body?.ready !== true || ready.body?.contract !== 'schedule-public-read/v1') throw new Error('PROBE_FAILED')
    expect(await call(READINESS, headers), 409, 'SCHEDULE_PUBLIC_READ_REPLAYED')
    expect(await call(READINESS), 401, 'SCHEDULE_PUBLIC_READ_UNAUTHORIZED')
    const invalid = await bounded(() => createSchedulePublicReadHeaders({ secret: edgeKey + '-invalid', url: TARGET + READINESS, timestamp: String(now()) }))
    expect(await call(READINESS, invalid), 401, 'SCHEDULE_PUBLIC_READ_UNAUTHORIZED')
    return { readiness: true, replayRejected: true, unsignedRejected: true, invalidHmacRejected: true }
  }
  try {
    const checks = await bounded(work)
    if (!isCurrent() || cancelled) throw new Error('PROBE_FAILED')
    return response({ ok: true, contract: PROBE_CONTRACT, sourceSha: env.PROBE_SOURCE_SHA, mode,
      ...(projection ? { releaseId: env.PROBE_NATIVE_RELEASE_ID } : {}), checks })
  } catch { return response({ ok: false, error: 'PROBE_FAILED' }, 503) }
  finally { clearTimeout(timer); request.signal.removeEventListener('abort', cancel) }
}

export default { fetch: handleProductionProbe }
