import rolePolicy from './modules/localRolePolicy.json'

// This is a navigation allowlist, not an authorization bypass.  The CRM
// Function and Workforce Worker independently authorize every Ponto request.
export const CONSULTOR_MODULE_KEYS = new Set(rolePolicy.restrictedRoleModules.CONSULTOR)

const ROLE_ALIASES = rolePolicy.roleAliases as Record<string, string>
const RESTRICTED_ROLE_MODULES = rolePolicy.restrictedRoleModules as Record<string, readonly string[]>
const EXCLUSIVE_MODULE_ROLES = rolePolicy.exclusiveModuleRoles as Record<string, readonly string[]>
const IMPLIED_MODULE_GRANTS = rolePolicy.impliedModuleGrants as Record<string, readonly string[]>
const UNRESTRICTED_ROLES = new Set<string>(rolePolicy.unrestrictedRoles)
const ALWAYS_AVAILABLE_MODULES = new Set<string>(rolePolicy.alwaysAvailableModules)

function normalizedRole(value: unknown): string {
  const raw = String(value || '').trim().toUpperCase()
  return ROLE_ALIASES[raw] || raw
}

function normalizedModules(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(String).map((entry) => entry.trim()).filter(Boolean)
    : []
}

/** Navigation policy only; every API remains authorized on the server. */
export function hasCrmModuleAccess(role: unknown, allowedModules: unknown, moduleKey: unknown): boolean {
  const key = String(moduleKey || '').trim()
  const roleKey = normalizedRole(role)
  if (!key) return false
  // Consultants and the legacy EMPLOYEE spelling can operate only Atendimento
  // and their self-service Ponto area. This must be evaluated before the
  // generic self-service Ponto allowance below so assigned module lists never
  // broaden their navigation.
  const restrictedModules = RESTRICTED_ROLE_MODULES[roleKey]
  if (restrictedModules) return restrictedModules.includes(key)
  // Every authenticated CRM user can access the self-service timekeeping area.
  // Data and administrative operations remain authorized by the Ponto proxy and
  // Workforce service; this function only governs sidebar navigation.
  if (ALWAYS_AVAILABLE_MODULES.has(key)) return true
  // Some modules contain privileged commercial or workforce information and
  // therefore remain exclusive even when a legacy grant list is broad.
  const exclusiveRoles = EXCLUSIVE_MODULE_ROLES[key]
  if (exclusiveRoles) return exclusiveRoles.includes(roleKey)
  if (UNRESTRICTED_ROLES.has(roleKey)) return true

  const allowed = normalizedModules(allowedModules)
  if (!allowed.length) return rolePolicy.allowEmptyGrantListForAuthenticatedLegacyRoles
  if (allowed.includes(key)) return true
  const impliedGrants = IMPLIED_MODULE_GRANTS[key]
  if (impliedGrants) return allowed.some((module) => impliedGrants.includes(module))
  return false
}
