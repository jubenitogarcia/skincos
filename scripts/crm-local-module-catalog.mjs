#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')
const CATALOG_FILE = resolve(REPO_ROOT, 'crm/console/modules/localLaunchCatalog.json')
const ROLE_POLICY_FILE = resolve(REPO_ROOT, 'crm/console/modules/localRolePolicy.json')
const LAUNCHER_CONTRACT_FILES = Object.freeze([
  'scripts/run-shared-codex-shortcut.ps1',
  'scripts/run-local-crm.sh',
  'scripts/crm-local-persona-runtime.sh',
  'scripts/crm-local-runtime-policy.mjs',
  'scripts/crm-local-build-state.mjs',
  'scripts/crm-local-module-catalog.mjs',
  'scripts/open-crm-local-browser.ps1',
  'scripts/run-local-whatsapp-orchestrator.sh',
  'crm/console/scripts/dev_pages.sh',
  'crm/console/scripts/crm-local-smoke.cjs',
  'crm/console/modules/localLaunchCatalog.json',
  'crm/console/modules/localRolePolicy.json',
])

export const LOCAL_LAUNCH_SCHEMA_VERSION = 1
export const LOCAL_LAUNCH_PORT_PLAN = Object.freeze({
  base: 24000,
  stride: 10,
  offsets: Object.freeze({
    pages: 0,
    vite: 1,
    insumos: 2,
    timekeeping: 3,
    whatsapp: 4,
  }),
})

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function fingerprint(value) {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`
}

function launcherContractFingerprint() {
  const hash = createHash('sha256')
  for (const relativePath of LAUNCHER_CONTRACT_FILES) {
    hash.update(relativePath)
    hash.update('\0')
    hash.update(readFileSync(resolve(REPO_ROOT, relativePath)))
    hash.update('\0')
  }
  return `sha256:${hash.digest('hex')}`
}

function dependencyFlags(dependencyIds) {
  const values = new Set(dependencyIds)
  return {
    insumos: values.has('insumos-worker'),
    timekeeping: values.has('timekeeping-worker'),
    whatsapp: values.has('crm-local-adapter'),
  }
}

function portBundle(index, dependencies, portPlan) {
  const start = portPlan.base + (index * portPlan.stride)
  return {
    pages: start + portPlan.offsets.pages,
    vite: start + portPlan.offsets.vite,
    insumos: dependencies.insumos ? start + portPlan.offsets.insumos : null,
    timekeeping: dependencies.timekeeping ? start + portPlan.offsets.timekeeping : null,
    whatsapp: dependencies.whatsapp ? start + portPlan.offsets.whatsapp : null,
  }
}

function validateSources(catalog, rolePolicy) {
  if (catalog?.schemaVersion !== 1 || catalog?.launcherContractVersion !== 1 ||
      !Number.isSafeInteger(catalog?.catalogVersion) ||
      !Array.isArray(catalog?.baseDependencyIds) ||
      !Array.isArray(catalog?.modules) || catalog.modules.length < 1) {
    throw new Error('CRM_LOCAL_MODULE_CATALOG_INVALID')
  }
  if (rolePolicy?.schemaVersion !== 1 ||
      !Number.isSafeInteger(rolePolicy?.policyVersion) ||
      !Array.isArray(rolePolicy?.launchRoles) || rolePolicy.launchRoles.length < 1) {
    throw new Error('CRM_LOCAL_ROLE_POLICY_INVALID')
  }
  const baseDependencies = catalog.baseDependencyIds.map((value) => String(value || ''))
  if (baseDependencies.some((value) => !value) ||
      new Set(baseDependencies).size !== baseDependencies.length) {
    throw new Error('CRM_LOCAL_BASE_DEPENDENCIES_INVALID')
  }
  const keys = catalog.modules.map((entry) => String(entry?.key || ''))
  if (keys.some((key) => !key) || new Set(keys).size !== keys.length) {
    throw new Error('CRM_LOCAL_MODULE_KEYS_INVALID')
  }
  for (const moduleEntry of catalog.modules) {
    if (moduleEntry.route !== `/?module=${encodeURIComponent(moduleEntry.key)}`) {
      throw new Error(`CRM_LOCAL_MODULE_ROUTE_INVALID:${moduleEntry.key}`)
    }
    if (!moduleEntry.label || !Array.isArray(moduleEntry.dependencyIds) ||
        (moduleEntry.onlineEnabled !== undefined && typeof moduleEntry.onlineEnabled !== 'boolean')) {
      throw new Error(`CRM_LOCAL_MODULE_ENTRY_INVALID:${moduleEntry.key}`)
    }
    const dependencyIds = moduleEntry.dependencyIds.map((value) => String(value || ''))
    if (dependencyIds.some((value) => !value) ||
        new Set(dependencyIds).size !== dependencyIds.length) {
      throw new Error(`CRM_LOCAL_MODULE_DEPENDENCIES_INVALID:${moduleEntry.key}`)
    }
  }
  const roleKeys = rolePolicy.launchRoles.map((role) => String(role?.key || ''))
  if (roleKeys.some((key) => !key) || new Set(roleKeys).size !== roleKeys.length) {
    throw new Error('CRM_LOCAL_ROLE_KEYS_INVALID')
  }
  for (const role of rolePolicy.launchRoles) {
    if (!role.label || !['all', 'allowlist'].includes(role.access)) {
      throw new Error(`CRM_LOCAL_ROLE_ENTRY_INVALID:${role.key}`)
    }
  }
}

function roleModuleKeys(role, catalog, rolePolicy) {
  if (role.access === 'all') return catalog.modules.map((entry) => entry.key)
  if (role.access !== 'allowlist') throw new Error(`CRM_LOCAL_ROLE_ACCESS_INVALID:${role.key}`)
  const modules = rolePolicy?.restrictedRoleModules?.[role.key]
  if (!Array.isArray(modules)) throw new Error(`CRM_LOCAL_ROLE_MODULES_INVALID:${role.key}`)
  const normalized = modules.map((value) => String(value || ''))
  if (normalized.some((value) => !value) || new Set(normalized).size !== normalized.length) {
    throw new Error(`CRM_LOCAL_ROLE_MODULES_INVALID:${role.key}`)
  }
  return normalized
}

function roleFixedModuleGrants(role, rolePolicy) {
  const modules = rolePolicy?.fixedModuleGrants?.[role.key]
  if (modules === undefined) return []
  if (!Array.isArray(modules)) {
    throw new Error(`CRM_LOCAL_ROLE_FIXED_GRANTS_INVALID:${role.key}`)
  }
  const normalized = modules.map((value) => String(value || ''))
  if (normalized.some((value) => !value) || new Set(normalized).size !== normalized.length) {
    throw new Error(`CRM_LOCAL_ROLE_FIXED_GRANTS_INVALID:${role.key}`)
  }
  const restricted = rolePolicy?.restrictedRoleModules?.[role.key]
  if (Array.isArray(restricted) && normalized.some((value) => !restricted.includes(value))) {
    throw new Error(`CRM_LOCAL_ROLE_FIXED_GRANTS_OUTSIDE_POLICY:${role.key}`)
  }
  return normalized
}

export function discoverLocalLaunchCatalog(options = {}) {
  const catalog = options.catalog || readJson(CATALOG_FILE)
  const rolePolicy = options.rolePolicy || readJson(ROLE_POLICY_FILE)
  const portPlan = options.portPlan || LOCAL_LAUNCH_PORT_PLAN
  validateSources(catalog, rolePolicy)

  const moduleByKey = new Map(catalog.modules.map((entry) => [entry.key, entry]))
  const contractFingerprint = options.launcherContractFingerprint || launcherContractFingerprint()
  if (!/^sha256:[a-f0-9]{64}$/.test(contractFingerprint)) {
    throw new Error('CRM_LOCAL_LAUNCHER_CONTRACT_FINGERPRINT_INVALID')
  }
  const roles = rolePolicy.launchRoles.map((role) => ({
    role: role.label,
    roleKey: role.key,
  }))
  const combinations = []

  for (const role of rolePolicy.launchRoles) {
    const fixedModuleGrants = roleFixedModuleGrants(role, rolePolicy)
    for (const moduleKey of roleModuleKeys(role, catalog, rolePolicy)) {
      const moduleEntry = moduleByKey.get(moduleKey)
      if (!moduleEntry) throw new Error(`CRM_LOCAL_ROLE_REFERENCES_UNKNOWN_MODULE:${role.key}:${moduleKey}`)
      const dependencyIds = [...catalog.baseDependencyIds, ...moduleEntry.dependencyIds]
      const dependencies = dependencyFlags(dependencyIds)
      const ports = portBundle(combinations.length, dependencies, portPlan)
      const runtimeId = `crm-local--${moduleEntry.key}--${String(role.key).toLowerCase()}`
      const combination = {
        role: role.label,
        roleKey: role.key,
        module: moduleEntry.key,
        label: moduleEntry.label,
        route: moduleEntry.route,
        localScenario: moduleEntry.localScenario || null,
        runtimeId,
        dependencyIds,
        dependencies,
        ports,
        auth: {
          testUserAdmin: role.access === 'all',
          allowedModules: fixedModuleGrants,
        },
        launcherContractVersion: catalog.launcherContractVersion,
        launcherContractFingerprint: contractFingerprint,
      }
      combinations.push({
        ...combination,
        configFingerprint: fingerprint({
          schemaVersion: LOCAL_LAUNCH_SCHEMA_VERSION,
          catalogVersion: catalog.catalogVersion,
          rolePolicyVersion: rolePolicy.policyVersion,
          ...combination,
        }),
      })
    }
  }
  const runtimeIds = combinations.map((entry) => entry.runtimeId)
  const ports = combinations.flatMap((entry) => Object.values(entry.ports).filter(Number.isInteger))
  if (new Set(runtimeIds).size !== runtimeIds.length) {
    throw new Error('CRM_LOCAL_RUNTIME_IDS_COLLIDE')
  }
  if (ports.some((port) => port < 1 || port > 65535) || new Set(ports).size !== ports.length) {
    throw new Error('CRM_LOCAL_PORT_PLAN_INVALID')
  }

  const fullRuntimeContract = {
    runtimeId: 'gestor--full',
    module: 'full',
    role: 'Gestor',
    roleKey: 'GESTOR',
    route: '/',
    dependencyIds: [
      'pages-functions',
      'insumos-worker',
      'timekeeping-worker',
      'crm-local-adapter',
    ],
    dependencies: {
      insumos: true,
      timekeeping: true,
      whatsapp: true,
    },
    ports: {
      pages: 8791,
      vite: 5173,
      insumos: 8787,
      timekeeping: 8801,
      whatsapp: 8110,
    },
    gateModules: catalog.modules.map((entry) => entry.key),
    launcherContractVersion: catalog.launcherContractVersion,
    launcherContractFingerprint: contractFingerprint,
  }
  const fullRuntime = {
    ...fullRuntimeContract,
    configFingerprint: fingerprint({
      schemaVersion: LOCAL_LAUNCH_SCHEMA_VERSION,
      catalogVersion: catalog.catalogVersion,
      rolePolicyVersion: rolePolicy.policyVersion,
      ...fullRuntimeContract,
    }),
  }

  return {
    schemaVersion: LOCAL_LAUNCH_SCHEMA_VERSION,
    catalogVersion: catalog.catalogVersion,
    launcherContractVersion: catalog.launcherContractVersion,
    launcherContractFingerprint: contractFingerprint,
    rolePolicyVersion: rolePolicy.policyVersion,
    portPlan,
    roles,
    fullRuntime,
    combinations,
  }
}

function parseArgs(argv) {
  const filters = {}
  let compact = false
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--json') continue
    if (value === '--compact') {
      compact = true
      continue
    }
    if (value === '--role' || value === '--module') {
      const next = argv[index + 1]
      if (!next) throw new Error(`CRM_LOCAL_CATALOG_ARGUMENT_REQUIRED:${value}`)
      filters[value.slice(2)] = next
      index += 1
      continue
    }
    throw new Error(`CRM_LOCAL_CATALOG_ARGUMENT_UNKNOWN:${value}`)
  }
  return { compact, filters }
}

function filteredOutput(output, filters) {
  const roleFilter = String(filters.role || '').trim().toUpperCase()
  const moduleFilter = String(filters.module || '').trim()
  const combinations = output.combinations.filter((entry) => (
    (!roleFilter || entry.roleKey === roleFilter) &&
    (!moduleFilter || entry.module === moduleFilter)
  ))
  if ((roleFilter || moduleFilter) && combinations.length === 0) {
    throw new Error('CRM_LOCAL_COMBINATION_NOT_AVAILABLE')
  }
  return { ...output, combinations }
}

async function main() {
  const { compact, filters } = parseArgs(process.argv.slice(2))
  const output = filteredOutput(discoverLocalLaunchCatalog(), filters)
  process.stdout.write(`${JSON.stringify(output, null, compact ? 0 : 2)}\n`)
}

const invokedAsScript = process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url

if (invokedAsScript) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.message || error)}\n`)
    process.exitCode = 2
  })
}
