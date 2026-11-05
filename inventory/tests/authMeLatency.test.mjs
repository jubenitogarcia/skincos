import assert from 'node:assert/strict'
import test from 'node:test'
import worker, { encodeSessionV2, touchTrackedSession, SESSION_LAST_SEEN_REFRESH_MS } from '../src/worker.js'
import { SCHEMA_CACHE_TTL_MS, clearIdentitySchemaCache, identityTableHasColumn } from '../../identity/store/d1.js'

const SESSION_SECRET = 'inventory-auth-me-latency-test-secret'

function countingDb({ lastSeenAt = new Date().toISOString(), trackedSession = () => true, pragmaFailures = 0 } = {}) {
  const calls = []
  let remainingPragmaFailures = pragmaFailures
  const db = {
    calls,
    prepare(sql) {
      let bound = []
      return {
        bind(...values) { bound = values; return this },
        async run() {
          calls.push({ kind: 'run', sql, bound })
          return { meta: { changes: 1 } }
        },
        async first() {
          calls.push({ kind: 'first', sql, bound })
          if (sql.includes('FROM crm_identity_sessions')) {
            return trackedSession() ? { id: 'tracked-session', last_seen_at: lastSeenAt } : null
          }
          if (sql.includes('sqlite_master')) return { type: 'table' }
          if (sql.includes('FROM crm_users')) {
            return {
              username: 'existing-user',
              email: 'existing@example.test',
              display_name: 'Existing User',
              password_hash: 'not-used',
              role: 'CONSULTOR',
              photo_url: '',
              ativo: 1,
              allowed_units_json: '["NH"]',
              allowed_modules_json: '["inventory"]',
              session_version: 0,
            }
          }
          return null
        },
        async all() {
          calls.push({ kind: 'all', sql, bound })
          if (sql.includes('PRAGMA table_info')) {
            if (remainingPragmaFailures > 0) {
              remainingPragmaFailures -= 1
              throw new Error('pragma unavailable')
            }
            return { results: [{ name: 'id' }, { name: 'allowed_modules_json' }, { name: 'invitee_email' }] }
          }
          return { results: [] }
        },
      }
    },
  }
  return db
}

async function trackedRequest() {
  const token = await encodeSessionV2({
    username: 'existing-user',
    sv: 0,
    sid: 'tracked-session',
    csrf: 'csrf',
    exp: Date.now() + 60_000,
  }, SESSION_SECRET)
  return new Request('https://inventory.test/auth/me', { headers: { cookie: `session=${token}; csrfToken=csrf` } })
}

function envFor(DB) {
  return { DB, SESSION_SECRET, INSUMOS_STORAGE: 'd1', APP_ORIGIN: 'https://crm.skincos.com.br' }
}

function ctx() {
  const pending = []
  return { pending, waitUntil(promise) { pending.push(promise) }, passThroughOnException() {} }
}

const schemaProbes = (calls) => calls.filter((call) => call.sql.includes('sqlite_master') || call.sql.includes('PRAGMA'))

test('/auth/me keeps its response contract and reuses cached schema probes across requests', async () => {
  const db = countingDb()
  const first = await worker.fetch(await trackedRequest(), envFor(db), ctx())
  assert.equal(first.status, 200)
  const payload = await first.json()
  assert.deepEqual(Object.keys(payload).sort(), ['csrfToken', 'success', 'user'])
  assert.deepEqual(Object.keys(payload.user).sort(), ['allowedModules', 'allowedUnits', 'displayName', 'email', 'name', 'photoUrl', 'role', 'username'])
  assert.equal(payload.user.username, 'existing-user')
  assert.deepEqual(payload.user.allowedModules, ['inventory'])
  assert.equal(payload.csrfToken, 'csrf')

  const firstProbes = schemaProbes(db.calls)
  // 4 table-type probes + at most one PRAGMA per probed table (crm_users, crm_invites, crm_employee_account_links).
  assert.ok(firstProbes.length <= 7, `expected at most 7 schema probes, got ${firstProbes.length}`)

  db.calls.length = 0
  const second = await worker.fetch(await trackedRequest(), envFor(db), ctx())
  assert.equal(second.status, 200)
  assert.deepEqual(await second.json(), payload)
  assert.equal(schemaProbes(db.calls).length, 0)
  const statements = db.calls.map((call) => call.sql)
  assert.equal(statements.filter((sql) => sql.includes('FROM crm_identity_sessions')).length, 1)
  assert.equal(statements.filter((sql) => sql.includes('FROM crm_users')).length, 1)
})

test('revocation is still checked on every request after the schema cache is warm', async () => {
  let tracked = true
  const db = countingDb({ trackedSession: () => tracked })
  assert.equal((await worker.fetch(await trackedRequest(), envFor(db), ctx())).status, 200)
  tracked = false
  const revoked = await worker.fetch(await trackedRequest(), envFor(db), ctx())
  assert.equal(revoked.status, 401)
})

test('last_seen_at is refreshed at most every five minutes and off the response path', async () => {
  const now = Date.parse('2026-11-05T12:00:00.000Z')
  const recent = countingDb({ lastSeenAt: new Date(now - 60_000).toISOString() })
  const recentCtx = ctx()
  assert.equal(await touchTrackedSession(recent, { sid: 's', username: 'u', sessionVersion: 0 }, { waitUntil: recentCtx.waitUntil, now }), true)
  assert.equal(recent.calls.filter((call) => call.kind === 'run').length, 0)
  assert.equal(recentCtx.pending.length, 0)

  const stale = countingDb({ lastSeenAt: new Date(now - SESSION_LAST_SEEN_REFRESH_MS - 1).toISOString() })
  const staleCtx = ctx()
  assert.equal(await touchTrackedSession(stale, { sid: 's', username: 'u', sessionVersion: 0 }, { waitUntil: staleCtx.waitUntil, now }), true)
  assert.equal(staleCtx.pending.length, 1)
  await Promise.all(staleCtx.pending)
  const updates = stale.calls.filter((call) => call.kind === 'run')
  assert.equal(updates.length, 1)
  assert.match(updates[0].sql, /UPDATE crm_identity_sessions SET last_seen_at=\? WHERE id=\? AND \(last_seen_at IS NULL OR last_seen_at < \?\)/)
  assert.deepEqual(updates[0].bound, [new Date(now).toISOString(), 's', new Date(now - SESSION_LAST_SEEN_REFRESH_MS).toISOString()])

  const missing = countingDb({ lastSeenAt: null })
  await touchTrackedSession(missing, { sid: 's', username: 'u', sessionVersion: 0 }, { now })
  assert.equal(missing.calls.filter((call) => call.kind === 'run').length, 1)

  const rejected = countingDb({ trackedSession: () => false })
  assert.equal(await touchTrackedSession(rejected, { sid: 's', username: 'u', sessionVersion: 0 }, { now }), false)
  assert.equal(rejected.calls.filter((call) => call.kind === 'run').length, 0)
})

test('a failed background last_seen_at refresh never fails the request', async () => {
  const db = countingDb({ lastSeenAt: '2000-01-01T00:00:00.000Z' })
  const originalPrepare = db.prepare.bind(db)
  db.prepare = (sql) => {
    const statement = originalPrepare(sql)
    if (sql.startsWith('UPDATE crm_identity_sessions')) statement.run = async () => { throw new Error('write unavailable') }
    return statement
  }
  const executionCtx = ctx()
  const response = await worker.fetch(await trackedRequest(), envFor(db), executionCtx)
  assert.equal(response.status, 200)
  assert.equal(executionCtx.pending.length >= 1, true)
  await assert.doesNotReject(Promise.all(executionCtx.pending))
})

test('schema probe failures are not cached and caches are isolated per D1 binding', async () => {
  const flaky = countingDb({ pragmaFailures: 1 })
  const env = { DB: flaky }
  assert.equal(await identityTableHasColumn(env, 'crm_users', 'allowed_modules_json'), false)
  assert.equal(await identityTableHasColumn(env, 'crm_users', 'allowed_modules_json'), true)
  assert.equal(await identityTableHasColumn(env, 'crm_users', 'allowed_modules_json'), true)
  assert.equal(flaky.calls.filter((call) => call.sql.includes('PRAGMA')).length, 2)
  assert.equal(await identityTableHasColumn(env, 'not_allowed', 'id'), false)

  const other = countingDb()
  assert.equal(await identityTableHasColumn({ DB: other }, 'crm_users', 'allowed_modules_json'), true)
  assert.equal(other.calls.filter((call) => call.sql.includes('PRAGMA')).length, 1)

  clearIdentitySchemaCache(env)
  await identityTableHasColumn(env, 'crm_users', 'allowed_modules_json')
  assert.equal(flaky.calls.filter((call) => call.sql.includes('PRAGMA')).length, 3)
  assert.equal(SCHEMA_CACHE_TTL_MS, 5 * 60 * 1000)
})
