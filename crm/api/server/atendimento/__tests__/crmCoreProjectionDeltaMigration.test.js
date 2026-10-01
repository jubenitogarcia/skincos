import test from 'node:test'
import assert from 'node:assert/strict'

import {
    CRM_CORE_PROJECTION_DELTA_MIGRATION_ID,
    applyCrmCoreProjectionDeltaMigration,
    crmCoreProjectionDeltaMigrationPlan,
    reconcileAtendimentoProjectionDelta,
} from '../crmCoreProjectionDeltaMigration.js'

const LOCAL_SOCKET_URL = 'postgresql:///skincos_crm_local?host=/var/run/postgresql'

test('defines additive membership and append-only outbox ownership', () => {
    const plan = crmCoreProjectionDeltaMigrationPlan()
    assert.equal(plan.id, CRM_CORE_PROJECTION_DELTA_MIGRATION_ID)
    assert.deepEqual(plan.relations, [
        'crm_atendimento.crm_core_projection_memberships',
        'crm_atendimento.crm_core_projection_outbox',
    ])
    assert.match(plan.eventPolicy, /upsert\/revoke/)
    assert.match(plan.reconciliation, /pg_advisory_xact_lock/)
    assert.match(plan.rollback, /non-destructive/)
})

test('applies the migration in a guarded transaction and grants read-only exporter columns', async () => {
    const calls = []
    let released = false
    const client = {
        async query(sql, params = []) {
            calls.push({ sql, params })
            if (/current_database\(\)/i.test(sql)) return { rows: [{ database_name: 'skincos_crm_local', database_user: 'admin', session_user: 'admin', read_only: 'off' }] }
            if (/to_regclass\('crm_atendimento\.global_client_identities'\)/i.test(sql)) return { rows: [{ relation_0: true, relation_1: true, relation_2: true, relation_3: true, relation_4: true, relation_5: true, relation_6: true, relation_7: true }] }
            return { rows: [], rowCount: 0 }
        },
        release() { released = true },
    }
    const report = await applyCrmCoreProjectionDeltaMigration({ pool: { connect: async () => client }, databaseUrl: LOCAL_SOCKET_URL })
    assert.equal(report.applied, true)
    assert.equal(report.runtimeRole, 'skincos')
    assert.equal(report.appendOnly, true)
    assert.equal(released, true)
    const indexOf = (pattern) => calls.findIndex(({ sql }) => pattern.test(String(sql).replace(/\s+/g, ' ')))
    const begin = indexOf(/^begin$/i)
    const lock = indexOf(/pg_advisory_xact_lock/i)
    const membership = indexOf(/create table if not exists crm_atendimento\.crm_core_projection_memberships/i)
    const outbox = indexOf(/create table if not exists crm_atendimento\.crm_core_projection_outbox/i)
    const immutable = indexOf(/create trigger crm_core_projection_outbox_immutable/i)
    const registry = indexOf(/insert into crm_atendimento\.schema_migrations/i)
    const commit = indexOf(/^commit$/i)
    assert.ok(begin >= 0)
    assert.ok(lock > begin)
    assert.ok(membership > lock)
    assert.ok(outbox > membership)
    assert.ok(immutable > outbox)
    assert.ok(registry > immutable)
    assert.ok(commit > registry)
    assert.ok(calls.some(({ sql }) => /grant select \(event_order, event_id, identity_id, unit_slug, revision, operation, occurred_at, created_at\).*crm_core_projection_outbox to skincos/i.test(sql)))
})

test('rejects a non-socket destination before opening a connection', async () => {
    let connected = false
    await assert.rejects(() => applyCrmCoreProjectionDeltaMigration({ pool: { connect: async () => { connected = true } }, databaseUrl: 'postgresql://admin@127.0.0.1:5432/skincos_crm_local' }), /DESTINATION_UNSAFE/)
    assert.equal(connected, false)
})

test('reconciles new, changed and removed memberships under one advisory transaction', async () => {
    const calls = []
    let nextEventOrder = 40
    const client = {
        async query(sql, params = []) {
            calls.push({ sql, params })
            if (/current_database\(\)/i.test(sql)) return { rows: [{ database_name: 'skincos_crm_local', database_user: 'admin', session_user: 'admin', read_only: 'off' }] }
            if (/canonical_delta_source/i.test(sql)) return { rows: [{ identity_id: '11111111-1111-4111-8111-111111111111', unit_slug: 'jardins', observed_at: '2026-09-08T12:01:00.000Z' }] }
            if (/from crm_atendimento\.crm_core_projection_memberships/i.test(sql)) return { rows: [{ identity_id: '22222222-2222-4222-8222-222222222222', unit_slug: 'pinheiros', active: true, revision: 2, observed_at: '2026-09-08T12:00:00.000Z' }] }
            if (/returning event_order/i.test(sql)) return { rows: [{ event_order: nextEventOrder++ }] }
            return { rows: [], rowCount: 0 }
        },
        release() {},
    }
    const report = await reconcileAtendimentoProjectionDelta({ pool: { connect: async () => client }, databaseUrl: LOCAL_SOCKET_URL, now: '2026-09-08T12:02:00.000Z' })
    assert.equal(report.atomic, true)
    assert.equal(report.upsertCount, 1)
    assert.equal(report.revokeCount, 1)
    assert.equal(report.outboxEvents, 2)
    assert.equal(report.highWatermark, 41)
    const indexOf = (pattern) => calls.findIndex(({ sql }) => pattern.test(String(sql).replace(/\s+/g, ' ')))
    const begin = indexOf(/begin isolation level repeatable read/i)
    const lock = indexOf(/pg_advisory_xact_lock/i)
    const source = indexOf(/canonical_delta_source/i)
    const existing = indexOf(/from crm_atendimento\.crm_core_projection_memberships/i)
    const stateWrite = indexOf(/insert into crm_atendimento\.crm_core_projection_memberships/i)
    const outboxWrite = indexOf(/insert into crm_atendimento\.crm_core_projection_outbox/i)
    const commit = indexOf(/^commit$/i)
    assert.ok(begin >= 0)
    assert.ok(lock > begin)
    assert.ok(source > lock)
    assert.ok(existing > source)
    assert.ok(stateWrite > existing)
    assert.ok(outboxWrite > stateWrite)
    assert.ok(commit > outboxWrite)
    assert.equal(calls.some(({ sql }) => /\b(?:customer|phone|email|payload|name)\b/i.test(sql) && /canonical_delta_source/i.test(sql)), false)
})
