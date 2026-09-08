import {
  ATENDIMENTO_CRM_PROJECTION_BACKFILL_MAX_EVENTS,
  ATENDIMENTO_PROJECTION_EXPORT_IDENTITY_SQL,
  ATENDIMENTO_PROJECTION_EXPORT_SNAPSHOT_SQL,
  ATENDIMENTO_UNIT_SCOPED_PROJECTION_SOURCE_CONTRACT,
  assertAtendimentoProjectionSourceRow,
  assertAtendimentoProjectionExportTarget,
  createAtendimentoUnitScopedProjectionSource,
  exportAtendimentoClientProjectionBatch,
} from './atendimentoProjectionExporter.mjs'

export const ATENDIMENTO_SYNTHETIC_STAGING_PREPARATION_INTENT = 'atendimento/crm-core/synthetic-staging-preparation/v2'

// This descriptor is deliberately synthetic. A production caller must inject
// an Atendimento-owned source contract rather than repurposing this fixture.
export const ATENDIMENTO_SYNTHETIC_UNIT_SCOPED_PROJECTION_SOURCE = createAtendimentoUnitScopedProjectionSource({
  contract: ATENDIMENTO_UNIT_SCOPED_PROJECTION_SOURCE_CONTRACT,
  countSql: `SELECT count(*)::int AS row_count
FROM synthetic_atendimento_unit_projection_source`,
  rowsSql: `/* bounded source-input fingerprint */
SELECT id::text AS id,
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at,
  unit_slug AS unit_slug
FROM synthetic_atendimento_unit_projection_source
ORDER BY updated_at ASC, id ASC, unit_slug ASC
LIMIT $1`,
  firstPageSql: `/* first keyset page */
SELECT id::text AS id,
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at,
  unit_slug AS unit_slug
FROM synthetic_atendimento_unit_projection_source
ORDER BY updated_at ASC, id ASC, unit_slug ASC
LIMIT $1`,
  nextPageSql: `SELECT id::text AS id,
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at,
  unit_slug AS unit_slug
FROM synthetic_atendimento_unit_projection_source
WHERE (updated_at, id, unit_slug) > ($1::timestamptz, $2::uuid, $3::text)
ORDER BY updated_at ASC, id ASC, unit_slug ASC
LIMIT $4`,
})

const INPUT_KEYS = Object.freeze(['syntheticIntent', 'target', 'fixturePool', 'hmacKey', 'keyId', 'receiver', 'maxRows'])
const SYNTHETIC_FIXTURE_POOLS = new WeakSet()
const SYNTHETIC_FIXTURE_RECEIVERS = new WeakSet()
const SYNTHETIC_FIXTURE_RECEIPTS = new WeakMap()
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

function onlyKnownKeys(value, keys, code) {
  if (Object.keys(value).some((key) => !keys.includes(key))) fail(code)
}

function timestamp(value, code) {
  const parsed = value instanceof Date ? value : new Date(String(value || '').trim())
  if (Number.isNaN(parsed.getTime())) fail(code)
  return parsed.toISOString()
}

function cursorTimestamp(value, code) {
  const raw = String(value || '').trim()
  const match = SOURCE_CURSOR_TIMESTAMP.exec(raw)
  if (!match || Number.isNaN(new Date(raw).getTime())) fail(code)
  return `${match[1]}.${match[2].padEnd(6, '0')}Z`
}

function explicitSyntheticIntent(value) {
  if (value !== ATENDIMENTO_SYNTHETIC_STAGING_PREPARATION_INTENT) {
    fail('ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_INTENT_REQUIRED')
  }
}

function stagingTarget(value) {
  const target = assertAtendimentoProjectionExportTarget(value)
  if (target.environment === 'production') fail('ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_PRODUCTION_FORBIDDEN')
  if (target.environment !== 'staging') fail('ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_STAGING_TARGET_REQUIRED')
  return target
}

function boundedCount(value) {
  const count = value === undefined ? ATENDIMENTO_CRM_PROJECTION_BACKFILL_MAX_EVENTS : Number(value)
  if (!Number.isSafeInteger(count) || count < 1 || count > ATENDIMENTO_CRM_PROJECTION_BACKFILL_MAX_EVENTS) {
    fail('ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_COUNT_INVALID')
  }
  return count
}

function fixturePool(value) {
  if (!value || typeof value !== 'object' || !SYNTHETIC_FIXTURE_POOLS.has(value)) {
    fail('ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_FIXTURE_POOL_REQUIRED')
  }
  return value
}

function fixtureReceiver(value) {
  if (!value || typeof value !== 'object' || !SYNTHETIC_FIXTURE_RECEIVERS.has(value)) {
    fail('ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_RECEIVER_INVALID')
  }
  return SYNTHETIC_FIXTURE_RECEIPTS.get(value)
}

function sanitizedReceipt(batch) {
  return Object.freeze({
    batchId: batch.batchId,
    count: batch.events.length,
    release: batch.target.release,
    digest: batch.target.artifactDigest,
  })
}

function syntheticSourceRows(value) {
  if (!Array.isArray(value)) fail('ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_FIXTURE_INVALID')
  const identities = new Set()
  const rows = value.map((item) => {
    const row = object(item, 'ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_FIXTURE_INVALID')
    exactKeys(row, ['id', 'updated_at', 'unit_slug'], 'ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_FIXTURE_INVALID')
    let normalized
    try {
      normalized = assertAtendimentoProjectionSourceRow(row)
    } catch {
      fail('ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_FIXTURE_INVALID')
    }
    const identity = `${normalized.id}\u0000${normalized.unitSlug}`
    if (identities.has(identity)) fail('ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_FIXTURE_INVALID')
    identities.add(identity)
    return Object.freeze({
      id: normalized.id,
      updated_at: normalized.sourceUpdatedAt,
      unit_slug: normalized.unitSlug,
    })
  })
  return Object.freeze(rows.sort((left, right) => (
    left.updated_at.localeCompare(right.updated_at)
    || left.id.localeCompare(right.id)
    || left.unit_slug.localeCompare(right.unit_slug)
  )))
}

/**
 * Creates the only pool shape the synthetic runner accepts. This factory holds
 * source-shaped fixture rows in memory and registers the resulting pool in a
 * module-private WeakSet, so an arbitrary database client cannot be passed to
 * the runner as a fixture.
 */
export function createSyntheticAtendimentoProjectionFixturePool(value) {
  const fixture = object(value, 'ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_FIXTURE_INVALID')
  exactKeys(fixture, ['capturedAt', 'rows'], 'ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_FIXTURE_INVALID')
  const capturedAt = timestamp(fixture.capturedAt, 'ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_FIXTURE_INVALID')
  const rows = syntheticSourceRows(fixture.rows)
  const identity = Object.freeze({
    database_name: 'skincos_clientes_production',
    current_user: 'crm_core_projection_exporter',
    session_user: 'crm_core_projection_exporter',
    transaction_read_only: 'on',
  })
  const client = Object.freeze({
    async query(sql, params = []) {
      if (sql === 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY' || sql === 'ROLLBACK') return { rows: [] }
      if (sql === ATENDIMENTO_PROJECTION_EXPORT_IDENTITY_SQL) return { rows: [identity] }
      if (sql === ATENDIMENTO_PROJECTION_EXPORT_SNAPSHOT_SQL) return { rows: [{ captured_at: capturedAt }] }
      if (sql === ATENDIMENTO_SYNTHETIC_UNIT_SCOPED_PROJECTION_SOURCE.countSql) return { rows: [{ row_count: rows.length }] }
      if (sql === ATENDIMENTO_SYNTHETIC_UNIT_SCOPED_PROJECTION_SOURCE.rowsSql) {
        if (!Array.isArray(params) || params.length !== 1 || params[0] !== rows.length) {
          fail('ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_FIXTURE_QUERY_INVALID')
        }
        return { rows }
      }
      if (sql === ATENDIMENTO_SYNTHETIC_UNIT_SCOPED_PROJECTION_SOURCE.firstPageSql) {
        const [limit] = params
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > rows.length) {
          fail('ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_FIXTURE_QUERY_INVALID')
        }
        return { rows: rows.slice(0, limit) }
      }
      if (sql === ATENDIMENTO_SYNTHETIC_UNIT_SCOPED_PROJECTION_SOURCE.nextPageSql) {
        const [updatedAt, id, unitSlug, limit] = params
        if (!Number.isSafeInteger(limit) || limit < 1) fail('ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_FIXTURE_QUERY_INVALID')
        let cursor
        try {
          const normalized = assertAtendimentoProjectionSourceRow({ id, updated_at: updatedAt, unit_slug: unitSlug })
          cursor = Object.freeze({
            updatedAt: cursorTimestamp(updatedAt, 'ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_FIXTURE_QUERY_INVALID'),
            id: normalized.id,
            unitSlug: normalized.unitSlug,
          })
        } catch {
          fail('ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_FIXTURE_QUERY_INVALID')
        }
        return {
          rows: rows.filter((row) => (
            cursorTimestamp(row.updated_at, 'ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_FIXTURE_QUERY_INVALID').localeCompare(cursor.updatedAt) > 0
            || (cursorTimestamp(row.updated_at, 'ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_FIXTURE_QUERY_INVALID') === cursor.updatedAt && (
              row.id.localeCompare(cursor.id) > 0
              || (row.id === cursor.id && row.unit_slug.localeCompare(cursor.unitSlug) > 0)
            ))
          )).slice(0, limit),
        }
      }
      fail('ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_FIXTURE_QUERY_INVALID')
    },
    release() {},
  })
  const pool = Object.freeze({ async connect() { return client } })
  SYNTHETIC_FIXTURE_POOLS.add(pool)
  return pool
}

/**
 * Creates an opaque, in-memory receipt receiver. The runner accepts only this
 * capability and keeps its mutable receipt collection module-private, so an
 * injected array, proxy, callback, or transport cannot run at delivery time.
 */
export function createSyntheticAtendimentoProjectionReceiptReceiver() {
  const receiver = Object.freeze({})
  SYNTHETIC_FIXTURE_RECEIVERS.add(receiver)
  SYNTHETIC_FIXTURE_RECEIPTS.set(receiver, [])
  return receiver
}

export function readSyntheticAtendimentoProjectionReceipts(receiver) {
  const receipts = fixtureReceiver(receiver)
  return Object.freeze([...receipts])
}

/**
 * Prepare one synthetic, staging-only projection batch. This is intentionally
 * disabled until the caller supplies the exact synthetic intent. It has no
 * transport configuration: the only receiver is an injected in-memory fixture
 * that receives the sanitized receipt, never the event batch.
 */
export async function prepareSyntheticAtendimentoProjectionStaging(options = {}) {
  const input = object(options, 'ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_OPTIONS_INVALID')

  // This must be the first injected value read. A production target is refused
  // before a pool, HMAC value, or receiver fixture can be touched.
  const target = stagingTarget(input.target)
  onlyKnownKeys(input, INPUT_KEYS, 'ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_OPTIONS_INVALID')
  explicitSyntheticIntent(input.syntheticIntent)
  const maxRows = boundedCount(input.maxRows)
  const pool = fixturePool(input.fixturePool)
  const receipts = fixtureReceiver(input.receiver)

  const batch = await exportAtendimentoClientProjectionBatch({
    pool,
    source: ATENDIMENTO_SYNTHETIC_UNIT_SCOPED_PROJECTION_SOURCE,
    hmacKey: input.hmacKey,
    keyId: input.keyId,
    target,
    maxRows,
  })
  const receipt = sanitizedReceipt(batch)
  receipts[receipts.length] = receipt
  return receipt
}
