import { createHash } from 'node:crypto'

import {
  ATENDIMENTO_CRM_PROJECTION_DELTA_MAX_EVENTS_PER_BATCH,
  ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE,
  assertAtendimentoProjectionDeltaBatch,
  assertAtendimentoProjectionDeltaSource,
  assertAtendimentoProjectionExportTarget,
  createAtendimentoProjectionDeltaBatch,
  digestAtendimentoProjectionDeltaBatch,
  preflightAtendimentoProjectionDeltaSource,
  readAtendimentoProjectionDeltaPage,
} from './atendimentoProjectionDeltaExporter.mjs'
import { assertAtendimentoProjectionDeltaDelivery } from './atendimentoProjectionDeltaDelivery.mjs'
import {
  assertAtendimentoProjectionDeltaBaseline,
  CRM_CORE_PROJECTION_DELTA_BASELINE_STATES,
  digestAtendimentoProjectionDeltaBaseline,
} from '../../../../shared/crm-auth/atendimentoProjectionDeltaBaseline.js'

export const ATENDIMENTO_CRM_PROJECTION_DELTA_RUNNER_VERSION = 'atendimento/crm-core/projection-delta-runner/v1'
export const ATENDIMENTO_CRM_PROJECTION_DELTA_RUN_INTENT = 'atendimento/crm-core/staging-projection-delta/v1'

const CHECKPOINT_VERSION = 'atendimento/crm-core/projection-delta-checkpoint/v3'
const REQUEST_ID_PREFIX = 'crm-atendimento-delta-'

function fail(code) { throw new Error(code) }
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
function positiveInteger(value, code) {
  const normalized = Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < 1) fail(code)
  return normalized
}
function timestamp(value, code) {
  const parsed = new Date(String(value ?? '').trim())
  if (Number.isNaN(parsed.getTime())) fail(code)
  return parsed.toISOString()
}
function batchSize(value) {
  const normalized = value === undefined ? ATENDIMENTO_CRM_PROJECTION_DELTA_MAX_EVENTS_PER_BATCH : Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > ATENDIMENTO_CRM_PROJECTION_DELTA_MAX_EVENTS_PER_BATCH) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_RUNNER_BATCH_SIZE_INVALID')
  return normalized
}
function sameTarget(left, right) {
  return left.environment === right.environment && left.release === right.release && left.artifactDigest === right.artifactDigest
}
function baselinePin(value) {
  const baseline = assertAtendimentoProjectionDeltaBaseline(value)
  return Object.freeze({
    digest: digestAtendimentoProjectionDeltaBaseline(baseline),
    owner: baseline.source.owner,
    scope: baseline.source.scope,
    backfillKeyId: baseline.source.backfillKeyId,
    deltaKeyId: baseline.source.deltaKeyId,
    unitSlugs: Object.freeze([...baseline.snapshot.unitSlugs]),
  })
}
function assertBaselinePin(value, code) {
  const pin = object(value, code)
  exactKeys(pin, ['digest', 'owner', 'scope', 'backfillKeyId', 'deltaKeyId', 'unitSlugs'], code)
  if (!/^sha256:[a-f0-9]{64}$/.test(String(pin.digest || '').toLowerCase())
    || pin.owner !== 'atendimento' || pin.scope !== 'global-client-identities/v1'
    || !/^[A-Za-z0-9._-]{3,96}$/.test(String(pin.backfillKeyId || ''))
    || !/^[A-Za-z0-9._-]{3,96}$/.test(String(pin.deltaKeyId || ''))) fail(code)
  const unitSlugs = pin.unitSlugs
  if (!Array.isArray(unitSlugs) || unitSlugs.length < 1 || unitSlugs.some((slug) => !/^(?!all$|unknown$)[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(String(slug)))) fail(code)
  const sorted = [...unitSlugs].sort()
  if (JSON.stringify(sorted) !== JSON.stringify(unitSlugs) || new Set(unitSlugs).size !== unitSlugs.length) fail(code)
  return Object.freeze({ digest: String(pin.digest).toLowerCase(), owner: pin.owner, scope: pin.scope, backfillKeyId: pin.backfillKeyId, deltaKeyId: pin.deltaKeyId, unitSlugs: Object.freeze([...unitSlugs]) })
}
function sameBaselinePin(left, right) {
  return left.digest === right.digest && left.owner === right.owner && left.scope === right.scope
    && left.backfillKeyId === right.backfillKeyId && left.deltaKeyId === right.deltaKeyId
    && JSON.stringify(left.unitSlugs) === JSON.stringify(right.unitSlugs)
}
function readyBaseline(value, target, deltaKeyId) {
  if (value === undefined || value === null) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_REQUIRED')
  const baseline = assertAtendimentoProjectionDeltaBaseline(value)
  if (baseline.state !== CRM_CORE_PROJECTION_DELTA_BASELINE_STATES.READY) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_NOT_READY')
  if (!sameTarget(baseline.target, target)) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_TARGET_MISMATCH')
  if (baseline.source.deltaKeyId !== String(deltaKeyId || '').trim()) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_KEY_MISMATCH')
  return baseline
}
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  return value
}
function digest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`
}
function hmacKeyFingerprint(value) {
  const key = String(value ?? '').trim()
  if (!key) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_HMAC_KEY_REQUIRED')
  if (Buffer.byteLength(key, 'utf8') < 32) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_HMAC_KEY_UNSAFE')
  return `sha256:${createHash('sha256').update(key, 'utf8').digest('hex')}`
}
function storedHmacKeyFingerprint(value, code) {
  const fingerprint = String(value ?? '').trim().toLowerCase()
  if (!/^sha256:[a-f0-9]{64}$/.test(fingerprint)) fail(code)
  return fingerprint
}
function checkpointStore(value) {
  const store = object(value, 'ATENDIMENTO_CRM_PROJECTION_DELTA_CHECKPOINT_STORE_REQUIRED')
  exactKeys(store, ['read', 'write', 'complete'], 'ATENDIMENTO_CRM_PROJECTION_DELTA_CHECKPOINT_STORE_REQUIRED')
  if (typeof store.read !== 'function' || typeof store.write !== 'function' || typeof store.complete !== 'function') fail('ATENDIMENTO_CRM_PROJECTION_DELTA_CHECKPOINT_STORE_REQUIRED')
  return store
}
function signer(value) {
  const normalized = object(value, 'ATENDIMENTO_CRM_PROJECTION_DELTA_SIGNER_REQUIRED')
  if (typeof normalized.signBatch !== 'function') fail('ATENDIMENTO_CRM_PROJECTION_DELTA_SIGNER_REQUIRED')
  return normalized
}
function transport(value) {
  const normalized = object(value, 'ATENDIMENTO_CRM_PROJECTION_DELTA_TRANSPORT_REQUIRED')
  if (typeof normalized.deliver !== 'function') fail('ATENDIMENTO_CRM_PROJECTION_DELTA_TRANSPORT_REQUIRED')
  return normalized
}
function requestId(value, code) {
  const normalized = String(value ?? '').trim()
  if (!/^crm-atendimento-delta-\d{6}$/.test(normalized)) fail(code)
  return normalized
}
function revisionWatermarks(value, code) {
  if (!Array.isArray(value)) fail(code)
  const rows = value.map((entry) => {
    const item = object(entry, code)
    exactKeys(item, ['unitSlug', 'projectionReference', 'revision'], code)
    const unitSlug = String(item.unitSlug || '').trim()
    const projectionReference = String(item.projectionReference || '').trim()
    if (!/^(?!all$|unknown$)[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(unitSlug) || !/^projection:[A-Za-z0-9_-]{8,160}$/.test(projectionReference)) fail(code)
    return Object.freeze({ unitSlug, projectionReference, revision: positiveInteger(item.revision, code) })
  })
  const keys = new Set()
  for (const row of rows) {
    const key = `${row.unitSlug}:${row.projectionReference}`
    if (keys.has(key)) fail(code)
    keys.add(key)
  }
  return Object.freeze(rows.sort((left, right) => `${left.unitSlug}:${left.projectionReference}`.localeCompare(`${right.unitSlug}:${right.projectionReference}`)))
}
function storedPending(value, { target, baseline, code }) {
  if (value === null) return null
  const pending = object(value, code)
  exactKeys(pending, ['batch', 'delivery', 'requestId'], code)
  const batch = assertAtendimentoProjectionDeltaBatch(pending.batch)
  const delivery = assertAtendimentoProjectionDeltaDelivery(pending.delivery)
  if (!sameTarget(batch.target, target) || delivery.batchDigest !== digestAtendimentoProjectionDeltaBatch(batch) || !sameTarget(target, batch.target)
    || batch.producer.owner !== baseline.owner || batch.producer.scope !== baseline.scope || batch.producer.keyId !== baseline.deltaKeyId
    || batch.events.some((event) => !baseline.unitSlugs.includes(event.unitScope.unitSlug))) fail(code)
  return Object.freeze({ batch, delivery, requestId: requestId(pending.requestId, code) })
}
function storedCheckpoint(value) {
  const checkpoint = object(value, 'ATENDIMENTO_CRM_PROJECTION_DELTA_CHECKPOINT_INVALID')
  exactKeys(checkpoint, ['contractVersion', 'state', 'target', 'baseline', 'hmacKeyFingerprint', 'sourceSnapshot', 'progress', 'revisionWatermarks', 'pending'], 'ATENDIMENTO_CRM_PROJECTION_DELTA_CHECKPOINT_INVALID')
  if (checkpoint.contractVersion !== CHECKPOINT_VERSION || !['running', 'completed'].includes(checkpoint.state)) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_CHECKPOINT_INVALID')
  const target = assertAtendimentoProjectionExportTarget(checkpoint.target)
  const baseline = assertBaselinePin(checkpoint.baseline, 'ATENDIMENTO_CRM_PROJECTION_DELTA_CHECKPOINT_INVALID')
  const keyFingerprint = storedHmacKeyFingerprint(checkpoint.hmacKeyFingerprint, 'ATENDIMENTO_CRM_PROJECTION_DELTA_CHECKPOINT_INVALID')
  const snapshot = object(checkpoint.sourceSnapshot, 'ATENDIMENTO_CRM_PROJECTION_DELTA_CHECKPOINT_INVALID')
  const progress = object(checkpoint.progress, 'ATENDIMENTO_CRM_PROJECTION_DELTA_CHECKPOINT_INVALID')
  exactKeys(snapshot, ['capturedAt', 'watermark'], 'ATENDIMENTO_CRM_PROJECTION_DELTA_CHECKPOINT_INVALID')
  exactKeys(progress, ['fromExclusive', 'deliveredCount', 'batchCount', 'acceptedCount', 'idempotentCount', 'reconciliationDigest'], 'ATENDIMENTO_CRM_PROJECTION_DELTA_CHECKPOINT_INVALID')
  const fromExclusive = nonNegativeInteger(progress.fromExclusive, 'ATENDIMENTO_CRM_PROJECTION_DELTA_CHECKPOINT_INVALID')
  const deliveredCount = nonNegativeInteger(progress.deliveredCount, 'ATENDIMENTO_CRM_PROJECTION_DELTA_CHECKPOINT_INVALID')
  const batchCount = nonNegativeInteger(progress.batchCount, 'ATENDIMENTO_CRM_PROJECTION_DELTA_CHECKPOINT_INVALID')
  const acceptedCount = nonNegativeInteger(progress.acceptedCount, 'ATENDIMENTO_CRM_PROJECTION_DELTA_CHECKPOINT_INVALID')
  const idempotentCount = nonNegativeInteger(progress.idempotentCount, 'ATENDIMENTO_CRM_PROJECTION_DELTA_CHECKPOINT_INVALID')
  if (acceptedCount + idempotentCount !== batchCount || !/^sha256:[a-f0-9]{64}$/.test(String(progress.reconciliationDigest || ''))) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_CHECKPOINT_INVALID')
  const pending = storedPending(checkpoint.pending, { target, baseline, code: 'ATENDIMENTO_CRM_PROJECTION_DELTA_CHECKPOINT_INVALID' })
  const watermark = nonNegativeInteger(snapshot.watermark, 'ATENDIMENTO_CRM_PROJECTION_DELTA_CHECKPOINT_INVALID')
  if (fromExclusive > watermark || (pending && pending.batch.sourceDelta.fromExclusive !== fromExclusive)
    || (checkpoint.state === 'completed' && (pending || fromExclusive !== watermark))) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_CHECKPOINT_INVALID')
  return Object.freeze({ checkpointState: checkpoint.state, target, baseline, hmacKeyFingerprint: keyFingerprint, capturedAt: timestamp(snapshot.capturedAt, 'ATENDIMENTO_CRM_PROJECTION_DELTA_CHECKPOINT_INVALID'), watermark, fromExclusive, deliveredCount, batchCount, acceptedCount, idempotentCount, reconciliationDigest: progress.reconciliationDigest, revisionWatermarks: revisionWatermarks(checkpoint.revisionWatermarks, 'ATENDIMENTO_CRM_PROJECTION_DELTA_CHECKPOINT_INVALID'), pending })
}
function makeCheckpoint({ checkpointState = 'running', target, baseline, hmacKeyFingerprint: suppliedHmacKeyFingerprint, capturedAt, watermark, fromExclusive, deliveredCount, batchCount, acceptedCount, idempotentCount, reconciliationDigest, revisionWatermarks: watermarks, pending }) {
  if (!['running', 'completed'].includes(checkpointState) || fromExclusive > watermark
    || (checkpointState === 'completed' && (pending || fromExclusive !== watermark))) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_CHECKPOINT_INVALID')
  return Object.freeze({
    contractVersion: CHECKPOINT_VERSION,
    state: checkpointState,
    target: Object.freeze({ ...target }),
    baseline: assertBaselinePin(baseline, 'ATENDIMENTO_CRM_PROJECTION_DELTA_CHECKPOINT_INVALID'),
    hmacKeyFingerprint: storedHmacKeyFingerprint(suppliedHmacKeyFingerprint, 'ATENDIMENTO_CRM_PROJECTION_DELTA_CHECKPOINT_INVALID'),
    sourceSnapshot: Object.freeze({ capturedAt, watermark }),
    progress: Object.freeze({ fromExclusive, deliveredCount, batchCount, acceptedCount, idempotentCount, reconciliationDigest }),
    revisionWatermarks: revisionWatermarks(watermarks, 'ATENDIMENTO_CRM_PROJECTION_DELTA_CHECKPOINT_INVALID'),
    pending: pending ? Object.freeze({ batch: pending.batch, delivery: pending.delivery, requestId: pending.requestId }) : null,
  })
}
function completedSummary({ target, baseline, capturedAt, watermark, fromExclusive, deliveredCount, batchCount, acceptedCount, idempotentCount, reconciliationDigest }) {
  return Object.freeze({ contractVersion: 'atendimento/crm-core/projection-delta-reconciliation/v2', status: 'reconciled', target: Object.freeze({ ...target }), baseline: assertBaselinePin(baseline, 'ATENDIMENTO_CRM_PROJECTION_DELTA_CHECKPOINT_INVALID'), sourceSnapshot: Object.freeze({ capturedAt, watermark }), fromExclusive, deliveredCount, batchCount, acceptedCount, idempotentCount, reconciliationDigest })
}
async function readCheckpoint(store) {
  try { return await store.read() } catch { fail('ATENDIMENTO_CRM_PROJECTION_DELTA_CHECKPOINT_UNAVAILABLE') }
}
async function writeCheckpoint(store, value) {
  try { await store.write(value) } catch { fail('ATENDIMENTO_CRM_PROJECTION_DELTA_CHECKPOINT_UNAVAILABLE') }
}
async function completeCheckpoint(store, value) {
  try { await store.complete(value) } catch { fail('ATENDIMENTO_CRM_PROJECTION_DELTA_CHECKPOINT_UNAVAILABLE') }
}
function confirmedState(state, pending, receipt) {
  if (!receipt || !['accepted', 'idempotent'].includes(receipt.status) || receipt.batchId !== pending.batch.batchId || receipt.eventCount !== pending.batch.events.length || receipt.fromExclusive !== pending.batch.sourceDelta.fromExclusive || receipt.toInclusive !== pending.batch.sourceDelta.toInclusive || !sameTarget(receipt.target, pending.batch.target)) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_RECONCILIATION_FAILED')
  const record = Object.freeze({ batchId: pending.batch.batchId, batchDigest: pending.delivery.batchDigest, eventCount: pending.batch.events.length, status: receipt.status, fromExclusive: pending.batch.sourceDelta.fromExclusive, toInclusive: pending.batch.sourceDelta.toInclusive })
  return Object.freeze({ ...state, fromExclusive: pending.batch.sourceDelta.toInclusive, deliveredCount: state.deliveredCount + pending.batch.events.length, batchCount: state.batchCount + 1, acceptedCount: state.acceptedCount + (receipt.status === 'accepted' ? 1 : 0), idempotentCount: state.idempotentCount + (receipt.status === 'idempotent' ? 1 : 0), reconciliationDigest: digest({ previous: state.reconciliationDigest, record }), pending: null })
}
function knownError(error) {
  return error instanceof Error && /^ATENDIMENTO_CRM_PROJECTION_DELTA_[A-Z_]+$/.test(error.message)
}

/**
 * Runs the source outbox to a fixed high-watermark.  Every capability is
 * injected by the operator: this module has no URL, secret, database or
 * deployment default and is therefore safe to include in source-only PRs.
 */
export function createPaginatedAtendimentoProjectionDeltaRunner({ pool, source = ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE, hmacKey, keyId, target, signer: suppliedSigner, transport: suppliedTransport, checkpointStore: suppliedCheckpointStore, batchSize: suppliedBatchSize } = {}) {
  if (!pool || typeof pool.connect !== 'function') fail('ATENDIMENTO_CRM_PROJECTION_DELTA_POOL_REQUIRED')
  const pageSize = batchSize(suppliedBatchSize)
  const hmacKeyValue = String(hmacKey ?? '').trim()
  const hmacKeyValueFingerprint = hmacKeyFingerprint(hmacKeyValue)
  const sourceDefinition = assertAtendimentoProjectionDeltaSource(source)
  const targetValue = assertAtendimentoProjectionExportTarget(target)
  if (targetValue.environment !== 'staging') fail('ATENDIMENTO_CRM_PROJECTION_DELTA_RUNNER_STAGING_ONLY')
  const deliverySigner = signer(suppliedSigner)
  const deliveryTransport = transport(suppliedTransport)
  const privateCheckpointStore = checkpointStore(suppliedCheckpointStore)
  return Object.freeze({
    version: ATENDIMENTO_CRM_PROJECTION_DELTA_RUNNER_VERSION,
    target: targetValue,
    async run({ intent, baseline } = {}) {
      if (intent !== ATENDIMENTO_CRM_PROJECTION_DELTA_RUN_INTENT) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_INTENT_REQUIRED')
      const baselineValue = readyBaseline(baseline, targetValue, keyId)
      const baselineValuePin = baselinePin(baselineValue)
      const existing = await readCheckpoint(privateCheckpointStore)
      let restored = null
      if (existing !== null && existing !== undefined) {
        try { restored = storedCheckpoint(existing) } catch { fail('ATENDIMENTO_CRM_PROJECTION_DELTA_CHECKPOINT_RECOVERY_REQUIRED') }
      }
      if (restored && !sameTarget(restored.target, targetValue)) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_CHECKPOINT_TARGET_MISMATCH')
      if (restored && !sameBaselinePin(restored.baseline, baselineValuePin)) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_CHECKPOINT_BASELINE_MISMATCH')
      if (restored && restored.hmacKeyFingerprint !== hmacKeyValueFingerprint) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_CHECKPOINT_HMAC_KEY_MISMATCH')
      if (restored && restored.fromExclusive < baselineValue.snapshot.watermark) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_CURSOR_REGRESSION')
      let state = restored || Object.freeze({ checkpointState: 'new', target: targetValue, baseline: baselineValuePin, hmacKeyFingerprint: hmacKeyValueFingerprint, capturedAt: null, watermark: baselineValue.snapshot.watermark, fromExclusive: baselineValue.snapshot.watermark, deliveredCount: 0, batchCount: 0, acceptedCount: 0, idempotentCount: 0, reconciliationDigest: digest([]), revisionWatermarks: Object.freeze([]), pending: null })
      try {
        if (state.pending) {
          const receipt = await deliveryTransport.deliver({ batch: state.pending.batch, delivery: state.pending.delivery, requestId: state.pending.requestId })
          state = confirmedState(state, state.pending, receipt)
          await writeCheckpoint(privateCheckpointStore, makeCheckpoint(state))
        }
        const client = await pool.connect()
        let transactionOpen = false
        try {
          await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
          transactionOpen = true
          const snapshot = await preflightAtendimentoProjectionDeltaSource(client, { source: sourceDefinition })
          if (state.checkpointState === 'running') {
            // A recovered run must finish the source snapshot it had already
            // pinned. Advancing its watermark would allow rows which were not
            // part of that snapshot to cross the same checkpoint boundary.
            if (state.fromExclusive > state.watermark || snapshot.watermark < state.watermark) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE_REGRESSED')
          } else {
            if (state.fromExclusive > snapshot.watermark) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE_REGRESSED')
            state = Object.freeze({ ...state, checkpointState: 'running', capturedAt: snapshot.capturedAt, watermark: snapshot.watermark })
            await writeCheckpoint(privateCheckpointStore, makeCheckpoint(state))
          }
          const revisions = new Map(state.revisionWatermarks.map((entry) => [`${entry.unitSlug}:${entry.projectionReference}`, entry.revision]))
          while (state.fromExclusive < state.watermark) {
            const remaining = state.watermark - state.fromExclusive
            const limit = Math.min(pageSize, remaining)
            const rows = await readAtendimentoProjectionDeltaPage(client, { source: sourceDefinition, fromExclusive: state.fromExclusive, toInclusive: state.watermark, limit })
            if (rows.length < 1 || rows.length > limit) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE_GAP')
            const batch = assertAtendimentoProjectionDeltaBatch(createAtendimentoProjectionDeltaBatch({ rows, fromExclusive: state.fromExclusive, toInclusive: rows.at(-1).eventOrder, hmacKey: hmacKeyValue, keyId, target: targetValue }))
            for (const event of batch.events) {
              const revisionKey = `${event.unitScope.unitSlug}:${event.projection.reference}`
              const previousRevision = revisions.get(revisionKey)
              if (previousRevision !== undefined && event.revision <= previousRevision) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_REVISION_REGRESSION')
              // The explicit baseline may already have materialized revision 1
              // via the backfill. New identities may still begin at revision 1,
              // while existing ones legitimately resume at revision 2+.
              revisions.set(revisionKey, event.revision)
            }
            const signed = assertAtendimentoProjectionDeltaDelivery(await deliverySigner.signBatch(batch))
            if (signed.batchDigest !== digestAtendimentoProjectionDeltaBatch(batch)) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_DELIVERY_MISMATCH')
            const pending = Object.freeze({ batch, delivery: signed, requestId: `${REQUEST_ID_PREFIX}${String(state.batchCount + 1).padStart(6, '0')}` })
            state = Object.freeze({ ...state, revisionWatermarks: Object.freeze([...revisions].map(([key, revision]) => { const split = key.indexOf(':'); return { unitSlug: key.slice(0, split), projectionReference: key.slice(split + 1), revision } })), pending })
            await writeCheckpoint(privateCheckpointStore, makeCheckpoint(state))
            const receipt = await deliveryTransport.deliver({ batch, delivery: signed, requestId: pending.requestId })
            state = confirmedState(state, pending, receipt)
            await writeCheckpoint(privateCheckpointStore, makeCheckpoint(state))
          }
          const completed = makeCheckpoint({ ...state, checkpointState: 'completed', pending: null })
          const summary = completedSummary({ target: targetValue, baseline: baselineValuePin, capturedAt: completed.sourceSnapshot?.capturedAt || state.capturedAt, watermark: state.watermark, fromExclusive: state.fromExclusive, deliveredCount: state.deliveredCount, batchCount: state.batchCount, acceptedCount: state.acceptedCount, idempotentCount: state.idempotentCount, reconciliationDigest: state.reconciliationDigest })
          await completeCheckpoint(privateCheckpointStore, completed)
          await client.query('ROLLBACK')
          transactionOpen = false
          return summary
        } catch (error) {
          if (transactionOpen) { try { await client.query('ROLLBACK') } catch { /* preserve original */ } }
          throw error
        } finally { if (typeof client.release === 'function') client.release() }
      } catch (error) {
        if (knownError(error)) throw error
        fail('ATENDIMENTO_CRM_PROJECTION_DELTA_UNAVAILABLE')
      }
    },
  })
}

export const __testables = Object.freeze({ sameTarget, digest, hmacKeyFingerprint, revisionWatermarks, storedCheckpoint, makeCheckpoint })
