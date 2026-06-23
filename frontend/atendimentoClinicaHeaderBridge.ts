import type { AtendimentoClinicaFilters } from '@/atendimentoClinicaDomain'

export type AtendimentoClinicaHeaderOption = {
  value: string
  label: string
}

export type AtendimentoClinicaHeaderState = {
  loading: boolean
  filters: AtendimentoClinicaFilters
  units: AtendimentoClinicaHeaderOption[]
  procedures: AtendimentoClinicaHeaderOption[]
  injectors: AtendimentoClinicaHeaderOption[]
  activeUnitLabel: string
  periodLabel: string
  latestImportLabel: string
  total: number
}

export type AtendimentoClinicaHeaderAction =
  | { type: 'set-filter'; patch: Partial<AtendimentoClinicaFilters> }
  | { type: 'refresh' }
  | { type: 'open-import' }
  | { type: 'report' }

const ATENDIMENTO_CLINICA_HEADER_EVENT = 'skincos:atendimento-clinica:header'
const ATENDIMENTO_CLINICA_HEADER_ACTION_EVENT = 'skincos:atendimento-clinica:action'

function normalizeFilters(value: unknown): AtendimentoClinicaFilters | null {
  if (!value || typeof value !== 'object') return null
  const payload = value as Partial<AtendimentoClinicaFilters>
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

function normalizeOptions(value: unknown): AtendimentoClinicaHeaderOption[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const payload = item as Partial<AtendimentoClinicaHeaderOption>
      const option = { value: String(payload.value || ''), label: String(payload.label || payload.value || '') }
      return option.value ? option : null
    })
    .filter(Boolean) as AtendimentoClinicaHeaderOption[]
}

export function normalizeAtendimentoClinicaHeaderState(detail: unknown): AtendimentoClinicaHeaderState | null {
  if (!detail || typeof detail !== 'object') return null
  const payload = detail as Partial<AtendimentoClinicaHeaderState>
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
    total: Number(payload.total || 0),
  }
}

export function normalizeAtendimentoClinicaHeaderAction(detail: unknown): AtendimentoClinicaHeaderAction | null {
  if (!detail || typeof detail !== 'object') return null
  const payload = detail as { type?: unknown; action?: unknown; patch?: unknown }
  const rawType = String(payload.type || payload.action || '').trim()
  if (rawType === 'refresh') return { type: 'refresh' }
  if (rawType === 'open-import') return { type: 'open-import' }
  if (rawType === 'report') return { type: 'report' }
  if (rawType === 'set-filter') {
    const patch = normalizeFilters({ consultant: 'all', ...(payload.patch || {}) })
    if (!patch) return null
    return { type: 'set-filter', patch: payload.patch as Partial<AtendimentoClinicaFilters> }
  }
  return null
}

export function emitAtendimentoClinicaHeaderState(detail: AtendimentoClinicaHeaderState | null) {
  try {
    window.dispatchEvent(new CustomEvent<AtendimentoClinicaHeaderState | null>(ATENDIMENTO_CLINICA_HEADER_EVENT, { detail }))
  } catch {
    // ignore browser event bridge errors
  }
}

export function dispatchAtendimentoClinicaHeaderAction(action: AtendimentoClinicaHeaderAction) {
  try {
    window.dispatchEvent(new CustomEvent<AtendimentoClinicaHeaderAction>(ATENDIMENTO_CLINICA_HEADER_ACTION_EVENT, { detail: action }))
  } catch {
    // ignore browser event bridge errors
  }
}

export function subscribeAtendimentoClinicaHeaderState(callback: (state: AtendimentoClinicaHeaderState | null) => void) {
  const handler = (event: Event) => {
    callback(normalizeAtendimentoClinicaHeaderState((event as CustomEvent<unknown>).detail))
  }
  window.addEventListener(ATENDIMENTO_CLINICA_HEADER_EVENT, handler as EventListener)
  return () => window.removeEventListener(ATENDIMENTO_CLINICA_HEADER_EVENT, handler as EventListener)
}

export function subscribeAtendimentoClinicaHeaderAction(callback: (action: AtendimentoClinicaHeaderAction) => void) {
  const handler = (event: Event) => {
    const action = normalizeAtendimentoClinicaHeaderAction((event as CustomEvent<unknown>).detail)
    if (!action) return
    callback(action)
  }
  window.addEventListener(ATENDIMENTO_CLINICA_HEADER_ACTION_EVENT, handler as EventListener)
  return () => window.removeEventListener(ATENDIMENTO_CLINICA_HEADER_ACTION_EVENT, handler as EventListener)
}
