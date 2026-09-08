import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'

import {
  ATENDIMENTO_PROJECTION_EXPORT_IDENTITY_SQL,
  ATENDIMENTO_PROJECTION_EXPORT_SNAPSHOT_SQL,
  ATENDIMENTO_UNIT_SCOPED_PROJECTION_SOURCE_CONTRACT,
  createAtendimentoUnitScopedProjectionSource,
} from '../src/atendimentoProjectionExporter.mjs'
import {
  createAtendimentoProjectionBackfillDeliverySigner,
} from '../src/atendimentoProjectionBackfillDelivery.mjs'
import {
  ATENDIMENTO_CRM_PROJECTION_BACKFILL_RUN_INTENT,
  createPaginatedAtendimentoProjectionBackfillRunner,
} from '../src/paginatedAtendimentoProjectionBackfillRunner.mjs'

const HMAC_KEY = 'synthetic-atendimento-paginated-export-key-at-least-32-bytes'
const TARGET = Object.freeze({
  environment: 'staging',
  release: 'a'.repeat(40),
  artifactDigest: `sha256:${'b'.repeat(64)}`,
})
const OTHER_TARGET = Object.freeze({
  ...TARGET,
  release: 'c'.repeat(40),
})
const CAPTURED_AT = '2026-09-07T00:00:00.000Z'
const SOURCE = createAtendimentoUnitScopedProjectionSource({
  contract: ATENDIMENTO_UNIT_SCOPED_PROJECTION_SOURCE_CONTRACT,
  countSql: 'SELECT count(*)::int AS row_count FROM test_atendimento_unit_projection_source',
  rowsSql: `/* bounded source-input fingerprint */
SELECT id::text AS id, updated_at AS updated_at, unit_slug AS unit_slug
FROM test_atendimento_unit_projection_source
ORDER BY updated_at ASC, id ASC, unit_slug ASC
LIMIT $1`,
  firstPageSql: `/* first keyset page */
SELECT id::text AS id, updated_at AS updated_at, unit_slug AS unit_slug
FROM test_atendimento_unit_projection_source
ORDER BY updated_at ASC, id ASC, unit_slug ASC
LIMIT $1`,
  nextPageSql: `SELECT id::text AS id, updated_at AS updated_at, unit_slug AS unit_slug
FROM test_atendimento_unit_projection_source
WHERE (updated_at, id, unit_slug) > ($1::timestamptz, $2::uuid, $3::text)
ORDER BY updated_at ASC, id ASC, unit_slug ASC
LIMIT $4`,
})

function sourceRowAt(index, timestamp, unit_slug = index % 2 === 0 ? 'barra-shopping-sul' : 'novo-hamburgo') {
  const suffix = index.toString(16).padStart(12, '0')
  return Object.freeze({ id: `123e4567-e89b-42d3-a456-${suffix}`, updated_at: timestamp, unit_slug })
}

function sourceRow(index) {
  const milliseconds = new Date(Date.parse(CAPTURED_AT) + (Math.floor(index / 2) * 1000)).toISOString()
  return sourceRowAt(index, milliseconds.replace(/\.(\d{3})Z$/, (_match, value) => `.${value}000Z`))
}

function compareRows(left, right) {
  return left.updated_at.localeCompare(right.updated_at)
    || left.id.localeCompare(right.id)
    || left.unit_slug.localeCompare(right.unit_slug)
}

function fakePool({
  rows = [sourceRow(0)],
  rowCount = rows.length,
  capturedAt = CAPTURED_AT,
  preserveSourceOrder = false,
} = {}) {
  const sourceRows = preserveSourceOrder ? [...rows] : [...rows].sort(compareRows)
  const calls = []
  let released = false
  let connectCount = 0
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params })
      if (sql === 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY' || sql === 'ROLLBACK') return { rows: [] }
      if (sql === ATENDIMENTO_PROJECTION_EXPORT_IDENTITY_SQL) return { rows: [{
        database_name: 'skincos_clientes_production',
        current_user: 'crm_core_projection_exporter',
        session_user: 'crm_core_projection_exporter',
        transaction_read_only: 'on',
      }] }
      if (sql === ATENDIMENTO_PROJECTION_EXPORT_SNAPSHOT_SQL) return { rows: [{ captured_at: capturedAt }] }
      if (sql === SOURCE.countSql) return { rows: [{ row_count: rowCount }] }
      if (sql === SOURCE.rowsSql) {
        if (params.length !== 1 || params[0] !== rowCount) throw new Error('unexpected source-input query parameters')
        return { rows: sourceRows.slice(0, params[0]) }
      }
      if (sql === SOURCE.firstPageSql) {
        return { rows: sourceRows.slice(0, params[0]) }
      }
      if (sql === SOURCE.nextPageSql) {
        const [updatedAt, id, unitSlug, limit] = params
        return {
          rows: sourceRows.filter((row) => (
            row.updated_at.localeCompare(updatedAt) > 0
            || (row.updated_at === updatedAt && (
              row.id.localeCompare(id) > 0
              || (row.id === id && row.unit_slug.localeCompare(unitSlug) > 0)
            ))
          )).slice(0, limit),
        }
      }
      throw new Error(`unexpected query: ${sql}`)
    },
    release() { released = true },
  }
  return {
    calls,
    released: () => released,
    connectCount: () => connectCount,
    pool: {
      async connect() {
        connectCount += 1
        return client
      },
    },
  }
}

function checkpointFixture({ initial = null } = {}) {
  let active = initial
  const writes = []
  const completions = []
  return {
    store: Object.freeze({
      async read() { return active },
      async write(value) {
        active = structuredClone(value)
        writes.push(active)
      },
      async complete(value) {
        completions.push(structuredClone(value))
        active = null
      },
    }),
    writes: () => writes,
    completions: () => completions,
    active: () => active,
  }
}

function signingFixture() {
  const { privateKey } = crypto.generateKeyPairSync('ed25519')
  return createAtendimentoProjectionBackfillDeliverySigner({
    target: TARGET,
    keyId: 'crm-staging-atendimento-backfill-v1',
    sign: (input) => crypto.sign(null, input, privateKey),
  })
}

function transportFixture({ statuses = ['accepted'], failure } = {}) {
  const deliveries = []
  return {
    transport: Object.freeze({
      async deliver({ batch, delivery, requestId }) {
        deliveries.push(Object.freeze({ batch, delivery, requestId }))
        if (failure) throw failure
        return Object.freeze({ status: statuses[Math.min(deliveries.length - 1, statuses.length - 1)] })
      },
    }),
    deliveries: () => deliveries,
  }
}

function runner({ pool, checkpointStore, transport, target = TARGET, batchSize = 20, maxRows = 10_000 } = {}) {
  return createPaginatedAtendimentoProjectionBackfillRunner({
    pool,
    source: SOURCE,
    hmacKey: HMAC_KEY,
    keyId: 'atendimento-projection-key-v1',
    target,
    signer: signingFixture(target),
    transport,
    checkpointStore,
    batchSize,
    maxRows,
  })
}

test('delivers deterministic keyset pages, stores private checkpoints, and reconciles only confirmed receipts', async () => {
  const source = fakePool({ rows: Array.from({ length: 45 }, (_, index) => sourceRow(index)) })
  const checkpoints = checkpointFixture()
  const deliveries = transportFixture({ statuses: ['accepted', 'idempotent', 'accepted'] })
  const currentRunner = runner({
    pool: source.pool,
    checkpointStore: checkpoints.store,
    transport: deliveries.transport,
  })

  const summary = await currentRunner.run({ intent: ATENDIMENTO_CRM_PROJECTION_BACKFILL_RUN_INTENT })

  assert.deepEqual(summary, {
    contractVersion: 'atendimento/crm-core/projection-backfill-reconciliation/v1',
    status: 'reconciled',
    target: TARGET,
    sourceSnapshot: { capturedAt: CAPTURED_AT, rowCount: 45 },
    deliveredCount: 45,
    batchCount: 3,
    acceptedCount: 2,
    idempotentCount: 1,
    reconciliationDigest: summary.reconciliationDigest,
  })
  assert.match(summary.reconciliationDigest, /^sha256:[a-f0-9]{64}$/)
  assert.equal(deliveries.deliveries().length, 3)
  assert.deepEqual(deliveries.deliveries().map(({ batch }) => batch.events.length), [20, 20, 5])
  assert.equal(deliveries.deliveries().every(({ batch }) => !JSON.stringify(batch).includes(sourceRow(0).id)), true)
  assert.equal(JSON.stringify(summary).includes(sourceRow(0).id), false)
  assert.equal(source.calls.filter((call) => call.sql === SOURCE.firstPageSql).length, 1)
  assert.equal(source.calls.filter((call) => call.sql === SOURCE.nextPageSql).length, 2)
  assert.equal(source.calls.filter((call) => call.sql === SOURCE.rowsSql).length, 1)
  assert.equal(source.calls.some((call) => /\bOFFSET\b/i.test(call.sql)), false)
  assert.deepEqual(source.calls.find((call) => call.sql === SOURCE.firstPageSql).params, [20])
  assert.deepEqual(source.calls.filter((call) => call.sql === SOURCE.nextPageSql).map((call) => call.params.at(-1)), [20, 5])
  assert.equal(source.calls.at(-1).sql, 'ROLLBACK')
  assert.equal(source.released(), true)
  assert.equal(checkpoints.active(), null)
  assert.equal(checkpoints.completions().length, 1)
  assert.equal(checkpoints.writes().at(-1).pending, null)
})

test('refuses to replace an outstanding private checkpoint with a different source snapshot', async () => {
  const source = fakePool()
  const checkpoints = checkpointFixture({ initial: Object.freeze({ pending: 'operator-reconciliation-required' }) })
  const deliveries = transportFixture()
  const currentRunner = runner({
    pool: source.pool,
    checkpointStore: checkpoints.store,
    transport: deliveries.transport,
  })

  await assert.rejects(
    () => currentRunner.run({ intent: ATENDIMENTO_CRM_PROJECTION_BACKFILL_RUN_INTENT }),
    /ATENDIMENTO_CRM_BACKFILL_RUNNER_CHECKPOINT_RECOVERY_REQUIRED/,
  )
  assert.equal(source.connectCount(), 0)
  assert.equal(deliveries.deliveries().length, 0)
})

test('retains a pending checkpoint and rolls back the read-only transaction when delivery cannot be confirmed', async () => {
  const source = fakePool({ rows: Array.from({ length: 2 }, (_, index) => sourceRow(index)) })
  const checkpoints = checkpointFixture()
  const deliveries = transportFixture({ failure: new Error('ATENDIMENTO_CRM_BACKFILL_TRANSPORT_UNAVAILABLE') })
  const currentRunner = runner({
    pool: source.pool,
    checkpointStore: checkpoints.store,
    transport: deliveries.transport,
  })

  await assert.rejects(
    () => currentRunner.run({ intent: ATENDIMENTO_CRM_PROJECTION_BACKFILL_RUN_INTENT }),
    /ATENDIMENTO_CRM_BACKFILL_TRANSPORT_UNAVAILABLE/,
  )
  assert.equal(source.calls.at(-1).sql, 'ROLLBACK')
  assert.equal(checkpoints.completions().length, 0)
  assert.ok(checkpoints.active()?.pending)
  assert.equal(checkpoints.active().progress.deliveredCount, 0)
})

test('replays the exact private pending packet and resumes when a new transaction has the same bounded source input', async () => {
  const firstSource = fakePool({ rows: Array.from({ length: 2 }, (_, index) => sourceRow(index)) })
  const checkpoints = checkpointFixture()
  const failedDelivery = transportFixture({ failure: new Error('ATENDIMENTO_CRM_BACKFILL_TRANSPORT_UNAVAILABLE') })
  const firstRunner = runner({
    pool: firstSource.pool,
    checkpointStore: checkpoints.store,
    transport: failedDelivery.transport,
  })

  await assert.rejects(
    () => firstRunner.run({ intent: ATENDIMENTO_CRM_PROJECTION_BACKFILL_RUN_INTENT }),
    /ATENDIMENTO_CRM_BACKFILL_TRANSPORT_UNAVAILABLE/,
  )
  const pending = structuredClone(checkpoints.active().pending)

  const resumedSource = fakePool({
    rows: Array.from({ length: 2 }, (_, index) => sourceRow(index)),
    capturedAt: '2026-09-07T00:00:01.000Z',
  })
  const replayDelivery = transportFixture({ statuses: ['idempotent'] })
  const resumedRunner = runner({
    pool: resumedSource.pool,
    checkpointStore: checkpoints.store,
    transport: replayDelivery.transport,
  })
  const summary = await resumedRunner.run({ intent: ATENDIMENTO_CRM_PROJECTION_BACKFILL_RUN_INTENT })

  assert.equal(replayDelivery.deliveries().length, 1)
  assert.equal(replayDelivery.deliveries()[0].batch.batchId, pending.batch.batchId)
  assert.deepEqual(replayDelivery.deliveries()[0].delivery, pending.delivery)
  assert.equal(summary.deliveredCount, 2)
  assert.equal(summary.batchCount, 1)
  assert.equal(summary.acceptedCount, 0)
  assert.equal(summary.idempotentCount, 1)
  assert.equal(resumedSource.calls.some((call) => call.sql === SOURCE.firstPageSql), false)
  assert.equal(checkpoints.active(), null)
})

test('replays a pending packet before failing a new transaction whose bounded source input changed', async () => {
  const firstSource = fakePool({ rows: Array.from({ length: 2 }, (_, index) => sourceRow(index)) })
  const checkpoints = checkpointFixture()
  const failedDelivery = transportFixture({ failure: new Error('ATENDIMENTO_CRM_BACKFILL_TRANSPORT_UNAVAILABLE') })
  const firstRunner = runner({
    pool: firstSource.pool,
    checkpointStore: checkpoints.store,
    transport: failedDelivery.transport,
  })
  await assert.rejects(
    () => firstRunner.run({ intent: ATENDIMENTO_CRM_PROJECTION_BACKFILL_RUN_INTENT }),
    /ATENDIMENTO_CRM_BACKFILL_TRANSPORT_UNAVAILABLE/,
  )

  const changedSourceInput = [
    sourceRow(0),
    sourceRowAt(1, '2026-09-07T00:00:00.999999Z'),
  ]
  const changedSnapshotSource = fakePool({
    rows: changedSourceInput,
    capturedAt: '2026-09-07T00:00:01.000Z',
  })
  const replayDelivery = transportFixture({ statuses: ['idempotent'] })
  const resumedRunner = runner({
    pool: changedSnapshotSource.pool,
    checkpointStore: checkpoints.store,
    transport: replayDelivery.transport,
  })

  await assert.rejects(
    () => resumedRunner.run({ intent: ATENDIMENTO_CRM_PROJECTION_BACKFILL_RUN_INTENT }),
    /ATENDIMENTO_CRM_BACKFILL_RUNNER_CHECKPOINT_SNAPSHOT_MISMATCH/,
  )
  assert.equal(replayDelivery.deliveries().length, 1)
  assert.equal(changedSnapshotSource.calls.at(-1).sql, 'ROLLBACK')
  assert.equal(checkpoints.active().pending, null)
  assert.equal(checkpoints.active().progress.deliveredCount, 2)
})

test('refuses a checkpoint for another CRM target before replaying its pending packet', async () => {
  const firstSource = fakePool({ rows: Array.from({ length: 2 }, (_, index) => sourceRow(index)) })
  const checkpoints = checkpointFixture()
  const failedDelivery = transportFixture({ failure: new Error('ATENDIMENTO_CRM_BACKFILL_TRANSPORT_UNAVAILABLE') })
  const firstRunner = runner({
    pool: firstSource.pool,
    checkpointStore: checkpoints.store,
    transport: failedDelivery.transport,
  })
  await assert.rejects(
    () => firstRunner.run({ intent: ATENDIMENTO_CRM_PROJECTION_BACKFILL_RUN_INTENT }),
    /ATENDIMENTO_CRM_BACKFILL_TRANSPORT_UNAVAILABLE/,
  )

  const resumedSource = fakePool({ rows: Array.from({ length: 2 }, (_, index) => sourceRow(index)) })
  const otherTransport = transportFixture()
  const resumedRunner = runner({
    pool: resumedSource.pool,
    checkpointStore: checkpoints.store,
    transport: otherTransport.transport,
    target: OTHER_TARGET,
  })
  await assert.rejects(
    () => resumedRunner.run({ intent: ATENDIMENTO_CRM_PROJECTION_BACKFILL_RUN_INTENT }),
    /ATENDIMENTO_CRM_BACKFILL_RUNNER_CHECKPOINT_TARGET_MISMATCH/,
  )
  assert.equal(otherTransport.deliveries().length, 0)
  assert.equal(resumedSource.connectCount(), 0)
  assert.ok(checkpoints.active()?.pending)
})

test('keeps the exact PostgreSQL microsecond and unit cursor for three-column keyset pagination', async () => {
  const rows = [
    sourceRowAt(1, '2026-09-07T00:00:00.123001Z', 'barra-shopping-sul'),
    sourceRowAt(1, '2026-09-07T00:00:00.123001Z', 'novo-hamburgo'),
    sourceRowAt(3, '2026-09-07T00:00:00.124000Z'),
  ]
  const source = fakePool({ rows })
  const checkpoints = checkpointFixture()
  const deliveries = transportFixture({ statuses: ['accepted'] })
  const currentRunner = runner({
    pool: source.pool,
    checkpointStore: checkpoints.store,
    transport: deliveries.transport,
    batchSize: 1,
  })
  const summary = await currentRunner.run({ intent: ATENDIMENTO_CRM_PROJECTION_BACKFILL_RUN_INTENT })
  const cursorParameters = source.calls
    .filter((call) => call.sql === SOURCE.nextPageSql)
    .map((call) => call.params.slice(0, 3))

  assert.equal(summary.deliveredCount, 3)
  assert.equal(deliveries.deliveries().length, 3)
  assert.deepEqual(cursorParameters, [
    ['2026-09-07T00:00:00.123001Z', '123e4567-e89b-42d3-a456-000000000001', 'barra-shopping-sul'],
    ['2026-09-07T00:00:00.123001Z', '123e4567-e89b-42d3-a456-000000000001', 'novo-hamburgo'],
  ])
})

test('fails closed on non-monotonic source pages before the page is signed or delivered', async () => {
  const source = fakePool({ rows: [sourceRow(1), sourceRow(0)], preserveSourceOrder: true })
  const checkpoints = checkpointFixture()
  const deliveries = transportFixture()
  const currentRunner = runner({
    pool: source.pool,
    checkpointStore: checkpoints.store,
    transport: deliveries.transport,
  })

  await assert.rejects(
    () => currentRunner.run({ intent: ATENDIMENTO_CRM_PROJECTION_BACKFILL_RUN_INTENT }),
    /ATENDIMENTO_CRM_BACKFILL_RUNNER_CURSOR_INVALID/,
  )
  assert.equal(deliveries.deliveries().length, 0)
  assert.equal(source.calls.at(-1).sql, 'ROLLBACK')
})

test('requires explicit intent and is staging-only by construction', async () => {
  const source = fakePool()
  const checkpoints = checkpointFixture()
  const deliveries = transportFixture()
  const currentRunner = runner({
    pool: source.pool,
    checkpointStore: checkpoints.store,
    transport: deliveries.transport,
  })

  await assert.rejects(() => currentRunner.run(), /ATENDIMENTO_CRM_BACKFILL_RUNNER_INTENT_REQUIRED/)
  assert.equal(source.connectCount(), 0)
  assert.throws(() => runner({
    pool: source.pool,
    checkpointStore: checkpoints.store,
    transport: deliveries.transport,
    target: { ...TARGET, environment: 'production' },
  }), /ATENDIMENTO_CRM_BACKFILL_RUNNER_STAGING_ONLY/)
})
