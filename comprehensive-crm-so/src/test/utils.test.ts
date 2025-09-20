import { describe, it, expect } from 'vitest'

// Simple utility function to test
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(amount)
}

describe('Utils', () => {
  it('formats currency correctly', () => {
    const result = formatCurrency(1000)
    expect(result).toMatch(/R\$\s*1\.000,00/)
  })

  it('formats zero correctly', () => {
    const result = formatCurrency(0)
    expect(result).toMatch(/R\$\s*0,00/)
  })

  it('handles negative values', () => {
    const result = formatCurrency(-500)
    expect(result).toMatch(/-R\$\s*500,00/)
  })
})