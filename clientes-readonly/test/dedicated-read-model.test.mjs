import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CLIENTES_READONLY_READ_MODEL_INTERFACE_VERSION,
  createDedicatedClientesReadonlyReadModel,
} from '../src/index.js'

test('the dedicated read-model adapter requires the complete read-only interface', () => {
  assert.equal(createDedicatedClientesReadonlyReadModel(null), null)
  assert.equal(createDedicatedClientesReadonlyReadModel({
    async readiness() { return { ready: true } },
    async listClientesReadonly() { return { items: [] } },
  }), null)
})

test('the adapter forwards only the contracted actor and query to its dedicated binding', async () => {
  const observed = []
  const readModel = createDedicatedClientesReadonlyReadModel({
    async readiness(input) {
      observed.push(['readiness', input])
      return { contract: CLIENTES_READONLY_READ_MODEL_INTERFACE_VERSION, ready: true }
    },
    async listClientesReadonly(input) {
      observed.push(['list', input])
      return { items: [] }
    },
    async getClienteReadonlyById(input) {
      observed.push(['detail', input])
      return null
    },
  })
  const actor = { subject: 'synthetic-gestor-1', role: 'GESTOR', unitIds: ['novo-hamburgo'], email: 'not-forwarded@example.invalid' }
  assert.equal(await readModel.isReady(), true)
  await readModel.listClients({ actor, query: { unitId: 'novo-hamburgo', cursor: null, limit: 25 } })
  await readModel.getClientById({ actor, clientId: 'synthetic-client-1' })
  assert.deepEqual(observed, [
    ['readiness', { contract: CLIENTES_READONLY_READ_MODEL_INTERFACE_VERSION, mode: 'read-only' }],
    ['list', {
      contract: CLIENTES_READONLY_READ_MODEL_INTERFACE_VERSION,
      actor: { subject: 'synthetic-gestor-1', role: 'GESTOR', unitIds: ['novo-hamburgo'] },
      query: { unitId: 'novo-hamburgo', cursor: null, limit: 25 },
    }],
    ['detail', {
      contract: CLIENTES_READONLY_READ_MODEL_INTERFACE_VERSION,
      actor: { subject: 'synthetic-gestor-1', role: 'GESTOR', unitIds: ['novo-hamburgo'] },
      clientId: 'synthetic-client-1',
    }],
  ])
})

test('an unhealthy dedicated binding makes the handler readiness fail closed', async () => {
  const readModel = createDedicatedClientesReadonlyReadModel({
    async readiness() { return { contract: CLIENTES_READONLY_READ_MODEL_INTERFACE_VERSION, ready: false } },
    async listClientesReadonly() { return { items: [] } },
    async getClienteReadonlyById() { return null },
  })
  assert.equal(await readModel.isReady(), false)
})
