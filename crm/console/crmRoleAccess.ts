export const CONSULTOR_MODULE_KEYS = new Set(['atendimento', 'ponto'])

function normalizedModules(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(String).map((entry) => entry.trim()).filter(Boolean)
    : []
}

/** Navigation policy only; every API remains authorized on the server. */
export function hasCrmModuleAccess(role: unknown, allowedModules: unknown, moduleKey: unknown): boolean {
  const key = String(moduleKey || '').trim()
  const roleKey = String(role || '').trim().toUpperCase()
  if (!key) return false
  if (roleKey === 'GESTOR' || roleKey === 'ADMIN') return true
  if (roleKey === 'CONSULTOR' || roleKey === 'EMPLOYEE') return CONSULTOR_MODULE_KEYS.has(key)
  if (key === 'escala-profissionais') return roleKey === 'GERENTE'

  const allowed = normalizedModules(allowedModules)
  if (!allowed.length) return true // compatibility for existing non-Consultor users
  if (allowed.includes(key)) return true
  if (key === 'procedimentos') return allowed.some((module) => ['procedimentos', 'atendimento'].includes(module))
  if (key === 'faturamento') return allowed.some((module) => ['faturamento', 'atendimento'].includes(module))
  if (key === 'conversa') return allowed.some((module) => ['whatsapp-business', 'harmonia', 'omnichannel'].includes(module))
  if (key === 'ai-automation') return allowed.some((module) => ['ai-automation', 'automation', 'whatsapp-n8n'].includes(module))
  return false
}
