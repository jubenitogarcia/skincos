import assert from 'node:assert/strict'
import test from 'node:test'

import {
    CRM_CORE_PROJECTION_DELTA_BASELINE_READBACK_CONTRACT,
    CRM_CORE_PROJECTION_DELTA_BASELINE_STATES,
    acceptAtendimentoProjectionDeltaBaseline,
    assertAtendimentoProjectionDeltaBaseline,
    createAtendimentoProjectionDeltaBaselineBackfill,
    createAtendimentoProjectionDeltaBaselinePrepared,
    createAtendimentoProjectionDeltaBaselineSeed,
    createAtendimentoProjectionDeltaBaselineSnapshot,
    markAtendimentoProjectionDeltaReady,
    __testables as baselineTestables,
} from '../crmCoreProjectionDeltaBaseline.js'

const TARGET = Object.freeze({ environment: 'staging', release: 'a'.repeat(40), artifactDigest: `sha256:${'b'.repeat(64)}` })
const ROWS = [
    { identity_id: '11111111-1111-4111-8111-111111111111', unit_slug: 'jardins', observed_at: '2026-09-08T12:00:00.000Z' },
    { identity_id: '22222222-2222-4222-8222-222222222222', unit_slug: 'pinheiros', observed_at: '2026-09-08T12:00:00.000Z' },
]
const SEED = createAtendimentoProjectionDeltaBaselineSeed({ rows: ROWS, capturedAt: '2026-09-08T12:05:00.000Z' })
const BACKFILL = createAtendimentoProjectionDeltaBaselineBackfill({
    batches: [{
        batchId: 'backfill:atendimento:baseline-test-1',
        batchDigest: `sha256:${'c'.repeat(64)}`,
        capturedAt: SEED.capturedAt,
        cursorDigest: `sha256:${'d'.repeat(64)}`,
        fromOrdinal: 1,
        toOrdinal: SEED.rowCount,
        rowCount: SEED.rowCount,
        unitSlugs: SEED.unitSlugs,
        eventCount: SEED.rowCount,
    }],
    rowCount: SEED.rowCount,
})
const SOURCE = Object.freeze({
    owner: 'atendimento',
    scope: 'global-client-identities/v1',
    backfillKeyId: 'atendimento-projection-key-v2',
    deltaKeyId: 'crm-staging-atendimento-delta-v1',
})
const SNAPSHOT = Object.freeze({
    capturedAt: SEED.capturedAt,
    cursorDigest: BACKFILL.batches[0].cursorDigest,
    rowCount: SEED.rowCount,
    unitSlugs: SEED.unitSlugs,
    watermark: 0,
})

function prepared() {
    return createAtendimentoProjectionDeltaBaselinePrepared({ target: TARGET, source: SOURCE, snapshot: SNAPSHOT, backfill: BACKFILL, seed: SEED })
}

function receipt() {
    return [{
        contractVersion: 'crm-core/projection-backfill-receipt/v2',
        status: 'accepted',
        batchId: BACKFILL.batches[0].batchId,
        eventCount: BACKFILL.batches[0].eventCount,
        target: TARGET,
    }]
}

function proofFor(batch, receiptEntry) {
    const proof = {
        contract: 'crm-core/projection-baseline-batch-readback/v1',
        status: 'batch-ledger-readback-verified',
        pins: {
            producer: { owner: SOURCE.owner, scope: SOURCE.scope, keyId: SOURCE.backfillKeyId },
            target: TARGET,
            unitSlugs: batch.unitSlugs,
        },
        counts: { events: batch.eventCount, sources: batch.eventCount, units: batch.unitSlugs.length },
        digests: {
            batch: batch.batchDigest,
            events: `sha256:${'e'.repeat(64)}`,
            cursor: batch.cursorDigest,
            receipt: baselineTestables.digest(receiptEntry),
            ledger: `sha256:${'f'.repeat(64)}`,
            sources: `sha256:${'a'.repeat(64)}`,
        },
    }
    return { ...proof, digests: { ...proof.digests, readback: baselineTestables.digest(proof) } }
}

function readbackFor(batch, receiptEntry, seed = SEED, snapshot = SNAPSHOT) {
    const proofs = [proofFor(batch, receiptEntry)]
    return {
        contract: CRM_CORE_PROJECTION_DELTA_BASELINE_READBACK_CONTRACT,
        status: 'verified',
        manifestDigest: BACKFILL.manifestDigest,
        membershipDigest: seed.membershipDigest,
        watermark: snapshot.watermark,
        verifiedBatchCount: 1,
        verifiedEventCount: batch.eventCount,
        ledgerProofDigest: baselineTestables.digest(proofs.map((entry) => ({ batchDigest: entry.digests.batch, readbackDigest: entry.digests.readback }))),
        proofs,
        target: TARGET,
    }
}

function manifestBatch({ batchId, fromOrdinal, toOrdinal, capturedAt = SEED.capturedAt, unitSlugs = ['jardins'] }) {
    const rowCount = toOrdinal - fromOrdinal + 1
    return {
        batchId,
        batchDigest: `sha256:${String(fromOrdinal).repeat(64).slice(0, 64)}`,
        capturedAt,
        cursorDigest: `sha256:${String(toOrdinal).repeat(64).slice(0, 64)}`,
        fromOrdinal,
        toOrdinal,
        rowCount,
        unitSlugs,
        eventCount: rowCount,
    }
}

test('prepares an opaque baseline bound to the exact backfill snapshot and explicit watermark', () => {
    const baseline = prepared()
    assert.equal(baseline.state, CRM_CORE_PROJECTION_DELTA_BASELINE_STATES.PREPARED)
    assert.equal(baseline.snapshot.watermark, 0)
    assert.equal(baseline.seed.membershipDigest, SEED.membershipDigest)
    assert.doesNotMatch(JSON.stringify(baseline), /11111111|22222222|identity_id|observed_at/i)
})

test('rejects a baseline when backfill and seed snapshots diverge', () => {
    assert.throws(() => createAtendimentoProjectionDeltaBaselinePrepared({
        target: TARGET,
        source: SOURCE,
        snapshot: { ...SNAPSHOT, rowCount: 1 },
        backfill: BACKFILL,
        seed: SEED,
    }), /RELATIONSHIP_INVALID/)
})

test('requires an accepted Core receipt before delta-ready can be issued', () => {
    const accepted = acceptAtendimentoProjectionDeltaBaseline(prepared(), receipt())
    assert.equal(accepted.state, CRM_CORE_PROJECTION_DELTA_BASELINE_STATES.ACCEPTED)
    assert.throws(() => markAtendimentoProjectionDeltaReady(prepared(), {}), /TRANSITION_INVALID/)
    const ready = markAtendimentoProjectionDeltaReady(accepted, {
        ...readbackFor(BACKFILL.batches[0], receipt()[0]),
    })
    assert.equal(ready.state, CRM_CORE_PROJECTION_DELTA_BASELINE_STATES.READY)
    assert.equal(assertAtendimentoProjectionDeltaBaseline(ready).readback.status, 'verified')
})

test('keeps the state machine closed for forged receipt, readback, and transition order', () => {
    assert.throws(() => acceptAtendimentoProjectionDeltaBaseline(prepared(), [{ ...receipt()[0], batchId: 'backfill:atendimento:other-batch' }]), /RECEIPT_INVALID|RELATIONSHIP_INVALID/)
    const accepted = acceptAtendimentoProjectionDeltaBaseline(prepared(), receipt())
    assert.throws(() => assertAtendimentoProjectionDeltaBaseline({ ...accepted, state: CRM_CORE_PROJECTION_DELTA_BASELINE_STATES.READY, readback: null }), /STATE_INVALID/)
    assert.throws(() => markAtendimentoProjectionDeltaReady({ ...accepted, target: { ...TARGET, release: 'f'.repeat(40) } }, {}), /RELATIONSHIP_INVALID|READBACK_INVALID/)
    const validReadback = readbackFor(BACKFILL.batches[0], receipt()[0])
    assert.throws(() => markAtendimentoProjectionDeltaReady(accepted, { ...validReadback, ledgerProofDigest: `sha256:${'0'.repeat(64)}` }), /READBACK_INVALID/)
    assert.throws(() => markAtendimentoProjectionDeltaReady(accepted, { ...validReadback, proofs: [{ ...validReadback.proofs[0], digests: { ...validReadback.proofs[0].digests, readback: `sha256:${'0'.repeat(64)}` } }] }), /READBACK_INVALID/)
})

test('requires contiguous paginated coverage and every Core receipt', () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({
        identity_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        unit_slug: 'jardins',
        observed_at: SEED.capturedAt,
    }))
    const snapshot = createAtendimentoProjectionDeltaBaselineSnapshot({ rows, capturedAt: SEED.capturedAt, watermark: 0 })
    const first = manifestBatch({ batchId: 'backfill:atendimento:manifest-first', fromOrdinal: 1, toOrdinal: 20 })
    const second = manifestBatch({ batchId: 'backfill:atendimento:manifest-second', fromOrdinal: 21, toOrdinal: 21 })
    const backfill = createAtendimentoProjectionDeltaBaselineBackfill({ batches: [first, second], rowCount: 21 })
    const baseline = createAtendimentoProjectionDeltaBaselinePrepared({
        target: TARGET,
        source: SOURCE,
        snapshot: snapshot.snapshot,
        backfill,
        seed: snapshot.seed,
    })
    assert.equal(backfill.batches.length, 2)
    assert.equal(backfill.eventCount, 21)
    assert.throws(() => acceptAtendimentoProjectionDeltaBaseline(baseline, [{
        contractVersion: 'crm-core/projection-backfill-receipt/v2',
        status: 'accepted',
        batchId: first.batchId,
        eventCount: first.eventCount,
        target: TARGET,
    }]), /RECEIPT_INVALID|RELATIONSHIP_INVALID/)
    assert.throws(() => createAtendimentoProjectionDeltaBaselineBackfill({
        batches: [first, manifestBatch({ batchId: 'backfill:atendimento:manifest-gap', fromOrdinal: 22, toOrdinal: 22 })],
        rowCount: 21,
    }), /BACKFILL_INVALID/)
    assert.throws(() => createAtendimentoProjectionDeltaBaselineBackfill({
        batches: [first, { ...first, fromOrdinal: 21, toOrdinal: 21, rowCount: 1, eventCount: 1 }],
        rowCount: 21,
    }), /BACKFILL_INVALID/)
})
