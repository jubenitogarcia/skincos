import assert from 'node:assert/strict'
import test from 'node:test'
import { SCHEDULE_PUBLIC_READ_KNOWN_IDENTITIES } from './public-read-professional-identities.js'
import { SCHEDULE_PUBLIC_READ_DATA_LIMITS, normalizeSchedulePublicReadUnit, isSchedulePublicReadDate, createSchedulePublicReadCatalogue, validateSchedulePublicReadDto, assertSchedulePublicReadResponseBudget } from './public-read-projection.js'

const sourceId = '11111111-1111-4111-8111-111111111111'
const otherId = '22222222-2222-4222-8222-222222222222'
const unit = 'novo-hamburgo'
const profile = (overrides = {}) => ({ id: sourceId, name: 'Dra. Ana Sintética', status: 'Ativo', role: 'Injetor', units_json: '["Novo Hamburgo"]', ...overrides })
const reference = (overrides = {}) => ({ professional_id: sourceId, professional_name: 'Dra. Ana Sintética', ...overrides })
const roster = (professionals = [{ id: sourceId, name: 'Dra. Ana Sintética' }], overrides = {}) => ({ ok: true, contract: 'schedule-public-read/v1', data: { unit, professionals, ...overrides } })

test('public eligibility is explicit Ativo and exact comma-separated Injetor role with unit membership', () => {
  const excluded = ['Consultor', 'Diretor', 'Gerente', 'Injetora', 'injetor', '', 'Coordenador/Consultor']
  for (const role of excluded) assert.deepEqual(createSchedulePublicReadCatalogue([profile({ role })]).roster(unit), [])
  for (const status of ['Inativo', '', null]) assert.deepEqual(createSchedulePublicReadCatalogue([profile({ status })]).roster(unit), [])
  assert.deepEqual(createSchedulePublicReadCatalogue([profile({ role: 'Injetor, Responsável Técnico' })]).roster(unit), [{ id: sourceId, name: 'Dra. Ana Sintética' }])
  assert.deepEqual(createSchedulePublicReadCatalogue([profile({ units_json: '["BarraShoppingSul"]' })]).roster(unit), [])
})
test('the four exact known identities are unit-bound aliases and cannot reactivate inactive profiles', () => {
  assert.equal(SCHEDULE_PUBLIC_READ_KNOWN_IDENTITIES.length, 4)
  for (const known of SCHEDULE_PUBLIC_READ_KNOWN_IDENTITIES) {
    const catalogue = createSchedulePublicReadCatalogue([profile({ id: known.sourceId, units_json: JSON.stringify(known.units) })])
    for (const member of known.units) {
      assert.deepEqual(catalogue.roster(member), [{ id: known.publicId, name: 'Dra. Ana Sintética' }])
      assert.deepEqual(catalogue.availability([reference({ professional_id: known.sourceId })], member), catalogue.roster(member))
    }
    assert.deepEqual(createSchedulePublicReadCatalogue([profile({ id: known.sourceId, status: 'Inativo' })]).roster(unit), [])
    for (const member of ['novo-hamburgo', 'barra-shopping-sul'].filter((value) => !known.units.includes(value))) {
      assert.throws(() => createSchedulePublicReadCatalogue([profile({ id: known.sourceId, units_json: JSON.stringify([member]) })]).roster(member))
    }
  }
  const unknownHandle = createSchedulePublicReadCatalogue([profile({ instagram: 'dravivianemondin' })])
  assert.equal(unknownHandle.roster(unit)[0].id, sourceId)
})
test('nullable historical references use exact unique source identity and never fuzzy name matching', () => {
  const catalogue = createSchedulePublicReadCatalogue([profile()])
  assert.deepEqual(catalogue.availability([reference({ professional_id: null }), reference()], unit), catalogue.roster(unit))
  for (const changed of [reference({ professional_id: '' }), reference({ professional_id: otherId }), reference({ professional_name: 'Dra Ana Sintética' }), reference({ professional_id: null, professional_name: 'DRA. ANA SINTÉTICA' })]) {
    assert.throws(() => catalogue.availability([changed], unit))
  }
  assert.throws(() => catalogue.availability([reference()], 'barra-shopping-sul'))
  assert.throws(() => createSchedulePublicReadCatalogue([profile(), profile({ id: otherId })]))
})
test('projection validates fields and rejects invalid UUIDs, controls, duplicate identities and input caps', () => {
  for (const row of [profile({ id: 'name-generated-id' }), profile({ name: 'Ana\nSintética' }), profile({ units_json: 'invalid' })]) {
    assert.throws(() => createSchedulePublicReadCatalogue([row]).roster(unit))
  }
  assert.throws(() => createSchedulePublicReadCatalogue(Array.from({ length: SCHEDULE_PUBLIC_READ_DATA_LIMITS.maxProfiles + 1 }, (_, index) => profile({ id: String(index), name: String(index) }))))
  assert.throws(() => createSchedulePublicReadCatalogue([profile()]).availability(Array(SCHEDULE_PUBLIC_READ_DATA_LIMITS.maxReferences + 1).fill(reference()), unit))
  assert.throws(() => validateSchedulePublicReadDto(roster([{ id: 'unproved-handle', name: 'Ana' }]), { suffix: '/professionals', unit }))
  assert.throws(() => validateSchedulePublicReadDto(roster([{ id: sourceId, name: 'Ana' }, { id: sourceId, name: 'Outra' }]), { suffix: '/professionals', unit }))
  assert.throws(() => validateSchedulePublicReadDto(roster([{ id: 'drasamarassilva', name: 'Ana' }]), { suffix: '/professionals', unit }))
})
test('public DTO whitelists identity and public name, preserves compatibility names and verifies requested unit/date', () => {
  const input = roster([{ id: sourceId, name: 'Dra. Ana Sintética', email: 'private-synthetic@example.invalid', phone: 'synthetic-private' }], { confidential: 'omit' })
  input.secret = 'synthetic-omit'
  assert.deepEqual(validateSchedulePublicReadDto(input, { suffix: '/professionals', unit }), roster())
  const date = '2026-10-14'
  const available = { ...input, data: { ...input.data, date, closed: false, professionalNames: ['Dra. Ana Sintética'] } }
  const expected = { ok: true, contract: 'schedule-public-read/v1', data: { unit, date, closed: false, professionals: roster().data.professionals, professionalNames: ['Dra. Ana Sintética'] } }
  assert.deepEqual(validateSchedulePublicReadDto(available, { suffix: '/availability', unit, date }), expected)
  assert.throws(() => validateSchedulePublicReadDto(available, { suffix: '/availability', unit, date: '2026-10-15' }))
  assert.throws(() => validateSchedulePublicReadDto({ ...available, data: { ...available.data, professionalNames: ['Different'] } }, { suffix: '/availability', unit, date }))
  assert.throws(() => validateSchedulePublicReadDto(input, { suffix: '/professionals', unit: 'barra-shopping-sul' }))
  assert.throws(() => assertSchedulePublicReadResponseBudget({ extra: 'x'.repeat(64 * 1024) }))
})
test('public unit and real calendar validation is strict and supports the two explicit legacy unit labels', () => {
  assert.equal(normalizeSchedulePublicReadUnit('Novo Hamburgo'), 'novo-hamburgo')
  assert.equal(normalizeSchedulePublicReadUnit('BarraShoppingSul'), 'barra-shopping-sul')
  assert.equal(normalizeSchedulePublicReadUnit('other'), null)
  for (const date of ['2026-02-29', '2026-13-01', '2026-1-01', 'not-a-date']) assert.equal(isSchedulePublicReadDate(date), false)
  assert.equal(isSchedulePublicReadDate('2028-02-29'), true)
})
