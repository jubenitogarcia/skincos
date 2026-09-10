import { createHash, createHmac } from 'node:crypto'

// Neutral, transport-free v2 batch contract.  Both the Atendimento exporter
// and CRM's atomic baseline preparation use this code; neither runtime imports
// the other to derive opaque client references.
export const ATENDIMENTO_CRM_PROJECTION_BACKFILL_MAX_EVENTS = 20

const CONTRACT = 'skincos-crm/projection-backfill-batch/v2'
const SCOPE = 'global-client-identities/v1'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/
const RELEASE_PATTERN = /^[0-9a-f]{40}$/
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{3,96}$/
const OPAQUE_PART_PATTERN = /^[A-Za-z0-9_-]{8,160}$/
const UNIT_SLUG_PATTERN = /^(?!all$|unknown$)[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const SOURCE_TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{1,6})Z$/

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

function sourceTimestamp(value, code) {
  const raw = value instanceof Date ? value.toISOString() : text(value, code)
  const match = SOURCE_TIMESTAMP_PATTERN.exec(raw)
  if (!match || Number.isNaN(new Date(raw).getTime())) fail(code)
  return `${match[1]}.${match[2].padEnd(6, '0')}Z`
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

function unitSlug(value, code) {
  const normalized = text(value, code)
  if (normalized !== normalized.toLowerCase() || !UNIT_SLUG_PATTERN.test(normalized)) fail(code)
  return normalized
}

function target(value) {
  const descriptor = object(value, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_TARGET_INVALID')
  exactKeys(descriptor, ['environment', 'release', 'artifactDigest'], 'ATENDIMENTO_CRM_PROJECTION_EXPORT_TARGET_INVALID')
  const environment = text(descriptor.environment, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_TARGET_INVALID')
  const release = text(descriptor.release, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_TARGET_INVALID').toLowerCase()
  const artifactDigest = text(descriptor.artifactDigest, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_TARGET_INVALID').toLowerCase()
  if (!['staging', 'production'].includes(environment) || !RELEASE_PATTERN.test(release) || !SHA256_PATTERN.test(artifactDigest)) {
    fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_TARGET_INVALID')
  }
  return Object.freeze({ environment, release, artifactDigest })
}

function sourceRow(value) {
  const row = object(value, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_ROW_INVALID')
  exactKeys(row, ['id', 'updated_at', 'unit_slug'], 'ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_ROW_INVALID')
  const id = text(row.id, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_ROW_INVALID').toLowerCase()
  if (!UUID_PATTERN.test(id)) fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_ROW_INVALID')
  return Object.freeze({
    id,
    updatedAt: timestamp(row.updated_at, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_ROW_INVALID'),
    sourceUpdatedAt: sourceTimestamp(row.updated_at, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_ROW_INVALID'),
    unitSlug: unitSlug(row.unit_slug, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_ROW_INVALID'),
  })
}

function normalizedSourceRow(value) {
  const row = object(value, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_ROW_INVALID')
  if (
    Object.keys(row).length === 4
    && Object.hasOwn(row, 'id')
    && Object.hasOwn(row, 'updatedAt')
    && Object.hasOwn(row, 'sourceUpdatedAt')
    && Object.hasOwn(row, 'unitSlug')
  ) {
    const normalized = sourceRow({
      id: row.id,
      updated_at: row.sourceUpdatedAt,
      unit_slug: row.unitSlug,
    })
    if (timestamp(row.updatedAt, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_ROW_INVALID') !== normalized.updatedAt) {
      fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_ROW_INVALID')
    }
    return normalized
  }
  return sourceRow(row)
}

function sourceRows(value) {
  if (!Array.isArray(value) || value.length > ATENDIMENTO_CRM_PROJECTION_BACKFILL_MAX_EVENTS) {
    fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_READBACK_INVALID')
  }
  const rows = value.map(normalizedSourceRow).sort((left, right) => (
    left.sourceUpdatedAt.localeCompare(right.sourceUpdatedAt)
    || left.id.localeCompare(right.id)
    || left.unitSlug.localeCompare(right.unitSlug)
  ))
  const identities = new Set()
  for (const row of rows) {
    const key = `${row.id}\u0000${row.unitSlug}`
    if (identities.has(key)) fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_READBACK_INVALID')
    identities.add(key)
  }
  if (rows.length === 0) fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  return Object.freeze(rows)
}

function eventFromSourceRow(row, { key }) {
  const sourceReference = hmacReference(key, 'source-reference/v2', row.id, 'source')
  const projectionReference = hmacReference(key, 'projection-reference/v2', row.id, 'projection')
  const eventId = hmacReference(
    key,
    'projection-event/v2',
    `${sourceReference}\u0000${projectionReference}\u0000${row.unitSlug}\u0000${row.sourceUpdatedAt}\u00001\u0000upsert`,
    'event',
  )
  return Object.freeze({
    contractVersion: 'crm-projection-event/v2',
    id: eventId,
    projection: Object.freeze({ reference: projectionReference, kind: 'client-reference' }),
    source: Object.freeze({ owner: 'atendimento', reference: sourceReference }),
    unitScope: Object.freeze({ unitSlug: row.unitSlug }),
    revision: 1,
    operation: 'upsert',
    occurredAt: row.updatedAt,
  })
}

function cursorDigest(capturedAt, events) {
  return sha256({
    contract: CONTRACT,
    scope: SCOPE,
    capturedAt,
    sourceReferences: events.map((event) => event.source.reference),
    unitSlugs: events.map((event) => event.unitScope.unitSlug),
  })
}

function batchId(key, keyIdentifier, capturedAt, eventsDigest) {
  return `backfill:atendimento:${hmacPart(key, 'projection-backfill-batch/v2', `${keyIdentifier}\u0000${capturedAt}\u0000${eventsDigest}`)}`
}

/**
 * Creates one deterministic, opaque v2 batch.  It never opens a connection,
 * reads an owner database, serializes source identifiers, or performs delivery.
 */
export function createAtendimentoProjectionBackfillBatch({
  rows,
  capturedAt,
  hmacKey: suppliedHmacKey,
  keyId: suppliedKeyId,
  target: suppliedTarget,
} = {}) {
  const key = hmacKey(suppliedHmacKey)
  const keyIdentifier = keyId(suppliedKeyId)
  const targetValue = target(suppliedTarget)
  const normalizedCapturedAt = timestamp(capturedAt, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_SNAPSHOT_INVALID')
  const normalizedRows = sourceRows(rows)
  const events = Object.freeze(normalizedRows.map((row) => eventFromSourceRow(row, { key })))
  const eventsDigest = sha256(events)
  return Object.freeze({
    contract: CONTRACT,
    batchId: batchId(key, keyIdentifier, normalizedCapturedAt, eventsDigest),
    producer: Object.freeze({ owner: 'atendimento', scope: SCOPE, keyId: keyIdentifier }),
    sourceSnapshot: Object.freeze({
      capturedAt: normalizedCapturedAt,
      cursorDigest: cursorDigest(normalizedCapturedAt, events),
      rowCount: normalizedRows.length,
      unitSlugs: Object.freeze([...new Set(events.map((event) => event.unitScope.unitSlug))].sort()),
    }),
    target: targetValue,
    events,
    integrity: Object.freeze({ algorithm: 'sha256', eventCount: events.length, eventsDigest }),
  })
}
