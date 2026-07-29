import assert from 'node:assert/strict'
import test from 'node:test'
import worker, { __testables } from './worker.js'
import { signHmac } from './security.js'

test('health is public and does not disclose secrets', async () => {
  const response = await worker.fetch(new Request('https://timekeeping.local/api/ponto/health'), { APP_VERSION: 'test', DB: {} })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.service, 'workforce-timekeeping')
  assert.equal(JSON.stringify(body).includes('PONTO_'), false)
})

test('readiness fails closed when D1 is unavailable', async () => {
  const response = await worker.fetch(new Request('https://timekeeping.local/api/ponto/readiness'), {})
  assert.equal(response.status, 503)
  assert.equal((await response.json()).code, 'DATABASE_UNAVAILABLE')
})

test('role matrix keeps consultor self-service and gives supervisor the former RH/auditor duties', () => {
  assert.equal(__testables.roleAllows('CONSULTOR', 'self.punch'), true)
  assert.equal(__testables.roleAllows('CONSULTOR', 'self.profile.read'), true)
  assert.equal(__testables.roleAllows('CONSULTOR', 'profile.manage'), false)
  assert.equal(__testables.roleAllows('CONSULTOR', 'unit.read'), false)
  assert.equal(__testables.roleAllows('MANAGER', 'correction.request'), true)
  assert.equal(__testables.roleAllows('MANAGER', 'correction.approve'), false)
  assert.equal(__testables.roleAllows('SUPERVISOR', 'period.close'), true)
  assert.equal(__testables.roleAllows('SUPERVISOR', 'audit.read'), true)
  assert.equal(__testables.roleAllows('ADMIN', 'device.manage'), true)
  assert.equal(__testables.normalizeWorkforceRole('RH'), 'SUPERVISOR')
  assert.equal(__testables.normalizeWorkforceRole('AUDITOR'), 'SUPERVISOR')
  assert.equal(__testables.normalizeWorkforceRole('EMPLOYEE'), 'CONSULTOR')
})

test('profile payload accepts only known fields and keeps document values out of summaries', () => {
  const patch = __testables.profileInput({ profile: { socialName: 'Pessoa Teste', cpf: '123.456.789-00', mobilePhone: '(11) 99999-0000', ignored: 'do-not-store' } })
  assert.deepEqual(patch.publicPatch, { socialName: 'Pessoa Teste' })
  assert.deepEqual(patch.privatePatch, { cpf: '12345678900', mobilePhone: '(11) 99999-0000' })
  assert.deepEqual(patch.provided, ['socialName', 'cpf', 'mobilePhone'])
  assert.deepEqual(__testables.profileDocumentStatus({ cpf: '12345678900', pis: '', rgNumber: '42', motherName: '' }), { cpf: 'CADASTRADO', pis: 'PENDENTE', rg: 'CADASTRADO', family: 'PENDENTE' })
})

test('face punches stay disabled unless the operational flag explicitly enables them', async () => {
  assert.equal(__testables.isFacePunchEnabled({}), false)
  assert.equal(__testables.isFacePunchEnabled({ PONTO_FACE_PUNCH_ENABLED: 'true' }), true)
  const result = await __testables.verifyPunchCredential({}, {}, {}, { id: 'employee-1' }, { descriptor: [0.1, 0.2] })
  assert.deepEqual(result, { error: 'FACE_DISABLED' })
})

test('terminal network parsing only accepts valid IPv4 CIDRs and matches without trusting a browser header', () => {
  assert.deepEqual(__testables.normalizeNetworks(['203.0.113.10/32', 'bad', '198.51.100.0/24', '203.0.113.10/32']), ['203.0.113.10/32', '198.51.100.0/24'])
  assert.equal(__testables.ipInNetwork('203.0.113.10', '203.0.113.10/32'), true)
  assert.equal(__testables.ipInNetwork('203.0.113.11', '203.0.113.10/32'), false)
  assert.equal(__testables.ipInNetwork('198.51.100.42', '198.51.100.0/24'), true)
})

test('external location stores a derived result rather than coordinates and rejects stale or malformed evidence', () => {
  const policy = { geofence_latitude: -23.5505, geofence_longitude: -46.6333, geofence_radius_meters: 150 }
  const result = __testables.locationEvidence({ latitude: -23.5505, longitude: -46.6333, accuracyMeters: 12, capturedAt: new Date().toISOString() }, policy)
  assert.equal(result.status, 'WITHIN_GEOFENCE')
  assert.equal(Object.hasOwn(result.payload, 'latitude'), false)
  assert.equal(__testables.locationEvidence({ latitude: 0, longitude: 0, accuracyMeters: 5, capturedAt: '2000-01-01T00:00:00.000Z' }, policy).error, 'LOCATION_INVALID')
})

test('manager and supervisor scopes are horizontal while admin remains organization-wide', () => {
  assert.equal(__testables.requireUnit({ role: 'MANAGER', allowedUnits: ['UNIT_A'] }, 'UNIT_A'), true)
  assert.equal(__testables.requireUnit({ role: 'MANAGER', allowedUnits: ['UNIT_A'] }, 'UNIT_B'), false)
  assert.equal(__testables.requireUnit({ role: 'SUPERVISOR', allowedUnits: ['UNIT_A'] }, 'UNIT_A'), true)
  assert.equal(__testables.requireUnit({ role: 'SUPERVISOR', allowedUnits: ['UNIT_A'] }, 'UNIT_B'), false)
  assert.equal(__testables.requireUnit({ role: 'ADMIN', allowedUnits: [] }, 'UNIT_B'), true)
})

test('Identity onboarding service binding requires a fresh HMAC and cannot be forged by a browser', async () => {
  const secret = 'identity-workforce-test-secret'
  const timestamp = String(Date.now())
  const bodyHash = 'body-hash'
  const signature = await signHmac(secret, `${timestamp}.${bodyHash}`)
  const seen = new Set()
  const db = { prepare(sql) { return { bind(...values) { this.values = values; return this }, async run() { if (sql.includes('INSERT INTO')) { if (seen.has(this.values[0])) throw new Error('UNIQUE') ; seen.add(this.values[0]) } return { meta: { changes: 1 } } } } } }
  const headers = { 'x-skincos-service': 'identity', 'x-skincos-workforce-ts': timestamp, 'x-skincos-workforce-sig': signature, 'x-skincos-workforce-nonce': 'nonce-1', 'x-request-id': 'req-1' }
  const signed = new Request('https://timekeeping.local/api/ponto/internal/onboarding', { headers })
  assert.deepEqual(await __testables.identityServiceAuthorized(signed, { IDENTITY_WORKFORCE_HMAC_KEY: secret }, bodyHash, db), { ok: true })
  const replay = new Request('https://timekeeping.local/api/ponto/internal/onboarding', { headers })
  assert.deepEqual(await __testables.identityServiceAuthorized(replay, { IDENTITY_WORKFORCE_HMAC_KEY: secret }, bodyHash, db), { ok: false, error: 'SERVICE_REPLAY' })
  const unsigned = new Request('https://timekeeping.local/api/ponto/internal/onboarding', { headers: { ...headers, 'x-skincos-workforce-sig': 'forged', 'x-skincos-workforce-nonce': 'nonce-2' } })
  assert.deepEqual(await __testables.identityServiceAuthorized(unsigned, { IDENTITY_WORKFORCE_HMAC_KEY: secret }, bodyHash, db), { ok: false, error: 'SERVICE_UNAUTHORIZED' })
  const missingNonce = new Request('https://timekeeping.local/api/ponto/internal/onboarding', { headers: { ...headers, 'x-skincos-workforce-nonce': '' } })
  assert.deepEqual(await __testables.identityServiceAuthorized(missingNonce, { IDENTITY_WORKFORCE_HMAC_KEY: secret }, bodyHash, db), { ok: false, error: 'SERVICE_UNAUTHORIZED' })
  const altered = new Request('https://timekeeping.local/api/ponto/internal/onboarding', { headers: { ...headers, 'x-skincos-workforce-nonce': 'nonce-3' } })
  assert.deepEqual(await __testables.identityServiceAuthorized(altered, { IDENTITY_WORKFORCE_HMAC_KEY: secret }, 'altered-body', db), { ok: false, error: 'SERVICE_UNAUTHORIZED' })
  const expiredTimestamp = String(Date.now() - 301000)
  const expiredSig = await signHmac(secret, `${expiredTimestamp}.${bodyHash}`)
  const expired = new Request('https://timekeeping.local/api/ponto/internal/onboarding', { headers: { ...headers, 'x-skincos-workforce-ts': expiredTimestamp, 'x-skincos-workforce-sig': expiredSig, 'x-skincos-workforce-nonce': 'nonce-4' } })
  assert.deepEqual(await __testables.identityServiceAuthorized(expired, { IDENTITY_WORKFORCE_HMAC_KEY: secret }, bodyHash, db), { ok: false, error: 'SERVICE_UNAUTHORIZED' })
  assert.equal(__testables.normalizedDepartmentKey('  Atendimento Técnico  '), 'atendimento tecnico')
})

test('Workforce never presents pending or invited onboarding as operational', () => {
  const pending = __testables.publicEmployee({ id: 'e1', canonical_employee_id: 'identity:o1', display_name: 'Synthetic', login_email: 'synthetic@example.invalid', status: 'LEAVE', access_state: 'PENDING_ACCESS' })
  const invited = __testables.publicEmployee({ id: 'e2', canonical_employee_id: 'identity:o2', display_name: 'Synthetic', login_email: 'synthetic2@example.invalid', status: 'LEAVE', access_state: 'INVITED' })
  assert.equal(pending.accessState, 'PENDING_ACCESS')
  assert.equal(invited.accessState, 'INVITED')
  assert.equal(pending.status, 'LEAVE')
  assert.equal(invited.status, 'LEAVE')
})

test('onboarding access state remains authoritative for operational timekeeping', () => {
  assert.equal(__testables.isOperationalEmployee({ status: 'ACTIVE', access_state: 'PENDING_ACCESS' }), false)
  assert.equal(__testables.isOperationalEmployee({ status: 'ACTIVE', access_state: 'INVITED' }), false)
  assert.equal(__testables.isOperationalEmployee({ status: 'ACTIVE', access_state: 'SUSPENDED' }), false)
  assert.equal(__testables.isOperationalEmployee({ status: 'ACTIVE', access_state: 'ACTIVE' }), true)
  assert.equal(__testables.isOperationalEmployee({ status: 'ACTIVE' }), true)
  assert.equal(__testables.identityOnboardingId({ metadata_json: JSON.stringify({ identityOnboardingId: 'onb-1' }) }), 'onb-1')
  assert.equal(__testables.identityOnboardingId({ metadata_json: '{invalid' }), '')
})

test('CSV cells neutralize formulas and follow CSV quote escaping', () => {
  assert.equal(__testables.csvCell('=HYPERLINK("https://invalid.example")'), '"\'=HYPERLINK(""https://invalid.example"")"')
  assert.equal(__testables.csvCell('Pessoa "Teste"'), '"Pessoa ""Teste"""')
})

test('daily event partition keeps consecutive shifts separate and overnight completion together', () => {
  const events = [
    { id: 'a', eventType: 'WORK_START', occurredAt: '2026-07-18T11:00:00.000Z' },
    { id: 'b', eventType: 'WORK_END', occurredAt: '2026-07-18T20:00:00.000Z' },
    { id: 'c', eventType: 'WORK_START', occurredAt: '2026-07-19T11:00:00.000Z' },
    { id: 'd', eventType: 'WORK_END', occurredAt: '2026-07-19T20:00:00.000Z' },
  ]
  assert.deepEqual(__testables.eventsForWorkDate(events, '2026-07-18', 'America/Sao_Paulo').map((event) => event.id), ['a', 'b'])
  const overnight = [
    { id: 'n1', eventType: 'WORK_START', occurredAt: '2026-07-19T01:00:00.000Z' },
    { id: 'n2', eventType: 'WORK_END', occurredAt: '2026-07-19T09:00:00.000Z' },
    { id: 'next', eventType: 'WORK_START', occurredAt: '2026-07-19T12:00:00.000Z' },
  ]
  assert.deepEqual(__testables.eventsForWorkDate(overnight, '2026-07-18', 'America/Sao_Paulo').map((event) => event.id), ['n1', 'n2'])
})
