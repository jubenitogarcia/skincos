import assert from 'node:assert/strict'
import test from 'node:test'

import {
    COMMERCIAL_OPERATIONS_MIGRATION_ID,
    __testables,
    applyCommercialOperationsMigration,
    commercialOperationsMigrationPlan,
} from '../commercialOperationsMigration.js'

test('commercial operations migration is additive, append-only and denies message capability', () => {
    const plan = commercialOperationsMigrationPlan()
    const sql = __testables.STATEMENTS.join('\n').toLowerCase()
    const grants = __testables.runtimeGrantStatements('staging').join('\n').toLowerCase()

    assert.equal(plan.id, COMMERCIAL_OPERATIONS_MIGRATION_ID)
    assert.deepEqual(plan.appendOnlyTables, ['commercial_action_events', 'commercial_operation_mutations', 'commercial_campaign_events'])
    assert.match(plan.messagePolicy, /never dispatch a message/i)
    assert.match(plan.piiPolicy, /no phone, email, message payload/i)
    assert.doesNotMatch(sql, /drop\s+trigger/)
    assert.doesNotMatch(sql, /on delete cascade/)
    assert.match(sql, /commercial_actions_outcome_code_v2_valid/)
    assert.match(sql, /commercial_operation_mutations/)
    assert.match(sql, /commercial_campaigns/)
    assert.match(sql, /commercial_campaign_members/)
    assert.match(sql, /commercial_campaign_events/)
    assert.match(sql, /before update or delete/)
    assert.match(sql, /before truncate/)
    assert.doesNotMatch(grants, /grant\s+(?:all privileges|delete|truncate)/)
    assert.match(grants, /revoke update, delete, truncate, references, trigger on table crm_atendimento\.commercial_campaign_events/)
    assert.match(grants, /grant select on table crm_atendimento\.schema_migrations to skincos_staging_crm_app/)
    assert.match(grants, /grant select, insert on table crm_atendimento\.commercial_operation_mutations/)
    assert.match(grants, /grant select, insert on table crm_atendimento\.commercial_campaign_events/)
})

test('commercial operations trigger readiness verifies inherited and new immutable ledgers', () => {
    const readiness = __testables.triggerReadinessStatement()
    assert.match(readiness, /commercial_action_events_immutable/)
    assert.match(readiness, /commercial_action_events_no_truncate/)
    assert.match(readiness, /prevent_commercial_ledger_mutation/)
    assert.match(readiness, /commercial_operation_mutations_v2_immutable/)
    assert.match(readiness, /commercial_operation_mutations_v2_no_truncate/)
    assert.match(readiness, /commercial_campaign_events_v2_immutable/)
    assert.match(readiness, /commercial_campaign_events_v2_no_truncate/)
    assert.match(readiness, /prevent_commercial_operations_evidence_mutation_v2/)
})

test('commercial operations migration refuses unsafe destinations before opening a database connection', async () => {
    let connected = false
    await assert.rejects(
        () => applyCommercialOperationsMigration({
            pool: { connect: async () => { connected = true } },
            databaseUrl: 'postgresql://unsafe.example.invalid/skincos_crm_local',
            target: 'production',
        }),
        { code: 'COMMERCIAL_OPERATIONS_DESTINATION_UNSAFE' },
    )
    assert.equal(connected, false)
})

test('commercial operations keeps a missing local prerequisite terminal and never marks it applied', async () => {
    const calls = []
    const client = {
        async query(sql, params = []) {
            calls.push({ sql, params })
            if (/current_database\(\)/i.test(sql)) return { rows: [{ database_name: 'skincos_crm_local', database_user: 'admin', session_user: 'admin', read_only: 'off' }] }
            if (/relation_0/i.test(sql)) {
                return {
                    rows: [Object.fromEntries(__testables.PREREQUISITE_RELATIONS.map((_, index) => [
                        `relation_${index}`,
                        index !== __testables.PREREQUISITE_RELATIONS.indexOf('crm_atendimento.commercial_offers'),
                    ]))],
                }
            }
            return { rows: [] }
        },
        release() {},
    }
    await assert.rejects(
        applyCommercialOperationsMigration({
            pool: { connect: async () => client },
            databaseUrl: 'postgresql:///skincos_crm_local?host=/var/run/postgresql',
        }),
        { code: 'COMMERCIAL_OPERATIONS_PREREQUISITES_MISSING' },
    )
    assert.equal(calls.some(({ sql }) => /insert into crm_atendimento\.schema_migrations/i.test(sql)), false)
})
