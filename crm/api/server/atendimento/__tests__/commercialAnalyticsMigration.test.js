import assert from 'node:assert/strict'
import test from 'node:test'

import {
    COMMERCIAL_ANALYTICS_MIGRATION_ID,
    __testables,
    applyCommercialAnalyticsMigration,
    commercialAnalyticsMigrationPlan,
} from '../commercialAnalyticsMigration.js'

test('analytics migration is additive, PII-minimizing and cannot authorize messaging', () => {
    const plan = commercialAnalyticsMigrationPlan()
    const sql = __testables.STATEMENTS.join('\n').toLowerCase()
    const grants = __testables.runtimeGrantStatements('staging').join('\n').toLowerCase()
    assert.equal(plan.id, COMMERCIAL_ANALYTICS_MIGRATION_ID)
    assert.match(plan.piiPolicy, /no name, phone, email, message body/i)
    assert.match(plan.messagingPolicy, /do not schedule, dispatch or retry messages/i)
    assert.equal(plan.appendOnlyTables.includes('commercial_experiment_assignments'), true)
    assert.doesNotMatch(sql, /drop\s+trigger/)
    assert.doesNotMatch(sql, /on delete cascade/)
    assert.match(sql, /commercial_attribution_windows/)
    assert.match(sql, /commercial_segment_membership_snapshots/)
    assert.match(sql, /version_key text not null/)
    assert.match(sql, /commercial_analytics_metric_snapshots/)
    assert.match(sql, /event_key text not null unique/)
    assert.match(sql, /commercial_analytics_mutations/)
    assert.match(sql, /commercial_experiment_assignments/)
    assert.match(sql, /before update or delete/)
    assert.match(sql, /before truncate/)
    assert.doesNotMatch(grants, /grant\s+(?:all privileges|delete|truncate)/)
    assert.match(grants, /grant select, insert on table crm_atendimento\.commercial_analytics_events/)
    assert.match(grants, /grant select, insert on table crm_atendimento\.commercial_analytics_mutations/)
    assert.match(grants, /grant select on table crm_atendimento\.schema_migrations/)
    assert.match(sql, /unique nulls not distinct\(segment_version_id, unit_id, snapshot_date, membership_hash\)/)
    assert.match(sql, /unique nulls not distinct\(source_key, finding_key, unit_id, bucket_date, metrics_hash\)/)
})

test('analytics migration readiness checks every immutable evidence relation', () => {
    const readiness = __testables.triggerReadinessStatement()
    for (const table of __testables.EVIDENCE_TABLES) {
        assert.match(readiness, new RegExp(table))
    }
    assert.match(readiness, /prevent_commercial_analytics_evidence_mutation_v2/)
})

test('analytics migration refuses unsafe destinations without connecting', async () => {
    let connected = false
    await assert.rejects(
        () => applyCommercialAnalyticsMigration({
            pool: { connect: async () => { connected = true } },
            databaseUrl: 'postgresql://unsafe.example.invalid/skincos_crm_local',
            target: 'production',
        }),
        { code: 'COMMERCIAL_ANALYTICS_DESTINATION_UNSAFE' },
    )
    assert.equal(connected, false)
})
