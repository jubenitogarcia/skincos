import { normalizeClientesReadonlyActor } from './contract.js'

export const CLIENTES_READONLY_READ_MODEL_INTERFACE_VERSION = 'clientes-readonly/read-model/v1'
export const CLIENTES_READONLY_SYNTHETIC_READ_MODEL_MODE = 'synthetic-only'

function configuredReadModelBinding(binding) {
  return Boolean(binding
    && typeof binding.readiness === 'function'
    && typeof binding.listClientesReadonly === 'function'
    && typeof binding.getClienteReadonlyById === 'function')
}

function readonlyInput(value) {
  const actorResult = normalizeClientesReadonlyActor(value?.actor)
  if (!actorResult.ok) throw new TypeError('A scoped readonly actor is required')
  return Object.freeze({
    contract: CLIENTES_READONLY_READ_MODEL_INTERFACE_VERSION,
    actor: actorResult.actor,
    query: value?.query || null,
    clientId: value?.clientId || null,
  })
}

/**
 * The future read-model is a separately owned RPC/service binding. This
 * adapter deliberately has no database, HTTP fallback, CRM import, or mutable
 * method. The product handler remains unavailable until the binding is wired.
 */
export function createDedicatedClientesReadonlyReadModel(binding) {
  if (!configuredReadModelBinding(binding)) return null
  return Object.freeze({
    ready: true,
    async isReady() {
      const result = await binding.readiness({
        contract: CLIENTES_READONLY_READ_MODEL_INTERFACE_VERSION,
        mode: CLIENTES_READONLY_SYNTHETIC_READ_MODEL_MODE,
        syntheticOnly: true,
      })
      return result?.ready === true
        && result?.contract === CLIENTES_READONLY_READ_MODEL_INTERFACE_VERSION
        && result?.mode === CLIENTES_READONLY_SYNTHETIC_READ_MODEL_MODE
        && result?.syntheticOnly === true
    },
    async listClients(value) {
      const input = readonlyInput(value)
      return binding.listClientesReadonly({
        contract: input.contract,
        mode: CLIENTES_READONLY_SYNTHETIC_READ_MODEL_MODE,
        syntheticOnly: true,
        actor: input.actor,
        query: input.query,
      })
    },
    async getClientById(value) {
      const input = readonlyInput(value)
      return binding.getClienteReadonlyById({
        contract: input.contract,
        mode: CLIENTES_READONLY_SYNTHETIC_READ_MODEL_MODE,
        syntheticOnly: true,
        actor: input.actor,
        clientId: input.clientId,
      })
    },
  })
}

export const __testables = {
  configuredReadModelBinding,
  readonlyInput,
}
