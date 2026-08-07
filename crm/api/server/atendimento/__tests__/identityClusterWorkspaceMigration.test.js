import test from 'node:test'
import assert from 'node:assert/strict'

import {
    IDENTITY_CLUSTER_WORKSPACE_MIGRATION_ID,
    applyIdentityClusterWorkspaceMigration,
    identityClusterWorkspaceMigrationPlan,
    identityClusterWorkspaceMigrationStatements,
    rollbackIdentityClusterWorkspaceMigration,
} from '../identityClusterWorkspaceMigration.js'

const LOCAL_SOCKET_URL = 'postgresql:///skincos_crm_local?host=/var/run/postgresql'

test('defines an additive, non-destructive cluster workspace ledger migration', () => {
    const plan = identityClusterWorkspaceMigrationPlan()
    const ddl = identityClusterWorkspaceMigrationStatements().join('\n').toLowerCase()
    assert.equal(plan.id, IDENTITY_CLUSTER_WORKSPACE_MIGRATION_ID)
    assert.deepEqual(plan.adds, ['identity_cluster_review_operations', 'identity_cluster_reveal_events'])
    assert.match(plan.privacy, /never enter/i)
    assert.match(plan.ledgerIntegrity, /truncate/i)
    assert.match(plan.rollback, /non-destructive/i)
    assert.doesNotMatch(ddl, /drop trigger|drop table|delete from/)
    assert.match(ddl, /identity_cluster_review_operations_immutable/)
    assert.match(ddl, /identity_cluster_reveal_events_no_truncate/)
})

test('applies under migration and graph locks before recording readiness', async () => {
    const calls = []
    let released = false
    const client = {
        async query(sql, params = []) {
            calls.push({ sql, params })
            if (/current_database\(\)/i.test(sql)) return { rows: [{ database_name: 'skincos_crm_local', database_user: 'admin', read_only: 'off' }] }
            if (/to_regclass\('crm_atendimento\.global_client_identities'\)/i.test(sql)) return { rows: [{ prerequisites: true }] }
            return { rows: [], rowCount: 0 }
        },
        release() { released = true },
    }
    const report = await applyIdentityClusterWorkspaceMigration({ pool: { connect: async () => client }, databaseUrl: LOCAL_SOCKET_URL })
    assert.equal(report.applied, true)
    assert.equal(report.runtimeRole, 'skincos')
    assert.equal(released, true)
    const locks = calls.filter(({ sql }) => /pg_advisory_xact_lock/i.test(sql)).map(({ params }) => params[0])
    assert.deepEqual(locks, [IDENTITY_CLUSTER_WORKSPACE_MIGRATION_ID, 'crm_atendimento.identity_graph_materialization'])
    assert.equal(calls.some(({ sql }) => /grant select, insert on table crm_atendimento\.identity_cluster_review_operations to skincos/i.test(sql)), true)
    assert.equal(calls.some(({ sql }) => /insert into crm_atendimento\.schema_migrations/i.test(sql)), true)
    assert.equal(calls.some(({ sql }) => String(sql).trim().toLowerCase() === 'commit'), true)
})

test('refuses an unsafe destination before opening a connection and rolls back non-destructively', async () => {
    let connected = false
    await assert.rejects(
        () => applyIdentityClusterWorkspaceMigration({ pool: { connect: async () => { connected = true } }, databaseUrl: 'postgresql://admin@localhost/skincos_crm_local' }),
        (error) => error?.code === 'IDENTITY_CLUSTER_WORKSPACE_MIGRATION_DESTINATION_UNSAFE',
    )
    assert.equal(connected, false)

    const calls = []
    const client = {
        async query(sql, params = []) {
            calls.push({ sql, params })
            if (/current_database\(\)/i.test(sql)) return { rows: [{ database_name: 'skincos_crm_local', database_user: 'admin', read_only: 'off' }] }
            return { rows: [] }
        },
        release() {},
    }
    const result = await rollbackIdentityClusterWorkspaceMigration({ pool: { connect: async () => client }, databaseUrl: LOCAL_SOCKET_URL })
    assert.equal(result.evidenceRetained, true)
    assert.equal(calls.some(({ sql }) => /drop table|delete from/i.test(sql)), false)
})
