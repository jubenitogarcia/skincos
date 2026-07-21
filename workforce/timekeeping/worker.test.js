import assert from 'node:assert/strict'
import test from 'node:test'
import worker, { __testables } from './worker.js'

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

test('manager and supervisor scopes are horizontal while admin remains organization-wide', () => {
  assert.equal(__testables.requireUnit({ role: 'MANAGER', allowedUnits: ['UNIT_A'] }, 'UNIT_A'), true)
  assert.equal(__testables.requireUnit({ role: 'MANAGER', allowedUnits: ['UNIT_A'] }, 'UNIT_B'), false)
  assert.equal(__testables.requireUnit({ role: 'SUPERVISOR', allowedUnits: ['UNIT_A'] }, 'UNIT_A'), true)
  assert.equal(__testables.requireUnit({ role: 'SUPERVISOR', allowedUnits: ['UNIT_A'] }, 'UNIT_B'), false)
  assert.equal(__testables.requireUnit({ role: 'ADMIN', allowedUnits: [] }, 'UNIT_B'), true)
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
