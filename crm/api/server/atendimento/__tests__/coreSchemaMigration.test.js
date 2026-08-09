import assert from 'node:assert/strict'
import test from 'node:test'
import {
    __testables,
    atendimentoCoreSchemaMigrationPlan,
    inspectAtendimentoCoreSchema,
} from '../coreSchemaMigration.js'

test('core Atendimento schema plan is derived from the canonical store and includes commercial offers', () => {
    assert.ok(__testables.CORE_SCHEMA_RELATIONS.includes('crm_atendimento.commercial_offers'))
    assert.equal(new Set(__testables.CORE_SCHEMA_RELATIONS).size, __testables.CORE_SCHEMA_RELATIONS.length)
    assert.equal(atendimentoCoreSchemaMigrationPlan().relationCount, __testables.CORE_SCHEMA_RELATIONS.length)
})

test('core schema inspection reports missing relations without writing', async () => {
    const calls = []
    const schema = await inspectAtendimentoCoreSchema({
        async query(sql, values) {
            calls.push({ sql, values })
            return {
                rows: [
                    { relation_name: 'crm_atendimento.commercial_offers', present: false },
                    { relation_name: 'crm_atendimento.units', present: true },
                ],
            }
        },
    })

    assert.equal(calls.length, 1)
    assert.match(calls[0].sql, /from unnest\(\$1::text\[\]\)/)
    assert.equal(calls[0].values.length, 1)
    assert.equal(schema.ready, false)
    assert.deepEqual(schema.missing, ['crm_atendimento.commercial_offers'])
})
