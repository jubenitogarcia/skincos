import test from 'node:test'
import assert from 'node:assert/strict'
import {
    buildClientIdentityPlan,
    formatCanonicalClientName,
    normalizeClientName,
    normalizedNameSimilarity,
} from '../clientIdentity.js'

test('normalizes accents, punctuation, whitespace and display casing', () => {
    assert.equal(normalizeClientName('  MARÍA  dA-Sílva '), 'maria da silva')
    assert.equal(formatCanonicalClientName('  MARÍA  dA-Sílva '), 'Maria da Silva')
})

test('unifies exact normalized attendance names while preserving aliases', () => {
    const plan = buildClientIdentityPlan({
        attendances: [
            { id: 'a1', clientName: 'MARIA DA SILVA', unitId: 'u1', procedureId: 'p1' },
            { id: 'a2', clientName: 'María da Silva', unitId: 'u1', procedureId: 'p2' },
        ],
    })
    assert.equal(plan.summary.canonicalAttendanceClients, 1)
    assert.equal(plan.summary.exactDuplicatesUnified, 1)
    assert.equal(plan.clients[0].canonicalName, 'Maria da Silva')
    assert.deepEqual(plan.clients[0].aliases.map((alias) => alias.rawName).sort(), ['MARIA DA SILVA', 'María da Silva'])
})

test('keeps possible spelling errors as review suggestions', () => {
    const plan = buildClientIdentityPlan({
        attendances: [
            { id: 'a1', clientName: 'Mariana Oliveira Souza', unitId: 'u1', procedureId: 'p1' },
            { id: 'a2', clientName: 'Mariana Oliveira Soza', unitId: 'u1', procedureId: 'p1' },
        ],
    })
    assert.equal(plan.summary.canonicalAttendanceClients, 2)
    assert.equal(plan.summary.spellingReviewSuggestions, 1)
    assert.ok(plan.mergeSuggestions[0].similarity > 0.9)
})

test('does not suggest similar names without shared unit and procedure evidence', () => {
    const plan = buildClientIdentityPlan({
        attendances: [
            { id: 'a1', clientName: 'Mariana Oliveira Souza', unitId: 'u1', procedureId: 'p1' },
            { id: 'a2', clientName: 'Mariana Oliveira Soza', unitId: 'u2', procedureId: 'p2' },
        ],
    })
    assert.equal(plan.summary.spellingReviewSuggestions, 0)
})

test('auto-confirms Caixa correlation only for a unique exact name with shared unit and procedure', () => {
    const plan = buildClientIdentityPlan({
        attendances: [{ id: 'a1', clientName: 'Maria da Silva', unitId: 'u1', procedureId: 'p1' }],
        caixaCustomers: [{ id: 'c1', name: 'MARÍA DA SILVA' }],
        caixaSales: [{ customerId: 'c1', unitId: 'u1', procedureIds: ['p1'] }],
    })
    assert.deepEqual(plan.caixaLinks.map((link) => ({ method: link.method, status: link.status })), [
        { method: 'exact_name_unit_procedure', status: 'auto_confirmed' },
    ])
    assert.equal(plan.summary.linkedAttendanceClients, 1)
    assert.equal(plan.summary.caixaExactNameLinks, 1)
    assert.equal(plan.summary.caixaFuzzyNameLinks, 0)
})

test('does not use sale dates when correlating Atendimento and Caixa', () => {
    const plan = buildClientIdentityPlan({
        attendances: [{ id: 'a1', clientName: 'Maria da Silva', unitId: 'u1', procedureId: 'p1', serviceDate: '2026-12-20' }],
        caixaCustomers: [{ id: 'c1', name: 'Maria da Silva' }],
        caixaSales: [{ customerId: 'c1', unitId: 'u1', procedureIds: ['p1'], occurredOn: '2025-01-01' }],
    })
    assert.equal(plan.caixaLinks[0].status, 'auto_confirmed')
})

test('marks exact-name Caixa collisions as ambiguous', () => {
    const plan = buildClientIdentityPlan({
        attendances: [{ id: 'a1', clientName: 'Maria da Silva', unitId: 'u1', procedureId: 'p1' }],
        caixaCustomers: [{ id: 'c1', name: 'Maria da Silva' }, { id: 'c2', name: 'Maria da Silva' }],
        caixaSales: [
            { customerId: 'c1', unitId: 'u1', procedureIds: ['p1'] },
            { customerId: 'c2', unitId: 'u1', procedureIds: ['p1'] },
        ],
    })
    assert.equal(plan.caixaLinks.filter((link) => link.status === 'ambiguous').length, 2)
    assert.equal(plan.caixaLinks.filter((link) => link.status === 'auto_confirmed').length, 0)
})

test('calculates normalized edit similarity', () => {
    assert.equal(normalizedNameSimilarity('Maria', 'Maria'), 1)
    assert.ok(normalizedNameSimilarity('Mariana Oliveira Souza', 'Mariana Oliveira Soza') > 0.9)
})
