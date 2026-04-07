import { describe, expect, it } from 'vitest'

import { __testables } from '../EscalaProfissionaisModule'

describe('Escala module helpers', () => {
  it('keeps db professionals visible even when the selected month has no schedule', () => {
    const professionals = __testables.mergeProfessionals(new Set(), [
      {
        name: 'Dra. Ana',
        status: '',
        units: ['Novo Hamburgo'],
        role: '',
        shift: '',
        nickname: '',
        phone: '',
        email: '',
        instagram: '',
        color: '#22c55e',
      },
    ])

    expect(professionals).toEqual([
      expect.objectContaining({
        name: 'Dra. Ana',
        status: 'Ativo',
        role: 'Injetor',
        units: ['Novo Hamburgo'],
      }),
    ])
  })

  it('falls back to the latest available overview month when the current month is unavailable', () => {
    expect(__testables.resolveVisibleMonth(['2026-03'], '2026', '04')).toEqual({
      year: '2026',
      monthNumber: '03',
    })
  })
})
