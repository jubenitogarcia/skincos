import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseAtendimentoStagingMigrationAction,
  runAtendimentoStagingMigration,
  ATENDIMENTO_STAGING_MIGRATIONS,
  ATENDIMENTO_STAGING_MIGRATION_POOL_MAX,
  ATENDIMENTO_STAGING_MIGRATION_LOCK_KEY,
  ATENDIMENTO_STAGING_MIGRATOR_CONNECTION_LIMIT,
} from './migrate-atendimento-staging.mjs'
import { runHarmoniaMigration } from './migrate-harmonia-schema.mjs'

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

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
      if (sql.includes('rolconnlimit')) return { rows: [{ valid: true }] }
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
  let leased = 0
  let maxLeased = 0
  let poolOptions = null
  const report = await runAtendimentoStagingMigration({
    databaseUrl,
    action: 'dry-run',
    createRunId: () => 'synthetic-run',
    createPool: (_, options) => {
      poolOptions = options
      return {
        async connect() {
          const client = [lockClient, identityClient][connects++]
          assert.ok(client, 'the staging migration runner must not lease a third client')
          leased += 1
          maxLeased = Math.max(maxLeased, leased)
          let releasedClient = false
          return {
            query: client.query.bind(client),
            release() {
              if (releasedClient) return
              releasedClient = true
              leased -= 1
              client.release()
            },
          }
        },
        async end() { ended = true },
      }
    },
    assertDestination: async () => ({ database: 'skincos_staging', user: 'skincos_staging_crm_owner', target: 'staging' }),
  })
  assert.equal(report.runId, 'synthetic-run')
  assert.equal(ATENDIMENTO_STAGING_MIGRATOR_CONNECTION_LIMIT, 3)
  assert.deepEqual(poolOptions, { max: ATENDIMENTO_STAGING_MIGRATION_POOL_MAX })
  assert.equal(ATENDIMENTO_STAGING_MIGRATION_POOL_MAX, 2)
  assert.equal(connects, 2)
  assert.equal(maxLeased, 2)
  assert.equal(leased, 0)
  assert.equal(calls[0].sql.includes('pg_try_advisory_lock'), true)
  assert.deepEqual(calls[0].values, [ATENDIMENTO_STAGING_MIGRATION_LOCK_KEY])
  assert.deepEqual(calls[1].values, [ATENDIMENTO_STAGING_MIGRATOR_CONNECTION_LIMIT])
  assert.equal(calls.at(-1).sql.includes('pg_advisory_unlock'), true)
  assert.equal(released, true)
  assert.equal(ended, true)
})

test('staging migration refuses a role below the connection contract before requesting its second client', async () => {
  const databaseUrl = 'postgresql://skincos_staging_migrator_login:synthetic@127.0.0.1:5432/skincos_staging?sslmode=require&uselibpqcompat=true'
  let connects = 0
  let released = false
  let ended = false
  await assert.rejects(
    runAtendimentoStagingMigration({
      databaseUrl,
      action: 'dry-run',
      createPool: (_, options) => ({
        async connect() {
          connects += 1
          assert.equal(connects, 1, 'a role below the contract must never reach the second checkout')
          assert.deepEqual(options, { max: ATENDIMENTO_STAGING_MIGRATION_POOL_MAX })
          return {
            async query(sql) {
              if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] }
              if (sql.includes('rolconnlimit')) return { rows: [{ valid: false }] }
              if (sql.includes('pg_advisory_unlock')) return { rows: [{ unlocked: true }] }
              throw new Error(`unexpected query: ${sql}`)
            },
            release() { released = true },
          }
        },
        async end() { ended = true },
      }),
    }),
    /ATENDIMENTO_STAGING_MIGRATOR_CONNECTION_LIMIT_INVALID/,
  )
  assert.equal(connects, 1)
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

test('an active two-client migration lets one Harmonia contender observe the shared lock without writes', async () => {
  const databaseUrl = 'postgresql://skincos_staging_migrator_login:synthetic@127.0.0.1:5432/skincos_staging?sslmode=require&uselibpqcompat=true'
  const identityEntered = deferred()
  const continueIdentity = deferred()
  let mutationLockHeld = false
  let activeConnections = 0
  let maxActiveConnections = 0
  let primaryPoolOptions = null
  let contenderPoolOptions = null
  let primaryEnded = false
  let contenderEnded = false

  const lease = (client) => {
    activeConnections += 1
    maxActiveConnections = Math.max(maxActiveConnections, activeConnections)
    let released = false
    return {
      query: client.query.bind(client),
      release() {
        if (released) return
        released = true
        activeConnections -= 1
        client.release?.()
      },
    }
  }
  const lockClient = {
    async query(sql) {
      if (sql.includes('pg_try_advisory_lock')) {
        assert.equal(mutationLockHeld, false)
        mutationLockHeld = true
        return { rows: [{ acquired: true }] }
      }
      if (sql.includes('rolconnlimit')) return { rows: [{ valid: true }] }
      if (sql.includes('pg_advisory_unlock')) {
        mutationLockHeld = false
        return { rows: [{ unlocked: true }] }
      }
      throw new Error(`unexpected primary lock query: ${sql}`)
    },
  }
  const identityClient = {
    async query(sql) {
      if (sql === 'begin' || sql === 'commit') return { rows: [] }
      if (sql.includes("to_regclass('crm_atendimento.schema_migrations')")) return { rows: [{ registry: null }] }
      throw new Error(`unexpected primary identity query: ${sql}`)
    },
  }
  const primary = runAtendimentoStagingMigration({
    databaseUrl,
    action: 'dry-run',
    createPool: (_, options) => {
      primaryPoolOptions = options
      let index = 0
      return {
        async connect() {
          const client = [lockClient, identityClient][index++]
          assert.ok(client, 'the primary migration must stay inside its two-client pool budget')
          return lease(client)
        },
        async end() { primaryEnded = true },
      }
    },
    assertDestination: async () => {
      identityEntered.resolve()
      await continueIdentity.promise
      return { database: 'skincos_staging', user: 'skincos_staging_migrator_login', target: 'staging' }
    },
  })

  await identityEntered.promise
  assert.equal(activeConnections, 2)
  await assert.rejects(
    runHarmoniaMigration({
      databaseUrl,
      target: 'staging',
      action: 'dry-run',
      createPool: (_, options) => {
        contenderPoolOptions = options
        return {
          async connect() {
            return lease({
              async query(sql) {
                if (sql.includes('pg_try_advisory_lock')) {
                  assert.equal(mutationLockHeld, true)
                  return { rows: [{ acquired: false }] }
                }
                if (sql === 'rollback') return { rows: [] }
                throw new Error(`unexpected contender query: ${sql}`)
              },
            })
          },
          async end() { contenderEnded = true },
        }
      },
    }),
    /HARMONIA_STAGING_MIGRATION_LOCK_UNAVAILABLE/,
  )
  assert.equal(maxActiveConnections, 3)
  assert.deepEqual(primaryPoolOptions, { max: ATENDIMENTO_STAGING_MIGRATION_POOL_MAX })
  assert.deepEqual(contenderPoolOptions, { max: 1 })
  assert.equal(contenderEnded, true)

  continueIdentity.resolve()
  await primary
  assert.equal(activeConnections, 0)
  assert.equal(mutationLockHeld, false)
  assert.equal(primaryEnded, true)
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
