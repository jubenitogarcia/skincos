import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SCHEDULE_PUBLIC_READ_CORE_SERVICE,
  createSchedulePublicReadHeaders,
} from './public-read-contract.js'
import worker from './worker.js'
import { PublicReadTestD1, createPublicReadTestDb, PUBLIC_READ_TEST_ACTIVE_ID } from './public-read-test-support.js'

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
    unit: 'novo-hamburgo',
    date: '2026-09-15',
    closed: false,
    professionals: [{ id: PUBLIC_READ_TEST_ACTIVE_ID, name: 'Dra. Ana Teste' }],
    professionalNames: ['Dra. Ana Teste'],
  })

  const profiles = await worker.fetch(
    await signedCoreRequest('/api/escala/internal/schedule-public-read/v1/professionals?unit=novo-hamburgo'),
    env,
  )
  assert.equal(profiles.status, 200)
  const profileBody = await profiles.json()
  assert.equal(profileBody.data.professionals.length, 1)
  assert.deepEqual(profileBody.data.professionals[0], { id: PUBLIC_READ_TEST_ACTIVE_ID, name: 'Dra. Ana Teste' })
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


test('core uses identical clinical eligibility in roster and availability with read-only primary batches', async () => {
  const db = createPublicReadTestDb()
  for (const [index, role] of ['Consultor', 'Diretor', 'Gerente', 'Injetora'].entries()) {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-' + String(index + 1).padStart(12, '0')
    db.professionals.push({ id, name: 'Fixture staff ' + index, status: 'Ativo', role, units_json: '["Novo Hamburgo"]' })
    db.scheduleEntries.push({ unit: 'Novo Hamburgo', date: '2026-09-15', professional_id: id, professional_name: 'Fixture staff ' + index })
  }
  db.scheduleEntries.push({ unit: 'Novo Hamburgo', date: '2026-09-15', professional_id: db.professionals[1].id, professional_name: db.professionals[1].name })
  db.professionals[0].role = 'Injetor, Responsável Técnico'
  for (const suffix of ['professionals', 'availability']) {
    const response = await worker.fetch(await signedCoreRequest('/api/escala/internal/schedule-public-read/v1/' + suffix + '?unit=novo-hamburgo' + (suffix === 'availability' ? '&date=2026-09-15' : '')), publicReadEnv(db))
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json()).data.professionals, [{ id: PUBLIC_READ_TEST_ACTIVE_ID, name: 'Dra. Ana Teste' }])
  }
  assert.deepEqual(db.sessions, ['first-primary', 'first-primary'])
  assert.equal(db.batches.length, 2); assert.equal(db.writeAttempts, 0)
  assert.ok(db.batches.flat().every(sql => /^select\b/i.test(sql)))
})

test('nullable exact-name references resolve while requested orphans, renames and unit mismatches fail closed', async () => {
  const path = '/api/escala/internal/schedule-public-read/v1/availability?unit=novo-hamburgo&date=2026-09-15'
  const db = createPublicReadTestDb(); db.scheduleEntries[0].professional_id = null
  assert.equal((await worker.fetch(await signedCoreRequest(path), publicReadEnv(db))).status, 200)
  db.scheduleEntries.push({ unit: 'Novo Hamburgo', date: '2000-01-01', professional_id: null, professional_name: 'Fixture historical orphan' })
  assert.equal((await worker.fetch(await signedCoreRequest(path), publicReadEnv(db))).status, 200)
  for (const change of [{ professional_id: null, professional_name: 'Fixture orphan' }, { professional_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }, { professional_name: 'Fixture renamed' }]) {
    const corrupt = createPublicReadTestDb(); Object.assign(corrupt.scheduleEntries[0], change)
    corrupt.closedDays.push({ unit: 'Novo Hamburgo', date: '2026-09-15' })
    const response = await worker.fetch(await signedCoreRequest(path), publicReadEnv(corrupt))
    assert.equal(response.status, 503); assert.equal((await response.json()).error, 'SCHEDULE_PUBLIC_READ_NOT_READY')
    assert.equal(corrupt.writeAttempts, 0)
  }
  const wrongUnit = createPublicReadTestDb(); wrongUnit.professionals[0].units_json = '["BarraShoppingSul"]'
  assert.equal((await worker.fetch(await signedCoreRequest(path), publicReadEnv(wrongUnit))).status, 503)
})

test('both canonical units retain the same source identity and accurate closed-day flag', async () => {
  const db = createPublicReadTestDb(); db.professionals[0].units_json = '["Novo Hamburgo","BarraShoppingSul"]'
  db.scheduleEntries.push({ unit: 'BarraShoppingSul', date: '2026-09-15', professional_name: db.professionals[0].name, professional_id: db.professionals[0].id })
  db.holidays.push({ unit: 'BarraShoppingSul', date: '2026-09-15' })
  for (const unit of ['novo-hamburgo', 'barra-shopping-sul']) {
    const response = await worker.fetch(await signedCoreRequest('/api/escala/internal/schedule-public-read/v1/availability?unit=' + unit + '&date=2026-09-15'), publicReadEnv(db))
    assert.equal(response.status, 200)
    const data = (await response.json()).data
    assert.equal(data.unit, unit); assert.equal(data.closed, unit === 'barra-shopping-sul')
    assert.deepEqual(data.professionals, [{ id: PUBLIC_READ_TEST_ACTIVE_ID, name: 'Dra. Ana Teste' }])
  }
})
