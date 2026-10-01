import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import {
    CRM_CORE_PROJECTION_DELTA_MIGRATION_ID,
    CRM_CORE_PROJECTION_DELTA_PREREQUISITE_RELATIONS,
    ATENDIMENTO_PROJECTION_MEMBERSHIP_SOURCE_SQL,
    ATENDIMENTO_PROJECTION_MEMBERSHIP_SOURCE_RELATIONS,
    applyCrmCoreProjectionDeltaMigration,
    crmCoreProjectionDeltaMigrationPlan,
    prepareAtendimentoProjectionDeltaBaseline,
    loadAtendimentoProjectionDeltaBaselineCustody,
    reconcileAtendimentoProjectionDelta,
    __testables as migrationTestables,
} from '../crmCoreProjectionDeltaMigration.js'
import {
    acceptAtendimentoProjectionDeltaBaseline,
    createAtendimentoProjectionDeltaBaselineBackfill,
    createAtendimentoProjectionDeltaBaselineSnapshot,
    createAtendimentoProjectionDeltaBaselineSource,
    createAtendimentoProjectionDeltaBaselinePrepared,
    markAtendimentoProjectionDeltaReady,
    CRM_CORE_PROJECTION_DELTA_BASELINE_READBACK_CONTRACT,
    __testables as baselineTestables,
} from '../../../../../shared/crm-auth/atendimentoProjectionDeltaBaseline.js'

const LOCAL_SOCKET_URL = 'postgresql:///skincos_crm_local?host=/var/run/postgresql'
const PRODUCTION_SOURCE_URL = 'postgresql://skincos_clientes_migrator_login:test-only-password@127.0.0.1:5432/skincos_clientes_production?sslmode=require&uselibpqcompat=true'
const BASELINE_TARGET = { environment: 'staging', release: 'a'.repeat(40), artifactDigest: `sha256:${'b'.repeat(64)}` }
const BASELINE_HMAC_KEY = `synthetic-baseline-derivation-${'x'.repeat(40)}`
const BASELINE_SOURCE_DESCRIPTOR = {
    owner: 'atendimento',
    scope: 'global-client-identities/v1',
    backfillKeyId: 'atendimento-projection-key-v2',
    deltaKeyId: 'crm-staging-atendimento-delta-v1',
    unitAllowlist: ['jardins', 'pinheiros'],
}
const BASELINE_SOURCE = createAtendimentoProjectionDeltaBaselineSource({
    ...BASELINE_SOURCE_DESCRIPTOR,
    identityHmacKey: BASELINE_HMAC_KEY,
})
const BASELINE_ROWS = [
    { identity_id: '11111111-1111-4111-8111-111111111111', unit_slug: 'jardins', observed_at: '2026-09-08T12:00:00.000Z' },
    { identity_id: '22222222-2222-4222-8222-222222222222', unit_slug: 'pinheiros', observed_at: '2026-09-08T12:00:00.000Z' },
]
const BASELINE_SNAPSHOT = createAtendimentoProjectionDeltaBaselineSnapshot({ rows: BASELINE_ROWS, capturedAt: '2026-09-08T12:05:00.000Z', watermark: 0 })
const BASELINE_BATCH_ID = 'backfill:atendimento:migration-baseline-test'
const BASELINE_CURSOR_DIGEST = BASELINE_SNAPSHOT.snapshot.cursorDigest
const BASELINE_EVENTS = [
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
]
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
    events: BASELINE_EVENTS,
    integrity: { algorithm: 'sha256', eventCount: 2, eventsDigest: migrationTestables.digestOpaqueBackfillEvents(BASELINE_EVENTS) },
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
const BASELINE_RECEIPTS = [{
    contractVersion: 'crm-core/projection-backfill-receipt/v2',
    status: 'accepted',
    batchId: BASELINE_BATCH_ID,
    eventCount: BASELINE_REAL_BATCH.events.length,
    target: BASELINE_TARGET,
}]
const BASELINE_PROOF = (() => {
    const proof = {
        contract: 'crm-core/projection-baseline-batch-readback/v1',
        status: 'batch-ledger-readback-verified',
        pins: {
            producer: { owner: BASELINE_SOURCE.owner, scope: BASELINE_SOURCE.scope, keyId: BASELINE_SOURCE.backfillKeyId },
            target: BASELINE_TARGET,
            unitSlugs: BASELINE_BACKFILL.batches[0].unitSlugs,
        },
        counts: { events: BASELINE_REAL_BATCH.events.length, sources: BASELINE_REAL_BATCH.events.length, units: BASELINE_BACKFILL.batches[0].unitSlugs.length },
        digests: {
            batch: BASELINE_BACKFILL.batches[0].batchDigest,
            events: migrationTestables.digestOpaqueBackfillEvents(BASELINE_REAL_BATCH.events),
            cursor: BASELINE_BACKFILL.batches[0].cursorDigest,
            receipt: baselineTestables.digest(BASELINE_RECEIPTS[0]),
            ledger: `sha256:${'d'.repeat(64)}`,
            sources: `sha256:${'e'.repeat(64)}`,
        },
    }
    return { ...proof, digests: { ...proof.digests, readback: baselineTestables.digest(proof) } }
})()
const BASELINE_READBACK = {
    contract: CRM_CORE_PROJECTION_DELTA_BASELINE_READBACK_CONTRACT,
    status: 'verified',
    manifestDigest: BASELINE_BACKFILL.manifestDigest,
    membershipDigest: BASELINE_SNAPSHOT.seed.membershipDigest,
    watermark: BASELINE_SNAPSHOT.snapshot.watermark,
    verifiedBatchCount: BASELINE_BACKFILL.batches.length,
    verifiedEventCount: BASELINE_BACKFILL.eventCount,
    ledgerProofDigest: baselineTestables.digest([{ batchDigest: BASELINE_PROOF.digests.batch, readbackDigest: BASELINE_PROOF.digests.readback }]),
    proofs: [BASELINE_PROOF],
    target: BASELINE_TARGET,
}
const BASELINE_READY = markAtendimentoProjectionDeltaReady(
    acceptAtendimentoProjectionDeltaBaseline(
        createAtendimentoProjectionDeltaBaselinePrepared({
            target: BASELINE_TARGET,
            source: BASELINE_SOURCE,
            snapshot: BASELINE_SNAPSHOT.snapshot,
            backfill: BASELINE_BACKFILL,
            seed: BASELINE_SNAPSHOT.seed,
        }),
        BASELINE_RECEIPTS,
    ),
    BASELINE_READBACK,
)
const BASELINE_PREPARED = createAtendimentoProjectionDeltaBaselinePrepared({
    target: BASELINE_TARGET,
    source: BASELINE_SOURCE,
    snapshot: BASELINE_SNAPSHOT.snapshot,
    backfill: BASELINE_BACKFILL,
    seed: BASELINE_SNAPSHOT.seed,
})

function storedHandoff({ baseline = BASELINE_READY, batches = [BASELINE_REAL_BATCH], ...overrides } = {}) {
    return {
        state: baseline.state,
        handoff_key: 'initial',
        baseline_digest: baselineTestables.digest(baseline),
        baseline_json: JSON.stringify(baseline),
        baseline_packets_json: JSON.stringify(batches),
        identity_key_fingerprint: baseline.source.identityKeyFingerprint,
        unit_allowlist: JSON.stringify(baseline.source.unitAllowlist),
        readback_membership_digest: baseline.readback?.membershipDigest ?? null,
        readback_watermark: baseline.readback?.watermark ?? null,
        ...overrides,
    }
}

test('defines additive membership and append-only outbox ownership', () => {
    const plan = crmCoreProjectionDeltaMigrationPlan()
    assert.equal(plan.id, CRM_CORE_PROJECTION_DELTA_MIGRATION_ID)
    assert.equal(plan.sourceContract, 'atendimento/crm-core/projection-delta/v2')
    assert.deepEqual(plan.sourceRelationAllowlist, [
        'crm_atendimento.global_client_identity_members',
        'crm_atendimento.attendance_client_links',
        'crm_atendimento.attendances',
        'crm_atendimento.units',
    ])
    assert.deepEqual(ATENDIMENTO_PROJECTION_MEMBERSHIP_SOURCE_RELATIONS, plan.sourceRelationAllowlist)
    assert.deepEqual(CRM_CORE_PROJECTION_DELTA_PREREQUISITE_RELATIONS, [
        'crm_atendimento.global_client_identities',
        ...plan.sourceRelationAllowlist,
    ])
    assert.deepEqual(plan.relations, [
        'crm_atendimento.crm_core_projection_memberships',
        'crm_atendimento.crm_core_projection_outbox',
        'crm_atendimento.crm_core_projection_delta_handoffs',
    ])
    assert.match(plan.eventPolicy, /upsert\/revoke/)
    assert.match(plan.reconciliation, /pg_advisory_xact_lock/)
    assert.match(plan.baselineHandoff, /identity-key fingerprint/)
    assert.match(plan.baselineHandoff, /packet custody/)
    assert.match(plan.rollback, /non-destructive/)
})

test('uses only Atendimento-owned immutable lifecycle evidence without importer or identity-materializer refresh revisions', () => {
    for (const mutableTimestamp of ['member.updated_at', 'attendance_link.updated_at', 'attendance.updated_at']) {
        assert.doesNotMatch(ATENDIMENTO_PROJECTION_MEMBERSHIP_SOURCE_SQL, new RegExp(mutableTimestamp.replace('.', '\\.')))
    }
    for (const evidenceTimestamp of ['attendance_link.created_at', 'attendance.created_at']) {
        assert.match(ATENDIMENTO_PROJECTION_MEMBERSHIP_SOURCE_SQL, new RegExp(evidenceTimestamp.replace('.', '\\.')))
    }
    assert.doesNotMatch(ATENDIMENTO_PROJECTION_MEMBERSHIP_SOURCE_SQL, /(?:app_client_registrations|supplemental_lead_profiles|app_registration|lead_profile)/i)
    assert.doesNotMatch(ATENDIMENTO_PROJECTION_MEMBERSHIP_SOURCE_SQL, /\b(?:crm_caixa|caixa_customer|sale)\b/i)
})

test('keeps the historical v1 SQL companion pinned to its legacy identity graph', async () => {
    const sqlPath = fileURLToPath(new URL('../migrations/20260908_crm_core_projection_delta_v1.up.sql', import.meta.url))
    const sql = await readFile(sqlPath, 'utf8')
    assert.equal((sql.match(/references crm_atendimento\.global_client_identities\(id\)/ig) || []).length, 2)
    assert.doesNotMatch(sql, /references crm_atendimento\.crm_core_identities\(id\)/i)
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
    assert.ok(calls.some(({ sql }) => /identity_key_fingerprint text not null/i.test(sql) && /baseline_packets_json jsonb not null/i.test(sql)))
    assert.ok(calls.some(({ sql }) => /alter table crm_atendimento\.crm_core_projection_delta_handoffs[\s\S]*add column if not exists baseline_packets_json/i.test(sql)))
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
        source: BASELINE_SOURCE_DESCRIPTOR,
        backfillHmacKey: BASELINE_HMAC_KEY,
    })
    assert.equal(report.baseline.state, 'baseline-prepared')
    assert.equal(report.seededMemberships, 2)
    assert.equal(report.atomic, true)
    assert.equal(released, true)
    assert.equal(report.baseline.backfill.eventCount, BASELINE_ROWS.length)
    assert.equal(report.baseline.backfill.batches.length, 1)
    assert.deepEqual(report.batches.map((batch) => batch.batchId), report.baseline.backfill.batches.map((batch) => batch.batchId))
    assert.match(report.baseline.source.identityKeyFingerprint, /^sha256:[a-f0-9]{64}$/)
    assert.equal(JSON.stringify(report.baseline).includes(BASELINE_ROWS[0].identity_id), false)
    assert.equal(JSON.stringify(report).includes(BASELINE_HMAC_KEY), false)
    assert.ok(calls.some(({ sql }) => /canonical_delta_source[\s\S]*order by observed_at asc, identity_id asc, unit_slug asc/i.test(sql)))
    assert.ok(calls.findIndex(({ sql }) => /canonical_delta_source/i.test(sql)) < calls.findIndex(({ sql }) => /insert into crm_atendimento\.crm_core_projection_memberships/i.test(sql)))
    assert.equal(calls.filter(({ sql }) => /insert into crm_atendimento\.crm_core_projection_memberships/i.test(sql)).length, 2)
    assert.equal(calls.some(({ sql }) => /insert into crm_atendimento\.crm_core_projection_outbox/i.test(sql)), false)
    const handoffInsert = calls.find(({ sql }) => /insert into crm_atendimento\.crm_core_projection_delta_handoffs/i.test(sql))
    assert.equal(handoffInsert.params[14], report.baseline.source.identityKeyFingerprint)
    assert.deepEqual(JSON.parse(handoffInsert.params[15]), report.baseline.source.unitAllowlist)
    assert.deepEqual(JSON.parse(handoffInsert.params[20]), report.batches)
    assert.ok(calls.some(({ sql }) => /^commit$/i.test(sql)))
})

test('derives the backfill from an explicit production source while the CRM Core target remains staging-only', async () => {
    const calls = []
    let ownerRoleActive = false
    let released = false
    const client = {
        async query(sql, params = []) {
            calls.push({ sql, params })
            if (/set role skincos_clientes_owner/i.test(sql)) {
                ownerRoleActive = true
                return { rows: [] }
            }
            if (/current_database\(\)/i.test(sql)) {
                return { rows: [{
                    database_name: 'skincos_clientes_production',
                    database_user: ownerRoleActive ? 'skincos_clientes_owner' : 'skincos_clientes_migrator_login',
                    session_user: 'skincos_clientes_migrator_login',
                    read_only: 'off',
                }] }
            }
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
        databaseUrl: PRODUCTION_SOURCE_URL,
        target: 'production',
        targetDescriptor: BASELINE_TARGET,
        source: BASELINE_SOURCE_DESCRIPTOR,
        backfillHmacKey: BASELINE_HMAC_KEY,
    })
    assert.equal(report.baseline.target.environment, 'staging')
    assert.equal(report.baseline.backfill.eventCount, BASELINE_ROWS.length)
    assert.equal(ownerRoleActive, true)
    assert.equal(released, true)

    let connected = false
    await assert.rejects(() => prepareAtendimentoProjectionDeltaBaseline({
        pool: { connect: async () => { connected = true } },
        databaseUrl: PRODUCTION_SOURCE_URL,
        target: 'production',
        targetDescriptor: { ...BASELINE_TARGET, environment: 'production' },
        source: BASELINE_SOURCE_DESCRIPTOR,
        backfillHmacKey: BASELINE_HMAC_KEY,
    }), /BASELINE_STAGING_ONLY/)
    assert.equal(connected, false)
})

test('persists and returns the exact prepared packets through the custody read without re-derivation', async () => {
    const calls = []
    const client = {
        async query(sql, params = []) {
            calls.push({ sql, params })
            if (/current_database\(\)/i.test(sql)) return { rows: [{ database_name: 'skincos_crm_local', database_user: 'admin', session_user: 'admin', read_only: 'off' }] }
            if (/from crm_atendimento\.crm_core_projection_delta_handoffs/i.test(sql)) return { rows: [storedHandoff({ baseline: BASELINE_PREPARED })] }
            return { rows: [], rowCount: 0 }
        },
        release() {},
    }
    const custody = await loadAtendimentoProjectionDeltaBaselineCustody({
        pool: { connect: async () => client },
        databaseUrl: LOCAL_SOCKET_URL,
        target: 'local',
    })
    assert.equal(custody.custody.durable, true)
    assert.equal(custody.custody.state, 'baseline-prepared')
    assert.deepEqual(custody.baseline, BASELINE_PREPARED)
    assert.deepEqual(custody.batches, [BASELINE_REAL_BATCH])
    assert.equal(Object.isFrozen(custody.batches), true)
    assert.equal(Object.isFrozen(custody.batches[0].events[0]), true)
    assert.equal(JSON.stringify(custody).includes(BASELINE_HMAC_KEY), false)
    assert.equal(calls.some(({ sql }) => /canonical_delta_source/i.test(sql)), false)
    assert.ok(calls.some(({ sql }) => /from crm_atendimento\.crm_core_projection_delta_handoffs[\s\S]*for update/i.test(sql)))
})

test('fails closed when persisted custody loses its identity-key pin or exact packet digest', async () => {
    const tamperedBatch = JSON.parse(JSON.stringify(BASELINE_REAL_BATCH))
    tamperedBatch.events[0].id = 'event:baseline-migration-tampered'
    for (const handoff of [
        storedHandoff({ baseline: BASELINE_PREPARED, identity_key_fingerprint: `sha256:${'f'.repeat(64)}` }),
        storedHandoff({ baseline: BASELINE_PREPARED, batches: [tamperedBatch] }),
    ]) {
        let sourceRead = false
        const client = {
            async query(sql) {
                if (/current_database\(\)/i.test(sql)) return { rows: [{ database_name: 'skincos_crm_local', database_user: 'admin', session_user: 'admin', read_only: 'off' }] }
                if (/canonical_delta_source/i.test(sql)) sourceRead = true
                if (/from crm_atendimento\.crm_core_projection_delta_handoffs/i.test(sql)) return { rows: [handoff] }
                return { rows: [], rowCount: 0 }
            },
            release() {},
        }
        await assert.rejects(
            () => loadAtendimentoProjectionDeltaBaselineCustody({ pool: { connect: async () => client }, databaseUrl: LOCAL_SOCKET_URL, target: 'local' }),
            /BASELINE_STATE_CONFLICT/,
        )
        assert.equal(sourceRead, false)
    }
})

test('allows a zero-row initial snapshot only when a future unit allowlist is explicitly pinned', async () => {
    const calls = []
    const client = {
        async query(sql, params = []) {
            calls.push({ sql, params })
            if (/current_database\(\)/i.test(sql)) return { rows: [{ database_name: 'skincos_crm_local', database_user: 'admin', session_user: 'admin', read_only: 'off' }] }
            if (/from crm_atendimento\.crm_core_projection_delta_handoffs/i.test(sql)) return { rows: [] }
            if (/from crm_atendimento\.crm_core_projection_memberships/i.test(sql)) return { rows: [] }
            if (/max\(event_order\)/i.test(sql)) return { rows: [{ watermark: 0 }] }
            if (/canonical_delta_source/i.test(sql)) return { rows: [] }
            if (/transaction_timestamp\(\)/i.test(sql)) return { rows: [{ captured_at: BASELINE_SNAPSHOT.snapshot.capturedAt }] }
            return { rows: [], rowCount: 0 }
        },
        release() {},
    }
    const report = await prepareAtendimentoProjectionDeltaBaseline({
        pool: { connect: async () => client },
        databaseUrl: LOCAL_SOCKET_URL,
        target: 'local',
        targetDescriptor: BASELINE_TARGET,
        source: { ...BASELINE_SOURCE_DESCRIPTOR, unitAllowlist: ['jardins'] },
        backfillHmacKey: BASELINE_HMAC_KEY,
    })
    assert.equal(report.seededMemberships, 0)
    assert.equal(report.baseline.snapshot.rowCount, 0)
    assert.deepEqual(report.baseline.snapshot.unitSlugs, [])
    assert.deepEqual(report.baseline.source.unitAllowlist, ['jardins'])
    assert.deepEqual(report.batches, [])
    assert.equal(calls.some(({ sql }) => /insert into crm_atendimento\.crm_core_projection_memberships/i.test(sql)), false)
    const handoffInsert = calls.find(({ sql }) => /insert into crm_atendimento\.crm_core_projection_delta_handoffs/i.test(sql))
    assert.deepEqual(JSON.parse(handoffInsert.params[20]), [])
})

test('does not accept an injected backfill factory in place of a producer HMAC key', async () => {
    let connected = false
    await assert.rejects(() => prepareAtendimentoProjectionDeltaBaseline({
        pool: { connect: async () => { connected = true } },
        databaseUrl: LOCAL_SOCKET_URL,
        targetDescriptor: BASELINE_TARGET,
        source: BASELINE_SOURCE_DESCRIPTOR,
        backfillFactory: () => ({ backfill: BASELINE_BACKFILL, batches: [BASELINE_REAL_BATCH] }),
    }), /BASELINE_INPUT_REQUIRED/)
    assert.equal(connected, false)
})

test('derives deterministic bounded opaque pages directly from every captured membership row', () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({
        identityId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        unitSlug: index % 2 ? 'pinheiros' : 'jardins',
        observedAt: `2026-09-08T12:00:${String(index % 60).padStart(2, '0')}.000Z`,
    }))
    const { snapshot } = createAtendimentoProjectionDeltaBaselineSnapshot({ rows, capturedAt: '2026-09-08T12:05:00.000Z', watermark: 0 })
    const first = migrationTestables.deriveAtendimentoProjectionDeltaBaselineBackfill({
        rows,
        snapshot,
        source: BASELINE_SOURCE,
        target: BASELINE_TARGET,
        backfillHmacKey: BASELINE_HMAC_KEY,
    })
    const replay = migrationTestables.deriveAtendimentoProjectionDeltaBaselineBackfill({
        rows: [...rows].reverse(),
        snapshot,
        source: BASELINE_SOURCE,
        target: BASELINE_TARGET,
        backfillHmacKey: BASELINE_HMAC_KEY,
    })
    assert.deepEqual(first.backfill, replay.backfill)
    assert.deepEqual(first.backfill.batches.map((batch) => batch.eventCount), [20, 1])
    assert.equal(first.backfill.eventCount, rows.length)
    assert.equal(JSON.stringify(first.batches).includes(rows[0].identityId), false)
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
    assert.throws(() => migrationTestables.assertDerivedBackfillBatches({ batches: [first, second], manifest, source: BASELINE_SOURCE, snapshot: { ...BASELINE_SNAPSHOT.snapshot, rowCount: 2, unitSlugs: ['jardins'] }, target: BASELINE_TARGET }), /DUPLICATE|DERIVATION_FAILED/)
})

test('recomputes each page events digest before allowing the baseline seed', () => {
    const tampered = {
        ...BASELINE_REAL_BATCH,
        integrity: { ...BASELINE_REAL_BATCH.integrity, eventsDigest: `sha256:${'f'.repeat(64)}` },
    }
    const manifest = createAtendimentoProjectionDeltaBaselineBackfill({
        batches: [{
            batchId: tampered.batchId,
            batchDigest: migrationTestables.digestOpaqueBackfillBatch(tampered),
            capturedAt: tampered.sourceSnapshot.capturedAt,
            cursorDigest: tampered.sourceSnapshot.cursorDigest,
            fromOrdinal: 1,
            toOrdinal: tampered.events.length,
            rowCount: tampered.events.length,
            unitSlugs: tampered.sourceSnapshot.unitSlugs,
            eventCount: tampered.events.length,
        }],
        rowCount: tampered.events.length,
    })
    assert.throws(() => migrationTestables.assertDerivedBackfillBatches({
        batches: [tampered], manifest, source: BASELINE_SOURCE, snapshot: BASELINE_SNAPSHOT.snapshot, target: BASELINE_TARGET,
    }), /DERIVATION_FAILED/)
})

test('requires the page unit union to equal the event unit union', () => {
    const extraUnit = {
        ...BASELINE_EVENTS[0],
        id: 'event:baseline-migration-extra',
        projection: { reference: 'projection:baseline-migration-extra', kind: 'client-reference' },
        unitScope: { unitSlug: 'moema' },
    }
    const tampered = {
        ...BASELINE_REAL_BATCH,
        events: [extraUnit, BASELINE_EVENTS[1]],
        integrity: { ...BASELINE_REAL_BATCH.integrity, eventsDigest: migrationTestables.digestOpaqueBackfillEvents([extraUnit, BASELINE_EVENTS[1]]) },
    }
    const manifest = createAtendimentoProjectionDeltaBaselineBackfill({
        batches: [{
            batchId: tampered.batchId,
            batchDigest: migrationTestables.digestOpaqueBackfillBatch(tampered),
            capturedAt: tampered.sourceSnapshot.capturedAt,
            cursorDigest: tampered.sourceSnapshot.cursorDigest,
            fromOrdinal: 1,
            toOrdinal: tampered.events.length,
            rowCount: tampered.events.length,
            unitSlugs: tampered.sourceSnapshot.unitSlugs,
            eventCount: tampered.events.length,
        }],
        rowCount: tampered.events.length,
    })
    assert.throws(() => migrationTestables.assertDerivedBackfillBatches({
        batches: [tampered], manifest, source: BASELINE_SOURCE, snapshot: BASELINE_SNAPSHOT.snapshot, target: BASELINE_TARGET,
    }), /DUPLICATE|DERIVATION_FAILED/)
})

test('fails closed when a delta-ready handoff has no durable baseline document', async () => {
    for (const missingBaseline of [undefined, null]) {
        const calls = []
        const client = {
            async query(sql) {
                calls.push(sql)
                if (/current_database\(\)/i.test(sql)) return { rows: [{ database_name: 'skincos_crm_local', database_user: 'admin', session_user: 'admin', read_only: 'off' }] }
                if (/from crm_atendimento\.crm_core_projection_delta_handoffs/i.test(sql)) return { rows: [{ state: 'delta-ready', handoff_key: 'initial', baseline_json: missingBaseline }] }
                return { rows: [] }
            },
            release() {},
        }
        await assert.rejects(() => reconcileAtendimentoProjectionDelta({ pool: { connect: async () => client }, databaseUrl: LOCAL_SOCKET_URL }), /BASELINE_STATE_CONFLICT/)
        assert.equal(calls.some((sql) => /canonical_delta_source/i.test(sql)), false)
    }
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
            if (/from crm_atendimento\.crm_core_projection_delta_handoffs/i.test(sql)) return { rows: [storedHandoff()] }
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
