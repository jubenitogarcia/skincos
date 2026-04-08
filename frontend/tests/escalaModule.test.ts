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

  it('builds the previous 3 month keys based on the selected month', () => {
    expect(__testables.buildPreviousMonthKeys('2026-04', 3)).toEqual([
      '2026-03',
      '2026-02',
      '2026-01',
    ])
  })

  it('derives weekday defaults by most frequent doctor in the last months', () => {
    const defaults = __testables.deriveWeekdayDefaultProfessionals([
      { date: '2026-01-05', unit: 'Novo Hamburgo', professional: 'Dra. Ana' }, // Monday
      { date: '2026-01-12', unit: 'Novo Hamburgo', professional: 'Dra. Ana' }, // Monday
      { date: '2026-02-02', unit: 'Novo Hamburgo', professional: 'Dr. Bruno' }, // Monday
      { date: '2026-02-03', unit: 'Novo Hamburgo', professional: 'Dr. Caio' }, // Tuesday
      { date: '2026-03-03', unit: 'Novo Hamburgo', professional: 'Dr. Caio' }, // Tuesday
      { date: '2026-03-10', unit: 'Novo Hamburgo', professional: 'Dra. Ana' }, // Tuesday
    ])

    expect(defaults[1]).toBe('Dra. Ana')
    expect(defaults[2]).toBe('Dr. Caio')
  })
})
