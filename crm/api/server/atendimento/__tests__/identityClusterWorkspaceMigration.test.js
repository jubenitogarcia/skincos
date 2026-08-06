import test from 'node:test'
import assert from 'node:assert/strict'

import {
    IDENTITY_CLUSTER_WORKSPACE_MIGRATION_ID,
    applyIdentityClusterWorkspaceMigration,
    identityClusterWorkspaceMigrationPlan,
    rollbackIdentityClusterWorkspaceMigration,
} from '../identityClusterWorkspaceMigration.js'

const LOCAL_SOCKET_URL = 'postgresql:///skincos_crm_local?host=/var/run/postgresql'

test('defines an additive privacy-safe cluster workspace migration', () => {
    const plan = identityClusterWorkspaceMigrationPlan()
    assert.equal(plan.id, IDENTITY_CLUSTER_WORKSPACE_MIGRATION_ID)
    assert.deepEqual(plan.adds, ['identity_review_cluster_operations', 'identity_review_cluster_reveals'])
    assert.match(plan.privacy, /raw contact values never/i)
    assert.match(plan.ledgerIntegrity, /UPDATE, DELETE and TRUNCATE/i)
    assert.match(plan.rollback, /Non-destructive/i)
})

test('applies cluster ledgers only after the private mirror prerequisites and records readiness last', async () => {
    const calls = []
    const client = {
        async query(sql, params = []) {
            calls.push({ sql: String(sql), params })
            if (/current_database\(\)/i.test(sql)) return { rows: [{ database_name: 'skincos_crm_local', database_user: 'admin', read_only: 'off' }] }
            if (/to_regclass\('crm_atendimento\.(global_client_identities|identity_review_decisions)/i.test(sql)) {
                return { rows: [{ global_client_identities: 'crm_atendimento.global_client_identities', global_client_identity_members: 'crm_atendimento.global_client_identity_members', identity_review_decisions: 'crm_atendimento.identity_review_decisions', identity_materialization_runs: 'crm_atendimento.identity_materialization_runs', identity_member_history: 'crm_atendimento.identity_member_history', identity_lineage: 'crm_atendimento.identity_lineage', identity_source_link_history: 'crm_atendimento.identity_source_link_history', commercial_actions: 'crm_atendimento.commercial_actions', commercial_contact_permissions: 'crm_atendimento.commercial_contact_permissions', commercial_contact_permission_events: 'crm_atendimento.commercial_contact_permission_events', audit_events: 'crm_atendimento.audit_events' }] }
            }
            return { rows: [], rowCount: 0 }
        },
        release() {},
    }
    const report = await applyIdentityClusterWorkspaceMigration({ pool: { connect: async () => client }, databaseUrl: LOCAL_SOCKET_URL })
    assert.equal(report.applied, true)
    assert.equal(report.runtimeRole, 'skincos')
    const normalized = calls.map(({ sql }) => sql.replace(/\s+/g, ' ').trim())
    const begin = normalized.findIndex((sql) => /^begin$/i.test(sql))
    const prerequisite = normalized.findIndex((sql) => /global_client_identities/i.test(sql) && /to_regclass/i.test(sql))
    const operations = normalized.findIndex((sql) => /create table if not exists crm_atendimento\.identity_review_cluster_operations/i.test(sql))
    const revealTrigger = normalized.findIndex((sql) => /create trigger identity_review_cluster_reveals_immutable/i.test(sql))
    const registry = normalized.findIndex((sql) => /insert into crm_atendimento\.schema_migrations/i.test(sql))
    const commit = normalized.findIndex((sql) => /^commit$/i.test(sql))
    assert.ok(begin >= 0 && prerequisite > begin && operations > prerequisite && revealTrigger > operations && registry > revealTrigger && commit > registry)
    assert.ok(normalized.some((sql) => /grant select, insert on table crm_atendimento\.identity_review_cluster_operations to skincos/i.test(sql)))
    assert.equal(normalized.some((sql) => /drop table|drop schema|delete from/i.test(sql)), false)
})

test('refuses TCP destinations before connecting and rolls back non-destructively', async () => {
    let connected = false
    await assert.rejects(
        () => applyIdentityClusterWorkspaceMigration({ pool: { connect: async () => { connected = true } }, databaseUrl: 'postgresql://admin@127.0.0.1:5432/skincos_crm_local' }),
        (error) => error?.code === 'IDENTITY_CLUSTER_WORKSPACE_MIGRATION_DESTINATION_UNSAFE',
    )
    assert.equal(connected, false)

    const calls = []
    const client = {
        async query(sql, params = []) {
            calls.push({ sql: String(sql), params })
            if (/current_database\(\)/i.test(sql)) return { rows: [{ database_name: 'skincos_crm_local', database_user: 'admin', read_only: 'off' }] }
            return { rows: [], rowCount: 0 }
        },
        release() {},
    }
    const report = await rollbackIdentityClusterWorkspaceMigration({ pool: { connect: async () => client }, databaseUrl: LOCAL_SOCKET_URL })
    assert.deepEqual(report, { id: IDENTITY_CLUSTER_WORKSPACE_MIGRATION_ID, rolledBack: true, destructive: false, workspaceDisabled: true })
    assert.ok(calls.some(({ sql }) => /insert into crm_atendimento\.schema_migrations/i.test(sql)))
    assert.equal(calls.some(({ sql }) => /drop table|drop schema|delete from/i.test(sql)), false)
})
