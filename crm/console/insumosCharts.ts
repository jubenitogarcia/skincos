export type ChartPresetId = 'distribution' | 'movements' | 'roi_risk'
export type ChartMetric = 'qtd' | 'valor'
export type ChartView = 'bar' | 'line' | 'pie'
export type ChartLayout = 'square' | 'wide' | 'tall'
export type ChartGroupBy = 'categoria' | 'marca' | 'item' | 'tempo'
export type MovementsMode = 'inout' | 'saldo' | 'entrada' | 'saida'
export type ChartSlotConfig = {
  presetId: ChartPresetId
  metric?: ChartMetric
  view?: ChartView
  topN?: number
  groupBy?: ChartGroupBy
  mode?: MovementsMode
}

export type ChartPreset = {
  id: ChartPresetId
  label: string
  supportsMetric?: boolean
  supportsView?: boolean
  supportsTopN?: boolean
  defaultMetric?: ChartMetric
  defaultView?: ChartView
  layout?: ChartLayout
}

export type ChartSlotMeta = {
  preset: ChartPreset
  groupBy?: ChartGroupBy
  mode?: MovementsMode
  viewOptions: ChartView[]
  view: ChartView
  metric: ChartMetric
  topN: number
  showTopN: boolean
  layout?: ChartLayout
}

export type ChartFilterTipo = ChartPresetId | '__ALL__'
export type ChartFilterY = ChartGroupBy | '__ALL__'
export type ChartFilterX = ChartMetric | '__ALL__'
export type ChartFilterView = ChartView | '__ALL__'
export type ChartFilterTop = '5' | '8' | '10' | '15' | '__ALL__'

export const CHARTS_SLOTS_KEY = 'skincos.insumos.charts.slots.v1'
export const DEFAULT_CHART_SLOTS: ChartSlotConfig[] = [
  { presetId: 'distribution', groupBy: 'categoria', metric: 'qtd', view: 'pie', topN: 8 },
]
export const MAX_CHARTS = 9

export const CHART_PRESETS: ChartPreset[] = [
  { id: 'distribution', label: 'Distribuição', supportsMetric: true, supportsView: true, supportsTopN: true, defaultView: 'pie', layout: 'square' },
  { id: 'movements', label: 'Movimentações', supportsMetric: true, supportsView: true, supportsTopN: true, defaultView: 'bar', layout: 'wide' },
  { id: 'roi_risk', label: 'ROI (perdas & risco)', supportsMetric: true, supportsView: true, defaultView: 'bar', layout: 'square' },
]

export function normalizeChartTopN(value: unknown): number {
  return Math.max(5, Math.min(15, Number.parseInt(String(value ?? ''), 10) || 0)) || DEFAULT_CHART_SLOTS[0].topN || 8
}

export function resolveChartPreset(id: ChartPresetId): ChartPreset {
  return (
    CHART_PRESETS.find((preset) => preset.id === id) || {
      id,
      label: String(id),
      supportsMetric: false,
      supportsView: false,
      supportsTopN: false,
      defaultView: 'bar',
      layout: 'square',
    }
  )
}

export function resolveChartViewOptions(slot: ChartSlotConfig): ChartView[] {
  if (slot.presetId === 'distribution') {
    const groupBy = slot.groupBy === 'item' ? 'item' : slot.groupBy === 'marca' ? 'marca' : 'categoria'
    return groupBy === 'item' ? ['bar'] : ['pie', 'bar']
  }
  if (slot.presetId === 'movements') {
    const groupBy = slot.groupBy === 'categoria' ? 'categoria' : 'tempo'
    return groupBy === 'tempo' ? ['bar', 'line'] : ['bar', 'pie']
  }
  if (slot.presetId === 'roi_risk') return ['bar', 'pie']
  return ['bar', 'line']
}

export function resolveChartSlot(slot: ChartSlotConfig): ChartSlotMeta {
  const preset = resolveChartPreset(slot.presetId)
  const groupBy: ChartGroupBy | undefined =
    slot.presetId === 'distribution'
      ? slot.groupBy === 'marca' || slot.groupBy === 'item'
        ? slot.groupBy
        : 'categoria'
      : slot.presetId === 'movements'
        ? slot.groupBy === 'categoria'
          ? 'categoria'
          : 'tempo'
        : undefined
  const mode: MovementsMode | undefined =
    slot.presetId === 'movements'
      ? slot.mode === 'saldo' || slot.mode === 'entrada' || slot.mode === 'saida' || slot.mode === 'inout'
        ? slot.mode
        : groupBy === 'categoria'
          ? 'saida'
          : 'inout'
      : undefined
  const viewOptions = resolveChartViewOptions({ ...slot, groupBy, mode })
  const rawView = (slot.view || preset.defaultView || viewOptions[0] || 'bar') as ChartView
  const view = viewOptions.includes(rawView) ? rawView : viewOptions[0]
  const metric = (slot.metric === 'valor' ? 'valor' : 'qtd') as ChartMetric
  const topN = normalizeChartTopN(slot.topN)
  const showTopN = !!preset.supportsTopN && (slot.presetId === 'distribution' || (slot.presetId === 'movements' && groupBy === 'categoria'))
  return { preset, groupBy, mode, viewOptions, view, metric, topN, showTopN, layout: preset.layout }
}

export function parseChartSlots(raw: string | null | undefined): ChartSlotConfig[] {
  try {
    if (!raw) return DEFAULT_CHART_SLOTS
    const parsed = JSON.parse(raw)
    const slots = Array.isArray(parsed) ? parsed : []
    const validIds = new Set<ChartPresetId>(CHART_PRESETS.map((preset) => preset.id))
    const cleaned: ChartSlotConfig[] = slots
      .slice(0, MAX_CHARTS)
      .map((slotLike: any) => {
        const fallback = DEFAULT_CHART_SLOTS[0]
        const presetIdRaw = String(slotLike?.presetId || '')
        let presetId: ChartPresetId = fallback.presetId
        let groupBy: ChartGroupBy | undefined
        let mode: MovementsMode | undefined

        if (presetIdRaw === 'stock_category') {
          presetId = 'distribution'
          groupBy = 'categoria'
        } else if (presetIdRaw === 'stock_brand') {
          presetId = 'distribution'
          groupBy = 'marca'
        } else if (presetIdRaw === 'stock_top') {
          presetId = 'distribution'
          groupBy = 'item'
        } else if (presetIdRaw === 'mov_inout') {
          presetId = 'movements'
          groupBy = 'tempo'
          mode = 'inout'
        } else if (presetIdRaw === 'mov_saldo') {
          presetId = 'movements'
          groupBy = 'tempo'
          mode = 'saldo'
        } else if (presetIdRaw === 'trends_inout') {
          presetId = 'movements'
          groupBy = 'tempo'
          mode = 'inout'
        } else if (presetIdRaw === 'turnover_category') {
          presetId = 'movements'
          groupBy = 'categoria'
          mode = 'saida'
        } else if (validIds.has(presetIdRaw as ChartPresetId)) {
          presetId = presetIdRaw as ChartPresetId
          groupBy = slotLike?.groupBy || undefined
          mode = slotLike?.mode || undefined
        }

        if (!validIds.has(presetId)) presetId = fallback.presetId
        const preset = resolveChartPreset(presetId)
        const metric: ChartMetric | undefined = slotLike?.metric === 'valor' || slotLike?.metric === 'qtd' ? slotLike.metric : preset.defaultMetric
        const view: ChartView | undefined = slotLike?.view === 'bar' || slotLike?.view === 'line' || slotLike?.view === 'pie' ? slotLike.view : preset.defaultView
        const groupByFixed: ChartGroupBy | undefined = (() => {
          const value = String(groupBy || slotLike?.groupBy || '').trim()
          if (value === 'categoria' || value === 'marca' || value === 'item' || value === 'tempo') return value
          if (presetId === 'distribution') return 'categoria'
          if (presetId === 'movements') return 'tempo'
          return undefined
        })()
        const modeFixed: MovementsMode | undefined = (() => {
          const value = String(mode || slotLike?.mode || '').trim()
          if (value === 'inout' || value === 'saldo' || value === 'entrada' || value === 'saida') return value
          if (presetId === 'movements') return groupByFixed === 'categoria' ? 'saida' : 'inout'
          return undefined
        })()

        return {
          presetId,
          groupBy: groupByFixed,
          mode: modeFixed,
          metric,
          view,
          topN: normalizeChartTopN(slotLike?.topN),
        }
      })
    return cleaned.length ? cleaned : DEFAULT_CHART_SLOTS
  } catch {
    return DEFAULT_CHART_SLOTS
  }
}

export function updateChartSlotAt(prev: ChartSlotConfig[], idx: number, next: Partial<ChartSlotConfig>): ChartSlotConfig[] {
  const copy = [...prev]
  const current = copy[idx] || DEFAULT_CHART_SLOTS[0]
  const presetId = (next.presetId ?? current.presetId) as ChartPresetId
  const preset = resolveChartPreset(presetId)
  const metric = next.metric ?? current.metric ?? preset.defaultMetric
  const groupBy: ChartGroupBy | undefined = (() => {
    const value = String(next.groupBy ?? current.groupBy ?? '').trim()
    if (value === 'categoria' || value === 'marca' || value === 'item' || value === 'tempo') return value
    if (presetId === 'distribution') return 'categoria'
    if (presetId === 'movements') return 'tempo'
    return undefined
  })()
  const mode: MovementsMode | undefined = (() => {
    const value = String(next.mode ?? current.mode ?? '').trim()
    if (value === 'inout' || value === 'saldo' || value === 'entrada' || value === 'saida') return value
    if (presetId === 'movements') return groupBy === 'categoria' ? 'saida' : 'inout'
    return undefined
  })()
  const view = next.view ?? current.view ?? preset.defaultView
  const topN = next.topN ?? current.topN
  copy[idx] = { ...current, ...next, presetId, groupBy, mode, metric, view, topN }
  return copy
}

export function filterChartSlotsView(args: {
  chartSlots: ChartSlotConfig[]
  chartsFilterTipo: ChartFilterTipo
  chartsFilterY: ChartFilterY
  chartsFilterX: ChartFilterX
  chartsFilterView: ChartFilterView
  chartsFilterTop: ChartFilterTop
  chartsSearch: string
}) {
  const { chartSlots, chartsFilterTipo, chartsFilterY, chartsFilterX, chartsFilterView, chartsFilterTop, chartsSearch } = args
  const search = chartsSearch.trim().toLowerCase()
  return chartSlots
    .map((slot, idx) => ({ slot, idx, meta: resolveChartSlot(slot) }))
    .filter(({ slot, meta }) => {
      if (chartsFilterTipo !== '__ALL__' && slot.presetId !== chartsFilterTipo) return false
      if (chartsFilterY !== '__ALL__' && meta.groupBy !== chartsFilterY) return false
      if (chartsFilterX !== '__ALL__' && meta.metric !== chartsFilterX) return false
      if (chartsFilterView !== '__ALL__' && meta.view !== chartsFilterView) return false
      if (chartsFilterTop !== '__ALL__' && String(meta.topN) !== String(chartsFilterTop)) return false
      if (!search) return true
      const hay = [meta.preset.label, slot.presetId, meta.groupBy || '', meta.metric, meta.view, meta.mode || '', String(meta.topN)]
        .join(' ')
        .toLowerCase()
      return hay.includes(search)
    })
}

export function getChartIndexFromKey(cardKey: string): number {
  const idx = Number.parseInt(String(cardKey), 10)
  return Number.isInteger(idx) && idx >= 0 ? idx : -1
}

export function getNextChartPresetPatch(slot: ChartSlotConfig, value: string): Partial<ChartSlotConfig> {
  const nextId = value as ChartPresetId
  const nextPreset = resolveChartPreset(nextId)
  const baseNext: ChartSlotConfig = {
    ...slot,
    presetId: nextId,
    groupBy: nextId === 'distribution' ? 'categoria' : nextId === 'movements' ? 'tempo' : undefined,
    mode: nextId === 'movements' ? 'inout' : undefined,
  }
  const nextViewOptions = resolveChartViewOptions(baseNext)
  const presetDefault = nextPreset.defaultView as ChartView | undefined
  const nextView = nextViewOptions.includes(presetDefault || 'bar') ? (presetDefault as ChartView) : nextViewOptions[0]
  return { presetId: nextId, groupBy: baseNext.groupBy, mode: baseNext.mode, view: nextView }
}

export function getNextDistributionGroupByPatch(slot: ChartSlotConfig, value: 'categoria' | 'marca' | 'item'): Partial<ChartSlotConfig> {
  const nextGroupBy = value as ChartGroupBy
  const baseNext: ChartSlotConfig = { ...slot, groupBy: nextGroupBy }
  const nextViewOptions = resolveChartViewOptions(baseNext)
  const currentView = resolveChartSlot(slot).view
  const nextView = nextViewOptions.includes(currentView) ? currentView : nextViewOptions[0]
  return { groupBy: nextGroupBy, view: nextView }
}

export function getNextMovementsGroupByPatch(slot: ChartSlotConfig, value: 'tempo' | 'categoria'): Partial<ChartSlotConfig> {
  const nextGroupBy = value === 'categoria' ? ('categoria' as ChartGroupBy) : ('tempo' as ChartGroupBy)
  const nextMode: MovementsMode = nextGroupBy === 'categoria' ? 'saida' : 'inout'
  const baseNext: ChartSlotConfig = { ...slot, groupBy: nextGroupBy, mode: nextMode }
  const nextViewOptions = resolveChartViewOptions(baseNext)
  const currentView = resolveChartSlot(slot).view
  const nextView = nextViewOptions.includes(currentView) ? currentView : nextViewOptions[0]
  return { groupBy: nextGroupBy, mode: nextMode, view: nextView }
}

export function getNextMovementsModePatch(value: 'inout' | 'saldo' | 'entrada' | 'saida'): Partial<ChartSlotConfig> {
  const nextMode: MovementsMode = value === 'saldo' || value === 'entrada' || value === 'saida' || value === 'inout' ? value : 'inout'
  return { mode: nextMode }
}
