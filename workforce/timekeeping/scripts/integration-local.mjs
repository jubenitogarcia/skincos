#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash, createHmac, randomUUID } from 'node:crypto'

const baseUrl = process.env.PONTO_BASE_URL || 'http://127.0.0.1:8799'
const actorKey = process.env.PONTO_ACTOR_HMAC_KEY || 'test-actor-key-not-secret'
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const actorHeaders = (actor, method, path, nonce, bodyText) => {
  const payload = encode(actor); const timestamp = String(Date.now())
  const bodyHash = createHash('sha256').update(bodyText || '').digest('hex')
  const signature = createHmac('sha256', actorKey).update([timestamp, payload, method, path, nonce, bodyHash].join('.')).digest('base64url')
  return { 'x-skincos-actor': payload, 'x-skincos-actor-ts': timestamp, 'x-skincos-actor-sig': signature, 'x-skincos-signature-version': '2' }
}
const employee = { id: 'synthetic-employee-actor', email: 'ponto.synthetic@example.invalid', role: 'EMPLOYEE', allowedUnits: ['SYNTHETIC_UNIT'] }
const admin = { id: 'synthetic-admin', email: 'ponto.admin@example.invalid', role: 'ADMIN', allowedUnits: [] }
async function call(path, { method = 'GET', actor, body, nonce = randomUUID(), headers = {} } = {}) {
  const normalizedMethod = method.toUpperCase(); const bodyText = body === undefined ? '' : JSON.stringify(body); const requestNonce = !['GET', 'HEAD', 'OPTIONS'].includes(normalizedMethod) ? nonce : ''
  const response = await fetch(`${baseUrl}${path}`, { method: normalizedMethod, headers: { accept: 'application/json', ...(actor ? actorHeaders(actor, normalizedMethod, `/api/ponto${path.replace(/^\/api\/ponto/, '')}`, requestNonce, bodyText) : {}), ...(requestNonce ? { 'content-type': 'application/json', 'x-request-nonce': requestNonce } : {}), ...headers }, body: body === undefined ? undefined : bodyText })
  const text = await response.text(); let payload
  try { payload = JSON.parse(text) } catch { assert.fail(`Expected JSON from ${path}, received ${text.slice(0, 120)}`) }
  return { response, payload }
}

const health = await call('/api/ponto/health')
assert.equal(health.response.status, 200); assert.equal(health.payload.service, 'workforce-timekeeping')
assert.equal(health.response.headers.get('content-type')?.startsWith('application/json'), true)
const readiness = await call('/api/ponto/readiness')
assert.equal(readiness.response.status, 200); assert.equal(readiness.payload.database, 'available')
assert.equal((await call('/api/ponto/employees')).response.status, 401)

const context = await call('/api/ponto/context', { actor: employee })
assert.equal(context.response.status, 200); assert.equal(context.payload.data.linked, true)
assert.equal(context.payload.data.employee.employeeId, 'legacy:ponto:synthetic-employee-001')
const employees = await call('/api/ponto/employees', { actor: admin })
assert.equal(employees.response.status, 200); assert.equal(employees.payload.data.length, 1)
assert.equal(JSON.stringify(employees.payload).includes('pinHash'), false)

const daily = await call('/api/ponto/daily?employeeId=synthetic-employee-001&unitId=SYNTHETIC_UNIT&date=2026-01-02', { actor: admin })
assert.equal(daily.response.status, 200)
const outOfScopeManager = { id: 'synthetic-manager-other-unit', email: 'manager.other@example.invalid', role: 'MANAGER', allowedUnits: ['OTHER_UNIT'] }
const outOfScopeDaily = await call('/api/ponto/daily?employeeId=synthetic-employee-001&unitId=SYNTHETIC_UNIT&date=2026-01-02', { actor: outOfScopeManager })
assert.notEqual(outOfScopeDaily.response.status, 200)

const integrationRun = randomUUID()
const existingRecords = await call('/api/ponto/mirror?employeeId=synthetic-employee-001&unitId=SYNTHETIC_UNIT&limit=1', { actor: admin })
assert.equal(existingRecords.response.status, 200)
const latestEventTime = Date.parse(existingRecords.payload.data?.[0]?.at || '') || 0
const occurrenceBase = Math.max(Date.now(), latestEventTime) + 60_000
const punchBody = { employeeId: 'synthetic-employee-001', unitId: 'SYNTHETIC_UNIT', occurredAt: new Date(occurrenceBase).toISOString(), requestId: `integration-${integrationRun}`, eventType: 'WORK_START', reason: 'Marcação manual sintética de integração' }
const punch = await call('/api/ponto/punches', { method: 'POST', actor: admin, body: punchBody })
assert.equal(punch.response.status, 201); assert.equal(punch.payload.data.source, 'MANUAL')
const retry = await call('/api/ponto/punches', { method: 'POST', actor: admin, body: punchBody })
assert.equal(retry.response.status, 200); assert.equal(retry.payload.idempotent, true)

const concurrentBody = { ...punchBody, occurredAt: new Date(occurrenceBase + 60_000).toISOString(), requestId: `concurrent-${integrationRun}`, eventType: 'WORK_END' }
const concurrent = await Promise.all([
  call('/api/ponto/punches', { method: 'POST', actor: admin, body: concurrentBody }),
  call('/api/ponto/punches', { method: 'POST', actor: admin, body: concurrentBody }),
])
assert.deepEqual(concurrent.map((item) => item.response.status).sort(), [200, 201])
assert.equal(concurrent[0].payload.data.id, concurrent[1].payload.data.id)

const pinNonce = `pin-configure-${integrationRun}`
const pinConfiguration = await call('/api/ponto/pin/configure', { method: 'POST', actor: admin, nonce: pinNonce, body: { employeeId: 'synthetic-employee-001', pin: '1234' } })
assert.equal(pinConfiguration.response.status, 200)
const changedPathBody = JSON.stringify({ employeeId: 'synthetic-employee-001', pin: '1234' })
const changedPathNonce = `changed-path-${integrationRun}`
const changedPathHeaders = actorHeaders(admin, 'POST', '/api/ponto/pin/configure', changedPathNonce, changedPathBody)
const changedPathResponse = await fetch(`${baseUrl}/api/ponto/biometrics/revoke`, { method: 'POST', headers: { ...changedPathHeaders, 'content-type': 'application/json', 'x-request-nonce': changedPathNonce }, body: changedPathBody })
assert.equal(changedPathResponse.status, 401)
const replayedPinConfiguration = await call('/api/ponto/pin/configure', { method: 'POST', actor: admin, nonce: pinNonce, body: { employeeId: 'synthetic-employee-001', pin: '1234' } })
assert.equal(replayedPinConfiguration.response.status, 409)
assert.equal(replayedPinConfiguration.payload.code, 'REPLAY_DETECTED')
const pinFailures = []
for (let attempt = 0; attempt < 5; attempt += 1) {
  pinFailures.push(await call('/api/ponto/punches', { method: 'POST', actor: employee, body: { unitId: 'SYNTHETIC_UNIT', pin: '9999', occurredAt: new Date(occurrenceBase + (120 + attempt * 30) * 1000).toISOString(), requestId: `pin-failure-${integrationRun}-${attempt}` } }))
}
assert.equal(pinFailures[0].response.status, 401)
assert.equal(pinFailures.at(-1).response.status, 429)
assert.equal(pinFailures.at(-1).payload.code, 'PIN_LOCKED')

const descriptor = Array.from({ length: 64 }, (_, index) => index / 100)
const enrollment = await call('/api/ponto/biometrics/enroll', { method: 'POST', actor: admin, body: { employeeId: 'synthetic-employee-001', descriptor, consentConfirmed: true, consentVersion: 'synthetic-integration-v1', expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(), replace: true } })
assert.equal(enrollment.response.status, 201)
const faceFailure = await call('/api/ponto/punches', { method: 'POST', actor: employee, body: { unitId: 'SYNTHETIC_UNIT', descriptor: descriptor.map((value) => value + 1), occurredAt: new Date(occurrenceBase + 300_000).toISOString(), requestId: `face-failure-${integrationRun}` } })
assert.equal(faceFailure.response.status, 401)
assert.equal(faceFailure.payload.code, 'FACE_NOT_RECOGNIZED')
assert.equal(JSON.stringify(faceFailure.payload).includes('score'), false)

const createdDevice = await call('/api/ponto/devices', { method: 'POST', actor: admin, body: { unitId: 'SYNTHETIC_UNIT', label: `Terminal sintético ${integrationRun}` } })
assert.equal(createdDevice.response.status, 201)
const deviceEmployeeRead = await call('/api/ponto/employees/synthetic-employee-001', { headers: { authorization: `Device ${createdDevice.payload.data.token}` } })
assert.equal(deviceEmployeeRead.response.status, 403)
const secondDevice = await call('/api/ponto/devices', { method: 'POST', actor: admin, body: { unitId: 'SYNTHETIC_UNIT', label: `Terminal sintético secundário ${integrationRun}` } })
assert.equal(secondDevice.response.status, 201)
const globalPinLock = await call('/api/ponto/device/punches', { method: 'POST', headers: { authorization: `Device ${secondDevice.payload.data.token}` }, body: { employeeId: 'synthetic-employee-001', pin: '9999', occurredAt: new Date(occurrenceBase + 330_000).toISOString(), requestId: `global-pin-lock-${integrationRun}` } })
assert.equal(globalPinLock.response.status, 429)
assert.equal(globalPinLock.payload.code, 'PIN_LOCKED')
const devicePunch = await call('/api/ponto/device/punches', { method: 'POST', headers: { authorization: `Device ${createdDevice.payload.data.token}` }, body: { employeeId: 'synthetic-employee-001', descriptor, occurredAt: new Date(occurrenceBase + 360_000).toISOString(), requestId: `device-${integrationRun}`, eventType: 'WORK_START' } })
assert.equal(devicePunch.response.status, 201)
assert.equal(devicePunch.payload.data.source, 'FACE')
assert.equal(devicePunch.payload.data.deviceId, createdDevice.payload.data.id)

const correction = await call('/api/ponto/corrections', { method: 'POST', actor: { ...employee, id: 'correction-requester' }, body: { eventId: 'synthetic-punch-001', proposedAtUtc: '2026-01-02T12:05:00.000Z', reason: 'Ajuste sintético de integração' } })
assert.equal(correction.response.status, 201)
const approval = await call(`/api/ponto/corrections/${correction.payload.data.id}/approve`, { method: 'POST', actor: admin, body: { reason: 'Aprovação sintética de integração' } })
assert.equal(approval.response.status, 200); assert.equal(approval.payload.data.status, 'APPROVED')
const correctedDaily = await call('/api/ponto/daily?employeeId=synthetic-employee-001&unitId=SYNTHETIC_UNIT&date=2026-01-02', { actor: admin })
assert.equal(correctedDaily.response.status, 200); assert.equal(correctedDaily.payload.data.workedMinutes, 475)

const close = await call('/api/ponto/periods/close', { method: 'POST', actor: admin, body: { employeeId: 'synthetic-employee-001', unitId: 'SYNTHETIC_UNIT', from: '2026-01-01', to: '2026-01-31', reason: 'Fechamento sintético de integração' } })
assert.equal(close.response.status, 201); assert.equal(close.payload.data.status, 'CLOSED')
const blocked = await call('/api/ponto/punches', { method: 'POST', actor: admin, body: { ...punchBody, occurredAt: '2026-01-03T12:00:00.000Z', requestId: 'closed-period-punch' } })
assert.equal(blocked.response.status, 409); assert.equal(blocked.payload.code, 'PERIOD_CLOSED')
const reopen = await call('/api/ponto/periods/reopen', { method: 'POST', actor: { ...admin, id: 'synthetic-admin-reopener' }, body: { closureId: close.payload.data.id, reason: 'Reabertura sintética de integração' } })
assert.equal(reopen.response.status, 200); assert.equal(reopen.payload.data.status, 'REOPENED')

const missing = await call('/api/ponto/route-that-does-not-exist', { actor: admin })
assert.equal(missing.response.status, 404); assert.equal(missing.payload.code, 'NOT_FOUND')
const oversized = await call('/api/ponto/pin/configure', { method: 'POST', actor: admin, body: { padding: 'x'.repeat(1024 * 1024) } })
assert.equal(oversized.response.status, 413); assert.equal(oversized.payload.code, 'PAYLOAD_TOO_LARGE')
console.log(JSON.stringify({ ok: true, health: health.response.status, readiness: readiness.response.status, employeeCount: employees.payload.data.length, dailyWorkedMinutesAfterCorrection: correctedDaily.payload.data.workedMinutes, horizontalAuthorization: outOfScopeDaily.response.status, deviceEmployeeRead: deviceEmployeeRead.response.status, idempotency: retry.payload.idempotent, concurrencyStatuses: concurrent.map((item) => item.response.status).sort(), replayProtection: replayedPinConfiguration.payload.code, signatureBinding: changedPathResponse.status, pinLockout: pinFailures.at(-1).response.status, globalPinLock: globalPinLock.response.status, faceFailure: faceFailure.payload.code, devicePunch: devicePunch.payload.data.source, correction: approval.payload.data.status, closure: close.payload.data.status, reopen: reopen.payload.data.status, oversizedPayload: oversized.response.status, unknownRoute: missing.response.status }, null, 2))
