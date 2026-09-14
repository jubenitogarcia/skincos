import { createHash } from 'node:crypto'

import {
  ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_MAX_EVENTS_PER_BATCH,
  assertAtendimentoConfirmedProjectionDeltaV2BaselineBinding,
  assertAtendimentoConfirmedProjectionDeltaV2Checkpoint,
  assertAtendimentoConfirmedProjectionDeltaV2Delivery,
  assertAtendimentoConfirmedProjectionDeltaV2Receipt,
  createAtendimentoConfirmedProjectionDeltaV2BaselineBinding,
  createAtendimentoConfirmedProjectionDeltaV2Batch,
  createAtendimentoConfirmedProjectionDeltaV2Checkpoint,
  digestAtendimentoConfirmedProjectionDeltaV2Batch,
  digestAtendimentoConfirmedProjectionDeltaV2SourceProfile,
} from '../../../../shared/crm-auth/atendimentoConfirmedProjectionDeltaV2.js'
import {
  ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_STATES,
  assertAtendimentoConfirmedProjectionBaselineV2,
  digestAtendimentoConfirmedProjectionBaselineV2,
} from '../../../../shared/crm-auth/atendimentoConfirmedProjectionBaselineV2.js'
import { fingerprintAtendimentoProjectionIdentityKey } from '../../../../shared/crm-auth/atendimentoProjectionIdentityKey.js'
import {
  ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE,
  preflightAtendimentoConfirmedProjectionDeltaV2Source,
  readAtendimentoConfirmedProjectionDeltaV2Page,
} from './atendimentoConfirmedProjectionDeltaV2Exporter.mjs'

export const ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_RUNNER_VERSION = 'atendimento/crm-core/confirmed-projection-delta-runner/v2'
export const ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_RUN_INTENT = 'atendimento/crm-core/staging-confirmed-projection-delta/v2'

const REQUEST_ID_PREFIX = 'crm-atendimento-confirmed-delta-v2-'
const RELEASE_PATTERN = /^[0-9a-f]{40}$/
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/

function fail(code) {
  throw new Error(code)
}

function object(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code)
  return value
}

function exactKeys(value, keys, code) {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) fail(code)
}

function nonNegativeInteger(value, code) {
  const normalized = Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < 0) fail(code)
  return normalized
}

function target(value, code) {
  const descriptor = object(value, code)
  exactKeys(descriptor, ['environment', 'release', 'artifactDigest'], code)
  const environment = String(descriptor.environment ?? '').trim()
  const release = String(descriptor.release ?? '').trim().toLowerCase()
  const artifactDigest = String(descriptor.artifactDigest ?? '').trim().toLowerCase()
  if (!['staging', 'production'].includes(environment) || !RELEASE_PATTERN.test(release) || !SHA256_PATTERN.test(artifactDigest)) fail(code)
  return Object.freeze({ environment, release, artifactDigest })
}

function sameTarget(left, right) {
  return left.environment === right.environment && left.release === right.release && left.artifactDigest === right.artifactDigest
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  return value
}

function digest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`
}

function keyFingerprint(value) {
  return fingerprintAtendimentoProjectionIdentityKey(value, {
    requiredCode: 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_HMAC_KEY_REQUIRED',
    unsafeCode: 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_HMAC_KEY_UNSAFE',
  })
}

function checkpointStore(value) {
  const store = object(value, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_STORE_REQUIRED')
  exactKeys(store, ['read', 'write', 'complete'], 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_STORE_REQUIRED')
  if (typeof store.read !== 'function' || typeof store.write !== 'function' || typeof store.complete !== 'function') fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_STORE_REQUIRED')
  return store
}

function signer(value) {
  const candidate = object(value, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SIGNER_REQUIRED')
  if (typeof candidate.signBatch !== 'function') fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SIGNER_REQUIRED')
  return candidate
}

function transport(value) {
  const candidate = object(value, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_TRANSPORT_REQUIRED')
  if (typeof candidate.deliver !== 'function') fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_TRANSPORT_REQUIRED')
  return candidate
}

function batchSize(value) {
  const normalized = value === undefined ? ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_MAX_EVENTS_PER_BATCH : Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_MAX_EVENTS_PER_BATCH) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BATCH_SIZE_INVALID')
  return normalized
}

function requestId(value, code) {
  const normalized = String(value ?? '').trim()
  if (!/^crm-atendimento-confirmed-delta-v2-\d{6,16}$/.test(normalized)) fail(code)
  return normalized
}

function nextRequestId(batchCount) {
  const sequence = nonNegativeInteger(batchCount, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_REQUEST_ID_INVALID') + 1
  return requestId(`${REQUEST_ID_PREFIX}${String(sequence).padStart(6, '0')}`, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_REQUEST_ID_INVALID')
}

function baselineBinding(baseline) {
  return createAtendimentoConfirmedProjectionDeltaV2BaselineBinding({
    baselineDigest: digestAtendimentoConfirmedProjectionBaselineV2(baseline),
    target: baseline.target,
    identityKeyFingerprint: baseline.source.identityKeyFingerprint,
    deltaKeyId: baseline.source.deltaKeyId,
  })
}

function readyBaseline(value, targetValue, keyId, hmacFingerprint) {
  const baseline = assertAtendimentoConfirmedProjectionBaselineV2(value)
  if (baseline.state !== ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_STATES.READY) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BASELINE_NOT_READY')
  if (!sameTarget(baseline.target, targetValue)) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BASELINE_TARGET_MISMATCH')
  if (baseline.sourceProfile.digest !== digestAtendimentoConfirmedProjectionDeltaV2SourceProfile()) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BASELINE_PROFILE_MISMATCH')
  if (baseline.source.deltaKeyId !== keyId) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BASELINE_KEY_MISMATCH')
  if (baseline.source.identityKeyFingerprint !== hmacFingerprint) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BASELINE_HMAC_KEY_MISMATCH')
  return baseline
}

function checkpointState(value, { binding, targetValue, hmacFingerprint }) {
  const checkpoint = assertAtendimentoConfirmedProjectionDeltaV2Checkpoint(value)
  const expected = assertAtendimentoConfirmedProjectionDeltaV2BaselineBinding(binding)
  if (!sameTarget(checkpoint.target, targetValue)
    || JSON.stringify(checkpoint.baselineBinding) !== JSON.stringify(expected)
    || checkpoint.hmacKeyFingerprint !== hmacFingerprint) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_MISMATCH')
  return checkpoint
}

function initialState({ targetValue, binding, hmacKey, capturedAt, watermark, fromExclusive }) {
  return createAtendimentoConfirmedProjectionDeltaV2Checkpoint({
    target: targetValue,
    baselineBinding: binding,
    hmacKey,
    capturedAt,
    watermark,
    fromExclusive,
    deliveredCount: 0,
    batchCount: 0,
    acceptedCount: 0,
    idempotentCount: 0,
    reconciliationDigest: digest([]),
  })
}

function checkpointWithFingerprint({ state = 'running', checkpoint, hmacKey, pending = null, fromExclusive = checkpoint.progress.fromExclusive, deliveredCount = checkpoint.progress.deliveredCount, batchCount = checkpoint.progress.batchCount, acceptedCount = checkpoint.progress.acceptedCount, idempotentCount = checkpoint.progress.idempotentCount, reconciliationDigest = checkpoint.progress.reconciliationDigest }) {
  return createAtendimentoConfirmedProjectionDeltaV2Checkpoint({
    state,
    target: checkpoint.target,
    baselineBinding: checkpoint.baselineBinding,
    hmacKey,
    capturedAt: checkpoint.sourceSnapshot.capturedAt,
    watermark: checkpoint.sourceSnapshot.watermark,
    fromExclusive,
    deliveredCount,
    batchCount,
    acceptedCount,
    idempotentCount,
    reconciliationDigest,
    pending,
  })
}

function confirmPending(checkpoint, receipt) {
  const pending = checkpoint.pending
  if (!pending) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_INVALID')
  const verifiedReceipt = assertAtendimentoConfirmedProjectionDeltaV2Receipt(receipt, { batch: pending.batch, requestId: pending.requestId })
  const record = Object.freeze({
    batchId: pending.batch.batchId,
    batchDigest: digestAtendimentoConfirmedProjectionDeltaV2Batch(pending.batch),
    receipt: verifiedReceipt.status,
    fromExclusive: pending.batch.sourceDelta.fromExclusive,
    toInclusive: pending.batch.sourceDelta.toInclusive,
  })
  return Object.freeze({
    fromExclusive: pending.batch.sourceDelta.toInclusive,
    deliveredCount: checkpoint.progress.deliveredCount + pending.batch.events.length,
    batchCount: checkpoint.progress.batchCount + 1,
    acceptedCount: checkpoint.progress.acceptedCount + (verifiedReceipt.status === 'accepted' ? 1 : 0),
    idempotentCount: checkpoint.progress.idempotentCount + (verifiedReceipt.status === 'idempotent' ? 1 : 0),
    reconciliationDigest: digest({ previous: checkpoint.progress.reconciliationDigest, record }),
  })
}

async function read(store) {
  try { return await store.read() } catch { fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_UNAVAILABLE') }
}

async function write(store, checkpoint) {
  try { await store.write(checkpoint) } catch { fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_UNAVAILABLE') }
}

async function complete(store, checkpoint) {
  try { await store.complete(checkpoint) } catch { fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CHECKPOINT_UNAVAILABLE') }
}

// All I/O is injected. This module owns no URL, credential, database or
// deployment default. Its only target is a fixed staging artifact, while its
// source reader remains the production-only, immutable v5 outbox contract.
export function createPaginatedAtendimentoConfirmedProjectionDeltaV2Runner({ pool, hmacKey, keyId, target: suppliedTarget, signer: suppliedSigner, transport: suppliedTransport, checkpointStore: suppliedStore, batchSize: suppliedBatchSize } = {}) {
  if (!pool || typeof pool.connect !== 'function') fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_POOL_REQUIRED')
  const targetValue = target(suppliedTarget, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_TARGET_INVALID')
  if (targetValue.environment !== 'staging') fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_RUNNER_STAGING_ONLY')
  const hmacKeyValue = String(hmacKey ?? '').trim()
  const hmacFingerprint = keyFingerprint(hmacKeyValue)
  const deltaKeyId = String(keyId ?? '').trim()
  if (!/^[A-Za-z0-9._-]{3,96}$/.test(deltaKeyId)) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_KEY_ID_INVALID')
  const deliverySigner = signer(suppliedSigner)
  const deliveryTransport = transport(suppliedTransport)
  const store = checkpointStore(suppliedStore)
  const pageSize = batchSize(suppliedBatchSize)
  return Object.freeze({
    version: ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_RUNNER_VERSION,
    target: targetValue,
    async run({ intent, baseline } = {}) {
      if (intent !== ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_RUN_INTENT) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_INTENT_REQUIRED')
      const ready = readyBaseline(baseline, targetValue, deltaKeyId, hmacFingerprint)
      const binding = baselineBinding(ready)
      const existing = await read(store)
      let state = existing === null || existing === undefined ? null : checkpointState(existing, { binding, targetValue, hmacFingerprint })
      const completedCursor = state?.state === 'completed' ? state.progress.fromExclusive : null
      if (state?.state === 'completed') state = null
      let client
      let transactionOpen = false
      try {
        if (state?.pending) {
          const receipt = await deliveryTransport.deliver(state.pending)
          const confirmed = confirmPending(state, receipt)
          state = checkpointWithFingerprint({ checkpoint: state, hmacKey: hmacKeyValue, ...confirmed })
          await write(store, state)
        }
        client = await pool.connect()
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        transactionOpen = true
        const source = await preflightAtendimentoConfirmedProjectionDeltaV2Source(client, { source: ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE })
        if (state) {
          if (source.watermark < state.sourceSnapshot.watermark || state.progress.fromExclusive > state.sourceSnapshot.watermark) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_REGRESSED')
        } else {
          const fromExclusive = completedCursor ?? ready.snapshot.watermark
          if (source.watermark < fromExclusive) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_REGRESSED')
          state = initialState({ targetValue, binding, hmacKey: hmacKeyValue, capturedAt: source.capturedAt, watermark: source.watermark, fromExclusive })
          await write(store, state)
        }
        const admittedUnits = new Set(ready.source.unitAllowlist)
        while (state.progress.fromExclusive < state.sourceSnapshot.watermark) {
          const rows = await readAtendimentoConfirmedProjectionDeltaV2Page(client, {
            source: ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE,
            fromExclusive: state.progress.fromExclusive,
            toInclusive: state.sourceSnapshot.watermark,
            limit: Math.min(pageSize, state.sourceSnapshot.watermark - state.progress.fromExclusive),
          })
          if (rows.length === 0) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_GAP')
          const batch = createAtendimentoConfirmedProjectionDeltaV2Batch({
            rows: rows.map((row) => ({ event_order: row.eventOrder, event_id: row.eventId, identity_id: row.identityId, unit_slug: row.unitSlug, revision: row.revision, operation: row.operation, occurred_at: row.sourceOccurredAt })),
            fromExclusive: state.progress.fromExclusive,
            toInclusive: rows.at(-1).eventOrder,
            hmacKey: hmacKeyValue,
            keyId: deltaKeyId,
            target: targetValue,
          })
          if (batch.events.some((event) => !admittedUnits.has(event.unitScope.unitSlug))) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_UNIT_SCOPE_UNADMITTED')
          const delivery = assertAtendimentoConfirmedProjectionDeltaV2Delivery(await deliverySigner.signBatch(batch))
          if (delivery.keyId !== deltaKeyId
            || delivery.batchDigest !== digestAtendimentoConfirmedProjectionDeltaV2Batch(batch)
            || delivery.sourceProfileDigest !== binding.sourceProfile.digest) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_DELIVERY_MISMATCH')
          const pending = Object.freeze({ batch, delivery, requestId: nextRequestId(state.progress.batchCount) })
          state = checkpointWithFingerprint({ checkpoint: state, hmacKey: hmacKeyValue, pending })
          await write(store, state)
          const receipt = await deliveryTransport.deliver(pending)
          const confirmed = confirmPending(state, receipt)
          state = checkpointWithFingerprint({ checkpoint: state, hmacKey: hmacKeyValue, ...confirmed })
          await write(store, state)
        }
        const completed = checkpointWithFingerprint({ state: 'completed', checkpoint: state, hmacKey: hmacKeyValue })
        await complete(store, completed)
        await client.query('ROLLBACK')
        transactionOpen = false
        return Object.freeze({
          version: ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_RUNNER_VERSION,
          status: 'reconciled',
          target: completed.target,
          baselineBinding: completed.baselineBinding,
          sourceSnapshot: completed.sourceSnapshot,
          progress: completed.progress,
          pii: false,
        })
      } catch (error) {
        if (transactionOpen) {
          try { await client.query('ROLLBACK') } catch { /* preserve the primary failure */ }
        }
        if (error instanceof Error && /^ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_[A-Z_]+$/.test(error.message)) throw error
        fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_UNAVAILABLE')
      } finally {
        if (client && typeof client.release === 'function') client.release()
      }
    },
  })
}

export const __testables = Object.freeze({ digest, sameTarget, nextRequestId, checkpointState })
