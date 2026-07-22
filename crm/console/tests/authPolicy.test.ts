import { describe, expect, it } from 'vitest'

import { effectiveAllowedModules, isAtendimentoManager, normalizeCrmRole } from '../authPolicy'

describe('CRM effective role policy', () => {
  it('narrows consultants to Atendimento even for legacy blank or broad grants', () => {
    expect(effectiveAllowedModules('CONSULTOR', [])).toEqual(['atendimento'])
    expect(effectiveAllowedModules('CONSULTOR', ['insumos', 'atendimento', 'status'])).toEqual(['atendimento'])
  })

  it('keeps role aliases and management permissions explicit', () => {
    expect(normalizeCrmRole('ADMIN')).toBe('GESTOR')
    expect(normalizeCrmRole('EMPLOYEE')).toBe('CONSULTOR')
    expect(isAtendimentoManager('GERENTE')).toBe(true)
    expect(isAtendimentoManager('CONSULTOR')).toBe(false)
  })
})
