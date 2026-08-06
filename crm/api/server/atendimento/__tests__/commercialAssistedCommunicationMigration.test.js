import assert from 'node:assert/strict'
import test from 'node:test'
import {
    applyCommercialAssistedCommunicationMigration,
    commercialAssistedCommunicationMigrationPlan,
    parseCommercialAssistedCommunicationMigrationAction,
    rollbackCommercialAssistedCommunicationMigration,
} from '../commercialAssistedCommunicationMigration.js'

function fakeClient() {
    const calls = []
    return {
        calls,
        async query(sql) {
            calls.push(String(sql))
            if (String(sql).includes('current_database()')) return { rows: [{ database_name: 'skincos_crm_local', database_user: 'admin', session_user: 'admin', read_only: 'off' }] }
            if (String(sql).startsWith('select to_regclass')) return { rows: [{ relation_0: 'units', relation_1: 'offers', relation_2: 'actions', relation_3: 'permissions', relation_4: 'policy' }] }
            return { rows: [{}] }
        },
        release() {},
    }
}

test('assisted communication migration is additive, append-only and provider-send free', () => {
    const plan = commercialAssistedCommunicationMigrationPlan()
    assert.equal(plan.id, '20260806_commercial_assisted_communication_v1')
    assert.ok(plan.tables.includes('commercial_whatsapp_attempts'))
    assert.ok(plan.tables.includes('commercial_contact_emergency_controls'))
    assert.match(plan.runtimeAccess, /No provider send permission/i)
    assert.match(plan.privacy, /phone hash/i)
    assert.equal(parseCommercialAssistedCommunicationMigrationAction(['--apply']), 'apply')
    assert.equal(parseCommercialAssistedCommunicationMigrationAction(['--rollback']), 'rollback')
    assert.throws(() => parseCommercialAssistedCommunicationMigrationAction(['--drop']), /COMMERCIAL_ASSISTED_COMMUNICATION_MIGRATION_ACTION_INVALID/)
})

test('assisted communication migration rejects unsafe destination before connecting', async () => {
    await assert.rejects(() => applyCommercialAssistedCommunicationMigration({ pool: {}, databaseUrl: 'postgresql://admin@db.example/skincos_crm_local' }), /COMMERCIAL_ASSISTED_COMMUNICATION_MIGRATION_DESTINATION_UNSAFE/)
    await assert.rejects(() => rollbackCommercialAssistedCommunicationMigration({ pool: {}, databaseUrl: 'postgresql://admin@db.example/skincos_crm_local' }), /COMMERCIAL_ASSISTED_COMMUNICATION_MIGRATION_DESTINATION_UNSAFE/)
})

test('assisted communication migration installs immutable evidence and keeps rollback non-destructive', async () => {
    const applyClient = fakeClient()
    const databaseUrl = 'postgresql:///skincos_crm_local?host=/var/run/postgresql'
    const applied = await applyCommercialAssistedCommunicationMigration({ pool: { async connect() { return applyClient } }, databaseUrl, target: 'local' })
    assert.equal(applied.applied, true)
    assert.ok(applyClient.calls.some((sql) => sql.includes('commercial_whatsapp_events')))
    assert.ok(applyClient.calls.some((sql) => sql.includes('prevent_commercial_assisted_append_only')))
    assert.ok(applied.runtimeGrants.some((sql) => /grant select, insert, update on table crm_atendimento\.commercial_whatsapp_attempts/i.test(sql)))
    assert.ok(applied.runtimeGrants.every((sql) => !/execute|update on table crm_atendimento\.commercial_whatsapp_events/i.test(sql)))
    const rollbackClient = fakeClient()
    const rolled = await rollbackCommercialAssistedCommunicationMigration({ pool: { async connect() { return rollbackClient } }, databaseUrl, target: 'local' })
    assert.equal(rolled.destructive, false)
    assert.equal(rolled.evidenceRetained, true)
    assert.equal(rolled.providerSend, false)
})
