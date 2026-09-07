import { createHash, createHmac } from 'node:crypto'

export const ATENDIMENTO_CRM_PROJECTION_EXPORTER_VERSION = 'atendimento/crm-core-projection-exporter/v1'
export const CRM_PROJECTION_BACKFILL_BATCH_VERSION = 'skincos-crm/projection-backfill-batch/v1'
export const ATENDIMENTO_PROJECTION_SCOPE = 'global-client-identities/v1'

export const ATENDIMENTO_PROJECTION_EXPORTER_DATABASE = Object.freeze({
  database: 'skincos_clientes_production',
  user: 'crm_core_projection_exporter',
})

export const ATENDIMENTO_PROJECTION_EXPORT_IDENTITY_SQL = `SELECT
  current_database() AS database_name,
  current_user AS current_user,
  session_user AS session_user,
  current_setting('transaction_read_only') AS transaction_read_only`

export const ATENDIMENTO_PROJECTION_EXPORT_SNAPSHOT_SQL = 'SELECT transaction_timestamp()::timestamptz AS captured_at'

export const ATENDIMENTO_PROJECTION_EXPORT_COUNT_SQL = `SELECT count(*)::int AS row_count
FROM crm_atendimento.global_client_identities`

// This source query deliberately has no join and no selectable field beyond the
// stable identity UUID and its revision timestamp. The UUID is converted to an
// HMAC reference in memory before anything leaves this adapter.
export const ATENDIMENTO_PROJECTION_EXPORT_ROWS_SQL = `SELECT id::text AS id, updated_at
FROM crm_atendimento.global_client_identities
ORDER BY updated_at ASC, id ASC
LIMIT $1`

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/
const RELEASE_PATTERN = /^[0-9a-f]{40}$/
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{3,96}$/
const OPAQUE_PART_PATTERN = /^[A-Za-z0-9_-]{8,160}$/
const MAX_ROWS = 10_000

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

function text(value, code) {
  const normalized = String(value || '').trim()
  if (!normalized) fail(code)
  return normalized
}

function timestamp(value, code) {
  const parsed = value instanceof Date ? value : new Date(String(value || '').trim())
  if (Number.isNaN(parsed.getTime())) fail(code)
  return parsed.toISOString()
}

function canonicalize(value) {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  }
  return value
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`
}

function hmacPart(key, namespace, value) {
  return createHmac('sha256', key).update(`${namespace}\u0000${value}`).digest('base64url')
}

function hmacReference(key, namespace, value, prefix) {
  const valuePart = hmacPart(key, namespace, value)
  if (!OPAQUE_PART_PATTERN.test(valuePart)) fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_HMAC_INVALID')
  return `${prefix}:${valuePart}`
}

function hmacKey(value) {
  const key = text(value, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_HMAC_KEY_REQUIRED')
  if (Buffer.byteLength(key, 'utf8') < 32) fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_HMAC_KEY_UNSAFE')
  return key
}

function keyId(value) {
  const normalized = text(value, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_KEY_ID_INVALID')
  if (!KEY_ID_PATTERN.test(normalized)) fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_KEY_ID_INVALID')
  return normalized
}

function maximumRows(value) {
  const normalized = value === undefined ? MAX_ROWS : Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > MAX_ROWS) {
    fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_MAX_ROWS_INVALID')
  }
  return normalized
}

function targetDescriptor(value) {
  const target = object(value, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_TARGET_INVALID')
  exactKeys(target, ['environment', 'release', 'artifactDigest'], 'ATENDIMENTO_CRM_PROJECTION_EXPORT_TARGET_INVALID')
  const environment = text(target.environment, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_TARGET_INVALID')
  const release = text(target.release, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_TARGET_INVALID').toLowerCase()
  const artifactDigest = text(target.artifactDigest, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_TARGET_INVALID').toLowerCase()
  if (!['staging', 'production'].includes(environment) || !RELEASE_PATTERN.test(release) || !SHA256_PATTERN.test(artifactDigest)) {
    fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_TARGET_INVALID')
  }
  return Object.freeze({ environment, release, artifactDigest })
}

function sourceIdentity(value) {
  const identity = object(value, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_IDENTITY_INVALID')
  const database = text(identity.database_name, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_IDENTITY_INVALID')
  const currentUser = text(identity.current_user, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_IDENTITY_INVALID')
  const sessionUser = text(identity.session_user, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_IDENTITY_INVALID')
  const readOnly = text(identity.transaction_read_only, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_IDENTITY_INVALID').toLowerCase()
  if (
    database !== ATENDIMENTO_PROJECTION_EXPORTER_DATABASE.database
    || currentUser !== ATENDIMENTO_PROJECTION_EXPORTER_DATABASE.user
    || sessionUser !== ATENDIMENTO_PROJECTION_EXPORTER_DATABASE.user
    || readOnly !== 'on'
  ) {
    fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_IDENTITY_UNSAFE')
  }
  return Object.freeze({ database, currentUser, sessionUser, readOnly })
}

function sourceRow(value) {
  const row = object(value, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_ROW_INVALID')
  exactKeys(row, ['id', 'updated_at'], 'ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_ROW_INVALID')
  const id = text(row.id, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_ROW_INVALID').toLowerCase()
  if (!UUID_PATTERN.test(id)) fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_ROW_INVALID')
  return Object.freeze({
    id,
    updatedAt: timestamp(row.updated_at, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_ROW_INVALID'),
  })
}

function sourceRows(value, expectedCount) {
  if (!Array.isArray(value) || value.length !== expectedCount) fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_READBACK_INVALID')
  const identifiers = new Set()
  const rows = value.map(sourceRow)
  for (const row of rows) {
    if (identifiers.has(row.id)) fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_READBACK_INVALID')
    identifiers.add(row.id)
  }
  return Object.freeze(rows)
}

function eventFromSourceRow(row, { key, capturedAt }) {
  const sourceReference = hmacReference(key, 'source-reference/v1', row.id, 'source')
  const projectionReference = hmacReference(key, 'projection-reference/v1', row.id, 'projection')
  const eventId = hmacReference(
    key,
    'projection-event/v1',
    `${sourceReference}\u0000${projectionReference}\u0000${row.updatedAt}\u00001\u0000upsert`,
    'event',
  )
  return Object.freeze({
    contractVersion: 'crm-projection-event/v1',
    id: eventId,
    projection: Object.freeze({ reference: projectionReference, kind: 'client-reference' }),
    source: Object.freeze({ owner: 'atendimento', reference: sourceReference }),
    revision: 1,
    operation: 'upsert',
    occurredAt: row.updatedAt,
    // Deliberately do not include source UUID, snapshot timestamp, or any
    // contact field in the event. `capturedAt` participates only in batch ID.
  })
}

function assertProjectionEvent(value) {
  const event = object(value, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  exactKeys(event, ['contractVersion', 'id', 'projection', 'source', 'revision', 'operation', 'occurredAt'], 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  const projection = object(event.projection, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  const source = object(event.source, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  exactKeys(projection, ['reference', 'kind'], 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  exactKeys(source, ['owner', 'reference'], 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  if (
    event.contractVersion !== 'crm-projection-event/v1'
    || !/^event:[A-Za-z0-9_-]{8,160}$/.test(text(event.id, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID'))
    || !/^projection:[A-Za-z0-9_-]{8,160}$/.test(text(projection.reference, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID'))
    || projection.kind !== 'client-reference'
    || source.owner !== 'atendimento'
    || !/^source:[A-Za-z0-9_-]{8,160}$/.test(text(source.reference, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID'))
    || !Number.isSafeInteger(event.revision) || event.revision !== 1
    || event.operation !== 'upsert'
  ) {
    fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  }
  return Object.freeze({
    contractVersion: event.contractVersion,
    id: event.id,
    projection: Object.freeze({ reference: projection.reference, kind: projection.kind }),
    source: Object.freeze({ owner: source.owner, reference: source.reference }),
    revision: event.revision,
    operation: event.operation,
    occurredAt: timestamp(event.occurredAt, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID'),
  })
}

function batchId(key, keyIdentifier, capturedAt, eventsDigest) {
  return `backfill:atendimento:${hmacPart(key, 'projection-backfill-batch/v1', `${keyIdentifier}\u0000${capturedAt}\u0000${eventsDigest}`)}`
}

function batchCursorDigest(capturedAt, events) {
  return sha256({
    contract: CRM_PROJECTION_BACKFILL_BATCH_VERSION,
    scope: ATENDIMENTO_PROJECTION_SCOPE,
    capturedAt,
    sourceReferences: events.map((event) => event.source.reference),
  })
}

export function assertAtendimentoProjectionBackfillBatch(value) {
  const batch = object(value, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  exactKeys(batch, ['contract', 'batchId', 'producer', 'sourceSnapshot', 'target', 'events', 'integrity'], 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  const producer = object(batch.producer, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  const sourceSnapshot = object(batch.sourceSnapshot, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  const integrity = object(batch.integrity, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  exactKeys(producer, ['owner', 'scope', 'keyId'], 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  exactKeys(sourceSnapshot, ['capturedAt', 'cursorDigest', 'rowCount'], 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  exactKeys(integrity, ['algorithm', 'eventCount', 'eventsDigest'], 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  if (
    batch.contract !== CRM_PROJECTION_BACKFILL_BATCH_VERSION
    || !/^backfill:atendimento:[A-Za-z0-9_-]{8,160}$/.test(text(batch.batchId, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID'))
    || producer.owner !== 'atendimento'
    || producer.scope !== ATENDIMENTO_PROJECTION_SCOPE
    || !KEY_ID_PATTERN.test(text(producer.keyId, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID'))
    || !SHA256_PATTERN.test(text(sourceSnapshot.cursorDigest, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID'))
    || !Number.isSafeInteger(sourceSnapshot.rowCount) || sourceSnapshot.rowCount < 0
    || integrity.algorithm !== 'sha256'
    || !Number.isSafeInteger(integrity.eventCount) || integrity.eventCount < 0
    || !SHA256_PATTERN.test(text(integrity.eventsDigest, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID'))
  ) {
    fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  }
  const capturedAt = timestamp(sourceSnapshot.capturedAt, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  const target = targetDescriptor(batch.target)
  if (!Array.isArray(batch.events) || batch.events.length !== sourceSnapshot.rowCount || batch.events.length !== integrity.eventCount) {
    fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  }
  const events = Object.freeze(batch.events.map(assertProjectionEvent))
  const identifiers = new Set()
  for (const event of events) {
    if (identifiers.has(event.id)) fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
    identifiers.add(event.id)
  }
  if (integrity.eventsDigest !== sha256(events) || sourceSnapshot.cursorDigest !== batchCursorDigest(capturedAt, events)) {
    fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  }
  return Object.freeze({
    contract: batch.contract,
    batchId: batch.batchId,
    producer: Object.freeze({ owner: producer.owner, scope: producer.scope, keyId: producer.keyId }),
    sourceSnapshot: Object.freeze({ capturedAt, cursorDigest: sourceSnapshot.cursorDigest, rowCount: sourceSnapshot.rowCount }),
    target,
    events,
    integrity: Object.freeze({ algorithm: integrity.algorithm, eventCount: integrity.eventCount, eventsDigest: integrity.eventsDigest }),
  })
}

function knownError(error) {
  return error instanceof Error && /^ATENDIMENTO_CRM_PROJECTION_EXPORT_[A-Z_]+$/.test(error.message)
}

/**
 * Export exactly one bounded, repeatable-read snapshot of Atendimento global
 * identities. It never writes to the source, never returns source UUIDs, and
 * fails rather than silently paginating an incomplete historical backfill.
 */
export async function exportAtendimentoClientProjectionBatch({
  pool,
  hmacKey: suppliedHmacKey,
  keyId: suppliedKeyId,
  target,
  maxRows,
} = {}) {
  if (!pool || typeof pool.connect !== 'function') fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_POOL_REQUIRED')
  const key = hmacKey(suppliedHmacKey)
  const keyIdentifier = keyId(suppliedKeyId)
  const targetValue = targetDescriptor(target)
  const limit = maximumRows(maxRows)
  let client
  let transactionOpen = false

  try {
    client = await pool.connect()
    if (!client || typeof client.query !== 'function') fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_CLIENT_INVALID')
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    transactionOpen = true

    const identityResult = await client.query(ATENDIMENTO_PROJECTION_EXPORT_IDENTITY_SQL)
    sourceIdentity(identityResult?.rows?.[0])

    const snapshotResult = await client.query(ATENDIMENTO_PROJECTION_EXPORT_SNAPSHOT_SQL)
    const capturedAt = timestamp(snapshotResult?.rows?.[0]?.captured_at, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_SNAPSHOT_INVALID')

    const countResult = await client.query(ATENDIMENTO_PROJECTION_EXPORT_COUNT_SQL)
    const rowCount = Number(countResult?.rows?.[0]?.row_count)
    if (!Number.isSafeInteger(rowCount) || rowCount < 0) fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_COUNT_INVALID')
    if (rowCount > limit) fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_LIMIT_EXCEEDED')

    const rowsResult = await client.query(ATENDIMENTO_PROJECTION_EXPORT_ROWS_SQL, [rowCount])
    const rows = sourceRows(rowsResult?.rows, rowCount)
    const events = Object.freeze(rows.map((row) => eventFromSourceRow(row, { key, capturedAt })))
    const eventsDigest = sha256(events)
    const cursorDigest = batchCursorDigest(capturedAt, events)
    const batch = assertAtendimentoProjectionBackfillBatch({
      contract: CRM_PROJECTION_BACKFILL_BATCH_VERSION,
      batchId: batchId(key, keyIdentifier, capturedAt, eventsDigest),
      producer: { owner: 'atendimento', scope: ATENDIMENTO_PROJECTION_SCOPE, keyId: keyIdentifier },
      sourceSnapshot: { capturedAt, cursorDigest, rowCount },
      target: targetValue,
      events,
      integrity: { algorithm: 'sha256', eventCount: events.length, eventsDigest },
    })

    await client.query('ROLLBACK')
    transactionOpen = false
    return batch
  } catch (error) {
    if (transactionOpen) {
      try {
        await client?.query('ROLLBACK')
      } catch {
        // The original fail-closed code remains the only observable error.
      }
    }
    if (knownError(error)) throw error
    fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_UNAVAILABLE')
  } finally {
    if (client && typeof client.release === 'function') client.release()
  }
}
