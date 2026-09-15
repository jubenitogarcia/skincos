import {
  ATENDIMENTO_CRM_CORE_CONFIRMED_UNIT_MEMBERSHIP_CTE,
  ATENDIMENTO_CRM_CORE_IDENTITY_SOURCE_SEMANTICS_VERSION,
  ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS,
} from './atendimentoCrmCoreIdentityMaterializationPolicy.js'

// Neutral, dependency-free source-preflight contract shared by Atendimento's
// exporter adapter and CRM's metadata preflight. It has no runtime, credential,
// delivery, or database configuration dependency; callers supply a client only
// to attest the fixed read-only query family.
export const ATENDIMENTO_CRM_PROJECTION_MAX_ROWS = 10_000
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

function maximumRows(value) {
  const normalized = value === undefined ? ATENDIMENTO_CRM_PROJECTION_MAX_ROWS : Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > ATENDIMENTO_CRM_PROJECTION_MAX_ROWS) {
    fail('ATENDIMENTO_CRM_PROJECTION_EXPORT_MAX_ROWS_INVALID')
  }
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
 * Validates a source owned by Atendimento. The consumer never derives a unit
 * scope itself: the owner supplies one fixed, read-only query family with an
 * explicit canonical unit slug for every emitted identity/unit membership.
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

/**
 * Attests an already-open caller-owned source transaction. It reads only the
 * supplied fixed metadata queries; it does not open connections, select domain
 * rows, deliver a projection, or mutate runtime state.
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

export const ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE_VERSION = ATENDIMENTO_CRM_CORE_IDENTITY_SOURCE_SEMANTICS_VERSION

// Finance-owned Caixa sales, app registration and supplemental leads remain
// excluded until each owner supplies an independent source contract and
// retirement evidence. An identity without canonical unit evidence has no
// output row and never falls back to a global/wildcard scope.
export const ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE_SEMANTICS = Object.freeze({
  version: ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE_VERSION,
  membership: 'explicitly confirmed attendance evidence resolved through canonical units',
  sourceRelationAllowlist: ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS,
  excludedDomains: Object.freeze(['finance']),
  deferredSources: 'Finance Caixa sale evidence, app registration and supplemental lead remain excluded until their owner provides a dedicated source contract plus complete-snapshot retirement evidence or explicit tombstones',
  duplicateEvidence: 'one identity/unit row, with the latest observed source timestamp',
  divergentUnits: 'valid multi-unit membership; emit one row for each canonical unit slug',
  missingEvidence: 'no projection row; there is no global or wildcard fallback',
  revision: 'snapshot-only: updated_at is cursor material, while CRM Core event revision remains 1 for the initial backfill and exact replay',
})

// Keep every source branch data-minimal. The final projection selects only the
// opaque identity UUID, a timestamp and canonical unit slug; no names, phones,
// email, or source payload can cross this contract.
const MEMBERSHIP_CTE = `${ATENDIMENTO_CRM_CORE_CONFIRMED_UNIT_MEMBERSHIP_CTE}, projection_rows AS (
  SELECT identity_id,
    observed_at,
    identity_id::text AS id,
    to_char(observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS updated_at,
    unit_slug
  FROM canonical_memberships
)`

const ROWS_SELECT = `SELECT id, updated_at, unit_slug
FROM projection_rows`

export const ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE = createAtendimentoUnitScopedProjectionSource({
  contract: ATENDIMENTO_UNIT_SCOPED_PROJECTION_SOURCE_CONTRACT,
  countSql: `${MEMBERSHIP_CTE}
SELECT count(*)::int AS row_count
FROM projection_rows`,
  rowsSql: `${MEMBERSHIP_CTE}
${ROWS_SELECT}
ORDER BY updated_at ASC, id ASC, unit_slug ASC
LIMIT $1`,
  firstPageSql: `${MEMBERSHIP_CTE}
${ROWS_SELECT}
ORDER BY updated_at ASC, id ASC, unit_slug ASC
LIMIT $1`,
  nextPageSql: `${MEMBERSHIP_CTE}
${ROWS_SELECT}
WHERE (observed_at, identity_id, unit_slug) > ($1::timestamptz, $2::uuid, $3::text)
ORDER BY updated_at ASC, id ASC, unit_slug ASC
LIMIT $4`,
})
