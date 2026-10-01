import { createHash, createHmac } from 'node:crypto'

import {
  ATENDIMENTO_CRM_PROJECTION_MAX_ROWS,
  assertAtendimentoProjectionBackfillBatch,
  assertAtendimentoProjectionExportTarget,
  assertAtendimentoProjectionSourceRow,
  assertAtendimentoUnitScopedProjectionSource,
  createAtendimentoProjectionBackfillBatch,
  digestAtendimentoProjectionBackfillBatch,
  preflightAtendimentoProjectionSource,
} from './atendimentoProjectionExporter.mjs'
import {
  assertAtendimentoProjectionBackfillDelivery,
} from './atendimentoProjectionBackfillDelivery.mjs'

export const ATENDIMENTO_CRM_PROJECTION_BACKFILL_RUNNER_VERSION = 'atendimento/crm-core-projection-backfill-runner/v2'
export const ATENDIMENTO_CRM_PROJECTION_BACKFILL_RUN_INTENT = 'atendimento/crm-core/staging-projection-backfill/v2'
export const ATENDIMENTO_CRM_PROJECTION_BACKFILL_MAX_EVENTS_PER_BATCH = 20

const CHECKPOINT_VERSION = 'atendimento/crm-core/projection-backfill-checkpoint/v3'
const REQUEST_ID_PREFIX = 'crm-atendimento-backfill-'
const SOURCE_CURSOR_TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{1,6})Z$/

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

function normalizedBatchSize(value) {
  const batchSize = value === undefined ? ATENDIMENTO_CRM_PROJECTION_BACKFILL_MAX_EVENTS_PER_BATCH : Number(value)
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > ATENDIMENTO_CRM_PROJECTION_BACKFILL_MAX_EVENTS_PER_BATCH) {
    fail('ATENDIMENTO_CRM_BACKFILL_RUNNER_BATCH_SIZE_INVALID')
  }
  return batchSize
}

function normalizedMaximumRows(value) {
  const maximumRows = value === undefined ? ATENDIMENTO_CRM_PROJECTION_MAX_ROWS : Number(value)
  if (!Number.isSafeInteger(maximumRows) || maximumRows < 1 || maximumRows > ATENDIMENTO_CRM_PROJECTION_MAX_ROWS) {
    fail('ATENDIMENTO_CRM_BACKFILL_RUNNER_MAX_ROWS_INVALID')
  }
  return maximumRows
}

function normalizedInteger(value, code, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail(code)
  return value
}

function normalizedTimestamp(value, code) {
  const parsed = new Date(String(value || '').trim())
  if (Number.isNaN(parsed.getTime())) fail(code)
  return parsed.toISOString()
}

// The source query deliberately emits a UTC, fixed-width microsecond string.
// JavaScript Date is used only for public event timestamps; this private
// cursor must retain all six digits so PostgreSQL keyset comparisons cannot
// fetch the final row of a page a second time.
function sourceCursorTimestamp(value, code) {
  const raw = String(value || '').trim()
  const match = SOURCE_CURSOR_TIMESTAMP.exec(raw)
  if (!match || Number.isNaN(new Date(raw).getTime())) fail(code)
  return `${match[1]}.${match[2].padEnd(6, '0')}Z`
}

function sameTarget(left, right) {
  return left.environment === right.environment
    && left.release === right.release
    && left.artifactDigest === right.artifactDigest
}

function sourceCursor(row) {
  const raw = object(row, 'ATENDIMENTO_CRM_BACKFILL_RUNNER_CURSOR_INVALID')
  const updatedAt = Object.hasOwn(raw, 'updated_at') ? raw.updated_at : raw.updatedAt
  const unitSlug = Object.hasOwn(raw, 'unit_slug') ? raw.unit_slug : raw.unitSlug
  const normalized = assertAtendimentoProjectionSourceRow({ id: raw.id, updated_at: updatedAt, unit_slug: unitSlug })
  return Object.freeze({
    updatedAt: sourceCursorTimestamp(updatedAt, 'ATENDIMENTO_CRM_BACKFILL_RUNNER_CURSOR_INVALID'),
    id: normalized.id,
    unitSlug: normalized.unitSlug,
  })
}

function compareCursor(left, right) {
  const timestampOrder = left.updatedAt.localeCompare(right.updatedAt)
  if (timestampOrder !== 0) return timestampOrder
  const idOrder = left.id.localeCompare(right.id)
  if (idOrder !== 0) return idOrder
  return left.unitSlug.localeCompare(right.unitSlug)
}

function pageRows(value, { limit, after } = {}) {
  if (!Array.isArray(value) || value.length === 0 || value.length > limit) {
    fail('ATENDIMENTO_CRM_BACKFILL_RUNNER_PAGE_INVALID')
  }
  const rows = []
  let previous = after || null
  for (const valueRow of value) {
    const raw = object(valueRow, 'ATENDIMENTO_CRM_BACKFILL_RUNNER_PAGE_INVALID')
    const row = assertAtendimentoProjectionSourceRow({
      id: raw.id,
      updated_at: Object.hasOwn(raw, 'updated_at') ? raw.updated_at : raw.updatedAt,
      unit_slug: Object.hasOwn(raw, 'unit_slug') ? raw.unit_slug : raw.unitSlug,
    })
    const cursor = sourceCursor(valueRow)
    if (previous && compareCursor(cursor, previous) <= 0) {
      fail('ATENDIMENTO_CRM_BACKFILL_RUNNER_CURSOR_INVALID')
    }
    rows.push(Object.freeze({ row, cursor }))
    previous = cursor
  }
  return Object.freeze(rows)
}

function sourceInputDigest(rows, hmacKey) {
  const digest = createHmac('sha256', hmacKey)
  digest.update('atendimento/crm-core/projection-backfill-source-input/v2\u0000')
  for (const { cursor } of rows) {
    digest.update(cursor.updatedAt).update('\u0000').update(cursor.id).update('\u0000').update(cursor.unitSlug).update('\n')
  }
  return `sha256:${digest.digest('hex')}`
}

async function preflightSourceInputDigest(client, { rowCount, hmacKey, source }) {
  if (rowCount === 0) return sourceInputDigest([], hmacKey)
  const result = await client.query(source.rowsSql, [rowCount])
  const rows = pageRows(result?.rows, { limit: rowCount })
  if (rows.length !== rowCount) fail('ATENDIMENTO_CRM_BACKFILL_RUNNER_SOURCE_INPUT_INVALID')
  return sourceInputDigest(rows, hmacKey)
}

function checkpointStore(value) {
  const store = object(value, 'ATENDIMENTO_CRM_BACKFILL_RUNNER_CHECKPOINT_STORE_REQUIRED')
  exactKeys(store, ['read', 'write', 'complete'], 'ATENDIMENTO_CRM_BACKFILL_RUNNER_CHECKPOINT_STORE_REQUIRED')
  if (typeof store.read !== 'function' || typeof store.write !== 'function' || typeof store.complete !== 'function') {
    fail('ATENDIMENTO_CRM_BACKFILL_RUNNER_CHECKPOINT_STORE_REQUIRED')
  }
  return store
}

function signer(value) {
  const normalized = object(value, 'ATENDIMENTO_CRM_BACKFILL_RUNNER_SIGNER_REQUIRED')
  if (typeof normalized.signBatch !== 'function') fail('ATENDIMENTO_CRM_BACKFILL_RUNNER_SIGNER_REQUIRED')
  return normalized
}

function transport(value) {
  const normalized = object(value, 'ATENDIMENTO_CRM_BACKFILL_RUNNER_TRANSPORT_REQUIRED')
  if (typeof normalized.deliver !== 'function') fail('ATENDIMENTO_CRM_BACKFILL_RUNNER_TRANSPORT_REQUIRED')
  return normalized
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  }
  return value
}

function digest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`
}

function nextReconciliationDigest(previous, record) {
  return digest({ previous, record })
}

function storedCursor(value, code) {
  if (value === null) return null
  const cursor = object(value, code)
  exactKeys(cursor, ['updatedAt', 'id', 'unitSlug'], code)
  return sourceCursor({ updatedAt: cursor.updatedAt, id: cursor.id, unitSlug: cursor.unitSlug })
}

function storedPending(value, { target, capturedAt, code }) {
  if (value === null) return null
  const pending = object(value, code)
  exactKeys(pending, ['batch', 'delivery', 'requestId', 'cursorAfter'], code)
  if (!/^crm-atendimento-backfill-\d{6}$/.test(String(pending.requestId || ''))) fail(code)
  const batch = assertAtendimentoProjectionBackfillBatch(pending.batch)
  const delivery = assertAtendimentoProjectionBackfillDelivery(pending.delivery)
  const cursorAfter = storedCursor(pending.cursorAfter, code)
  if (
    batch.events.length < 1
    || batch.events.length > ATENDIMENTO_CRM_PROJECTION_BACKFILL_MAX_EVENTS_PER_BATCH
    || !cursorAfter
    || !sameTarget(batch.target, target)
    || batch.sourceSnapshot.capturedAt !== capturedAt
    || delivery.batchDigest !== digestAtendimentoProjectionBackfillBatch(batch)
    || !delivery.keyId.startsWith(`crm-${target.environment}-atendimento-backfill-`)
  ) fail(code)
  return Object.freeze({
    batch,
    delivery,
    requestId: pending.requestId,
    cursorAfter,
  })
}

function storedCheckpoint(value) {
  const checkpointValue = object(value, 'ATENDIMENTO_CRM_BACKFILL_RUNNER_CHECKPOINT_INVALID')
  exactKeys(checkpointValue, ['contractVersion', 'state', 'target', 'sourceSnapshot', 'progress', 'cursor', 'pending'], 'ATENDIMENTO_CRM_BACKFILL_RUNNER_CHECKPOINT_INVALID')
  const sourceSnapshot = object(checkpointValue.sourceSnapshot, 'ATENDIMENTO_CRM_BACKFILL_RUNNER_CHECKPOINT_INVALID')
  const progress = object(checkpointValue.progress, 'ATENDIMENTO_CRM_BACKFILL_RUNNER_CHECKPOINT_INVALID')
  exactKeys(sourceSnapshot, ['capturedAt', 'rowCount', 'inputDigest'], 'ATENDIMENTO_CRM_BACKFILL_RUNNER_CHECKPOINT_INVALID')
  exactKeys(progress, ['deliveredCount', 'batchCount', 'acceptedCount', 'idempotentCount', 'reconciliationDigest'], 'ATENDIMENTO_CRM_BACKFILL_RUNNER_CHECKPOINT_INVALID')
  if (
    checkpointValue.contractVersion !== CHECKPOINT_VERSION
    || checkpointValue.state !== 'running'
    || !/^sha256:[a-f0-9]{64}$/.test(String(progress.reconciliationDigest || ''))
  ) fail('ATENDIMENTO_CRM_BACKFILL_RUNNER_CHECKPOINT_INVALID')
  const target = assertAtendimentoProjectionExportTarget(checkpointValue.target)
  const rowCount = normalizedInteger(sourceSnapshot.rowCount, 'ATENDIMENTO_CRM_BACKFILL_RUNNER_CHECKPOINT_INVALID')
  if (!/^sha256:[a-f0-9]{64}$/.test(String(sourceSnapshot.inputDigest || ''))) {
    fail('ATENDIMENTO_CRM_BACKFILL_RUNNER_CHECKPOINT_INVALID')
  }
  const deliveredCount = normalizedInteger(progress.deliveredCount, 'ATENDIMENTO_CRM_BACKFILL_RUNNER_CHECKPOINT_INVALID', { maximum: rowCount })
  const batchCount = normalizedInteger(progress.batchCount, 'ATENDIMENTO_CRM_BACKFILL_RUNNER_CHECKPOINT_INVALID')
  const acceptedCount = normalizedInteger(progress.acceptedCount, 'ATENDIMENTO_CRM_BACKFILL_RUNNER_CHECKPOINT_INVALID')
  const idempotentCount = normalizedInteger(progress.idempotentCount, 'ATENDIMENTO_CRM_BACKFILL_RUNNER_CHECKPOINT_INVALID')
  if (
    acceptedCount + idempotentCount !== batchCount
    || (deliveredCount === 0 && batchCount !== 0)
    || (deliveredCount > 0 && (batchCount === 0 || batchCount > deliveredCount))
  ) fail('ATENDIMENTO_CRM_BACKFILL_RUNNER_CHECKPOINT_INVALID')
  const cursor = storedCursor(checkpointValue.cursor, 'ATENDIMENTO_CRM_BACKFILL_RUNNER_CHECKPOINT_INVALID')
  const capturedAt = normalizedTimestamp(sourceSnapshot.capturedAt, 'ATENDIMENTO_CRM_BACKFILL_RUNNER_CHECKPOINT_INVALID')
  const pending = storedPending(checkpointValue.pending, {
    target,
    capturedAt,
    code: 'ATENDIMENTO_CRM_BACKFILL_RUNNER_CHECKPOINT_INVALID',
  })
  if ((deliveredCount === 0) !== (cursor === null)) fail('ATENDIMENTO_CRM_BACKFILL_RUNNER_CHECKPOINT_INVALID')
  if (pending && cursor && compareCursor(pending.cursorAfter, cursor) <= 0) fail('ATENDIMENTO_CRM_BACKFILL_RUNNER_CHECKPOINT_INVALID')
  if (pending && deliveredCount + pending.batch.events.length > rowCount) fail('ATENDIMENTO_CRM_BACKFILL_RUNNER_CHECKPOINT_INVALID')
  return Object.freeze({
    target,
    capturedAt,
    sourceRowCount: rowCount,
    sourceInputDigest: sourceSnapshot.inputDigest,
    deliveredCount,
    batchCount,
    acceptedCount,
    idempotentCount,
    reconciliationDigest: progress.reconciliationDigest,
    cursor,
    pending,
  })
}

function checkpoint({ target, capturedAt, sourceRowCount, sourceInputDigest, deliveredCount, batchCount, acceptedCount, idempotentCount, reconciliationDigest, cursor, pending }) {
  return Object.freeze({
    contractVersion: CHECKPOINT_VERSION,
    state: 'running',
    target: Object.freeze({ ...target }),
    sourceSnapshot: Object.freeze({ capturedAt, rowCount: sourceRowCount, inputDigest: sourceInputDigest }),
    progress: Object.freeze({ deliveredCount, batchCount, acceptedCount, idempotentCount, reconciliationDigest }),
    // This cursor contains the source UUID and is deliberately supplied only to
    // the private checkpoint capability. It never appears in HTTP or results.
    cursor: cursor ? Object.freeze({ ...cursor }) : null,
    pending: pending ? Object.freeze({
      batch: pending.batch,
      delivery: pending.delivery,
      requestId: pending.requestId,
      cursorAfter: Object.freeze({ ...pending.cursorAfter }),
    }) : null,
  })
}

function completedSummary({ target, capturedAt, sourceRowCount, deliveredCount, batchCount, acceptedCount, idempotentCount, reconciliationDigest }) {
  return Object.freeze({
    contractVersion: 'atendimento/crm-core/projection-backfill-reconciliation/v1',
    status: 'reconciled',
    target: Object.freeze({ ...target }),
    sourceSnapshot: Object.freeze({ capturedAt, rowCount: sourceRowCount }),
    deliveredCount,
    batchCount,
    acceptedCount,
    idempotentCount,
    reconciliationDigest,
  })
}

async function readCheckpoint(store) {
  try {
    return await store.read()
  } catch {
    fail('ATENDIMENTO_CRM_BACKFILL_RUNNER_CHECKPOINT_UNAVAILABLE')
  }
}

async function writeCheckpoint(store, value) {
  try {
    await store.write(value)
  } catch {
    fail('ATENDIMENTO_CRM_BACKFILL_RUNNER_CHECKPOINT_UNAVAILABLE')
  }
}

async function completeCheckpoint(store, value) {
  try {
    await store.complete(value)
  } catch {
    fail('ATENDIMENTO_CRM_BACKFILL_RUNNER_CHECKPOINT_UNAVAILABLE')
  }
}

function confirmedCheckpointState(state, pending, receipt) {
  if (!receipt || !['accepted', 'idempotent'].includes(receipt.status)) {
    fail('ATENDIMENTO_CRM_BACKFILL_RUNNER_RECONCILIATION_FAILED')
  }
  const record = Object.freeze({
    batchId: pending.batch.batchId,
    batchDigest: pending.delivery.batchDigest,
    eventCount: pending.batch.events.length,
    status: receipt.status,
  })
  return Object.freeze({
    ...state,
    deliveredCount: state.deliveredCount + pending.batch.events.length,
    batchCount: state.batchCount + 1,
    acceptedCount: state.acceptedCount + (receipt.status === 'accepted' ? 1 : 0),
    idempotentCount: state.idempotentCount + (receipt.status === 'idempotent' ? 1 : 0),
    reconciliationDigest: nextReconciliationDigest(state.reconciliationDigest, record),
    cursor: pending.cursorAfter,
    pending: null,
  })
}

function knownError(error) {
  return error instanceof Error && /^ATENDIMENTO_CRM_(?:PROJECTION_EXPORT|BACKFILL)_[A-Z_]+$/.test(error.message)
}

/**
 * Creates an explicit staging-only runner. It has no CLI, environment lookup,
 * database construction or network default: all capabilities are injected by
 * an operator-owned caller. A pending opaque packet can be replayed before a
 * new source transaction opens. Further pagination is allowed only when the
 * new repeatable-read snapshot has the same bounded source-input HMAC digest
 * and row count; transaction_timestamp itself is not resumable across runs.
 */
export function createPaginatedAtendimentoProjectionBackfillRunner({
  pool,
  source,
  hmacKey,
  keyId,
  target,
  signer: suppliedSigner,
  transport: suppliedTransport,
  checkpointStore: suppliedCheckpointStore,
  batchSize,
  maxRows,
} = {}) {
  if (!pool || typeof pool.connect !== 'function') fail('ATENDIMENTO_CRM_BACKFILL_RUNNER_POOL_REQUIRED')
  const pageSize = normalizedBatchSize(batchSize)
  const maximumRows = normalizedMaximumRows(maxRows)
  // The owner-defined query family is verified before the pool is connected,
  // so the historic two-column identity query cannot be selected by a caller.
  const sourceDefinition = assertAtendimentoUnitScopedProjectionSource(source)
  const targetValue = assertAtendimentoProjectionExportTarget(target)
  if (targetValue.environment !== 'staging') fail('ATENDIMENTO_CRM_BACKFILL_RUNNER_STAGING_ONLY')
  const deliverySigner = signer(suppliedSigner)
  const deliveryTransport = transport(suppliedTransport)
  const privateCheckpointStore = checkpointStore(suppliedCheckpointStore)

  return Object.freeze({
    version: ATENDIMENTO_CRM_PROJECTION_BACKFILL_RUNNER_VERSION,
    target: targetValue,
    async run({ intent } = {}) {
      if (intent !== ATENDIMENTO_CRM_PROJECTION_BACKFILL_RUN_INTENT) {
        fail('ATENDIMENTO_CRM_BACKFILL_RUNNER_INTENT_REQUIRED')
      }
      const existing = await readCheckpoint(privateCheckpointStore)
      let restored = null
      if (existing !== null && existing !== undefined) {
        try {
          restored = storedCheckpoint(existing)
        } catch {
          fail('ATENDIMENTO_CRM_BACKFILL_RUNNER_CHECKPOINT_RECOVERY_REQUIRED')
        }
      }

      // Never replay a signed packet through a transport configured for a
      // different CRM artifact. This comparison deliberately precedes both
      // the pending delivery and any source connection.
      if (restored && !sameTarget(restored.target, targetValue)) {
        fail('ATENDIMENTO_CRM_BACKFILL_RUNNER_CHECKPOINT_TARGET_MISMATCH')
      }

      let client
      let transactionOpen = false
      try {
        if (restored?.pending) {
          const receipt = await deliveryTransport.deliver({
            batch: restored.pending.batch,
            delivery: restored.pending.delivery,
            requestId: restored.pending.requestId,
          })
          restored = confirmedCheckpointState(restored, restored.pending, receipt)
          await writeCheckpoint(privateCheckpointStore, checkpoint(restored))
        }

        client = await pool.connect()
        if (!client || typeof client.query !== 'function') fail('ATENDIMENTO_CRM_BACKFILL_RUNNER_CLIENT_INVALID')
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        transactionOpen = true

        const sourceSnapshot = await preflightAtendimentoProjectionSource(client, {
          maxRows: maximumRows,
          source: sourceDefinition,
        })
        const capturedAt = sourceSnapshot.capturedAt
        const sourceRowCount = sourceSnapshot.rowCount
        const currentSourceInputDigest = await preflightSourceInputDigest(client, {
          rowCount: sourceRowCount,
          hmacKey,
          source: sourceDefinition,
        })
        let state
        if (restored) {
          if (
            restored.sourceRowCount !== sourceRowCount
            || restored.sourceInputDigest !== currentSourceInputDigest
          ) fail('ATENDIMENTO_CRM_BACKFILL_RUNNER_CHECKPOINT_SNAPSHOT_MISMATCH')
          state = restored
        } else {
          state = Object.freeze({
            target: targetValue,
            capturedAt,
            sourceRowCount,
            sourceInputDigest: currentSourceInputDigest,
            deliveredCount: 0,
            batchCount: 0,
            acceptedCount: 0,
            idempotentCount: 0,
            reconciliationDigest: digest([]),
            cursor: null,
            pending: null,
          })
          await writeCheckpoint(privateCheckpointStore, checkpoint(state))
        }

        while (state.deliveredCount < sourceRowCount) {
          const remaining = sourceRowCount - state.deliveredCount
          const limit = Math.min(pageSize, remaining)
          const result = state.cursor
            ? await client.query(sourceDefinition.nextPageSql, [
              state.cursor.updatedAt,
              state.cursor.id,
              state.cursor.unitSlug,
              limit,
            ])
            : await client.query(sourceDefinition.firstPageSql, [limit])
          const page = pageRows(result?.rows, { limit, after: state.cursor })
          const rows = page.map(({ row }) => row)
          if (rows.length > remaining) fail('ATENDIMENTO_CRM_BACKFILL_RUNNER_RECONCILIATION_FAILED')

          const batch = createAtendimentoProjectionBackfillBatch({
            rows,
            capturedAt,
            hmacKey,
            keyId,
            target: targetValue,
          })
          if (batch.events.length > ATENDIMENTO_CRM_PROJECTION_BACKFILL_MAX_EVENTS_PER_BATCH) {
            fail('ATENDIMENTO_CRM_BACKFILL_RUNNER_BATCH_SIZE_INVALID')
          }
          const delivery = assertAtendimentoProjectionBackfillDelivery(await deliverySigner.signBatch(batch))
          if (delivery.batchDigest !== digestAtendimentoProjectionBackfillBatch(batch)) {
            fail('ATENDIMENTO_CRM_BACKFILL_RUNNER_DELIVERY_MISMATCH')
          }
          const cursorAfter = page.at(-1).cursor
          const requestId = `${REQUEST_ID_PREFIX}${String(state.batchCount + 1).padStart(6, '0')}`
          const pending = Object.freeze({
            batch,
            delivery,
            requestId,
            cursorAfter,
          })
          state = Object.freeze({ ...state, pending })
          await writeCheckpoint(privateCheckpointStore, checkpoint(state))

          const receipt = await deliveryTransport.deliver({ batch, delivery, requestId })
          state = confirmedCheckpointState(state, pending, receipt)
          await writeCheckpoint(privateCheckpointStore, checkpoint(state))
        }

        if (state.deliveredCount !== sourceRowCount) fail('ATENDIMENTO_CRM_BACKFILL_RUNNER_RECONCILIATION_FAILED')
        const summary = completedSummary({
          target: targetValue,
          capturedAt,
          sourceRowCount,
          deliveredCount: state.deliveredCount,
          batchCount: state.batchCount,
          acceptedCount: state.acceptedCount,
          idempotentCount: state.idempotentCount,
          reconciliationDigest: state.reconciliationDigest,
        })
        await completeCheckpoint(privateCheckpointStore, summary)
        await client.query('ROLLBACK')
        transactionOpen = false
        return summary
      } catch (error) {
        if (transactionOpen) {
          try {
            await client?.query('ROLLBACK')
          } catch {
            // The original fail-closed error remains the observable outcome.
          }
        }
        if (knownError(error)) throw error
        fail('ATENDIMENTO_CRM_BACKFILL_RUNNER_UNAVAILABLE')
      } finally {
        if (client && typeof client.release === 'function') client.release()
      }
    },
  })
}
