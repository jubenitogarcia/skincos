import test from 'node:test'
import assert from 'node:assert/strict'

import {
    IDENTITY_REVIEW_WORKFLOW_MIGRATION_ID,
    applyIdentityReviewWorkflowMigration,
    identityReviewWorkflowMigrationPlan,
    rollbackIdentityReviewWorkflowMigration,
} from '../identityReviewMigration.js'

const LOCAL_SOCKET_URL = 'postgresql:///skincos_crm_local?host=/var/run/postgresql'

test('defines an additive, append-only identity review workflow migration', () => {
    const plan = identityReviewWorkflowMigrationPlan()

    assert.equal(plan.id, IDENTITY_REVIEW_WORKFLOW_MIGRATION_ID)
    assert.deepEqual(plan.adds, [
        'identity_review_decisions',
        'identity_materialization_runs',
        'identity_member_history',
        'identity_lineage',
    ])
    assert.match(plan.decisionPolicy, /append-only/i)
    assert.match(plan.decisionPolicy, /expected source version/i)
    assert.match(plan.materializationPolicy, /fails closed/i)
    assert.match(plan.materializationPolicy, /commercial history/i)
    assert.match(plan.rollback, /non-destructive/i)
})

test('applies compatibility DDL atomically before recording workflow readiness', async () => {
    const calls = []
    let released = false
    const client = {
        async query(sql, params = []) {
            calls.push({ sql, params })
            if (/current_database\(\)/i.test(sql)) {
                return { rows: [{ database_name: 'skincos_crm_local', database_user: 'admin', read_only: 'off' }] }
            }
            if (/to_regclass\('crm_atendimento\.client_merge_suggestions'\)/i.test(sql)) {
                return { rows: [{ all_prerequisites_present: true }] }
            }
            if (/information_schema\.columns/i.test(sql)) return { rows: [{ column_present: true }] }
            return { rows: [], rowCount: 0 }
        },
        release() { released = true },
    }

    const report = await applyIdentityReviewWorkflowMigration({
        pool: { connect: async () => client },
        databaseUrl: LOCAL_SOCKET_URL,
    })

    assert.equal(report.applied, true)
    assert.equal(released, true)
    const indexOf = (pattern) => calls.findIndex(({ sql }) => pattern.test(String(sql).replace(/\s+/g, ' ')))
    const begin = indexOf(/^begin$/i)
    const lock = indexOf(/pg_advisory_xact_lock/i)
    const createHistory = indexOf(/create table if not exists crm_atendimento\.identity_member_history/i)
    const addEventOrder = indexOf(/alter table crm_atendimento\.identity_member_history add column if not exists event_order/i)
    const registry = indexOf(/insert into crm_atendimento\.schema_migrations/i)
    const commit = indexOf(/^commit$/i)

    assert.ok(begin >= 0)
    assert.ok(lock > begin)
    const locks = calls.filter(({ sql }) => /pg_advisory_xact_lock/i.test(String(sql)))
    assert.deepEqual(locks.map(({ params }) => params[0]), [
        IDENTITY_REVIEW_WORKFLOW_MIGRATION_ID,
        'crm_atendimento.identity_graph_materialization',
    ])
    assert.ok(createHistory > lock)
    assert.ok(addEventOrder > createHistory)
    assert.ok(registry > addEventOrder)
    assert.ok(commit > registry)
    assert.equal(calls.some(({ sql }) => String(sql).trim().toLowerCase() === 'rollback'), false)
    assert.equal(calls[registry].params[0], IDENTITY_REVIEW_WORKFLOW_MIGRATION_ID)
    assert.match(calls[registry].params[1], /"applied":true/)
})

test('refuses a non-socket apply destination before opening a database connection', async () => {
    let connected = false

    await assert.rejects(
        () => applyIdentityReviewWorkflowMigration({
            pool: { connect: async () => { connected = true } },
            databaseUrl: 'postgresql://admin@127.0.0.1:5432/skincos_crm_local',
        }),
        (error) => error?.code === 'IDENTITY_REVIEW_WORKFLOW_MIGRATION_DESTINATION_UNSAFE',
    )
    assert.equal(connected, false)
})

test('refuses a non-socket rollback destination before opening a database connection', async () => {
    let connected = false

    await assert.rejects(
        () => rollbackIdentityReviewWorkflowMigration({
            pool: { connect: async () => { connected = true } },
            databaseUrl: 'postgresql://admin@localhost/skincos_crm_local',
        }),
        (error) => error?.code === 'IDENTITY_REVIEW_WORKFLOW_MIGRATION_DESTINATION_UNSAFE',
    )
    assert.equal(connected, false)
})

test('rejects a socket URL whose connected database identity is not the private writable mirror', async () => {
    const calls = []
    let released = false
    const client = {
        async query(sql, params = []) {
            calls.push({ sql, params })
            if (/current_database\(\)/i.test(sql)) {
                return { rows: [{ database_name: 'skincos_crm_production', database_user: 'admin', read_only: 'off' }] }
            }
            return { rows: [] }
        },
        release() { released = true },
    }

    await assert.rejects(
        () => applyIdentityReviewWorkflowMigration({
            pool: { connect: async () => client },
            databaseUrl: LOCAL_SOCKET_URL,
        }),
        (error) => error?.code === 'IDENTITY_REVIEW_WORKFLOW_MIGRATION_DESTINATION_UNSAFE',
    )

    assert.equal(released, true)
    assert.equal(calls.some(({ sql }) => String(sql).trim().toLowerCase() === 'begin'), true)
    assert.equal(calls.some(({ sql }) => String(sql).trim().toLowerCase() === 'rollback'), true)
    assert.equal(calls.some(({ sql }) => /insert into crm_atendimento\.schema_migrations/i.test(sql)), false)
    assert.equal(calls.some(({ sql }) => /to_regclass\(/i.test(sql)), false)
    assert.equal(calls.some(({ sql }) => /create table if not exists crm_atendimento\.identity_/i.test(sql)), false)
})
