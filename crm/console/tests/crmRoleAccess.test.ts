import { describe, expect, it } from 'vitest'
import { hasCrmModuleAccess } from '../crmRoleAccess'

describe('CRM role module navigation', () => {
  it('limits Consultor to Atendimento and Ponto even without an allowedModules list', () => {
    expect(hasCrmModuleAccess('CONSULTOR', [], 'atendimento')).toBe(true)
    expect(hasCrmModuleAccess('CONSULTOR', [], 'ponto')).toBe(true)
    expect(hasCrmModuleAccess('CONSULTOR', [], 'faturamento')).toBe(false)
    expect(hasCrmModuleAccess('CONSULTOR', ['insumos'], 'insumos')).toBe(false)
  })

  it('keeps the legacy Employee spelling constrained during the transition', () => {
    expect(hasCrmModuleAccess('EMPLOYEE', [], 'atendimento')).toBe(true)
    expect(hasCrmModuleAccess('EMPLOYEE', [], 'ponto')).toBe(true)
    expect(hasCrmModuleAccess('EMPLOYEE', [], 'users')).toBe(false)
  })
})
