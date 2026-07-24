import { describe, expect, it } from 'vitest'
import { crmModuleRegistry, moduleAvailability } from '../modules/registry'

describe('CRM module registry', () => {
  it('gives every module a manifest, lazy entrypoint, permission and isolated states', () => {
    const keys = crmModuleRegistry.map((entry) => entry.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.length).toBeGreaterThan(50)
    for (const entry of crmModuleRegistry) {
      expect(entry.permissions).toContain(`module.${entry.key}.access`)
      expect(entry.loader).toBeTypeOf('function')
      expect(entry.fallback.loadingLabel).toContain(entry.label)
      expect(entry.fallback.unavailableLabel).toContain(entry.label)
    }
  })

  it('isolates an unavailable module without making another module unavailable', () => {
    const atendimento = crmModuleRegistry.find((entry) => entry.key === 'atendimento')!
    const finance = crmModuleRegistry.find((entry) => entry.key === 'finance')!
    const enabled = new Set(['atendimento', 'finance'])
    expect(moduleAvailability(atendimento, { role: 'GESTOR', allowedModules: [], enabledModuleKeys: enabled, financeEnabled: false })).toEqual({ available: true })
    expect(moduleAvailability(finance, { role: 'GESTOR', allowedModules: ['finance'], enabledModuleKeys: enabled, financeEnabled: false })).toEqual({ available: false, reason: 'Financeiro aguarda liberação operacional e escopo explícito.' })
  })
})
