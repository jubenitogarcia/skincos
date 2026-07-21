import { describe, expect, it } from 'vitest'
import { canManagePonto } from '../pontoAccess'

describe('Ponto management navigation policy', () => {
  it.each(['GESTOR', 'GERENTE', 'SUPERVISOR', 'ADMIN'])('allows the %s role to use management actions', (role) => {
    expect(canManagePonto(role)).toBe(true)
  })

  it.each(['CONSULTOR', 'EMPLOYEE', 'unknown', ''])('keeps %s out of management actions', (role) => {
    expect(canManagePonto(role)).toBe(false)
  })
})
