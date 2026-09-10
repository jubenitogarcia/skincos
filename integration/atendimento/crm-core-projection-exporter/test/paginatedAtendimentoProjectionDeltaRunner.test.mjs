import test from 'node:test'
import assert from 'node:assert/strict'

import { createAtendimentoProjectionDeltaDeliverySigner } from '../src/atendimentoProjectionDeltaDelivery.mjs'
import {
  ATENDIMENTO_CRM_PROJECTION_DELTA_RUN_INTENT,
  createPaginatedAtendimentoProjectionDeltaRunner,
  __testables as runnerTestables,
} from '../src/paginatedAtendimentoProjectionDeltaRunner.mjs'
import { ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE } from '../src/atendimentoProjectionDeltaExporter.mjs'
import {
  acceptAtendimentoProjectionDeltaBaseline,
  createAtendimentoProjectionDeltaBaselineBackfill,
  createAtendimentoProjectionDeltaBaselinePrepared,
  createAtendimentoProjectionDeltaBaselineSeed,
  createAtendimentoProjectionDeltaBaselineSnapshot,
  createAtendimentoProjectionDeltaBaselineSource,
  markAtendimentoProjectionDeltaReady,
  CRM_CORE_PROJECTION_DELTA_BASELINE_READBACK_CONTRACT,
  __testables as baselineTestables,
} from '../../../../shared/crm-auth/atendimentoProjectionDeltaBaseline.js'

const TARGET = { environment: 'staging', release: 'a'.repeat(40), artifactDigest: `sha256:${'b'.repeat(64)}` }
const HMAC_KEY = `delta-runner-test-${'x'.repeat(40)}`
const ROTATED_HMAC_KEY = `delta-runner-rotated-test-${'y'.repeat(40)}`
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const BASELINE_ROWS = [
  { identity_id: A, unit_slug: 'jardins', observed_at: '2026-09-08T12:00:00.000Z' },
  { identity_id: B, unit_slug: 'pinheiros', observed_at: '2026-09-08T12:00:00.000Z' },
]
const BASELINE_SEED = createAtendimentoProjectionDeltaBaselineSeed({ rows: BASELINE_ROWS, capturedAt: '2026-09-08T12:05:00.000Z' })
const BASELINE_SOURCE = createAtendimentoProjectionDeltaBaselineSource({
  owner: 'atendimento',
  scope: 'global-client-identities/v1',
  backfillKeyId: 'atendimento-projection-key-v2',
  deltaKeyId: 'crm-staging-atendimento-delta-v1',
  identityHmacKey: HMAC_KEY,
  unitAllowlist: ['jardins', 'pinheiros'],
})
const BASELINE_BACKFILL = createAtendimentoProjectionDeltaBaselineBackfill({
  batches: [{
    batchId: 'backfill:atendimento:delta-runner-test',
    batchDigest: `sha256:${'c'.repeat(64)}`,
    capturedAt: BASELINE_SEED.capturedAt,
    cursorDigest: `sha256:${'d'.repeat(64)}`,
    fromOrdinal: 1,
    toOrdinal: BASELINE_SEED.rowCount,
    rowCount: BASELINE_SEED.rowCount,
    unitSlugs: BASELINE_SEED.unitSlugs,
    eventCount: BASELINE_SEED.rowCount,
  }],
  rowCount: BASELINE_SEED.rowCount,
})
const BASELINE_RECEIPT = {
  contractVersion: 'crm-core/projection-backfill-receipt/v2',
  status: 'accepted',
  batchId: BASELINE_BACKFILL.batches[0].batchId,
  eventCount: BASELINE_BACKFILL.batches[0].eventCount,
  target: TARGET,
}
const BASELINE_PROOF = (() => {
  const proof = {
    contract: 'crm-core/projection-baseline-batch-readback/v1',
    status: 'batch-ledger-readback-verified',
    pins: { producer: { owner: 'atendimento', scope: 'global-client-identities/v1', keyId: 'atendimento-projection-key-v2' }, target: TARGET, unitSlugs: BASELINE_BACKFILL.batches[0].unitSlugs },
    counts: { events: BASELINE_BACKFILL.eventCount, sources: BASELINE_BACKFILL.eventCount, units: BASELINE_BACKFILL.batches[0].unitSlugs.length },
    digests: { batch: BASELINE_BACKFILL.batches[0].batchDigest, events: `sha256:${'e'.repeat(64)}`, cursor: BASELINE_BACKFILL.batches[0].cursorDigest, receipt: baselineTestables.digest(BASELINE_RECEIPT), ledger: `sha256:${'f'.repeat(64)}`, sources: `sha256:${'a'.repeat(64)}` },
  }
  return { ...proof, digests: { ...proof.digests, readback: baselineTestables.digest(proof) } }
})()
const BASELINE = markAtendimentoProjectionDeltaReady(
  acceptAtendimentoProjectionDeltaBaseline(
    createAtendimentoProjectionDeltaBaselinePrepared({
      target: TARGET,
      source: BASELINE_SOURCE,
      snapshot: { capturedAt: BASELINE_SEED.capturedAt, cursorDigest: BASELINE_BACKFILL.batches[0].cursorDigest, rowCount: BASELINE_SEED.rowCount, unitSlugs: BASELINE_SEED.unitSlugs, watermark: 0 },
      backfill: BASELINE_BACKFILL,
      seed: BASELINE_SEED,
    }),
  [BASELINE_RECEIPT],
  ),
  { contract: CRM_CORE_PROJECTION_DELTA_BASELINE_READBACK_CONTRACT, status: 'verified', manifestDigest: BASELINE_BACKFILL.manifestDigest, membershipDigest: BASELINE_SEED.membershipDigest, watermark: 0, verifiedBatchCount: BASELINE_BACKFILL.batches.length, verifiedEventCount: BASELINE_BACKFILL.eventCount, ledgerProofDigest: baselineTestables.digest([{ batchDigest: BASELINE_PROOF.digests.batch, readbackDigest: BASELINE_PROOF.digests.readback }]), proofs: [BASELINE_PROOF], target: TARGET },
)

function row(eventOrder, identityId, revision, operation) {
  return { event_order: eventOrder, event_id: `${String.fromCharCode(96 + eventOrder).repeat(8)}-${String(eventOrder).repeat(4)}-4${String(eventOrder).repeat(3)}-8${String(eventOrder).repeat(3)}-${String(eventOrder).repeat(12)}`.slice(0, 36), identity_id: identityId, unit_slug: eventOrder === 3 ? 'pinheiros' : 'jardins', revision, operation, occurred_at: `2026-09-08T12:0${eventOrder}:00.000000Z` }
}

function validRows() {
  return [
    { event_order: 1, event_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', identity_id: A, unit_slug: 'jardins', revision: 2, operation: 'upsert', occurred_at: '2026-09-08T12:00:00.000000Z' },
    { event_order: 2, event_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', identity_id: A, unit_slug: 'jardins', revision: 3, operation: 'revoke', occurred_at: '2026-09-08T12:01:00.000000Z' },
    { event_order: 3, event_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', identity_id: B, unit_slug: 'pinheiros', revision: 2, operation: 'upsert', occurred_at: '2026-09-08T12:02:00.000000Z' },
  ]
}

function emptyReadyBaseline(unitAllowlist) {
  const snapshot = createAtendimentoProjectionDeltaBaselineSnapshot({ rows: [], capturedAt: '2026-09-08T12:05:00.000Z', watermark: 0 })
  const backfill = createAtendimentoProjectionDeltaBaselineBackfill({ batches: [], rowCount: 0, eventCount: 0, unitSlugs: [] })
  const source = createAtendimentoProjectionDeltaBaselineSource({
    owner: 'atendimento',
    scope: 'global-client-identities/v1',
    backfillKeyId: 'atendimento-projection-key-v2',
    deltaKeyId: 'crm-staging-atendimento-delta-v1',
    identityHmacKey: HMAC_KEY,
    unitAllowlist,
  })
  return markAtendimentoProjectionDeltaReady(
    acceptAtendimentoProjectionDeltaBaseline(createAtendimentoProjectionDeltaBaselinePrepared({ target: TARGET, source, snapshot: snapshot.snapshot, backfill, seed: snapshot.seed }), []),
    {
      contract: CRM_CORE_PROJECTION_DELTA_BASELINE_READBACK_CONTRACT,
      status: 'verified',
      manifestDigest: backfill.manifestDigest,
      membershipDigest: snapshot.seed.membershipDigest,
      watermark: 0,
      verifiedBatchCount: 0,
      verifiedEventCount: 0,
      ledgerProofDigest: baselineTestables.digest([]),
      proofs: [],
      target: TARGET,
    },
  )
}

function makeClient(rows = validRows()) {
  return {
    async query(sql, params = []) {
      if (/current_database/i.test(sql)) return { rows: [{ database_name: 'skincos_clientes_production', current_user: 'crm_core_projection_exporter', session_user: 'crm_core_projection_exporter', transaction_read_only: 'on' }] }
      if (/captured_at/i.test(sql)) return { rows: [{ captured_at: '2026-09-08T12:05:00.000Z' }] }
      if (/MAX\(event_order\)/i.test(sql)) return { rows: [{ watermark: Math.max(0, ...rows.map((row) => row.event_order)) }] }
      if (/event_order <= \$1/i.test(sql)) return { rows: rows.filter((row) => row.event_order <= params[0]).slice(0, params[1]) }
      if (/event_order > \$1/i.test(sql)) return { rows: rows.filter((row) => row.event_order > params[0] && row.event_order <= params[1]).slice(0, params[2]) }
      return { rows: [] }
    },
    release() {},
  }
}

test('runs bounded outbox pages, accepts receipts, resumes through an opaque checkpoint and completes', async () => {
  const checkpoint = { value: null, completed: null }
  const delivered = []
  const signer = createAtendimentoProjectionDeltaDeliverySigner({ target: TARGET, keyId: 'crm-staging-atendimento-delta-v1', sign: async () => Buffer.alloc(64, 7) })
  const runner = createPaginatedAtendimentoProjectionDeltaRunner({
    pool: { connect: async () => makeClient() },
    source: ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE,
    hmacKey: HMAC_KEY,
    keyId: 'crm-staging-atendimento-delta-v1',
    target: TARGET,
    signer,
    transport: { async deliver({ batch, requestId }) { delivered.push({ batch, requestId }); return { ok: true, contractVersion: 'crm-core/projection-delta-receipt/v1', status: 'accepted', batchId: batch.batchId, eventCount: batch.events.length, target: TARGET, requestId, fromExclusive: batch.sourceDelta.fromExclusive, toInclusive: batch.sourceDelta.toInclusive } } },
    checkpointStore: { async read() { return checkpoint.value }, async write(value) { checkpoint.value = value }, async complete(value) { checkpoint.completed = value; checkpoint.value = value } },
    batchSize: 2,
  })
  const summary = await runner.run({ intent: ATENDIMENTO_CRM_PROJECTION_DELTA_RUN_INTENT, baseline: BASELINE })
  assert.equal(summary.status, 'reconciled')
  assert.equal(summary.deliveredCount, 3)
  assert.equal(summary.batchCount, 2)
  assert.equal(delivered.length, 2)
  assert.equal(checkpoint.completed.state, 'completed')
  assert.equal(checkpoint.completed.progress.fromExclusive, 3)
  assert.equal(checkpoint.value.state, 'completed')
  assert.equal(checkpoint.completed.baseline.owner, 'atendimento')
  assert.equal(checkpoint.completed.baseline.scope, 'global-client-identities/v1')
  assert.match(checkpoint.completed.baseline.digest, /^sha256:[a-f0-9]{64}$/)
  assert.ok(delivered.every(({ batch }) => batch.events.every((event) => ['upsert', 'revoke'].includes(event.operation))))
})

test('keeps a completed high-watermark and drains only rows appended after it on the next run', async () => {
  const checkpoint = { value: null, completed: null }
  const delivered = []
  let rows = validRows()
  const runner = createPaginatedAtendimentoProjectionDeltaRunner({
    pool: { connect: async () => makeClient(rows) },
    source: ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE,
    hmacKey: HMAC_KEY,
    keyId: 'crm-staging-atendimento-delta-v1',
    target: TARGET,
    signer: createAtendimentoProjectionDeltaDeliverySigner({ target: TARGET, keyId: 'crm-staging-atendimento-delta-v1', sign: async () => Buffer.alloc(64, 7) }),
    transport: { async deliver({ batch, requestId }) { delivered.push({ batch, requestId }); return { ok: true, contractVersion: 'crm-core/projection-delta-receipt/v1', status: 'accepted', batchId: batch.batchId, eventCount: batch.events.length, target: TARGET, requestId, fromExclusive: batch.sourceDelta.fromExclusive, toInclusive: batch.sourceDelta.toInclusive } } },
    checkpointStore: { async read() { return checkpoint.value }, async write(value) { checkpoint.value = value }, async complete(value) { checkpoint.completed = value; checkpoint.value = value } },
    batchSize: 2,
  })

  const first = await runner.run({ intent: ATENDIMENTO_CRM_PROJECTION_DELTA_RUN_INTENT, baseline: BASELINE })
  assert.equal(first.fromExclusive, 3)
  rows = [...rows, {
    event_order: 4,
    event_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    identity_id: A,
    unit_slug: 'jardins',
    revision: 4,
    operation: 'upsert',
    occurred_at: '2026-09-08T12:03:00.000000Z',
  }]
  const second = await runner.run({ intent: ATENDIMENTO_CRM_PROJECTION_DELTA_RUN_INTENT, baseline: BASELINE })

  assert.equal(second.fromExclusive, 4)
  assert.equal(delivered.length, 3)
  assert.equal(delivered.at(-1).batch.sourceDelta.fromExclusive, 3)
  assert.equal(delivered.at(-1).batch.sourceDelta.toInclusive, 4)
  assert.equal(checkpoint.completed.state, 'completed')
  assert.equal(checkpoint.completed.progress.fromExclusive, 4)
})

test('does not widen a recovered running snapshot when newer source rows appear', async () => {
  const checkpoint = { value: null, completed: null }
  let rows = validRows()
  let deliveries = 0
  const delivery = ({ batch, requestId }) => ({ ok: true, contractVersion: 'crm-core/projection-delta-receipt/v1', status: 'accepted', batchId: batch.batchId, eventCount: batch.events.length, target: TARGET, requestId, fromExclusive: batch.sourceDelta.fromExclusive, toInclusive: batch.sourceDelta.toInclusive })
  const options = () => ({
    pool: { connect: async () => makeClient(rows) }, source: ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE, hmacKey: HMAC_KEY,
    keyId: 'crm-staging-atendimento-delta-v1', target: TARGET,
    signer: createAtendimentoProjectionDeltaDeliverySigner({ target: TARGET, keyId: 'crm-staging-atendimento-delta-v1', sign: async () => Buffer.alloc(64, 7) }),
    transport: { async deliver(value) { deliveries += 1; if (deliveries === 2) throw new Error('transient transport failure'); return delivery(value) } },
    checkpointStore: { async read() { return checkpoint.value }, async write(value) { checkpoint.value = value }, async complete(value) { checkpoint.completed = value; checkpoint.value = value } }, batchSize: 2,
  })
  await assert.rejects(
    () => createPaginatedAtendimentoProjectionDeltaRunner(options()).run({ intent: ATENDIMENTO_CRM_PROJECTION_DELTA_RUN_INTENT, baseline: BASELINE }),
    /ATENDIMENTO_CRM_PROJECTION_DELTA_UNAVAILABLE/,
  )
  assert.equal(checkpoint.value.state, 'running')
  assert.equal(checkpoint.value.sourceSnapshot.watermark, 3)

  rows = [...rows, {
    event_order: 4,
    event_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    identity_id: A,
    unit_slug: 'jardins',
    revision: 4,
    operation: 'upsert',
    occurred_at: '2026-09-08T12:03:00.000000Z',
  }]
  deliveries = 0
  const resumed = await createPaginatedAtendimentoProjectionDeltaRunner(options()).run({ intent: ATENDIMENTO_CRM_PROJECTION_DELTA_RUN_INTENT, baseline: BASELINE })
  assert.equal(resumed.fromExclusive, 3)
  assert.equal(checkpoint.completed.sourceSnapshot.watermark, 3)
})

test('rejects a changed identity HMAC before replay when its key id is unchanged', async () => {
  const checkpoint = { value: null }
  let connected = false
  let deliveries = 0
  const options = (hmacKey) => ({
    pool: { connect: async () => { connected = true; return makeClient() } },
    source: ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE,
    hmacKey,
    keyId: 'crm-staging-atendimento-delta-v1',
    target: TARGET,
    signer: createAtendimentoProjectionDeltaDeliverySigner({ target: TARGET, keyId: 'crm-staging-atendimento-delta-v1', sign: async () => Buffer.alloc(64, 7) }),
    transport: { async deliver() { deliveries += 1; throw new Error('transient transport failure') } },
    checkpointStore: { async read() { return checkpoint.value }, async write(value) { checkpoint.value = value }, async complete(value) { checkpoint.value = value } },
    batchSize: 2,
  })
  await assert.rejects(
    () => createPaginatedAtendimentoProjectionDeltaRunner(options(HMAC_KEY)).run({ intent: ATENDIMENTO_CRM_PROJECTION_DELTA_RUN_INTENT, baseline: BASELINE }),
    /ATENDIMENTO_CRM_PROJECTION_DELTA_UNAVAILABLE/,
  )
  assert.equal(checkpoint.value.state, 'running')
  assert.match(checkpoint.value.hmacKeyFingerprint, /^sha256:[a-f0-9]{64}$/)
  assert.equal(JSON.stringify(checkpoint.value).includes(HMAC_KEY), false)

  connected = false
  deliveries = 0
  await assert.rejects(
    () => createPaginatedAtendimentoProjectionDeltaRunner(options(ROTATED_HMAC_KEY)).run({ intent: ATENDIMENTO_CRM_PROJECTION_DELTA_RUN_INTENT, baseline: BASELINE }),
    /ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_HMAC_KEY_MISMATCH/,
  )
  assert.equal(connected, false)
  assert.equal(deliveries, 0)
})

test('refuses the first delta before opening the source pool when its identity HMAC differs from the baseline pin', async () => {
  let connected = false
  const runner = createPaginatedAtendimentoProjectionDeltaRunner({
    pool: { connect: async () => { connected = true; return makeClient() } },
    source: ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE,
    hmacKey: ROTATED_HMAC_KEY,
    keyId: 'crm-staging-atendimento-delta-v1',
    target: TARGET,
    signer: { async signBatch() { throw new Error('must not sign') } },
    transport: { async deliver() { throw new Error('must not deliver') } },
    checkpointStore: { async read() { return null }, async write() {}, async complete() {} },
  })
  await assert.rejects(
    () => runner.run({ intent: ATENDIMENTO_CRM_PROJECTION_DELTA_RUN_INTENT, baseline: BASELINE }),
    /ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_HMAC_KEY_MISMATCH/,
  )
  assert.equal(connected, false)
})

test('rejects an out-of-allowlist delta before signing, pending checkpoint, or delivery', async () => {
  const writes = []
  let signed = false
  let delivered = false
  const runner = createPaginatedAtendimentoProjectionDeltaRunner({
    pool: { connect: async () => makeClient([validRows()[2]]) },
    source: ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE,
    hmacKey: HMAC_KEY,
    keyId: 'crm-staging-atendimento-delta-v1',
    target: TARGET,
    signer: { async signBatch() { signed = true; throw new Error('must not sign') } },
    transport: { async deliver() { delivered = true; throw new Error('must not deliver') } },
    checkpointStore: { async read() { return null }, async write(value) { writes.push(value) }, async complete() {} },
  })
  await assert.rejects(
    () => runner.run({ intent: ATENDIMENTO_CRM_PROJECTION_DELTA_RUN_INTENT, baseline: emptyReadyBaseline(['jardins']) }),
    /ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_UNIT_SCOPE_MISMATCH/,
  )
  assert.equal(signed, false)
  assert.equal(delivered, false)
  assert.equal(writes.some((value) => value.pending !== null), false)
})

test('uses a checkpoint and transport-compatible request ID after one million batches', () => {
  assert.equal(runnerTestables.nextRequestId(999_999), 'crm-atendimento-delta-1000000')
  assert.equal(runnerTestables.requestId('crm-atendimento-delta-1000000', 'REQUEST_ID_INVALID'), 'crm-atendimento-delta-1000000')
  assert.throws(() => runnerTestables.nextRequestId(Number.MAX_SAFE_INTEGER), /REQUEST_ID_INVALID/)
})

test('rejects revision regression before signing or delivery', async () => {
  const rows = [
    { ...validRows()[0], revision: 3 },
    { ...validRows()[1], identity_id: A, unit_slug: 'jardins', revision: 1, operation: 'revoke' },
    { ...validRows()[2], identity_id: B, unit_slug: 'pinheiros', revision: 1, operation: 'upsert' },
  ]
  const client = makeClient(rows)
  let signed = false
  const runner = createPaginatedAtendimentoProjectionDeltaRunner({ pool: { connect: async () => client }, source: ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE, hmacKey: HMAC_KEY, keyId: 'crm-staging-atendimento-delta-v1', target: TARGET, signer: { async signBatch() { signed = true; throw new Error('must not sign') } }, transport: { async deliver() { throw new Error('must not deliver') } }, checkpointStore: { async read() { return null }, async write() {}, async complete() {} }, batchSize: 2 })
  await assert.rejects(() => runner.run({ intent: ATENDIMENTO_CRM_PROJECTION_DELTA_RUN_INTENT, baseline: BASELINE }), /REVISION_REGRESSION/)
  assert.equal(signed, false)
})

test('is staging-only and requires explicit intent before opening the pool', async () => {
  let connected = false
  assert.throws(() => createPaginatedAtendimentoProjectionDeltaRunner({ pool: { connect: async () => { connected = true } }, source: ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE, hmacKey: HMAC_KEY, keyId: 'crm-production-atendimento-delta-v1', target: { ...TARGET, environment: 'production' }, signer: {}, transport: {}, checkpointStore: {} }), /STAGING_ONLY|SIGNER_REQUIRED/)
  assert.equal(connected, false)
})

test('requires a delta-ready baseline before opening the source pool', async () => {
  let connected = false
  const runner = createPaginatedAtendimentoProjectionDeltaRunner({
    pool: { connect: async () => { connected = true } },
    source: ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE,
    hmacKey: HMAC_KEY,
    keyId: 'crm-staging-atendimento-delta-v1',
    target: TARGET,
    signer: { async signBatch() {} },
    transport: { async deliver() {} },
    checkpointStore: { async read() { return null }, async write() {}, async complete() {} },
  })
  await assert.rejects(() => runner.run({ intent: ATENDIMENTO_CRM_PROJECTION_DELTA_RUN_INTENT }), /BASELINE_REQUIRED/)
  assert.equal(connected, false)
})
