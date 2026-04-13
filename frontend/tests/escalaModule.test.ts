import { describe, expect, it } from 'vitest'

import { __testables } from '../EscalaProfissionaisModule'
import { buildMonthPlanMetrics, resolveDayPlanSource } from '../escalaDomain'

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

  it('builds future assignments from weekday history', () => {
    const updates = __testables.buildWeekdayPrefillAssignments(
      ['2026-04-06', '2026-04-07', '2026-04-08'],
      [
        { date: '2026-01-05', unit: 'Novo Hamburgo', professional: 'Dra. Ana' }, // Monday
        { date: '2026-02-02', unit: 'Novo Hamburgo', professional: 'Dra. Ana' }, // Monday
        { date: '2026-02-03', unit: 'Novo Hamburgo', professional: 'Dr. Bruno' }, // Tuesday
        { date: '2026-03-03', unit: 'Novo Hamburgo', professional: 'Dr. Bruno' }, // Tuesday
      ],
    )

    expect(updates).toEqual([
      { date: '2026-04-06', professional: 'Dra. Ana' },
      { date: '2026-04-07', professional: 'Dr. Bruno' },
    ])
  })

  it('applies prefill updates locally without requiring a full schedule refetch', () => {
    const next = __testables.applyPrefillUpdatesToSchedule(
      [
        { date: '2026-04-01', unit: 'Novo Hamburgo', professional: 'Dra. Ana' },
        { date: '2026-04-03', unit: 'Novo Hamburgo', professional: 'Dr. Caio' },
      ],
      'Novo Hamburgo',
      [
        { date: '2026-04-02', professional: 'Dr. Bruno' },
        { date: '2026-04-03', professional: 'Dra. Marina' },
      ],
    )

    expect(next).toEqual([
      { date: '2026-04-01', unit: 'Novo Hamburgo', professional: 'Dra. Ana' },
      { date: '2026-04-02', unit: 'Novo Hamburgo', professional: 'Dr. Bruno' },
      { date: '2026-04-03', unit: 'Novo Hamburgo', professional: 'Dra. Marina' },
    ])
  })

  it('marks an applied suggestion as auto until a manual overwrite happens', () => {
    expect(resolveDayPlanSource({
      date: '2026-04-14',
      entryNames: ['Dra. Marina'],
      blocked: false,
      autoSuggestion: {
        date: '2026-04-14',
        professional: 'Dra. Marina',
        confidence: 1,
        sampleSize: 1,
      },
    })).toBe('auto')

    expect(resolveDayPlanSource({
      date: '2026-04-14',
      entryNames: ['Dr. Bruno'],
      blocked: false,
      autoSuggestion: {
        date: '2026-04-14',
        professional: 'Dra. Marina',
        confidence: 1,
        sampleSize: 1,
      },
    })).toBe('manual')
  })

  it('computes month metrics from manual, auto, blocked and empty dates', () => {
    const metrics = buildMonthPlanMetrics(
      [
        { date: '2026-04-01', day: 1, monthOffset: 0 },
        { date: '2026-04-02', day: 2, monthOffset: 0 },
        { date: '2026-04-03', day: 3, monthOffset: 0 },
        { date: '2026-04-04', day: 4, monthOffset: 0 },
      ],
      new Map([
        ['2026-04-01', [{ date: '2026-04-01', unit: 'Novo Hamburgo', professional: 'Dra. Ana' }]],
        ['2026-04-02', [{ date: '2026-04-02', unit: 'Novo Hamburgo', professional: 'Dr. Bruno' }]],
      ]),
      new Set(['2026-04-03']),
      new Map([
        ['2026-04-02', { date: '2026-04-02', professional: 'Dr. Bruno', confidence: 0.7, sampleSize: 3 }],
      ]),
    )

    expect(metrics).toEqual({
      covered: 2,
      blocked: 1,
      empty: 1,
      manual: 1,
      auto: 1,
    })
  })
})
