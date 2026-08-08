import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseAtendimentoStagingMigrationAction,
  runAtendimentoStagingMigration,
  ATENDIMENTO_STAGING_MIGRATIONS,
} from './migrate-atendimento-staging.mjs'

test('staging migration parser accepts exactly one explicit action', () => {
  assert.equal(parseAtendimentoStagingMigrationAction(['--dry-run']), 'dry-run')
  assert.equal(parseAtendimentoStagingMigrationAction(['--apply']), 'apply')
  assert.equal(parseAtendimentoStagingMigrationAction(['--rollback']), 'rollback')
  assert.throws(() => parseAtendimentoStagingMigrationAction([]), /exatamente uma ação/)
  assert.throws(() => parseAtendimentoStagingMigrationAction(['--apply', '--rollback']), /exatamente uma ação/)
})

test('staging migration runner rejects an unapproved destination before creating a pool', async () => {
  let created = false
  await assert.rejects(
    runAtendimentoStagingMigration({
      databaseUrl: 'postgresql://unsafe@remote.invalid/not_staging',
      action: 'apply',
      createPool: () => {
        created = true
        throw new Error('must not connect')
      },
    }),
    /DATABASE_URL deve apontar exclusivamente/,
  )
  assert.equal(created, false)
})


test('staging migration includes every Clientes schema domain in dependency order', () => {
  const ids = ATENDIMENTO_STAGING_MIGRATIONS.map((migration) => migration.id)
  const source = ids.indexOf('20260807_clientes_source_operations_v2')
  const clusters = ids.indexOf('20260807_identity_cluster_workspace_v2')
  const operations = ids.indexOf('20260807_commercial_operations_v2')
  const analytics = ids.indexOf('20260807_commercial_analytics_v2')
  const canary = ids.indexOf('20260807_commercial_canary_selector_v2')
  const assisted = ids.indexOf('20260807_commercial_assisted_whatsapp_v2')
  assert.ok(source >= 0)
  assert.ok(clusters > source)
  assert.ok(operations > source)
  assert.ok(analytics > operations)
  assert.ok(canary > analytics)
  assert.equal(assisted, ids.length - 1)
  assert.ok(assisted > canary)
})
