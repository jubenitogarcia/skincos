import assert from 'node:assert/strict'
import test from 'node:test'

import {
    CRM_CORE_PROJECTION_DELTA_BASELINE_READBACK_CONTRACT,
    CRM_CORE_PROJECTION_DELTA_BASELINE_STATES,
    acceptAtendimentoProjectionDeltaBaseline,
    assertAtendimentoProjectionDeltaBaseline,
    createAtendimentoProjectionDeltaBaselinePrepared,
    createAtendimentoProjectionDeltaBaselineSeed,
    markAtendimentoProjectionDeltaReady,
} from '../crmCoreProjectionDeltaBaseline.js'

const TARGET = Object.freeze({ environment: 'staging', release: 'a'.repeat(40), artifactDigest: `sha256:${'b'.repeat(64)}` })
const ROWS = [
    { identity_id: '11111111-1111-4111-8111-111111111111', unit_slug: 'jardins', observed_at: '2026-09-08T12:00:00.000Z' },
    { identity_id: '22222222-2222-4222-8222-222222222222', unit_slug: 'pinheiros', observed_at: '2026-09-08T12:00:00.000Z' },
]
const SEED = createAtendimentoProjectionDeltaBaselineSeed({ rows: ROWS, capturedAt: '2026-09-08T12:05:00.000Z' })
const BACKFILL = Object.freeze({
    batchId: 'backfill:atendimento:baseline-test-1',
    batchDigest: `sha256:${'c'.repeat(64)}`,
    capturedAt: SEED.capturedAt,
    cursorDigest: `sha256:${'d'.repeat(64)}`,
    rowCount: SEED.rowCount,
    unitSlugs: SEED.unitSlugs,
    eventCount: SEED.rowCount,
})
const SOURCE = Object.freeze({
    owner: 'atendimento',
    scope: 'global-client-identities/v1',
    backfillKeyId: 'atendimento-projection-key-v2',
    deltaKeyId: 'crm-staging-atendimento-delta-v1',
})
const SNAPSHOT = Object.freeze({
    capturedAt: SEED.capturedAt,
    cursorDigest: BACKFILL.cursorDigest,
    rowCount: SEED.rowCount,
    unitSlugs: SEED.unitSlugs,
    watermark: 0,
})

function prepared() {
    return createAtendimentoProjectionDeltaBaselinePrepared({ target: TARGET, source: SOURCE, snapshot: SNAPSHOT, backfill: BACKFILL, seed: SEED })
}

function receipt() {
    return {
        contractVersion: 'crm-core/projection-backfill-receipt/v2',
        status: 'accepted',
        batchId: BACKFILL.batchId,
        batchDigest: BACKFILL.batchDigest,
        eventCount: BACKFILL.eventCount,
        target: TARGET,
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
        contract: CRM_CORE_PROJECTION_DELTA_BASELINE_READBACK_CONTRACT,
        status: 'verified',
        batchId: BACKFILL.batchId,
        batchDigest: BACKFILL.batchDigest,
        membershipDigest: SEED.membershipDigest,
        watermark: SNAPSHOT.watermark,
        target: TARGET,
    })
    assert.equal(ready.state, CRM_CORE_PROJECTION_DELTA_BASELINE_STATES.READY)
    assert.equal(assertAtendimentoProjectionDeltaBaseline(ready).readback.status, 'verified')
})

test('keeps the state machine closed for forged receipt, readback, and transition order', () => {
    assert.throws(() => acceptAtendimentoProjectionDeltaBaseline(prepared(), { ...receipt(), batchDigest: `sha256:${'e'.repeat(64)}` }), /RECEIPT_INVALID|RELATIONSHIP_INVALID/)
    const accepted = acceptAtendimentoProjectionDeltaBaseline(prepared(), receipt())
    assert.throws(() => assertAtendimentoProjectionDeltaBaseline({ ...accepted, state: CRM_CORE_PROJECTION_DELTA_BASELINE_STATES.READY, readback: null }), /STATE_INVALID/)
    assert.throws(() => markAtendimentoProjectionDeltaReady({ ...accepted, target: { ...TARGET, release: 'f'.repeat(40) } }, {}), /RELATIONSHIP_INVALID|READBACK_INVALID/)
})
