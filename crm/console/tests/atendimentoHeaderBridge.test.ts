import { describe, expect, it } from 'vitest'

import { normalizeAtendimentoHeaderAction } from '@/atendimentoHeaderBridge'

describe('Atendimento header bridge', () => {
  it('accepts only the typed global layout actions', () => {
    expect(normalizeAtendimentoHeaderAction({ type: 'layout', value: 'expandAll' })).toEqual({ type: 'layout', value: 'expandAll' })
    expect(normalizeAtendimentoHeaderAction({ action: 'layout', value: 'collapseAll' })).toEqual({ type: 'layout', value: 'collapseAll' })
    expect(normalizeAtendimentoHeaderAction({ type: 'layout', value: 'toggle' })).toBeNull()
    expect(normalizeAtendimentoHeaderAction({ type: 'layout' })).toBeNull()
  })
})
