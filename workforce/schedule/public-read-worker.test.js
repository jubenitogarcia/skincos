import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  createSchedulePublicReadHeaders,
  verifySchedulePublicReadRequest,
} from './public-read-contract.js'
import coreWorker from './worker.js'
import adapter from './public-read-worker.js'
import { createPublicReadTestDb } from './public-read-test-support.js'

const key = 'schedule-public-read-adapter-key'

function configuredAdapterEnv(overrides = {}) {
  const coreEnv = {
    APP_ORIGIN: 'https://crm.local',
    DB: createPublicReadTestDb(),
    SCHEDULE_PUBLIC_READ_ENABLED: 'true',
    SCHEDULE_PUBLIC_READ_HMAC_KEY: key,
  }
  return {
    SCHEDULE_PUBLIC_READ_ENABLED: 'true',
    SCHEDULE_PUBLIC_READ_HMAC_KEY: key,
    SCHEDULE_CORE: {
      fetch: (request) => coreWorker.fetch(request, coreEnv),
    },
    ...overrides,
  }
}

async function signedAdapterRequest(path, { secret = key, method = 'GET' } = {}) {
  const url = `https://adapter.internal${path}`
  const headers = await createSchedulePublicReadHeaders({
    secret,
    url,
    method,
    nonce: `schedule-public-read-adapter-${crypto.randomUUID()}`,
  })
  return new Request(url, { method, headers })
}

test('adapter forwards a new dedicated HMAC envelope to Schedule core without a public route', async () => {
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

  const healthWrite = await adapter.fetch(new Request('https://adapter.internal/health', { method: 'POST' }), configuredAdapterEnv())
  assert.equal(healthWrite.status, 405)
})

test('adapter rejects legacy Escala HMACs and methods that would expand its read-only contract', async () => {
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
  const coreHeaders = await createSchedulePublicReadHeaders({
    secret: key,
    url: coreUrl,
    nonce: `schedule-public-read-assert-${crypto.randomUUID()}`,
  })
  assert.equal((await verifySchedulePublicReadRequest(new Request(coreUrl, { headers: coreHeaders }), key)).ok, true)
})

test('adapter source stays disabled and isolated until a later staged resource cut', () => {
  const config = readFileSync(new URL('./public-read.wrangler.toml', import.meta.url), 'utf8')
  const source = readFileSync(new URL('./public-read-worker.js', import.meta.url), 'utf8')
  assert.match(config, /SCHEDULE_PUBLIC_READ_ENABLED = "false"/)
  assert.equal(/\broutes\s*=/.test(config), false)
  assert.equal(/\[\[d1_databases\]\]/.test(config), false)
  assert.equal(source.includes('ESCALA_ACTOR_HMAC_KEY'), false)
})
