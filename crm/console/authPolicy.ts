/** Shared client/Pages policy for role aliases and effective module grants. */
export function normalizeCrmRole(value: unknown): string {
  const raw = String(value || '').trim().toUpperCase()
  if (raw === 'ADMIN') return 'GESTOR'
  if (raw === 'OPERADOR') return 'INJETOR'
  if (raw === 'RH' || raw === 'AUDITOR') return 'SUPERVISOR'
  if (raw === 'EMPLOYEE') return 'CONSULTOR'
  return raw
}

export function effectiveAllowedModules(role: unknown, allowedModules: unknown): string[] {
  if (normalizeCrmRole(role) === 'CONSULTOR') return ['atendimento']
  if (!Array.isArray(allowedModules)) return []
  return Array.from(new Set(allowedModules.map(String).map((item) => item.trim()).filter(Boolean)))
}

export function isAtendimentoManager(role: unknown): boolean {
  const normalized = normalizeCrmRole(role)
  return normalized === 'GESTOR' || normalized === 'GERENTE'
}
