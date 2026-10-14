import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { createSchedulePublicReadHeaders, verifySchedulePublicReadRequest } from './public-read-contract.js'
import { handleProductionProbe, PROBE_SERVICE, PROJECTION_PROBE_TIMEOUT_MS } from './public-read-production-probe.js'

const own = 'synthetic-projection-probe-key-'.repeat(3)
const edge = 'synthetic-projection-edge-key-'.repeat(3)
const sourceSha = 'a'.repeat(40)
const releaseId = '11111111-1111-4111-8111-111111111111'
const profile = { id: '22222222-2222-4222-8222-222222222222', name: 'Dra. Ana Sintética' }
const time = Date.UTC(2026, 9, 15, 2, 30)
const date = '2026-10-14'
function environment(clock = () => time) {
  const calls = [], nonces = new Set()
  const env = { calls, PROBE_SOURCE_SHA: sourceSha, PROBE_NATIVE_RELEASE_ID: releaseId, PROBE_EXPIRES_AT_MS: String(time + 20 * 60_000),
    SCHEDULE_PUBLIC_READ_PROBE_HMAC_KEY: own, SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY: edge,
    SCHEDULE_PUBLIC_READ: { async fetch(request) {
      const url = new URL(request.url)
      calls.push({ path: url.pathname + url.search, method: request.method })
      assert.equal(url.origin, 'https://schedule-public-read.internal')
      assert.equal(request.method, 'GET')
      assert.ok(['/schedule-public-read/v1/professionals', '/schedule-public-read/v1/availability'].includes(url.pathname))
      const auth = await verifySchedulePublicReadRequest(request, edge, { now: clock() })
      assert.equal(auth.ok, true)
      const nonce = request.headers.get('x-skincos-schedule-read-nonce')
      assert.equal(nonces.has(nonce), false)
      nonces.add(nonce)
      const unit = url.searchParams.get('unit')
      assert.ok(['novo-hamburgo', 'barra-shopping-sul'].includes(unit))
      const availability = url.pathname.endsWith('/availability')
      if (availability) assert.equal(url.searchParams.get('date'), date)
      const data = { unit, professionals: [{ ...profile, email: 'synthetic-private@example.invalid' }], privateExtra: 'omit' }
      if (availability) Object.assign(data, { date, closed: unit === 'barra-shopping-sul', professionalNames: [profile.name] })
      return Response.json({ ok: true, contract: 'schedule-public-read/v1', data, privateExtra: 'omit' }, { headers: { 'x-skincos-schedule-public-read-contract': 'schedule-public-read/v1' } })
    } },
  }
  return env
}
async function signed(path = '/verify/public-projection', { secret = own, service = PROBE_SERVICE, clock = () => time } = {}) {
  const url = 'https://probe.internal' + path
  return new Request(url, { headers: await createSchedulePublicReadHeaders({ secret, service, url, timestamp: String(clock()) }) })
}
const digest = (body) => createHash('sha256').update(JSON.stringify(body)).digest('hex')
test('native projection probe uses four fixed authenticated GETs and emits only counts and validated DTO digests', async () => {
  const env = environment()
  const result = await handleProductionProbe(await signed(), env, { now: () => time })
  assert.equal(result.status, 200)
  const units = ['novo-hamburgo', 'barra-shopping-sul'].map((unit) => {
    const roster = { ok: true, contract: 'schedule-public-read/v1', data: { unit, professionals: [profile] } }
    const availability = { ok: true, contract: 'schedule-public-read/v1', data: { unit, date, closed: unit === 'barra-shopping-sul', professionals: [profile], professionalNames: [profile.name] } }
    return { unit, rosterCount: 1, availabilityCount: 1, closed: availability.data.closed, rosterDigest: digest(roster), availabilityDigest: digest(availability) }
  })
  const body = await result.json()
  assert.deepEqual(body, { ok: true, contract: 'schedule-public-read-production-probe/v1', sourceSha, releaseId, mode: 'public-projection', checks: { publicProjection: true, date, units } })
  assert.equal(JSON.stringify(body).includes(profile.name), false)
  assert.equal(JSON.stringify(body).includes('private'), false)
  assert.deepEqual(env.calls, ['novo-hamburgo', 'barra-shopping-sul'].flatMap((unit) => [
    { method: 'GET', path: '/schedule-public-read/v1/professionals?unit=' + unit },
    { method: 'GET', path: '/schedule-public-read/v1/availability?unit=' + unit + '&date=' + date },
  ]))
})
test('native projection probe requires its own service HMAC, release UUID and at most thirty-minute lifetime', async () => {
  for (const patch of [{ PROBE_NATIVE_RELEASE_ID: '' }, { PROBE_NATIVE_RELEASE_ID: 'fabricated-run-id' },
    { PROBE_EXPIRES_AT_MS: String(time + 31 * 60_000) }, { PROBE_EXPIRES_AT_MS: String(time) },
    { SCHEDULE_PUBLIC_READ_PROBE_HMAC_KEY: edge }, { SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY: '' }]) {
    const env = { ...environment(), ...patch }
    assert.equal((await handleProductionProbe(await signed(), env, { now: () => time })).status, 503)
    assert.equal(env.calls.length, 0)
  }
  for (const request of [await signed('/verify/public-projection?unit=novo-hamburgo'), await signed('/verify/public-projection', { service: 'website-booking' }),
    await signed('/verify/public-projection', { secret: 'wrong-synthetic-key' }), new Request('https://probe.internal/verify/public-projection')]) {
    const env = environment()
    assert.notEqual((await handleProductionProbe(request, env, { now: () => time })).status, 200)
    assert.equal(env.calls.length, 0)
  }
})
test('native projection probe fails closed on malformed DTOs, missing marker, non-roster availability and response budgets', async () => {
  const validRoster = { ok: true, contract: 'schedule-public-read/v1', data: { unit: 'novo-hamburgo', professionals: [profile] } }
  const bad = [
    () => Response.json(validRoster),
    () => Response.json({ ...validRoster, data: { ...validRoster.data, unit: 'barra-shopping-sul' } }, { headers: { 'x-skincos-schedule-public-read-contract': 'schedule-public-read/v1' } }),
    () => Response.json({ ...validRoster, data: { ...validRoster.data, professionals: [{ id: 'unproved-id', name: 'Ana' }] } }, { headers: { 'x-skincos-schedule-public-read-contract': 'schedule-public-read/v1' } }),
    () => Response.json({ ...validRoster, extra: 'x'.repeat(64 * 1024) }, { headers: { 'x-skincos-schedule-public-read-contract': 'schedule-public-read/v1', 'content-length': '1' } }),
    () => Response.json(validRoster, { headers: { 'x-skincos-schedule-public-read-contract': 'schedule-public-read/v1', 'content-length': String(64 * 1024 + 1) } }),
  ]
  for (const response of bad) {
    const env = { ...environment(), SCHEDULE_PUBLIC_READ: { fetch: async () => response() } }
    const result = await handleProductionProbe(await signed(), env, { now: () => time })
    assert.equal(result.status, 503)
    assert.deepEqual(await result.json(), { ok: false, error: 'PROBE_FAILED' })
  }
  const env = environment()
  const original = env.SCHEDULE_PUBLIC_READ.fetch
  env.SCHEDULE_PUBLIC_READ.fetch = async (request) => {
    const response = await original(request)
    if (!new URL(request.url).pathname.endsWith('/availability')) return response
    const body = await response.json()
    body.data.professionals = [{ id: '33333333-3333-4333-8333-333333333333', name: 'Outra Sintética' }]
    body.data.professionalNames = ['Outra Sintética']
    return Response.json(body, { headers: response.headers })
  }
  assert.equal((await handleProductionProbe(await signed(), env, { now: () => time })).status, 503)
})
test('native projection proof rechecks expiration between calls and cannot complete an expired release', async () => {
  let clock = time
  const env = environment(() => clock)
  const original = env.SCHEDULE_PUBLIC_READ.fetch
  env.SCHEDULE_PUBLIC_READ.fetch = async (request) => { const response = await original(request); clock = Number(env.PROBE_EXPIRES_AT_MS) + 1; return response }
  assert.equal((await handleProductionProbe(await signed(), env, { now: () => clock })).status, 503)
  assert.equal(env.calls.length, 1)
})
test('native projection proof bounds stalled fetch/stream to one four-second deadline and cancels streams', async () => {
  assert.equal(PROJECTION_PROBE_TIMEOUT_MS, 4_000)
  let cancelled = 0
  for (const fetch of [() => new Promise(() => {}), async () => new Response(new ReadableStream({ start() {}, cancel() { cancelled += 1 } }), {
    headers: { 'content-type': 'application/json', 'x-skincos-schedule-public-read-contract': 'schedule-public-read/v1' },
  })]) {
    const env = { ...environment(), SCHEDULE_PUBLIC_READ: { fetch } }
    const result = await handleProductionProbe(await signed(), env, { now: () => time, timeoutMs: 10 })
    assert.equal(result.status, 503)
    assert.deepEqual(await result.json(), { ok: false, error: 'PROBE_FAILED' })
  }
  assert.equal(cancelled, 1)
})
