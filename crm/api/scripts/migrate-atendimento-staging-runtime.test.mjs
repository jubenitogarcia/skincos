import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseAtendimentoStagingMigrationAction,
  parseAtendimentoStagingMigrationInvocation,
  runAtendimentoStagingMigration,
  ATENDIMENTO_STAGING_MIGRATIONS,
  ATENDIMENTO_STAGING_OPTIONAL_COMMERCIAL_MIGRATION_RULES,
  ATENDIMENTO_STAGING_MIGRATION_POOL_MAX,
  ATENDIMENTO_STAGING_MIGRATION_LOCK_KEY,
  ATENDIMENTO_STAGING_MIGRATOR_CONNECTION_LIMIT,
} from './migrate-atendimento-staging.mjs'
import { runHarmoniaMigration } from './migrate-harmonia-schema.mjs'

const TEST_RELEASE_SHA = 'a'.repeat(40)

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function prerequisiteRow(rule, missing = []) {
  return Object.fromEntries(rule.prerequisiteRelations.map((relation, index) => [
    `relation_${index}`,
    !missing.includes(relation),
  ]))
}

function createMutationPool({ registryRows = [], prerequisiteRows = [], evidence = null } = {}) {
  const queries = []
  let connects = 0
  let active = 0
  let maxActive = 0
  let ended = false
  const lease = (client) => {
    active += 1
    maxActive = Math.max(maxActive, active)
    let released = false
    return {
      query: client.query.bind(client),
      release() {
        if (released) return
        released = true
        active -= 1
      },
    }
  }
  const lockClient = {
    async query(sql, values) {
      queries.push({ sql, values })
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] }
      if (sql.includes('rolconnlimit')) return { rows: [{ valid: true }] }
      if (sql.includes('pg_advisory_unlock')) return { rows: [{ unlocked: true }] }
      throw new Error(`unexpected lock query: ${sql}`)
    },
  }
  const workerClient = {
    async query(sql, values) {
      queries.push({ sql, values })
      if (sql === 'begin' || sql === 'commit' || sql === 'rollback' || sql.includes('set local lock_timeout') || sql.includes('set local statement_timeout')) return { rows: [] }
      if (sql.includes('from unnest($1::text[])')) return { rows: [] }
      if (sql.includes('relation_0')) return { rows: [prerequisiteRows.shift() || {}] }
      if (sql.includes("to_regclass('crm_atendimento.schema_migrations')")) return { rows: [{ registry: 'crm_atendimento.schema_migrations' }] }
      if (sql.includes('from crm_atendimento.schema_migrations')) return { rows: registryRows }
      if (sql.includes('to_regclass($1)')) return { rows: [{ relation: evidence ? 'crm_atendimento.staging_migration_evidence' : null }] }
      if (sql.includes('from crm_atendimento.staging_migration_evidence')) return { rows: evidence ? [evidence] : [] }
      if (sql.includes('create table if not exists crm_atendimento.staging_migration_evidence')) return { rows: [] }
      if (sql.includes('revoke all privileges on table crm_atendimento.staging_migration_evidence')) return { rows: [] }
      if (sql.includes('insert into crm_atendimento.staging_migration_evidence')) return { rows: [] }
      throw new Error(`unexpected worker query: ${sql}`)
    },
  }
  return {
    queries,
    get connects() { return connects },
    get maxActive() { return maxActive },
    get ended() { return ended },
    createPool: () => ({
      async connect() {
        const client = connects++ === 0 ? lockClient : workerClient
        return lease(client)
      },
      async end() { ended = true },
    }),
  }
}

test('staging migration parser accepts exactly one explicit action', () => {
  assert.equal(parseAtendimentoStagingMigrationAction(['--dry-run']), 'dry-run')
  assert.equal(parseAtendimentoStagingMigrationAction(['--apply']), 'apply')
  assert.equal(parseAtendimentoStagingMigrationAction(['--rollback']), 'rollback')
  assert.throws(() => parseAtendimentoStagingMigrationAction([]), /exatamente uma ação/)
  assert.throws(() => parseAtendimentoStagingMigrationAction(['--apply', '--rollback']), /exatamente uma ação/)
})

test('staging migration invocation binds each mutable action to one immutable release SHA', () => {
  assert.deepEqual(
    parseAtendimentoStagingMigrationInvocation(['--apply', '--release-sha', TEST_RELEASE_SHA]),
    { action: 'apply', releaseSha: TEST_RELEASE_SHA },
  )
  assert.throws(() => parseAtendimentoStagingMigrationInvocation(['--apply']), /--release-sha/)
  assert.throws(() => parseAtendimentoStagingMigrationInvocation(['--apply', '--release-sha', 'not-a-sha']), /--release-sha/)
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

test('a mutable staging migration requires a release SHA before creating a pool', async () => {
  let created = false
  await assert.rejects(
    runAtendimentoStagingMigration({
      databaseUrl: 'postgresql://skincos_staging_migrator_login:synthetic@127.0.0.1:5432/skincos_staging?sslmode=require&uselibpqcompat=true',
      action: 'apply',
      createPool: () => {
        created = true
        throw new Error('must not connect')
      },
    }),
    /ATENDIMENTO_STAGING_MIGRATION_RELEASE_SHA_INVALID/,
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
      if (sql.includes('from unnest($1::text[])')) return { rows: [] }
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
      releaseSha: TEST_RELEASE_SHA,
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
      if (sql.includes('from unnest($1::text[])')) return { rows: [] }
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

test('staging optional commercial deferral is closed to Operations, Analytics and Assisted', () => {
  const rules = ATENDIMENTO_STAGING_OPTIONAL_COMMERCIAL_MIGRATION_RULES
  assert.deepEqual(Object.keys(rules).sort(), [
    '20260807_commercial_analytics_v2',
    '20260807_commercial_assisted_whatsapp_v2',
    '20260807_commercial_operations_v2',
  ])
  assert.equal(rules['20260807_commercial_operations_v2'].prerequisiteError, 'COMMERCIAL_OPERATIONS_PREREQUISITES_MISSING')
  assert.equal(rules['20260807_commercial_analytics_v2'].prerequisiteError, 'COMMERCIAL_ANALYTICS_MIGRATION_PREREQUISITES_MISSING')
  assert.equal(rules['20260807_commercial_assisted_whatsapp_v2'].prerequisiteError, 'COMMERCIAL_ASSISTED_MIGRATION_PREREQUISITES_MISSING')
  assert.equal(rules['20260807_commercial_operations_v2'].prerequisiteRelations.includes('crm_atendimento.commercial_offers'), true)
  assert.equal(rules['20260807_commercial_analytics_v2'].prerequisiteRelations.includes('crm_caixa.sales'), true)
  assert.equal(rules['20260807_commercial_assisted_whatsapp_v2'].prerequisiteRelations.includes('harmonia.contacts'), true)
  assert.equal('20260807_commercial_canary_selector_v2' in rules, false)
})

test('each declared optional commercial prerequisite defers without an applied schema marker and continues foundations', async () => {
  for (const [id, rule] of Object.entries(ATENDIMENTO_STAGING_OPTIONAL_COMMERCIAL_MIGRATION_RULES)) {
    const pool = createMutationPool({ prerequisiteRows: [prerequisiteRow(rule, [rule.prerequisiteRelations.at(-1)])] })
    const calls = []
    const migrations = [
      { id: 'foundation', async apply() { calls.push('foundation'); return { applied: true } }, async rollback() { calls.push('foundation-rollback'); return { rolledBack: true } } },
      { id, async apply() { calls.push(id); return { applied: true } }, async rollback() { calls.push(`${id}-rollback`); return { rolledBack: true } } },
      { id: 'later-foundation', async apply() { calls.push('later-foundation'); return { applied: true } }, async rollback() { calls.push('later-foundation-rollback'); return { rolledBack: true } } },
    ]
    const report = await runAtendimentoStagingMigration({
      databaseUrl: 'postgresql://skincos_staging_migrator_login:synthetic@127.0.0.1:5432/skincos_staging?sslmode=require&uselibpqcompat=true',
      action: 'apply',
      releaseSha: TEST_RELEASE_SHA,
      createRunId: () => 'synthetic-run',
      createEvidenceId: () => '00000000-0000-4000-8000-000000000001',
      migrations,
      createPool: pool.createPool,
      assertDestination: async () => ({ database: 'skincos_staging', user: 'skincos_staging_migrator_login', target: 'staging' }),
    })
    const deferredReport = report.migrations.find((entry) => entry.id === id)?.report
    assert.deepEqual(calls, ['foundation', 'later-foundation'])
    assert.equal(deferredReport.status, 'deferred')
    assert.equal(deferredReport.applied, false)
    assert.equal(deferredReport.deferred, true)
    assert.equal(deferredReport.schemaMigrationRecorded, false)
    assert.equal(deferredReport.reason, rule.prerequisiteError)
    assert.deepEqual(deferredReport.missingPrerequisites, [rule.prerequisiteRelations.at(-1)])
    assert.equal(deferredReport.evidence.persisted, true)
    assert.equal(report.migrationEvidence.deferred.some((entry) => entry.id === id), true)
    assert.equal(pool.queries.some(({ sql }) => /insert into crm_atendimento\.schema_migrations/i.test(sql)), false)
    assert.equal(pool.queries.some(({ sql }) => /insert into crm_atendimento\.staging_migration_evidence/i.test(sql)), true)
    assert.ok(pool.maxActive <= 2, 'the preflight and evidence journal must retain the two-client runner budget')
    assert.equal(pool.ended, true)
  }
})

test('an exact optional prerequisite error only defers after a fresh missing-relation proof', async () => {
  const id = '20260807_commercial_operations_v2'
  const rule = ATENDIMENTO_STAGING_OPTIONAL_COMMERCIAL_MIGRATION_RULES[id]
  const pool = createMutationPool({
    prerequisiteRows: [
      prerequisiteRow(rule),
      prerequisiteRow(rule, ['crm_atendimento.commercial_offers']),
    ],
  })
  let applies = 0
  const report = await runAtendimentoStagingMigration({
    databaseUrl: 'postgresql://skincos_staging_migrator_login:synthetic@127.0.0.1:5432/skincos_staging?sslmode=require&uselibpqcompat=true',
    action: 'apply',
    releaseSha: TEST_RELEASE_SHA,
    createRunId: () => 'synthetic-run',
    createEvidenceId: () => '00000000-0000-4000-8000-000000000002',
    migrations: [{
      id,
      async apply() {
        applies += 1
        const error = new Error(rule.prerequisiteError)
        error.code = rule.prerequisiteError
        throw error
      },
      async rollback() { throw new Error('must not rollback') },
    }],
    createPool: pool.createPool,
    assertDestination: async () => ({ database: 'skincos_staging', user: 'skincos_staging_migrator_login', target: 'staging' }),
  })
  assert.equal(applies, 1)
  assert.equal(report.migrations[0].report.deferred, true)
  assert.deepEqual(report.migrations[0].report.missingPrerequisites, ['crm_atendimento.commercial_offers'])
})

test('a previously deferred optional migration records applied evidence only after its normal migration succeeds', async () => {
  const id = '20260807_commercial_operations_v2'
  const rule = ATENDIMENTO_STAGING_OPTIONAL_COMMERCIAL_MIGRATION_RULES[id]
  const pool = createMutationPool({
    prerequisiteRows: [prerequisiteRow(rule)],
    evidence: {
      event_state: 'deferred',
      missing_prerequisites: ['crm_atendimento.commercial_offers'],
      schema_migration_recorded: false,
      release_sha: TEST_RELEASE_SHA,
      run_id: 'synthetic-deferred-run',
    },
  })
  let applied = false
  await runAtendimentoStagingMigration({
    databaseUrl: 'postgresql://skincos_staging_migrator_login:synthetic@127.0.0.1:5432/skincos_staging?sslmode=require&uselibpqcompat=true',
    action: 'apply',
    releaseSha: TEST_RELEASE_SHA,
    createEvidenceId: () => '00000000-0000-4000-8000-000000000003',
    migrations: [{
      id,
      async apply() { applied = true; return { applied: true, schemaMigrationRecorded: true } },
      async rollback() { throw new Error('must not rollback') },
    }],
    createPool: pool.createPool,
    assertDestination: async () => ({ database: 'skincos_staging', user: 'skincos_staging_migrator_login', target: 'staging' }),
  })
  assert.equal(applied, true)
  const appliedEvidence = pool.queries.find(({ sql, values }) => sql.includes('insert into crm_atendimento.staging_migration_evidence') && values?.includes('applied'))
  assert.ok(appliedEvidence)
  assert.equal(appliedEvidence.values.includes(true), true)
})

test('an optional migration still aborts for a different code or an unproven matching code', async () => {
  const id = '20260807_commercial_operations_v2'
  const rule = ATENDIMENTO_STAGING_OPTIONAL_COMMERCIAL_MIGRATION_RULES[id]
  for (const errorCode of ['UNRELATED_FAILURE', rule.prerequisiteError]) {
    const pool = createMutationPool({ prerequisiteRows: errorCode === rule.prerequisiteError ? [prerequisiteRow(rule), prerequisiteRow(rule)] : [prerequisiteRow(rule)] })
    await assert.rejects(
      runAtendimentoStagingMigration({
        databaseUrl: 'postgresql://skincos_staging_migrator_login:synthetic@127.0.0.1:5432/skincos_staging?sslmode=require&uselibpqcompat=true',
        action: 'apply',
        releaseSha: TEST_RELEASE_SHA,
        migrations: [{
          id,
          async apply() {
            const error = new Error(errorCode)
            error.code = errorCode
            throw error
          },
          async rollback() { throw new Error('must not rollback') },
        }],
        createPool: pool.createPool,
        assertDestination: async () => ({ database: 'skincos_staging', user: 'skincos_staging_migrator_login', target: 'staging' }),
      }),
      new RegExp(errorCode),
    )
  }
})

test('an optional migration with an active schema marker never becomes deferred after a later prerequisite loss', async () => {
  const id = '20260807_commercial_operations_v2'
  const rule = ATENDIMENTO_STAGING_OPTIONAL_COMMERCIAL_MIGRATION_RULES[id]
  const pool = createMutationPool({ registryRows: [{ id, rolled_back_at: null }] })
  let applies = 0
  await assert.rejects(
    runAtendimentoStagingMigration({
      databaseUrl: 'postgresql://skincos_staging_migrator_login:synthetic@127.0.0.1:5432/skincos_staging?sslmode=require&uselibpqcompat=true',
      action: 'apply',
      releaseSha: TEST_RELEASE_SHA,
      migrations: [{
        id,
        async apply() {
          applies += 1
          const error = new Error(rule.prerequisiteError)
          error.code = rule.prerequisiteError
          throw error
        },
        async rollback() { throw new Error('must not rollback') },
      }],
      createPool: pool.createPool,
      assertDestination: async () => ({ database: 'skincos_staging', user: 'skincos_staging_migrator_login', target: 'staging' }),
    }),
    /COMMERCIAL_OPERATIONS_PREREQUISITES_MISSING/,
  )
  assert.equal(applies, 1)
  assert.equal(pool.queries.some(({ sql }) => sql.includes('staging_migration_evidence')), false)
})

test('a non-optional ID, including Canary, never inherits an optional prerequisite defer', async () => {
  for (const [id, errorCode] of [
    ['20260807_commercial_canary_selector_v2', 'COMMERCIAL_CANARY_MIGRATION_PREREQUISITES_MISSING'],
    ['foundation-outside-policy', 'COMMERCIAL_OPERATIONS_PREREQUISITES_MISSING'],
  ]) {
    const pool = createMutationPool()
    await assert.rejects(
      runAtendimentoStagingMigration({
        databaseUrl: 'postgresql://skincos_staging_migrator_login:synthetic@127.0.0.1:5432/skincos_staging?sslmode=require&uselibpqcompat=true',
        action: 'apply',
        releaseSha: TEST_RELEASE_SHA,
        migrations: [{
          id,
          async apply() {
            const error = new Error(errorCode)
            error.code = errorCode
            throw error
          },
          async rollback() { throw new Error('must not rollback') },
        }],
        createPool: pool.createPool,
        assertDestination: async () => ({ database: 'skincos_staging', user: 'skincos_staging_migrator_login', target: 'staging' }),
      }),
      new RegExp(errorCode),
    )
  }
})

test('rollback skips only a durably deferred optional migration and never synthesizes its normal marker', async () => {
  const id = '20260807_commercial_operations_v2'
  const rule = ATENDIMENTO_STAGING_OPTIONAL_COMMERCIAL_MIGRATION_RULES[id]
  const pool = createMutationPool({
    registryRows: [{ id: 'foundation', rolled_back_at: null }],
    evidence: {
      event_state: 'deferred',
      missing_prerequisites: ['crm_atendimento.commercial_offers'],
      schema_migration_recorded: false,
      release_sha: TEST_RELEASE_SHA,
      run_id: 'synthetic-deferred-run',
    },
  })
  const calls = []
  const report = await runAtendimentoStagingMigration({
    databaseUrl: 'postgresql://skincos_staging_migrator_login:synthetic@127.0.0.1:5432/skincos_staging?sslmode=require&uselibpqcompat=true',
    action: 'rollback',
    releaseSha: TEST_RELEASE_SHA,
    migrations: [
      { id: 'foundation', async apply() { throw new Error('must not apply') }, async rollback() { calls.push('foundation'); return { rolledBack: true } } },
      { id, async apply() { throw new Error('must not apply') }, async rollback() { calls.push(id); return { rolledBack: true } } },
    ],
    createPool: pool.createPool,
    assertDestination: async () => ({ database: 'skincos_staging', user: 'skincos_staging_migrator_login', target: 'staging' }),
  })
  const skipped = report.migrations.find((entry) => entry.id === id)?.report
  assert.deepEqual(calls, ['foundation'])
  assert.equal(skipped.status, 'not_applied')
  assert.equal(skipped.deferred, true)
  assert.equal(skipped.schemaMigrationRecorded, false)
  assert.equal(skipped.rollbackSkipped, true)
  assert.equal(skipped.reason, 'STAGING_OPTIONAL_MIGRATION_DEFERRED_NOT_APPLIED')
  assert.deepEqual(skipped.missingPrerequisites, ['crm_atendimento.commercial_offers'])
  assert.equal(pool.queries.some(({ sql }) => /insert into crm_atendimento\.schema_migrations/i.test(sql)), false)
  assert.equal(rule.prerequisiteError, 'COMMERCIAL_OPERATIONS_PREREQUISITES_MISSING')
})

test('rollback fails closed instead of treating an optional migration without durable state as applied', async () => {
  const pool = createMutationPool({ registryRows: [] })
  let rolledBack = false
  await assert.rejects(
    runAtendimentoStagingMigration({
      databaseUrl: 'postgresql://skincos_staging_migrator_login:synthetic@127.0.0.1:5432/skincos_staging?sslmode=require&uselibpqcompat=true',
      action: 'rollback',
      releaseSha: TEST_RELEASE_SHA,
      migrations: [{
        id: '20260807_commercial_operations_v2',
        async apply() { throw new Error('must not apply') },
        async rollback() { rolledBack = true; return { rolledBack: true } },
      }],
      createPool: pool.createPool,
      assertDestination: async () => ({ database: 'skincos_staging', user: 'skincos_staging_migrator_login', target: 'staging' }),
    }),
    /STAGING_OPTIONAL_MIGRATION_ROLLBACK_STATE_UNKNOWN/,
  )
  assert.equal(rolledBack, false)
})


test('staging migration includes every Clientes schema domain in dependency order', () => {
  const ids = ATENDIMENTO_STAGING_MIGRATIONS.map((migration) => migration.id)
  assert.equal(ids[0], '20260808_atendimento_core_schema_v1')
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
