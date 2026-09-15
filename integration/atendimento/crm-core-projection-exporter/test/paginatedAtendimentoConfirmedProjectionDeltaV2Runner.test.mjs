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
import { digestAtendimentoConfirmedProjectionDeltaV2Batch, digestAtendimentoConfirmedProjectionDeltaV2SourceProfile } from '../../../../shared/crm-auth/atendimentoConfirmedProjectionDeltaV2.js'
import {
  ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_RUN_INTENT,
  createPaginatedAtendimentoConfirmedProjectionDeltaV2Runner,
} from '../src/paginatedAtendimentoConfirmedProjectionDeltaV2Runner.mjs'

const HMAC_KEY = `confirmed-projection-runner-v2-test-${'x'.repeat(40)}`
const TARGET = Object.freeze({ environment: 'staging', release: 'a'.repeat(40), artifactDigest: `sha256:${'b'.repeat(64)}` })
const SOURCE_ROW = Object.freeze({
  event_order: 1,
  event_id: '11111111-1111-4111-8111-111111111111',
  identity_id: '22222222-2222-4222-8222-222222222222',
  unit_slug: 'jardins',
  revision: 2,
  operation: 'upsert',
  occurred_at: '2026-09-14T12:00:00.000000Z',
  source_semantics: 'atendimento/crm-core/confirmed-unit-membership-source/v5',
  source_profile_digest: digestAtendimentoConfirmedProjectionDeltaV2SourceProfile(),
})
const SECOND_SOURCE_ROW = Object.freeze({
  ...SOURCE_ROW,
  event_order: 2,
  event_id: '33333333-3333-4333-8333-333333333333',
  revision: 3,
  occurred_at: '2026-09-14T12:02:00.000000Z',
})

function readyBaseline() {
  const source = createAtendimentoConfirmedProjectionBaselineV2Source({
    owner: 'atendimento',
    scope: 'confirmed-unit-memberships/v5',
    baselineKeyId: 'crm-staging-atendimento-confirmed-baseline-v2-1',
    deltaKeyId: 'crm-staging-atendimento-confirmed-delta-v2-1',
    identityHmacKey: HMAC_KEY,
    unitAllowlist: ['jardins'],
  })
  const row = { identity_id: SOURCE_ROW.identity_id, unit_slug: SOURCE_ROW.unit_slug, observed_at: SOURCE_ROW.occurred_at }
  const { snapshot } = createAtendimentoConfirmedProjectionBaselineV2Snapshot({ rows: [row], capturedAt: '2026-09-14T11:59:00.000Z', watermark: 0 })
  const packet = createAtendimentoConfirmedProjectionBaselineV2Batch({ rows: [row], capturedAt: snapshot.capturedAt, hmacKey: HMAC_KEY, keyId: source.baselineKeyId, target: TARGET })
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
  return markAtendimentoConfirmedProjectionBaselineV2Ready(accepted, {
    contract: ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_READBACK_CONTRACT,
    status: 'verified',
    manifestDigest: accepted.backfill.manifestDigest,
    membershipDigest: accepted.snapshot.membershipDigest,
    watermark: 0,
    verifiedBatchCount: 1,
    verifiedEventCount: 1,
    sourceProfileDigest: digestAtendimentoConfirmedProjectionDeltaV2SourceProfile(),
    target: TARGET,
  })
}

function sourcePool(sourceRows = [SOURCE_ROW]) {
  return {
    async connect() {
      return {
        async query(sql, params = []) {
          if (/current_database\(\)/i.test(sql)) return { rows: [{ database_name: 'skincos_clientes_production', current_user: 'crm_core_projection_exporter', session_user: 'crm_core_projection_exporter', transaction_read_only: 'on' }] }
          if (/transaction_timestamp/i.test(sql)) return { rows: [{ captured_at: '2026-09-14T12:01:00.000Z' }] }
          if (/MAX\(event_order\)/i.test(sql)) return { rows: [{ watermark: sourceRows.at(-1)?.event_order ?? 0 }] }
          if (/event_order <= \$1/i.test(sql)) return { rows: sourceRows.filter((row) => row.event_order <= params[0]).slice(0, params[1]) }
          if (/event_order > \$1/i.test(sql)) return { rows: sourceRows.filter((row) => row.event_order > params[0] && row.event_order <= params[1]).slice(0, params[2]) }
          return { rows: [] }
        },
        release() {},
      }
    },
  }
}

test('requires the durable v5 baseline identity/key/unit pin through delivery and checkpoint completion', async () => {
  let stored = null
  let completed = null
  const runner = createPaginatedAtendimentoConfirmedProjectionDeltaV2Runner({
    pool: sourcePool(),
    hmacKey: HMAC_KEY,
    keyId: 'crm-staging-atendimento-confirmed-delta-v2-1',
    target: TARGET,
    signer: {
      async signBatch(batch) {
        return {
          contract: 'skincos-crm/confirmed-projection-delta-delivery/v2',
          keyId: batch.producer.keyId,
          algorithm: 'Ed25519',
          batchDigest: digestAtendimentoConfirmedProjectionDeltaV2Batch(batch),
          sourceProfileDigest: batch.sourceProfile.digest,
          signature: 'a'.repeat(86),
        }
      },
    },
    transport: {
      async deliver({ batch, requestId }) {
        return {
          ok: true,
          contractVersion: 'crm-core/confirmed-projection-delta-receipt/v2',
          status: 'accepted',
          batchId: batch.batchId,
          eventCount: batch.events.length,
          sourceProfileDigest: batch.sourceProfile.digest,
          target: batch.target,
          requestId,
          fromExclusive: batch.sourceDelta.fromExclusive,
          toInclusive: batch.sourceDelta.toInclusive,
        }
      },
    },
    checkpointStore: {
      async read() { return stored },
      async write(value) { stored = value },
      async complete(value) { completed = value },
    },
  })
  const result = await runner.run({ intent: ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_RUN_INTENT, baseline: readyBaseline() })
  assert.equal(result.status, 'reconciled')
  assert.equal(result.progress.fromExclusive, 1)
  assert.equal(result.progress.acceptedCount, 1)
  assert.equal(completed.state, 'completed')
  assert.equal(JSON.stringify(completed).includes(SOURCE_ROW.identity_id), false)
})

test('fails closed when the delta HMAC does not match the durable baseline', async () => {
  await assert.rejects(() => createPaginatedAtendimentoConfirmedProjectionDeltaV2Runner({
    pool: sourcePool(),
    hmacKey: `wrong-${'x'.repeat(40)}`,
    keyId: 'crm-staging-atendimento-confirmed-delta-v2-1',
    target: TARGET,
    signer: { async signBatch() {} },
    transport: { async deliver() {} },
    checkpointStore: { async read() { return null }, async write() {}, async complete() {} },
  }).run({ intent: ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_RUN_INTENT, baseline: readyBaseline() }), /BASELINE_HMAC_KEY_MISMATCH/)
})

test('starts a fresh high-watermark after a completed checkpoint and only emits appended events', async () => {
  const rows = [SOURCE_ROW]
  const delivered = []
  let stored = null
  const runner = createPaginatedAtendimentoConfirmedProjectionDeltaV2Runner({
    pool: sourcePool(rows),
    hmacKey: HMAC_KEY,
    keyId: 'crm-staging-atendimento-confirmed-delta-v2-1',
    target: TARGET,
    signer: { async signBatch(batch) { return { contract: 'skincos-crm/confirmed-projection-delta-delivery/v2', keyId: batch.producer.keyId, algorithm: 'Ed25519', batchDigest: digestAtendimentoConfirmedProjectionDeltaV2Batch(batch), sourceProfileDigest: batch.sourceProfile.digest, signature: 'a'.repeat(86) } } },
    transport: { async deliver(pending) { delivered.push(pending); return { ok: true, contractVersion: 'crm-core/confirmed-projection-delta-receipt/v2', status: 'accepted', batchId: pending.batch.batchId, eventCount: pending.batch.events.length, sourceProfileDigest: pending.batch.sourceProfile.digest, target: pending.batch.target, requestId: pending.requestId, fromExclusive: pending.batch.sourceDelta.fromExclusive, toInclusive: pending.batch.sourceDelta.toInclusive } } },
    checkpointStore: { async read() { return stored }, async write(value) { stored = value }, async complete(value) { stored = value } },
  })
  await runner.run({ intent: ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_RUN_INTENT, baseline: readyBaseline() })
  rows.push(SECOND_SOURCE_ROW)
  await runner.run({ intent: ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_RUN_INTENT, baseline: readyBaseline() })
  assert.equal(delivered.length, 2)
  assert.equal(delivered[1].batch.sourceDelta.fromExclusive, 1)
  assert.equal(delivered[1].batch.sourceDelta.toInclusive, 2)
  assert.equal(delivered[1].batch.events[0].revision, 3)
  assert.deepEqual(delivered.map((pending) => pending.requestId), [
    'crm-atendimento-confirmed-delta-v2-000001',
    'crm-atendimento-confirmed-delta-v2-000002',
  ])
})

test('replays a persisted pending packet exactly once after interrupted delivery', async () => {
  let stored = null
  let firstAttempt = true
  const receipts = []
  const runner = createPaginatedAtendimentoConfirmedProjectionDeltaV2Runner({
    pool: sourcePool(),
    hmacKey: HMAC_KEY,
    keyId: 'crm-staging-atendimento-confirmed-delta-v2-1',
    target: TARGET,
    signer: { async signBatch(batch) { return { contract: 'skincos-crm/confirmed-projection-delta-delivery/v2', keyId: batch.producer.keyId, algorithm: 'Ed25519', batchDigest: digestAtendimentoConfirmedProjectionDeltaV2Batch(batch), sourceProfileDigest: batch.sourceProfile.digest, signature: 'a'.repeat(86) } } },
    transport: { async deliver(pending) {
      if (firstAttempt) { firstAttempt = false; throw new Error('interrupted') }
      receipts.push(pending)
      return { ok: true, contractVersion: 'crm-core/confirmed-projection-delta-receipt/v2', status: 'idempotent', batchId: pending.batch.batchId, eventCount: pending.batch.events.length, sourceProfileDigest: pending.batch.sourceProfile.digest, target: pending.batch.target, requestId: pending.requestId, fromExclusive: pending.batch.sourceDelta.fromExclusive, toInclusive: pending.batch.sourceDelta.toInclusive }
    } },
    checkpointStore: { async read() { return stored }, async write(value) { stored = value }, async complete(value) { stored = value } },
  })
  await assert.rejects(() => runner.run({ intent: ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_RUN_INTENT, baseline: readyBaseline() }), /UNAVAILABLE/)
  const pendingBatchId = stored.pending.batch.batchId
  const validStored = stored
  stored = {
    ...stored,
    pending: {
      ...stored.pending,
      delivery: { ...stored.pending.delivery, keyId: 'crm-staging-atendimento-confirmed-delta-v2-rotated' },
    },
  }
  await assert.rejects(() => runner.run({ intent: ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_RUN_INTENT, baseline: readyBaseline() }), /CHECKPOINT_INVALID/)
  stored = validStored
  const result = await runner.run({ intent: ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_RUN_INTENT, baseline: readyBaseline() })
  assert.equal(receipts.length, 1)
  assert.equal(receipts[0].batch.batchId, pendingBatchId)
  assert.equal(result.progress.idempotentCount, 1)
})

test('does not construct a production-target runner', () => {
  assert.throws(() => createPaginatedAtendimentoConfirmedProjectionDeltaV2Runner({
    pool: sourcePool(),
    hmacKey: HMAC_KEY,
    keyId: 'crm-staging-atendimento-confirmed-delta-v2-1',
    target: { ...TARGET, environment: 'production' },
    signer: { async signBatch() {} },
    transport: { async deliver() {} },
    checkpointStore: { async read() { return null }, async write() {}, async complete() {} },
  }), /RUNNER_STAGING_ONLY/)
})
