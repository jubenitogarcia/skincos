import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { commercialCadenceManagerStatuses } from '../atendimentoApi'

describe('Clientes clinical cadence safety', () => {
  it('does not expose an approval action to commercial managers', () => {
    expect(commercialCadenceManagerStatuses).toEqual(['draft', 'disabled'])
  })

  it('explains the unavailable clinical approval path in the rendered module source', () => {
    const source = readFileSync(new URL('../ClientCommercialModule.tsx', import.meta.url), 'utf8')
    expect(source).toContain('A aprovação clínica exige um fluxo verificado e não está disponível neste módulo.')
    expect(source).not.toContain('<option value="approved">')
  })
})
