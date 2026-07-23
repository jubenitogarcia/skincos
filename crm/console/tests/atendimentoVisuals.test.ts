import { describe, expect, it } from 'vitest'
import { atendimentoColorWithAlpha, atendimentoEntityColor, atendimentoProfessionalColor } from '@/atendimentoVisuals'

describe('atendimento visual identities', () => {
  it('prefers the registered professional color and resolves aliases without accents', () => {
    const professionals = [{
      name: 'Raul Rosário Júnior',
      alias: 'Raul Junior',
      backgroundColor: '#14b8a6',
    }]

    expect(atendimentoProfessionalColor('Raul Júnior', professionals)).toBe('#14b8a6')
  })

  it('keeps fallback entity colors stable and produces a safe row tint', () => {
    expect(atendimentoEntityColor('Botox')).toBe(atendimentoEntityColor('Botox'))
    expect(atendimentoColorWithAlpha('#38bdf8', 0.2)).toBe('rgba(56, 189, 248, 0.2)')
  })
})
