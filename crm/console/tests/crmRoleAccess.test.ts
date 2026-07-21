import { describe, expect, it } from 'vitest'
import { hasCrmModuleAccess } from '../crmRoleAccess'

describe('CRM role module navigation', () => {
  it('keeps Consultor limited to Atendimento and Ponto even without an allowedModules list', () => {
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

  it.each([
    ['ADMIN'],
    ['GESTOR'],
    ['GERENTE'],
    ['SUPERVISOR'],
    ['CONSULTOR'],
    ['EMPLOYEE'],
    ['custom-authenticated-role'],
  ])('always exposes Ponto to the authenticated %s role even when it is not assigned', (role) => {
    expect(hasCrmModuleAccess(role, ['insumos'], 'ponto')).toBe(true)
  })

  it('does not use Ponto visibility to broaden any other module', () => {
    expect(hasCrmModuleAccess('SUPERVISOR', ['insumos'], 'atendimento')).toBe(false)
    expect(hasCrmModuleAccess('CONSULTOR', ['insumos'], 'users')).toBe(false)
    expect(hasCrmModuleAccess('custom-authenticated-role', ['insumos'], 'users')).toBe(false)
  })
})
