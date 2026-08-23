import rolePolicy from './modules/localRolePolicy.json'

const ROLE_ALIASES = rolePolicy.roleAliases as Record<string, string>
const FIXED_MODULE_GRANTS = rolePolicy.fixedModuleGrants as Record<string, readonly string[]>

/** Shared client/Pages policy for role aliases and effective module grants. */
export function normalizeCrmRole(value: unknown): string {
  const raw = String(value || '').trim().toUpperCase()
  return ROLE_ALIASES[raw] || raw
}

export function effectiveAllowedModules(role: unknown, allowedModules: unknown): string[] {
  const fixed = FIXED_MODULE_GRANTS[normalizeCrmRole(role)]
  if (fixed) return [...fixed]
  if (!Array.isArray(allowedModules)) return []
  return Array.from(new Set(allowedModules.map(String).map((item) => item.trim()).filter(Boolean)))
}

export function isAtendimentoManager(role: unknown): boolean {
  const normalized = normalizeCrmRole(role)
  return normalized === 'GESTOR' || normalized === 'GERENTE'
}
