import test from 'node:test'
import assert from 'node:assert/strict'

import {
    actorConsultantReferenceByUnit,
    consultantPatchMatchesAttendance,
    hasConsultantPatch,
    resolveActorConsultant,
} from '../consultantAssignment.js'

const unit = { slug: 'novo-hamburgo', name: 'Novo Hamburgo' }

const rows = [
    {
        id: 'consultant-a', canonical_id: 'consultant-a', name: 'Vitória Silva', status: 'Ativo',
        units: ['Novo Hamburgo'], roles: ['Consultor'], email: 'vitoria@skincos.test', aliases: ['Vitória'],
    },
    {
        id: 'consultant-b', canonical_id: 'consultant-b', name: 'Consultora Inativa', status: 'Inativo',
        units: ['Novo Hamburgo'], roles: ['Consultor'], email: 'inativa@skincos.test', aliases: [],
    },
    {
        id: 'consultant-c', canonical_id: 'consultant-c', name: 'Consultora Barra', status: 'Ativo',
        units: ['BarraShoppingSul'], roles: ['Consultor'], email: 'barra@skincos.test', aliases: [],
    },
]

test('resolves the authenticated consultant by exact professional email', () => {
    const result = resolveActorConsultant({ role: 'CONSULTOR', email: 'VITORIA@SKINCOS.TEST' }, unit, rows)
    assert.equal(result.origin, 'actor')
    assert.equal(result.match, 'email')
    assert.equal(result.professional?.canonicalId, 'consultant-a')
})

test('falls back to a confirmed display-name alias and then username', () => {
    const alias = resolveActorConsultant({ role: 'CONSULTOR', displayName: 'Vitória' }, unit, rows)
    assert.equal(alias.professional?.canonicalId, 'consultant-a')
    assert.equal(alias.match, 'name')

    const username = resolveActorConsultant({ role: 'CONSULTOR', username: 'Vitória' }, unit, rows)
    assert.equal(username.professional?.canonicalId, 'consultant-a')
    assert.equal(username.match, 'username')
})

test('does not resolve inactive, wrong-unit or ambiguous consultant identities', () => {
    assert.equal(resolveActorConsultant({ role: 'CONSULTOR', email: 'inativa@skincos.test' }, unit, rows).professional, null)
    assert.equal(resolveActorConsultant({ role: 'CONSULTOR', email: 'barra@skincos.test' }, unit, rows).professional, null)

    const collision = resolveActorConsultant({ role: 'CONSULTOR', email: 'collision@skincos.test' }, unit, [
        ...rows,
        { ...rows[0], id: 'collision-a', canonical_id: 'collision-a', email: 'collision@skincos.test' },
        { ...rows[0], id: 'collision-b', canonical_id: 'collision-b', email: 'collision@skincos.test' },
    ])
    assert.equal(collision.professional, null)
    assert.equal(collision.reason, 'AMBIGUOUS_PROFESSIONAL')
})

test('exposes only the current consultant binding per permitted unit', () => {
    assert.deepEqual(actorConsultantReferenceByUnit(
        { role: 'CONSULTOR', email: 'vitoria@skincos.test' },
        [unit, { slug: 'barra-shopping-sul', name: 'BarraShoppingSul' }],
        rows,
    ), {
        'novo-hamburgo': { canonicalId: 'consultant-a', name: 'Vitória Silva', origin: 'actor' },
        'barra-shopping-sul': { canonicalId: null, name: null, origin: 'unresolved', reason: 'PROFESSIONAL_NOT_AVAILABLE_FOR_UNIT' },
    })
})

test('detects a direct attempt to replace a persisted consultant', () => {
    const attendance = { consultantId: 'consultant-a', consultantName: 'Vitória Silva' }
    assert.equal(hasConsultantPatch({ consultantName: 'Outra consultora' }), true)
    assert.equal(consultantPatchMatchesAttendance({ consultantId: 'consultant-a' }, attendance), true)
    assert.equal(consultantPatchMatchesAttendance({ consultantName: 'Outra consultora' }, attendance), false)
})
