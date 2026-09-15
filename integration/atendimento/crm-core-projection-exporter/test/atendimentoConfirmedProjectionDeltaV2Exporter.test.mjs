import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE,
  assertAtendimentoConfirmedProjectionDeltaV2Source,
  preflightAtendimentoConfirmedProjectionDeltaV2Source,
  readAtendimentoConfirmedProjectionDeltaV2Page,
} from '../src/atendimentoConfirmedProjectionDeltaV2Exporter.mjs'
import {
  ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_PROFILE,
  assertAtendimentoConfirmedProjectionDeltaV2Checkpoint,
  assertAtendimentoConfirmedProjectionDeltaV2Delivery,
  assertAtendimentoConfirmedProjectionDeltaV2Receipt,
  createAtendimentoConfirmedProjectionDeltaV2Batch,
  createAtendimentoConfirmedProjectionDeltaV2BaselineBinding,
  createAtendimentoConfirmedProjectionDeltaV2Checkpoint,
  createAtendimentoConfirmedProjectionDeltaV2SigningInput,
  createAtendimentoConfirmedProjectionDeltaV2SourceProfilePin,
  digestAtendimentoConfirmedProjectionDeltaV2Batch,
  digestAtendimentoConfirmedProjectionDeltaV2SourceProfile,
} from '../../../../shared/crm-auth/atendimentoConfirmedProjectionDeltaV2.js'
import { fingerprintAtendimentoProjectionIdentityKey } from '../../../../shared/crm-auth/atendimentoProjectionIdentityKey.js'

const TARGET = Object.freeze({ environment: 'staging', release: 'a'.repeat(40), artifactDigest: `sha256:${'b'.repeat(64)}` })
const HMAC_KEY = `confirmed-projection-delta-v2-test-${'x'.repeat(40)}`
const ROW = Object.freeze({
  event_order: 7,
  event_id: '11111111-1111-4111-8111-111111111111',
  identity_id: '22222222-2222-4222-8222-222222222222',
  unit_slug: 'jardins',
  revision: 2,
  operation: 'upsert',
  occurred_at: '2026-09-14T12:00:00.000000Z',
  source_semantics: ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_PROFILE.semantics,
  source_profile_digest: digestAtendimentoConfirmedProjectionDeltaV2SourceProfile(),
})

function client(rows = [ROW]) {
  return {
    async query(sql, params = []) {
      if (/current_database\(\)/i.test(sql)) {
        return { rows: [{ database_name: 'skincos_clientes_production', current_user: 'crm_core_projection_exporter', session_user: 'crm_core_projection_exporter', transaction_read_only: 'on' }] }
      }
      if (/transaction_timestamp/i.test(sql)) return { rows: [{ captured_at: '2026-09-14T12:01:00.000Z' }] }
      if (/MAX\(event_order\)/i.test(sql)) return { rows: [{ watermark: rows.at(-1)?.event_order ?? 0 }] }
      if (/event_order <= \$1/i.test(sql)) return { rows: rows.filter((row) => row.event_order <= params[0]).slice(0, params[1]) }
      if (/event_order > \$1/i.test(sql)) return { rows: rows.filter((row) => row.event_order > params[0] && row.event_order <= params[1]).slice(0, params[2]) }
      return { rows: [] }
    },
  }
}

test('pins the v5 confirmed-unit profile and excludes legacy and non-Atendimento inputs', () => {
  const source = assertAtendimentoConfirmedProjectionDeltaV2Source(ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE)
  assert.equal(source.sourceProfile.semantics, 'atendimento/crm-core/confirmed-unit-membership-source/v5')
  assert.deepEqual(source.sourceProfile.sourceRelationAllowlist, [
    'crm_atendimento.crm_core_identity_members',
    'crm_atendimento.crm_core_attendance_client_links',
    'crm_atendimento.attendances',
    'crm_atendimento.units',
  ])
  for (const sql of [source.firstPageSql, source.nextPageSql, source.watermarkSql]) {
    assert.match(sql, /crm_core_confirmed_projection_delta_v2_outbox/i)
    assert.doesNotMatch(sql, /crm_core_projection_outbox(?!_)/i)
    assert.doesNotMatch(sql, /(?:crm_caixa|sale|app_registration|supplemental_lead|global_client)/i)
  }
  assert.throws(() => assertAtendimentoConfirmedProjectionDeltaV2Source({ ...source, firstPageSql: 'select * from crm_atendimento.crm_core_confirmed_projection_delta_v2_outbox offset 1' }), /SOURCE_INVALID/)
})

test('reads only rows stamped with the exact confirmed v5 profile', async () => {
  const preflight = await preflightAtendimentoConfirmedProjectionDeltaV2Source(client())
  assert.equal(preflight.watermark, 7)
  assert.equal(preflight.sourceProfileDigest, digestAtendimentoConfirmedProjectionDeltaV2SourceProfile())
  const page = await readAtendimentoConfirmedProjectionDeltaV2Page(client(), { toInclusive: 7 })
  assert.equal(page.length, 1)
  assert.equal(page[0].identityId, ROW.identity_id)
  await assert.rejects(
    () => readAtendimentoConfirmedProjectionDeltaV2Page(client([{ ...ROW, source_semantics: 'atendimento/crm-core/confirmed-unit-membership-source/v4' }]), { toInclusive: 7 }),
    /ROW_INVALID/,
  )
})

test('binds source semantics into the opaque batch, detached delivery, receipt, and private checkpoint', () => {
  const batch = createAtendimentoConfirmedProjectionDeltaV2Batch({
    rows: [{
      event_order: ROW.event_order,
      event_id: ROW.event_id,
      identity_id: ROW.identity_id,
      unit_slug: ROW.unit_slug,
      revision: ROW.revision,
      operation: ROW.operation,
      occurred_at: ROW.occurred_at,
    }],
    fromExclusive: 0,
    toInclusive: ROW.event_order,
    hmacKey: HMAC_KEY,
    keyId: 'crm-staging-atendimento-confirmed-delta-v2-1',
    target: TARGET,
  })
  const batchDigest = digestAtendimentoConfirmedProjectionDeltaV2Batch(batch)
  assert.equal(batch.sourceProfile.digest, digestAtendimentoConfirmedProjectionDeltaV2SourceProfile())
  assert.equal(JSON.stringify(batch).includes(ROW.identity_id), false)
  assert.match(createAtendimentoConfirmedProjectionDeltaV2SigningInput({ keyId: batch.producer.keyId, batchDigest, sourceProfileDigest: batch.sourceProfile.digest, target: TARGET }), /confirmed-projection-delta-delivery\/v2/)
  const delivery = assertAtendimentoConfirmedProjectionDeltaV2Delivery({
    contract: 'skincos-crm/confirmed-projection-delta-delivery/v2',
    keyId: batch.producer.keyId,
    algorithm: 'Ed25519',
    batchDigest,
    sourceProfileDigest: batch.sourceProfile.digest,
    signature: 'a'.repeat(86),
  })
  const requestId = 'crm-atendimento-confirmed-delta-v2-000001'
  const receipt = assertAtendimentoConfirmedProjectionDeltaV2Receipt({
    ok: true,
    contractVersion: 'crm-core/confirmed-projection-delta-receipt/v2',
    status: 'accepted',
    batchId: batch.batchId,
    eventCount: 1,
    sourceProfileDigest: batch.sourceProfile.digest,
    target: TARGET,
    requestId,
    fromExclusive: 0,
    toInclusive: ROW.event_order,
  }, { batch, requestId })
  assert.equal(receipt.sourceProfileDigest, batch.sourceProfile.digest)
  const baselineBinding = createAtendimentoConfirmedProjectionDeltaV2BaselineBinding({
    baselineDigest: `sha256:${'c'.repeat(64)}`,
    target: TARGET,
    sourceProfile: ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_PROFILE,
    identityKeyFingerprint: fingerprintAtendimentoProjectionIdentityKey(HMAC_KEY),
    deltaKeyId: batch.producer.keyId,
  })
  const checkpoint = createAtendimentoConfirmedProjectionDeltaV2Checkpoint({
    target: TARGET,
    baselineBinding,
    hmacKey: HMAC_KEY,
    capturedAt: '2026-09-14T12:01:00.000Z',
    watermark: ROW.event_order,
    fromExclusive: 0,
    deliveredCount: 0,
    batchCount: 0,
    acceptedCount: 0,
    idempotentCount: 0,
    reconciliationDigest: `sha256:${'d'.repeat(64)}`,
    pending: { batch, delivery, requestId },
  })
  assert.equal(assertAtendimentoConfirmedProjectionDeltaV2Checkpoint(checkpoint).pending.batch.sourceProfile.semantics, batch.sourceProfile.semantics)
  assert.equal(JSON.stringify(checkpoint).includes(HMAC_KEY), false)
  assert.throws(() => assertAtendimentoConfirmedProjectionDeltaV2Receipt({ ...receipt, sourceProfileDigest: `sha256:${'e'.repeat(64)}` }, { batch, requestId }), /RECEIPT_INVALID/)
  assert.throws(() => createAtendimentoConfirmedProjectionDeltaV2Checkpoint({
    target: TARGET,
    baselineBinding,
    hmacKey: `other-${'x'.repeat(40)}`,
    capturedAt: '2026-09-14T12:01:00.000Z',
    watermark: ROW.event_order,
    fromExclusive: 0,
    deliveredCount: 0,
    batchCount: 0,
    acceptedCount: 0,
    idempotentCount: 0,
    reconciliationDigest: `sha256:${'d'.repeat(64)}`,
  }), /CHECKPOINT_INVALID/)
})
