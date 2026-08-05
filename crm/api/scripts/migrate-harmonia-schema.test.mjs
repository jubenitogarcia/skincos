import assert from 'node:assert/strict'
import test from 'node:test'

import {
    HARMONIA_MIGRATION_ID,
    assertHarmoniaMigrationDestination,
    harmoniaMigrationPlan,
} from './migrate-harmonia-schema.mjs'

const productionUrl = 'postgresql://skincos@/skincos_crm_local?host=/var/run/postgresql'
const stagingUrl = 'postgresql://skincos_staging_migrator_login:secret@127.0.0.1:5432/skincos_staging?sslmode=require&application_name=atendimento-migration'

test('Harmonia migration accepts only explicit production and staging destinations', () => {
    assert.equal(assertHarmoniaMigrationDestination(productionUrl, 'production'), 'production')
    assert.equal(assertHarmoniaMigrationDestination(stagingUrl, 'staging'), 'staging')
    assert.throws(() => assertHarmoniaMigrationDestination(stagingUrl, 'production'), /skincos_crm_local/)
    assert.throws(() => assertHarmoniaMigrationDestination('postgresql://admin@db.example/skincos_crm_local', 'production'), /socket URL/)
    assert.throws(() => assertHarmoniaMigrationDestination('postgresql://user@127.0.0.1/skincos_staging?sslmode=disable', 'staging'), /sslmode=require/)
})

test('Harmonia migration plan is additive, idempotent and fail-closed for rollback', () => {
    const plan = harmoniaMigrationPlan()
    assert.equal(plan.id, HARMONIA_MIGRATION_ID)
    assert.equal(plan.additive, true)
    assert.ok(plan.statements.every((statement) => !/\b(drop|truncate|delete\s+from)\b/i.test(statement)))
    assert.match(plan.rollback, /retain|disable|stop/i)
    assert.ok(plan.seedUnits.length >= 2)
})
