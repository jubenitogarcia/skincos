import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAppRegistrationCustomers, buildClientRegistrationIdentityPlan, normalizeClientCpf, normalizeClientPhone } from '../clientRegistrationIdentity.js'

test('consolidates the same app registration across units and normalizes contacts', () => {
    const customers = buildAppRegistrationCustomers([
        { 'Cliente ID': 'app-1', Cliente: 'Maria da Silva', Unidade: 'BarraShoppingSul', Telefone: '(51) 99999-1111', Email: 'MARIA@EXAMPLE.COM', CPF: '123.456.789-01' },
        { 'Cliente ID': 'app-1', Cliente: 'MARÍA DA SILVA', Unidade: 'Novo Hamburgo', Telefones: '+55 51 99999-1111' },
    ])
    assert.equal(customers.length, 1)
    assert.deepEqual(customers[0].units, ['barra-shopping-sul', 'novo-hamburgo'])
    assert.deepEqual(customers[0].phones, ['5551999991111'])
    assert.equal(customers[0].emails[0], 'maria@example.com')
    assert.equal(normalizeClientCpf('123.456.789-01'), '12345678901')
    assert.equal(normalizeClientPhone('51999991111'), '5551999991111')
})

test('auto-confirms Caixa only with matching normalized name and phone', () => {
    const plan = buildClientRegistrationIdentityPlan({
        registrationRows: [{ 'Cliente ID': 'app-1', Cliente: 'Maria da Silva', Unidade: 'BarraShoppingSul', Telefone: '51999991111' }],
        caixaCustomers: [{ id: 'cash-1', name: 'MARÍA DA SILVA', phoneKey: '5551999991111' }],
        caixaSales: [{ customerId: 'cash-1', unitId: 'barra-shopping-sul' }],
    })
    assert.deepEqual(plan.registrationCaixaLinks.map((link) => ({ method: link.method, status: link.status })), [{ method: 'exact_name_phone', status: 'auto_confirmed' }])
})

test('keeps shared phone with different names out of automatic unification', () => {
    const plan = buildClientRegistrationIdentityPlan({
        registrationRows: [{ 'Cliente ID': 'app-1', Cliente: 'Maria da Silva', Unidade: 'BarraShoppingSul', Telefone: '51999991111' }],
        caixaCustomers: [{ id: 'cash-1', name: 'Joana da Silva', phoneKey: '5551999991111' }],
        caixaSales: [{ customerId: 'cash-1', unitId: 'barra-shopping-sul' }],
    })
    assert.equal(plan.registrationCaixaLinks[0].status, 'suggested')
    assert.notEqual(plan.registrationCaixaLinks[0].status, 'auto_confirmed')
})

test('uses a unique phone-to-sales-to-attendance anchor without using dates', () => {
    const plan = buildClientRegistrationIdentityPlan({
        registrationRows: [{ 'Cliente ID': 'app-1', Cliente: 'Maria da Silva', Unidade: 'BarraShoppingSul', Telefone: '51999991111' }],
        caixaCustomers: [{ id: 'cash-1', name: 'Maria da Silva', phoneKey: '5551999991111' }],
        caixaSales: [{ customerId: 'cash-1', unitId: 'u1', procedureIds: ['p1'], occurredOn: '2025-01-01' }],
        attendances: [{ id: 'attendance-1', clientName: 'Maria da Silva', unitId: 'u1', procedureId: 'p1', serviceDate: '2026-12-01' }],
    })
    assert.deepEqual(plan.registrationAttendanceLinks.map((link) => ({ method: link.method, status: link.status })), [{ method: 'phone_sales_attendance_anchor', status: 'auto_confirmed' }])
    assert.equal(plan.summary.policy.dateDistanceUsed, false)
})
