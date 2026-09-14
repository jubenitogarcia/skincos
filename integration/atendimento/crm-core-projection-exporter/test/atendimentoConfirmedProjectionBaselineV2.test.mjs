import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_READBACK_CONTRACT,
  ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_RECEIPT_CONTRACT,
  acceptAtendimentoConfirmedProjectionBaselineV2,
  createAtendimentoConfirmedProjectionBaselineV2Backfill,
  createAtendimentoConfirmedProjectionBaselineV2Batch,
  createAtendimentoConfirmedProjectionBaselineV2Prepared,
  createAtendimentoConfirmedProjectionBaselineV2Snapshot,
  createAtendimentoConfirmedProjectionBaselineV2Source,
  digestAtendimentoConfirmedProjectionBaselineV2Batch,
  markAtendimentoConfirmedProjectionBaselineV2Ready,
} from '../../../../shared/crm-auth/atendimentoConfirmedProjectionBaselineV2.js'
import {
  createAtendimentoConfirmedProjectionDeltaV2Batch,
  digestAtendimentoConfirmedProjectionDeltaV2SourceProfile,
} from '../../../../shared/crm-auth/atendimentoConfirmedProjectionDeltaV2.js'

const HMAC_KEY = `confirmed-projection-baseline-v2-test-${'x'.repeat(40)}`
const TARGET = Object.freeze({ environment: 'staging', release: 'a'.repeat(40), artifactDigest: `sha256:${'b'.repeat(64)}` })
const ROW = Object.freeze({
  identity_id: '22222222-2222-4222-8222-222222222222',
  unit_slug: 'jardins',
  observed_at: '2026-09-14T12:00:00.000000Z',
})

test('forms a v5-only baseline whose opaque references match the following delta stream', () => {
  const source = createAtendimentoConfirmedProjectionBaselineV2Source({
    owner: 'atendimento',
    scope: 'confirmed-unit-memberships/v5',
    baselineKeyId: 'crm-staging-atendimento-confirmed-baseline-v2-1',
    deltaKeyId: 'crm-staging-atendimento-confirmed-delta-v2-1',
    identityHmacKey: HMAC_KEY,
    unitAllowlist: ['jardins'],
  })
  const { snapshot } = createAtendimentoConfirmedProjectionBaselineV2Snapshot({
    rows: [ROW],
    capturedAt: '2026-09-14T12:01:00.000Z',
    watermark: 0,
  })
  const packet = createAtendimentoConfirmedProjectionBaselineV2Batch({
    rows: [ROW],
    capturedAt: snapshot.capturedAt,
    hmacKey: HMAC_KEY,
    keyId: source.baselineKeyId,
    target: TARGET,
  })
  const backfill = createAtendimentoConfirmedProjectionBaselineV2Backfill({
    batches: [{
      batchId: packet.batchId,
      batchDigest: digestAtendimentoConfirmedProjectionBaselineV2Batch(packet),
      capturedAt: packet.sourceSnapshot.capturedAt,
      cursorDigest: packet.sourceSnapshot.cursorDigest,
      fromOrdinal: 1,
      toOrdinal: 1,
      rowCount: 1,
      unitSlugs: packet.sourceSnapshot.unitSlugs,
      eventCount: 1,
    }],
    rowCount: 1,
    unitSlugs: ['jardins'],
  })
  const prepared = createAtendimentoConfirmedProjectionBaselineV2Prepared({ target: TARGET, source, snapshot, backfill })
  const delta = createAtendimentoConfirmedProjectionDeltaV2Batch({
    rows: [{
      event_order: 1,
      event_id: '11111111-1111-4111-8111-111111111111',
      identity_id: ROW.identity_id,
      unit_slug: ROW.unit_slug,
      revision: 2,
      operation: 'upsert',
      occurred_at: ROW.observed_at,
    }],
    fromExclusive: 0,
    toInclusive: 1,
    hmacKey: HMAC_KEY,
    keyId: source.deltaKeyId,
    target: TARGET,
  })
  assert.equal(packet.producer.scope, 'confirmed-unit-memberships/v5')
  assert.equal(packet.sourceProfile.digest, digestAtendimentoConfirmedProjectionDeltaV2SourceProfile())
  assert.equal(packet.events[0].source.reference, delta.events[0].source.reference)
  assert.equal(packet.events[0].projection.reference, delta.events[0].projection.reference)
  assert.equal(JSON.stringify({ prepared, packet }).includes(ROW.identity_id), false)
  assert.doesNotMatch(JSON.stringify({ prepared, packet }), /global-client|crm_caixa|registration|supplemental_lead/i)
})

test('requires exact profile, baseline receipts, and source watermark readback before delta-ready', () => {
  const source = createAtendimentoConfirmedProjectionBaselineV2Source({
    owner: 'atendimento',
    scope: 'confirmed-unit-memberships/v5',
    baselineKeyId: 'crm-staging-atendimento-confirmed-baseline-v2-1',
    deltaKeyId: 'crm-staging-atendimento-confirmed-delta-v2-1',
    identityHmacKey: HMAC_KEY,
    unitAllowlist: ['jardins'],
  })
  const { snapshot } = createAtendimentoConfirmedProjectionBaselineV2Snapshot({ rows: [ROW], capturedAt: '2026-09-14T12:01:00.000Z', watermark: 7 })
  const packet = createAtendimentoConfirmedProjectionBaselineV2Batch({ rows: [ROW], capturedAt: snapshot.capturedAt, hmacKey: HMAC_KEY, keyId: source.baselineKeyId, target: TARGET })
  const backfill = createAtendimentoConfirmedProjectionBaselineV2Backfill({
    batches: [{ batchId: packet.batchId, batchDigest: digestAtendimentoConfirmedProjectionBaselineV2Batch(packet), capturedAt: packet.sourceSnapshot.capturedAt, cursorDigest: packet.sourceSnapshot.cursorDigest, fromOrdinal: 1, toOrdinal: 1, rowCount: 1, unitSlugs: packet.sourceSnapshot.unitSlugs, eventCount: 1 }],
    rowCount: 1,
    unitSlugs: ['jardins'],
  })
  const prepared = createAtendimentoConfirmedProjectionBaselineV2Prepared({ target: TARGET, source, snapshot, backfill })
  const accepted = acceptAtendimentoConfirmedProjectionBaselineV2(prepared, [{
    contractVersion: ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_RECEIPT_CONTRACT,
    status: 'accepted',
    batchId: packet.batchId,
    eventCount: 1,
    sourceProfileDigest: digestAtendimentoConfirmedProjectionDeltaV2SourceProfile(),
    target: TARGET,
  }])
  const readback = {
    contract: ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_READBACK_CONTRACT,
    status: 'verified',
    manifestDigest: accepted.backfill.manifestDigest,
    membershipDigest: accepted.snapshot.membershipDigest,
    watermark: 7,
    verifiedBatchCount: 1,
    verifiedEventCount: 1,
    sourceProfileDigest: digestAtendimentoConfirmedProjectionDeltaV2SourceProfile(),
    target: TARGET,
  }
  assert.equal(markAtendimentoConfirmedProjectionBaselineV2Ready(accepted, readback).state, 'delta-ready')
  assert.throws(() => markAtendimentoConfirmedProjectionBaselineV2Ready(accepted, { ...readback, watermark: 8 }), /BASELINE_V2_INVALID/)
})
