import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SCHEDULE_PUBLIC_READ_CORE_SERVICE,
  createSchedulePublicReadHeaders,
} from './public-read-contract.js'
import worker from './worker.js'
import { PublicReadTestD1, createPublicReadTestDb } from './public-read-test-support.js'

const coreReadKey = 'schedule-public-read-core-test-key'
const edgeReadKey = 'schedule-public-read-edge-key-must-not-authorize-core'
const legacyEscalaKey = 'legacy-escala-key-must-not-authorize-public-read'

function publicReadEnv(db = createPublicReadTestDb(), overrides = {}) {
  return {
    APP_ORIGIN: 'https://crm.local',
    DB: db,
    SCHEDULE_PUBLIC_READ_ENABLED: 'true',
    SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY: coreReadKey,
    ESCALA_ACTOR_HMAC_KEY: legacyEscalaKey,
    ...overrides,
  }
}

async function signedCoreRequest(path, { secret = coreReadKey, method = 'GET' } = {}) {
  const url = `https://schedule.internal${path}`
  const headers = await createSchedulePublicReadHeaders({
    secret,
    url,
    method,
    service: SCHEDULE_PUBLIC_READ_CORE_SERVICE,
    nonce: `schedule-public-read-core-${crypto.randomUUID()}`,
  })
  return new Request(url, { method, headers })
}

test('Schedule core exposes only the HMAC-authenticated v1 availability and profile projection', async () => {
  const env = publicReadEnv()
  const availability = await worker.fetch(
    await signedCoreRequest('/api/escala/internal/schedule-public-read/v1/availability?unit=novo-hamburgo&date=2026-09-15'),
    env,
  )
  assert.equal(availability.status, 200)
  assert.deepEqual((await availability.json()).data, {
    unit: 'novohamburgo',
    date: '2026-09-15',
    closed: false,
    professionalNames: ['Dra. Ana Teste'],
  })

  const profiles = await worker.fetch(
    await signedCoreRequest('/api/escala/internal/schedule-public-read/v1/professionals?unit=novo-hamburgo'),
    env,
  )
  assert.equal(profiles.status, 200)
  const profileBody = await profiles.json()
  assert.equal(profileBody.data.professionals.length, 1)
  assert.deepEqual(profileBody.data.professionals[0], {
    name: 'Dra. Ana Teste',
    status: 'Ativo',
    role: 'Injetora',
    nickname: 'Ana',
    instagram: 'dra.ana.teste',
    units: ['Novo Hamburgo'],
  })
  assert.equal(JSON.stringify(profileBody).includes('private-phone-must-not-leak'), false)
  assert.equal(JSON.stringify(profileBody).includes('private-email-must-not-leak'), false)
})

test('Schedule core readiness and public-read routes fail closed without the new dedicated capability', async () => {
  const path = '/api/escala/internal/schedule-public-read/v1/readiness'
  const missingCapability = await worker.fetch(await signedCoreRequest(path), publicReadEnv(createPublicReadTestDb(), {
    SCHEDULE_PUBLIC_READ_ENABLED: 'false',
  }))
  assert.equal(missingCapability.status, 503)
  assert.equal((await missingCapability.json()).error, 'SCHEDULE_PUBLIC_READ_UNAVAILABLE')

  const usingLegacyEscalaKey = await worker.fetch(
    await signedCoreRequest(path, { secret: legacyEscalaKey }),
    publicReadEnv(),
  )
  assert.equal(usingLegacyEscalaKey.status, 401)
  assert.equal((await usingLegacyEscalaKey.json()).error, 'SCHEDULE_PUBLIC_READ_UNAUTHORIZED')

  const usingEdgeReadKey = await worker.fetch(
    await signedCoreRequest(path, { secret: edgeReadKey }),
    publicReadEnv(),
  )
  assert.equal(usingEdgeReadKey.status, 401)
  assert.equal((await usingEdgeReadKey.json()).error, 'SCHEDULE_PUBLIC_READ_UNAUTHORIZED')

  const unavailableDb = await worker.fetch(
    await signedCoreRequest(path),
    publicReadEnv(new PublicReadTestD1({ available: false })),
  )
  assert.equal(unavailableDb.status, 503)
  assert.equal((await unavailableDb.json()).error, 'SCHEDULE_PUBLIC_READ_NOT_READY')
})

test('Schedule core rejects unsigned, malformed and non-read public-read requests', async () => {
  const env = publicReadEnv()
  const path = '/api/escala/internal/schedule-public-read/v1/availability?unit=novo-hamburgo&date=2026-09-15'
  const unsigned = await worker.fetch(new Request(`https://schedule.internal${path}`), env)
  assert.equal(unsigned.status, 401)

  const malformed = await worker.fetch(
    await signedCoreRequest('/api/escala/internal/schedule-public-read/v1/availability?unit=unknown&date=not-a-date'),
    env,
  )
  assert.equal(malformed.status, 400)
  assert.equal((await malformed.json()).error, 'INVALID_UNIT')

  const write = await worker.fetch(
    await signedCoreRequest(path, { method: 'POST' }),
    env,
  )
  assert.equal(write.status, 405)
})
