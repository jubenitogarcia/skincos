import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ATENDIMENTO_PROJECTION_EXPORT_COUNT_SQL,
  ATENDIMENTO_PROJECTION_EXPORT_IDENTITY_SQL,
  ATENDIMENTO_PROJECTION_EXPORT_ROWS_SQL,
  ATENDIMENTO_PROJECTION_EXPORT_SNAPSHOT_SQL,
  assertAtendimentoProjectionBackfillBatch,
  exportAtendimentoClientProjectionBatch,
} from '../src/atendimentoProjectionExporter.mjs'

const HMAC_KEY = 'synthetic-atendimento-projection-export-key-at-least-32-bytes'
const TARGET = Object.freeze({
  environment: 'staging',
  release: 'a'.repeat(40),
  artifactDigest: `sha256:${'b'.repeat(64)}`,
})
const SOURCE_ID = '123e4567-e89b-42d3-a456-426614174000'

function fakePool({
  rows = [{ id: SOURCE_ID, updated_at: '2026-09-07T00:00:00.000Z' }],
  rowCount = rows.length,
  identity = {
    database_name: 'skincos_clientes_production',
    current_user: 'crm_core_projection_exporter',
    session_user: 'crm_core_projection_exporter',
    transaction_read_only: 'on',
  },
} = {}) {
  const calls = []
  let released = false
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params })
      if (sql === 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY') return { rows: [] }
      if (sql === ATENDIMENTO_PROJECTION_EXPORT_IDENTITY_SQL) return { rows: [identity] }
      if (sql === ATENDIMENTO_PROJECTION_EXPORT_SNAPSHOT_SQL) return { rows: [{ captured_at: '2026-09-07T00:00:00.000Z' }] }
      if (sql === ATENDIMENTO_PROJECTION_EXPORT_COUNT_SQL) return { rows: [{ row_count: rowCount }] }
      if (sql === ATENDIMENTO_PROJECTION_EXPORT_ROWS_SQL) return { rows }
      if (sql === 'ROLLBACK') return { rows: [] }
      throw new Error('unexpected query')
    },
    release() { released = true },
  }
  return { calls, pool: { async connect() { return client } }, released: () => released }
}

async function exportBatch(options = {}) {
  return exportAtendimentoClientProjectionBatch({
    pool: options.pool,
    hmacKey: HMAC_KEY,
    keyId: 'atendimento-projection-key-v1',
    target: TARGET,
    ...options,
  })
}

test('exports a repeatable-read, opaque batch without serializing a source UUID or customer data', async () => {
  const fixture = fakePool()
  const batch = await exportBatch({ pool: fixture.pool })
  const serialized = JSON.stringify(batch)

  assert.equal(batch.contract, 'skincos-crm/projection-backfill-batch/v1')
  assert.match(batch.batchId, /^backfill:atendimento:[A-Za-z0-9_-]+$/)
  assert.deepEqual(batch.producer, {
    owner: 'atendimento', scope: 'global-client-identities/v1', keyId: 'atendimento-projection-key-v1',
  })
  assert.equal(batch.events.length, 1)
  assert.match(batch.events[0].id, /^event:/)
  assert.match(batch.events[0].projection.reference, /^projection:/)
  assert.match(batch.events[0].source.reference, /^source:/)
  assert.doesNotMatch(serialized, new RegExp(SOURCE_ID, 'i'))
  assert.doesNotMatch(serialized, /canonical_name|email|phone|contact|password|cookie|session/i)
  assert.equal(fixture.calls[0].sql, 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
  assert.equal(fixture.calls.at(-1).sql, 'ROLLBACK')
  assert.equal(fixture.released(), true)

  const sourceRead = fixture.calls.find((call) => call.sql === ATENDIMENTO_PROJECTION_EXPORT_ROWS_SQL)
  assert.deepEqual(sourceRead.params, [1])
  assert.match(sourceRead.sql, /SELECT id::text AS id, updated_at/)
  assert.doesNotMatch(sourceRead.sql, /canonical_name|email|phone|member|contact/i)
})

test('batch output is deterministic for the same immutable source snapshot and HMAC key', async () => {
  const first = await exportBatch({ pool: fakePool().pool })
  const second = await exportBatch({ pool: fakePool().pool })

  assert.deepEqual(second, first)
  assert.equal(assertAtendimentoProjectionBackfillBatch(first).integrity.eventsDigest, first.integrity.eventsDigest)
})

test('fails before source-row selection when the principal is not dedicated and read-only', async () => {
  const fixture = fakePool({ identity: {
    database_name: 'skincos_clientes_production',
    current_user: 'skincos_clientes_migrator_login',
    session_user: 'skincos_clientes_migrator_login',
    transaction_read_only: 'off',
  } })

  await assert.rejects(() => exportBatch({ pool: fixture.pool }), {
    message: 'ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_IDENTITY_UNSAFE',
  })
  assert.equal(fixture.calls.some((call) => call.sql === ATENDIMENTO_PROJECTION_EXPORT_ROWS_SQL), false)
  assert.equal(fixture.calls.at(-1).sql, 'ROLLBACK')
})

test('fails closed rather than creating a partial historical batch beyond the bounded snapshot limit', async () => {
  const fixture = fakePool({ rowCount: 3, rows: [] })

  await assert.rejects(() => exportBatch({ pool: fixture.pool, maxRows: 2 }), {
    message: 'ATENDIMENTO_CRM_PROJECTION_EXPORT_LIMIT_EXCEEDED',
  })
  assert.equal(fixture.calls.some((call) => call.sql === ATENDIMENTO_PROJECTION_EXPORT_ROWS_SQL), false)
})

test('rejects a source query result that expands beyond id and updated_at', async () => {
  const fixture = fakePool({ rows: [{
    id: SOURCE_ID,
    updated_at: '2026-09-07T00:00:00.000Z',
    canonical_name: 'must-never-leave-atendimento',
  }] })

  await assert.rejects(() => exportBatch({ pool: fixture.pool }), {
    message: 'ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_ROW_INVALID',
  })
})

test('rejects a batch whose event shape or digest is expanded after export', async () => {
  const original = await exportBatch({ pool: fakePool().pool })
  const expanded = structuredClone(original)
  expanded.events[0].email = 'never-allowed@example.test'

  assert.throws(() => assertAtendimentoProjectionBackfillBatch(expanded), {
    message: 'ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID',
  })
})
