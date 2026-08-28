import {
  CLIENTES_READONLY_CONTRACT_VERSION,
  actorCanReadClientesUnit,
  clientesReadonlyRouteFor,
  normalizeClientesReadonlyActor,
  normalizeClientesReadonlyCursor,
  parseClientesReadonlyListQuery,
  projectClientesReadonlyRecord,
} from './contract.js'

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}

function response(request, status, payload, headers = {}) {
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(payload), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  })
}

function error(request, status, code, headers) {
  return response(request, status, {
    ok: false,
    contract: CLIENTES_READONLY_CONTRACT_VERSION,
    code,
  }, headers)
}

function hasReadyReadModel(readModel) {
  return Boolean(readModel?.ready === true
    && typeof readModel.listClients === 'function'
    && typeof readModel.getClientById === 'function')
}

function hasConfiguredActorAdapter(resolveActor) {
  return typeof resolveActor === 'function'
}

function unavailable(request, endpoint, { readModelReady, actorAdapterReady }, code = 'CLIENTES_READMODEL_UNAVAILABLE') {
  return response(request, endpoint === 'health' ? 200 : 503, {
    ok: false,
    unit: 'clientes-readonly',
    contract: CLIENTES_READONLY_CONTRACT_VERSION,
    ready: false,
    code,
    dependencies: {
      readModel: { required: true, state: readModelReady ? 'healthy' : 'unavailable' },
      actorAdapter: { required: true, state: actorAdapterReady ? 'healthy' : 'unavailable' },
    },
  })
}

function ready(request, endpoint) {
  return response(request, 200, {
    ok: true,
    unit: 'clientes-readonly',
    contract: CLIENTES_READONLY_CONTRACT_VERSION,
    ready: true,
    endpoint,
    dependencies: {
      readModel: { required: true, state: 'healthy' },
      actorAdapter: { required: true, state: 'healthy' },
    },
  })
}

function actorFailureStatus(code) {
  if (code === 'CLIENTES_ACTOR_REQUIRED') return 401
  if (code === 'CLIENTES_ACTOR_UNAVAILABLE') return 503
  return 403
}

function projectVisibleRecord(record, actor, requestedUnitId = null) {
  const projected = projectClientesReadonlyRecord(record)
  return projected
    && actorCanReadClientesUnit(actor, projected.unitId)
    && (!requestedUnitId || projected.unitId === requestedUnitId)
    ? projected
    : null
}

function projectDetailRecord(record, actor, requestedClientId) {
  if (record === null) return { state: 'not-found' }
  const projected = projectClientesReadonlyRecord(record)
  if (!projected || projected.clientId !== requestedClientId) return { state: 'unavailable' }
  if (!actorCanReadClientesUnit(actor, projected.unitId)) return { state: 'not-found' }
  return { state: 'visible', record: projected }
}

async function resolvedActor(request, resolveActor) {
  try {
    return normalizeClientesReadonlyActor(await resolveActor(request))
  } catch {
    return { ok: false, code: 'CLIENTES_ACTOR_UNAVAILABLE' }
  }
}

/**
 * Creates the future product's HTTP contract without selecting a data source.
 * A caller must explicitly supply a dedicated read-model and actor adapter;
 * otherwise the handler remains read-only and unavailable.
 */
export function createClientesReadonlyHandler({ readModel = null, resolveActor = null } = {}) {
  return async function handleClientesReadonlyRequest(request) {
    const url = new URL(request.url)
    const resolved = clientesReadonlyRouteFor(url.pathname)
    if (!resolved) return error(request, 404, 'CLIENTES_ROUTE_NOT_FOUND')
    const method = String(request.method || 'GET').toUpperCase()
    if (!resolved.route.methods.includes(method)) {
      return error(request, 405, 'READ_ONLY_RUNTIME', { allow: resolved.route.methods.join(', ') })
    }

    const readModelReady = hasReadyReadModel(readModel)
    const actorAdapterReady = hasConfiguredActorAdapter(resolveActor)
    const unavailableDependencies = { readModelReady, actorAdapterReady }
    const dependencyCode = readModelReady ? 'CLIENTES_ACTOR_UNAVAILABLE' : 'CLIENTES_READMODEL_UNAVAILABLE'
    if (resolved.route.id === 'health' || resolved.route.id === 'readiness') {
      return readModelReady && actorAdapterReady
        ? ready(request, resolved.route.id)
        : unavailable(request, resolved.route.id, unavailableDependencies, dependencyCode)
    }
    if (!readModelReady || !actorAdapterReady) {
      return unavailable(request, 'data', unavailableDependencies, dependencyCode)
    }

    const actorResult = await resolvedActor(request, resolveActor)
    if (!actorResult.ok) return error(request, actorFailureStatus(actorResult.code), actorResult.code)

    if (resolved.route.id === 'list') {
      const queryResult = parseClientesReadonlyListQuery(url.searchParams)
      if (!queryResult.ok) return error(request, 400, queryResult.code)
      if (!actorCanReadClientesUnit(actorResult.actor, queryResult.query.unitId)) {
        return error(request, 403, 'CLIENTES_UNIT_FORBIDDEN')
      }
      try {
        const result = await readModel.listClients({ actor: actorResult.actor, query: queryResult.query })
        if (!result || typeof result !== 'object' || Array.isArray(result) || !Array.isArray(result.items)) {
          return unavailable(request, 'data', { readModelReady: false, actorAdapterReady })
        }
        const nextCursor = normalizeClientesReadonlyCursor(result.nextCursor)
        if (result.nextCursor !== undefined && result.nextCursor !== null
          && (typeof result.nextCursor !== 'string' || !nextCursor)) {
          return unavailable(request, 'data', { readModelReady: false, actorAdapterReady })
        }
        if (result.items.length > queryResult.query.limit) return unavailable(request, 'data', { readModelReady: false, actorAdapterReady })
        const projectedItems = result.items.map(projectClientesReadonlyRecord)
        if (projectedItems.some((item) => !item)) return unavailable(request, 'data', { readModelReady: false, actorAdapterReady })
        const items = projectedItems.filter((item) => actorCanReadClientesUnit(actorResult.actor, item.unitId)
          && item.unitId === queryResult.query.unitId)
        return response(request, 200, {
          ok: true,
          contract: CLIENTES_READONLY_CONTRACT_VERSION,
          data: { items, nextCursor },
        })
      } catch {
        return unavailable(request, 'data', { readModelReady: false, actorAdapterReady })
      }
    }

    try {
      const detail = projectDetailRecord(await readModel.getClientById({
        actor: actorResult.actor,
        clientId: resolved.clientId,
      }), actorResult.actor, resolved.clientId)
      if (detail.state === 'unavailable') return unavailable(request, 'data', { readModelReady: false, actorAdapterReady })
      if (detail.state === 'not-found') return error(request, 404, 'CLIENTES_NOT_FOUND')
      return response(request, 200, {
        ok: true,
        contract: CLIENTES_READONLY_CONTRACT_VERSION,
        data: detail.record,
      })
    } catch {
      return unavailable(request, 'data', { readModelReady: false, actorAdapterReady })
    }
  }
}

export const __testables = {
  hasConfiguredActorAdapter,
  hasReadyReadModel,
  projectDetailRecord,
  projectVisibleRecord,
}
