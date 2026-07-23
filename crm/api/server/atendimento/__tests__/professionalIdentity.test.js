import test from 'node:test'
import assert from 'node:assert/strict'

import {
    buildProfessionalIdentityDiagnosis,
    normalizeProfessionalAliasKey,
    resolveProfessionalIdentity,
} from '../professionalIdentity.js'
import { professionalIdentityMigrationPlan } from '../professionalIdentityMigration.js'

const professionals = [
    {
        id: 'raul-legacy', canonical_id: 'raul-canonical', canonical_name: 'Raul Rosário Júnior',
        name: 'Raul Júnior', status: 'Ativo', units: ['BarraShoppingSul'], roles: ['Injetor'],
        aliases: ['Raul Júnior', 'Dr. Raul'],
    },
    {
        id: 'raul-canonical', canonical_id: 'raul-canonical', canonical_name: 'Raul Rosário Júnior',
        name: 'Raul Rosário Júnior', status: 'Ativo', units: ['BarraShoppingSul'], roles: ['Injetor'],
        aliases: ['Raul Rosário Júnior', 'Raul Júnior', 'Dr. Raul'],
    },
    {
        id: 'doris', canonical_id: 'doris', canonical_name: 'Dóris Caroline Moisyn',
        name: 'Dóris Caroline Moisyn', status: 'Inativo', units: ['Novo Hamburgo'], roles: ['Injetor'],
        aliases: ['Dóris Caroline Moisyn'],
    },
    {
        id: 'vini', canonical_id: 'vini', canonical_name: 'Vinícius Vieira',
        name: 'Vinícius Vieira', status: 'Ativo', units: ['Novo Hamburgo', 'BarraShoppingSul'], roles: ['Injetor'],
        aliases: ['Vinícius Vieira', 'Dr. Vini'],
    },
    {
        id: 'alex-one', canonical_id: 'alex-one', canonical_name: 'Alex Silva',
        name: 'Alex Silva', status: 'Ativo', units: ['Novo Hamburgo'], roles: ['Consultor'], aliases: ['Alex Silva'],
    },
    {
        id: 'alex-two', canonical_id: 'alex-two', canonical_name: 'Alex Silva',
        name: 'Alex Silva', status: 'Ativo', units: ['BarraShoppingSul'], roles: ['Consultor'], aliases: ['Alex Silva'],
    },
]

test('normalizes accents and resolves an approved historical abbreviation to its canonical id', () => {
    assert.equal(normalizeProfessionalAliasKey('  DR. RAÚL  '), 'dr raul')
    const result = resolveProfessionalIdentity({
        professionalName: 'Dr. Raúl',
        unit: { slug: 'barra-shopping-sul' },
        expectedRole: 'Injetor',
        allowTextResolution: true,
    }, professionals)
    assert.equal(result.canonicalId, 'raul-canonical')
    assert.equal(result.canonicalName, 'Raul Rosário Júnior')
})

test('requires an explicit id for manual resolution and validates active unit-bound professionals', () => {
    assert.throws(
        () => resolveProfessionalIdentity({ professionalName: 'Raul Júnior', unit: { slug: 'barra-shopping-sul' }, expectedRole: 'Injetor' }, professionals),
        /PROFESSIONAL_ID_REQUIRED/,
    )
    assert.throws(
        () => resolveProfessionalIdentity({ professionalId: 'doris', unit: { slug: 'novo-hamburgo' }, expectedRole: 'Injetor' }, professionals),
        /INACTIVE_PROFESSIONAL/,
    )
    assert.throws(
        () => resolveProfessionalIdentity({ professionalId: 'raul-canonical', unit: { slug: 'novo-hamburgo' }, expectedRole: 'Injetor' }, professionals),
        /PROFESSIONAL_NOT_AVAILABLE_FOR_UNIT/,
    )
    assert.equal(
        resolveProfessionalIdentity({ professionalId: 'vini', unit: { slug: 'barra-shopping-sul' }, expectedRole: 'Injetor' }, professionals).canonicalId,
        'vini',
    )
})

test('keeps homonyms ambiguous when identity is not selected by id', () => {
    assert.throws(
        () => resolveProfessionalIdentity({
            professionalName: 'Alex Silva', unit: { slug: 'all' }, expectedRole: 'Consultor', allowTextResolution: true,
        }, professionals),
        /AMBIGUOUS_PROFESSIONAL/,
    )
})

test('reports invalid records and only proposes abbreviated-name merges for human review', () => {
    const diagnosis = buildProfessionalIdentityDiagnosis([
        ...professionals,
        { id: 'invalid', name: '[object Object]', status: 'Ativo', units: ['Novo Hamburgo'], roles: ['Injetor'] },
        { id: 'marina-short', name: 'Marina', status: 'Ativo', units: ['Novo Hamburgo'], roles: ['Injetor'] },
        { id: 'marina-full', name: 'Marina Lima', status: 'Ativo', units: ['Novo Hamburgo'], roles: ['Injetor'] },
    ], { scheduleNames: ['Dr. Vini', 'Profissional não cadastrado'] })
    assert.equal(diagnosis.invalidRecords[0].id, 'invalid')
    assert.ok(diagnosis.mergeProposals.some((proposal) => proposal.sourceId === 'marina-short' && proposal.targetId === 'marina-full'))
    assert.ok(diagnosis.unresolvedScheduleNames.includes('Profissional não cadastrado'))
    assert.equal(diagnosis.mergeProposals.every((proposal) => proposal.confidence === 'ambiguous'), true)
})

test('defines a non-destructive identity migration with only reviewed canonical links', () => {
    const plan = professionalIdentityMigrationPlan()
    assert.equal(plan.id, '20260718_atendimento_professional_identity_v1')
    assert.deepEqual(plan.confirmedAliasRules.map((rule) => rule.canonicalName), ['Raul Rosário Júnior', 'Rafaela Machado Ferreira'])
    assert.equal(plan.indexes.some((sql) => sql.includes('professional_aliases_key_idx')), true)
    assert.match(plan.rollback, /retained/i)
})
