import { createSchedulePublicReadHeaders, verifySchedulePublicReadRequest } from './public-read-contract.js'

export const PROBE_CONTRACT = 'schedule-public-read-production-probe/v1'
export const PROBE_SERVICE = 'schedule-production-verifier'
const TARGET = 'https://schedule-public-read.internal'
const READINESS = '/schedule-public-read/v1/readiness'
const MODES = new Set(['/verify/ready', '/verify/disabled'])

function response(body, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

// This ephemeral verifier cannot accept a target, query, payload, path, SQL,
// patient data, or downstream response. Its binding is fixed by source config.
export async function handleProductionProbe(request, env, { now = Date.now, timeoutMs = 10_000 } = {}) {
  const url = new URL(request.url)
  if (request.method !== 'GET' || !MODES.has(url.pathname) || url.search || request.body) {
    return response({ ok: false, error: 'PROBE_REQUEST_REJECTED' }, 404)
  }
  const deadline = Number(env?.PROBE_EXPIRES_AT_MS)
  const ownKey = String(env?.SCHEDULE_PUBLIC_READ_PROBE_HMAC_KEY || '').trim()
  const edgeKey = String(env?.SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY || '').trim()
  if (!Number.isSafeInteger(deadline) || deadline <= now() || deadline > now() + 60 * 60_000
    || ownKey.length < 32 || (edgeKey && ownKey === edgeKey)
    || !/^[0-9a-f]{40}$/.test(env?.PROBE_SOURCE_SHA || '') || typeof env?.SCHEDULE_PUBLIC_READ?.fetch !== 'function') {
    return response({ ok: false, error: 'PROBE_UNAVAILABLE' }, 503)
  }
  const auth = await verifySchedulePublicReadRequest(request, ownKey, { allowedService: PROBE_SERVICE, now: now() })
  if (!auth.ok) return response({ ok: false, error: 'PROBE_UNAUTHORIZED' }, 401)
  const mode = url.pathname.endsWith('/disabled') ? 'disabled' : 'ready'
  if (mode === 'ready' && edgeKey.length < 32) return response({ ok: false, error: 'PROBE_UNAVAILABLE' }, 503)
  const controller = new AbortController()
  let timer
  const work = async () => {
    const call = async (path, headers) => {
      const result = await env.SCHEDULE_PUBLIC_READ.fetch(new Request(`${TARGET}${path}`, { headers, signal: controller.signal }))
      // Only bounded contract metadata is consumed, and none is relayed.
      const reader = result.body?.getReader()
      if (!reader) throw new Error('PROBE_FAILED')
      const chunks = []
      let size = 0
      const cancel = () => { void reader.cancel().catch(() => {}) }
      controller.signal.addEventListener('abort', cancel, { once: true })
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > 4096) throw new Error('PROBE_FAILED')
          chunks.push(value)
        }
      } finally {
        controller.signal.removeEventListener('abort', cancel)
        void reader.cancel().catch(() => {})
        reader.releaseLock()
      }
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
      return { status: result.status, body: JSON.parse(new TextDecoder().decode(bytes)) }
    }
    const expect = (value, status, error) => {
      if (value.status !== status || (error && value.body?.error !== error)) throw new Error('PROBE_FAILED')
    }
    if (mode === 'disabled') {
      expect(await call('/health'), 503, 'SCHEDULE_PUBLIC_READ_UNAVAILABLE')
      expect(await call(READINESS), 503, 'SCHEDULE_PUBLIC_READ_UNAVAILABLE')
      return { disabled: true }
    }
    const headers = await createSchedulePublicReadHeaders({ secret: edgeKey, url: `${TARGET}${READINESS}` })
    const ready = await call(READINESS, headers)
    expect(ready, 200)
    if (ready.body?.ok !== true || ready.body?.ready !== true || ready.body?.contract !== 'schedule-public-read/v1') throw new Error('PROBE_FAILED')
    expect(await call(READINESS, headers), 409, 'SCHEDULE_PUBLIC_READ_REPLAYED')
    expect(await call(READINESS), 401, 'SCHEDULE_PUBLIC_READ_UNAUTHORIZED')
    const invalid = await createSchedulePublicReadHeaders({ secret: `${edgeKey}-invalid`, url: `${TARGET}${READINESS}` })
    expect(await call(READINESS, invalid), 401, 'SCHEDULE_PUBLIC_READ_UNAUTHORIZED')
    return { readiness: true, replayRejected: true, unsignedRejected: true, invalidHmacRejected: true }
  }
  try {
    const checks = await Promise.race([work(), new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('PROBE_TIMEOUT')) }, timeoutMs)
    })])
    return response({ ok: true, contract: PROBE_CONTRACT, sourceSha: env.PROBE_SOURCE_SHA, mode, checks })
  } catch {
    return response({ ok: false, error: 'PROBE_FAILED' }, 503)
  } finally { clearTimeout(timer) }
}

export default { fetch: handleProductionProbe }
