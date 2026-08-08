import test from 'node:test'
import assert from 'node:assert/strict'

import {
    COMMERCIAL_ASSISTED_MIGRATION_ID,
    __testables,
    applyCommercialAssistedMigration,
    commercialAssistedMigrationPlan,
    parseCommercialAssistedMigrationAction,
} from '../commercialAssistedCommunicationMigration.js'

test('defines an additive, fail-closed assisted migration with non-destructive rollback', () => {
    const plan = commercialAssistedMigrationPlan()
    assert.equal(plan.id, COMMERCIAL_ASSISTED_MIGRATION_ID)
    assert.equal(plan.outbound.providerSend, false)
    assert.equal(plan.outbound.automationEnabled, false)
    assert.match(plan.actionContextGuard, /immutable/i)
    assert.match(plan.rollback, /Non-destructive/i)
    assert.equal(parseCommercialAssistedMigrationAction(['--apply']), 'apply')
    assert.equal(parseCommercialAssistedMigrationAction(['--rollback']), 'rollback')
    assert.throws(() => parseCommercialAssistedMigrationAction(['--apply', '--rollback']), /COMMERCIAL_ASSISTED_MIGRATION_ACTION_INVALID/)
})

test('migration installs recursive PII defenses, append-only/no-truncate protections and replay-identical action guard', () => {
    const statements = __testables.STATEMENTS.join('\n')
    const readiness = __testables.triggerReadinessStatement()
    assert.match(statements, /commercial_assisted_text_is_safe_v2/)
    assert.match(statements, /commercial_assisted_json_is_safe_v2/)
    assert.match(statements, /jsonb_each|jsonb_array_elements/)
    assert.match(statements, /event_payload_hash/)
    assert.match(statements, /commercial_assisted_action_context_immutable/)
    assert.match(statements, /commercial assisted action snapshot mismatch/)
    assert.match(statements, /commercial_assisted_offer_snapshots_no_truncate/)
    assert.match(statements, /commercial_assisted_events_no_truncate/)
    assert.match(readiness, /action_context_guard/)
    assert.match(readiness, /no_truncate_0/)
    assert.match(readiness, /prevent_commercial_assisted_evidence_mutation_v2/)
    assert.equal(/\bdrop\s+(?:table|schema|database)\b/i.test(statements), false)
})

test('guarded migration grants schema_migrations read access but no destructive runtime privilege', async () => {
    const calls = []
    const client = {
        async query(sql, params = []) {
            calls.push({ sql, params })
            if (/current_database\(\)/i.test(sql)) return { rows: [{ database_name: 'skincos_crm_local', database_user: 'admin', session_user: 'admin', read_only: 'off' }] }
            if (/relation_0/i.test(sql)) return { rows: [{ every_prerequisite: true }] }
            if (/select exists\(select 1 from pg_trigger/i.test(sql)) return { rows: [{ every_guard: true }] }
            return { rows: [] }
        },
        release() {},
    }
    const report = await applyCommercialAssistedMigration({
        pool: { connect: async () => client },
        databaseUrl: 'postgresql:///skincos_crm_local?host=/var/run/postgresql',
    })
    assert.equal(report.applied, true)
    assert.equal(report.runtimeRole, 'skincos')
    const schema = calls.map((call) => call.sql).join('\n')
    const grants = calls.filter((call) => /^grant /i.test(call.sql)).map((call) => call.sql).join('\n')
    assert.match(schema, /select pg_advisory_xact_lock/)
    assert.match(schema, /commercial_assisted_json_is_safe_v2/)
    assert.match(grants, /grant select on table crm_atendimento[.]schema_migrations to skincos/i)
    assert.equal(/\b(delete|truncate|references|trigger)\b/i.test(grants), false)
    assert.equal(calls.some((call) => call.params.includes(COMMERCIAL_ASSISTED_MIGRATION_ID)), true)
})

test('refuses an unsafe migration destination before opening a database connection', async () => {
    let connected = false
    await assert.rejects(() => applyCommercialAssistedMigration({
        pool: { connect: async () => { connected = true } },
        databaseUrl: 'postgresql://admin@127.0.0.1:5432/skincos_crm_local',
    }), /COMMERCIAL_ASSISTED_MIGRATION_DESTINATION_UNSAFE/)
    assert.equal(connected, false)
})
