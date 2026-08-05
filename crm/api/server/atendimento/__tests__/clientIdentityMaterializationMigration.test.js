import test from 'node:test'
import assert from 'node:assert/strict'
import {
    applyClientIdentityMaterializationMigration,
    clientIdentityMaterializationMigrationPlan,
    CLIENT_IDENTITY_MATERIALIZATION_SCHEMA_MIGRATION_ID,
} from '../clientIdentityMaterializationMigration.js'

const LOCAL_SOCKET_URL = 'postgresql:///skincos_crm_local?host=/var/run/postgresql'

test('defines a dedicated non-destructive schema migration for data-only materializers', () => {
    const plan = clientIdentityMaterializationMigrationPlan()
    assert.equal(plan.id, CLIENT_IDENTITY_MATERIALIZATION_SCHEMA_MIGRATION_ID)
    assert.equal(plan.tables.includes('canonical_clients'), true)
    assert.equal(plan.tables.includes('supplemental_lead_profiles'), true)
    assert.match(plan.policy, /data-only/i)
    assert.match(plan.rollback, /non-destructive/i)
})

test('applies all identity source schema before recording readiness', async () => {
    const calls = []
    let released = false
    const client = {
        async query(sql, params = []) {
            calls.push({ sql, params })
            if (/current_database\(\)/i.test(sql)) {
                return { rows: [{ database_name: 'skincos_crm_local', database_user: 'admin', read_only: 'off' }] }
            }
            if (/to_regclass\('crm_atendimento\.attendances'\)/i.test(sql)) {
                return { rows: [{ table_0: 'attendances', table_1: 'units', table_2: 'customers', table_3: 'sales', table_4: 'sale_items' }] }
            }
            return { rows: [], rowCount: 0 }
        },
        release() { released = true },
    }

    const report = await applyClientIdentityMaterializationMigration({
        pool: { connect: async () => client },
        databaseUrl: LOCAL_SOCKET_URL,
    })

    assert.equal(report.applied, true)
    assert.equal(released, true)
    const indexOf = (pattern) => calls.findIndex(({ sql }) => pattern.test(String(sql).replace(/\s+/g, ' ')))
    const begin = indexOf(/^begin$/i)
    const lock = indexOf(/pg_advisory_xact_lock/i)
    const canonical = indexOf(/create table if not exists crm_atendimento\.canonical_clients/i)
    const supplemental = indexOf(/create table if not exists crm_atendimento\.supplemental_lead_profiles/i)
    const registry = indexOf(/insert into crm_atendimento\.schema_migrations/i)
    const commit = indexOf(/^commit$/i)
    assert.ok(begin >= 0)
    assert.ok(lock > begin)
    assert.ok(canonical > lock)
    assert.ok(supplemental > canonical)
    assert.ok(registry > supplemental)
    assert.ok(commit > registry)
    assert.equal(calls.some(({ params }) => params[0] === CLIENT_IDENTITY_MATERIALIZATION_SCHEMA_MIGRATION_ID), true)
})

test('refuses a non-socket migration destination before opening a connection', async () => {
    let connected = false
    await assert.rejects(
        () => applyClientIdentityMaterializationMigration({
            pool: { connect: async () => { connected = true } },
            databaseUrl: 'postgresql://admin@localhost/skincos_crm_local',
        }),
        (error) => error?.code === 'CLIENT_IDENTITY_MATERIALIZATION_MIGRATION_DESTINATION_UNSAFE',
    )
    assert.equal(connected, false)
})
