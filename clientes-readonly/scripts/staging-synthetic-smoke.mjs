import assert from 'node:assert/strict'

import {
  CLIENTES_READONLY_READ_MODEL_INTERFACE_VERSION,
  createClientesReadonlyActorHeaders,
  createClientesReadonlyRuntime,
} from '../src/index.js'

const syntheticSecret = 'synthetic-only-clientes-readonly-hmac-key-0123456789'
const releaseSha = 'a'.repeat(40)

function createReplayStore() {
  const seen = new Set()
  return {
    async isReady() { return true },
    async claimNonce({ key }) {
      if (seen.has(key)) return { accepted: false, code: 'CLIENTES_ACTOR_REPLAYED' }
      seen.add(key)
      return { accepted: true }
    },
  }
}

const env = {
  CLIENTES_READONLY_DEPLOY_ENABLED: 'true',
  CLIENTES_READONLY_ENVIRONMENT: 'staging',
  CLIENTES_READONLY_SYNTHETIC_ONLY: 'true',
  CLIENTES_READONLY_RELEASE_SHA: releaseSha,
  CLIENTES_READONLY_READ_MODEL_VERSION: CLIENTES_READONLY_READ_MODEL_INTERFACE_VERSION,
  CLIENTES_READONLY_ACTOR_HMAC_KEY: syntheticSecret,
  CLIENTES_READONLY_ACTOR_REPLAY: createReplayStore(),
  CLIENTES_READONLY_READ_MODEL: {
    async readiness() {
      return { contract: CLIENTES_READONLY_READ_MODEL_INTERFACE_VERSION, ready: true }
    },
    async listClientesReadonly({ actor, query }) {
      assert.deepEqual(actor, { subject: 'synthetic-gestor-1', role: 'GESTOR', unitIds: ['novo-hamburgo'] })
      assert.deepEqual(query, { unitId: 'novo-hamburgo', cursor: null, limit: 25 })
      return {
        items: [{
          clientId: 'synthetic-client-1',
          displayName: 'Synthetic Client',
          unitId: 'novo-hamburgo',
          status: 'active',
          updatedAt: '2026-08-31T12:00:00.000Z',
          email: 'must-not-leave-synthetic-boundary@example.invalid',
        }],
      }
    },
    async getClienteReadonlyById() {
      return null
    },
  },
}

const runtime = createClientesReadonlyRuntime(env)
const health = await runtime.fetch(new Request('https://clientes-readonly.synthetic/health'))
assert.equal(health.status, 200)
assert.equal((await health.json()).ready, true)

const readiness = await runtime.fetch(new Request('https://clientes-readonly.synthetic/readiness'))
assert.equal(readiness.status, 200)

const url = 'https://clientes-readonly.synthetic/v1/clientes?unitId=novo-hamburgo'
const headers = await createClientesReadonlyActorHeaders({
  secret: syntheticSecret,
  url,
  actor: { subject: 'synthetic-gestor-1', role: 'GESTOR', unitIds: ['novo-hamburgo'] },
  nonce: 'clientes-readonly-synthetic-smoke-0001',
  issuedAt: Date.now(),
})
const list = await runtime.fetch(new Request(url, { headers }))
assert.equal(list.status, 200)
const listPayload = await list.json()
assert.deepEqual(listPayload.data.items, [{
  clientId: 'synthetic-client-1',
  displayName: 'Synthetic Client',
  unitId: 'novo-hamburgo',
  status: 'active',
  updatedAt: '2026-08-31T12:00:00.000Z',
}])

const replay = await runtime.fetch(new Request(url, { headers }))
assert.equal(replay.status, 403)
assert.equal((await replay.json()).code, 'CLIENTES_ACTOR_REPLAYED')

const write = await runtime.fetch(new Request(url, { method: 'POST' }))
assert.equal(write.status, 405)
assert.equal(write.headers.get('allow'), 'GET, HEAD')

console.log(JSON.stringify({
  ok: true,
  mode: 'synthetic-only',
  health: health.status,
  readiness: readiness.status,
  list: list.status,
  replay: replay.status,
  write: write.status,
}))
