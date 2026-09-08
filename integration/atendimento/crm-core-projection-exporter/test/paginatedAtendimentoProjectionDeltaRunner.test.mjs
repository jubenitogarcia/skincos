import test from 'node:test'
import assert from 'node:assert/strict'

import { createAtendimentoProjectionDeltaDeliverySigner } from '../src/atendimentoProjectionDeltaDelivery.mjs'
import {
  ATENDIMENTO_CRM_PROJECTION_DELTA_RUN_INTENT,
  createPaginatedAtendimentoProjectionDeltaRunner,
} from '../src/paginatedAtendimentoProjectionDeltaRunner.mjs'
import { ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE } from '../src/atendimentoProjectionDeltaExporter.mjs'
import {
  acceptAtendimentoProjectionDeltaBaseline,
  createAtendimentoProjectionDeltaBaselinePrepared,
  createAtendimentoProjectionDeltaBaselineSeed,
  markAtendimentoProjectionDeltaReady,
} from '../../../../shared/crm-auth/atendimentoProjectionDeltaBaseline.js'

const TARGET = { environment: 'staging', release: 'a'.repeat(40), artifactDigest: `sha256:${'b'.repeat(64)}` }
const HMAC_KEY = `delta-runner-test-${'x'.repeat(40)}`
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const BASELINE_ROWS = [
  { identity_id: A, unit_slug: 'jardins', observed_at: '2026-09-08T12:00:00.000Z' },
  { identity_id: B, unit_slug: 'pinheiros', observed_at: '2026-09-08T12:00:00.000Z' },
]
const BASELINE_SEED = createAtendimentoProjectionDeltaBaselineSeed({ rows: BASELINE_ROWS, capturedAt: '2026-09-08T12:05:00.000Z' })
const BASELINE_BACKFILL = {
  batchId: 'backfill:atendimento:delta-runner-test',
  batchDigest: `sha256:${'c'.repeat(64)}`,
  capturedAt: BASELINE_SEED.capturedAt,
  cursorDigest: `sha256:${'d'.repeat(64)}`,
  rowCount: BASELINE_SEED.rowCount,
  unitSlugs: BASELINE_SEED.unitSlugs,
  eventCount: BASELINE_SEED.rowCount,
}
const BASELINE = markAtendimentoProjectionDeltaReady(
  acceptAtendimentoProjectionDeltaBaseline(
    createAtendimentoProjectionDeltaBaselinePrepared({
      target: TARGET,
      source: { owner: 'atendimento', scope: 'global-client-identities/v1', backfillKeyId: 'atendimento-projection-key-v2', deltaKeyId: 'crm-staging-atendimento-delta-v1' },
      snapshot: { capturedAt: BASELINE_SEED.capturedAt, cursorDigest: BASELINE_BACKFILL.cursorDigest, rowCount: BASELINE_SEED.rowCount, unitSlugs: BASELINE_SEED.unitSlugs, watermark: 0 },
      backfill: BASELINE_BACKFILL,
      seed: BASELINE_SEED,
    }),
    { contractVersion: 'crm-core/projection-backfill-receipt/v2', status: 'accepted', batchId: BASELINE_BACKFILL.batchId, batchDigest: BASELINE_BACKFILL.batchDigest, eventCount: BASELINE_BACKFILL.eventCount, target: TARGET },
  ),
  { contract: 'atendimento/crm-core/projection-delta-baseline-readback/v1', status: 'verified', batchId: BASELINE_BACKFILL.batchId, batchDigest: BASELINE_BACKFILL.batchDigest, membershipDigest: BASELINE_SEED.membershipDigest, watermark: 0, target: TARGET },
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

function makeClient(rows = validRows()) {
  return {
    async query(sql, params = []) {
      if (/current_database/i.test(sql)) return { rows: [{ database_name: 'skincos_clientes_production', current_user: 'crm_core_projection_exporter', session_user: 'crm_core_projection_exporter', transaction_read_only: 'on' }] }
      if (/captured_at/i.test(sql)) return { rows: [{ captured_at: '2026-09-08T12:05:00.000Z' }] }
      if (/MAX\(event_order\)/i.test(sql)) return { rows: [{ watermark: 3 }] }
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
    checkpointStore: { async read() { return checkpoint.value }, async write(value) { checkpoint.value = value }, async complete(value) { checkpoint.completed = value; checkpoint.value = null } },
    batchSize: 2,
  })
  const summary = await runner.run({ intent: ATENDIMENTO_CRM_PROJECTION_DELTA_RUN_INTENT, baseline: BASELINE })
  assert.equal(summary.status, 'reconciled')
  assert.equal(summary.deliveredCount, 3)
  assert.equal(summary.batchCount, 2)
  assert.equal(delivered.length, 2)
  assert.equal(checkpoint.completed.fromExclusive, 3)
  assert.equal(checkpoint.value, null)
  assert.ok(delivered.every(({ batch }) => batch.events.every((event) => ['upsert', 'revoke'].includes(event.operation))))
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
