import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CLIENTES_READONLY_ACTOR_CONTEXT_HEADER,
  CLIENTES_READONLY_ACTOR_MAX_AGE_MS,
  CLIENTES_READONLY_ACTOR_MAX_FUTURE_SKEW_MS,
  CLIENTES_READONLY_ACTOR_MIN_SECRET_BYTES,
  CLIENTES_READONLY_ACTOR_SIGNATURE_HEADER,
  CLIENTES_READONLY_ACTOR_VERSION_HEADER,
  createClientesReadonlyActorHeaders,
  createClientesReadonlyAuthenticatedActorAdapter,
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

test('actor adapter enforces secret length and bounds future skew independently from maximum age', async () => {
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

  const claims = []
  const boundedReplayStore = {
    async isReady() { return true },
    async claimNonce(claim) {
      claims.push(claim)
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
    now: () => timestamp,
  })
  assert.equal((await permittedAdapter(new Request(futureUrl, { headers: permittedHeaders }))).subject, 'synthetic-gestor-1')
  assert.equal(claims[0].expiresAtMs, timestamp + CLIENTES_READONLY_ACTOR_MAX_AGE_MS)
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
