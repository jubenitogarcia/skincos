import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { commercialCanaryMigrationPlan, parseCommercialCanaryMigrationAction } from '../commercialCanaryMigration.js'

test('defines an additive, append-only commercial canary selector migration', async () => {
    const plan = commercialCanaryMigrationPlan()
    assert.equal(plan.id, '20260806_commercial_canary_identity_selector_v1')
    assert.ok(plan.adds.includes('commercial_canary_cohorts'))
    assert.match(plan.audit, /append-only/i)
    assert.match(plan.rollback, /Non-destructive/i)
    const sql = await readFile(new URL('../migrations/20260806_commercial_canary_identity_selector_v1.up.sql', import.meta.url), 'utf8')
    assert.match(sql, /commercial_canary_events/i)
    assert.match(sql, /commercial_canary_one_active_idx/i)
    assert.match(sql, /BEFORE UPDATE OR DELETE/i)
    assert.match(sql, /identityIds/i)
})

test('requires exactly one explicit migration action', () => {
    assert.equal(parseCommercialCanaryMigrationAction(['--apply']), 'apply')
    assert.equal(parseCommercialCanaryMigrationAction(['--rollback']), 'rollback')
    assert.throws(() => parseCommercialCanaryMigrationAction([]), (error) => error.code === 'COMMERCIAL_CANARY_MIGRATION_ACTION_INVALID')
    assert.throws(() => parseCommercialCanaryMigrationAction(['--apply', '--rollback']), (error) => error.code === 'COMMERCIAL_CANARY_MIGRATION_ACTION_INVALID')
})
