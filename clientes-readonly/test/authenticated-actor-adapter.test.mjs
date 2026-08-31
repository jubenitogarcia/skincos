import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CLIENTES_READONLY_ACTOR_CONTEXT_HEADER,
  CLIENTES_READONLY_ACTOR_CONTEXT_MAX_CHARS,
  CLIENTES_READONLY_ACTOR_MAX_AGE_MS,
  CLIENTES_READONLY_ACTOR_MAX_FUTURE_SKEW_MS,
  CLIENTES_READONLY_ACTOR_MIN_SECRET_BYTES,
  CLIENTES_READONLY_ACTOR_MAX_UNIT_IDS,
  CLIENTES_READONLY_ACTOR_SIGNATURE_HEADER,
  CLIENTES_READONLY_ACTOR_VERSION_HEADER,
  createClientesReadonlyActorHeaders,
  createClientesReadonlyAuthenticatedActorAdapter,
  normalizeClientesReadonlyActor,
} from '../src/index.js'

const secret = 'synthetic-only-clientes-readonly-hmac-key-0123456789'
const timestamp = 1_788_163_200_000

function replayStore() {
  const keys = new Set()
  return {
    async isReady() { return true },
    async claimNonce({ key }) {
      if (keys.has(key)) return { accepted: false, code: 'CLIENTES_ACTOR_REPLAYED' }
      keys.add(key)
      return { accepted: true }
    },
  }
}

test('authenticated actor adapter accepts only a fresh signed envelope bound to the request', async () => {
  const url = 'https://clientes-readonly.test/v1/clientes?unitId=novo-hamburgo'
  const headers = await createClientesReadonlyActorHeaders({
    secret,
    url,
    actor: { subject: 'synthetic-gestor-1', role: 'GESTOR', unitIds: ['novo-hamburgo'] },
    issuedAt: timestamp,
    nonce: 'clientes-readonly-actor-adapter-0001',
  })
  const adapter = createClientesReadonlyAuthenticatedActorAdapter({ secret, replayStore: replayStore(), now: () => timestamp })
  const result = await adapter(new Request(url, { headers }))
  assert.deepEqual(result, { subject: 'synthetic-gestor-1', role: 'GESTOR', unitIds: ['novo-hamburgo'] })
  assert.equal(await adapter.isReady(), true)
})

test('actor adapter rejects replay, route mutation and forged browser identity headers', async () => {
  const url = 'https://clientes-readonly.test/v1/clientes?unitId=novo-hamburgo'
  const headers = await createClientesReadonlyActorHeaders({
    secret,
    url,
    actor: { subject: 'synthetic-gestor-1', role: 'GESTOR', unitIds: ['novo-hamburgo'] },
    issuedAt: timestamp,
    nonce: 'clientes-readonly-actor-adapter-0002',
  })
  const adapter = createClientesReadonlyAuthenticatedActorAdapter({ secret, replayStore: replayStore(), now: () => timestamp })
  const accepted = await adapter(new Request(url, { headers }))
  assert.equal(accepted.subject, 'synthetic-gestor-1')
  assert.deepEqual(await adapter(new Request(url, { headers })), { ok: false, code: 'CLIENTES_ACTOR_REPLAYED' })
  assert.deepEqual(await adapter(new Request('https://clientes-readonly.test/v1/clientes?unitId=porto-alegre', { headers })), {
    ok: false,
    code: 'CLIENTES_ACTOR_FORBIDDEN',
  })
  assert.equal(await adapter(new Request(url, { headers: { 'x-crm-user': 'forged-gestor' } })), null)
})

test('actor adapter claims an audience nonce once across otherwise distinct valid envelopes', async () => {
  const firstUrl = 'https://clientes-readonly.test/v1/clientes?unitId=novo-hamburgo'
  const secondUrl = 'https://clientes-readonly.test/v1/clientes?unitId=porto-alegre'
  const nonce = 'clientes-readonly-shared-nonce-0001'
  const firstHeaders = await createClientesReadonlyActorHeaders({
    secret,
    url: firstUrl,
    actor: { subject: 'synthetic-gestor-1', role: 'GESTOR', unitIds: ['novo-hamburgo', 'porto-alegre'] },
    issuedAt: timestamp,
    nonce,
  })
  const secondHeaders = await createClientesReadonlyActorHeaders({
    secret,
    url: secondUrl,
    actor: { subject: 'synthetic-gestor-1', role: 'GESTOR', unitIds: ['novo-hamburgo', 'porto-alegre'] },
    issuedAt: timestamp,
    nonce,
  })
  const adapter = createClientesReadonlyAuthenticatedActorAdapter({ secret, replayStore: replayStore(), now: () => timestamp })
  assert.equal((await adapter(new Request(firstUrl, { headers: firstHeaders }))).subject, 'synthetic-gestor-1')
  assert.deepEqual(await adapter(new Request(secondUrl, { headers: secondHeaders })), {
    ok: false,
    code: 'CLIENTES_ACTOR_REPLAYED',
  })
})

test('actor adapter enforces secret length, bounded future skew and absolute nonce expiry', async () => {
  assert.ok(CLIENTES_READONLY_ACTOR_MIN_SECRET_BYTES >= 32)
  const weakAdapter = createClientesReadonlyAuthenticatedActorAdapter({
    secret: 'short-secret',
    replayStore: replayStore(),
    now: () => timestamp,
  })
  assert.equal(await weakAdapter.isReady(), false)

  const futureUrl = 'https://clientes-readonly.test/v1/clientes?unitId=novo-hamburgo'
  const tooFutureHeaders = await createClientesReadonlyActorHeaders({
    secret,
    url: futureUrl,
    actor: { subject: 'synthetic-gestor-1', role: 'GESTOR', unitIds: ['novo-hamburgo'] },
    issuedAt: timestamp + CLIENTES_READONLY_ACTOR_MAX_FUTURE_SKEW_MS + 1,
    nonce: 'clientes-readonly-future-envelope-0001',
  })
  const rejectedAdapter = createClientesReadonlyAuthenticatedActorAdapter({ secret, replayStore: replayStore(), now: () => timestamp })
  assert.deepEqual(await rejectedAdapter(new Request(futureUrl, { headers: tooFutureHeaders })), {
    ok: false,
    code: 'CLIENTES_ACTOR_FORBIDDEN',
  })

  let observedAt = timestamp
  const claims = new Map()
  const boundedReplayStore = {
    async isReady() { return true },
    async claimNonce({ key, expiresAtMs }) {
      if (claims.get(key) > observedAt) return { accepted: false, code: 'CLIENTES_ACTOR_REPLAYED' }
      claims.set(key, expiresAtMs)
      return { accepted: true }
    },
  }
  const permittedHeaders = await createClientesReadonlyActorHeaders({
    secret,
    url: futureUrl,
    actor: { subject: 'synthetic-gestor-1', role: 'GESTOR', unitIds: ['novo-hamburgo'] },
    issuedAt: timestamp + CLIENTES_READONLY_ACTOR_MAX_FUTURE_SKEW_MS,
    nonce: 'clientes-readonly-future-envelope-0002',
  })
  const permittedAdapter = createClientesReadonlyAuthenticatedActorAdapter({
    secret,
    replayStore: boundedReplayStore,
    now: () => observedAt,
  })
  assert.equal((await permittedAdapter(new Request(futureUrl, { headers: permittedHeaders }))).subject, 'synthetic-gestor-1')
  assert.equal(
    [...claims.values()][0],
    timestamp + CLIENTES_READONLY_ACTOR_MAX_FUTURE_SKEW_MS + CLIENTES_READONLY_ACTOR_MAX_AGE_MS,
  )

  // The envelope remains fresh for the issuer's remaining skew window, so the
  // nonce must still be claimed after the observer's original age window.
  observedAt = timestamp + CLIENTES_READONLY_ACTOR_MAX_AGE_MS + 1
  assert.deepEqual(await permittedAdapter(new Request(futureUrl, { headers: permittedHeaders })), {
    ok: false,
    code: 'CLIENTES_ACTOR_REPLAYED',
  })
})

test('actor adapter fails closed when signature or replay custody is absent', async () => {
  const url = 'https://clientes-readonly.test/v1/clientes?unitId=novo-hamburgo'
  const adapter = createClientesReadonlyAuthenticatedActorAdapter({ secret, replayStore: null, now: () => timestamp })
  assert.equal(await adapter.isReady(), false)
  assert.deepEqual(await adapter(new Request(url)), { ok: false, code: 'CLIENTES_ACTOR_UNAVAILABLE' })

  const headers = await createClientesReadonlyActorHeaders({
    secret,
    url,
    actor: { subject: 'synthetic-gestor-1', role: 'GESTOR', unitIds: ['novo-hamburgo'] },
    issuedAt: timestamp,
    nonce: 'clientes-readonly-actor-adapter-0003',
  })
  headers[CLIENTES_READONLY_ACTOR_SIGNATURE_HEADER] = 'forged'
  const readyAdapter = createClientesReadonlyAuthenticatedActorAdapter({ secret, replayStore: replayStore(), now: () => timestamp })
  assert.deepEqual(await readyAdapter(new Request(url, { headers })), { ok: false, code: 'CLIENTES_ACTOR_FORBIDDEN' })
  assert.ok(headers[CLIENTES_READONLY_ACTOR_CONTEXT_HEADER])
  assert.equal(headers[CLIENTES_READONLY_ACTOR_VERSION_HEADER], 'v1')
})

test('actor adapter caps unit scopes and never signs an envelope beyond its verifier boundary', async () => {
  const permittedUnits = Array.from({ length: CLIENTES_READONLY_ACTOR_MAX_UNIT_IDS }, (_, index) => `unit-${index + 1}`)
  const withinLimit = { subject: 'synthetic-gestor-1', role: 'GESTOR', unitIds: permittedUnits }
  const normalized = normalizeClientesReadonlyActor(withinLimit)
  assert.equal(normalized.ok, true)

  const url = 'https://clientes-readonly.test/v1/clientes?unitId=unit-1'
  const headers = await createClientesReadonlyActorHeaders({
    secret,
    url,
    actor: withinLimit,
    issuedAt: timestamp,
    nonce: 'clientes-readonly-maximum-unit-scope-0001',
  })
  assert.ok(headers[CLIENTES_READONLY_ACTOR_CONTEXT_HEADER].length <= CLIENTES_READONLY_ACTOR_CONTEXT_MAX_CHARS)
  const adapter = createClientesReadonlyAuthenticatedActorAdapter({ secret, replayStore: replayStore(), now: () => timestamp })
  assert.equal((await adapter(new Request(url, { headers }))).unitIds.length, CLIENTES_READONLY_ACTOR_MAX_UNIT_IDS)

  const tooManyUnits = {
    subject: 'synthetic-gestor-1',
    role: 'GESTOR',
    unitIds: Array.from({ length: CLIENTES_READONLY_ACTOR_MAX_UNIT_IDS + 1 }, (_, index) => `unit-${index + 1}`),
  }
  assert.deepEqual(normalizeClientesReadonlyActor(tooManyUnits), {
    ok: false,
    code: 'CLIENTES_UNIT_SCOPE_LIMIT_EXCEEDED',
  })
  await assert.rejects(
    createClientesReadonlyActorHeaders({
      secret,
      url,
      actor: tooManyUnits,
      issuedAt: timestamp,
      nonce: 'clientes-readonly-over-limit-unit-scope-0001',
    }),
    /valid readonly actor/i,
  )

  await assert.rejects(
    createClientesReadonlyActorHeaders({
      secret,
      url: `https://clientes-readonly.test/${'x'.repeat(CLIENTES_READONLY_ACTOR_CONTEXT_MAX_CHARS)}`,
      actor: withinLimit,
      issuedAt: timestamp,
      nonce: 'clientes-readonly-oversized-envelope-0001',
    }),
    /supported context limit/i,
  )
})
