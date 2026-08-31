import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SCHEDULE_PUBLIC_READ_CORE_SERVICE,
  SCHEDULE_PUBLIC_READ_EDGE_SERVICE,
  createSchedulePublicReadHeaders,
  verifySchedulePublicReadRequest,
} from './public-read-contract.js'

const key = 'schedule-public-read-test-key'
const target = 'https://schedule.local/schedule-public-read/v1/availability?unit=novo-hamburgo&date=2026-09-15'

test('schedule public read HMAC binds exact read request and fixed Website edge service', async () => {
  const timestamp = String(Date.now())
  const headers = await createSchedulePublicReadHeaders({
    secret: key,
    url: target,
    timestamp,
    nonce: 'schedule-public-read-contract-0001',
  })
  const request = new Request(target, { headers })

  assert.deepEqual(await verifySchedulePublicReadRequest(request, key), {
    ok: true,
    service: SCHEDULE_PUBLIC_READ_EDGE_SERVICE,
    timestamp: Number(timestamp),
  })
  assert.equal((await verifySchedulePublicReadRequest(new Request('https://schedule.local/schedule-public-read/v1/availability?unit=novo-hamburgo&date=2026-09-16', { headers }), key)).ok, false)
  assert.equal((await verifySchedulePublicReadRequest(new Request(target, { method: 'POST', headers }), key)).error, 'METHOD_NOT_ALLOWED')
  assert.equal((await verifySchedulePublicReadRequest(request, 'another-key')).ok, false)
})

test('schedule public read HMAC rejects stale nonces and another service identity', async () => {
  const staleTimestamp = String(Date.now() - (6 * 60 * 1000))
  const staleHeaders = await createSchedulePublicReadHeaders({
    secret: key,
    url: target,
    timestamp: staleTimestamp,
    nonce: 'schedule-public-read-contract-0002',
  })
  assert.equal((await verifySchedulePublicReadRequest(new Request(target, { headers: staleHeaders }), key)).ok, false)

  const wrongServiceHeaders = await createSchedulePublicReadHeaders({
    secret: key,
    url: target,
    service: 'crm-escala',
    nonce: 'schedule-public-read-contract-0003',
  })
  assert.equal((await verifySchedulePublicReadRequest(new Request(target, { headers: wrongServiceHeaders }), key)).ok, false)

  const fractionalTimestampHeaders = await createSchedulePublicReadHeaders({
    secret: key,
    url: target,
    timestamp: `${Date.now()}.5`,
    nonce: 'schedule-public-read-contract-0005',
  })
  assert.equal((await verifySchedulePublicReadRequest(new Request(target, { headers: fractionalTimestampHeaders }), key)).ok, false)
})

test('schedule public read signer and verifier normalize keys and keep hop identities distinct', async () => {
  const coreKey = 'schedule-public-read-core-test-key'
  const headers = await createSchedulePublicReadHeaders({
    secret: `  ${coreKey}  `,
    url: target,
    service: SCHEDULE_PUBLIC_READ_CORE_SERVICE,
    nonce: 'schedule-public-read-contract-0004',
  })
  const request = new Request(target, { headers })

  assert.deepEqual(
    await verifySchedulePublicReadRequest(request, coreKey, { allowedService: SCHEDULE_PUBLIC_READ_CORE_SERVICE }),
    { ok: true, service: SCHEDULE_PUBLIC_READ_CORE_SERVICE, timestamp: Number(headers['x-skincos-schedule-read-ts']) },
  )
  assert.deepEqual(
    await verifySchedulePublicReadRequest(request, `\t${coreKey}\n`, { allowedService: SCHEDULE_PUBLIC_READ_CORE_SERVICE }),
    { ok: true, service: SCHEDULE_PUBLIC_READ_CORE_SERVICE, timestamp: Number(headers['x-skincos-schedule-read-ts']) },
  )
  assert.equal((await verifySchedulePublicReadRequest(request, coreKey)).ok, false)
})
