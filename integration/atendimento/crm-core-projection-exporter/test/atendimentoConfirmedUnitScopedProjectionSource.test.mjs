import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE,
  ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE_SEMANTICS,
} from '../src/atendimentoConfirmedUnitScopedProjectionSource.mjs'
import {
  ATENDIMENTO_PROJECTION_EXPORT_IDENTITY_SQL,
  ATENDIMENTO_PROJECTION_EXPORT_SNAPSHOT_SQL,
  ATENDIMENTO_UNIT_SCOPED_PROJECTION_SOURCE_CONTRACT,
  createAtendimentoUnitScopedProjectionSource,
  exportAtendimentoClientProjectionBatch,
} from '../src/atendimentoProjectionExporter.mjs'

const HMAC_KEY = `synthetic-confirmed-unit-test-${'x'.repeat(40)}`
const TARGET = Object.freeze({
  environment: 'staging',
  release: 'a'.repeat(40),
  artifactDigest: `sha256:${'b'.repeat(64)}`,
})
const IDENTITY_ID = '123e4567-e89b-42d3-a456-426614174000'

function sourceRow({
  id = IDENTITY_ID,
  updated_at = '2026-09-07T00:00:00.000000Z',
  unit_slug = 'novo-hamburgo',
} = {}) {
  return { id, updated_at, unit_slug }
}

function fixturePool(rows) {
  const calls = []
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params })
      if (sql === 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY' || sql === 'ROLLBACK') return { rows: [] }
      if (sql === ATENDIMENTO_PROJECTION_EXPORT_IDENTITY_SQL) {
        return { rows: [{
          database_name: 'skincos_clientes_production',
          current_user: 'crm_core_projection_exporter',
          session_user: 'crm_core_projection_exporter',
          transaction_read_only: 'on',
        }] }
      }
      if (sql === ATENDIMENTO_PROJECTION_EXPORT_SNAPSHOT_SQL) return { rows: [{ captured_at: '2026-09-07T00:00:00.000Z' }] }
      if (sql === ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE.countSql) return { rows: [{ row_count: rows.length }] }
      if (sql === ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE.rowsSql) return { rows }
      throw new Error('unexpected query')
    },
    release() {},
  }
  return { calls, pool: { async connect() { return client } } }
}

async function exportConfirmed(rows) {
  return exportAtendimentoClientProjectionBatch({
    pool: fixturePool(rows).pool,
    source: ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE,
    hmacKey: HMAC_KEY,
    keyId: 'atendimento-confirmed-unit-source-v1',
    target: TARGET,
  })
}

function sourceWithLeadingComment(prefix) {
  return createAtendimentoUnitScopedProjectionSource({
    contract: ATENDIMENTO_UNIT_SCOPED_PROJECTION_SOURCE_CONTRACT,
    countSql: 'SELECT count(*)::int AS row_count FROM test_source',
    rowsSql: `${prefix} SELECT id::text AS id, updated_at AS updated_at, unit_slug AS unit_slug FROM test_source ORDER BY updated_at ASC, id ASC, unit_slug ASC LIMIT $1`,
    firstPageSql: `${prefix} SELECT id::text AS id, updated_at AS updated_at, unit_slug AS unit_slug FROM test_source ORDER BY updated_at ASC, id ASC, unit_slug ASC LIMIT $1`,
    nextPageSql: `${prefix} SELECT id::text AS id, updated_at AS updated_at, unit_slug AS unit_slug FROM test_source WHERE (updated_at, id, unit_slug) > ($1::timestamptz, $2::uuid, $3::text) ORDER BY updated_at ASC, id ASC, unit_slug ASC LIMIT $4`,
  })
}

test('expresses the proven four-channel unit membership without a global fallback or source PII', () => {
  const { countSql, rowsSql, firstPageSql, nextPageSql } = ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE
  const queries = [countSql, rowsSql, firstPageSql, nextPageSql]

  for (const query of queries) {
    assert.match(query, /crm_atendimento\.global_client_identity_members/i)
    assert.match(query, /crm_atendimento\.units/i)
    assert.doesNotMatch(query, /\b(?:canonical_name|phone_key|email_keys|cpf_keys|client_name|raw_service)\b/i)
  }
  for (const sourceType of ['attendance_client', 'caixa_customer', 'app_registration', 'lead_profile']) {
    assert.match(rowsSql, new RegExp(`source_type = '${sourceType}'`))
  }
  assert.match(rowsSql, /attendance\.deleted_at IS NULL/)
  assert.match(rowsSql, /GROUP BY identity_id, unit_slug/)
  assert.match(nextPageSql, /projection_rows AS \(\s*SELECT identity_id,\s*observed_at,/)
  assert.match(rowsSql, /SELECT id, updated_at, unit_slug/)
  assert.match(nextPageSql, /WHERE \(observed_at, identity_id, unit_slug\) > \(\$1::timestamptz, \$2::uuid, \$3::text\)/)
  assert.doesNotMatch(nextPageSql, /\bOFFSET\b/i)
  assert.equal(ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE_SEMANTICS.missingEvidence, 'no projection row; there is no global or wildcard fallback')
})

test('emits one opaque event per canonical unit for an identity with multi-unit evidence', async () => {
  const batch = await exportConfirmed([
    sourceRow({ unit_slug: 'barra-shopping-sul' }),
    sourceRow({ unit_slug: 'novo-hamburgo' }),
  ])

  assert.deepEqual(batch.sourceSnapshot.unitSlugs, ['barra-shopping-sul', 'novo-hamburgo'])
  assert.equal(batch.events.length, 2)
  assert.equal(batch.events[0].projection.reference, batch.events[1].projection.reference)
  assert.notEqual(batch.events[0].id, batch.events[1].id)
  assert.deepEqual(batch.events.map((event) => event.revision), [1, 1])
  assert.equal(JSON.stringify(batch).includes(IDENTITY_ID), false)
})

test('rejects a source result with duplicate identity/unit output instead of silently choosing a conflicting membership', async () => {
  await assert.rejects(() => exportConfirmed([
    sourceRow(),
    sourceRow(),
  ]), /ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_READBACK_INVALID/)
})

test('does not manufacture a global projection when the proven membership source is empty', async () => {
  await assert.rejects(() => exportConfirmed([]), /ATENDIMENTO_CRM_PROJECTION_EXPORT_BATCH_INVALID/)
})

test('parses bounded leading SQL comments without nested-regex backtracking', () => {
  const commentPrefix = Array.from({ length: 200 }, () => '/* source contract */').join(' ')
  assert.equal(sourceWithLeadingComment(commentPrefix).contract, ATENDIMENTO_UNIT_SCOPED_PROJECTION_SOURCE_CONTRACT)
  assert.throws(() => sourceWithLeadingComment('/* unterminated'), /ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_INVALID/)
})
