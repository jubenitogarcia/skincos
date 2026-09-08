import test from 'node:test'
import assert from 'node:assert/strict'

import {
    CRM_CORE_PROJECTION_DELTA_MIGRATION_ID,
    applyCrmCoreProjectionDeltaMigration,
    crmCoreProjectionDeltaMigrationPlan,
    prepareAtendimentoProjectionDeltaBaseline,
    reconcileAtendimentoProjectionDelta,
    __testables as migrationTestables,
} from '../crmCoreProjectionDeltaMigration.js'
import {
    createAtendimentoProjectionDeltaBaselineBackfill,
    createAtendimentoProjectionDeltaBaselineSnapshot,
} from '../../../../../shared/crm-auth/atendimentoProjectionDeltaBaseline.js'

const LOCAL_SOCKET_URL = 'postgresql:///skincos_crm_local?host=/var/run/postgresql'
const BASELINE_TARGET = { environment: 'staging', release: 'a'.repeat(40), artifactDigest: `sha256:${'b'.repeat(64)}` }
const BASELINE_SOURCE = { owner: 'atendimento', scope: 'global-client-identities/v1', backfillKeyId: 'atendimento-projection-key-v2', deltaKeyId: 'crm-staging-atendimento-delta-v1' }
const BASELINE_ROWS = [
    { identity_id: '11111111-1111-4111-8111-111111111111', unit_slug: 'jardins', observed_at: '2026-09-08T12:00:00.000Z' },
    { identity_id: '22222222-2222-4222-8222-222222222222', unit_slug: 'pinheiros', observed_at: '2026-09-08T12:00:00.000Z' },
]
const BASELINE_SNAPSHOT = createAtendimentoProjectionDeltaBaselineSnapshot({ rows: BASELINE_ROWS, capturedAt: '2026-09-08T12:05:00.000Z', watermark: 0 })
const BASELINE_BATCH_ID = 'backfill:atendimento:migration-baseline-test'
const BASELINE_CURSOR_DIGEST = BASELINE_SNAPSHOT.snapshot.cursorDigest
const BASELINE_REAL_BATCH = {
    contract: 'skincos-crm/projection-backfill-batch/v2',
    batchId: BASELINE_BATCH_ID,
    producer: { owner: 'atendimento', scope: 'global-client-identities/v1', keyId: BASELINE_SOURCE.backfillKeyId },
    sourceSnapshot: {
        capturedAt: BASELINE_SNAPSHOT.snapshot.capturedAt,
        cursorDigest: BASELINE_CURSOR_DIGEST,
        rowCount: 2,
        unitSlugs: BASELINE_SNAPSHOT.snapshot.unitSlugs,
    },
    target: BASELINE_TARGET,
    events: [
        {
            contractVersion: 'crm-projection-event/v2',
            id: 'event:baseline-migration-0001',
            projection: { reference: 'projection:baseline-migration-0001', kind: 'client-reference' },
            source: { owner: 'atendimento', reference: 'source:baseline-migration-0001' },
            unitScope: { unitSlug: 'jardins' },
            revision: 1,
            operation: 'upsert',
            occurredAt: '2026-09-08T12:00:00.000Z',
        },
        {
            contractVersion: 'crm-projection-event/v2',
            id: 'event:baseline-migration-0002',
            projection: { reference: 'projection:baseline-migration-0002', kind: 'client-reference' },
            source: { owner: 'atendimento', reference: 'source:baseline-migration-0002' },
            unitScope: { unitSlug: 'pinheiros' },
            revision: 1,
            operation: 'upsert',
            occurredAt: '2026-09-08T12:00:00.000Z',
        },
    ],
    integrity: { algorithm: 'sha256', eventCount: 2, eventsDigest: `sha256:${'c'.repeat(64)}` },
}
const BASELINE_BACKFILL = createAtendimentoProjectionDeltaBaselineBackfill({
    batches: [{
        batchId: BASELINE_BATCH_ID,
        batchDigest: migrationTestables.digestOpaqueBackfillBatch(BASELINE_REAL_BATCH),
        capturedAt: BASELINE_SNAPSHOT.snapshot.capturedAt,
        cursorDigest: BASELINE_CURSOR_DIGEST,
        fromOrdinal: 1,
        toOrdinal: BASELINE_SNAPSHOT.snapshot.rowCount,
        rowCount: BASELINE_SNAPSHOT.snapshot.rowCount,
        unitSlugs: BASELINE_SNAPSHOT.snapshot.unitSlugs,
        eventCount: BASELINE_SNAPSHOT.snapshot.rowCount,
    }],
    rowCount: BASELINE_SNAPSHOT.snapshot.rowCount,
})

test('defines additive membership and append-only outbox ownership', () => {
    const plan = crmCoreProjectionDeltaMigrationPlan()
    assert.equal(plan.id, CRM_CORE_PROJECTION_DELTA_MIGRATION_ID)
    assert.deepEqual(plan.relations, [
        'crm_atendimento.crm_core_projection_memberships',
        'crm_atendimento.crm_core_projection_outbox',
        'crm_atendimento.crm_core_projection_delta_handoffs',
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
    const handoff = indexOf(/create table if not exists crm_atendimento\.crm_core_projection_delta_handoffs/i)
    const registry = indexOf(/insert into crm_atendimento\.schema_migrations/i)
    const commit = indexOf(/^commit$/i)
    assert.ok(begin >= 0)
    assert.ok(lock > begin)
    assert.ok(membership > lock)
    assert.ok(outbox > membership)
    assert.ok(immutable > outbox)
    assert.ok(handoff > immutable)
    assert.ok(registry > immutable)
    assert.ok(commit > registry)
    assert.ok(calls.some(({ sql }) => /grant select \(event_order, event_id, identity_id, unit_slug, revision, operation, occurred_at, created_at\).*crm_core_projection_outbox to skincos/i.test(sql)))
})

test('rejects a non-socket destination before opening a connection', async () => {
    let connected = false
    await assert.rejects(() => applyCrmCoreProjectionDeltaMigration({ pool: { connect: async () => { connected = true } }, databaseUrl: 'postgresql://admin@127.0.0.1:5432/skincos_crm_local' }), /DESTINATION_UNSAFE/)
    assert.equal(connected, false)
})

test('captures the source snapshot and revision-1 seed atomically before permitting delta', async () => {
    const calls = []
    let released = false
    let factoryRows = null
    const client = {
        async query(sql, params = []) {
            calls.push({ sql, params })
            if (/current_database\(\)/i.test(sql)) return { rows: [{ database_name: 'skincos_crm_local', database_user: 'admin', session_user: 'admin', read_only: 'off' }] }
            if (/from crm_atendimento\.crm_core_projection_delta_handoffs/i.test(sql)) return { rows: [] }
            if (/from crm_atendimento\.crm_core_projection_memberships/i.test(sql)) return { rows: [] }
            if (/max\(event_order\)/i.test(sql)) return { rows: [{ watermark: 0 }] }
            if (/canonical_delta_source/i.test(sql)) return { rows: BASELINE_ROWS }
            if (/transaction_timestamp\(\)/i.test(sql)) return { rows: [{ captured_at: BASELINE_SNAPSHOT.snapshot.capturedAt }] }
            return { rows: [], rowCount: 0 }
        },
        release() { released = true },
    }
    const report = await prepareAtendimentoProjectionDeltaBaseline({
        pool: { connect: async () => client },
        databaseUrl: LOCAL_SOCKET_URL,
        target: 'local',
        targetDescriptor: BASELINE_TARGET,
        source: BASELINE_SOURCE,
        backfillFactory: ({ rows, snapshot, seed }) => {
            factoryRows = rows
            assert.equal(rows.length, BASELINE_ROWS.length)
            assert.equal(snapshot.rowCount, seed.rowCount)
            return { backfill: BASELINE_BACKFILL, batches: [BASELINE_REAL_BATCH] }
        },
    })
    assert.equal(report.baseline.state, 'baseline-prepared')
    assert.equal(report.seededMemberships, 2)
    assert.equal(report.atomic, true)
    assert.equal(released, true)
    assert.equal(factoryRows.length, BASELINE_ROWS.length)
    assert.ok(calls.findIndex(({ sql }) => /canonical_delta_source/i.test(sql)) < calls.findIndex(({ sql }) => /insert into crm_atendimento\.crm_core_projection_memberships/i.test(sql)))
    assert.equal(calls.filter(({ sql }) => /insert into crm_atendimento\.crm_core_projection_memberships/i.test(sql)).length, 2)
    assert.equal(calls.some(({ sql }) => /insert into crm_atendimento\.crm_core_projection_outbox/i.test(sql)), false)
    assert.ok(calls.some(({ sql }) => /^commit$/i.test(sql)))
})

test('rejects duplicate opaque event identities across paginated baseline batches', () => {
    const first = { ...BASELINE_REAL_BATCH, batchId: 'backfill:atendimento:duplicate-first', events: [BASELINE_REAL_BATCH.events[0]], sourceSnapshot: { ...BASELINE_REAL_BATCH.sourceSnapshot, cursorDigest: `sha256:${'2'.repeat(64)}`, rowCount: 1, unitSlugs: ['jardins'] }, integrity: { ...BASELINE_REAL_BATCH.integrity, eventCount: 1 } }
    const second = { ...BASELINE_REAL_BATCH, batchId: 'backfill:atendimento:duplicate-second', events: [BASELINE_REAL_BATCH.events[0]], sourceSnapshot: { ...BASELINE_REAL_BATCH.sourceSnapshot, cursorDigest: `sha256:${'4'.repeat(64)}`, rowCount: 1, unitSlugs: ['jardins'] }, integrity: { ...BASELINE_REAL_BATCH.integrity, eventCount: 1 } }
    const manifest = createAtendimentoProjectionDeltaBaselineBackfill({
        batches: [
            { batchId: first.batchId, batchDigest: `sha256:${'1'.repeat(64)}`, capturedAt: BASELINE_SNAPSHOT.snapshot.capturedAt, cursorDigest: `sha256:${'2'.repeat(64)}`, fromOrdinal: 1, toOrdinal: 1, rowCount: 1, unitSlugs: ['jardins'], eventCount: 1 },
            { batchId: second.batchId, batchDigest: `sha256:${'3'.repeat(64)}`, capturedAt: BASELINE_SNAPSHOT.snapshot.capturedAt, cursorDigest: `sha256:${'4'.repeat(64)}`, fromOrdinal: 2, toOrdinal: 2, rowCount: 1, unitSlugs: ['jardins'], eventCount: 1 },
        ],
        rowCount: 2,
    })
    assert.throws(() => migrationTestables.assertBackfillFactoryBatches({ batches: [first, second], manifest, source: BASELINE_SOURCE, snapshot: { ...BASELINE_SNAPSHOT.snapshot, rowCount: 2, unitSlugs: ['jardins'] }, target: BASELINE_TARGET }), /DUPLICATE|DERIVATION_FAILED/)
})

test('refuses reconciliation until the persisted baseline handoff is delta-ready', async () => {
    const calls = []
    const client = {
        async query(sql) {
            calls.push(sql)
            if (/current_database\(\)/i.test(sql)) return { rows: [{ database_name: 'skincos_crm_local', database_user: 'admin', session_user: 'admin', read_only: 'off' }] }
            if (/from crm_atendimento\.crm_core_projection_delta_handoffs/i.test(sql)) return { rows: [] }
            return { rows: [] }
        },
        release() {},
    }
    await assert.rejects(() => reconcileAtendimentoProjectionDelta({ pool: { connect: async () => client }, databaseUrl: LOCAL_SOCKET_URL }), /BASELINE_NOT_READY/)
    assert.equal(calls.some((sql) => /canonical_delta_source/i.test(sql)), false)
})

test('reconciles new, changed and removed memberships under one advisory transaction', async () => {
    const calls = []
    let nextEventOrder = 40
    const client = {
        async query(sql, params = []) {
            calls.push({ sql, params })
            if (/current_database\(\)/i.test(sql)) return { rows: [{ database_name: 'skincos_crm_local', database_user: 'admin', session_user: 'admin', read_only: 'off' }] }
            if (/from crm_atendimento\.crm_core_projection_delta_handoffs/i.test(sql)) return { rows: [{ state: 'delta-ready', handoff_key: 'initial' }] }
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
