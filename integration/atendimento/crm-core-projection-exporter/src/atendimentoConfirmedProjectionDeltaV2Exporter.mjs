import {
  ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_MAX_EVENTS_PER_BATCH,
  ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_PROFILE,
  assertAtendimentoConfirmedProjectionDeltaV2Row,
  assertAtendimentoConfirmedProjectionDeltaV2SourceProfile,
  createAtendimentoConfirmedProjectionDeltaV2Batch,
  digestAtendimentoConfirmedProjectionDeltaV2Batch,
  digestAtendimentoConfirmedProjectionDeltaV2SourceProfile,
} from '../../../../shared/crm-auth/atendimentoConfirmedProjectionDeltaV2.js'

export {
  ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_MAX_EVENTS_PER_BATCH,
  ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_PROFILE,
  assertAtendimentoConfirmedProjectionDeltaV2Row,
  createAtendimentoConfirmedProjectionDeltaV2Batch,
  digestAtendimentoConfirmedProjectionDeltaV2Batch,
}

export const ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_CONTRACT = 'atendimento/crm-core/confirmed-projection-delta-source/v2'
export const ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_EXPORTER_VERSION = 'atendimento/crm-core/confirmed-projection-delta-exporter/v2'
export const ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_DATABASE = Object.freeze({
  database: 'skincos_clientes_production',
  user: 'crm_core_projection_exporter',
})

const FORBIDDEN_SQL = /\b(?:alter|call|copy|create|delete|drop|grant|insert|merge|offset|revoke|truncate|update|vacuum)\b/i
const REQUIRED_ALIASES = Object.freeze({
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
  source_semantics: /\bas\s+(?:"source_semantics"|source_semantics)\b/i,
  source_profile_digest: /\bas\s+(?:"source_profile_digest"|source_profile_digest)\b/i,
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

function sameTarget(left, right) {
  return left.environment === right.environment && left.release === right.release && left.artifactDigest === right.artifactDigest
}

function sourceSql(value, code, aliases = []) {
  const sql = text(value, code)
  if (sql.length > 32_768 || sql.includes(';') || FORBIDDEN_SQL.test(sql) || !/^(?:select|with)\b/i.test(sql)) fail(code)
  for (const alias of aliases) {
    if (!REQUIRED_ALIASES[alias]?.test(sql)) fail(code)
  }
  return sql
}

function pageSql(value, code, parameters) {
  const sql = sourceSql(value, code, ['event_order', 'event_id', 'identity_id', 'unit_slug', 'revision', 'operation', 'occurred_at', 'source_semantics', 'source_profile_digest'])
  const actual = [...sql.matchAll(/\$(\d+)\b/g)].map((match) => Number(match[1]))
  if (actual.length !== parameters.length || new Set(actual).size !== actual.length || parameters.some((parameter) => !actual.includes(parameter))
    || actual.some((parameter) => !parameters.includes(parameter))
    || !/\border\s+by\s+(?:[A-Za-z_][A-Za-z0-9_]*\.)?event_order\s+asc\s*\blimit\b/i.test(sql)) fail(code)
  return sql
}

export const ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE = Object.freeze({
  contract: ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_CONTRACT,
  sourceProfile: ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_PROFILE,
  identitySql: `SELECT
  current_database() AS database_name,
  current_user AS current_user,
  session_user AS session_user,
  current_setting('transaction_read_only') AS transaction_read_only`,
  snapshotSql: 'SELECT transaction_timestamp()::timestamptz AS captured_at',
  watermarkSql: `SELECT COALESCE(MAX(event_order), 0)::bigint AS watermark
FROM crm_atendimento.crm_core_confirmed_projection_delta_v2_outbox`,
  firstPageSql: `SELECT
  event_order AS event_order,
  event_id AS event_id,
  identity_id AS identity_id,
  unit_slug AS unit_slug,
  revision AS revision,
  operation AS operation,
  occurred_at AS occurred_at,
  source_semantics AS source_semantics,
  source_profile_digest AS source_profile_digest
FROM crm_atendimento.crm_core_confirmed_projection_delta_v2_outbox
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
  occurred_at AS occurred_at,
  source_semantics AS source_semantics,
  source_profile_digest AS source_profile_digest
FROM crm_atendimento.crm_core_confirmed_projection_delta_v2_outbox
WHERE event_order > $1 AND event_order <= $2
ORDER BY event_order ASC
LIMIT $3`,
})

export function assertAtendimentoConfirmedProjectionDeltaV2Source(value) {
  const source = object(value, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_INVALID')
  exactKeys(source, ['contract', 'sourceProfile', 'identitySql', 'snapshotSql', 'watermarkSql', 'firstPageSql', 'nextPageSql'], 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_INVALID')
  if (source.contract !== ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_CONTRACT) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_INVALID')
  const sourceProfile = assertAtendimentoConfirmedProjectionDeltaV2SourceProfile(source.sourceProfile)
  if (digestAtendimentoConfirmedProjectionDeltaV2SourceProfile(sourceProfile) !== digestAtendimentoConfirmedProjectionDeltaV2SourceProfile()) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_INVALID')
  // This is a custody boundary, not an SQL extension point.  Allowing callers
  // to inject shape-compatible statements would let a legacy outbox or a view
  // impersonate the confirmed v5 source. The static SQL also makes the live
  // identity query impossible to replace with literals.
  for (const key of ['identitySql', 'snapshotSql', 'watermarkSql', 'firstPageSql', 'nextPageSql']) {
    if (source[key] !== ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE[key]) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_INVALID')
  }
  return Object.freeze({
    contract: source.contract,
    sourceProfile,
    identitySql: ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE.identitySql,
    snapshotSql: ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE.snapshotSql,
    watermarkSql: ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE.watermarkSql,
    firstPageSql: ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE.firstPageSql,
    nextPageSql: ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE.nextPageSql,
  })
}

function assertSourceIdentity(value) {
  const identity = object(value, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_IDENTITY_INVALID')
  const database = text(identity.database_name, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_IDENTITY_INVALID')
  const currentUser = text(identity.current_user, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_IDENTITY_INVALID')
  const sessionUser = text(identity.session_user, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_IDENTITY_INVALID')
  const readOnly = text(identity.transaction_read_only, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_IDENTITY_INVALID').toLowerCase()
  if (database !== ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_DATABASE.database
    || currentUser !== ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_DATABASE.user
    || sessionUser !== ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_DATABASE.user
    || readOnly !== 'on') fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_IDENTITY_UNSAFE')
  return Object.freeze({ database, currentUser, sessionUser, readOnly })
}

function assertPageRow(value) {
  const entry = object(value, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_ROW_INVALID')
  exactKeys(entry, ['event_order', 'event_id', 'identity_id', 'unit_slug', 'revision', 'operation', 'occurred_at', 'source_semantics', 'source_profile_digest'], 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_ROW_INVALID')
  if (entry.source_semantics !== ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_PROFILE.semantics
    || String(entry.source_profile_digest || '').toLowerCase() !== digestAtendimentoConfirmedProjectionDeltaV2SourceProfile()) {
    fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_ROW_INVALID')
  }
  return assertAtendimentoConfirmedProjectionDeltaV2Row({
    event_order: entry.event_order,
    event_id: entry.event_id,
    identity_id: entry.identity_id,
    unit_slug: entry.unit_slug,
    revision: entry.revision,
    operation: entry.operation,
    occurred_at: entry.occurred_at,
  })
}

export async function preflightAtendimentoConfirmedProjectionDeltaV2Source(client, { source = ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE } = {}) {
  if (!client || typeof client.query !== 'function') fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CLIENT_INVALID')
  const sourceDefinition = assertAtendimentoConfirmedProjectionDeltaV2Source(source)
  const identity = assertSourceIdentity((await client.query(sourceDefinition.identitySql))?.rows?.[0])
  const capturedAt = timestamp((await client.query(sourceDefinition.snapshotSql))?.rows?.[0]?.captured_at, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SNAPSHOT_INVALID')
  const watermark = nonNegativeInteger((await client.query(sourceDefinition.watermarkSql))?.rows?.[0]?.watermark, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_WATERMARK_INVALID')
  return Object.freeze({ identity, capturedAt, watermark, source: sourceDefinition, sourceProfileDigest: digestAtendimentoConfirmedProjectionDeltaV2SourceProfile(sourceDefinition.sourceProfile) })
}

export async function readAtendimentoConfirmedProjectionDeltaV2Page(client, { source = ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE, fromExclusive = 0, toInclusive, limit = ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_MAX_EVENTS_PER_BATCH } = {}) {
  if (!client || typeof client.query !== 'function') fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CLIENT_INVALID')
  const sourceDefinition = assertAtendimentoConfirmedProjectionDeltaV2Source(source)
  const from = nonNegativeInteger(fromExclusive, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CURSOR_INVALID')
  const to = positiveInteger(toInclusive, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_CURSOR_INVALID')
  const pageLimit = positiveInteger(limit, 'ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BATCH_SIZE_INVALID')
  if (pageLimit > ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_MAX_EVENTS_PER_BATCH) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_BATCH_SIZE_INVALID')
  const result = from === 0
    ? await client.query(sourceDefinition.firstPageSql, [to, pageLimit])
    : await client.query(sourceDefinition.nextPageSql, [from, to, pageLimit])
  const rows = (result?.rows || []).map(assertPageRow)
  if (rows.length === 0) {
    if (from < to) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_GAP')
    return Object.freeze([])
  }
  if (rows.length > pageLimit) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_GAP')
  let previous = from
  for (const entry of rows) {
    if (entry.eventOrder <= previous || entry.eventOrder > to) fail('ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_GAP')
    previous = entry.eventOrder
  }
  return Object.freeze(rows)
}

export const __testables = Object.freeze({ sourceSql, pageSql, sameTarget })
