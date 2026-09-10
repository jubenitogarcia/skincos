import type { PontoPunchRecord } from './pontoTypes'

export type PontoNextAction = {
  eventType: 'WORK_START' | 'BREAK_START' | 'BREAK_END' | 'WORK_END'
  label: string
  confirmation: string
}

const actions: Record<PontoNextAction['eventType'], Omit<PontoNextAction, 'eventType'>> = {
  WORK_START: { label: 'Registrar entrada', confirmation: 'Entrada registrada' },
  BREAK_START: { label: 'Iniciar intervalo', confirmation: 'Início do intervalo registrado' },
  BREAK_END: { label: 'Registrar retorno', confirmation: 'Retorno do intervalo registrado' },
  WORK_END: { label: 'Registrar saída', confirmation: 'Saída registrada' },
}

function canonicalEventType(value?: string | null): PontoNextAction['eventType'] | null {
  const type = String(value || '').trim().toUpperCase()
  if (type === 'IN') return 'WORK_START'
  if (type === 'OUT') return 'WORK_END'
  return type in actions ? type as PontoNextAction['eventType'] : null
}

export function getNextPunchAction(lastPunch?: Pick<PontoPunchRecord, 'eventType' | 'type'> | null): PontoNextAction {
  const previous = canonicalEventType(lastPunch?.eventType || lastPunch?.type)
  const next = ({
    WORK_START: 'BREAK_START',
    BREAK_START: 'BREAK_END',
    BREAK_END: 'WORK_END',
    WORK_END: 'WORK_START',
  } as const)[previous || 'WORK_END']
  return { eventType: next, ...actions[next] }
}

export function getPunchTypeLabel(value?: string | null): string {
  const type = canonicalEventType(value)
  return type
    ? ({ WORK_START: 'Entrada', BREAK_START: 'Início do intervalo', BREAK_END: 'Retorno do intervalo', WORK_END: 'Saída' } as const)[type]
    : String(value || 'Registro')
}

export function getPunchConfirmation(value?: string | null): string {
  const type = canonicalEventType(value)
  return type ? actions[type].confirmation : 'Ponto registrado'
}
