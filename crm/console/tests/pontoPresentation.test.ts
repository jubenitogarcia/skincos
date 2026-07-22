import { describe, expect, it } from 'vitest'
import { getNextPunchAction, getPunchConfirmation, getPunchTypeLabel } from '../pontoPresentation'

describe('Ponto self-service presentation', () => {
  it('starts a new sequence with an entry', () => {
    expect(getNextPunchAction(null)).toMatchObject({ eventType: 'WORK_START', label: 'Registrar entrada' })
  })

  it('follows the Worker event sequence, including interval actions', () => {
    expect(getNextPunchAction({ type: 'IN' })).toMatchObject({ eventType: 'BREAK_START', label: 'Iniciar intervalo' })
    expect(getNextPunchAction({ eventType: 'BREAK_START', type: 'BREAK_START' })).toMatchObject({ eventType: 'BREAK_END', label: 'Registrar retorno' })
    expect(getNextPunchAction({ eventType: 'BREAK_END', type: 'BREAK_END' })).toMatchObject({ eventType: 'WORK_END', label: 'Registrar saída' })
    expect(getNextPunchAction({ type: 'OUT' })).toMatchObject({ eventType: 'WORK_START', label: 'Registrar entrada' })
  })

  it('uses clear Portuguese labels in history and confirmation feedback', () => {
    expect(getPunchTypeLabel('WORK_END')).toBe('Saída')
    expect(getPunchTypeLabel('BREAK_END')).toBe('Retorno do intervalo')
    expect(getPunchConfirmation('IN')).toBe('Entrada registrada')
  })
})
