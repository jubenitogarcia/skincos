import test from 'node:test'
import assert from 'node:assert/strict'

import {
    COMMERCIAL_CONTACT_MIGRATION_ID,
    applyCommercialContactMigration,
    commercialContactMigrationPlan,
} from '../commercialContactMigration.js'

test('defines an additive and non-destructive commercial contact migration', () => {
    const plan = commercialContactMigrationPlan()
    assert.equal(plan.id, COMMERCIAL_CONTACT_MIGRATION_ID)
    assert.deepEqual(plan.tables, ['commercial_contact_permissions', 'commercial_contact_permission_events'])
    assert.equal(plan.indexes.some((sql) => /concurrently/i.test(sql)), true)
    assert.match(plan.runtimeAccess, /consent-state SELECT\/INSERT\/UPDATE/i)
    assert.match(plan.rollback, /non-destructive/i)
})

test('reconciles least-privilege consent runtime grants after the tables exist', async () => {
    const calls = []
    const client = {
        async query(sql, params = []) {
            calls.push({ sql, params })
            if (/current_database\(\)/i.test(sql)) {
                return { rows: [{ database_name: 'skincos_crm_local', database_user: 'admin', read_only: 'off' }] }
            }
            return { rows: [] }
        },
        release() {},
    }

    const report = await applyCommercialContactMigration({
        pool: { connect: async () => client },
        databaseUrl: 'postgresql:///skincos_crm_local?host=/var/run/postgresql',
    })

    assert.equal(report.runtimeRole, 'skincos')
    assert.equal(report.runtimeGrants.length, 3)
    assert.ok(calls.some(({ sql }) => /grant select, insert, update on table crm_atendimento\.commercial_contact_permissions to skincos/i.test(sql)))
    assert.ok(calls.some(({ sql }) => /grant select, insert on table crm_atendimento\.commercial_contact_permission_events to skincos/i.test(sql)))
})

test('refuses a TCP migration destination before opening the database connection', async () => {
    let connected = false
    await assert.rejects(
        () => applyCommercialContactMigration({
            pool: { connect: async () => { connected = true } },
            databaseUrl: 'postgresql://admin@127.0.0.1:5432/skincos_crm_local',
        }),
        /COMMERCIAL_CONTACT_MIGRATION_DESTINATION_UNSAFE/,
    )
    assert.equal(connected, false)
})
