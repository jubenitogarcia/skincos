import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CLIENTES_READONLY_READ_MODEL_INTERFACE_VERSION,
  createClientesReadonlyActorHeaders,
  createClientesReadonlyRuntime,
  validateClientesReadonlyRuntimeConfig,
} from '../src/index.js'

const secret = 'synthetic-only-clientes-readonly-hmac-key-0123456789'

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

function readyEnvironment(overrides = {}) {
  return {
    CLIENTES_READONLY_DEPLOY_ENABLED: 'true',
    CLIENTES_READONLY_ENVIRONMENT: 'staging',
    CLIENTES_READONLY_SYNTHETIC_ONLY: 'true',
    CLIENTES_READONLY_RELEASE_SHA: 'a'.repeat(40),
    CLIENTES_READONLY_READ_MODEL_VERSION: CLIENTES_READONLY_READ_MODEL_INTERFACE_VERSION,
    CLIENTES_READONLY_ACTOR_HMAC_KEY: secret,
    CLIENTES_READONLY_ACTOR_REPLAY: replayStore(),
    CLIENTES_READONLY_READ_MODEL: {
      async readiness() { return { contract: CLIENTES_READONLY_READ_MODEL_INTERFACE_VERSION, ready: true } },
      async listClientesReadonly() {
        return { items: [{ clientId: 'synthetic-client-1', displayName: 'Synthetic Client', unitId: 'novo-hamburgo', status: 'active' }] }
      },
      async getClienteReadonlyById() { return null },
    },
    ...overrides,
  }
}

test('runtime config accepts staging synthetic prerequisites only', () => {
  assert.deepEqual(validateClientesReadonlyRuntimeConfig({}), { ok: false, code: 'CLIENTES_RUNTIME_DISABLED' })
  assert.deepEqual(validateClientesReadonlyRuntimeConfig(readyEnvironment({ CLIENTES_READONLY_ENVIRONMENT: 'production' })), {
    ok: false,
    code: 'CLIENTES_RUNTIME_STAGE_INVALID',
  })
  assert.deepEqual(validateClientesReadonlyRuntimeConfig(readyEnvironment({ CLIENTES_READONLY_SYNTHETIC_ONLY: 'false' })), {
    ok: false,
    code: 'CLIENTES_RUNTIME_SYNTHETIC_ONLY_REQUIRED',
  })
  assert.deepEqual(validateClientesReadonlyRuntimeConfig(readyEnvironment()), { ok: true })
})

test('disabled runtime remains observable and rejects writes without resolving any dependency', async () => {
  const runtime = createClientesReadonlyRuntime({})
  const health = await runtime.fetch(new Request('https://clientes-readonly.test/health'))
  assert.equal(health.status, 200)
  assert.equal((await health.json()).code, 'CLIENTES_RUNTIME_UNAVAILABLE')
  const list = await runtime.fetch(new Request('https://clientes-readonly.test/v1/clientes?unitId=novo-hamburgo'))
  assert.equal(list.status, 503)
  const write = await runtime.fetch(new Request('https://clientes-readonly.test/v1/clientes?unitId=novo-hamburgo', { method: 'POST' }))
  assert.equal(write.status, 405)
  assert.equal(write.headers.get('allow'), 'GET, HEAD')
})

test('configured staging runtime executes a synthetic signed read and redacts adapter-only fields', async () => {
  const env = readyEnvironment({
    CLIENTES_READONLY_READ_MODEL: {
      async readiness() { return { contract: CLIENTES_READONLY_READ_MODEL_INTERFACE_VERSION, ready: true } },
      async listClientesReadonly() {
        return { items: [{
          clientId: 'synthetic-client-1',
          displayName: 'Synthetic Client',
          unitId: 'novo-hamburgo',
          status: 'active',
          email: 'not-visible@example.invalid',
        }] }
      },
      async getClienteReadonlyById() { return null },
    },
  })
  const runtime = createClientesReadonlyRuntime(env)
  const url = 'https://clientes-readonly.test/v1/clientes?unitId=novo-hamburgo'
  const headers = await createClientesReadonlyActorHeaders({
    secret,
    url,
    actor: { subject: 'synthetic-gestor-1', role: 'GESTOR', unitIds: ['novo-hamburgo'] },
    nonce: 'clientes-readonly-runtime-test-0001',
  })
  const response = await runtime.fetch(new Request(url, { headers }))
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).data.items, [{
    clientId: 'synthetic-client-1',
    displayName: 'Synthetic Client',
    unitId: 'novo-hamburgo',
    status: 'active',
    updatedAt: null,
  }])
})
