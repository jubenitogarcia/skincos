import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  SCHEDULE_PUBLIC_READ_CORE_SERVICE,
  createSchedulePublicReadHeaders,
} from './public-read-contract.js'
import coreWorker from './worker.js'
import adapter from './public-read-worker.js'
import { createPublicReadTestDb } from './public-read-test-support.js'

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
  return {
    SCHEDULE_PUBLIC_READ_ENABLED: 'true',
    SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY: edgeKey,
    SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY: coreKey,
    SCHEDULE_CORE: {
      fetch: (request) => coreWorker.fetch(request, coreEnv),
    },
    ...overrides,
  }
}

async function signedAdapterRequest(path, { secret = edgeKey, method = 'GET' } = {}) {
  const url = `https://adapter.internal${path}`
  const headers = await createSchedulePublicReadHeaders({
    secret,
    url,
    method,
    nonce: `schedule-public-read-adapter-${crypto.randomUUID()}`,
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
    unit: 'novohamburgo',
    date: '2026-09-15',
    closed: false,
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

test('adapter source stays disabled and isolated until a later staged resource cut', () => {
  const config = readFileSync(new URL('./public-read.wrangler.toml', import.meta.url), 'utf8')
  const source = readFileSync(new URL('./public-read-worker.js', import.meta.url), 'utf8')
  assert.match(config, /SCHEDULE_PUBLIC_READ_ENABLED = "false"/)
  assert.equal(/\broutes\s*=/.test(config), false)
  assert.equal(/\[\[d1_databases\]\]/.test(config), false)
  assert.equal(source.includes('ESCALA_ACTOR_HMAC_KEY'), false)
  assert.equal(source.includes('SCHEDULE_PUBLIC_READ_HMAC_KEY'), false)
})
