import { describe, expect, it } from 'vitest'

import { formatAtendimentoTableDate } from '../AtendimentoDatePicker'

describe('AtendimentoDatePicker', () => {
  it('keeps the year in the stored ISO date but renders only day and month in the table', () => {
    expect(formatAtendimentoTableDate('2026-07-10')).toBe('10/07')
  })

  it('does not render a misleading compact date for an empty or malformed value', () => {
    expect(formatAtendimentoTableDate('')).toBe('')
    expect(formatAtendimentoTableDate('2026-07')).toBe('')
  })
})
