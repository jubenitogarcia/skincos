import type {
  InsumosHeaderAction,
  InsumosHeaderState,
  InsumosLayoutAction,
  InsumosOverviewPeriod,
  InsumosOverviewQuery,
  InsumosQuickOperation,
} from '@/insumosTypes'

const INSUMOS_HEADER_EVENT = 'skincos:insumos:header'
const INSUMOS_ACTION_EVENT = 'skincos:insumos:action'
const INSUMOS_LEGACY_UNIT_EVENT = 'skincos:insumos:unidade'
const INSUMOS_LEGACY_OVERVIEW_EVENT = 'skincos:insumos:overview'
const INSUMOS_LEGACY_OP_EVENT = 'skincos:insumos:op'
const INSUMOS_LEGACY_LAYOUT_EVENT = 'skincos:insumos:layout'
const INSUMOS_LEGACY_STOCK_EVENT = 'skincos:insumos:estoque'

function isOverviewPeriod(value: unknown): value is InsumosOverviewPeriod {
  return value === '7d' || value === '30d' || value === '1y' || value === 'custom'
}

function isQuickOperation(value: unknown): value is InsumosQuickOperation {
  return value === 'ENTRADA' || value === 'BAIXA' || value === 'AJUSTE' || value === 'TRANSFERENCIA'
}

function isLayoutAction(value: unknown): value is InsumosLayoutAction {
  return value === 'expandAll' || value === 'collapseAll' || value === 'reset'
}

function normalizeOverviewQuery(detail: unknown): InsumosOverviewQuery | null {
  if (!detail || typeof detail !== 'object') return null
  const payload = detail as Partial<InsumosOverviewQuery>
  const period = isOverviewPeriod(payload.period) ? payload.period : undefined
  const from = typeof payload.from === 'string' ? payload.from : undefined
  const to = typeof payload.to === 'string' ? payload.to : undefined
  const action = payload.action === 'reload' ? 'reload' : undefined
  if (!period && !from && !to && !action) return null
  return { period, from, to, action }
}

export function normalizeInsumosHeaderState(detail: unknown): InsumosHeaderState | null {
  if (!detail || typeof detail !== 'object') return null
  const payload = detail as Partial<InsumosHeaderState>
  const stock = payload.stock && typeof payload.stock === 'object'
    ? {
        value: payload.stock.value == null ? null : Number(payload.stock.value),
        loading: Boolean(payload.stock.loading),
        percent: payload.stock.percent == null ? null : Number(payload.stock.percent),
        entradaValor: payload.stock.entradaValor == null ? null : Number(payload.stock.entradaValor),
        saidaValor: payload.stock.saidaValor == null ? null : Number(payload.stock.saidaValor),
      }
    : null
  const status = payload.status && typeof payload.status === 'object'
    ? {
        online: payload.status.online == null ? null : Boolean(payload.status.online),
        authed: payload.status.authed == null ? null : Boolean(payload.status.authed),
        integrated: payload.status.integrated == null ? null : Boolean(payload.status.integrated),
        unidades: Array.isArray(payload.status.unidades) ? payload.status.unidades.map((item) => String(item)) : [],
        allowedUnits: Array.isArray(payload.status.allowedUnits) ? payload.status.allowedUnits.map((item) => String(item)) : [],
      }
    : null
  const overview = normalizeOverviewQuery(payload.overview) || { period: '30d' as const }
  if (!isOverviewPeriod(overview.period)) {
    overview.period = '30d'
  }
  return {
    status,
    stock,
    selectedUnit: String(payload.selectedUnit || ''),
    overview: {
      period: overview.period,
      from: overview.from,
      to: overview.to,
    },
  }
}

export function normalizeInsumosHeaderAction(detail: unknown): InsumosHeaderAction | null {
  if (!detail || typeof detail !== 'object') return null
  const payload = detail as Record<string, unknown>
  const rawType = String(payload.type || payload.action || '').trim()

  if (rawType === 'set-unit' || Object.prototype.hasOwnProperty.call(payload, 'unidade')) {
    const value = String(payload.value || payload.unidade || '').trim()
    return value ? { type: 'set-unit', value } : null
  }

  if (rawType === 'quick-op' || Object.prototype.hasOwnProperty.call(payload, 'op')) {
    const op = payload.value || payload.op
    return isQuickOperation(op) ? { type: 'quick-op', value: op } : null
  }

  if (rawType === 'layout') {
    return isLayoutAction(payload.value) ? { type: 'layout', value: payload.value } : null
  }

  if (isLayoutAction(payload.action)) {
    return { type: 'layout', value: payload.action }
  }

  if (rawType === 'reload-overview') {
    return { type: 'reload-overview' }
  }

  if (rawType === 'set-overview' || rawType === 'reload' || payload.period || payload.from || payload.to) {
    const overview = normalizeOverviewQuery(rawType === 'reload' ? { ...payload, action: 'reload' } : payload)
    return overview ? { type: 'set-overview', value: overview } : null
  }

  return null
}

function dispatchLegacyAction(action: InsumosHeaderAction) {
  try {
    if (action.type === 'set-unit') {
      window.dispatchEvent(new CustomEvent(INSUMOS_LEGACY_UNIT_EVENT, { detail: { unidade: action.value } }))
      return
    }
    if (action.type === 'set-overview') {
      window.dispatchEvent(new CustomEvent(INSUMOS_LEGACY_OVERVIEW_EVENT, { detail: action.value }))
      return
    }
    if (action.type === 'reload-overview') {
      window.dispatchEvent(new CustomEvent(INSUMOS_LEGACY_OVERVIEW_EVENT, { detail: { action: 'reload' } }))
      return
    }
    if (action.type === 'quick-op') {
      window.dispatchEvent(new CustomEvent(INSUMOS_LEGACY_OP_EVENT, { detail: { op: action.value } }))
      return
    }
    if (action.type === 'layout') {
      window.dispatchEvent(new CustomEvent(INSUMOS_LEGACY_LAYOUT_EVENT, { detail: { action: action.value } }))
    }
  } catch {
    // ignore legacy bridge errors
  }
}

export function emitInsumosHeaderState(detail: InsumosHeaderState | null) {
  try {
    window.dispatchEvent(new CustomEvent<InsumosHeaderState | null>(INSUMOS_HEADER_EVENT, { detail }))
  } catch {
    // ignore
  }
  if (detail?.stock) {
    try {
      window.dispatchEvent(new CustomEvent(INSUMOS_LEGACY_STOCK_EVENT, { detail: detail.stock }))
    } catch {
      // ignore
    }
  }
}

export function dispatchInsumosHeaderAction(action: InsumosHeaderAction) {
  try {
    window.dispatchEvent(new CustomEvent<InsumosHeaderAction>(INSUMOS_ACTION_EVENT, { detail: action }))
  } catch {
    // ignore
  }
  dispatchLegacyAction(action)
}

export function subscribeInsumosHeaderState(callback: (state: InsumosHeaderState | null) => void) {
  const handler = (event: Event) => {
    callback(normalizeInsumosHeaderState((event as CustomEvent<unknown>).detail))
  }
  window.addEventListener(INSUMOS_HEADER_EVENT, handler as EventListener)
  return () => window.removeEventListener(INSUMOS_HEADER_EVENT, handler as EventListener)
}

export function subscribeInsumosHeaderAction(callback: (action: InsumosHeaderAction) => void) {
  const typedHandler = (event: Event) => {
    const action = normalizeInsumosHeaderAction((event as CustomEvent<unknown>).detail)
    if (action) callback(action)
  }
  const legacyHandler = (event: Event) => {
    const action = normalizeInsumosHeaderAction((event as CustomEvent<unknown>).detail)
    if (action) callback(action)
  }

  window.addEventListener(INSUMOS_ACTION_EVENT, typedHandler as EventListener)
  window.addEventListener(INSUMOS_LEGACY_UNIT_EVENT, legacyHandler as EventListener)
  window.addEventListener(INSUMOS_LEGACY_OVERVIEW_EVENT, legacyHandler as EventListener)
  window.addEventListener(INSUMOS_LEGACY_OP_EVENT, legacyHandler as EventListener)
  window.addEventListener(INSUMOS_LEGACY_LAYOUT_EVENT, legacyHandler as EventListener)

  return () => {
    window.removeEventListener(INSUMOS_ACTION_EVENT, typedHandler as EventListener)
    window.removeEventListener(INSUMOS_LEGACY_UNIT_EVENT, legacyHandler as EventListener)
    window.removeEventListener(INSUMOS_LEGACY_OVERVIEW_EVENT, legacyHandler as EventListener)
    window.removeEventListener(INSUMOS_LEGACY_OP_EVENT, legacyHandler as EventListener)
    window.removeEventListener(INSUMOS_LEGACY_LAYOUT_EVENT, legacyHandler as EventListener)
  }
}
