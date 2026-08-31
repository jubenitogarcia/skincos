import {
  CLIENTES_READONLY_CONTRACT_VERSION,
  clientesReadonlyRouteFor,
} from './contract.js'
import { createClientesReadonlyAuthenticatedActorAdapter } from './authenticated-actor-adapter.js'
import { createDedicatedClientesReadonlyReadModel, CLIENTES_READONLY_READ_MODEL_INTERFACE_VERSION } from './dedicated-read-model.js'
import { createClientesReadonlyHandler } from './handler.js'

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}
const SHA_PATTERN = /^[0-9a-f]{40}$/

function value(env, key) {
  return typeof env?.[key] === 'string' ? env[key].trim() : ''
}

function response(request, status, payload, headers = {}) {
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(payload), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  })
}

function runtimeUnavailableHandler() {
  return async (request) => {
    const routeMatch = clientesReadonlyRouteFor(new URL(request.url).pathname)
    if (!routeMatch) {
      return response(request, 404, {
        ok: false,
        contract: CLIENTES_READONLY_CONTRACT_VERSION,
        code: 'CLIENTES_ROUTE_NOT_FOUND',
      })
    }
    const method = String(request.method || 'GET').toUpperCase()
    if (!routeMatch.route.methods.includes(method)) {
      return response(request, 405, {
        ok: false,
        contract: CLIENTES_READONLY_CONTRACT_VERSION,
        code: 'READ_ONLY_RUNTIME',
      }, { allow: routeMatch.route.methods.join(', ') })
    }
    return response(request, routeMatch.route.id === 'health' ? 200 : 503, {
      ok: false,
      unit: 'clientes-readonly',
      contract: CLIENTES_READONLY_CONTRACT_VERSION,
      ready: false,
      code: 'CLIENTES_RUNTIME_UNAVAILABLE',
      dependencies: {
        runtime: { required: true, state: 'unavailable' },
        readModel: { required: true, state: 'unavailable' },
        actorAdapter: { required: true, state: 'unavailable' },
      },
    })
  }
}

/**
 * Validation is intentionally narrow: this source may execute only as a
 * synthetic, staging-only runtime. No production environment or fallback
 * source is accepted here.
 */
export function validateClientesReadonlyRuntimeConfig(env) {
  if (value(env, 'CLIENTES_READONLY_DEPLOY_ENABLED') !== 'true') {
    return { ok: false, code: 'CLIENTES_RUNTIME_DISABLED' }
  }
  if (value(env, 'CLIENTES_READONLY_ENVIRONMENT') !== 'staging') {
    return { ok: false, code: 'CLIENTES_RUNTIME_STAGE_INVALID' }
  }
  if (value(env, 'CLIENTES_READONLY_SYNTHETIC_ONLY') !== 'true') {
    return { ok: false, code: 'CLIENTES_RUNTIME_SYNTHETIC_ONLY_REQUIRED' }
  }
  if (!SHA_PATTERN.test(value(env, 'CLIENTES_READONLY_RELEASE_SHA'))) {
    return { ok: false, code: 'CLIENTES_RUNTIME_RELEASE_REQUIRED' }
  }
  if (value(env, 'CLIENTES_READONLY_READ_MODEL_VERSION') !== CLIENTES_READONLY_READ_MODEL_INTERFACE_VERSION) {
    return { ok: false, code: 'CLIENTES_RUNTIME_READ_MODEL_CONTRACT_REQUIRED' }
  }
  return { ok: true }
}

export function createClientesReadonlyRuntime(env = {}) {
  if (!validateClientesReadonlyRuntimeConfig(env).ok) {
    return Object.freeze({ fetch: runtimeUnavailableHandler() })
  }
  const resolveActor = createClientesReadonlyAuthenticatedActorAdapter({
    secret: env.CLIENTES_READONLY_ACTOR_HMAC_KEY,
    replayStore: env.CLIENTES_READONLY_ACTOR_REPLAY,
  })
  const readModel = createDedicatedClientesReadonlyReadModel(env.CLIENTES_READONLY_READ_MODEL)
  return Object.freeze({ fetch: createClientesReadonlyHandler({ readModel, resolveActor }) })
}

export const __testables = {
  runtimeUnavailableHandler,
  value,
}
