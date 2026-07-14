import type { AtendimentoFilters } from '@/atendimentoDomain'

export type AtendimentoHeaderOption = {
  value: string
  label: string
}

export type AtendimentoHeaderState = {
  loading: boolean
  filters: AtendimentoFilters
  units: AtendimentoHeaderOption[]
  procedures: AtendimentoHeaderOption[]
  injectors: AtendimentoHeaderOption[]
  activeUnitLabel: string
  periodLabel: string
  latestImportLabel: string
  localMirrorSummary: string
  localMirrorDetail: string
  total: number
}

export type AtendimentoHeaderAction =
  | { type: 'set-filter'; patch: Partial<AtendimentoFilters> }
  | { type: 'refresh' }
  | { type: 'open-import' }
  | { type: 'report' }

const ATENDIMENTO_HEADER_EVENT = 'skincos:atendimento:header'
const ATENDIMENTO_HEADER_ACTION_EVENT = 'skincos:atendimento:action'

function normalizeFilters(value: unknown): AtendimentoFilters | null {
  if (!value || typeof value !== 'object') return null
  const payload = value as Partial<AtendimentoFilters>
  return {
    unit: String(payload.unit || 'all'),
    from: String(payload.from || ''),
    to: String(payload.to || ''),
    procedure: String(payload.procedure || 'all'),
    code: String(payload.code || ''),
    injector: String(payload.injector || 'all'),
    consultant: String(payload.consultant || 'all'),
    search: String(payload.search || ''),
  }
}

function normalizeOptions(value: unknown): AtendimentoHeaderOption[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const payload = item as Partial<AtendimentoHeaderOption>
      const option = { value: String(payload.value || ''), label: String(payload.label || payload.value || '') }
      return option.value ? option : null
    })
    .filter(Boolean) as AtendimentoHeaderOption[]
}

export function normalizeAtendimentoHeaderState(detail: unknown): AtendimentoHeaderState | null {
  if (!detail || typeof detail !== 'object') return null
  const payload = detail as Partial<AtendimentoHeaderState>
  const filters = normalizeFilters(payload.filters)
  if (!filters) return null
  return {
    loading: Boolean(payload.loading),
    filters,
    units: normalizeOptions(payload.units),
    procedures: normalizeOptions(payload.procedures),
    injectors: normalizeOptions(payload.injectors),
    activeUnitLabel: String(payload.activeUnitLabel || 'Todas unidades'),
    periodLabel: String(payload.periodLabel || 'Todos os períodos'),
    latestImportLabel: String(payload.latestImportLabel || 'Sem import recente'),
    localMirrorSummary: String(payload.localMirrorSummary || ''),
    localMirrorDetail: String(payload.localMirrorDetail || ''),
    total: Number(payload.total || 0),
  }
}

export function normalizeAtendimentoHeaderAction(detail: unknown): AtendimentoHeaderAction | null {
  if (!detail || typeof detail !== 'object') return null
  const payload = detail as { type?: unknown; action?: unknown; patch?: unknown }
  const rawType = String(payload.type || payload.action || '').trim()
  if (rawType === 'refresh') return { type: 'refresh' }
  if (rawType === 'open-import') return { type: 'open-import' }
  if (rawType === 'report') return { type: 'report' }
  if (rawType === 'set-filter') {
    const patch = normalizeFilters({ consultant: 'all', ...(payload.patch || {}) })
    if (!patch) return null
    return { type: 'set-filter', patch: payload.patch as Partial<AtendimentoFilters> }
  }
  return null
}

export function emitAtendimentoHeaderState(detail: AtendimentoHeaderState | null) {
  try {
    window.dispatchEvent(new CustomEvent<AtendimentoHeaderState | null>(ATENDIMENTO_HEADER_EVENT, { detail }))
  } catch {
    // ignore browser event bridge errors
  }
}

export function dispatchAtendimentoHeaderAction(action: AtendimentoHeaderAction) {
  try {
    window.dispatchEvent(new CustomEvent<AtendimentoHeaderAction>(ATENDIMENTO_HEADER_ACTION_EVENT, { detail: action }))
  } catch {
    // ignore browser event bridge errors
  }
}

export function subscribeAtendimentoHeaderState(callback: (state: AtendimentoHeaderState | null) => void) {
  const handler = (event: Event) => {
    callback(normalizeAtendimentoHeaderState((event as CustomEvent<unknown>).detail))
  }
  window.addEventListener(ATENDIMENTO_HEADER_EVENT, handler as EventListener)
  return () => window.removeEventListener(ATENDIMENTO_HEADER_EVENT, handler as EventListener)
}

export function subscribeAtendimentoHeaderAction(callback: (action: AtendimentoHeaderAction) => void) {
  const handler = (event: Event) => {
    const action = normalizeAtendimentoHeaderAction((event as CustomEvent<unknown>).detail)
    if (!action) return
    callback(action)
  }
  window.addEventListener(ATENDIMENTO_HEADER_ACTION_EVENT, handler as EventListener)
  return () => window.removeEventListener(ATENDIMENTO_HEADER_ACTION_EVENT, handler as EventListener)
}
