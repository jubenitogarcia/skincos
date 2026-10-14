import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  SCHEDULE_PUBLIC_READ_CORE_SERVICE,
  SCHEDULE_PUBLIC_READ_MAX_SKEW_MS,
  createSchedulePublicReadHeaders,
} from './public-read-contract.js'
import coreWorker from './worker.js'
import adapter, { SCHEDULE_PUBLIC_READ_CORE_TIMEOUT_MS } from './public-read-adapter-runtime.js'
import { createPublicReadTestDb, PUBLIC_READ_TEST_ACTIVE_ID } from './public-read-test-support.js'

const edgeKey = 'schedule-public-read-edge-key'
const coreKey = 'schedule-public-read-core-key'

function configuredCoreEnv(overrides = {}) {
  return {
    APP_ORIGIN: 'https://crm.local',
    DB: createPublicReadTestDb(),
    SCHEDULE_PUBLIC_READ_ENABLED: 'true',
    SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY: coreKey,
    ...overrides,
  }
}

function configuredAdapterEnv(overrides = {}) {
  const coreEnv = configuredCoreEnv()
  const consumedNonces = new Set()
  return {
    SCHEDULE_PUBLIC_READ_ENABLED: 'true',
    SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY: edgeKey,
    SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY: coreKey,
    SCHEDULE_PUBLIC_READ_NONCE_GUARD: {
      getByName(nonce) {
        return {
          async consume() {
            if (consumedNonces.has(nonce)) return { ok: false, code: 'REPLAYED' }
            consumedNonces.add(nonce)
            return { ok: true }
          },
        }
      },
    },
    SCHEDULE_CORE: {
      fetch: (request) => coreWorker.fetch(request, coreEnv),
    },
    ...overrides,
  }
}

async function signedAdapterRequest(path, {
  secret = edgeKey,
  method = 'GET',
  nonce,
  timestamp,
} = {}) {
  const url = `https://adapter.internal${path}`
  const headers = await createSchedulePublicReadHeaders({
    secret,
    url,
    method,
    nonce: nonce || `schedule-public-read-adapter-${crypto.randomUUID()}`,
    ...(timestamp ? { timestamp } : {}),
  })
  return new Request(url, { method, headers })
}

test('adapter forwards a distinct core HMAC envelope after Website edge authentication', async () => {
  const response = await adapter.fetch(
    await signedAdapterRequest('/schedule-public-read/v1/availability?unit=novo-hamburgo&date=2026-09-15'),
    configuredAdapterEnv(),
  )
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('x-skincos-schedule-public-read-contract'), 'schedule-public-read/v1')
  assert.deepEqual((await response.json()).data, {
    unit: 'novo-hamburgo',
    date: '2026-09-15',
    closed: false,
    professionals: [{ id: PUBLIC_READ_TEST_ACTIVE_ID, name: 'Dra. Ana Teste' }],
    professionalNames: ['Dra. Ana Teste'],
  })
})

test('adapter health, readiness and reads fail closed until the isolated rollout is configured', async () => {
  const health = await adapter.fetch(new Request('https://adapter.internal/health'), {})
  assert.equal(health.status, 503)
  assert.equal((await health.json()).error, 'SCHEDULE_PUBLIC_READ_UNAVAILABLE')

  const readiness = await adapter.fetch(
    await signedAdapterRequest('/schedule-public-read/v1/readiness'),
    configuredAdapterEnv(),
  )
  assert.equal(readiness.status, 200)
  assert.equal((await readiness.json()).ready, true)

  const disabled = await adapter.fetch(
    await signedAdapterRequest('/schedule-public-read/v1/availability?unit=novo-hamburgo&date=2026-09-15'),
    configuredAdapterEnv({ SCHEDULE_PUBLIC_READ_ENABLED: 'false' }),
  )
  assert.equal(disabled.status, 503)

  const sharedKeys = await adapter.fetch(
    new Request('https://adapter.internal/health'),
    configuredAdapterEnv({ SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY: ` ${edgeKey} ` }),
  )
  assert.equal(sharedKeys.status, 503)

  const healthWrite = await adapter.fetch(new Request('https://adapter.internal/health', { method: 'POST' }), configuredAdapterEnv())
  assert.equal(healthWrite.status, 405)
})

test('adapter rejects legacy Escala HMACs and the edge key cannot authenticate direct core access', async () => {
  const path = '/schedule-public-read/v1/professionals?unit=novo-hamburgo'
  const usingLegacyKey = await adapter.fetch(
    await signedAdapterRequest(path, { secret: 'legacy-escala-key' }),
    configuredAdapterEnv(),
  )
  assert.equal(usingLegacyKey.status, 401)

  const write = await adapter.fetch(
    await signedAdapterRequest(path, { method: 'POST' }),
    configuredAdapterEnv(),
  )
  assert.equal(write.status, 405)

  const coreUrl = 'https://schedule-core.internal/api/escala/internal/schedule-public-read/v1/professionals?unit=novo-hamburgo'
  const edgeHeaders = await createSchedulePublicReadHeaders({
    secret: edgeKey,
    url: coreUrl,
    service: SCHEDULE_PUBLIC_READ_CORE_SERVICE,
    nonce: `schedule-public-read-assert-${crypto.randomUUID()}`,
  })
  const directCoreWithEdgeKey = await coreWorker.fetch(
    new Request(coreUrl, { headers: edgeHeaders }),
    configuredCoreEnv(),
  )
  assert.equal(directCoreWithEdgeKey.status, 401)

  const coreHeaders = await createSchedulePublicReadHeaders({
    secret: coreKey,
    url: coreUrl,
    service: SCHEDULE_PUBLIC_READ_CORE_SERVICE,
    nonce: `schedule-public-read-core-${crypto.randomUUID()}`,
  })
  const directCoreWithCoreKey = await coreWorker.fetch(
    new Request(coreUrl, { headers: coreHeaders }),
    configuredCoreEnv(),
  )
  assert.equal(directCoreWithCoreKey.status, 200)
})

test('adapter rejects a replayed edge envelope before reaching Schedule core', async () => {
  const env = configuredAdapterEnv()
  const request = await signedAdapterRequest('/schedule-public-read/v1/readiness')

  assert.equal((await adapter.fetch(request, env)).status, 200)
  const replay = await adapter.fetch(request, env)
  assert.equal(replay.status, 409)
  assert.equal((await replay.json()).error, 'SCHEDULE_PUBLIC_READ_REPLAYED')
})

test('adapter retains a consumed nonce only until the signed envelope expires', async () => {
  const signedAt = Date.now() - 60_000
  let guardExpiry = null
  const request = await signedAdapterRequest('/schedule-public-read/v1/readiness', {
    nonce: 'schedule-public-read-adapter-signed-expiry',
    timestamp: String(signedAt),
  })
  const response = await adapter.fetch(request, configuredAdapterEnv({
    SCHEDULE_PUBLIC_READ_NONCE_GUARD: {
      getByName() {
        return {
          async consume({ expiresAt }) {
            guardExpiry = expiresAt
            return { ok: true }
          },
        }
      },
    },
  }))

  assert.equal(response.status, 200)
  assert.equal(guardExpiry, signedAt + SCHEDULE_PUBLIC_READ_MAX_SKEW_MS)
  assert.ok(guardExpiry < Date.now() + SCHEDULE_PUBLIC_READ_MAX_SKEW_MS)
})

test('adapter source remains isolated with no public route and a Durable Object replay guard', () => {
  const config = readFileSync(new URL('./public-read.wrangler.toml', import.meta.url), 'utf8')
  const source = readFileSync(new URL('./public-read-worker.js', import.meta.url), 'utf8')
  const runtimeSource = readFileSync(new URL('./public-read-adapter-runtime.js', import.meta.url), 'utf8')
  assert.match(config, /SCHEDULE_PUBLIC_READ_ENABLED = "false"/)
  assert.equal(/\broutes\s*=/.test(config), false)
  assert.match(config, /SCHEDULE_PUBLIC_READ_NONCE_GUARD/)
  assert.match(config, /new_sqlite_classes = \["SchedulePublicReadNonceGuard"\]/)
  assert.match(source, /export\s+\{\s*SchedulePublicReadNonceGuard\s*\}/)
  assert.equal(runtimeSource.includes('ESCALA_ACTOR_HMAC_KEY'), false)
  assert.equal(runtimeSource.includes('SCHEDULE_PUBLIC_READ_HMAC_KEY'), false)
})

function coreResponse(body, headers = {}) {
  return Response.json(body, { headers: { 'x-skincos-schedule-public-read-contract': 'schedule-public-read/v1', ...headers } })
}
function publicRoster(overrides = {}) {
  return { ok: true, contract: 'schedule-public-read/v1', data: { unit: 'novo-hamburgo', professionals: [{ id: PUBLIC_READ_TEST_ACTIVE_ID, name: 'Dra. Ana Teste' }], ...overrides } }
}
test('adapter validates and rebuilds the public DTO without forwarding profile contacts or upstream headers', async () => {
  const upstream = publicRoster({ professionals: [{ id: PUBLIC_READ_TEST_ACTIVE_ID, name: 'Dra. Ana Teste', email: 'private-synthetic@example.invalid', phone: 'synthetic-private' }], internal: 'omit' })
  upstream.internal = 'omit'
  const response = await adapter.fetch(await signedAdapterRequest('/schedule-public-read/v1/professionals?unit=novo-hamburgo'), configuredAdapterEnv({
    SCHEDULE_CORE: { fetch: async () => coreResponse(upstream, { 'set-cookie': 'synthetic-private=yes', 'x-private-header': 'omit' }) },
  }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), publicRoster())
  assert.equal(response.headers.has('set-cookie'), false)
  assert.equal(response.headers.has('x-private-header'), false)
})
test('adapter rejects wrong core marker, content type, DTO identity, duplicate profile, unit and calendar response', async () => {
  const path = '/schedule-public-read/v1/professionals?unit=novo-hamburgo'
  const invalidResponses = [
    () => Response.json(publicRoster()),
    () => coreResponse(publicRoster(), { 'x-skincos-schedule-public-read-contract': 'other/v1' }),
    () => new Response(JSON.stringify(publicRoster()), { headers: { 'x-skincos-schedule-public-read-contract': 'schedule-public-read/v1', 'content-type': 'text/plain' } }),
    () => coreResponse(publicRoster({ unit: 'barra-shopping-sul' })),
    () => coreResponse(publicRoster({ professionals: [{ id: 'unproved-handle', name: 'Ana' }] })),
    () => coreResponse(publicRoster({ professionals: [{ id: PUBLIC_READ_TEST_ACTIVE_ID, name: 'Ana' }, { id: PUBLIC_READ_TEST_ACTIVE_ID, name: 'Outra' }] })),
    () => coreResponse(publicRoster({ professionals: [{ id: 'drasamarassilva', name: 'Ana' }] })),
    () => coreResponse({ ...publicRoster(), contract: 'other/v1' }),
  ]
  for (const createResponse of invalidResponses) {
    const response = await adapter.fetch(await signedAdapterRequest(path), configuredAdapterEnv({ SCHEDULE_CORE: { fetch: async () => createResponse() } }))
    assert.equal(response.status, 503)
    assert.equal((await response.json()).error, 'SCHEDULE_PUBLIC_READ_UNAVAILABLE')
  }
  const response = await adapter.fetch(await signedAdapterRequest('/schedule-public-read/v1/availability?unit=novo-hamburgo&date=2026-09-15'), configuredAdapterEnv({
    SCHEDULE_CORE: { fetch: async () => coreResponse({ ...publicRoster(), data: { ...publicRoster().data, date: '2026-09-16', closed: false } }) },
  }))
  assert.equal(response.status, 503)
})
test('adapter rejects unknown, duplicate and invalid calendar query parameters before contacting the core', async () => {
  const paths = ['/schedule-public-read/v1/readiness?unit=novo-hamburgo',
    '/schedule-public-read/v1/professionals?unit=novo-hamburgo&unit=barra-shopping-sul',
    '/schedule-public-read/v1/professionals?unit=novo-hamburgo&sql=SELECT',
    '/schedule-public-read/v1/availability?unit=novo-hamburgo&date=2026-02-29',
    '/schedule-public-read/v1/availability?unit=novo-hamburgo',
  ]
  for (const path of paths) {
    let calls = 0
    const response = await adapter.fetch(await signedAdapterRequest(path), configuredAdapterEnv({ SCHEDULE_CORE: { fetch: async () => { calls += 1; throw new Error('must not call') } } }))
    assert.equal(response.status, 400)
    assert.equal(calls, 0)
  }
})
test('adapter enforces actual and declared 64 KiB byte budgets and strict UTF-8 JSON decoding', async () => {
  const path = '/schedule-public-read/v1/professionals?unit=novo-hamburgo'
  const responses = [
    () => coreResponse(publicRoster(), { 'content-length': String(64 * 1024 + 1) }),
    () => coreResponse(publicRoster(), { 'content-length': 'invalid' }),
    () => coreResponse({ ...publicRoster(), extra: 'x'.repeat(64 * 1024) }, { 'content-length': '1' }),
    () => new Response(new Uint8Array([0xc3, 0x28]), { headers: { 'content-type': 'application/json', 'x-skincos-schedule-public-read-contract': 'schedule-public-read/v1' } }),
  ]
  for (const response of responses) {
    assert.equal((await adapter.fetch(await signedAdapterRequest(path), configuredAdapterEnv({ SCHEDULE_CORE: { fetch: async () => response() } }))).status, 503)
  }
})
test('adapter cancels caller-aborted streams and enforces one deadline over stalled core response reading', async () => {
  assert.equal(SCHEDULE_PUBLIC_READ_CORE_TIMEOUT_MS, 4_000)
  let signal, cancelled = 0
  const stalled = () => new Response(new ReadableStream({ start() {}, cancel() { cancelled += 1 } }), {
    headers: { 'content-type': 'application/json', 'x-skincos-schedule-public-read-contract': 'schedule-public-read/v1' },
  })
  const signed = await signedAdapterRequest('/schedule-public-read/v1/professionals?unit=novo-hamburgo')
  const controller = new AbortController()
  const request = new Request(signed, { signal: controller.signal })
  const pending = adapter.fetch(request, configuredAdapterEnv({ SCHEDULE_CORE: { fetch: async (upstream) => { signal = upstream.signal; queueMicrotask(() => controller.abort()); return stalled() } } }))
  assert.equal((await pending).status, 503)
  assert.equal(signal.aborted, true)
  assert.equal(cancelled, 1)
  let deadlineSignal
  const deadline = await adapter.fetch(await signedAdapterRequest('/schedule-public-read/v1/professionals?unit=novo-hamburgo'), configuredAdapterEnv({
    SCHEDULE_CORE: { fetch: async (upstream) => { deadlineSignal = upstream.signal; return stalled() } },
  }))
  assert.equal(deadline.status, 503)
  assert.equal(deadlineSignal.aborted, true)
  assert.equal(cancelled, 2)
})
