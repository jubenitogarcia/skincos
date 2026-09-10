import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ATENDIMENTO_PROJECTION_EXPORT_IDENTITY_SQL,
  ATENDIMENTO_PROJECTION_EXPORT_LEGACY_COUNT_SQL,
  ATENDIMENTO_PROJECTION_EXPORT_LEGACY_FIRST_PAGE_SQL,
  ATENDIMENTO_PROJECTION_EXPORT_LEGACY_NEXT_PAGE_SQL,
  ATENDIMENTO_PROJECTION_EXPORT_LEGACY_ROWS_SQL,
  ATENDIMENTO_PROJECTION_EXPORT_SNAPSHOT_SQL,
  ATENDIMENTO_UNIT_SCOPED_PROJECTION_SOURCE_CONTRACT,
  assertAtendimentoProjectionBackfillBatch,
  createAtendimentoProjectionBackfillBatch,
  createAtendimentoUnitScopedProjectionSource,
  exportAtendimentoClientProjectionBatch,
} from '../src/atendimentoProjectionExporter.mjs'
import {
  createAtendimentoProjectionBackfillBatch as createSharedAtendimentoProjectionBackfillBatch,
} from '../../../../shared/crm-auth/atendimentoProjectionBackfillBatch.js'

const HMAC_KEY = `synthetic-projection-export-test-${'x'.repeat(40)}`
const TARGET = Object.freeze({
  environment: 'staging',
  release: 'a'.repeat(40),
  artifactDigest: `sha256:${'b'.repeat(64)}`,
})
const SOURCE_ID = '123e4567-e89b-42d3-a456-426614174000'
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

function sourceRow({
  id = SOURCE_ID,
  updated_at = '2026-09-07T00:00:00.000Z',
  unit_slug = 'novo-hamburgo',
} = {}) {
  return { id, updated_at, unit_slug }
}

function fakePool({
  rows = [sourceRow()],
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
      if (sql === SOURCE.countSql) return { rows: [{ row_count: rowCount }] }
      if (sql === SOURCE.rowsSql) return { rows }
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
    source: SOURCE,
    hmacKey: HMAC_KEY,
    keyId: 'atendimento-projection-key-v2',
    target: TARGET,
    ...options,
  })
}

test('exports a repeatable-read, unit-scoped opaque v2 batch without serializing a source UUID or customer data', async () => {
  const fixture = fakePool()
  const batch = await exportBatch({ pool: fixture.pool })
  const serialized = JSON.stringify(batch)

  assert.equal(batch.contract, 'skincos-crm/projection-backfill-batch/v2')
  assert.match(batch.batchId, /^backfill:atendimento:[A-Za-z0-9_-]+$/)
  assert.deepEqual(batch.producer, {
    owner: 'atendimento', scope: 'global-client-identities/v1', keyId: 'atendimento-projection-key-v2',
  })
  assert.equal(batch.events.length, 1)
  assert.deepEqual(batch.events[0].unitScope, { unitSlug: 'novo-hamburgo' })
  assert.deepEqual(batch.sourceSnapshot.unitSlugs, ['novo-hamburgo'])
  assert.match(batch.events[0].id, /^event:/)
  assert.match(batch.events[0].projection.reference, /^projection:/)
  assert.match(batch.events[0].source.reference, /^source:/)
  assert.doesNotMatch(serialized, new RegExp(SOURCE_ID, 'i'))
  assert.doesNotMatch(serialized, /canonical_name|email|phone|contact|password|cookie|session/i)
  assert.equal(fixture.calls[0].sql, 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
  assert.equal(fixture.calls.at(-1).sql, 'ROLLBACK')
  assert.equal(fixture.released(), true)

  const sourceRead = fixture.calls.find((call) => call.sql === SOURCE.rowsSql)
  assert.deepEqual(sourceRead.params, [1])
  assert.match(sourceRead.sql, /unit_slug AS unit_slug/i)
  assert.doesNotMatch(sourceRead.sql, /canonical_name|email|phone|member|contact/i)
})

test('allows one global identity in multiple explicit unit scopes without an event HMAC collision', () => {
  const batch = createAtendimentoProjectionBackfillBatch({
    rows: [
      sourceRow({ unit_slug: 'novo-hamburgo' }),
      sourceRow({ unit_slug: 'barra-shopping-sul' }),
    ],
    capturedAt: '2026-09-07T00:00:00.000Z',
    hmacKey: HMAC_KEY,
    keyId: 'atendimento-projection-key-v2',
    target: TARGET,
  })

  assert.deepEqual(batch.events.map((event) => event.unitScope.unitSlug), ['barra-shopping-sul', 'novo-hamburgo'])
  assert.equal(batch.events[0].source.reference, batch.events[1].source.reference)
  assert.equal(batch.events[0].projection.reference, batch.events[1].projection.reference)
  assert.notEqual(batch.events[0].id, batch.events[1].id)
  assert.deepEqual(batch.sourceSnapshot.unitSlugs, ['barra-shopping-sul', 'novo-hamburgo'])
})

test('batch output is deterministic for the same immutable source snapshot and HMAC key', async () => {
  const first = await exportBatch({ pool: fakePool().pool })
  const second = await exportBatch({ pool: fakePool().pool })

  assert.deepEqual(second, first)
  assert.equal(assertAtendimentoProjectionBackfillBatch(first).integrity.eventsDigest, first.integrity.eventsDigest)
})

test('uses the neutral shared batch contract for CRM baseline and exporter derivation', () => {
  const input = {
    rows: [
      sourceRow({ unit_slug: 'novo-hamburgo', updated_at: '2026-09-07T00:00:00.123456Z' }),
      sourceRow({ id: '223e4567-e89b-42d3-a456-426614174000', unit_slug: 'barra-shopping-sul', updated_at: '2026-09-07T00:00:00.123457Z' }),
    ],
    capturedAt: '2026-09-07T00:00:01.000Z',
    hmacKey: HMAC_KEY,
    keyId: 'atendimento-projection-key-v2',
    target: TARGET,
  }

  assert.deepEqual(
    createAtendimentoProjectionBackfillBatch(input),
    createSharedAtendimentoProjectionBackfillBatch(input),
  )
})

test('requires an explicit owner source and rejects the retired two-column query family before any pool connection', async () => {
  let connectCount = 0
  const pool = { async connect() { connectCount += 1; throw new Error('must not connect') } }
  await assert.rejects(() => exportAtendimentoClientProjectionBatch({
    pool,
    hmacKey: HMAC_KEY,
    keyId: 'atendimento-projection-key-v2',
    target: TARGET,
  }), /ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_REQUIRED/)
  assert.equal(connectCount, 0)

  assert.throws(() => createAtendimentoUnitScopedProjectionSource({
    contract: ATENDIMENTO_UNIT_SCOPED_PROJECTION_SOURCE_CONTRACT,
    countSql: ATENDIMENTO_PROJECTION_EXPORT_LEGACY_COUNT_SQL,
    rowsSql: ATENDIMENTO_PROJECTION_EXPORT_LEGACY_ROWS_SQL,
    firstPageSql: ATENDIMENTO_PROJECTION_EXPORT_LEGACY_FIRST_PAGE_SQL,
    nextPageSql: ATENDIMENTO_PROJECTION_EXPORT_LEGACY_NEXT_PAGE_SQL,
  }), /ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_INVALID/)
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
  assert.equal(fixture.calls.some((call) => call.sql === SOURCE.rowsSql), false)
  assert.equal(fixture.calls.at(-1).sql, 'ROLLBACK')
})

test('fails closed rather than creating a partial historical batch beyond the bounded snapshot limit', async () => {
  const fixture = fakePool({ rowCount: 3, rows: [] })

  await assert.rejects(() => exportBatch({ pool: fixture.pool, maxRows: 2 }), {
    message: 'ATENDIMENTO_CRM_PROJECTION_EXPORT_LIMIT_EXCEEDED',
  })
  assert.equal(fixture.calls.some((call) => call.sql === SOURCE.rowsSql), false)
})

test('rejects a source query result that expands beyond id, updated_at, and unit_slug', async () => {
  const fixture = fakePool({ rows: [{
    ...sourceRow(),
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
