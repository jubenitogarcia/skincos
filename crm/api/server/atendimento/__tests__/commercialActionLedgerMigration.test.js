import test from 'node:test'
import assert from 'node:assert/strict'

import {
    COMMERCIAL_ACTION_LEDGER_MIGRATION_ID,
    applyCommercialActionLedgerMigration,
    commercialActionLedgerMigrationPlan,
} from '../commercialActionLedgerMigration.js'

const LOCAL_SOCKET_URL = 'postgresql:///skincos_crm_local?host=/var/run/postgresql'

test('defines an additive commercial ledger without globally freezing audit_events', () => {
    const plan = commercialActionLedgerMigrationPlan()

    assert.equal(plan.id, COMMERCIAL_ACTION_LEDGER_MIGRATION_ID)
    assert.deepEqual(plan.adds, [
        'commercial_contact_permission_events.trace_id',
        'commercial_action_events',
    ])
    assert.deepEqual(plan.appendOnlyTables, [
        'commercial_contact_permission_events',
        'commercial_action_events',
    ])
    assert.match(plan.tracePolicy, /UUID trace_id/i)
    assert.match(plan.runtimeAccess, /action-event SELECT\/INSERT/i)
    assert.match(plan.auditScope, /audit_events mutable/i)
    assert.match(plan.rollback, /non-destructive/i)
})

test('creates immutable commercial ledgers while retaining untraceable pre-cutover evidence', async () => {
    const calls = []
    let released = false
    const client = {
        async query(sql, params = []) {
            calls.push({ sql, params })
            if (/current_database\(\)/i.test(sql)) {
                return { rows: [{ database_name: 'skincos_crm_local', database_user: 'admin', read_only: 'off' }] }
            }
            if (/to_regclass\('crm_atendimento\.commercial_actions'\)/i.test(sql)) {
                return {
                    rows: [{
                        commercial_actions: 'crm_atendimento.commercial_actions',
                        commercial_contact_permission_events: 'crm_atendimento.commercial_contact_permission_events',
                        global_client_identities: 'crm_atendimento.global_client_identities',
                    }],
                }
            }
            if (/permission_events_without_trace/i.test(sql)) {
                return { rows: [{ permission_events_without_trace: 4, preexisting_actions: 9 }] }
            }
            return { rows: [], rowCount: 0 }
        },
        release() { released = true },
    }

    const report = await applyCommercialActionLedgerMigration({
        pool: { connect: async () => client },
        databaseUrl: LOCAL_SOCKET_URL,
    })

    assert.equal(report.applied, true)
    assert.equal(report.permissionEventsWithoutTrace, 4)
    assert.equal(report.preexistingActions, 9)
    assert.equal(report.permissionTraceConstraintValidated, false)
    assert.equal(report.runtimeRole, 'skincos')
    assert.equal(report.runtimeGrants.length, 3)
    assert.equal(released, true)

    const indexOf = (pattern) => calls.findIndex(({ sql }) => pattern.test(String(sql).replace(/\s+/g, ' ')))
    const addTrace = indexOf(/alter table crm_atendimento\.commercial_contact_permission_events add column if not exists trace_id uuid/i)
    const actionLedger = indexOf(/create table if not exists crm_atendimento\.commercial_action_events/i)
    const permissionImmutable = indexOf(/create trigger commercial_contact_permission_events_immutable before update or delete/i)
    const actionImmutable = indexOf(/create trigger commercial_action_events_immutable before update or delete/i)
    const truncateGuard = indexOf(/create trigger commercial_action_events_no_truncate before truncate/i)
    const registry = indexOf(/insert into crm_atendimento\.schema_migrations/i)

    assert.ok(addTrace >= 0)
    assert.ok(actionLedger > addTrace)
    assert.ok(permissionImmutable > actionLedger)
    assert.ok(actionImmutable > permissionImmutable)
    assert.ok(truncateGuard > actionImmutable)
    assert.ok(registry > truncateGuard)
    assert.equal(calls.some(({ sql }) => /validate constraint commercial_permission_events_trace_required/i.test(sql)), false)
    assert.equal(calls.some(({ sql }) => /audit_events/i.test(sql)), false)
    assert.ok(calls.some(({ sql }) => /grant select, insert on table crm_atendimento\.commercial_action_events to skincos/i.test(sql)))
    assert.ok(calls.some(({ sql }) => /grant usage, select on sequence crm_atendimento\.commercial_action_events_event_order_seq to skincos/i.test(sql)))
})

test('validates the permission trace requirement when no legacy event is missing a trace', async () => {
    const calls = []
    const client = {
        async query(sql, params = []) {
            calls.push({ sql, params })
            if (/current_database\(\)/i.test(sql)) {
                return { rows: [{ database_name: 'skincos_crm_local', database_user: 'admin', read_only: 'off' }] }
            }
            if (/to_regclass\('crm_atendimento\.commercial_actions'\)/i.test(sql)) {
                return {
                    rows: [{
                        commercial_actions: 'crm_atendimento.commercial_actions',
                        commercial_contact_permission_events: 'crm_atendimento.commercial_contact_permission_events',
                        global_client_identities: 'crm_atendimento.global_client_identities',
                    }],
                }
            }
            if (/permission_events_without_trace/i.test(sql)) {
                return { rows: [{ permission_events_without_trace: 0, preexisting_actions: 0 }] }
            }
            return { rows: [], rowCount: 0 }
        },
        release() {},
    }

    const report = await applyCommercialActionLedgerMigration({
        pool: { connect: async () => client },
        databaseUrl: LOCAL_SOCKET_URL,
    })

    assert.equal(report.permissionTraceConstraintValidated, true)
    assert.equal(calls.some(({ sql }) => /validate constraint commercial_permission_events_trace_required/i.test(sql)), true)
})

test('refuses a TCP ledger migration destination before opening a database connection', async () => {
    let connected = false
    await assert.rejects(
        () => applyCommercialActionLedgerMigration({
            pool: { connect: async () => { connected = true } },
            databaseUrl: 'postgresql://admin@127.0.0.1:5432/skincos_crm_local',
        }),
        /COMMERCIAL_ACTION_LEDGER_MIGRATION_DESTINATION_UNSAFE/,
    )
    assert.equal(connected, false)
})
