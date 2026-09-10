import { createHash } from 'node:crypto'
import {
  ATENDIMENTO_CRM_PROJECTION_BACKFILL_MAX_EVENTS as SHARED_ATENDIMENTO_CRM_PROJECTION_BACKFILL_MAX_EVENTS,
  createAtendimentoProjectionBackfillBatch as createSharedAtendimentoProjectionBackfillBatch,
} from '../../../../shared/crm-auth/atendimentoProjectionBackfillBatch.js'

export const ATENDIMENTO_CRM_PROJECTION_EXPORTER_VERSION = 'atendimento/crm-core-projection-exporter/v2'
export const CRM_PROJECTION_BACKFILL_BATCH_VERSION = 'skincos-crm/projection-backfill-batch/v2'
export const ATENDIMENTO_PROJECTION_SCOPE = 'global-client-identities/v1'
export const ATENDIMENTO_CRM_PROJECTION_MAX_ROWS = 10_000
export const ATENDIMENTO_CRM_PROJECTION_BACKFILL_MAX_EVENTS = SHARED_ATENDIMENTO_CRM_PROJECTION_BACKFILL_MAX_EVENTS
export const ATENDIMENTO_UNIT_SCOPED_PROJECTION_SOURCE_CONTRACT = 'atendimento/crm-core/unit-scoped-projection-source/v1'

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

// These retired v1 queries deliberately remain named as legacy evidence only.
// They are never selected by this exporter: a v2 caller must inject an owner
// source contract with an explicit canonical `unit_slug` for every emitted row.
export const ATENDIMENTO_PROJECTION_EXPORT_LEGACY_COUNT_SQL = `SELECT count(*)::int AS row_count
FROM crm_atendimento.global_client_identities`
export const ATENDIMENTO_PROJECTION_EXPORT_LEGACY_ROWS_SQL = `SELECT id::text AS id,
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
FROM crm_atendimento.global_client_identities
ORDER BY updated_at ASC, id ASC
LIMIT $1`
export const ATENDIMENTO_PROJECTION_EXPORT_LEGACY_FIRST_PAGE_SQL = `SELECT id::text AS id,
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
FROM crm_atendimento.global_client_identities
ORDER BY updated_at ASC, id ASC
LIMIT $1`
export const ATENDIMENTO_PROJECTION_EXPORT_LEGACY_NEXT_PAGE_SQL = `SELECT id::text AS id,
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
FROM crm_atendimento.global_client_identities
WHERE (updated_at, id) > ($1::timestamptz, $2::uuid)
ORDER BY updated_at ASC, id ASC
LIMIT $3`

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/
const RELEASE_PATTERN = /^[0-9a-f]{40}$/
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{3,96}$/
const UNIT_SLUG_PATTERN = /^(?!all$|unknown$)[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const SOURCE_TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{1,6})Z$/
const SOURCE_QUERY_FORBIDDEN = /\b(?:alter|call|copy|create|delete|drop|grant|insert|merge|offset|revoke|truncate|update|vacuum)\b/i
const REQUIRED_SOURCE_ALIAS_PATTERNS = Object.freeze({
  id: /\bas\s+(?:"id"|id)\b/i,
  updated_at: /\bas\s+(?:"updated_at"|updated_at)\b/i,
  unit_slug: /\bas\s+(?:"unit_slug"|unit_slug)\b/i,
  row_count: /\bas\s+(?:"row_count"|row_count)\b/i,
})

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
  const normalized = value === undefined ? ATENDIMENTO_CRM_PROJECTION_MAX_ROWS : Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > ATENDIMENTO_CRM_PROJECTION_MAX_ROWS) {
    fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_MAX_ROWS_INVALID')
  }
  return normalized
}

function maximumBatchRows(value) {
  const normalized = value === undefined ? ATENDIMENTO_CRM_PROJECTION_BACKFILL_MAX_EVENTS : Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > ATENDIMENTO_CRM_PROJECTION_BACKFILL_MAX_EVENTS) {
    fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_SIZE_INVALID')
  }
  return normalized
}

function unitSlug(value, code) {
  const normalized = text(value, code)
  if (normalized !== normalized.toLowerCase() || !UNIT_SLUG_PATTERN.test(normalized)) fail(code)
  return normalized
}

function startsReadOnlyQuery(sql) {
  let cursor = 0
  while (cursor < sql.length) {
    while (cursor < sql.length && /\s/.test(sql[cursor])) cursor += 1
    if (!sql.startsWith('/*', cursor)) break
    const commentEnd = sql.indexOf('*/', cursor + 2)
    if (commentEnd < 0) return false
    cursor = commentEnd + 2
  }
  return /^(?:select|with)\b/i.test(sql.slice(cursor))
}

function sourceQuery(value, code, requiredAliases = []) {
  const sql = text(value, code)
  if (
    sql.length > 32_768
    || sql.includes(';')
    || SOURCE_QUERY_FORBIDDEN.test(sql)
    || !startsReadOnlyQuery(sql)
  ) fail(code)
  for (const alias of requiredAliases) {
    const pattern = REQUIRED_SOURCE_ALIAS_PATTERNS[alias]
    if (!pattern || !pattern.test(sql)) fail(code)
  }
  return sql
}

function sourcePageQuery(value, code, { parameters, keyset = false } = {}) {
  const sql = sourceQuery(value, code, ['id', 'updated_at', 'unit_slug'])
  const actualParameters = [...sql.matchAll(/\$(\d+)\b/g)].map((match) => Number(match[1]))
  const orderedTuple = /\border\s+by\s+(?:[A-Za-z_][A-Za-z0-9_]*\.)?updated_at\s+asc\s*,\s*(?:[A-Za-z_][A-Za-z0-9_]*\.)?id\s+asc\s*,\s*(?:[A-Za-z_][A-Za-z0-9_]*\.)?unit_slug\s+asc\s*\blimit\b/i
  const keysetTuple = /\bwhere\b[\s\S]*?\bupdated_at\b[\s\S]*?\bid\b[\s\S]*?\bunit_slug\b/i
  if (
    !orderedTuple.test(sql)
    || actualParameters.length === 0
    || new Set(actualParameters).size !== actualParameters.length
    || actualParameters.some((parameter) => !parameters.includes(parameter))
    || parameters.some((parameter) => !actualParameters.includes(parameter))
    || (keyset && !keysetTuple.test(sql))
  ) fail(code)
  return sql
}

/**
 * Validates a source owned by Atendimento. The export adapter does not know
 * how a global identity maps to units and intentionally offers no default SQL.
 * The owner must attest an immutable read-only query family that emits exactly
 * one row per canonical identity/unit membership.
 */
export function assertAtendimentoUnitScopedProjectionSource(value) {
  const source = object(value, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_REQUIRED')
  exactKeys(source, ['contract', 'countSql', 'rowsSql', 'firstPageSql', 'nextPageSql'], 'ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_INVALID')
  if (source.contract !== ATENDIMENTO_UNIT_SCOPED_PROJECTION_SOURCE_CONTRACT) {
    fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_INVALID')
  }
  return Object.freeze({
    contract: ATENDIMENTO_UNIT_SCOPED_PROJECTION_SOURCE_CONTRACT,
    countSql: sourceQuery(source.countSql, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_INVALID', ['row_count']),
    rowsSql: sourcePageQuery(source.rowsSql, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_INVALID', { parameters: [1] }),
    firstPageSql: sourcePageQuery(source.firstPageSql, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_INVALID', { parameters: [1] }),
    nextPageSql: sourcePageQuery(source.nextPageSql, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_INVALID', {
      parameters: [1, 2, 3, 4],
      keyset: true,
    }),
  })
}

export function createAtendimentoUnitScopedProjectionSource(value) {
  return assertAtendimentoUnitScopedProjectionSource(value)
}

export function assertAtendimentoProjectionExportTarget(value) {
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

export function assertAtendimentoProjectionSourceRow(value) {
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
    const normalized = assertAtendimentoProjectionSourceRow({
      id: row.id,
      updated_at: row.sourceUpdatedAt,
      unit_slug: row.unitSlug,
    })
    if (timestamp(row.updatedAt, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_ROW_INVALID') !== normalized.updatedAt) {
      fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_ROW_INVALID')
    }
    return normalized
  }
  return assertAtendimentoProjectionSourceRow(row)
}

function compareSourceRows(left, right) {
  return left.sourceUpdatedAt.localeCompare(right.sourceUpdatedAt)
    || left.id.localeCompare(right.id)
    || left.unitSlug.localeCompare(right.unitSlug)
}

function sourceRows(value, expectedCount) {
  if (!Array.isArray(value) || value.length !== expectedCount || value.length > ATENDIMENTO_CRM_PROJECTION_BACKFILL_MAX_EVENTS) {
    fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_READBACK_INVALID')
  }
  const rows = value.map(normalizedSourceRow).sort(compareSourceRows)
  const identities = new Set()
  for (const row of rows) {
    const key = `${row.id}\u0000${row.unitSlug}`
    if (identities.has(key)) fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_READBACK_INVALID')
    identities.add(key)
  }
  return Object.freeze(rows)
}

/**
 * Attests an already-open source transaction before the owner-defined unit
 * mapping is selected. A missing source or a legacy two-column query fails
 * closed before any domain row is requested.
 */
export async function preflightAtendimentoProjectionSource(client, { maxRows, source } = {}) {
  if (!client || typeof client.query !== 'function') fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_CLIENT_INVALID')
  const limit = maximumRows(maxRows)
  const sourceDefinition = assertAtendimentoUnitScopedProjectionSource(source)

  const identityResult = await client.query(ATENDIMENTO_PROJECTION_EXPORT_IDENTITY_SQL)
  const identity = sourceIdentity(identityResult?.rows?.[0])

  const snapshotResult = await client.query(ATENDIMENTO_PROJECTION_EXPORT_SNAPSHOT_SQL)
  const capturedAt = timestamp(snapshotResult?.rows?.[0]?.captured_at, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_SNAPSHOT_INVALID')

  const countResult = await client.query(sourceDefinition.countSql)
  const rowCount = Number(countResult?.rows?.[0]?.row_count)
  if (!Number.isSafeInteger(rowCount) || rowCount < 0) fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_COUNT_INVALID')
  if (rowCount > limit) fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_LIMIT_EXCEEDED')

  return Object.freeze({ identity, capturedAt, rowCount, source: sourceDefinition })
}

function assertProjectionEvent(value) {
  const event = object(value, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  exactKeys(event, ['contractVersion', 'id', 'projection', 'source', 'unitScope', 'revision', 'operation', 'occurredAt'], 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  const projection = object(event.projection, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  const source = object(event.source, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  const scope = object(event.unitScope, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  exactKeys(projection, ['reference', 'kind'], 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  exactKeys(source, ['owner', 'reference'], 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  exactKeys(scope, ['unitSlug'], 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  if (
    event.contractVersion !== 'crm-projection-event/v2'
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
    contractVersion: 'crm-projection-event/v2',
    id: event.id,
    projection: Object.freeze({ reference: projection.reference, kind: projection.kind }),
    source: Object.freeze({ owner: source.owner, reference: source.reference }),
    unitScope: Object.freeze({ unitSlug: unitSlug(scope.unitSlug, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID') }),
    revision: event.revision,
    operation: event.operation,
    occurredAt: timestamp(event.occurredAt, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID'),
  })
}

function batchCursorDigest(capturedAt, events) {
  return sha256({
    contract: CRM_PROJECTION_BACKFILL_BATCH_VERSION,
    scope: ATENDIMENTO_PROJECTION_SCOPE,
    capturedAt,
    sourceReferences: events.map((event) => event.source.reference),
    unitSlugs: events.map((event) => event.unitScope.unitSlug),
  })
}

function uniqueUnitSlugs(events) {
  return Object.freeze([...new Set(events.map((event) => event.unitScope.unitSlug))].sort())
}

/**
 * Builds one bounded opaque CRM v2 batch from a unit-scoped owner page. This
 * function has no transport or source database side effect.
 */
export function createAtendimentoProjectionBackfillBatch({
  rows,
  capturedAt,
  hmacKey: suppliedHmacKey,
  keyId: suppliedKeyId,
  target,
} = {}) {
  return assertAtendimentoProjectionBackfillBatch(createSharedAtendimentoProjectionBackfillBatch({
    rows,
    capturedAt,
    hmacKey: suppliedHmacKey,
    keyId: suppliedKeyId,
    target,
  }))
}

export function assertAtendimentoProjectionBackfillBatch(value) {
  const batch = object(value, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  exactKeys(batch, ['contract', 'batchId', 'producer', 'sourceSnapshot', 'target', 'events', 'integrity'], 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  const producer = object(batch.producer, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  const sourceSnapshot = object(batch.sourceSnapshot, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  const integrity = object(batch.integrity, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  exactKeys(producer, ['owner', 'scope', 'keyId'], 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  exactKeys(sourceSnapshot, ['capturedAt', 'cursorDigest', 'rowCount', 'unitSlugs'], 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  exactKeys(integrity, ['algorithm', 'eventCount', 'eventsDigest'], 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  if (
    batch.contract !== CRM_PROJECTION_BACKFILL_BATCH_VERSION
    || !/^backfill:atendimento:[A-Za-z0-9_-]{8,160}$/.test(text(batch.batchId, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID'))
    || producer.owner !== 'atendimento'
    || producer.scope !== ATENDIMENTO_PROJECTION_SCOPE
    || !KEY_ID_PATTERN.test(text(producer.keyId, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID'))
    || !SHA256_PATTERN.test(text(sourceSnapshot.cursorDigest, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID'))
    || !Number.isSafeInteger(sourceSnapshot.rowCount)
    || sourceSnapshot.rowCount < 1
    || sourceSnapshot.rowCount > ATENDIMENTO_CRM_PROJECTION_BACKFILL_MAX_EVENTS
    || !Array.isArray(sourceSnapshot.unitSlugs)
    || sourceSnapshot.unitSlugs.length < 1
    || sourceSnapshot.unitSlugs.length > ATENDIMENTO_CRM_PROJECTION_BACKFILL_MAX_EVENTS
    || integrity.algorithm !== 'sha256'
    || !Number.isSafeInteger(integrity.eventCount)
    || integrity.eventCount < 1
    || integrity.eventCount > ATENDIMENTO_CRM_PROJECTION_BACKFILL_MAX_EVENTS
    || !SHA256_PATTERN.test(text(integrity.eventsDigest, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID'))
  ) {
    fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  }
  const capturedAt = timestamp(sourceSnapshot.capturedAt, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  const target = assertAtendimentoProjectionExportTarget(batch.target)
  if (!Array.isArray(batch.events) || batch.events.length !== sourceSnapshot.rowCount || batch.events.length !== integrity.eventCount) {
    fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  }
  const events = Object.freeze(batch.events.map(assertProjectionEvent))
  const identifiers = new Set()
  const projectionKeys = new Set()
  for (const event of events) {
    const projectionKey = `${event.unitScope.unitSlug}:${event.projection.reference}`
    if (identifiers.has(event.id) || projectionKeys.has(projectionKey)) fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
    identifiers.add(event.id)
    projectionKeys.add(projectionKey)
  }
  const unitSlugs = sourceSnapshot.unitSlugs.map((value) => unitSlug(value, 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')).sort()
  if (new Set(unitSlugs).size !== unitSlugs.length || JSON.stringify(unitSlugs) !== JSON.stringify(uniqueUnitSlugs(events))) {
    fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  }
  if (integrity.eventsDigest !== sha256(events) || sourceSnapshot.cursorDigest !== batchCursorDigest(capturedAt, events)) {
    fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID')
  }
  return Object.freeze({
    contract: CRM_PROJECTION_BACKFILL_BATCH_VERSION,
    batchId: batch.batchId,
    producer: Object.freeze({ owner: producer.owner, scope: producer.scope, keyId: producer.keyId }),
    sourceSnapshot: Object.freeze({
      capturedAt,
      cursorDigest: sourceSnapshot.cursorDigest,
      rowCount: sourceSnapshot.rowCount,
      unitSlugs: Object.freeze(unitSlugs),
    }),
    target,
    events,
    integrity: Object.freeze({ algorithm: integrity.algorithm, eventCount: integrity.eventCount, eventsDigest: integrity.eventsDigest }),
  })
}

/** Matches the CRM Core v2 canonical digest without importing its source tree. */
export function digestAtendimentoProjectionBackfillBatch(value) {
  return sha256(assertAtendimentoProjectionBackfillBatch(value))
}

function knownError(error) {
  return error instanceof Error && /^ATENDIMENTO_CRM_PROJECTION_EXPORT_[A-Z_]+$/.test(error.message)
}

/**
 * Exports exactly one bounded unit-scoped snapshot. This compatibility helper
 * is intentionally capped to the CRM receiver batch maximum; larger work uses
 * the paginated runner and a private checkpoint.
 */
export async function exportAtendimentoClientProjectionBatch({
  pool,
  source,
  hmacKey: suppliedHmacKey,
  keyId: suppliedKeyId,
  target,
  maxRows,
} = {}) {
  if (!pool || typeof pool.connect !== 'function') fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_POOL_REQUIRED')
  const key = hmacKey(suppliedHmacKey)
  const keyIdentifier = keyId(suppliedKeyId)
  const targetValue = assertAtendimentoProjectionExportTarget(target)
  const sourceDefinition = assertAtendimentoUnitScopedProjectionSource(source)
  const limit = maximumBatchRows(maxRows)
  let client
  let transactionOpen = false

  try {
    client = await pool.connect()
    if (!client || typeof client.query !== 'function') fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_CLIENT_INVALID')
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    transactionOpen = true

    const { capturedAt, rowCount } = await preflightAtendimentoProjectionSource(client, { maxRows: limit, source: sourceDefinition })
    const rowsResult = await client.query(sourceDefinition.rowsSql, [rowCount])
    const rows = sourceRows(rowsResult?.rows, rowCount)
    const batch = createAtendimentoProjectionBackfillBatch({
      rows,
      capturedAt,
      hmacKey: key,
      keyId: keyIdentifier,
      target: targetValue,
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
