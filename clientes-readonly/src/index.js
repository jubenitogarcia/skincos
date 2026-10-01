export {
  CLIENTES_READONLY_ACTOR_FIELDS,
  CLIENTES_READONLY_ACTOR_ROLES,
  CLIENTES_READONLY_CONTRACT_VERSION,
  CLIENTES_READONLY_QUERY_FIELDS,
  CLIENTES_READONLY_RECORD_FIELDS,
  CLIENTES_READONLY_ROUTES,
  CLIENTES_READONLY_STATUS_VALUES,
  actorCanReadClientesUnit,
  clientesReadonlyRouteFor,
  normalizeClientesReadonlyActor,
  normalizeClientesReadonlyCursor,
  parseClientesReadonlyListQuery,
  projectClientesReadonlyRecord,
} from './contract.js'

export { createClientesReadonlyHandler } from './handler.js'
