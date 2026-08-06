import assert from 'node:assert/strict'
import test from 'node:test'
import {
    applyCommercialAnalyticsMigration,
    commercialAnalyticsMigrationPlan,
    parseCommercialAnalyticsMigrationAction,
    rollbackCommercialAnalyticsMigration,
} from '../commercialAnalyticsMigration.js'

function fakeClient() {
    const calls = []
    return {
        calls,
        async query(sql) {
            calls.push(String(sql))
            if (String(sql).includes('current_database()')) return { rows: [{ database_name: 'skincos_crm_local', database_user: 'admin', session_user: 'admin', read_only: 'off' }] }
            if (String(sql).startsWith('select to_regclass')) return { rows: [{ relation_0: 'units', relation_1: 'identities', relation_2: 'actions', relation_3: 'findings', relation_4: 'events' }] }
            return { rows: [{}] }
        },
        release() {},
    }
}

test('analytics migration exposes defaults and additive append-only tables', () => {
    const plan = commercialAnalyticsMigrationPlan()
    assert.equal(plan.id, '20260806_commercial_analytics_v1')
    assert.equal(plan.defaults.responseDays, 7)
    assert.ok(plan.tables.includes('commercial_analytics_events'))
    assert.match(plan.runtimeAccess, /append-only/i)
    assert.equal(parseCommercialAnalyticsMigrationAction(['--apply']), 'apply')
    assert.equal(parseCommercialAnalyticsMigrationAction(['--rollback']), 'rollback')
    assert.throws(() => parseCommercialAnalyticsMigrationAction([]), /COMMERCIAL_ANALYTICS_MIGRATION_ACTION_INVALID/)
})

test('migration rejects unsafe destination before connecting', async () => {
    await assert.rejects(() => applyCommercialAnalyticsMigration({ pool: {}, databaseUrl: 'postgresql://admin@db.example/skincos_crm_local' }), /COMMERCIAL_ANALYTICS_MIGRATION_DESTINATION_UNSAFE/)
    await assert.rejects(() => rollbackCommercialAnalyticsMigration({ pool: {}, databaseUrl: 'postgresql://admin@db.example/skincos_crm_local' }), /COMMERCIAL_ANALYTICS_MIGRATION_DESTINATION_UNSAFE/)
})

test('migration applies through the guarded client and retains non-destructive rollback', async () => {
    const applyClient = fakeClient()
    const pool = { async connect() { return applyClient } }
    const databaseUrl = 'postgresql:///skincos_crm_local?host=/var/run/postgresql'
    const applied = await applyCommercialAnalyticsMigration({ pool, databaseUrl, target: 'local' })
    assert.equal(applied.applied, true)
    assert.ok(applyClient.calls.some((sql) => sql.includes('commercial_analytics_events')))
    const rollbackClient = fakeClient()
    const rolled = await rollbackCommercialAnalyticsMigration({ pool: { async connect() { return rollbackClient } }, databaseUrl, target: 'local' })
    assert.equal(rolled.destructive, false)
    assert.equal(rolled.evidenceRetained, true)
})
