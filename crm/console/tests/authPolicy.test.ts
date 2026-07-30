import { describe, expect, it } from 'vitest'

import { effectiveAllowedModules, isAtendimentoManager, normalizeCrmRole } from '../authPolicy'
import rolePolicy from '../modules/localRolePolicy.json'

describe('CRM effective role policy', () => {
  it('narrows consultants to Atendimento even for legacy blank or broad grants', () => {
    expect(rolePolicy.fixedModuleGrants.CONSULTOR).toEqual(['atendimento'])
    expect(effectiveAllowedModules('CONSULTOR', [])).toEqual(rolePolicy.fixedModuleGrants.CONSULTOR)
    expect(effectiveAllowedModules('CONSULTOR', ['insumos', 'atendimento', 'status'])).toEqual(rolePolicy.fixedModuleGrants.CONSULTOR)
  })

  it('keeps role aliases and management permissions explicit', () => {
    for (const [alias, role] of Object.entries(rolePolicy.roleAliases)) {
      expect(normalizeCrmRole(alias)).toBe(role)
    }
    expect(isAtendimentoManager('GERENTE')).toBe(true)
    expect(isAtendimentoManager('CONSULTOR')).toBe(false)
  })
})
