import { createHash, createHmac } from 'node:crypto'

import {
  assertAtendimentoProjectionExportTarget,
} from './atendimentoProjectionExporter.mjs'

export { assertAtendimentoProjectionExportTarget }

export const ATENDIMENTO_CRM_PROJECTION_DELTA_EXPORTER_VERSION = 'atendimento/crm-core/projection-delta-exporter/v1'
export const ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_VERSION = 'skincos-crm/projection-delta-batch/v1'
export const ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE_CONTRACT = 'atendimento/crm-core/projection-delta-source/v1'
export const ATENDIMENTO_CRM_PROJECTION_DELTA_SCOPE = 'global-client-identities/v1'
export const ATENDIMENTO_CRM_PROJECTION_DELTA_MAX_EVENTS_PER_BATCH = 20

export const ATENDIMENTO_CRM_PROJECTION_DELTA_DATABASE = Object.freeze({
  database: 'skincos_clientes_production',
  user: 'crm_core_projection_exporter',
})

export const ATENDIMENTO_CRM_PROJECTION_DELTA_IDENTITY_SQL = `SELECT
  current_database() AS database_name,
  current_user AS current_user,
  session_user AS session_user,
  current_setting('transaction_read_only') AS transaction_read_only`

export const ATENDIMENTO_CRM_PROJECTION_DELTA_SNAPSHOT_SQL = 'SELECT transaction_timestamp()::timestamptz AS captured_at'

// The owner-facing source only exposes opaque identity UUIDs and outbox
// ordering material. It never selects a customer attribute or a raw source
// payload. The SQL is still injected into a read-only transaction by the
// operator so source ownership can be attested independently.
export const ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE = Object.freeze({
  contract: ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE_CONTRACT,
  identitySql: ATENDIMENTO_CRM_PROJECTION_DELTA_IDENTITY_SQL,
  snapshotSql: ATENDIMENTO_CRM_PROJECTION_DELTA_SNAPSHOT_SQL,
  watermarkSql: `SELECT COALESCE(MAX(event_order), 0)::bigint AS watermark
FROM crm_atendimento.crm_core_projection_outbox`,
  firstPageSql: `SELECT
  event_order AS event_order,
  event_id AS event_id,
  identity_id AS identity_id,
  unit_slug AS unit_slug,
  revision AS revision,
  operation AS operation,
  occurred_at AS occurred_at
FROM crm_atendimento.crm_core_projection_outbox
WHERE event_order <= $1
ORDER BY event_order ASC
LIMIT $2`,
  nextPageSql: `SELECT
  event_order AS event_order,
  event_id AS event_id,
  identity_id AS identity_id,
  unit_slug AS unit_slug,
  revision AS revision,
  operation AS operation,
  occurred_at AS occurred_at
FROM crm_atendimento.crm_core_projection_outbox
WHERE event_order > $1 AND event_order <= $2
ORDER BY event_order ASC
LIMIT $3`,
})

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{3,96}$/
const OPAQUE_PATTERN = /^[A-Za-z0-9_-]{8,160}$/
const SOURCE_TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{1,6})Z$/
const UNIT_SLUG_PATTERN = /^(?!all$|unknown$)[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const FORBIDDEN_SQL = /\b(?:alter|call|copy|create|delete|drop|grant|insert|merge|offset|revoke|truncate|update|vacuum)\b/i
const REQUIRED_SOURCE_ALIAS_PATTERNS = Object.freeze({
  database_name: /\bas\s+(?:"database_name"|database_name)\b/i,
  current_user: /\bas\s+(?:"current_user"|current_user)\b/i,
  session_user: /\bas\s+(?:"session_user"|session_user)\b/i,
  transaction_read_only: /\bas\s+(?:"transaction_read_only"|transaction_read_only)\b/i,
  captured_at: /\bas\s+(?:"captured_at"|captured_at)\b/i,
  watermark: /\bas\s+(?:"watermark"|watermark)\b/i,
  event_order: /\bas\s+(?:"event_order"|event_order)\b/i,
  event_id: /\bas\s+(?:"event_id"|event_id)\b/i,
  identity_id: /\bas\s+(?:"identity_id"|identity_id)\b/i,
  unit_slug: /\bas\s+(?:"unit_slug"|unit_slug)\b/i,
  revision: /\bas\s+(?:"revision"|revision)\b/i,
  operation: /\bas\s+(?:"operation"|operation)\b/i,
  occurred_at: /\bas\s+(?:"occurred_at"|occurred_at)\b/i,
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
  const normalized = String(value ?? '').trim()
  if (!normalized) fail(code)
  return normalized
}

function timestamp(value, code) {
  const parsed = value instanceof Date ? value : new Date(String(value ?? '').trim())
  if (Number.isNaN(parsed.getTime())) fail(code)
  return parsed.toISOString()
}

function sourceTimestamp(value, code) {
  const raw = value instanceof Date ? value.toISOString() : text(value, code)
  const match = SOURCE_TIMESTAMP_PATTERN.exec(raw)
  if (!match || Number.isNaN(new Date(raw).getTime())) fail(code)
  return `${match[1]}.${match[2].padEnd(6, '0')}Z`
}

function uuid(value, code) {
  const normalized = text(value, code).toLowerCase()
  if (!UUID_PATTERN.test(normalized)) fail(code)
  return normalized
}

function unitSlug(value, code) {
  const normalized = text(value, code)
  if (normalized !== normalized.toLowerCase() || !UNIT_SLUG_PATTERN.test(normalized)) fail(code)
  return normalized
}

function positiveInteger(value, code) {
  const normalized = Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < 1) fail(code)
  return normalized
}

function nonNegativeInteger(value, code) {
  const normalized = Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < 0) fail(code)
  return normalized
}

function hmacKey(value) {
  const key = text(value, 'ATENDIMENTO_CRM_PROJECTION_DELTA_HMAC_KEY_REQUIRED')
  if (Buffer.byteLength(key, 'utf8') < 32) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_HMAC_KEY_UNSAFE')
  return key
}

function keyId(value) {
  const normalized = text(value, 'ATENDIMENTO_CRM_PROJECTION_DELTA_KEY_ID_INVALID')
  if (!KEY_ID_PATTERN.test(normalized)) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_KEY_ID_INVALID')
  return normalized
}

function hmacPart(key, namespace, value) {
  return createHmac('sha256', key).update(`${namespace}\u0000${value}`).digest('base64url')
}

function hmacReference(key, namespace, value, prefix) {
  const part = hmacPart(key, namespace, value)
  if (!OPAQUE_PATTERN.test(part)) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_HMAC_INVALID')
  return `${prefix}:${part}`
}

function canonicalize(value) {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  return value
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`
}

function sourceSql(value, code, aliases = []) {
  const sql = text(value, code)
  if (sql.length > 32_768 || sql.includes(';') || FORBIDDEN_SQL.test(sql) || !/^(?:select|with)\b/i.test(sql)) fail(code)
  for (const alias of aliases) {
    const pattern = REQUIRED_SOURCE_ALIAS_PATTERNS[alias]
    if (!pattern || !pattern.test(sql)) fail(code)
  }
  return sql
}

function pageSql(value, code, parameters, expectedParameters) {
  const sql = sourceSql(value, code, ['event_order', 'event_id', 'identity_id', 'unit_slug', 'revision', 'operation', 'occurred_at'])
  const actual = [...sql.matchAll(/\$(\d+)\b/g)].map((match) => Number(match[1]))
  if (
    actual.length !== expectedParameters.length
    || new Set(actual).size !== actual.length
    || actual.some((parameter) => !parameters.includes(parameter))
    || parameters.some((parameter) => !actual.includes(parameter))
    || !/\border\s+by\s+(?:[A-Za-z_][A-Za-z0-9_]*\.)?event_order\s+asc\s*\blimit\b/i.test(sql)
  ) fail(code)
  return sql
}

export function assertAtendimentoProjectionDeltaSource(value) {
  const source = object(value, 'ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE_REQUIRED')
  exactKeys(source, ['contract', 'identitySql', 'snapshotSql', 'watermarkSql', 'firstPageSql', 'nextPageSql'], 'ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE_INVALID')
  if (source.contract !== ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE_CONTRACT) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE_INVALID')
  const identitySql = sourceSql(source.identitySql, 'ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE_INVALID', ['database_name', 'current_user', 'session_user', 'transaction_read_only'])
  const snapshotSql = sourceSql(source.snapshotSql, 'ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE_INVALID', ['captured_at'])
  const watermarkSql = sourceSql(source.watermarkSql, 'ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE_INVALID', ['watermark'])
  const firstPageSql = pageSql(source.firstPageSql, 'ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE_INVALID', [1, 2], [1, 2])
  const nextPageSql = pageSql(source.nextPageSql, 'ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE_INVALID', [1, 2, 3], [1, 2, 3])
  return Object.freeze({ contract: ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE_CONTRACT, identitySql, snapshotSql, watermarkSql, firstPageSql, nextPageSql })
}

export function createAtendimentoProjectionDeltaSource(value) {
  return assertAtendimentoProjectionDeltaSource(value)
}

function sourceIdentity(value) {
  const identity = object(value, 'ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE_IDENTITY_INVALID')
  const database = text(identity.database_name, 'ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE_IDENTITY_INVALID')
  const currentUser = text(identity.current_user, 'ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE_IDENTITY_INVALID')
  const sessionUser = text(identity.session_user, 'ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE_IDENTITY_INVALID')
  const readOnly = text(identity.transaction_read_only, 'ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE_IDENTITY_INVALID').toLowerCase()
  if (database !== ATENDIMENTO_CRM_PROJECTION_DELTA_DATABASE.database || currentUser !== ATENDIMENTO_CRM_PROJECTION_DELTA_DATABASE.user || sessionUser !== ATENDIMENTO_CRM_PROJECTION_DELTA_DATABASE.user || readOnly !== 'on') {
    fail('ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE_IDENTITY_UNSAFE')
  }
  return Object.freeze({ database, currentUser, sessionUser, readOnly })
}

export function assertAtendimentoProjectionDeltaRow(value) {
  const row = object(value, 'ATENDIMENTO_CRM_PROJECTION_DELTA_ROW_INVALID')
  const eventOrder = positiveInteger(row.event_order ?? row.eventOrder, 'ATENDIMENTO_CRM_PROJECTION_DELTA_ROW_INVALID')
  const eventId = uuid(row.event_id ?? row.eventId, 'ATENDIMENTO_CRM_PROJECTION_DELTA_ROW_INVALID')
  const identityId = uuid(row.identity_id ?? row.identityId, 'ATENDIMENTO_CRM_PROJECTION_DELTA_ROW_INVALID')
  const unit = unitSlug(row.unit_slug ?? row.unitSlug, 'ATENDIMENTO_CRM_PROJECTION_DELTA_ROW_INVALID')
  const rowRevision = positiveInteger(row.revision, 'ATENDIMENTO_CRM_PROJECTION_DELTA_ROW_INVALID')
  const operation = text(row.operation, 'ATENDIMENTO_CRM_PROJECTION_DELTA_ROW_INVALID')
  if (!['upsert', 'revoke'].includes(operation)) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_ROW_INVALID')
  return Object.freeze({ eventOrder, eventId, identityId, unitSlug: unit, revision: rowRevision, operation, occurredAt: timestamp(row.occurred_at ?? row.occurredAt, 'ATENDIMENTO_CRM_PROJECTION_DELTA_ROW_INVALID'), sourceOccurredAt: sourceTimestamp(row.occurred_at ?? row.occurredAt, 'ATENDIMENTO_CRM_PROJECTION_DELTA_ROW_INVALID') })
}

function deltaRows(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > ATENDIMENTO_CRM_PROJECTION_DELTA_MAX_EVENTS_PER_BATCH) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_INVALID')
  const rows = value.map(assertAtendimentoProjectionDeltaRow)
  const orders = new Set()
  for (const row of rows) {
    if (orders.has(row.eventOrder)) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_INVALID')
    orders.add(row.eventOrder)
  }
  return Object.freeze(rows.sort((left, right) => left.eventOrder - right.eventOrder))
}

function sameTarget(left, right) {
  return left.environment === right.environment && left.release === right.release && left.artifactDigest === right.artifactDigest
}

function eventFromRow(row, { key }) {
  const sourceReference = hmacReference(key, 'source-reference/v2', row.identityId, 'source')
  const projectionReference = hmacReference(key, 'projection-reference/v2', row.identityId, 'projection')
  const eventId = hmacReference(key, 'projection-delta-event/v1', `${row.eventOrder}\u0000${row.eventId}\u0000${row.identityId}\u0000${row.unitSlug}\u0000${row.revision}\u0000${row.operation}\u0000${row.sourceOccurredAt}`, 'event')
  return Object.freeze({
    contractVersion: 'crm-projection-event/v2',
    id: eventId,
    projection: Object.freeze({ reference: projectionReference, kind: 'client-reference' }),
    source: Object.freeze({ owner: 'atendimento', reference: sourceReference }),
    unitScope: Object.freeze({ unitSlug: row.unitSlug }),
    revision: row.revision,
    operation: row.operation,
    occurredAt: row.occurredAt,
  })
}

function assertEvent(value) {
  const event = object(value, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_INVALID')
  exactKeys(event, ['contractVersion', 'id', 'projection', 'source', 'unitScope', 'revision', 'operation', 'occurredAt'], 'ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_INVALID')
  const projection = object(event.projection, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_INVALID')
  const source = object(event.source, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_INVALID')
  const scope = object(event.unitScope, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_INVALID')
  exactKeys(projection, ['reference', 'kind'], 'ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_INVALID')
  exactKeys(source, ['owner', 'reference'], 'ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_INVALID')
  exactKeys(scope, ['unitSlug'], 'ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_INVALID')
  if (event.contractVersion !== 'crm-projection-event/v2' || !/^event:[A-Za-z0-9_-]{8,160}$/.test(text(event.id, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_INVALID')) || !/^projection:[A-Za-z0-9_-]{8,160}$/.test(text(projection.reference, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_INVALID')) || projection.kind !== 'client-reference' || source.owner !== 'atendimento' || !/^source:[A-Za-z0-9_-]{8,160}$/.test(text(source.reference, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_INVALID')) || !Number.isSafeInteger(event.revision) || event.revision < 1 || !['upsert', 'revoke'].includes(event.operation)) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_INVALID')
  return Object.freeze({ contractVersion: event.contractVersion, id: event.id, projection: Object.freeze({ reference: projection.reference, kind: projection.kind }), source: Object.freeze({ owner: source.owner, reference: source.reference }), unitScope: Object.freeze({ unitSlug: unitSlug(scope.unitSlug, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_INVALID') }), revision: event.revision, operation: event.operation, occurredAt: timestamp(event.occurredAt, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_INVALID') })
}

function batchId(key, keyIdentifier, fromExclusive, toInclusive, eventsDigest) {
  return `delta:atendimento:${hmacPart(key, 'projection-delta-batch/v1', `${keyIdentifier}\u0000${fromExclusive}\u0000${toInclusive}\u0000${eventsDigest}`)}`
}

function eventsDigest(events) {
  return sha256(events)
}

export function createAtendimentoProjectionDeltaBatch({ rows, fromExclusive, toInclusive, hmacKey: suppliedHmacKey, keyId: suppliedKeyId, target } = {}) {
  const key = hmacKey(suppliedHmacKey)
  const keyIdentifier = keyId(suppliedKeyId)
  const targetValue = assertAtendimentoProjectionExportTarget(target)
  const normalizedRows = deltaRows(rows)
  const from = nonNegativeInteger(fromExclusive, 'ATENDIMENTO_CRM_PROJECTION_DELTA_CURSOR_INVALID')
  const to = positiveInteger(toInclusive, 'ATENDIMENTO_CRM_PROJECTION_DELTA_CURSOR_INVALID')
  if (to <= from || normalizedRows[0].eventOrder <= from || normalizedRows.at(-1).eventOrder !== to) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_CURSOR_GAP')
  for (let index = 1; index < normalizedRows.length; index += 1) {
    if (normalizedRows[index].eventOrder <= normalizedRows[index - 1].eventOrder) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_CURSOR_GAP')
  }
  const events = Object.freeze(normalizedRows.map((row) => eventFromRow(row, { key })))
  const digest = eventsDigest(events)
  return assertAtendimentoProjectionDeltaBatch({
    contract: ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_VERSION,
    batchId: batchId(key, keyIdentifier, from, to, digest),
    producer: { owner: 'atendimento', scope: ATENDIMENTO_CRM_PROJECTION_DELTA_SCOPE, keyId: keyIdentifier },
    sourceDelta: { fromExclusive: from, toInclusive: to, rowCount: events.length },
    target: targetValue,
    events,
    integrity: { algorithm: 'sha256', eventCount: events.length, eventsDigest: digest },
  })
}

export function assertAtendimentoProjectionDeltaBatch(value) {
  const batch = object(value, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_INVALID')
  exactKeys(batch, ['contract', 'batchId', 'producer', 'sourceDelta', 'target', 'events', 'integrity'], 'ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_INVALID')
  const producer = object(batch.producer, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_INVALID')
  const sourceDelta = object(batch.sourceDelta, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_INVALID')
  const integrity = object(batch.integrity, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_INVALID')
  exactKeys(producer, ['owner', 'scope', 'keyId'], 'ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_INVALID')
  exactKeys(sourceDelta, ['fromExclusive', 'toInclusive', 'rowCount'], 'ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_INVALID')
  exactKeys(integrity, ['algorithm', 'eventCount', 'eventsDigest'], 'ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_INVALID')
  const from = nonNegativeInteger(sourceDelta.fromExclusive, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_INVALID')
  const to = positiveInteger(sourceDelta.toInclusive, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_INVALID')
  const rowCount = positiveInteger(sourceDelta.rowCount, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_INVALID')
  if (batch.contract !== ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_VERSION || !/^delta:atendimento:[A-Za-z0-9_-]{8,160}$/.test(text(batch.batchId, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_INVALID')) || producer.owner !== 'atendimento' || producer.scope !== ATENDIMENTO_CRM_PROJECTION_DELTA_SCOPE || !KEY_ID_PATTERN.test(text(producer.keyId, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_INVALID')) || to < from || rowCount < 1 || rowCount > ATENDIMENTO_CRM_PROJECTION_DELTA_MAX_EVENTS_PER_BATCH || integrity.algorithm !== 'sha256' || integrity.eventCount !== rowCount || !SHA256_PATTERN.test(text(integrity.eventsDigest, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_INVALID'))) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_INVALID')
  const target = assertAtendimentoProjectionExportTarget(batch.target)
  if (!Array.isArray(batch.events) || batch.events.length !== rowCount) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_INVALID')
  const events = Object.freeze(batch.events.map(assertEvent))
  if (to <= from || rowCount > to - from) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_INVALID')
  const ids = new Set()
  const projectionKeys = new Set()
  for (const event of events) {
    const key = `${event.unitScope.unitSlug}:${event.projection.reference}:${event.revision}`
    if (ids.has(event.id) || projectionKeys.has(key)) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_INVALID')
    ids.add(event.id)
    projectionKeys.add(key)
  }
  if (integrity.eventsDigest !== eventsDigest(events)) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_INVALID')
  return Object.freeze({ contract: batch.contract, batchId: batch.batchId, producer: Object.freeze({ ...producer }), sourceDelta: Object.freeze({ fromExclusive: from, toInclusive: to, rowCount }), target, events, integrity: Object.freeze({ ...integrity }) })
}

export function digestAtendimentoProjectionDeltaBatch(value) {
  return sha256(assertAtendimentoProjectionDeltaBatch(value))
}

export async function preflightAtendimentoProjectionDeltaSource(client, { source = ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE } = {}) {
  if (!client || typeof client.query !== 'function') fail('ATENDIMENTO_CRM_PROJECTION_DELTA_CLIENT_INVALID')
  const sourceDefinition = assertAtendimentoProjectionDeltaSource(source)
  const identity = sourceIdentity((await client.query(sourceDefinition.identitySql))?.rows?.[0])
  const capturedAt = timestamp((await client.query(sourceDefinition.snapshotSql))?.rows?.[0]?.captured_at, 'ATENDIMENTO_CRM_PROJECTION_DELTA_SNAPSHOT_INVALID')
  const watermark = nonNegativeInteger((await client.query(sourceDefinition.watermarkSql))?.rows?.[0]?.watermark, 'ATENDIMENTO_CRM_PROJECTION_DELTA_WATERMARK_INVALID')
  return Object.freeze({ identity, capturedAt, watermark, source: sourceDefinition })
}

export async function readAtendimentoProjectionDeltaPage(client, { source = ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE, fromExclusive = 0, toInclusive, limit = ATENDIMENTO_CRM_PROJECTION_DELTA_MAX_EVENTS_PER_BATCH } = {}) {
  if (!client || typeof client.query !== 'function') fail('ATENDIMENTO_CRM_PROJECTION_DELTA_CLIENT_INVALID')
  const sourceDefinition = assertAtendimentoProjectionDeltaSource(source)
  const from = nonNegativeInteger(fromExclusive, 'ATENDIMENTO_CRM_PROJECTION_DELTA_CURSOR_INVALID')
  const to = positiveInteger(toInclusive, 'ATENDIMENTO_CRM_PROJECTION_DELTA_CURSOR_INVALID')
  const pageLimit = positiveInteger(limit, 'ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_SIZE_INVALID')
  if (pageLimit > ATENDIMENTO_CRM_PROJECTION_DELTA_MAX_EVENTS_PER_BATCH) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_BATCH_SIZE_INVALID')
  const result = from === 0
    ? await client.query(sourceDefinition.firstPageSql, [to, pageLimit])
    : await client.query(sourceDefinition.nextPageSql, [from, to, pageLimit])
  // The source SQL owns ordering. Preserve it here so an unexpected
  // out-of-order response cannot be silently normalized into a valid page.
  const rows = (result?.rows || []).map(assertAtendimentoProjectionDeltaRow)
  if (rows.length > pageLimit || rows.length === 0) {
    if (from < to) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE_GAP')
    return Object.freeze([])
  }
  let previous = from
  for (const row of rows) {
    if (row.eventOrder <= previous || row.eventOrder > to) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE_GAP')
    previous = row.eventOrder
  }
  return Object.freeze(rows)
}

export const __testables = Object.freeze({
  UUID_PATTERN,
  UNIT_SLUG_PATTERN,
  hmacPart,
  sourceSql,
  pageSql,
  sameTarget,
})
