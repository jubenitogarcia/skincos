import assert from 'node:assert/strict'
import test from 'node:test'
import bcrypt from 'bcryptjs'
import worker, { encodeSessionV2, issueTrackedSessionCookies } from '../src/worker.js'

const SESSION_SECRET = 'inventory-session-security-test-secret'
const PASSWORD = 'inventory-security-password'
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4)

function identityDb({ trackedSession = true, sessionLookupError = false, sessionInsertError = false } = {}) {
  return {
    prepare(sql) {
      return {
        bind() { return this },
        async run() {
          if (sessionInsertError && sql.includes('INSERT INTO crm_identity_sessions')) {
            throw new Error('database details must not escape')
          }
          return { meta: { changes: 1 } }
        },
        async first() {
          if (sql.includes('FROM crm_identity_sessions')) {
            if (sessionLookupError) throw new Error('session table unavailable')
            return trackedSession ? { id: 'tracked-session' } : null
          }
          if (sql.includes('sqlite_master')) return { type: 'table' }
          if (sql.includes('FROM crm_users')) {
            return {
              username: 'existing-user',
              email: 'existing@example.test',
              display_name: 'Existing User',
              password_hash: PASSWORD_HASH,
              role: 'CONSULTOR',
              ativo: 1,
              allowed_units_json: '["NH"]',
              allowed_modules_json: '["inventory"]',
              session_version: 0,
            }
          }
          return null
        },
        async all() {
          if (sql.includes('PRAGMA table_info')) return { results: [{ name: 'allowed_modules_json' }] }
          return { results: [] }
        },
      }
    },
  }
}

function env(overrides = {}) {
  return {
    DB: identityDb(),
    SESSION_SECRET,
    INSUMOS_STORAGE: 'd1',
    APP_ORIGIN: 'https://crm.skincos.com.br',
    ...overrides,
  }
}

test('authentication and password-reset routes fail closed when the rate limiter is absent or errors', async () => {
  for (const path of ['/auth/login', '/auth/password/request']) {
    const missing = await worker.fetch(new Request(`https://inventory.test${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'existing-user', email: 'existing@example.test', password: 'not-used' }),
    }), env())
    assert.equal(missing.status, 503)
    assert.equal((await missing.json()).code, 'RATE_LIMITER_UNAVAILABLE')
  }

  const unavailableLimiter = {
    idFromName() { throw new Error('limiter unavailable') },
  }
  const unavailable = await worker.fetch(new Request('https://inventory.test/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'existing-user', password: 'not-used' }),
  }), env({ RATE_LIMITER: unavailableLimiter }))
  assert.equal(unavailable.status, 503)
  assert.equal((await unavailable.json()).code, 'RATE_LIMITER_UNAVAILABLE')
})

test('new sessions are never emitted when their durable session inventory insert fails', async () => {
  const failingDb = {
    prepare() {
      return {
        bind() { return this },
        async run() { throw new Error('session insert unavailable') },
      }
    },
  }
  await assert.rejects(
    issueTrackedSessionCookies({
      env: { DB: failingDb },
      request: new Request('https://inventory.test/auth/login'),
      sessionPayload: { username: 'existing-user', sv: 0 },
      sessionSecret: SESSION_SECRET,
      secure: true,
    }),
    /SESSION_INVENTORY_UNAVAILABLE/,
  )

  const rateLimiter = {
    idFromName() { return 'auth-client' },
    get() {
      return {
        async fetch() {
          return new Response(JSON.stringify({ allowed: true }), {
            headers: { 'content-type': 'application/json' },
          })
        },
      }
    },
  }
  const response = await worker.fetch(new Request('https://inventory.test/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'existing-user', password: PASSWORD }),
  }), env({
    DB: identityDb({ sessionInsertError: true }),
    RATE_LIMITER: rateLimiter,
  }))
  assert.equal(response.status, 503)
  const payload = await response.json()
  assert.equal(payload.code, 'SESSION_INVENTORY_UNAVAILABLE')
  assert.equal(JSON.stringify(payload).includes('database details'), false)
})

test('sid-bearing sessions fail closed on inventory errors or revocation, while explicit sid-less legacy V2 remains compatible', async () => {
  const expires = Date.now() + 60_000
  const trackedToken = await encodeSessionV2({
    username: 'existing-user',
    sv: 0,
    sid: 'tracked-session',
    csrf: 'csrf',
    exp: expires,
  }, SESSION_SECRET)
  const requestFor = (token) => new Request('https://inventory.test/auth/me', {
    headers: { cookie: `session=${token}; csrfToken=csrf` },
  })

  const unavailable = await worker.fetch(requestFor(trackedToken), env({
    DB: identityDb({ sessionLookupError: true }),
  }))
  assert.equal(unavailable.status, 503)
  assert.equal((await unavailable.json()).code, 'SESSION_INVENTORY_UNAVAILABLE')

  const revoked = await worker.fetch(requestFor(trackedToken), env({
    DB: identityDb({ trackedSession: false }),
  }))
  assert.equal(revoked.status, 401)

  const legacyToken = await encodeSessionV2({
    username: 'existing-user',
    sv: 0,
    csrf: 'csrf',
    exp: expires,
  }, SESSION_SECRET)
  const legacy = await worker.fetch(requestFor(legacyToken), env())
  assert.equal(legacy.status, 200)
  await assert.doesNotReject(async () => {
    const payload = await legacy.json()
    assert.equal(payload.success, true)
    assert.equal(payload.user.username, 'existing-user')
  })
})
