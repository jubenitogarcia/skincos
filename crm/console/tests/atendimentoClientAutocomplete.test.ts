import { describe, expect, it } from 'vitest'
import { filterAtendimentoClientSuggestions } from '../atendimentoClientAutocomplete'

describe('filterAtendimentoClientSuggestions', () => {
  const clients = [
    { name: 'Cynthia Cordova', usageCount: 2 },
    { name: 'Cíntia Costa', usageCount: 3 },
    { name: 'Ana Isabel Padilha', usageCount: 1 },
  ]

  it('filters a loaded unit client list accent-insensitively', () => {
    expect(filterAtendimentoClientSuggestions('cint', clients).map((client) => client.name))
      .toEqual(['Cíntia Costa'])
  })

  it('does not open a client result set before a meaningful query', () => {
    expect(filterAtendimentoClientSuggestions('a', clients)).toEqual([])
  })
})
