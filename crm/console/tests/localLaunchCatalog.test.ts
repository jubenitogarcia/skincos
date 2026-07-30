import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { hasCrmModuleAccess } from '../crmRoleAccess'
import { DEFAULT_UNLOCKED_MODULE_KEYS } from '../moduleAvailability'
import localLaunchCatalog from '../modules/localLaunchCatalog.json'
import rolePolicy from '../modules/localRolePolicy.json'

const registrySource = readFileSync(new URL('../modules/registry.tsx', import.meta.url), 'utf8')

function registryLabels(): Map<string, string> {
  return new Map(
    [...registrySource.matchAll(/manifest\(\{\s*key:\s*'([^']+)',\s*label:\s*'([^']+)'/g)]
      .map((match) => [match[1], match[2]]),
  )
}

describe('CRM local launch catalog', () => {
  it('is the exact local release list and stays in registry parity', () => {
    expect(localLaunchCatalog.modules.length).toBeGreaterThan(0)
    expect(DEFAULT_UNLOCKED_MODULE_KEYS).toEqual(localLaunchCatalog.modules.map((entry) => entry.key))
    expect(new Set(DEFAULT_UNLOCKED_MODULE_KEYS).size).toBe(DEFAULT_UNLOCKED_MODULE_KEYS.length)

    const labelsByKey = registryLabels()
    for (const entry of localLaunchCatalog.modules) {
      expect(entry.route).toBe(`/?module=${encodeURIComponent(entry.key)}`)
      expect(entry.dependencyIds.length).toBeGreaterThan(0)
      expect(typeof entry.onlineEnabled).toBe('boolean')
      expect(labelsByKey.get(entry.key)).toBe(entry.label)
    }
  })

  it('uses the same role truth for every catalog and policy combination', () => {
    const gestor = rolePolicy.launchRoles.find((role) => role.key === 'GESTOR')
    const consultor = rolePolicy.launchRoles.find((role) => role.key === 'CONSULTOR')
    expect(gestor).toEqual({ key: 'GESTOR', label: 'Gestor', access: 'all' })
    expect(consultor).toEqual({ key: 'CONSULTOR', label: 'Consultor', access: 'allowlist' })

    const gestorModules = localLaunchCatalog.modules.filter((entry) => hasCrmModuleAccess('GESTOR', [], entry.key))
    const consultorModules = localLaunchCatalog.modules.filter((entry) => hasCrmModuleAccess('CONSULTOR', [], entry.key))
    expect(gestorModules).toHaveLength(localLaunchCatalog.modules.length)
    expect(consultorModules.map((entry) => entry.key)).toEqual(rolePolicy.restrictedRoleModules.CONSULTOR)
  })

  it('keeps aliases and privileged module rules compatible with the existing policy', () => {
    expect(hasCrmModuleAccess('ADMIN', [], 'clientes')).toBe(true)
    expect(hasCrmModuleAccess('EMPLOYEE', ['insumos'], 'ponto')).toBe(true)
    expect(hasCrmModuleAccess('GERENTE', ['clientes'], 'clientes')).toBe(false)
    expect(hasCrmModuleAccess('GERENTE', [], 'escala-profissionais')).toBe(true)
    expect(hasCrmModuleAccess('SUPERVISOR', ['atendimento'], 'procedimentos')).toBe(true)
  })
})
