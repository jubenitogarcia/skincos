import {
  ATENDIMENTO_CRM_PROJECTION_MAX_ROWS,
  ATENDIMENTO_PROJECTION_EXPORT_COUNT_SQL,
  ATENDIMENTO_PROJECTION_EXPORT_IDENTITY_SQL,
  ATENDIMENTO_PROJECTION_EXPORT_ROWS_SQL,
  ATENDIMENTO_PROJECTION_EXPORT_SNAPSHOT_SQL,
  assertAtendimentoProjectionExportTarget,
  exportAtendimentoClientProjectionBatch,
} from './atendimentoProjectionExporter.mjs'

export const ATENDIMENTO_SYNTHETIC_STAGING_PREPARATION_INTENT = 'atendimento/crm-core/synthetic-staging-preparation/v1'

const INPUT_KEYS = Object.freeze(['syntheticIntent', 'target', 'fixturePool', 'hmacKey', 'keyId', 'receiver', 'maxRows'])
const SYNTHETIC_FIXTURE_POOLS = new WeakSet()
const SYNTHETIC_FIXTURE_RECEIVERS = new WeakSet()
const SYNTHETIC_FIXTURE_RECEIPTS = new WeakMap()
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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
  const count = value === undefined ? ATENDIMENTO_CRM_PROJECTION_MAX_ROWS : Number(value)
  if (!Number.isSafeInteger(count) || count < 1 || count > ATENDIMENTO_CRM_PROJECTION_MAX_ROWS) {
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
  const identifiers = new Set()
  const rows = value.map((item) => {
    const row = object(item, 'ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_FIXTURE_INVALID')
    exactKeys(row, ['id', 'updated_at'], 'ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_FIXTURE_INVALID')
    const id = String(row.id || '').trim().toLowerCase()
    if (!UUID_PATTERN.test(id) || identifiers.has(id)) fail('ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_FIXTURE_INVALID')
    identifiers.add(id)
    return Object.freeze({ id, updated_at: timestamp(row.updated_at, 'ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_FIXTURE_INVALID') })
  })
  return Object.freeze(rows.sort((left, right) => left.updated_at.localeCompare(right.updated_at) || left.id.localeCompare(right.id)))
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
      if (sql === ATENDIMENTO_PROJECTION_EXPORT_COUNT_SQL) return { rows: [{ row_count: rows.length }] }
      if (sql === ATENDIMENTO_PROJECTION_EXPORT_ROWS_SQL) {
        if (!Array.isArray(params) || params.length !== 1 || params[0] !== rows.length) {
          fail('ATENDIMENTO_CRM_SYNTHETIC_PREPARATION_FIXTURE_QUERY_INVALID')
        }
        return { rows }
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
    hmacKey: input.hmacKey,
    keyId: input.keyId,
    target,
    maxRows,
  })
  const receipt = sanitizedReceipt(batch)
  receipts[receipts.length] = receipt
  return receipt
}
