import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ATENDIMENTO_CRM_PROJECTION_MAX_ROWS,
  ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE,
  ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE_SEMANTICS,
  ATENDIMENTO_PROJECTION_EXPORT_IDENTITY_SQL,
  ATENDIMENTO_PROJECTION_EXPORT_SNAPSHOT_SQL,
  ATENDIMENTO_UNIT_SCOPED_PROJECTION_SOURCE_CONTRACT,
  createAtendimentoUnitScopedProjectionSource,
  preflightAtendimentoProjectionSource,
} from './atendimentoCrmCoreProjectionSourceContract.js'
import { ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS } from './atendimentoCrmCoreIdentityMaterializationPolicy.js'

function sourceDefinition() {
  return {
    contract: ATENDIMENTO_UNIT_SCOPED_PROJECTION_SOURCE_CONTRACT,
    countSql: 'SELECT count(*)::int AS row_count FROM crm_atendimento.projection_source',
    rowsSql: 'SELECT id::text AS id, updated_at AS updated_at, unit_slug AS unit_slug FROM crm_atendimento.projection_source ORDER BY updated_at ASC, id ASC, unit_slug ASC LIMIT $1',
    firstPageSql: 'SELECT id::text AS id, updated_at AS updated_at, unit_slug AS unit_slug FROM crm_atendimento.projection_source ORDER BY updated_at ASC, id ASC, unit_slug ASC LIMIT $1',
    nextPageSql: 'SELECT id::text AS id, updated_at AS updated_at, unit_slug AS unit_slug FROM crm_atendimento.projection_source WHERE (updated_at, id, unit_slug) > ($1::timestamptz, $2::uuid, $3::text) ORDER BY updated_at ASC, id ASC, unit_slug ASC LIMIT $4',
  }
}

function createReadOnlyClient({ rowCount = 3 } = {}) {
  const calls = []
  const source = createAtendimentoUnitScopedProjectionSource(sourceDefinition())
  const client = {
    async query(sql) {
      calls.push(sql)
      if (sql === ATENDIMENTO_PROJECTION_EXPORT_IDENTITY_SQL) {
        return { rows: [{
          database_name: 'skincos_clientes_production',
          current_user: 'crm_core_projection_exporter',
          session_user: 'crm_core_projection_exporter',
          transaction_read_only: 'on',
        }] }
      }
      if (sql === ATENDIMENTO_PROJECTION_EXPORT_SNAPSHOT_SQL) {
        return { rows: [{ captured_at: '2026-09-15T12:00:00.000Z' }] }
      }
      if (sql === source.countSql) return { rows: [{ row_count: rowCount }] }
      throw new Error(`unexpected query: ${sql}`)
    },
  }
  return { calls, client, source }
}

test('publishes one immutable, data-minimal confirmed unit source contract', () => {
  const source = ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE
  assert.equal(source.contract, ATENDIMENTO_UNIT_SCOPED_PROJECTION_SOURCE_CONTRACT)
  assert.equal(Object.isFrozen(source), true)
  assert.equal(Object.isFrozen(ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE_SEMANTICS), true)
  assert.deepEqual(
    ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE_SEMANTICS.sourceRelationAllowlist,
    ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS,
  )
  assert.deepEqual(ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE_SEMANTICS.excludedDomains, ['finance'])

  for (const sql of Object.values(source).filter((value) => typeof value === 'string' && value !== source.contract)) {
    assert.match(sql, /crm_atendimento\.(?:crm_core_identity_members|crm_core_attendance_client_links|attendances|units)/i)
    assert.doesNotMatch(sql, /\b(?:canonical_name|phone_key|email_keys|cpf_keys|client_name|raw_service|crm_caixa|sale)\b/i)
  }
})

test('preflights only caller-supplied read-only source metadata and never loads rows', async () => {
  const { calls, client, source } = createReadOnlyClient()
  const receipt = await preflightAtendimentoProjectionSource(client, { source })

  assert.deepEqual(receipt.identity, {
    database: 'skincos_clientes_production',
    currentUser: 'crm_core_projection_exporter',
    sessionUser: 'crm_core_projection_exporter',
    readOnly: 'on',
  })
  assert.equal(receipt.capturedAt, '2026-09-15T12:00:00.000Z')
  assert.equal(receipt.rowCount, 3)
  assert.deepEqual(receipt.source, source)
  assert.equal(Object.isFrozen(receipt), true)
  assert.deepEqual(calls, [
    ATENDIMENTO_PROJECTION_EXPORT_IDENTITY_SQL,
    ATENDIMENTO_PROJECTION_EXPORT_SNAPSHOT_SQL,
    source.countSql,
  ])
  assert.equal(calls.some((sql) => /\b(?:insert|update|delete|truncate|alter|create|drop|commit)\b/i.test(sql)), false)
})

test('rejects mutable source definitions and oversized metadata before row delivery', async () => {
  const invalid = sourceDefinition()
  invalid.rowsSql = 'SELECT id::text AS id, updated_at AS updated_at, unit_slug AS unit_slug FROM crm_atendimento.projection_source ORDER BY updated_at ASC, id ASC, unit_slug ASC LIMIT $1; DELETE FROM crm_atendimento.projection_source'
  assert.throws(
    () => createAtendimentoUnitScopedProjectionSource(invalid),
    /ATENDIMENTO_CRM_PROJECTION_EXPORT_SOURCE_INVALID/,
  )

  const { calls, client, source } = createReadOnlyClient({ rowCount: ATENDIMENTO_CRM_PROJECTION_MAX_ROWS + 1 })
  await assert.rejects(
    () => preflightAtendimentoProjectionSource(client, { source }),
    /ATENDIMENTO_CRM_PROJECTION_EXPORT_LIMIT_EXCEEDED/,
  )
  assert.deepEqual(calls, [
    ATENDIMENTO_PROJECTION_EXPORT_IDENTITY_SQL,
    ATENDIMENTO_PROJECTION_EXPORT_SNAPSHOT_SQL,
    source.countSql,
  ])
})
