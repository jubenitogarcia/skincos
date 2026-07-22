import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAppRegistrationCustomers, buildClientRegistrationIdentityPlan, buildConfirmedGlobalIdentityComponents, normalizeClientCpf, normalizeClientPhone } from '../clientRegistrationIdentity.js'

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

test('confirms an exact app, sales and attendance name when the unit also agrees', () => {
    const plan = buildClientRegistrationIdentityPlan({
        registrationRows: [{ 'Cliente ID': 'app-1', Cliente: 'Maria da Silva', Unidade: 'BarraShoppingSul', Telefone: '51999991111' }],
        caixaCustomers: [{ id: 'cash-1', name: 'Maria da Silva', phoneKey: '5551999991111' }],
        caixaSales: [{ customerId: 'cash-1', unitId: 'u1', unitSlug: 'barra-shopping-sul' }],
        attendances: [{ id: 'attendance-1', clientName: 'Maria da Silva', unitId: 'u1', unitSlug: 'barra-shopping-sul', procedureId: 'p1' }],
    })
    assert.deepEqual(plan.registrationAttendanceLinks.map((link) => ({ method: link.method, status: link.status })), [{ method: 'exact_name_phone_sales_unit', status: 'auto_confirmed' }])
})

test('builds one global identity only from confirmed cross-source links', () => {
    const components = buildConfirmedGlobalIdentityComponents({
        registrations: [{ id: 'app-1', name: 'Maria da Silva' }],
        canonicalClients: [{ id: 'attendance-1', name: 'Maria da Silva' }],
        caixaCustomers: [{ id: 'cash-1', name: 'Maria da Silva' }],
        registrationCaixaLinks: [{ registrationId: 'app-1', caixaCustomerId: 'cash-1', status: 'auto_confirmed' }],
        registrationAttendanceLinks: [{ registrationId: 'app-1', attendanceClientId: 'attendance-1', status: 'auto_confirmed' }],
        attendanceCaixaLinks: [{ attendanceClientId: 'attendance-1', caixaCustomerId: 'cash-1', status: 'suggested' }],
    })
    assert.deepEqual(components, [{
        componentKey: 'app_registration:app-1|attendance_client:attendance-1|caixa_customer:cash-1',
        preferredName: 'Maria da Silva',
        members: [
            { sourceType: 'app_registration', sourceId: 'app-1', name: 'Maria da Silva' },
            { sourceType: 'attendance_client', sourceId: 'attendance-1', name: 'Maria da Silva' },
            { sourceType: 'caixa_customer', sourceId: 'cash-1', name: 'Maria da Silva' },
        ],
        sourceTypes: ['app_registration', 'attendance_client', 'caixa_customer'],
    }])
})
