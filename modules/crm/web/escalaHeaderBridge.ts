import type { EscalaHeaderAction, EscalaHeaderState, EscalaHighlightMode } from '@/escalaTypes'

const ESCALA_HEADER_EVENT = 'skincos:escala:header'
const ESCALA_ACTION_EVENT = 'skincos:escala:action'

function isHighlightMode(value: unknown): value is EscalaHighlightMode {
  return value === 'manual' || value === 'auto' || value === 'blocked' || value === 'empty'
}

export function normalizeEscalaHeaderState(detail: unknown): EscalaHeaderState | null {
  if (!detail || typeof detail !== 'object') return null
  const payload = detail as Partial<EscalaHeaderState>
  if (!Array.isArray(payload.units) || !Array.isArray(payload.monthOptions) || !Array.isArray(payload.yearOptions)) {
    return null
  }
  return {
    units: payload.units.map((item) => String(item)),
    monthOptions: payload.monthOptions.map((item) => String(item)),
    yearOptions: payload.yearOptions.map((item) => String(item)),
    selectedUnit: String(payload.selectedUnit || ''),
    selectedMonthNumber: String(payload.selectedMonthNumber || ''),
    selectedYear: String(payload.selectedYear || ''),
    totalScheduledDays: Number(payload.totalScheduledDays || 0),
    unavailableDaysCount: payload.unavailableDaysCount == null ? undefined : Number(payload.unavailableDaysCount),
    manualDays: payload.manualDays == null ? undefined : Number(payload.manualDays),
    autoDays: payload.autoDays == null ? undefined : Number(payload.autoDays),
    blockedDays: payload.blockedDays == null ? undefined : Number(payload.blockedDays),
    emptyDays: payload.emptyDays == null ? undefined : Number(payload.emptyDays),
    coveredDays: payload.coveredDays == null ? undefined : Number(payload.coveredDays),
    highlightMode: isHighlightMode(payload.highlightMode) ? payload.highlightMode : null,
  }
}

export function normalizeEscalaHeaderAction(detail: unknown): EscalaHeaderAction | null {
  if (!detail || typeof detail !== 'object') return null
  const payload = detail as { action?: unknown; type?: unknown; value?: unknown }
  const rawType = String(payload.type || payload.action || '').trim()
  if (!rawType) return null

  if (rawType === 'clear-selection') {
    return { type: 'clear-selection' }
  }

  if (rawType === 'set-unit' || rawType === 'set-month' || rawType === 'set-year') {
    return {
      type: rawType,
      value: String(payload.value || ''),
    }
  }

  if (rawType === 'toggle-highlight' || rawType === 'toggle-highlight-mode') {
    const value = payload.value === 'scheduled' ? 'manual' : payload.value
    if (!isHighlightMode(value)) return null
    return { type: 'toggle-highlight', value }
  }

  return null
}

export function emitEscalaHeaderState(detail: EscalaHeaderState | null) {
  try {
    window.dispatchEvent(new CustomEvent<EscalaHeaderState | null>(ESCALA_HEADER_EVENT, { detail }))
  } catch {
    // ignore browser event bridge errors
  }
}

export function dispatchEscalaHeaderAction(action: EscalaHeaderAction) {
  try {
    window.dispatchEvent(new CustomEvent<EscalaHeaderAction>(ESCALA_ACTION_EVENT, { detail: action }))
  } catch {
    // ignore browser event bridge errors
  }
}

export function subscribeEscalaHeaderState(callback: (state: EscalaHeaderState | null) => void) {
  const handler = (event: Event) => {
    callback(normalizeEscalaHeaderState((event as CustomEvent<unknown>).detail))
  }
  window.addEventListener(ESCALA_HEADER_EVENT, handler as EventListener)
  return () => window.removeEventListener(ESCALA_HEADER_EVENT, handler as EventListener)
}

export function subscribeEscalaHeaderAction(callback: (action: EscalaHeaderAction) => void) {
  const handler = (event: Event) => {
    const action = normalizeEscalaHeaderAction((event as CustomEvent<unknown>).detail)
    if (!action) return
    callback(action)
  }
  window.addEventListener(ESCALA_ACTION_EVENT, handler as EventListener)
  return () => window.removeEventListener(ESCALA_ACTION_EVENT, handler as EventListener)
}
