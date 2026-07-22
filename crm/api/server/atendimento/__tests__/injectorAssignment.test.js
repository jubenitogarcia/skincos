import test from 'node:test'
import assert from 'node:assert/strict'

import {
    hasInjectorPatch,
    injectorPatchMatchesAttendance,
    resolveScheduledInjector,
} from '../injectorAssignment.js'

const unit = { slug: 'novo-hamburgo', name: 'Novo Hamburgo' }
const rows = [
    {
        id: 'injector-a', canonical_id: 'injector-a', name: 'Raul Rosário Júnior', status: 'Ativo',
        units: ['Novo Hamburgo'], roles: ['Injetor'], aliases: ['Raul Júnior'],
    },
    {
        id: 'injector-inactive', canonical_id: 'injector-inactive', name: 'Injetor Inativo', status: 'Inativo',
        units: ['Novo Hamburgo'], roles: ['Injetor'], aliases: [],
    },
    {
        id: 'injector-barra', canonical_id: 'injector-barra', name: 'Injetor Barra', status: 'Ativo',
        units: ['BarraShoppingSul'], roles: ['Injetor'], aliases: [],
    },
]

test('resolves the canonical active injector stored by Escala', () => {
    const byId = resolveScheduledInjector({ professionalId: 'injector-a', doctorName: 'Raul Júnior' }, unit, rows, 'Sem Atendimento')
    assert.equal(byId.origin, 'schedule')
    assert.equal(byId.professional?.canonicalId, 'injector-a')

    const importedAlias = resolveScheduledInjector({ doctorName: 'Raul Júnior' }, unit, rows, 'Sem Atendimento')
    assert.equal(importedAlias.origin, 'schedule')
    assert.equal(importedAlias.professional?.canonicalName, 'Raul Rosário Júnior')
})

test('fails closed for blank, inactive, wrong-unit and no-service schedule assignments', () => {
    assert.equal(resolveScheduledInjector({}, unit, rows, 'Sem Atendimento').reason, 'NO_SCHEDULED_INJECTOR')
    assert.equal(resolveScheduledInjector({ doctorName: 'Sem Atendimento' }, unit, rows, 'Sem Atendimento').reason, 'NO_SCHEDULED_INJECTOR')
    assert.equal(resolveScheduledInjector({ professionalId: 'injector-inactive' }, unit, rows).professional, null)
    assert.equal(resolveScheduledInjector({ professionalId: 'injector-barra' }, unit, rows).professional, null)
})

test('detects direct attempts to replace a persisted injector', () => {
    const attendance = { injectorId: 'injector-a', injectorName: 'Raul Rosário Júnior' }
    assert.equal(hasInjectorPatch({ injectorName: 'Outro injetor' }), true)
    assert.equal(injectorPatchMatchesAttendance({ injectorId: 'injector-a' }, attendance), true)
    assert.equal(injectorPatchMatchesAttendance({ injectorName: 'Outro injetor' }, attendance), false)
})
