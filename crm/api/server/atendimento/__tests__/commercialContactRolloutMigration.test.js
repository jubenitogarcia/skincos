import test from 'node:test'
import assert from 'node:assert/strict'

import {
    COMMERCIAL_CONTACT_ROLLOUT_MIGRATION_ID,
    applyCommercialContactRolloutMigration,
    commercialContactRolloutMigrationPlan,
} from '../commercialContactRolloutMigration.js'

test('defines an additive, disabled-by-default commercial contact rollout migration', () => {
    const plan = commercialContactRolloutMigrationPlan()
    assert.equal(plan.id, COMMERCIAL_CONTACT_ROLLOUT_MIGRATION_ID)
    assert.deepEqual(plan.adds, [
        'commercial_actions.contacted_at',
        'commercial_policy_config.commercial_contact_writes_enabled',
        'commercial_policy_config.commercial_contact_canary_identity_ids',
    ])
    assert.equal(plan.indexes.some((sql) => /concurrently/i.test(sql)), true)
    assert.match(plan.legacyContactBackfill, /contacted/i)
    assert.match(plan.defaultRollout, /disabled/i)
    assert.match(plan.rollback, /disables writes/i)
})

test('repairs an invalid contacted index and backfills only explicit contacts', async () => {
    const calls = []
    const indexStates = [
        { valid: false, ready: false },
        { valid: true, ready: true },
    ]
    const client = {
        async query(sql, params = []) {
            calls.push({ sql, params })
            if (/current_database\(\)/i.test(sql)) {
                return { rows: [{ database_name: 'skincos_crm_local', database_user: 'admin', read_only: 'off' }] }
            }
            if (/to_regclass\('crm_atendimento\.commercial_actions'\)/i.test(sql)) {
                return { rows: [{ actions: 'commercial_actions', policy: 'commercial_policy_config', permissions: 'commercial_contact_permissions', permission_events: 'commercial_contact_permission_events' }] }
            }
            if (/with updated as/i.test(sql)) return { rows: [{ count: 3 }] }
            if (/from pg_index/i.test(sql)) return { rows: [indexStates.shift()] }
            return { rows: [] }
        },
        release() {},
    }
    const report = await applyCommercialContactRolloutMigration({
        pool: { connect: async () => client },
        databaseUrl: 'postgresql:///skincos_crm_local?host=/var/run/postgresql',
    })

    assert.equal(report.applied, true)
    assert.equal(report.legacyContactRowsBackfilled, 3)
    const backfill = calls.find(({ sql }) => /with updated as/i.test(sql))
    assert.deepEqual(backfill.params, [['contacted']])
    assert.equal(calls.some(({ sql }) => /drop index concurrently/i.test(sql)), true)
    assert.equal(calls.some(({ sql }) => /create index concurrently/i.test(sql)), true)
})

test('rejects a non-socket destination before opening a migration connection', async () => {
    let connected = false
    await assert.rejects(
        () => applyCommercialContactRolloutMigration({
            pool: { connect: async () => { connected = true } },
            databaseUrl: 'postgresql://admin@127.0.0.1:5432/skincos_crm_local',
        }),
        /COMMERCIAL_CONTACT_ROLLOUT_MIGRATION_DESTINATION_UNSAFE/,
    )
    assert.equal(connected, false)
})
