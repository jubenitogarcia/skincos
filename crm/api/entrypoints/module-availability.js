import fs from 'node:fs/promises'

const allowed = new Set(['active', 'maintenance', 'disabled'])

/**
 * The isolated CRM domain runtime receives its state from a small file owned by
 * its release/control command. This prevents an Atendimento rollback or
 * maintenance window from restarting the shared CRM API process.
 */
export async function readModuleAvailability(moduleId) {
  const file = String(process.env.CRM_MODULE_CONTROL_FILE || '').trim()
  if (!file) return { state: 'active', source: 'default' }
  try {
    const values = JSON.parse(await fs.readFile(file, 'utf8'))
    const state = String(values?.[moduleId]?.state || 'active').toLowerCase()
    return { state: allowed.has(state) ? state : 'maintenance', message: String(values?.[moduleId]?.message || '').slice(0, 240), source: 'file' }
  } catch (error) {
    if (error?.code === 'ENOENT') return { state: 'active', source: 'default' }
    return { state: 'maintenance', message: 'Controle operacional indisponível.', source: 'unavailable' }
  }
}
