import { describe, expect, it } from 'vitest'

import { minorUnitsFromDisplay } from '../financeApi'

describe('Finance transport helpers', () => {
  it('converts a decimal display value without floating point arithmetic', () => {
    expect(minorUnitsFromDisplay('120,50')).toBe(12050)
    expect(minorUnitsFromDisplay('0.01')).toBe(1)
  })

  it('rejects fractional minor units and non-positive values before transport', () => {
    expect(minorUnitsFromDisplay('12.345')).toBeNull()
    expect(minorUnitsFromDisplay('0')).toBeNull()
    expect(minorUnitsFromDisplay('-1')).toBeNull()
  })
})
