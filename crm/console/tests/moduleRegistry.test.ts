import { describe, expect, it } from 'vitest'
import { hasModulePermission, moduleRegistry, modulesByKey } from '../modules/registry'

describe('CRM module registry', () => {
  it('owns every module entrypoint, lazy bundle, tests, permission and unavailable state outside App.tsx', () => {
    expect(moduleRegistry.length).toBeGreaterThan(50)
    expect(new Set(moduleRegistry.map((module) => module.key)).size).toBe(moduleRegistry.length)
    for (const module of moduleRegistry) {
      expect(module.entrypoint).toMatch(/^@\//)
      expect(module.bundle).toBe('lazy')
      expect(module.Component).toBeDefined()
      expect(module.tests).toContain('npm --prefix crm/console test')
      expect(module.permissions.key).toBe(module.key)
      expect(module.unavailable.title).toContain(module.label)
      expect(module.unavailable.description.length).toBeGreaterThan(20)
    }
  })

  it('keeps the Finance pilot behind its dedicated server-confirmed permission while normal modules use CRM roles', () => {
    const finance = modulesByKey.get('finance')!
    const atendimento = modulesByKey.get('atendimento')!
    expect(hasModulePermission(finance, { role: 'ADMIN', allowedModules: ['finance'], financeEnabled: false })).toBe(false)
    expect(hasModulePermission(finance, { role: 'ADMIN', allowedModules: ['finance'], financeEnabled: true })).toBe(true)
    expect(hasModulePermission(atendimento, { role: 'CONSULTOR', allowedModules: ['atendimento'], financeEnabled: false })).toBe(true)
  })
})
