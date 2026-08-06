import assert from 'node:assert/strict'
import test from 'node:test'
import { __testables } from '../commercialAnalyticsStore.js'

const identity = '11111111-1111-4111-8111-111111111111'

test('analytics scope fails closed for declared managers and permits only their unit', () => {
    const actor = { role: 'GESTOR', allowedUnits: ['Novo Hamburgo'] }
    assert.deepEqual(__testables.scopeForActor(actor), ['novo-hamburgo'])
    assert.deepEqual(__testables.scopeForActor(actor, 'novo-hamburgo'), ['novo-hamburgo'])
    assert.throws(() => __testables.scopeForActor(actor, 'sao-leopoldo'), /COMMERCIAL_UNIT_FORBIDDEN/)
    assert.throws(() => __testables.scopeForActor({ role: 'GESTOR', allowedUnits: [] }), /COMMERCIAL_UNIT_FORBIDDEN/)
})

test('analytics scope keeps global aggregate access exclusive to global admins', () => {
    assert.equal(__testables.scopeForActor({ role: 'ADMIN' }), null)
    assert.equal(__testables.scopeForActor({ role: 'GESTOR', isGlobalAdmin: true }), null)
    assert.equal(__testables.scopeLabel(['novo-hamburgo']).kind, 'unit')
})

test('explainable segment criteria reject opaque scoring and evaluate deterministic facts', () => {
    assert.throws(() => __testables.normalizeCriteria({ propensityScore: 0.8 }), /OPAQUE_SEGMENT_CRITERIA_FORBIDDEN/)
    assert.deepEqual(__testables.evaluateCriteria({ source_count: 2, has_attendance: true, has_sale_source: false }, { minSources: 2, requireAttendance: true }), { included: true, reason: 'criteria_match' })
    assert.deepEqual(__testables.evaluateCriteria({ source_count: 1, has_attendance: true }, { minSources: 2 }), { included: false, reason: 'min_sources' })
    assert.match(identity, /^[0-9a-f-]{36}$/)
})
