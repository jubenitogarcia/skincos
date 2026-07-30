import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_POLICY_FILE = fileURLToPath(
  new URL('../../console/modules/localRolePolicy.json', import.meta.url),
)

function stringArray(value, code) {
  if (!Array.isArray(value)) throw new Error(code)
  const normalized = value.map((entry) => String(entry || '').trim())
  if (normalized.some((entry) => !entry) || new Set(normalized).size !== normalized.length) {
    throw new Error(code)
  }
  return normalized
}

export function validateCrmRolePolicy(value) {
  if (!value || value.schemaVersion !== 1 || !Number.isSafeInteger(value.policyVersion) ||
      !value.roleAliases || typeof value.roleAliases !== 'object' ||
      !value.restrictedRoleModules || typeof value.restrictedRoleModules !== 'object' ||
      !value.fixedModuleGrants || typeof value.fixedModuleGrants !== 'object') {
    throw new Error('CRM_ROLE_POLICY_INVALID')
  }

  for (const [alias, target] of Object.entries(value.roleAliases)) {
    if (!alias || alias !== alias.toUpperCase() ||
        !target || String(target) !== String(target).toUpperCase()) {
      throw new Error('CRM_ROLE_POLICY_ALIASES_INVALID')
    }
  }

  for (const [role, modules] of Object.entries(value.fixedModuleGrants)) {
    const fixed = stringArray(modules, `CRM_ROLE_POLICY_FIXED_GRANTS_INVALID:${role}`)
    const restricted = stringArray(
      value.restrictedRoleModules[role],
      `CRM_ROLE_POLICY_RESTRICTED_MODULES_INVALID:${role}`,
    )
    if (fixed.some((moduleKey) => !restricted.includes(moduleKey))) {
      throw new Error(`CRM_ROLE_POLICY_FIXED_GRANTS_OUTSIDE_POLICY:${role}`)
    }
  }
  return value
}

export function loadCrmRolePolicy(file = process.env.CRM_ROLE_POLICY_FILE || DEFAULT_POLICY_FILE) {
  const resolved = path.resolve(file)
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'))
  } catch (error) {
    throw new Error(`CRM_ROLE_POLICY_LOAD_FAILED:${resolved}`, { cause: error })
  }
  return validateCrmRolePolicy(parsed)
}

export const crmRolePolicy = loadCrmRolePolicy()

export function normalizeCrmRole(value, policy = crmRolePolicy) {
  const raw = String(value || '').trim().toUpperCase()
  return policy.roleAliases[raw] || raw
}

export function effectiveAllowedModules(role, allowedModules, policy = crmRolePolicy) {
  const normalizedRole = normalizeCrmRole(role, policy)
  const fixed = policy.fixedModuleGrants[normalizedRole]
  if (fixed) return [...fixed]
  if (!Array.isArray(allowedModules)) return []
  return Array.from(new Set(allowedModules.map(String).map((item) => item.trim()).filter(Boolean)))
}
