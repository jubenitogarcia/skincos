import { describe, expect, it } from 'vitest'
import { crmModuleRegistry, moduleAvailability } from '../modules/registry'
import { ModuleErrorBoundary } from '../modules/ModuleHost'

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
    expect(moduleAvailability(atendimento, { role: 'GESTOR', allowedModules: [], enabledModuleKeys: enabled, financeEnabled: false })).toEqual({ available: true, state: 'available' })
    expect(moduleAvailability(finance, { role: 'GESTOR', allowedModules: ['finance'], enabledModuleKeys: enabled, financeEnabled: false })).toEqual({ available: false, state: 'unreleased', reason: 'Financeiro aguarda liberação operacional e escopo explícito.' })
  })

  it('keeps maintenance isolated from access, release and other modules', () => {
    const atendimento = crmModuleRegistry.find((entry) => entry.key === 'atendimento')!
    const insumos = crmModuleRegistry.find((entry) => entry.key === 'insumos')!
    const enabled = new Set(['atendimento', 'insumos'])
    const maintenance = new Set(['atendimento'])

    expect(moduleAvailability(atendimento, { role: 'GESTOR', allowedModules: [], enabledModuleKeys: enabled, maintenanceModuleKeys: maintenance, financeEnabled: false })).toEqual({ available: false, state: 'maintenance', reason: 'Este módulo está em manutenção programada. A navegação e os demais módulos continuam disponíveis.' })
    expect(moduleAvailability(insumos, { role: 'GESTOR', allowedModules: [], enabledModuleKeys: enabled, maintenanceModuleKeys: maintenance, financeEnabled: false })).toEqual({ available: true, state: 'available' })
  })

  it('turns a rendering exception into an isolated module recovery state', () => {
    expect(ModuleErrorBoundary.getDerivedStateFromError(new Error('synthetic render failure'))).toEqual({ error: true })
  })
})
