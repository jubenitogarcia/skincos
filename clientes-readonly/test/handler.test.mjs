import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CLIENTES_READONLY_ACTOR_FIELDS,
  CLIENTES_READONLY_ACTOR_ROLES,
  CLIENTES_READONLY_CONTRACT_VERSION,
  CLIENTES_READONLY_QUERY_FIELDS,
  CLIENTES_READONLY_RECORD_FIELDS,
  CLIENTES_READONLY_ROUTES,
  CLIENTES_READONLY_STATUS_VALUES,
  createClientesReadonlyHandler,
} from '../src/index.js'

async function body(response) {
  return response.json()
}

function request(path, options = {}) {
  return new Request(`https://clientes-readonly.invalid${path}`, options)
}

test('v1 declares a minimal actor, route, query and record allowlist', () => {
  assert.equal(CLIENTES_READONLY_CONTRACT_VERSION, 'clientes-readonly/v1')
  assert.deepEqual(CLIENTES_READONLY_ACTOR_FIELDS, ['subject', 'role', 'unitIds'])
  assert.deepEqual(CLIENTES_READONLY_ACTOR_ROLES, ['GESTOR'])
  assert.deepEqual(CLIENTES_READONLY_RECORD_FIELDS, ['clientId', 'displayName', 'unitId', 'status', 'updatedAt'])
  assert.deepEqual(CLIENTES_READONLY_STATUS_VALUES, ['active', 'inactive', 'archived'])
  assert.deepEqual(CLIENTES_READONLY_QUERY_FIELDS, ['unitId', 'cursor', 'limit'])
  assert.deepEqual(CLIENTES_READONLY_ROUTES.map((route) => route.path), [
    '/health',
    '/readiness',
    '/v1/clientes',
    '/v1/clientes/:clientId',
  ])
  assert.ok(CLIENTES_READONLY_ROUTES.every((route) => route.methods.every((method) => ['GET', 'HEAD'].includes(method))))
})

test('health is observable but data and readiness fail closed without a read-model', async () => {
  const handler = createClientesReadonlyHandler()
  const health = await handler(request('/health'))
  assert.equal(health.status, 200)
  assert.deepEqual(await body(health), {
    ok: false,
    unit: 'clientes-readonly',
    contract: 'clientes-readonly/v1',
    ready: false,
    code: 'CLIENTES_READMODEL_UNAVAILABLE',
    dependencies: { readModel: { required: true, state: 'unavailable' } },
  })

  const readiness = await handler(request('/readiness'))
  assert.equal(readiness.status, 503)
  assert.equal((await body(readiness)).code, 'CLIENTES_READMODEL_UNAVAILABLE')

  const list = await handler(request('/v1/clientes?unitId=novo-hamburgo'))
  assert.equal(list.status, 503)
  assert.equal((await body(list)).code, 'CLIENTES_READMODEL_UNAVAILABLE')
})

test('every unapproved method is rejected before any read-model call', async () => {
  let calls = 0
  const handler = createClientesReadonlyHandler({
    readModel: {
      ready: true,
      async listClients() { calls += 1; return { items: [] } },
      async getClientById() { calls += 1; return null },
    },
  })
  const response = await handler(request('/v1/clientes?unitId=novo-hamburgo', { method: 'POST' }))
  assert.equal(response.status, 405)
  assert.equal(response.headers.get('allow'), 'GET, HEAD')
  assert.equal((await body(response)).code, 'READ_ONLY_RUNTIME')
  assert.equal(calls, 0)
})

test('the handler redacts the incoming actor and projects only visible allowlisted record fields', async () => {
  const observed = []
  const handler = createClientesReadonlyHandler({
    readModel: {
      ready: true,
      async listClients(input) {
        observed.push(input)
        return {
          items: [
            {
              clientId: 'cliente-1',
              displayName: 'Ana Example',
              unitId: 'novo-hamburgo',
              status: 'active',
              updatedAt: '2026-08-28T12:00:00.000Z',
              email: 'must-not-leave-boundary@example.invalid',
              phone: '+5551999999999',
              clinicalNotes: 'must-not-leave-boundary',
            },
            {
              clientId: 'cliente-2',
              displayName: 'Other Unit',
              unitId: 'porto-alegre',
              status: 'active',
            },
            {
              clientId: 'cliente-3',
              displayName: 'Contract Sanitized',
              unitId: 'novo-hamburgo',
              status: 'commercial-private-value',
              updatedAt: 'not-a-timestamp',
              commercialScore: 999,
            },
          ],
          nextCursor: 'cursor-2',
        }
      },
      async getClientById() { return null },
    },
    resolveActor: async () => ({
      subject: 'user-gestor-1',
      role: 'GESTOR',
      unitIds: ['novo-hamburgo'],
      email: 'must-not-reach-read-model@example.invalid',
      displayName: 'Must not reach read model',
    }),
  })
  const response = await handler(request('/v1/clientes?unitId=novo-hamburgo&limit=20'))
  assert.equal(response.status, 200)
  assert.deepEqual(await body(response), {
    ok: true,
    contract: 'clientes-readonly/v1',
    data: {
      items: [{
        clientId: 'cliente-1',
        displayName: 'Ana Example',
        unitId: 'novo-hamburgo',
        status: 'active',
        updatedAt: '2026-08-28T12:00:00.000Z',
      }, {
        clientId: 'cliente-3',
        displayName: 'Contract Sanitized',
        unitId: 'novo-hamburgo',
        status: null,
        updatedAt: null,
      }],
      nextCursor: 'cursor-2',
    },
  })
  assert.deepEqual(observed, [{
    actor: { subject: 'user-gestor-1', role: 'GESTOR', unitIds: ['novo-hamburgo'] },
    query: { unitId: 'novo-hamburgo', cursor: null, limit: 20 },
  }])
})

test('list results stay inside the requested unit even when the actor may read multiple units', async () => {
  const handler = createClientesReadonlyHandler({
    readModel: {
      ready: true,
      async listClients() {
        return {
          items: [
            { clientId: 'cliente-nh', displayName: 'Novo Hamburgo', unitId: 'novo-hamburgo', status: 'active' },
            { clientId: 'cliente-poa', displayName: 'Porto Alegre', unitId: 'porto-alegre', status: 'active' },
          ],
        }
      },
      async getClientById() { return null },
    },
    resolveActor: () => ({
      subject: 'user-gestor-multiu',
      role: 'GESTOR',
      unitIds: ['novo-hamburgo', 'porto-alegre'],
    }),
  })

  const response = await handler(request('/v1/clientes?unitId=novo-hamburgo'))
  assert.equal(response.status, 200)
  assert.deepEqual((await body(response)).data.items.map((item) => item.clientId), ['cliente-nh'])
})

test('malformed list read-model responses fail closed instead of becoming empty results', async () => {
  for (const malformed of [undefined, null, [], {}, { items: null }, { items: 'not-an-array' }, { items: [], nextCursor: {} }]) {
    const handler = createClientesReadonlyHandler({
      readModel: {
        ready: true,
        async listClients() { return malformed },
        async getClientById() { return null },
      },
      resolveActor: () => ({ subject: 'user-gestor-1', role: 'GESTOR', unitIds: ['novo-hamburgo'] }),
    })
    const response = await handler(request('/v1/clientes?unitId=novo-hamburgo'))
    assert.equal(response.status, 503)
    assert.equal((await body(response)).code, 'CLIENTES_READMODEL_UNAVAILABLE')
  }
})

test('actor role, unit scope and query surface are all fail-closed', async () => {
  const readModel = {
    ready: true,
    async listClients() { return { items: [] } },
    async getClientById() { return null },
  }
  const forbiddenRole = createClientesReadonlyHandler({
    readModel,
    resolveActor: () => ({ subject: 'user-1', role: 'CONSULTOR', unitIds: ['novo-hamburgo'] }),
  })
  const roleResponse = await forbiddenRole(request('/v1/clientes?unitId=novo-hamburgo'))
  assert.equal(roleResponse.status, 403)
  assert.equal((await body(roleResponse)).code, 'CLIENTES_ACTOR_FORBIDDEN')

  const missingScope = createClientesReadonlyHandler({
    readModel,
    resolveActor: () => ({ subject: 'user-1', role: 'GESTOR', unitIds: [] }),
  })
  const scopeResponse = await missingScope(request('/v1/clientes?unitId=novo-hamburgo'))
  assert.equal(scopeResponse.status, 403)
  assert.equal((await body(scopeResponse)).code, 'CLIENTES_UNIT_SCOPE_REQUIRED')

  const allowedActor = createClientesReadonlyHandler({
    readModel,
    resolveActor: () => ({ subject: 'user-1', role: 'GESTOR', unitIds: ['novo-hamburgo'] }),
  })
  const extraQuery = await allowedActor(request('/v1/clientes?unitId=novo-hamburgo&include=everything'))
  assert.equal(extraQuery.status, 400)
  assert.equal((await body(extraQuery)).code, 'CLIENTES_QUERY_NOT_ALLOWED')
  const duplicateQuery = await allowedActor(request('/v1/clientes?unitId=novo-hamburgo&unitId=porto-alegre'))
  assert.equal(duplicateQuery.status, 400)
  assert.equal((await body(duplicateQuery)).code, 'CLIENTES_QUERY_AMBIGUOUS')
  const foreignUnit = await allowedActor(request('/v1/clientes?unitId=porto-alegre'))
  assert.equal(foreignUnit.status, 403)
  assert.equal((await body(foreignUnit)).code, 'CLIENTES_UNIT_FORBIDDEN')
  const overlongCursor = await allowedActor(request(`/v1/clientes?unitId=novo-hamburgo&cursor=${'c'.repeat(257)}`))
  assert.equal(overlongCursor.status, 400)
  assert.equal((await body(overlongCursor)).code, 'CLIENTES_CURSOR_INVALID')
  const overlongLimit = await allowedActor(request('/v1/clientes?unitId=novo-hamburgo&limit=1000'))
  assert.equal(overlongLimit.status, 400)
  assert.equal((await body(overlongLimit)).code, 'CLIENTES_LIMIT_INVALID')
})

test('a failing actor adapter is unavailable, while a missing actor stays unauthorized', async () => {
  let readCalls = 0
  const readModel = {
    ready: true,
    async listClients() { readCalls += 1; return { items: [] } },
    async getClientById() { return null },
  }
  const unavailableActor = createClientesReadonlyHandler({
    readModel,
    resolveActor: () => { throw new Error('identity adapter unavailable') },
  })
  const unavailableResponse = await unavailableActor(request('/v1/clientes?unitId=novo-hamburgo'))
  assert.equal(unavailableResponse.status, 503)
  assert.equal((await body(unavailableResponse)).code, 'CLIENTES_ACTOR_UNAVAILABLE')

  const missingActor = createClientesReadonlyHandler({ readModel, resolveActor: () => null })
  const missingResponse = await missingActor(request('/v1/clientes?unitId=novo-hamburgo'))
  assert.equal(missingResponse.status, 401)
  assert.equal((await body(missingResponse)).code, 'CLIENTES_ACTOR_REQUIRED')
  assert.equal(readCalls, 0)
})

test('detail reads cannot reveal a record outside the explicit actor unit scope', async () => {
  const handler = createClientesReadonlyHandler({
    readModel: {
      ready: true,
      async listClients() { return { items: [] } },
      async getClientById() {
        return { clientId: 'cliente-2', displayName: 'Other Unit', unitId: 'porto-alegre', status: 'active' }
      },
    },
    resolveActor: () => ({ subject: 'user-gestor-1', role: 'GESTOR', unitIds: ['novo-hamburgo'] }),
  })
  const response = await handler(request('/v1/clientes/cliente-2'))
  assert.equal(response.status, 404)
  assert.equal((await body(response)).code, 'CLIENTES_NOT_FOUND')
})
