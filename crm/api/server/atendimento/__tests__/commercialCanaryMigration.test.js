import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import {
    COMMERCIAL_CANARY_LOCK_KEY,
    COMMERCIAL_CANARY_MIGRATION_ID,
    applyCommercialCanaryMigration,
    commercialCanaryMigrationPlan,
    parseCommercialCanaryMigrationAction,
} from '../commercialCanaryMigration.js'

test('defines an additive, fail-closed canary migration with immutable evidence', () => {
    const plan = commercialCanaryMigrationPlan()
    assert.equal(plan.id, COMMERCIAL_CANARY_MIGRATION_ID)
    assert.deepEqual(plan.adds, [
        'commercial_canary_cohorts',
        'commercial_canary_cohort_members',
        'commercial_canary_identity_validations',
        'commercial_canary_events',
    ])
    assert.match(plan.defaultRollout, /writes remain disabled/i)
    assert.match(plan.ledger, /append-only/i)
    assert.match(plan.rollback, /Non-destructive/i)
    assert.equal(parseCommercialCanaryMigrationAction(['--apply']), 'apply')
    assert.equal(parseCommercialCanaryMigrationAction(['--rollback']), 'rollback')
    assert.throws(() => parseCommercialCanaryMigrationAction(['--apply', '--rollback']), (error) => error?.code === 'COMMERCIAL_CANARY_MIGRATION_ACTION_INVALID')
})

test('applies only the guarded local schema contract and grants no destructive runtime access', async () => {
    const calls = []
    const client = {
        async query(sql, params = []) {
            calls.push({ sql, params })
            if (/current_database\(\)/i.test(sql)) {
                return { rows: [{ database_name: 'skincos_crm_local', database_user: 'admin', session_user: 'admin', read_only: 'off' }] }
            }
            if (/to_regclass\(/i.test(sql) && /relation_0/i.test(sql)) {
                return { rows: [{ relation_0: 'schema_migrations', relation_1: 'commercial_policy_config', relation_2: 'global_client_identities', relation_3: 'global_client_identity_members', relation_4: 'units', relation_5: 'commercial_contact_permissions' }] }
            }
            return { rows: [] }
        },
        release() {},
    }
    const report = await applyCommercialCanaryMigration({
        pool: { connect: async () => client },
        databaseUrl: 'postgresql:///skincos_crm_local?host=/var/run/postgresql',
    })

    assert.equal(report.applied, true)
    assert.equal(report.commercialWritesEnabled, false)
    assert.equal(report.messagesSent, 0)
    const schema = calls.map(({ sql }) => sql).join('\n')
    assert.match(schema, /commercial_canary_events_immutable/i)
    assert.match(schema, /commercial_contact_writes_enabled = false/i)
    assert.doesNotMatch(schema, /create\s+or\s+replace/i)
    assert.equal(/\bdrop\b/i.test(schema), false)
    assert.equal(calls.some(({ params }) => params.includes(COMMERCIAL_CANARY_LOCK_KEY)), true)
    const grants = calls.filter(({ sql }) => /^grant /i.test(sql)).map(({ sql }) => sql)
    assert.equal(grants.some((sql) => /\bdelete\b|\btruncate\b|\bddl\b/i.test(sql)), false)
})

test('runs the canary migration after its identity and source-quality prerequisites', async () => {
    const runnerPath = fileURLToPath(new URL('../../../scripts/migrate-atendimento-staging.mjs', import.meta.url))
    const runner = await readFile(runnerPath, 'utf8')
    const materializationIndex = runner.indexOf("20260805_client_identity_materialization_schema_v1")
    const sourceOperationsIndex = runner.indexOf("20260807_clientes_source_operations_v2")
    const canaryIndex = runner.indexOf(COMMERCIAL_CANARY_MIGRATION_ID)

    assert.ok(materializationIndex >= 0)
    assert.ok(sourceOperationsIndex >= 0)
    assert.ok(canaryIndex > materializationIndex)
    assert.ok(canaryIndex > sourceOperationsIndex)
})

test('rejects an unsafe destination before opening a migration connection', async () => {
    let connected = false
    await assert.rejects(() => applyCommercialCanaryMigration({
        pool: { connect: async () => { connected = true } },
        databaseUrl: 'postgresql://admin@127.0.0.1:5432/skincos_crm_local',
    }), /COMMERCIAL_CANARY_MIGRATION_DESTINATION_UNSAFE/)
    assert.equal(connected, false)
})
