import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SCHEDULE_PUBLIC_READ_SERVICE,
  createSchedulePublicReadHeaders,
  verifySchedulePublicReadRequest,
} from './public-read-contract.js'

const key = 'schedule-public-read-test-key'
const target = 'https://schedule.local/schedule-public-read/v1/availability?unit=novo-hamburgo&date=2026-09-15'

test('schedule public read HMAC binds exact read request and fixed Website service', async () => {
  const timestamp = String(Date.now())
  const headers = await createSchedulePublicReadHeaders({
    secret: key,
    url: target,
    timestamp,
    nonce: 'schedule-public-read-contract-0001',
  })
  const request = new Request(target, { headers })

  assert.deepEqual(await verifySchedulePublicReadRequest(request, key), { ok: true, service: SCHEDULE_PUBLIC_READ_SERVICE })
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
})
