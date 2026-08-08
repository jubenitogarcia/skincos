import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseAtendimentoStagingMigrationAction,
  runAtendimentoStagingMigration,
  ATENDIMENTO_STAGING_MIGRATIONS,
  ATENDIMENTO_STAGING_MIGRATION_LOCK_KEY,
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

test('staging migration runner takes a dedicated advisory lock before inspecting or mutating schema', async () => {
  const databaseUrl = 'postgresql://skincos_staging_migrator_login:synthetic@127.0.0.1:5432/skincos_staging?sslmode=require&uselibpqcompat=true'
  const calls = []
  let released = false
  let ended = false
  const lockClient = {
    async query(sql, values) {
      calls.push({ sql, values })
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] }
      if (sql.includes('pg_advisory_unlock')) return { rows: [{ unlocked: true }] }
      throw new Error(`unexpected lock query: ${sql}`)
    },
    release() { released = true },
  }
  const identityClient = {
    async query(sql) {
      calls.push({ sql })
      if (sql === 'begin' || sql === 'commit') return { rows: [] }
      if (sql.includes("to_regclass('crm_atendimento.schema_migrations')")) return { rows: [{ registry: null }] }
      throw new Error(`unexpected identity query: ${sql}`)
    },
    release() {},
  }
  let connects = 0
  const report = await runAtendimentoStagingMigration({
    databaseUrl,
    action: 'dry-run',
    createRunId: () => 'synthetic-run',
    createPool: () => ({
      async connect() { return connects++ === 0 ? lockClient : identityClient },
      async end() { ended = true },
    }),
    assertDestination: async () => ({ database: 'skincos_staging', user: 'skincos_staging_crm_owner', target: 'staging' }),
  })
  assert.equal(report.runId, 'synthetic-run')
  assert.equal(calls[0].sql.includes('pg_try_advisory_lock'), true)
  assert.deepEqual(calls[0].values, [ATENDIMENTO_STAGING_MIGRATION_LOCK_KEY])
  assert.equal(calls.at(-1).sql.includes('pg_advisory_unlock'), true)
  assert.equal(released, true)
  assert.equal(ended, true)
})

test('staging migration fails closed when the advisory lock is already held', async () => {
  const databaseUrl = 'postgresql://skincos_staging_migrator_login:synthetic@127.0.0.1:5432/skincos_staging?sslmode=require&uselibpqcompat=true'
  let ended = false
  await assert.rejects(
    runAtendimentoStagingMigration({
      databaseUrl,
      action: 'apply',
      createPool: () => ({
        async connect() {
          return {
            async query(sql) {
              if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: false }] }
              throw new Error(`unexpected query: ${sql}`)
            },
            release() {},
          }
        },
        async end() { ended = true },
      }),
    }),
    /ATENDIMENTO_STAGING_MIGRATION_LOCK_UNAVAILABLE/,
  )
  assert.equal(ended, true)
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
