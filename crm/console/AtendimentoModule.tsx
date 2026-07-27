import React, { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { DragDropContext, Draggable, Droppable, type DraggableProvidedDragHandleProps, type DropResult } from '@hello-pangea/dnd'
import {
  AlertTriangle,
  AreaChart as AreaChartIcon,
  ArrowDownToLine,
  ArrowUpToLine,
  BarChart3,
  Calculator,
  CalendarRange,
  ChevronDown,
  ChevronUp,
  Crosshair,
  Divide,
  Download,
  Eye,
  EyeOff,
  Gauge,
  GripVertical,
  Info,
  LineChart as LineChartIcon,
  Percent,
  Plus,
  RefreshCw,
  Ruler,
  Sigma,
  Stethoscope,
  Target,
  Trash2,
  TrendingUp,
  Trophy,
  Users,
  type LucideIcon,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '@/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/dialog'
import { Input } from '@/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { Switch } from '@/switch'
import { TooltipLabel } from '@/tooltip'
import {
  calculateAtendimentoValue,
  DEFAULT_ATENDIMENTO_FILTERS,
  EMPTY_ATENDIMENTO_FORM,
  determineAtendimentoShift,
  filterProfessionalsByUnitRole,
  formatCurrencyBRL,
  formatNumberBR,
  normalizeCode,
  parseBrazilCurrency,
  validateAtendimentoForm,
  type AtendimentoFilters,
  type AtendimentoForm,
} from '@/atendimentoDomain'
import {
  createAtendimentoAttendance,
  deleteAtendimentoAttendance,
  fetchAtendimentoAttendances,
  fetchAtendimentoDoctorSuggestion,
  fetchAtendimentoLocalMirrorStatus,
  fetchAtendimentoManagementCatalog,
  fetchAtendimentoManagementConversionReport,
  fetchAtendimentoOverview,
  fetchAtendimentoReportPreview,
  fetchAtendimentoReferences,
  importGerenciaGoogleSheet,
  updateAtendimentoAttendance,
  type AtendimentoAttendance,
  type AtendimentoOverview,
  type AtendimentoReferences,
  type AtendimentoReportPreview,
  type AtendimentoManagementCatalog,
  type AtendimentoManagementConversionReport,
  type AtendimentoLocalMirrorStatus,
} from '@/atendimentoApi'
import { AtendimentoChartsPanel } from '@/atendimentoCharts'
import { AtendimentoClientAutocomplete } from '@/atendimentoClientAutocomplete'
import { AtendimentoDatePicker } from '@/AtendimentoDatePicker'
import { atendimentoColorWithAlpha, atendimentoProfessionalColor } from '@/atendimentoVisuals'
import { useAtendimentoHeaderBridge } from '@/useAtendimentoHeaderBridge'
import { useAuth } from '@/contexts'
import { isAtendimentoManager, normalizeCrmRole } from '@/authPolicy'

function monthLabel(value: string) {
  const [year, month] = String(value || '').split('-').map(Number)
  if (!year || !month) return value
  const label = new Date(year, month - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
  return label.replace('.', '')
}

function asForm(row: AtendimentoAttendance): AtendimentoForm {
  return {
    id: row.id,
    revision: row.revision,
    unitSlug: row.unitSlug,
    unitName: row.unitName,
    date: row.date,
    clientName: row.clientName,
    procedureName: row.procedureName,
    code: row.code,
    quantity: row.quantity,
    discount: row.discount,
    otherValue: row.otherValue,
    roundValue: row.roundValue,
    value: row.value,
    injectorId: row.injectorId || null,
    consultantId: row.consultantId || null,
    injectorName: row.injectorName,
    consultantName: row.consultantName,
    observation: row.observation || '',
  }
}

function professionalIdentityPatch(
  professionals: AtendimentoReferences['professionals'],
  field: 'injector' | 'consultant',
  name: string,
) {
  const professional = professionals.find((item) => item.name === name)
  const id = professional?.canonicalId || professional?.id || null
  return field === 'injector'
    ? { injectorName: name, injectorId: id }
    : { consultantName: name, consultantId: id }
}

function hasAtendimentoInlineDraft(form: AtendimentoForm) {
  return Boolean(
    form.clientName ||
    form.procedureName ||
    form.injectorName ||
    form.consultantName ||
    form.observation ||
    form.discount ||
    form.roundValue ||
    form.otherValue ||
    form.quantity !== 1
  )
}

function createIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `atendimento-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const panelClass = 'border-slate-800/80 bg-slate-950/60 shadow-[0_20px_80px_rgba(2,6,23,0.35)] backdrop-blur-xl'
const ATENDIMENTO_METRIC_LAYOUT_KEY = 'skincos.atendimento.layout.metrics.v2'
const ATENDIMENTO_CHART_LAYOUT_KEY = 'skincos.atendimento.layout.charts.v3'
const ATENDIMENTO_ANALYSIS_EXPANDED_KEY = 'skincos.atendimento.analysis.expanded.v1'
const ATTENDANCE_PAGE_SIZE = 50
const DEFAULT_UNIT_LEGEND = [
  { slug: 'novo-hamburgo', name: 'Novo Hamburgo' },
  { slug: 'barra-shopping-sul', name: 'BarraShoppingSul' },
]

type AtendimentoMetricKey = string
type AtendimentoMetricLayoutItem = { key: AtendimentoMetricKey; visible: boolean }
type AtendimentoMetricTone = 'sky' | 'emerald' | 'amber' | 'violet'
type AtendimentoMetricTileConfig = {
  key: AtendimentoMetricKey
  label: string
  subtitle?: string
  value: string
  detail: string
  icon: LucideIcon
  tone: AtendimentoMetricTone
  description?: string
  badge?: React.ReactNode
  progress?: number
  content?: React.ReactNode
  wrapperClassName?: string
}
type AtendimentoMetricGroupRow = {
  key: string
  label: string
  value: string
  detail?: string
  calculation?: string
  tooltip?: MetricTooltipSpec
  icon: LucideIcon
  tone: AtendimentoMetricTone
  avatarUrl?: string | null
  presentation?: 'detail'
}
type AtendimentoMetricHierarchyNode = {
  key: string
  children?: AtendimentoMetricHierarchyNode[]
}
type MetricTooltipSpec = {
  what: string
  calculation: string
  usage: string
  details?: Array<{
    label: string
    value: string
    what?: string
    calculation?: string
    usage?: string
  }>
}
type ConversionGoalPlan = NonNullable<NonNullable<AtendimentoManagementConversionReport['doctorRanking']>['sections'][number]['goalPlan']>
type ConversionRankingSection = NonNullable<AtendimentoManagementConversionReport['doctorRanking']>['sections'][number]
type ConversionDoctorMetric = ConversionRankingSection['doctors'][number]

type AtendimentoSortKey = 'date' | 'clientName' | 'procedureName' | 'injectorName' | 'consultantName' | 'value'
type AtendimentoSortDir = 'asc' | 'desc'
type AtendimentoChartPreset = 'monthly' | 'ticket' | 'procedures' | 'injectors' | 'consultants'
type AtendimentoChartMetric = 'value' | 'count'
type AtendimentoChartView = 'area' | 'line' | 'bar'
type AtendimentoChartSlot = {
  presetId: AtendimentoChartPreset
  metric: AtendimentoChartMetric
  view: AtendimentoChartView
  topN: number
}

function atendimentoUnitVisual(unitSlugOrName: string) {
  const key = String(unitSlugOrName || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (key.includes('barrashopping')) {
    return {
      label: 'BarraShoppingSul',
      dotClassName: 'bg-rose-400 shadow-[0_0_18px_rgba(251,113,133,0.45)]',
      badgeClassName: 'border-rose-300/30 bg-rose-400/10 text-rose-100',
      rowClassName: 'bg-rose-500/[0.055] hover:bg-rose-500/[0.105]',
      cellClassName: 'bg-rose-500/[0.045] group-hover:bg-rose-500/[0.095]',
      stickyClassName: 'bg-[rgb(25,9,22)] group-hover:bg-[rgb(38,13,31)]',
      stripeClassName: 'bg-rose-400',
    }
  }
  if (key.includes('novohamburgo')) {
    return {
      label: 'Novo Hamburgo',
      dotClassName: 'bg-sky-400 shadow-[0_0_18px_rgba(56,189,248,0.45)]',
      badgeClassName: 'border-sky-300/30 bg-sky-400/10 text-sky-100',
      rowClassName: 'bg-sky-500/[0.055] hover:bg-sky-500/[0.105]',
      cellClassName: 'bg-sky-500/[0.045] group-hover:bg-sky-500/[0.095]',
      stickyClassName: 'bg-[rgb(7,19,39)] group-hover:bg-[rgb(9,31,59)]',
      stripeClassName: 'bg-sky-400',
    }
  }
  return {
    label: unitSlugOrName || 'Unidade',
    dotClassName: 'bg-slate-400',
    badgeClassName: 'border-slate-600 bg-slate-800/60 text-slate-200',
    rowClassName: 'hover:bg-slate-900/70',
    cellClassName: '',
    stickyClassName: 'bg-slate-950/95',
    stripeClassName: 'bg-slate-500',
  }
}

const DEFAULT_ATENDIMENTO_METRIC_LAYOUT: AtendimentoMetricLayoutItem[] = [
  { key: 'revenue', visible: true },
  { key: 'ticket', visible: true },
  { key: 'clients', visible: true },
]

const DEFAULT_ATENDIMENTO_CHART_SLOTS: AtendimentoChartSlot[] = [
  { presetId: 'monthly', metric: 'value', view: 'area', topN: 8 },
  { presetId: 'ticket', metric: 'value', view: 'line', topN: 8 },
  { presetId: 'procedures', metric: 'value', view: 'bar', topN: 5 },
  { presetId: 'injectors', metric: 'value', view: 'bar', topN: 5 },
  { presetId: 'consultants', metric: 'value', view: 'bar', topN: 5 },
]

const ATENDIMENTO_CHART_PRESETS: Array<{ id: AtendimentoChartPreset; label: string; icon: LucideIcon }> = [
  { id: 'monthly', label: 'Série mensal', icon: TrendingUp },
  { id: 'ticket', label: 'Ticket médio', icon: TrendingUp },
  { id: 'procedures', label: 'Procedimentos', icon: BarChart3 },
  { id: 'injectors', label: 'Injetores', icon: Stethoscope },
  { id: 'consultants', label: 'Consultores', icon: Users },
]

const ATENDIMENTO_CHART_VIEWS: Array<{ id: AtendimentoChartView; label: string; icon: LucideIcon }> = [
  { id: 'area', label: 'Área', icon: AreaChartIcon },
  { id: 'line', label: 'Linha', icon: LineChartIcon },
  { id: 'bar', label: 'Barras', icon: BarChart3 },
]

function parseAtendimentoMetricLayout(raw: string | null): AtendimentoMetricLayoutItem[] {
  try {
    const parsed = raw ? JSON.parse(raw) : null
    if (!Array.isArray(parsed)) return DEFAULT_ATENDIMENTO_METRIC_LAYOUT
    const seen = new Set<string>()
    const normalized: AtendimentoMetricLayoutItem[] = []
    for (const item of parsed) {
      const key = String(item?.key || '').trim()
      if (!key || seen.has(key)) continue
      seen.add(key)
      normalized.push({ key, visible: item?.visible !== false })
    }
    return normalized.length ? normalized : DEFAULT_ATENDIMENTO_METRIC_LAYOUT
  } catch {
    return DEFAULT_ATENDIMENTO_METRIC_LAYOUT
  }
}

function parseAtendimentoChartSlots(raw: string | null): AtendimentoChartSlot[] {
  try {
    const parsed = raw ? JSON.parse(raw) : null
    if (!Array.isArray(parsed)) return DEFAULT_ATENDIMENTO_CHART_SLOTS
    const validPresets = new Set(ATENDIMENTO_CHART_PRESETS.map((preset) => preset.id))
    const validViews = new Set(ATENDIMENTO_CHART_VIEWS.map((view) => view.id))
    const cleaned = parsed.slice(0, 6).map((item) => {
      const fallback = DEFAULT_ATENDIMENTO_CHART_SLOTS[0]
      const presetId = validPresets.has(item?.presetId) ? item.presetId as AtendimentoChartPreset : fallback.presetId
      const metric: AtendimentoChartMetric = item?.metric === 'count' ? 'count' : 'value'
      const view = validViews.has(item?.view) ? item.view as AtendimentoChartView : (presetId === 'monthly' ? 'area' : 'bar')
      const topN = Math.max(3, Math.min(12, Number(item?.topN) || fallback.topN))
      const layout = item?.layout === 'compact' || item?.layout === 'wide' ? item.layout : 'standard'
      return { presetId, metric, view, topN, layout, collapsed: item?.collapsed === true }
    })
    return cleaned.length ? cleaned : DEFAULT_ATENDIMENTO_CHART_SLOTS
  } catch {
    return DEFAULT_ATENDIMENTO_CHART_SLOTS
  }
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-amber-400/30 bg-amber-500/12 p-3 text-sm text-amber-100 shadow-[0_12px_36px_rgba(245,158,11,0.12)]">
      <AlertTriangle className="mr-2 inline h-4 w-4" />
      {message}
    </div>
  )
}

function LoadingOverlay({ label }: { label: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-start justify-end rounded-[inherit] bg-slate-950/20 p-3">
      <div className="inline-flex items-center gap-2 rounded-full border border-sky-400/25 bg-slate-950/85 px-3 py-1.5 text-xs font-medium text-sky-100 shadow-[0_12px_32px_rgba(14,165,233,0.16)] backdrop-blur-md">
        <RefreshCw className="h-3.5 w-3.5 animate-spin text-sky-300" />
        {label}
      </div>
    </div>
  )
}

const IconOnlyAction = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  description?: string
  tooltipAlign?: 'left' | 'right'
  children: React.ReactNode
}>(({
  label,
  description,
  tooltipAlign: _tooltipAlign = 'left',
  children,
  className = '',
  type = 'button',
  ...buttonProps
}, ref) => {
  return (
    <TooltipLabel label={label} description={description}>
      <button
        ref={ref}
        type={type}
        aria-label={label}
        className={`inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-700 bg-slate-900/60 text-slate-100 transition hover:border-sky-400/40 hover:bg-slate-800/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/55 ${className}`}
        {...buttonProps}
      >
        {children}
      </button>
    </TooltipLabel>
  )
})
IconOnlyAction.displayName = 'IconOnlyAction'

function SortableAttendanceHead({
  sortKey,
  label,
  align = 'center',
  activeKey,
  sortDir,
  onSort,
  children,
  className = '',
  stickyLeft = false,
  testId,
  action,
}: {
  sortKey: AtendimentoSortKey
  label: string
  align?: 'left' | 'center' | 'right'
  activeKey: AtendimentoSortKey
  sortDir: AtendimentoSortDir
  onSort: (key: AtendimentoSortKey) => void
  children?: React.ReactNode
  className?: string
  stickyLeft?: boolean
  testId?: string
  action?: React.ReactNode
}) {
  const isActive = activeKey === sortKey
  return (
    <th
      className={`${stickyLeft ? 'sticky left-0 top-0 z-40 shadow-[1px_0_0_rgba(30,41,59,0.9)]' : 'sticky top-0 z-30'} h-12 border-b border-slate-800 bg-slate-950 px-3 align-middle font-medium text-slate-300 ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'} ${className}`}
      data-testid={testId}
    >
      <div className={`flex min-w-0 items-center gap-1 ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'}`}>
        <button
          type="button"
          className={`inline-flex max-w-full select-none items-center gap-1.5 rounded-sm px-0.5 text-xs leading-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/40 ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'} ${isActive ? 'text-white' : 'text-blue-100/80'} hover:underline`}
          onClick={() => onSort(sortKey)}
          aria-label={`Ordenar ${label}`}
        >
          <span className="min-w-0">
            <span className="block truncate">{label}</span>
            {children}
          </span>
          <span className={`inline-flex shrink-0 items-center justify-center ${isActive ? 'text-white' : 'text-blue-100/30'}`} aria-hidden>
            {isActive && sortDir === 'asc' ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
        </button>
        {action}
      </div>
    </th>
  )
}

function metricToneClass(tone: AtendimentoMetricTone) {
  return tone === 'emerald'
    ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100'
    : tone === 'amber'
      ? 'border-amber-400/25 bg-amber-400/10 text-amber-100'
      : tone === 'violet'
        ? 'border-violet-400/25 bg-violet-400/10 text-violet-100'
        : 'border-sky-400/25 bg-sky-400/10 text-sky-100'
}

function metricProgressClass(tone: AtendimentoMetricTone) {
  return tone === 'emerald'
    ? 'bg-emerald-300'
    : tone === 'amber'
      ? 'bg-amber-300'
      : tone === 'violet'
        ? 'bg-violet-300'
        : 'bg-sky-300'
}

function MetricTooltipContent({ info }: { info: MetricTooltipSpec }) {
  return (
    <div className="space-y-1 text-left">
      <div><span className="font-semibold text-slate-100">O que é:</span> {info.what}</div>
      {info.details?.length ? (
        <div>
          <div><span className="font-semibold text-slate-100">Cálculo da métrica:</span> {info.calculation}</div>
          <span className="font-semibold text-slate-100">Componentes:</span>
          <div className="mt-1 max-h-[22rem] space-y-2 overflow-y-auto pr-1">
            {info.details.map((detail) => (
              <div key={`${detail.label}:${detail.value}`} className="rounded border border-slate-700/70 bg-slate-900/50 px-2 py-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-slate-300">{detail.label}</span>
                  <span className="shrink-0 font-semibold tabular-nums text-slate-100">{detail.value}</span>
                </div>
                {detail.what ? <div className="mt-1 text-[10px] leading-snug text-slate-400"><span className="font-semibold text-slate-300">O que é:</span> {detail.what}</div> : null}
                {detail.calculation ? <div className="mt-1 text-[10px] leading-snug text-slate-500"><span className="font-semibold text-slate-300">Cálculo:</span> {detail.calculation}</div> : null}
                {detail.usage ? <div className="mt-1 text-[10px] leading-snug text-slate-500"><span className="font-semibold text-slate-300">Uso:</span> {detail.usage}</div> : null}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div><span className="font-semibold text-slate-100">Cálculo:</span> {info.calculation}</div>
      )}
      <div><span className="font-semibold text-slate-100">Uso:</span> {info.usage}</div>
    </div>
  )
}

function MetricTooltip({
  label,
  info,
  children,
  contentClassName,
}: {
  label: string
  info?: MetricTooltipSpec
  children: React.ReactNode
  contentClassName?: string
}) {
  if (!info) return <>{children}</>
  return (
    <TooltipLabel
      label={label}
      description={<MetricTooltipContent info={info} />}
      contentClassName={contentClassName || 'max-w-[22rem]'}
    >
      {children}
    </TooltipLabel>
  )
}

function ConversionMultiplierDetails({
  optimization,
}: {
  optimization: NonNullable<ConversionRankingSection['optimization']>
}) {
  const curve = Array.isArray(optimization.homogeneityCurve) ? optimization.homogeneityCurve : []
  const chartData = curve.map((segment) => ({
    k: Number(segment.start),
    homogeneity: Number(segment.homogeneityScore || 0),
    counts: segment.counts,
    end: Number(segment.end),
  }))
  const finalSegment = curve[curve.length - 1]
  if (finalSegment && finalSegment.end > finalSegment.start) {
    chartData.push({
      k: Number(finalSegment.end),
      homogeneity: Number(finalSegment.homogeneityScore || 0),
      counts: finalSegment.counts,
      end: Number(finalSegment.end),
    })
  }
  const formatK = (number: number | null | undefined, digits = 3) => number == null
    ? 'Não aplicável'
    : `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits }).format(number)}x`
  const reasonCopy: Record<string, string> = {
    previous_in_optimal_plateau: 'O valor anterior permanece dentro de um platô ótimo.',
    widest_optimal_plateau_center: 'Selecionado no centro do maior platô ótimo para maximizar a tolerância a pequenas variações.',
    optimal_singleton: 'O ótimo é um ponto isolado dentro dos limites configurados.',
    not_applicable: 'Não há dados ou variância suficientes para definir um multiplicador.',
  }
  const selectedCounts = optimization.optimalPlateau?.counts || { level0: 0, level1: 0, level2: 0, level3: 0 }
  const status = CONVERSION_STATUS_COPY[optimization.statusCode || ''] || CONVERSION_STATUS_COPY.BEST_EFFORT
  const selectedTotal = Math.max(0, selectedCounts.level0 + selectedCounts.level1 + selectedCounts.level2 + selectedCounts.level3)
  const selectedHomogeneity = Number(optimization.optimalPlateau?.homogeneityScore ?? optimization.homogeneityScore ?? 0)
  const groupedDistribution = CONVERSION_DISTRIBUTION_GROUP_VISUAL.map((group) => ({
    ...group,
    count: group.levels.reduce((total, level) => total + selectedCounts[`level${level}` as keyof typeof selectedCounts], 0),
  }))
  const calculationBasis = (
    <div className="mt-2 border-t border-slate-700/80 pt-2 text-[10px] text-slate-300">
      <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">Base da seleção</div>
      <div className="grid gap-1">
        <div className="flex items-center justify-between gap-3"><span>Homogeneidade</span><span className="font-semibold tabular-nums text-emerald-200">{new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 }).format(selectedHomogeneity)}</span></div>
        <div className="flex items-center justify-between gap-3"><span>Platô ótimo</span><span className="font-semibold tabular-nums text-sky-200">{optimization.optimalPlateau ? `${formatK(optimization.optimalPlateau.start, 3)}–${formatK(optimization.optimalPlateau.end, 3)}` : '—'}</span></div>
        <div className="flex items-center justify-between gap-3"><span>k anterior</span><span className="font-semibold tabular-nums text-slate-100">{formatK(optimization.previousIntervalMultiplier)}</span></div>
      </div>
    </div>
  )
  const selectedDistributionCopy = (
    <div className="space-y-1.5">
      <div><span className="font-medium text-slate-100">{status.label}.</span> {status.description}</div>
      <div>{reasonCopy[optimization.selectionReason] || optimization.selectionReason}</div>
      {optimization.optimalPlateau ? <div className="text-slate-400">Platô: {formatK(optimization.optimalPlateau.start, 5)} até {formatK(optimization.optimalPlateau.end, 5)}{optimization.optimalPlateau.endInclusive ? ' (inclusivo)' : ' (fim exclusivo)'}.</div> : null}
      {calculationBasis}
    </div>
  )
  return (
    <section
      className="min-w-0 rounded-xl border border-slate-800/80 bg-slate-950/40 p-3"
      data-testid="atendimento-multiplier-details"
      aria-label="Detalhes do multiplicador por homogeneidade"
    >
      <div className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="inline-flex items-center gap-1 text-sm font-semibold text-white">
                <span>Multiplicador por homogeneidade</span>
                <TooltipLabel
                  pinOnClick
                  label="Como funciona o multiplicador por homogeneidade"
                  description={(
                    <div className="space-y-1.5">
                      <p>k regula a largura simétrica das faixas em torno da linha de corte: limite inferior = corte − desvio padrão × k; limite superior = corte + desvio padrão × k.</p>
                      <p>A curva avalia cada intervalo que muda a classificação dos doutores e escolhe o platô com a distribuição mais homogênea entre quatro níveis. O desempate preserva o k anterior quando ele ainda pertence ao platô ótimo.</p>
                      <p className="text-slate-400">Faixa avaliada nesta análise: k de {formatK(optimization.intervalMultiplierMin, 2)} a {formatK(optimization.intervalMultiplierMax, 2)}. O teto é calculado no backend por linha de corte ÷ desvio padrão, garantindo que desvio padrão × k nunca ultrapasse a linha de corte.</p>
                      {calculationBasis}
                    </div>
                  )}
                  contentClassName="max-w-[24rem]"
                >
                    <button
                      type="button"
                      className="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-500 transition hover:bg-sky-400/10 hover:text-sky-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50"
                      aria-label="Como funciona o multiplicador por homogeneidade"
                      data-testid="atendimento-multiplier-info-trigger"
                      data-tooltip-pin="true"
                    >
                      <Info className="h-3.5 w-3.5" />
                    </button>
                </TooltipLabel>
              </div>
            </div>
            <TooltipLabel label={`Multiplicador selecionado: ${formatK(optimization.selectedMultiplier, 5)}`} description={selectedDistributionCopy} contentClassName="max-w-sm">
              <div className="rounded-lg px-1.5 py-1 text-right" data-testid="atendimento-multiplier-selected-value" aria-label="Detalhes da seleção do multiplicador">
                <span className="block text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">Selecionado</span>
                <span className="block text-base font-semibold tabular-nums text-sky-200">{formatK(optimization.selectedMultiplier, 5)}</span>
              </div>
            </TooltipLabel>
          </div>
          {chartData.length > 0 ? (
            <div className="h-48 rounded-xl border border-slate-800 bg-slate-900/45 p-2" aria-label="Curva do multiplicador pela homogeneidade">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 12, left: -14, bottom: 2 }}>
                  <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
                  <XAxis
                    dataKey="k"
                    type="number"
                    domain={[optimization.intervalMultiplierMin, optimization.intervalMultiplierMax]}
                    tick={{ fill: '#94a3b8', fontSize: 10 }}
                    tickFormatter={(number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(Number(number))}
                  />
                  <YAxis
                    domain={[0, 1]}
                    ticks={[0, 0.5, 1]}
                    tick={{ fill: '#94a3b8', fontSize: 10 }}
                    tickFormatter={(number) => `${Math.round(Number(number) * 100)}%`}
                  />
                  {(optimization.optimalPlateaus || []).map((plateau, index) => (
                    <ReferenceArea key={`${plateau.start}-${plateau.end}-${index}`} x1={plateau.start} x2={plateau.end} fill="rgba(16,185,129,0.17)" stroke="rgba(52,211,153,0.34)" />
                  ))}
                  {optimization.previousIntervalMultiplier != null ? (
                    <ReferenceLine x={optimization.previousIntervalMultiplier} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: 'anterior', fill: '#fbbf24', fontSize: 9, position: 'insideTopLeft' }} />
                  ) : null}
                  {optimization.selectedMultiplier != null ? (
                    <ReferenceLine x={optimization.selectedMultiplier} stroke="#38bdf8" strokeWidth={2} label={{ value: 'selecionado', fill: '#7dd3fc', fontSize: 9, position: 'insideTopRight' }} />
                  ) : null}
                  <RechartsTooltip
                    content={({ active, payload }) => {
                      const point = payload?.[0]?.payload
                      if (!active || !point) return null
                      const counts = point.counts || {}
                      return (
                        <div className="rounded-lg border border-slate-700 bg-slate-950/98 px-2.5 py-2 text-[10px] shadow-xl">
                          <div className="font-semibold text-white">k {formatK(point.k, 5)} até {formatK(point.end, 5)}</div>
                          <div className="mt-1 text-emerald-200">H {new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 }).format(point.homogeneity)}</div>
                          <div className="mt-1 text-slate-400">N0 {counts.level0 || 0} · N1 {counts.level1 || 0} · N2 {counts.level2 || 0} · N3 {counts.level3 || 0}</div>
                          {calculationBasis}
                        </div>
                      )
                    }}
                  />
                  <Line type="stepAfter" dataKey="homogeneity" stroke="#38bdf8" strokeWidth={2.25} dot={{ r: 2, fill: '#bae6fd' }} activeDot={{ r: 4 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="rounded-xl border border-amber-400/20 bg-amber-400/8 px-3 py-4 text-xs text-amber-100">Multiplicador não aplicável para este período.</div>
          )}
          <div className="border-t border-slate-800 pt-3">
            <div className="grid grid-cols-2 gap-1.5" data-testid="atendimento-multiplier-distribution-groups">
              {groupedDistribution.map((group) => {
                const proportion = selectedTotal > 0 ? group.count / selectedTotal : 0
                const GroupIcon = group.icon
                return (
                  <TooltipLabel key={group.key} label={group.label} description={`${group.label}: ${new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 }).format(proportion)}. ${group.levels.map((level) => `${conversionLevelVisual(level).label}: ${formatNumberBR(selectedCounts[`level${level}` as keyof typeof selectedCounts])}/${formatNumberBR(selectedTotal)}`).join(' · ')}.`}>
                    <span className="cursor-help rounded-lg border border-slate-800 bg-slate-900/45 px-2 py-1.5">
                      <span className={`flex items-center gap-1 ${group.tone} text-[11px] font-semibold`}>
                        <GroupIcon className="h-3 w-3" aria-hidden="true" />
                        <span>{group.label}: {new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 0 }).format(proportion)}</span>
                      </span>
                      <span className="mt-1 grid gap-0.5" data-testid={`atendimento-multiplier-group-${group.key}-levels`} aria-label={`${group.label}: ${new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 0 }).format(proportion)}; ${group.levels.map((level) => `${conversionLevelVisual(level).label}: ${formatNumberBR(selectedCounts[`level${level}` as keyof typeof selectedCounts])}/${formatNumberBR(selectedTotal)}`).join('; ')}`}>
                        {group.levels.map((level) => {
                          const LevelIcon = CONVERSION_METRIC_ICON_BY_KEY[`level${level}` as ConversionMetricKey]
                          const levelCount = selectedCounts[`level${level}` as keyof typeof selectedCounts]
                          return (
                            <span key={level} className={`flex items-center gap-1 ${group.tone} text-[10px] tabular-nums`}>
                              <span className="inline-flex h-4 w-4 items-center justify-center rounded-md border border-current/30 bg-slate-950/35"><LevelIcon className="h-2.5 w-2.5" /></span>
                              <span>{conversionLevelVisual(level).label}: {formatNumberBR(levelCount)}/{formatNumberBR(selectedTotal)}</span>
                            </span>
                          )
                        })}
                      </span>
                    </span>
                  </TooltipLabel>
                )
              })}
            </div>
          </div>
      </div>
    </section>
  )
}

function MetricGroupContent({
  rows,
  hierarchy,
}: {
  rows: AtendimentoMetricGroupRow[]
  hierarchy?: AtendimentoMetricHierarchyNode[]
}) {
  const rowsByKey = new Map(rows.map((row) => [row.key, row]))
  const hierarchyKeys = new Set<string>()
  const registerHierarchyKeys = (nodesToRegister: AtendimentoMetricHierarchyNode[] = []) => {
    for (const node of nodesToRegister) {
      hierarchyKeys.add(node.key)
      registerHierarchyKeys(node.children)
    }
  }
  registerHierarchyKeys(hierarchy)
  const nodes = hierarchy?.length
    ? [...hierarchy, ...rows.filter((row) => !hierarchyKeys.has(row.key)).map((row) => ({ key: row.key }))]
    : rows.map((row) => ({ key: row.key }))

  const renderRow = (row: AtendimentoMetricGroupRow, isChild = false, componentRows: AtendimentoMetricGroupRow[] = []) => {
    const RowIcon = row.icon
    const isDetail = row.presentation === 'detail'
    const componentTooltip: MetricTooltipSpec | undefined = componentRows.length ? {
      what: `Componentes usados para calcular ${row.label}.`,
      calculation: row.tooltip?.calculation || row.calculation || 'Confira os valores atuais de cada insumo abaixo.',
      usage: 'Clique no subtítulo novamente para manter esta conferência aberta.',
      details: componentRows.map((component) => ({
        label: component.label,
        value: component.value,
        what: component.tooltip?.what,
        calculation: component.tooltip?.calculation || component.calculation,
        usage: component.tooltip?.usage,
      })),
    } : undefined
    const rowContent = (
      <div className={`flex min-w-0 items-center gap-2 ${isChild ? 'py-0.5' : ''}`}>
        {row.avatarUrl ? (
          <img
            src={row.avatarUrl}
            alt=""
            className="h-5 w-5 shrink-0 rounded-full border border-slate-600/90 object-cover"
            onError={(event) => { event.currentTarget.style.display = 'none' }}
          />
        ) : (
          <span
            className={`inline-flex ${isDetail ? 'h-4 w-4' : 'h-5 w-5'} shrink-0 items-center justify-center rounded-md border ${metricToneClass(row.tone)}`}
            aria-hidden="true"
          >
            <RowIcon className={isDetail ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <span className={`inline-flex max-w-full items-center gap-1 truncate ${isDetail ? 'text-[10px] font-medium text-slate-500' : `text-[11px] ${isChild ? 'font-medium text-slate-400' : 'font-semibold text-slate-200'}`} leading-tight`}>
            <span className="truncate">{row.label}</span>
            {row.tooltip ? <Info className="h-2.5 w-2.5 shrink-0 text-slate-500" /> : null}
          </span>
        </div>
        <div className={`shrink-0 ${isDetail ? 'text-[10px] font-medium text-slate-400' : `text-[11px] font-semibold ${isChild ? 'text-slate-200' : 'text-white'}`}`}>{row.value}</div>
      </div>
    )
    return (
      <div key={row.key} className="min-w-0">
        <div className="min-w-0">{row.tooltip ? <MetricTooltip label={row.label} info={row.tooltip}>{rowContent}</MetricTooltip> : rowContent}</div>
        {row.calculation ? (
          <div className="ml-7 mt-0.5 min-w-0 text-[9px] leading-snug text-slate-500">
            {componentTooltip ? (
              <MetricTooltip label={`Componentes de ${row.label}`} info={componentTooltip} contentClassName="max-w-[30rem]">
                <div className="inline-flex max-w-full cursor-help rounded-sm px-0.5 transition hover:bg-slate-800/70 hover:text-slate-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-400/60">
                  {row.calculation.split('=')[0].trim()}
                </div>
              </MetricTooltip>
            ) : row.calculation.split('=')[0].trim()}
          </div>
        ) : null}
      </div>
    )
  }

  const renderNode = (node: AtendimentoMetricHierarchyNode, depth = 0): React.ReactNode => {
    const row = rowsByKey.get(node.key)
    if (!row) return null
    const children = (node.children || []).filter((child) => rowsByKey.has(child.key))
    const componentRows = children
      .map((child) => rowsByKey.get(child.key))
      .filter((child): child is AtendimentoMetricGroupRow => Boolean(child))
    return (
      <div key={node.key} className="min-w-0">
        {renderRow(row, depth > 0, componentRows)}
      </div>
    )
  }

  return <div className="grid gap-1.5 pt-0.5">{nodes.map((node) => renderNode(node))}</div>
}

function MetricTile({
  label,
  value,
  detail,
  icon: Icon,
  loading,
  tone = 'sky',
  description,
  subtitle,
  badge,
  progress,
  content,
  dragHandleProps,
  onHide,
  isDragging,
}: {
  label: string
  value: string
  detail: string
  icon: LucideIcon
  loading?: boolean
  tone?: AtendimentoMetricTone
  description?: string
  subtitle?: string
  badge?: React.ReactNode
  progress?: number
  content?: React.ReactNode
  dragHandleProps?: DraggableProvidedDragHandleProps | null
  onHide?: () => void
  isDragging?: boolean
}) {
  const toneClass = metricToneClass(tone)
  const progressClass = metricProgressClass(tone)
  const safeProgress = typeof progress === 'number' ? Math.max(6, Math.min(100, Math.round(progress))) : null
  const iconNode = (
    <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border ${toneClass}`}>
      <Icon className="h-3.5 w-3.5" />
    </span>
  )
  const labelContent = (
    <div className={`min-w-0 truncate leading-tight ${content ? 'text-sm font-semibold text-white' : 'text-[11px] font-medium text-slate-400'}`}>
      {label}
    </div>
  )
  return (
    <Card className={`group relative overflow-hidden rounded-xl ${panelClass} transition hover:-translate-y-0.5 hover:border-sky-400/25 hover:bg-slate-900/70 ${isDragging ? 'border-sky-300/50 shadow-[0_24px_90px_rgba(14,165,233,0.22)]' : ''}`} data-testid={`atendimento-kpi-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      {loading ? <LoadingOverlay label="Atualizando" /> : null}
      <div className="absolute right-2 top-2 z-20 flex items-center gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          type="button"
          className="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-slate-700 bg-slate-950/80 text-slate-400 hover:border-sky-400/40 hover:text-sky-100"
          aria-label={`Mover ${label}`}
          {...dragHandleProps}
        >
          <GripVertical className="h-3 w-3" />
        </button>
        {onHide ? (
          <button
            type="button"
            className="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-slate-700 bg-slate-950/80 text-slate-400 hover:border-rose-400/40 hover:text-rose-100"
            aria-label={`Ocultar ${label}`}
            onClick={onHide}
          >
            <EyeOff className="h-3 w-3" />
          </button>
        ) : null}
      </div>
      <CardContent className={`${content ? 'min-h-[7.1rem]' : 'min-h-[5.05rem]'} p-2.5`}>
        <div className="flex h-full min-w-0 flex-col justify-between gap-1.5">
          <div className="flex min-w-0 items-center gap-2">
            {description ? (
              <TooltipLabel label={label} description={description}>
                {iconNode}
              </TooltipLabel>
            ) : iconNode}
            <div className="min-w-0">
              {description ? (
                <TooltipLabel label={label} description={description}>
                  {labelContent}
                </TooltipLabel>
              ) : labelContent}
              {subtitle ? <div className={`truncate leading-tight text-slate-500 ${content ? 'mt-0.5 text-[11px]' : 'text-[10px]'}`}>{subtitle}</div> : null}
            </div>
            {badge ? <div className="ml-auto flex shrink-0 items-center gap-1">{badge}</div> : null}
          </div>
          {content ? content : (
            <>
              <div className="truncate text-[1rem] font-semibold leading-tight text-white">{value}</div>
              <div className="truncate text-[11px] leading-tight text-slate-400">{detail}</div>
              {safeProgress !== null ? (
                <div className="h-1 overflow-hidden rounded-full bg-slate-800/90">
                  <div className={`h-full rounded-full ${progressClass}`} style={{ width: `${safeProgress}%` }} />
                </div>
              ) : null}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1 text-xs font-medium text-blue-100/70">
      <span>{label}</span>
      {children}
    </label>
  )
}

function LockedConsultantValue({
  name,
  unresolved = false,
  testId,
  ariaLabel,
  compact = false,
}: {
  name?: string | null
  unresolved?: boolean
  testId?: string
  ariaLabel: string
  compact?: boolean
}) {
  return (
    <div
      className={`${compact ? 'h-8 text-sm' : 'min-h-10 text-sm'} flex w-full items-center justify-center rounded-md border border-slate-700/80 bg-slate-950/45 px-2 text-center ${unresolved ? 'text-amber-100' : 'text-slate-200'}`}
      data-testid={testId}
      aria-label={ariaLabel}
    >
      {unresolved ? <AlertTriangle className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
      <span className="truncate">{name || (unresolved ? 'Sem consultor vinculado' : 'Sem consultor')}</span>
    </div>
  )
}

function LockedInjectorValue({
  name,
  unresolved = false,
  testId,
  ariaLabel,
  compact = false,
}: {
  name?: string | null
  unresolved?: boolean
  testId?: string
  ariaLabel: string
  compact?: boolean
}) {
  return (
    <div
      className={`${compact ? 'h-8 text-sm' : 'min-h-10 text-sm'} flex w-full items-center justify-center rounded-md border border-slate-700/80 bg-slate-950/45 px-2 text-center ${unresolved ? 'text-amber-100' : 'text-slate-200'}`}
      data-testid={testId}
      aria-label={ariaLabel}
    >
      {unresolved ? <AlertTriangle className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
      <span className="truncate">{name || (unresolved ? 'Sem injetor escalado' : 'Sem injetor')}</span>
    </div>
  )
}

function periodLabel(filters: AtendimentoFilters) {
  if (filters.from && filters.to) return `${filters.from.split('-').reverse().join('/')} até ${filters.to.split('-').reverse().join('/')}`
  if (filters.from) return `A partir de ${filters.from.split('-').reverse().join('/')}`
  if (filters.to) return `Até ${filters.to.split('-').reverse().join('/')}`
  return 'Todos os períodos'
}

function formatLocalIsoDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function buildCurrentMonthFilters(): AtendimentoFilters {
  const today = new Date()
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  return {
    ...DEFAULT_ATENDIMENTO_FILTERS,
    from: formatLocalIsoDate(monthStart),
    to: formatLocalIsoDate(today),
  }
}

function formatIsoDateBR(date?: string) {
  const [year, month, day] = String(date || '').slice(0, 10).split('-')
  if (!year || !month || !day) return ''
  return `${day}/${month}/${year}`
}

function inferGoalMonth(filters: AtendimentoFilters) {
  const base = filters.to || filters.from || new Date().toISOString().slice(0, 10)
  return /^\d{4}-\d{2}/.test(base) ? base.slice(0, 7) : new Date().toISOString().slice(0, 7)
}

const CONVERSION_METRIC_DEFINITIONS = [
  { key: 'total', label: 'TOTAL', description: 'Resultado total dos doutores elegíveis no período de conversão.', calculation: 'Soma do realizado dos injetores ativos elegíveis no período.', usage: 'Alias legado do total ranqueável; a leitura principal deve considerar os totais do período filtrado.' },
  { key: 'rankedDoctorTotal', label: 'Total ranqueável', description: 'Subconjunto do período filtrado usado no ranking médico.', calculation: 'Soma do valor realizado dos injetores ativos elegíveis na unidade dentro do período.', usage: 'Permanece disponível internamente para auditoria de consistência do total do período.' },
  { key: 'periodAttendanceTotal', label: 'Total', description: 'Faturamento total do período filtrado.', calculation: 'Soma de todos os atendimentos da unidade/período, incluindo itens fora do ranking.', usage: 'É o total principal exibido no dashboard; o CRM mantém o total ranqueável apenas como verificação interna.' },
  { key: 'eligibleDoctorCount', label: 'Doutores elegíveis', description: 'Quantidade de injetores ativos considerados no ranking.', calculation: 'Profissionais ativos com função Injetor na unidade selecionada.', usage: 'Define o universo usado em média, mediana, desvio, níveis e ranking.' },
  { key: 'dailyGoal', label: 'Meta diária', description: 'Meta diária média do período selecionado.', calculation: 'meta_periodo / dias_trabalhados_periodo.', usage: 'Compõe 50% da linha de corte.' },
  { key: 'periodGoal', label: 'Meta do período', description: 'Meta acumulada do período selecionado.', calculation: 'Soma das metas diárias dos dias trabalhados dentro do período.', usage: 'É a meta principal de comparação da janela filtrada.' },
  { key: 'monthOperationalDays', label: 'Dias mês', description: 'Dias trabalhados usados para diluir a meta mensal.', calculation: 'Dias operacionais do mês consolidados na agenda do CRM.', usage: 'Define a meta diária.' },
  { key: 'periodOperationalDays', label: 'Dias período', description: 'Dias trabalhados dentro do filtro ativo.', calculation: 'Dias operacionais entre início e fim do período selecionado.', usage: 'Define a meta proporcional do período.' },
  { key: 'average', label: 'Média', description: 'Média do realizado dos doutores elegíveis.', calculation: 'total_ranqueável / doutores_elegíveis.', usage: 'Compõe 30% da linha de corte.' },
  { key: 'median', label: 'Mediana', description: 'Valor central do realizado dos doutores elegíveis.', calculation: 'Ordena os realizados e pega o centro; em par, média dos dois centrais.', usage: 'Compõe 20% da linha de corte e reduz distorção por extremos.' },
  { key: 'standardDeviation', label: 'Desvio Padrão', description: 'Dispersão do realizado entre doutores elegíveis.', calculation: 'Desvio padrão amostral dos valores realizados.', usage: 'Multiplicado pelo fator de intervalo para definir a largura das faixas.' },
  { key: 'cutLine', label: 'Linha Corte', description: 'Centro das faixas de classificação na escala do período selecionado.', calculation: 'linha_corte = (média_periodo * 0,30) + (mediana_periodo * 0,20) + (meta_diária * 0,50).', usage: 'Separa níveis 1/2 e orienta os limites inferior e superior.' },
  { key: 'interval', label: 'Intervalo', description: 'Largura das faixas ao redor da linha de corte.', calculation: 'intervalo = desvio_padrão_amostral(realizado_doutores) * multiplicador_otimizado.', usage: 'Define limite inferior e superior.' },
  { key: 'intervalMultiplier', label: 'Multiplicador Otimizado', description: 'Fator aplicado ao desvio padrão e derivado da maior homogeneidade possível.', calculation: 'Avalia os breakpoints exatos entre 0 e 2; mantém o valor anterior somente dentro de um platô ótimo e, fora dele, usa o centro do maior platô ótimo.', usage: 'Redistribui os doutores entre faixas internas e externas sem alterar quem está acima ou abaixo da linha de corte.' },
  { key: 'homogeneityScore', label: 'Homogeneidade', description: 'Índice de equilíbrio entre as quatro faixas.', calculation: '1 - (4/3) × soma((proporção da faixa - 25%)²).', usage: 'Varia de 0% (concentração extrema) a 100% (quatro faixas uniformes).' },
  { key: 'lowerLimit', label: 'Limite Inferior', description: 'Piso da faixa central.', calculation: 'linha_corte - intervalo.', usage: 'Abaixo dele o doutor entra no nível 0.' },
  { key: 'upperLimit', label: 'Limite Superior', description: 'Teto da faixa central.', calculation: 'linha_corte + intervalo.', usage: 'Acima dele o doutor entra no nível 3.' },
  { key: 'level0', label: 'Nível 0', description: 'Doutores abaixo do limite inferior.', calculation: 'Conta realizado < limite_inferior.', usage: 'Entra no divisor das razões com peso 0.' },
  { key: 'level1', label: 'Nível 1', description: 'Doutores entre limite inferior e linha de corte.', calculation: 'Conta limite_inferior <= realizado < linha_corte.', usage: 'Entra no divisor das razões com peso 1.' },
  { key: 'level2', label: 'Nível 2', description: 'Doutores entre linha de corte e limite superior.', calculation: 'Conta linha_corte <= realizado <= limite_superior.', usage: 'Entra no divisor das razões com peso 2.' },
  { key: 'level3', label: 'Nível 3', description: 'Doutores acima do limite superior.', calculation: 'Conta realizado > limite_superior.', usage: 'Entra no divisor das razões com peso 3.' },
  { key: 'upperRatio', label: 'Razão Superior', description: 'Percentual ponderado dos níveis superiores.', calculation: '((level2 * 2) + (level3 * 3)) / divisor.', usage: 'Mostra concentração ponderada acima da linha de corte; é percentual, não R$.' },
  { key: 'lowerRatio', label: 'Razão Inferior', description: 'Percentual ponderado do nível inferior próximo ao corte.', calculation: '(level1 * 1) / divisor.', usage: 'Mostra peso relativo abaixo da linha de corte; é percentual, não R$.' },
  { key: 'innerRatio', label: 'Razão Interior', description: 'Percentual ponderado dos níveis próximos ao centro.', calculation: '((level1 * 1) + (level2 * 2)) / divisor.', usage: 'Ajuda a avaliar concentração ao redor da linha de corte.' },
  { key: 'outerRatio', label: 'Razão Exterior', description: 'Percentual ponderado dos destaques externos.', calculation: '(level3 * 3) / divisor.', usage: 'Ajuda a identificar concentração acima do limite superior.' },
  { key: 'lowerSide', label: 'Lado Inferior', description: 'Parcela dos doutores abaixo da linha de corte.', calculation: 'p0 + p1.', usage: 'Mostra a divisão estrutural abaixo da linha de corte, que o multiplicador não consegue alterar.' },
  { key: 'upperSide', label: 'Lado Superior', description: 'Parcela dos doutores na linha de corte ou acima dela.', calculation: 'p2 + p3.', usage: 'Mostra a divisão estrutural superior, independente da largura do intervalo.' },
  { key: 'centerShare', label: 'Faixas Centrais', description: 'Parcela dos doutores nas duas faixas internas.', calculation: 'p1 + p2.', usage: 'Indica concentração próxima à linha de corte.' },
  { key: 'extremesShare', label: 'Faixas Extremas', description: 'Parcela dos doutores nas duas faixas externas.', calculation: 'p0 + p3.', usage: 'Indica concentração distante da linha de corte.' },
  { key: 'ratioDivisor', label: 'Divisor Razões', description: 'Base ponderada usada nas razões.', calculation: 'divisor = (level0 * 0) + (level1 * 1) + (level2 * 2) + (level3 * 3).', usage: 'Normaliza as razões para virar percentual.' },
] as const

type ConversionMetricKey = typeof CONVERSION_METRIC_DEFINITIONS[number]['key']
const CONVERSION_RATIO_KEYS = new Set<ConversionMetricKey>([
  'upperRatio', 'lowerRatio', 'innerRatio', 'outerRatio',
  'lowerSide', 'upperSide', 'centerShare', 'extremesShare', 'homogeneityScore',
])
const CONVERSION_NUMBER_KEYS = new Set<ConversionMetricKey>([
  'eligibleDoctorCount',
  'monthOperationalDays',
  'periodOperationalDays',
  'level0',
  'level1',
  'level2',
  'level3',
  'ratioDivisor',
])
const CONVERSION_MULTIPLIER_KEYS = new Set<ConversionMetricKey>(['intervalMultiplier'])

const CONVERSION_METRIC_ICON_BY_KEY: Record<ConversionMetricKey, LucideIcon> = {
  total: Sigma,
  rankedDoctorTotal: Sigma,
  periodAttendanceTotal: Sigma,
  eligibleDoctorCount: Users,
  dailyGoal: CalendarRange,
  periodGoal: Target,
  monthOperationalDays: CalendarRange,
  periodOperationalDays: CalendarRange,
  average: Gauge,
  median: Calculator,
  standardDeviation: BarChart3,
  homogeneityScore: Gauge,
  upperRatio: Target,
  lowerRatio: Crosshair,
  innerRatio: Percent,
  outerRatio: Divide,
  lowerSide: ArrowDownToLine,
  upperSide: ArrowUpToLine,
  centerShare: Target,
  extremesShare: Divide,
  ratioDivisor: Sigma,
  cutLine: Ruler,
  interval: CalendarRange,
  intervalMultiplier: Divide,
  lowerLimit: ArrowDownToLine,
  upperLimit: ArrowUpToLine,
  level0: ArrowDownToLine,
  level1: Crosshair,
  level2: Target,
  level3: ArrowUpToLine,
}

const CONVERSION_METRIC_TONE_BY_KEY: Record<ConversionMetricKey, AtendimentoMetricTone> = {
  total: 'sky',
  rankedDoctorTotal: 'sky',
  periodAttendanceTotal: 'sky',
  eligibleDoctorCount: 'emerald',
  dailyGoal: 'emerald',
  periodGoal: 'emerald',
  monthOperationalDays: 'sky',
  periodOperationalDays: 'sky',
  average: 'violet',
  median: 'violet',
  standardDeviation: 'sky',
  homogeneityScore: 'emerald',
  upperRatio: 'amber',
  lowerRatio: 'amber',
  innerRatio: 'sky',
  outerRatio: 'sky',
  lowerSide: 'amber',
  upperSide: 'emerald',
  centerShare: 'sky',
  extremesShare: 'violet',
  ratioDivisor: 'violet',
  cutLine: 'violet',
  interval: 'sky',
  intervalMultiplier: 'sky',
  lowerLimit: 'amber',
  upperLimit: 'emerald',
  level0: 'amber',
  level1: 'amber',
  level2: 'sky',
  level3: 'emerald',
}

const CONVERSION_DISTRIBUTION_GROUP_VISUAL: Array<{
  key: 'lower' | 'upper' | 'center' | 'extremes'
  label: string
  levels: number[]
  icon: LucideIcon
  tone: string
}> = [
  { key: 'lower', label: 'Lado inferior', levels: [0, 1], icon: CONVERSION_METRIC_ICON_BY_KEY.lowerSide, tone: 'text-amber-200' },
  { key: 'upper', label: 'Lado superior', levels: [2, 3], icon: CONVERSION_METRIC_ICON_BY_KEY.upperSide, tone: 'text-emerald-200' },
  { key: 'center', label: 'Faixas centrais', levels: [1, 2], icon: CONVERSION_METRIC_ICON_BY_KEY.centerShare, tone: 'text-sky-200' },
  { key: 'extremes', label: 'Faixas extremas', levels: [0, 3], icon: CONVERSION_METRIC_ICON_BY_KEY.extremesShare, tone: 'text-violet-200' },
]

const CONVERSION_DISTRIBUTION_DETAIL_GROUPS: Array<{
  key: string
  label: string
  tooltip: MetricTooltipSpec
  metricKeys: ConversionMetricKey[]
  hierarchy?: AtendimentoMetricHierarchyNode[]
}> = [
  {
    key: 'conversion:stats',
    label: 'Resumo',
    tooltip: {
      what: 'Síntese financeira organizada do resultado derivado para os insumos de cada fórmula.',
      calculation: 'Os limites usam linha de corte mais ou menos intervalo. A linha de corte usa meta diária, média e mediana; o intervalo usa desvio padrão e multiplicador k. A meta diária usa meta do período e dias operacionais.',
      usage: 'Expõe a origem de cada referência e a produção individual dos doutores sem recalcular fórmulas no navegador.',
    },
    metricKeys: ['upperLimit', 'lowerLimit', 'cutLine', 'dailyGoal', 'periodGoal', 'periodOperationalDays', 'average', 'rankedDoctorTotal', 'median', 'interval', 'standardDeviation', 'intervalMultiplier'],
    hierarchy: [
      { key: 'upperLimit' },
      { key: 'lowerLimit' },
      {
        key: 'cutLine',
        children: [
          { key: 'dailyGoal', children: [{ key: 'periodGoal' }, { key: 'periodOperationalDays' }] },
          { key: 'average', children: [{ key: 'rankedDoctorTotal' }] },
          { key: 'median' },
        ],
      },
      { key: 'interval', children: [{ key: 'standardDeviation' }, { key: 'intervalMultiplier' }] },
    ],
  },
]

function buildMetricTooltip(
  definition: typeof CONVERSION_METRIC_DEFINITIONS[number],
  formula?: string,
  overrides?: Partial<MetricTooltipSpec>
): MetricTooltipSpec {
  return {
    what: overrides?.what || definition.description,
    calculation: overrides?.calculation || formula || definition.calculation,
    usage: overrides?.usage || definition.usage,
  }
}

function formatGoalPlanSegments(goalPlan?: ConversionGoalPlan) {
  const segments = Array.isArray(goalPlan?.segments) ? goalPlan.segments : []
  if (!segments.length) return ''
  return segments
    .map((segment) => {
      const label = monthLabel(segment.monthKey)
      return `${label}: meta mês ${formatCurrencyBRL(segment.monthlyGoal)}, dias mês ${formatNumberBR(segment.monthOperationalDays)}, dias período ${formatNumberBR(segment.periodOperationalDays)}, meta período ${formatCurrencyBRL(segment.periodGoal)}`
    })
    .join(' | ')
}

function buildGoalPlanTooltip(
  definition: typeof CONVERSION_METRIC_DEFINITIONS[number],
  formula: string,
  goalPlan?: ConversionGoalPlan
) {
  const segmentSummary = formatGoalPlanSegments(goalPlan)
  return buildMetricTooltip(definition, formula, {
    usage: `${definition.usage} ${segmentSummary ? `Base atual: ${segmentSummary}. ` : ''}Todas as métricas visíveis deste bloco consideram somente o período filtrado; os dias do mês ficam apenas como insumo técnico da proporcionalização.`,
  })
}

function formatConversionMetricValue(key: ConversionMetricKey, value: number) {
  const numeric = Number(value || 0)
  if (CONVERSION_RATIO_KEYS.has(key)) {
    return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(numeric * 100)}%`
  }
  if (CONVERSION_MULTIPLIER_KEYS.has(key)) {
    return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(numeric)}x`
  }
  if (CONVERSION_NUMBER_KEYS.has(key)) {
    return formatNumberBR(numeric)
  }
  return formatCurrencyBRL(numeric)
}

function PodiumBadge({ rank }: { rank: number }) {
  const normalizedRank = Number(rank || 0)
  const podium = normalizedRank === 1
    ? { label: '1º lugar', description: 'Maior pontuação no ranking do período.', className: 'border-amber-300/45 bg-amber-400/15 text-amber-100', iconClassName: 'text-amber-200' }
    : normalizedRank === 2
      ? { label: '2º lugar', description: 'Segunda maior pontuação no ranking do período.', className: 'border-slate-300/40 bg-slate-300/12 text-slate-100', iconClassName: 'text-slate-200' }
      : normalizedRank === 3
        ? { label: '3º lugar', description: 'Terceira maior pontuação no ranking do período.', className: 'border-orange-300/45 bg-orange-400/12 text-orange-100', iconClassName: 'text-orange-200' }
        : null
  if (!podium) return null
  return (
    <TooltipLabel label={podium.label} description={podium.description}>
      <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${podium.className}`} aria-label={podium.label}>
        <Trophy className={`h-3.5 w-3.5 ${podium.iconClassName}`} />
      </span>
    </TooltipLabel>
  )
}

const DOCTOR_AVATAR_PATH_BY_NAME: Record<string, string> = {
  'gabriela menegat': '/images/doctors/gabriela-menegat.jpeg',
  'josiele de souza': '/images/doctors/josiele-de-souza.jpeg',
  'luize baum': '/images/doctors/luize-baum.png',
  'marcelo gomes': '/images/doctors/marcelo-gomes.jpeg',
  'marcelo gomes soares': '/images/doctors/marcelo-gomes.jpeg',
  'marcelo soares': '/images/doctors/marcelo-gomes.jpeg',
  'marina lima': '/images/doctors/marina-lima.jpeg',
  'rafaela ferreira': '/images/doctors/rafaela-ferreira.png',
  'rafaela machado ferreira': '/images/doctors/rafaela-ferreira.png',
  'raul junior': '/images/doctors/raul-junior.jpeg',
  'raul rosario junior': '/images/doctors/raul-junior.jpeg',
  'vinicius vieira': '/images/doctors/vinicius-vieira.jpeg',
  'viviane mondin': '/images/doctors/viviane-mondin.jpeg',
}

// The sheet historically contains both abbreviated and full registrations for Raul.
// Keep this explicit so similarly named, unrelated professionals are never merged.
const DOCTOR_CANONICAL_NAME_BY_NORMALIZED_NAME: Record<string, string> = {
  'rafaela ferreira': 'Rafaela Machado Ferreira',
  'rafaela machado ferreira': 'Rafaela Machado Ferreira',
  'raul junior': 'Raul Rosário Júnior',
  'raul rosario junior': 'Raul Rosário Júnior',
}

const HIDDEN_CONVERSION_DOCTOR_KEYS = new Set([
  '[object object]',
  'object object',
  'doris moisyn',
  'doris caroline moisyn',
])

function normalizeDoctorName(name: string) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(dr\.?|dra\.?|doutor|doutora)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getDoctorChartName(name: string) {
  const parts = String(name || '')
    .replace(/^\s*(dr\.?|dra\.?|doutor|doutora)\s+/i, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!parts.length) return '--'
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1]}`
}

function getCanonicalDoctorName(name: string) {
  return DOCTOR_CANONICAL_NAME_BY_NORMALIZED_NAME[normalizeDoctorName(name)] || String(name || '').trim()
}

function getDoctorIdentityKey(name: string) {
  return normalizeDoctorName(getCanonicalDoctorName(name))
}

function canonicalProfessionalOptions(names: string[]) {
  const seen = new Set<string>()
  return names.reduce<string[]>((options, name) => {
    const canonical = getCanonicalDoctorName(name)
    const key = getDoctorIdentityKey(canonical)
    if (!key || seen.has(key)) return options
    seen.add(key)
    options.push(canonical)
    return options
  }, [])
}

function isRenderableConversionDoctor(name: string) {
  const key = normalizeDoctorName(name)
  return Boolean(key) && !HIDDEN_CONVERSION_DOCTOR_KEYS.has(key)
}

function toStableDoctorKey(value: string) {
  return normalizeDoctorName(value).replace(/\s+/g, '-') || 'professional'
}

function getDoctorAvatarUrl(name: string) {
  const path = DOCTOR_AVATAR_PATH_BY_NAME[normalizeDoctorName(getCanonicalDoctorName(name))]
  return path ? `https://espacofacial.com${path}` : null
}

function resolveDoctorLevel(value: number, level: number | undefined, lowerLimit: number, cutLine: number, upperLimit: number) {
  if (Number.isFinite(level)) return Number(level)
  if (value > upperLimit) return 3
  if (value >= cutLine) return 2
  if (value >= lowerLimit) return 1
  return 0
}

function conversionLevelVisual(level: number) {
  if (level >= 3) {
    return {
      label: 'Nível 3',
      fill: '#14b8a6',
      bandFill: 'rgba(20,184,166,0.09)',
      ringClassName: 'ring-teal-300/35',
      badgeClassName: 'border-teal-300/30 bg-teal-400/12 text-teal-100',
    }
  }
  if (level === 2) {
    return {
      label: 'Nível 2',
      fill: '#86efac',
      bandFill: 'rgba(134,239,172,0.08)',
      ringClassName: 'ring-green-300/35',
      badgeClassName: 'border-green-300/30 bg-green-400/12 text-green-100',
    }
  }
  if (level === 1) {
    return {
      label: 'Nível 1',
      fill: '#fbbf24',
      bandFill: 'rgba(251,191,36,0.08)',
      ringClassName: 'ring-amber-300/35',
      badgeClassName: 'border-amber-300/30 bg-amber-400/12 text-amber-100',
    }
  }
  return {
    label: 'Nível 0',
    fill: '#fb7185',
    bandFill: 'rgba(251,113,133,0.08)',
    ringClassName: 'ring-rose-300/35',
    badgeClassName: 'border-rose-300/30 bg-rose-400/12 text-rose-100',
  }
}

const CONVERSION_STATUS_COPY: Record<string, { label: string; description: string; tone: 'success' | 'warning' | 'danger' }> = {
  OPTIMAL_ALL_BANDS: { label: 'Quatro faixas equilibradas', description: 'O multiplicador escolhido preenche as quatro faixas com a melhor homogeneidade possível.', tone: 'success' },
  OPTIMAL_EXTREMES_ONLY: { label: 'Melhor equilíbrio com extremos', description: 'Não foi possível preencher as quatro faixas; a solução preserva os extremos.', tone: 'warning' },
  BEST_EFFORT: { label: 'Melhor aproximação possível', description: 'A linha de corte atual não permite preencher as quatro faixas nem preservar os dois extremos.', tone: 'danger' },
  NO_DATA: { label: 'Sem dados elegíveis', description: 'Não há doutores elegíveis para calcular a distribuição.', tone: 'warning' },
  NO_VARIANCE: { label: 'Sem variação', description: 'Todos os realizados são iguais; alterar o multiplicador não muda a distribuição.', tone: 'warning' },
  INSUFFICIENT_DOCTORS: { label: 'Equipe insuficiente', description: 'São necessários pelo menos quatro doutores para preencher quatro faixas.', tone: 'warning' },
  CUT_OFF_BELOW_MIN: { label: 'Corte abaixo da distribuição', description: 'Todos os realizados estão na metade superior da régua.', tone: 'danger' },
  CUT_OFF_ABOVE_MAX: { label: 'Corte acima da distribuição', description: 'Todos os realizados estão na metade inferior da régua.', tone: 'danger' },
  OUTLIER_HEAVY: { label: 'Distribuição com extremos', description: 'Valores extremos podem reduzir a estabilidade do desvio padrão e do intervalo.', tone: 'warning' },
  UNSTABLE_JUMP: { label: 'Mudança relevante no multiplicador', description: 'O valor otimizado se afastou do período anterior além do limite de estabilidade.', tone: 'warning' },
}

function ConversionDoctorBandsContent({
  unitName,
  doctors,
  professionals,
  metrics,
  optimization,
  detailGroups,
  isAggregate = false,
}: {
  unitName: string
  doctors: ConversionDoctorMetric[]
  professionals: AtendimentoReferences['professionals']
  metrics: ConversionRankingSection['metrics']
  optimization?: ConversionRankingSection['optimization']
  detailGroups: Array<{ key: string; label: string; tooltip: MetricTooltipSpec; rows: AtendimentoMetricGroupRow[]; hierarchy?: AtendimentoMetricHierarchyNode[] }>
  isAggregate?: boolean
}) {
  const cutLine = Number(metrics.cutLine?.weekValue || 0)
  const interval = Number(metrics.interval?.weekValue || 0)
  const lowerLimit = Number(metrics.lowerLimit?.weekValue ?? (cutLine - interval))
  const upperLimit = Number(metrics.upperLimit?.weekValue ?? (cutLine + interval))
  const chartDoctors = (() => {
    const byIdentity = new Map<string, {
      id: string
      name: string
      unitName: string
      value: number
      productionValue: number
      score: number
      sourceNames: string[]
    }>()
    for (const doctor of doctors) {
      if (!isRenderableConversionDoctor(doctor.name)) continue
      const productionValue = Number(doctor.weekValue || 0)
      const score = Number(doctor.score || 0)
      const value = isAggregate ? score : productionValue
      const name = getCanonicalDoctorName(doctor.name)
      const identityKey = getDoctorIdentityKey(doctor.name)
      const existing = byIdentity.get(identityKey)
      if (existing) {
        existing.value += value
        existing.productionValue += productionValue
        existing.score += score
        if (!existing.sourceNames.includes(String(doctor.name || '').trim())) existing.sourceNames.push(String(doctor.name || '').trim())
        continue
      }
      byIdentity.set(identityKey, {
        id: `${toStableDoctorKey(doctor.unitSlug || unitName)}-${toStableDoctorKey(identityKey)}`,
        name,
        unitName: doctor.unitName || unitName,
        value,
        productionValue,
        score,
        sourceNames: [String(doctor.name || '').trim()].filter(Boolean),
      })
    }
    return [...byIdentity.values()]
      .sort((left, right) => Number(right.value || 0) - Number(left.value || 0)
        || Number(right.productionValue || 0) - Number(left.productionValue || 0)
        || left.name.localeCompare(right.name, 'pt-BR', { sensitivity: 'base' }))
      .map((doctor, index) => {
      const level = isAggregate
        ? Math.max(0, Math.min(3, Math.round(doctor.score || 0)))
        : resolveDoctorLevel(doctor.value, undefined, lowerLimit, cutLine, upperLimit)
      const visual = conversionLevelVisual(level)
      return {
        ...doctor,
        rank: index + 1,
        level,
        levelLabel: isAggregate ? `${formatNumberBR(doctor.value)} pontos` : visual.label,
        fill: atendimentoProfessionalColor(doctor.name, professionals),
        badgeClassName: visual.badgeClassName,
        ringClassName: visual.ringClassName,
        chartName: getDoctorChartName(doctor.name),
        avatarUrl: getDoctorAvatarUrl(doctor.name),
      }
    })
  })()
  const yValues = chartDoctors.map((doctor) => doctor.value)
  const maxValue = Math.max(isAggregate ? 0 : cutLine, isAggregate ? 0 : upperLimit, ...yValues, 0)
  const yMax = maxValue > 0 ? maxValue * 1.12 : 100
  const hasBands = !isAggregate && Number.isFinite(lowerLimit) && Number.isFinite(cutLine) && Number.isFinite(upperLimit) && upperLimit >= lowerLimit
  const [activeBandLevel, setActiveBandLevel] = useState<number | null>(null)
  const [activeBandTooltipPosition, setActiveBandTooltipPosition] = useState<{ x: number; y: number } | null>(null)
  const bandDetails = [
    { level: 0, y1: 0, y2: lowerLimit, reason: 'Abaixo do limite inferior.', proportion: Number(metrics.level0?.proportion || 0) },
    { level: 1, y1: lowerLimit, y2: cutLine, reason: 'Entre o limite inferior e a linha de corte.', proportion: Number(metrics.level1?.proportion || 0) },
    { level: 2, y1: cutLine, y2: upperLimit, reason: 'Da linha de corte até o limite superior.', proportion: Number(metrics.level2?.proportion || 0) },
    { level: 3, y1: upperLimit, y2: yMax, reason: 'Acima do limite superior.', proportion: Number(metrics.level3?.proportion || 0) },
  ].map((band) => ({ ...band, visual: conversionLevelVisual(band.level) }))
  const activeBand = bandDetails.find((band) => band.level === activeBandLevel) || null
  const [activeDoctorId, setActiveDoctorId] = useState<string | null>(null)
  const [activeDoctorTooltipPosition, setActiveDoctorTooltipPosition] = useState<{ x: number; y: number } | null>(null)
  const [activeReferenceTooltip, setActiveReferenceTooltip] = useState<{
    key: string
    label: string
    subtitle: string
    description: string
    position: { x: number; y: number }
  } | null>(null)
  const chartHoverRef = useRef<HTMLDivElement>(null)
  const [chartWidth, setChartWidth] = useState(0)

  useEffect(() => {
    const chart = chartHoverRef.current
    if (!chart || typeof ResizeObserver === 'undefined') return undefined
    const updateWidth = () => setChartWidth(Math.round(chart.getBoundingClientRect().width))
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(chart)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const hasPointerTooltip = Boolean(activeBandTooltipPosition || activeDoctorTooltipPosition || activeReferenceTooltip)
    if (!hasPointerTooltip) return undefined

    const closeTooltipOutsideChart = (event: PointerEvent) => {
      const chart = chartHoverRef.current
      const target = event.target
      if (chart && target instanceof Node && chart.contains(target)) return

      setActiveBandLevel(null)
      setActiveBandTooltipPosition(null)
      setActiveDoctorId(null)
      setActiveDoctorTooltipPosition(null)
      setActiveReferenceTooltip(null)
    }

    document.addEventListener('pointermove', closeTooltipOutsideChart, true)
    return () => document.removeEventListener('pointermove', closeTooltipOutsideChart, true)
  }, [activeBandTooltipPosition, activeDoctorTooltipPosition, activeReferenceTooltip])

  const activeDoctor = chartDoctors.find((doctor) => doctor.id === activeDoctorId) || null
  const podiumDoctors = new Set(chartDoctors.filter((doctor) => doctor.rank >= 1 && doctor.rank <= 3).map((doctor) => doctor.id))
  // Recharts reserves both chart margin and axis height, so these must remain separate.
  const chartHeightPx = 492
  const chartMarginTop = 18
  const chartMarginRight = 12
  const chartMarginLeft = 6
  const chartMarginBottom = 8
  const doctorCount = Math.max(chartDoctors.length, 1)
  const yAxisWidth = isAggregate ? 46 : 76
  const availablePlotWidth = Math.max(160, (chartWidth || 960) - yAxisWidth - chartMarginLeft - chartMarginRight)
  const doctorSlotWidth = availablePlotWidth / doctorCount
  const doctorAvatarRadius = Math.max(7, Math.min(36, doctorSlotWidth * 0.27))
  const doctorAvatarSize = Math.max(10, (doctorAvatarRadius * 2) - 8)
  const doctorAvatarOffset = -(doctorAvatarSize / 2)
  const doctorLabelFontSize = Math.max(7, Math.min(11.5, doctorSlotWidth * 0.1))
  const doctorLabelOffset = Math.max(30, doctorAvatarRadius + 25)
  const showDoctorNames = doctorSlotWidth >= 34
  const chartXAxisHeight = Math.max(60, Math.round((doctorAvatarRadius * 2) + 30))
  const maxBarSize = Math.max(8, Math.min(52, doctorSlotWidth * 0.54))
  const activateDoctorTooltip = useCallback((doctorId: string, event: React.SyntheticEvent<SVGGElement>) => {
    const targetBounds = event.currentTarget.getBoundingClientRect()
    setActiveBandLevel(null)
    setActiveBandTooltipPosition(null)
    setActiveReferenceTooltip(null)
    setActiveDoctorId(doctorId)

    const mouseEvent = event as React.MouseEvent<SVGGElement>
    const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth
    const viewportHeight = typeof window === 'undefined' ? 720 : window.innerHeight
    const x = Number.isFinite(mouseEvent.clientX) && mouseEvent.clientX > 0
      ? mouseEvent.clientX
      : targetBounds.left + (targetBounds.width / 2)
    const y = Number.isFinite(mouseEvent.clientY) && mouseEvent.clientY > 0
      ? mouseEvent.clientY - 14
      : targetBounds.top - 8
    setActiveDoctorTooltipPosition({
      x: Math.min(Math.max(x, 132), Math.max(132, viewportWidth - 132)),
      y: Math.min(Math.max(y, 72), Math.max(72, viewportHeight - 20)),
    })
  }, [])
  const clearDoctorTooltip = useCallback(() => {
    setActiveDoctorId(null)
    setActiveDoctorTooltipPosition(null)
  }, [])
  const lineBadges = isAggregate ? [] : [
    {
      key: 'upper',
      value: upperLimit,
      label: 'Limite Superior',
      verticalPosition: 'above',
      stroke: '#34d399',
      fill: '#064e3b',
      text: '#d1fae5',
      icon: CONVERSION_METRIC_ICON_BY_KEY.upperLimit,
      subtitle: formatCurrencyBRL(upperLimit),
      description: `Maior limite operacional: ${formatCurrencyBRL(upperLimit)}. Ajuda a identificar quem está acima da faixa de corte ampliada.`,
    },
    {
      key: 'cut',
      value: cutLine,
      label: 'Linha de corte',
      verticalPosition: 'center',
      stroke: '#a78bfa',
      fill: '#2e1065',
      text: '#ede9fe',
      icon: CONVERSION_METRIC_ICON_BY_KEY.cutLine,
      subtitle: formatCurrencyBRL(cutLine),
      description: `Linha central de corte: ${formatCurrencyBRL(cutLine)}, com intervalo operacional de ${formatCurrencyBRL(interval)}.`,
    },
    {
      key: 'lower',
      value: lowerLimit,
      label: 'Limite Inferior',
      verticalPosition: 'below',
      stroke: '#f59e0b',
      fill: '#78350f',
      text: '#fef3c7',
      icon: CONVERSION_METRIC_ICON_BY_KEY.lowerLimit,
      subtitle: formatCurrencyBRL(lowerLimit),
      description: `Menor limite operacional: ${formatCurrencyBRL(lowerLimit)}. Mostra o piso usado para separar níveis inferiores.`,
    },
  ]
  const renderReferenceLine = (badge: (typeof lineBadges)[number]) => (shapeProps: any) => {
    const x1 = Number(shapeProps.x1)
    const x2 = Number(shapeProps.x2)
    const y = Number(shapeProps.y1)
    if (![x1, x2, y].every(Number.isFinite)) return <g />

    const badgeWidth = 20
    const badgeHeight = 18
    const badgeX = x2 - badgeWidth - 8
    const badgeY = badge.verticalPosition === 'above'
      ? y - badgeHeight - 5
      : badge.verticalPosition === 'below'
        ? y + 5
        : y - (badgeHeight / 2)
    const BadgeIcon = badge.icon

    const activateReferenceTooltip = (event: React.SyntheticEvent<SVGGElement>) => {
      const targetBounds = event.currentTarget.getBoundingClientRect()
      setActiveBandLevel(null)
      setActiveBandTooltipPosition(null)
      clearDoctorTooltip()

      const mouseEvent = event as React.MouseEvent<SVGGElement>
      const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth
      const viewportHeight = typeof window === 'undefined' ? 720 : window.innerHeight
      const x = Number.isFinite(mouseEvent.clientX) && mouseEvent.clientX > 0
        ? mouseEvent.clientX
        : targetBounds.left + (targetBounds.width / 2)
      const y = Number.isFinite(mouseEvent.clientY) && mouseEvent.clientY > 0
        ? mouseEvent.clientY - 14
        : targetBounds.top - 8
      setActiveReferenceTooltip({
        key: badge.key,
        label: badge.label,
        subtitle: badge.subtitle,
        description: badge.description,
        position: {
          x: Math.min(Math.max(x, 132), Math.max(132, viewportWidth - 132)),
          y: Math.min(Math.max(y, 72), Math.max(72, viewportHeight - 20)),
        },
      })
    }
    const clearReferenceTooltip = () => setActiveReferenceTooltip(null)

    return (
      <g className="atendimento-reference-line" data-testid={`atendimento-reference-badge-${badge.key}`}>
        <line x1={x1} x2={x2} y1={y} y2={y} stroke={badge.stroke} strokeWidth={badge.key === 'cut' ? 1.5 : 1} strokeDasharray={badge.key === 'cut' ? undefined : '4 4'} />
        <g
          transform={`translate(${badgeX}, ${badgeY})`}
          role="img"
          tabIndex={0}
          aria-label={`${badge.label}: ${badge.subtitle}. ${badge.description}`}
          onMouseEnter={activateReferenceTooltip}
          onMouseMove={activateReferenceTooltip}
          onMouseLeave={clearReferenceTooltip}
          onFocus={activateReferenceTooltip}
          onBlur={clearReferenceTooltip}
        >
          <rect width={badgeWidth} height={badgeHeight} rx="6" fill={badge.fill} fillOpacity="0.98" stroke={badge.stroke} strokeOpacity="0.62" />
          <BadgeIcon x={3} y={2} width={14} height={14} color={badge.text} strokeWidth={1.7} aria-hidden="true" />
        </g>
      </g>
    )
  }

  return (
    <div className="space-y-3 pt-0.5" data-testid="atendimento-conversion-distribution">
      <div className="rounded-xl border border-slate-800/80 bg-slate-950/45 p-3">
          <div
            ref={chartHoverRef}
            className="relative"
            style={{ height: `${chartHeightPx}px` }}
            onMouseMove={(event) => {
              const target = event.target as Element
              if (target.closest('[data-testid^="atendimento-doctor-"], [data-testid^="atendimento-reference-badge-"]')) return
              const bounds = event.currentTarget.getBoundingClientRect()
              const relativeY = event.clientY - bounds.top
              const plotTop = chartMarginTop
              const plotBottom = chartHeightPx - chartMarginBottom - chartXAxisHeight
              if (relativeY < plotTop || relativeY > plotBottom || plotBottom <= plotTop) {
                clearDoctorTooltip()
                setActiveReferenceTooltip(null)
                setActiveBandLevel(null)
                setActiveBandTooltipPosition(null)
                return
              }
              if (isAggregate) {
                clearDoctorTooltip()
                setActiveReferenceTooltip(null)
                setActiveBandLevel(null)
                setActiveBandTooltipPosition(null)
                return
              }
              const value = ((plotBottom - relativeY) / (plotBottom - plotTop)) * yMax
              const band = bandDetails.find((item) => value >= item.y1 && (item.level === 3 ? value <= item.y2 : value < item.y2))
              clearDoctorTooltip()
              setActiveReferenceTooltip(null)
              setActiveBandLevel(band?.level ?? null)
              setActiveBandTooltipPosition(band ? { x: event.clientX, y: event.clientY - 14 } : null)
            }}
            onMouseLeave={() => {
              clearDoctorTooltip()
              setActiveReferenceTooltip(null)
              setActiveBandLevel(null)
              setActiveBandTooltipPosition(null)
            }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartDoctors} margin={{ top: chartMarginTop, right: chartMarginRight, left: chartMarginLeft, bottom: chartMarginBottom }}>
                <CartesianGrid vertical={false} stroke="rgba(148,163,184,0.12)" />
                <XAxis
                  dataKey="chartName"
                  interval={0}
                  height={chartXAxisHeight}
                  tickLine={false}
                  axisLine={false}
                  tick={(tickProps: any) => {
                    const doctor = chartDoctors.find((item) => item.id === tickProps.payload?.payload?.id) || chartDoctors[tickProps.index || 0]
                    if (!doctor) return <g />
                    const isDoctorActive = activeDoctorId === doctor.id
                    const isDoctorDimmed = Boolean(activeDoctorId && !isDoctorActive)
                    return (
                      <g
                        transform={`translate(${tickProps.x},${tickProps.y})`}
                        data-testid={`atendimento-doctor-label-target-${doctor.id}`}
                        tabIndex={0}
                        aria-label={`Detalhes do perfil de ${doctor.name}: ${isAggregate ? `${formatNumberBR(doctor.value)} pontos` : formatCurrencyBRL(doctor.value)}, ${doctor.levelLabel}, posição ${doctor.rank}.`}
                        onMouseEnter={(event) => activateDoctorTooltip(doctor.id, event)}
                        onMouseMove={(event) => activateDoctorTooltip(doctor.id, event)}
                        onMouseLeave={clearDoctorTooltip}
                        onFocus={(event) => activateDoctorTooltip(doctor.id, event)}
                        onBlur={clearDoctorTooltip}
                        opacity={isDoctorDimmed ? 0.48 : 1}
                        className="transition-opacity duration-150"
                      >
                        <circle cx="0" cy={doctorAvatarRadius + 4} r={doctorAvatarRadius} fill="#0f172a" stroke={isDoctorActive ? doctor.fill : 'rgba(148,163,184,0.72)'} strokeWidth={isDoctorActive ? 2.8 : 1.5} />
                        {doctor.avatarUrl ? (
                          <image
                            data-testid={`atendimento-doctor-avatar-${doctor.id}`}
                            href={doctor.avatarUrl}
                            x={doctorAvatarOffset}
                            y={4 + doctorAvatarRadius + doctorAvatarOffset}
                            width={doctorAvatarSize}
                            height={doctorAvatarSize}
                            preserveAspectRatio="xMidYMid slice"
                            clipPath={`circle(${doctorAvatarSize / 2}px at ${doctorAvatarSize / 2}px ${doctorAvatarSize / 2}px)`}
                          />
                        ) : (
                          <text x="0" y={doctorAvatarRadius + 9} textAnchor="middle" fill="#cbd5e1" fontSize={Math.max(7, doctorAvatarRadius * 0.48)} fontWeight="700">{doctor.chartName.slice(0, 1)}</text>
                        )}
                        {showDoctorNames ? <text textAnchor="middle" fill="#cbd5e1" fontSize={doctorLabelFontSize} fontWeight="600"><tspan x="0" dy={doctorLabelOffset + doctorAvatarRadius}>{doctor.chartName}</tspan></text> : null}
                      </g>
                    )
                  }}
                />
                <YAxis
                  width={yAxisWidth}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: '#94a3b8', fontSize: 10 }}
                  tickFormatter={(value: number) => isAggregate ? formatNumberBR(Number(value || 0)) : formatCurrencyBRL(Number(value || 0))}
                  domain={[0, yMax]}
                />
                {hasBands ? (
                  <>
                  {bandDetails.map((band) => (
                      <ReferenceArea
                        key={band.level}
                        y1={band.y1}
                        y2={band.y2}
                        ifOverflow="extendDomain"
                        shape={(shapeProps: any) => (
                          <rect
                            x={shapeProps.x}
                            y={shapeProps.y}
                            width={shapeProps.width}
                            height={shapeProps.height}
                            fill={band.visual.fill}
                            fillOpacity={activeBandLevel === band.level ? 0.3 : 0.08}
                            className="pointer-events-none transition-opacity"
                            aria-label={`${band.visual.label}. ${band.reason} Razão da faixa: ${new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 }).format(band.proportion)}.`}
                            data-testid={`atendimento-conversion-band-${band.level}`}
                            tabIndex={0}
                            onFocus={() => { clearDoctorTooltip(); setActiveReferenceTooltip(null); setActiveBandLevel(band.level) }}
                            onBlur={() => setActiveBandLevel(null)}
                          />
                        )}
                      />
                    ))}
                  </>
                ) : null}
                {lineBadges.map((badge) => (
                  <ReferenceLine key={badge.key} y={badge.value} ifOverflow="extendDomain" shape={renderReferenceLine(badge)} />
                ))}
                <Bar
                  dataKey="value"
                  radius={[8, 8, 0, 0]}
                  maxBarSize={maxBarSize}
                  shape={(shapeProps: any) => {
                    const { x, y, width, height, fill, payload } = shapeProps
                    const hasPodium = podiumDoctors.has(payload.id)
                    const rankBadge = hasPodium ? Number(payload.rank || 0) : null
                    const badgeFill = rankBadge === 1 ? '#fbbf24' : rankBadge === 2 ? '#cbd5e1' : '#fdba74'
                    const badgeX = Number(x) + (Number(width) / 2)
                    const badgeY = Math.max(chartMarginTop + 13, Number(y) - 16)
                    return (
                      <g
                        data-testid={`atendimento-doctor-bar-target-${payload.id}`}
                        tabIndex={0}
                        aria-label={`Detalhes da coluna de ${payload.name}: ${isAggregate ? `${formatNumberBR(payload.value)} pontos` : formatCurrencyBRL(payload.value)}, ${payload.levelLabel}, posição ${payload.rank}.`}
                        onMouseEnter={(event) => activateDoctorTooltip(payload.id, event)}
                        onMouseMove={(event) => activateDoctorTooltip(payload.id, event)}
                        onMouseLeave={clearDoctorTooltip}
                        onFocus={(event) => activateDoctorTooltip(payload.id, event)}
                        onBlur={clearDoctorTooltip}
                      >
                        <rect
                          x={x}
                          y={y}
                          width={width}
                          height={height}
                          rx={8}
                          ry={8}
                          fill={fill}
                          fillOpacity={activeDoctorId && activeDoctorId !== payload.id ? 0.38 : activeDoctorId === payload.id ? 1 : 0.9}
                          stroke={fill}
                          strokeWidth={activeDoctorId === payload.id ? 2.5 : 1}
                          className="transition-[fill-opacity,stroke-width] duration-150"
                        />
                        {rankBadge ? (
                          <g data-testid={`atendimento-rank-trophy-${rankBadge}`} aria-label={`${rankBadge}º lugar`}>
                            <title>{rankBadge === 1 ? '1º lugar - ouro' : rankBadge === 2 ? '2º lugar - prata' : '3º lugar - bronze'}</title>
                            <circle cx={badgeX} cy={badgeY} r={12} fill="rgba(15,23,42,0.94)" stroke={badgeFill} strokeWidth={1.8} />
                            <Trophy
                              x={badgeX - 7}
                              y={badgeY - 8}
                              width={14}
                              height={14}
                              fill={badgeFill}
                              stroke={badgeFill}
                              strokeWidth={1.5}
                              style={{ filter: `drop-shadow(0 2px 2px ${badgeFill}66)` }}
                            />
                          </g>
                        ) : null}
                      </g>
                    )
                  }}
                >
                  {chartDoctors.map((doctor) => (
                    <Cell key={doctor.id} fill={doctor.fill} fillOpacity={0.9} stroke={doctor.fill} />
                  ))}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
            {activeDoctor && activeDoctorTooltipPosition ? createPortal(
              <div
                role="tooltip"
                data-testid="atendimento-doctor-tooltip"
                className="pointer-events-none fixed z-[1000] min-w-[13rem] -translate-x-1/2 -translate-y-full rounded-xl border border-slate-700 bg-slate-950/95 p-3 text-xs text-slate-200 shadow-2xl"
                style={{ left: `${activeDoctorTooltipPosition.x}px`, top: `${activeDoctorTooltipPosition.y}px` }}
              >
                <div className="flex items-center gap-2">
                  {activeDoctor.avatarUrl ? (
                    <img
                      src={activeDoctor.avatarUrl}
                      alt=""
                      className="h-8 w-8 rounded-full border border-slate-600/80 object-cover"
                      onError={(event) => { event.currentTarget.style.display = 'none' }}
                    />
                  ) : null}
                  <div className="font-semibold text-white">{activeDoctor.name}</div>
                </div>
                {activeDoctor.sourceNames.length > 1 ? <div className="mt-1 text-[10px] text-slate-400">Cadastros equivalentes consolidados.</div> : null}
                <div className="mt-2 space-y-1">
                  <div className="flex items-center justify-between gap-3"><span>{isAggregate ? 'Pontos nas unidades' : 'Realizado'}</span><span className="font-semibold text-white">{isAggregate ? formatNumberBR(activeDoctor.value) : formatCurrencyBRL(activeDoctor.value)}</span></div>
                  {isAggregate ? <div className="flex items-center justify-between gap-3"><span>Produção</span><span className="font-semibold text-white">{formatCurrencyBRL(activeDoctor.productionValue)}</span></div> : <div className="flex items-center justify-between gap-3"><span>Nível</span><span className="font-semibold text-white">{activeDoctor.levelLabel}</span></div>}
                  <div className="flex items-center justify-between gap-3"><span>Ranking</span><span className="font-semibold text-white">{activeDoctor.rank ? `${activeDoctor.rank}º` : '-'}</span></div>
                </div>
              </div>
            , document.body) : activeReferenceTooltip ? createPortal(
              <div
                role="tooltip"
                data-testid={`atendimento-reference-tooltip-${activeReferenceTooltip.key}`}
                className="pointer-events-none fixed z-[1000] min-w-[13rem] -translate-x-1/2 -translate-y-full rounded-xl border border-slate-700 bg-slate-950/95 p-3 text-xs text-slate-200 shadow-2xl"
                style={{ left: `${activeReferenceTooltip.position.x}px`, top: `${activeReferenceTooltip.position.y}px` }}
              >
                <div className="font-semibold text-white">{activeReferenceTooltip.label}</div>
                <div className="mt-1 text-sm font-semibold text-sky-100">{activeReferenceTooltip.subtitle}</div>
                <div className="mt-1.5 text-[11px] leading-relaxed text-slate-300">{activeReferenceTooltip.description}</div>
              </div>
            , document.body) : activeBand && activeBandTooltipPosition ? createPortal(
              <div
                role="tooltip"
                data-testid="atendimento-conversion-band-tooltip"
                className="pointer-events-none fixed z-[1000] max-w-[15rem] -translate-x-1/2 -translate-y-full rounded-lg border border-slate-700 bg-slate-950/95 px-3 py-2 text-[10px] text-slate-200 shadow-xl"
                style={{ left: `${activeBandTooltipPosition.x}px`, top: `${activeBandTooltipPosition.y}px` }}
              >
                <div className="font-semibold text-white">{activeBand.visual.label}</div>
                <div className="mt-0.5 text-slate-300">{activeBand.reason}</div>
                <div className="mt-1 text-sky-200">Razão da faixa: {new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 }).format(activeBand.proportion)}</div>
              </div>
            , document.body) : null}
          </div>
      </div>
      <div className="grid gap-2 lg:grid-cols-[minmax(20rem,0.9fr)_minmax(0,1.7fr)]">
        {detailGroups.map((group) => (
          <div key={group.key} className="min-w-0 rounded-xl border border-slate-800/80 bg-slate-950/40 p-3">
            <div className="mb-2">
              <MetricTooltip label={group.label} info={group.tooltip}>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 transition hover:text-slate-200 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50"
                  aria-label={`Detalhes de ${group.label}`}
                >
                  {group.label}
                  <Info className="h-3 w-3 text-slate-500" />
                </button>
              </MetricTooltip>
            </div>
            <MetricGroupContent rows={group.rows} hierarchy={group.hierarchy} />
          </div>
        ))}
        {optimization ? <ConversionMultiplierDetails optimization={optimization} /> : null}
      </div>
    </div>
  )
}

export function AtendimentoModule() {
  const { user } = useAuth()
  const userRole = normalizeCrmRole(user?.role)
  const canManageConsultant = isAtendimentoManager(userRole)
  const isConsultant = userRole === 'CONSULTOR'
  const [filters, setFilters] = useState<AtendimentoFilters>(() => buildCurrentMonthFilters())
  const [references, setReferences] = useState<AtendimentoReferences | null>(null)
  const [overview, setOverview] = useState<AtendimentoOverview | null>(null)
  const [rows, setRows] = useState<AtendimentoAttendance[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMoreRows, setLoadingMoreRows] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AtendimentoAttendance | null>(null)
  const [form, setForm] = useState<AtendimentoForm>(EMPTY_ATENDIMENTO_FORM)
  const [formError, setFormError] = useState('')
  const [inlineForm, setInlineForm] = useState<AtendimentoForm>({ ...EMPTY_ATENDIMENTO_FORM, date: '' })
  const [inlineError, setInlineError] = useState('')
  const [rowDrafts, setRowDrafts] = useState<Record<string, AtendimentoForm>>({})
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [rowSavingId, setRowSavingId] = useState('')
  const [attendanceSortKey, setAttendanceSortKey] = useState<AtendimentoSortKey>('date')
  const [attendanceSortDir, setAttendanceSortDir] = useState<AtendimentoSortDir>('desc')
  const [assignmentIssueFilter, setAssignmentIssueFilter] = useState<'injector' | 'consultant' | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState('')
  const [reportLoading, setReportLoading] = useState(false)
  const [reportPreview, setReportPreview] = useState<AtendimentoReportPreview | null>(null)
  const [managementCatalog, setManagementCatalog] = useState<AtendimentoManagementCatalog | null>(null)
  const [managementConversionReport, setManagementConversionReport] = useState<AtendimentoManagementConversionReport | null>(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisExpanded, setAnalysisExpanded] = useState(() => {
    try {
      return typeof window !== 'undefined' && window.localStorage.getItem(ATENDIMENTO_ANALYSIS_EXPANDED_KEY) === 'true'
    } catch {
      return false
    }
  })
  const [localMirrorStatus, setLocalMirrorStatus] = useState<AtendimentoLocalMirrorStatus | null>(null)
  const loadingMoreRowsRef = React.useRef(false)
  const conversionReportCacheRef = React.useRef(new Map<string, AtendimentoManagementConversionReport>())
  const inlineScheduleRequestKeyRef = React.useRef('')
  const formScheduleRequestKeyRef = React.useRef('')
  const [metricLayout, setMetricLayout] = useState<AtendimentoMetricLayoutItem[]>(() => {
    try {
      if (typeof window === 'undefined') return DEFAULT_ATENDIMENTO_METRIC_LAYOUT
      return parseAtendimentoMetricLayout(window.localStorage.getItem(ATENDIMENTO_METRIC_LAYOUT_KEY))
    } catch {
      return DEFAULT_ATENDIMENTO_METRIC_LAYOUT
    }
  })
  const [chartSlots, setChartSlots] = useState<AtendimentoChartSlot[]>(() => {
    try {
      if (typeof window === 'undefined') return DEFAULT_ATENDIMENTO_CHART_SLOTS
      return parseAtendimentoChartSlots(window.localStorage.getItem(ATENDIMENTO_CHART_LAYOUT_KEY))
    } catch {
      return DEFAULT_ATENDIMENTO_CHART_SLOTS
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(ATENDIMENTO_METRIC_LAYOUT_KEY, JSON.stringify(metricLayout))
    } catch {
      // ignore localStorage errors
    }
  }, [metricLayout])

  useEffect(() => {
    try {
      window.localStorage.setItem(ATENDIMENTO_CHART_LAYOUT_KEY, JSON.stringify(chartSlots))
    } catch {
      // ignore localStorage errors
    }
  }, [chartSlots])

  useEffect(() => {
    try {
      window.localStorage.setItem(ATENDIMENTO_ANALYSIS_EXPANDED_KEY, String(analysisExpanded))
    } catch {
      // ignore localStorage errors
    }
  }, [analysisExpanded])

  const load = useCallback(async () => {
    setLoading(true)
    loadingMoreRowsRef.current = false
    setLoadingMoreRows(false)
    setError('')
    const isLocalhost = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)
    const [refs, ov, list, mirror] = await Promise.all([
      fetchAtendimentoReferences(),
      fetchAtendimentoOverview(filters),
      fetchAtendimentoAttendances(filters, { limit: ATTENDANCE_PAGE_SIZE, offset: 0 }),
      isLocalhost ? fetchAtendimentoLocalMirrorStatus() : Promise.resolve(null),
    ])
    if (!refs.ok) setError(refs.error || 'Não foi possível carregar referências.')
    if (!ov.ok) setError(ov.error || 'Não foi possível carregar indicadores.')
    if (!list.ok) setError(list.error || 'Não foi possível carregar atendimentos.')
    if (refs.ok) {
      setReferences({
        units: refs.units || [],
        professionals: refs.professionals || [],
        procedures: refs.procedures || [],
        actorConsultantByUnit: refs.actorConsultantByUnit || {},
      })
    }
    if (ov.ok) setOverview({ summary: ov.summary, monthly: ov.monthly || [], rankings: ov.rankings })
    if (list.ok) {
      setRows(list.data || [])
      setTotal(Number(list.total || 0))
    }
    if (mirror?.ok) setLocalMirrorStatus(mirror)
    setLoading(false)
  }, [filters])

  const loadMoreAttendances = useCallback(async () => {
    if (loading || loadingMoreRows || loadingMoreRowsRef.current) return
    if (rows.length >= total) return
    loadingMoreRowsRef.current = true
    setLoadingMoreRows(true)
    const result = await fetchAtendimentoAttendances(filters, { limit: ATTENDANCE_PAGE_SIZE, offset: rows.length })
    loadingMoreRowsRef.current = false
    setLoadingMoreRows(false)
    if (!result.ok) {
      setError(result.error || 'Não foi possível carregar mais atendimentos.')
      return
    }
    setRows((prev) => [...prev, ...(result.data || [])])
    setTotal(Number(result.total || total))
  }, [filters, loading, loadingMoreRows, rows.length, total])

  const handleAttendanceScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget
    const distanceFromEnd = target.scrollHeight - target.scrollTop - target.clientHeight
    if (distanceFromEnd < 180) {
      void loadMoreAttendances()
    }
  }, [loadMoreAttendances])

  useEffect(() => {
    void load()
  }, [load])

  const selectedGoalMonth = useMemo(() => inferGoalMonth(filters), [filters])

  const loadManagement = useCallback(async ({ force = false }: { force?: boolean } = {}) => {
    const conversionDate = filters.to || filters.from || `${selectedGoalMonth}-15`
    const cacheKey = `${filters.unit}|${filters.from}|${filters.to}|${conversionDate}`
    const cached = conversionReportCacheRef.current.get(cacheKey)
    const catalogPromise = managementCatalog ? Promise.resolve(null) : fetchAtendimentoManagementCatalog()
    if (!analysisExpanded) {
      const catalog = await catalogPromise
      if (catalog?.ok) setManagementCatalog(catalog)
      return
    }
    if (cached && !force) {
      setManagementConversionReport(cached)
      const catalog = await catalogPromise
      if (catalog?.ok) setManagementCatalog(catalog)
      return
    }
    setAnalysisLoading(true)
    const [catalog, conversionReport] = await Promise.all([
      catalogPromise,
      fetchAtendimentoManagementConversionReport(conversionDate, { unit: filters.unit, from: filters.from, to: filters.to }),
    ])
    if (catalog?.ok) setManagementCatalog(catalog)
    if (conversionReport.ok) {
      conversionReportCacheRef.current.set(cacheKey, conversionReport)
      setManagementConversionReport(conversionReport)
    }
    setAnalysisLoading(false)
  }, [analysisExpanded, filters.from, filters.to, filters.unit, managementCatalog, selectedGoalMonth])

  useEffect(() => {
    void loadManagement()
  }, [loadManagement])

  const procedure = useMemo(
    () => (references?.procedures || []).find((item) => item.name === form.procedureName) || null,
    [form.procedureName, references?.procedures],
  )
  const allowedCodes = procedure?.codes || []
  const formUnitName = form.unitName || references?.units.find((unit) => unit.slug === form.unitSlug)?.name || form.unitSlug
  const formShift = determineAtendimentoShift(formUnitName)
  const consultantBindingForUnit = useCallback((unitSlug: string) => {
    if (!isConsultant) return null
    return references?.actorConsultantByUnit?.[String(unitSlug || '').trim()] || null
  }, [isConsultant, references?.actorConsultantByUnit])
  const consultantDisplayForUnit = useCallback((unitSlug: string, fallbackName = '') => {
    if (canManageConsultant || !isConsultant) return { name: fallbackName, unresolved: false }
    const binding = consultantBindingForUnit(unitSlug)
    return { name: binding?.name || '', unresolved: !binding?.canonicalId }
  }, [canManageConsultant, consultantBindingForUnit, isConsultant])
  const injectors = useMemo(
    () => filterProfessionalsByUnitRole(references?.professionals || [], formUnitName, 'Injetor'),
    [formUnitName, references?.professionals],
  )
  const consultants = useMemo(
    () => filterProfessionalsByUnitRole(references?.professionals || [], formUnitName, 'Consultor', formShift),
    [formShift, formUnitName, references?.professionals],
  )
  const previewValue = calculateAtendimentoValue(form)

  const buildInlineForm = useCallback((): AtendimentoForm => {
    const selectedUnit = filters.unit !== 'all'
      ? references?.units.find((unit) => unit.slug === filters.unit)
      : references?.units[0]
    const consultantBinding = isConsultant ? consultantBindingForUnit(selectedUnit?.slug || '') : null
    return {
      ...EMPTY_ATENDIMENTO_FORM,
      date: formatLocalIsoDate(new Date()),
      unitSlug: selectedUnit?.slug || EMPTY_ATENDIMENTO_FORM.unitSlug,
      unitName: selectedUnit?.name || EMPTY_ATENDIMENTO_FORM.unitName,
      consultantId: consultantBinding?.canonicalId || null,
      consultantName: consultantBinding?.name || '',
    }
  }, [consultantBindingForUnit, filters.unit, isConsultant, references?.units])

  useEffect(() => {
    setInlineForm((prev) => {
      const defaultForm = buildInlineForm()
      // A pessoa pode começar a preencher antes de as referências terminarem de
      // carregar. Nesse caso, complete apenas a unidade ausente para que a
      // busca de clientes fique limitada corretamente, sem apagar o rascunho.
      if (!prev.unitSlug && defaultForm.unitSlug) {
        return {
          ...prev,
          date: prev.date || defaultForm.date,
          unitSlug: defaultForm.unitSlug,
          unitName: defaultForm.unitName,
        }
      }
      return hasAtendimentoInlineDraft(prev) ? prev : defaultForm
    })
  }, [buildInlineForm])

  useEffect(() => {
    if (!isConsultant) return
    setInlineForm((previous) => {
      const binding = consultantBindingForUnit(previous.unitSlug)
      const consultantId = binding?.canonicalId || null
      const consultantName = binding?.name || ''
      if (previous.consultantId === consultantId && previous.consultantName === consultantName) return previous
      return { ...previous, consultantId, consultantName }
    })
  }, [consultantBindingForUnit, isConsultant])

  useEffect(() => {
    if (!isConsultant || !formOpen || form.id) return
    setForm((previous) => {
      const binding = consultantBindingForUnit(previous.unitSlug)
      const consultantId = binding?.canonicalId || null
      const consultantName = binding?.name || ''
      if (previous.consultantId === consultantId && previous.consultantName === consultantName) return previous
      return { ...previous, consultantId, consultantName }
    })
  }, [consultantBindingForUnit, form.id, form.unitSlug, formOpen, isConsultant])

  useEffect(() => {
    if (!formOpen) formScheduleRequestKeyRef.current = ''
  }, [formOpen])

  const scheduledInjectorPatch = useCallback((doctorId?: string | null, doctorName?: string | null): Partial<AtendimentoForm> => {
    if (!doctorName) return { injectorId: null, injectorName: '' }
    if (doctorId) return { injectorId: doctorId, injectorName: doctorName }
    return professionalIdentityPatch(references?.professionals || [], 'injector', doctorName)
  }, [references?.professionals])

  useEffect(() => {
    const unitSlug = inlineForm.unitSlug
    const date = inlineForm.date
    if (!unitSlug || !date) return
    const requestKey = `${unitSlug}:${date}`
    if (inlineScheduleRequestKeyRef.current === requestKey) return
    inlineScheduleRequestKeyRef.current = requestKey
    void fetchAtendimentoDoctorSuggestion(unitSlug, date).then((result) => {
      if (inlineScheduleRequestKeyRef.current !== requestKey || !result.ok) return
      setInlineForm((previous) => previous.unitSlug === unitSlug && previous.date === date
        ? { ...previous, ...scheduledInjectorPatch(result.doctorId, result.doctorName) }
        : previous)
    })
  }, [inlineForm.date, inlineForm.unitSlug, scheduledInjectorPatch])

  useEffect(() => {
    if (!formOpen || form.id || !form.unitSlug || !form.date) return
    const requestKey = `${form.unitSlug}:${form.date}`
    if (formScheduleRequestKeyRef.current === requestKey) return
    formScheduleRequestKeyRef.current = requestKey
    void fetchAtendimentoDoctorSuggestion(form.unitSlug, form.date).then((result) => {
      if (formScheduleRequestKeyRef.current !== requestKey || !result.ok) return
      setForm((previous) => previous.unitSlug === form.unitSlug && previous.date === form.date && !previous.id
        ? { ...previous, ...scheduledInjectorPatch(result.doctorId, result.doctorName) }
        : previous)
    })
  }, [form.date, form.id, form.unitSlug, formOpen, scheduledInjectorPatch])

  const inlineProcedure = useMemo(
    () => (references?.procedures || []).find((item) => item.name === inlineForm.procedureName) || null,
    [inlineForm.procedureName, references?.procedures],
  )
  const inlineAllowedCodes = inlineProcedure?.codes || []
  const inlineUnitName = inlineForm.unitName || references?.units.find((unit) => unit.slug === inlineForm.unitSlug)?.name || inlineForm.unitSlug
  const inlineShift = determineAtendimentoShift(inlineUnitName)
  const inlineInjectors = useMemo(
    () => canonicalProfessionalOptions(filterProfessionalsByUnitRole(references?.professionals || [], inlineUnitName, 'Injetor')),
    [inlineUnitName, references?.professionals],
  )
  const inlineConsultants = useMemo(
    () => canonicalProfessionalOptions(filterProfessionalsByUnitRole(references?.professionals || [], inlineUnitName, 'Consultor', inlineShift)),
    [inlineShift, inlineUnitName, references?.professionals],
  )
  const inlinePreviewValue = calculateAtendimentoValue(inlineForm)

  const filterInjectors = useMemo(() => {
    const unitName = filters.unit === 'all'
      ? ''
      : references?.units.find((unit) => unit.slug === filters.unit)?.name || filters.unit
    if (unitName) return canonicalProfessionalOptions(filterProfessionalsByUnitRole(references?.professionals || [], unitName, 'Injetor'))
    return canonicalProfessionalOptions((references?.professionals || [])
      .filter((professional) => {
        if (professional.status && professional.status !== 'Ativo') return false
        const roles = [
          ...(Array.isArray(professional.roles) ? professional.roles : []),
          professional.role || '',
        ].map((role) => String(role).toLowerCase())
        return roles.some((role) => role.includes('injetor') || role.includes('medico') || role.includes('médico'))
      })
      .map((professional) => professional.name)
      .filter(Boolean))
  }, [filters.unit, references?.professionals, references?.units])

  const latestImportDate = managementCatalog?.latestImport?.created_at || null
  const latestImportLabel = latestImportDate ? new Date(latestImportDate).toLocaleDateString('pt-BR') : 'Sem import recente'
  const activeUnitLabel = references?.units.find((unit) => unit.slug === filters.unit)?.name || (filters.unit === 'all' ? 'Todas unidades' : filters.unit)
  const unitLegend = useMemo(() => {
    const units = (references?.units?.length ? references.units : DEFAULT_UNIT_LEGEND)
      .filter((unit) => ['novo-hamburgo', 'barra-shopping-sul'].includes(unit.slug))
    return units.map((unit) => ({ ...unit, visual: atendimentoUnitVisual(unit.slug || unit.name) }))
  }, [references?.units])

  const metricTiles = useMemo<AtendimentoMetricTileConfig[]>(() => {
    const tiles: AtendimentoMetricTileConfig[] = []

    const doctorRanking = managementConversionReport?.doctorRanking
    const sections = doctorRanking?.sections || []
    const conversionSection = (filters.unit !== 'all' ? sections.find((item) => item.unitSlug === filters.unit) : sections.find((item) => item.unitSlug === 'all'))
      || sections.find((item) => Object.keys(item.metrics || {}).length)
      || sections[0]
    const conversionMetrics = conversionSection?.metrics || {}
    const goalPlan = conversionSection?.goalPlan
    const period = doctorRanking?.period
    const conversionStart = period?.metricStart || period?.weekStart
    const conversionEnd = period?.metricEnd || period?.weekEnd
    const conversionPeriodDetail = conversionStart && conversionEnd
      ? `${formatIsoDateBR(conversionStart)} a ${formatIsoDateBR(conversionEnd)}`
      : conversionSection?.unitName || 'Conversão'
    const aggregateNotice = conversionSection?.aggregateNotice || conversionMetrics.aggregateNotice?.position || ''
    if (aggregateNotice) {
      tiles.push({
        key: 'conversion:aggregate-notice',
        label: 'Conversão por unidade',
        value: 'Selecione uma unidade',
        detail: 'Estatísticas não são consolidadas',
        icon: AlertTriangle,
        tone: 'amber',
        description: aggregateNotice,
        wrapperClassName: 'col-span-full',
        content: (
          <div className="pt-0.5 text-[11px] leading-snug text-slate-400">
            {aggregateNotice}
          </div>
        ),
      })
    }
    const conversionDefinitions = new Map(CONVERSION_METRIC_DEFINITIONS.map((definition) => [definition.key, definition]))
    const conversionMetricValue = (key: ConversionMetricKey) => Number(conversionMetrics[key]?.weekValue || 0)
    const currentMetricCalculation = (key: ConversionMetricKey, value: number) => {
      const currency = (metricKey: ConversionMetricKey) => formatCurrencyBRL(conversionMetricValue(metricKey))
      const number = (metricKey: ConversionMetricKey) => formatNumberBR(conversionMetricValue(metricKey))
      const periodDays = conversionMetricValue('periodOperationalDays')
      const periodDaysLabel = `${formatNumberBR(periodDays)} ${periodDays === 1 ? 'dia' : 'dias'}`
      switch (key) {
        case 'periodAttendanceTotal':
          return 'Σ valores do período'
        case 'rankedDoctorTotal':
          return 'Σ produção dos doutores elegíveis'
        case 'dailyGoal':
          return `${currency('periodGoal')} ÷ ${periodDaysLabel}`
        case 'periodGoal':
          return 'Meta proporcional dos dias selecionados'
        case 'periodOperationalDays':
          return 'Dias usados para proporcionalizar a meta'
        case 'average':
          return `Σ produção dos doutores ÷ ${number('eligibleDoctorCount')} doutores`
        case 'median':
          return `mediana de ${number('eligibleDoctorCount')} realizados`
        case 'standardDeviation':
          return `DP amostral de ${number('eligibleDoctorCount')} realizados`
        case 'upperLimit':
          return `${currency('cutLine')} + ${currency('interval')}`
        case 'cutLine':
          return `30% × ${currency('average')} + 20% × ${currency('median')} + 50% × ${currency('dailyGoal')}`
        case 'interval':
          return `${currency('standardDeviation')} × ${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 5 }).format(conversionMetricValue('intervalMultiplier'))}x`
        case 'lowerLimit':
          return `${currency('cutLine')} − ${currency('interval')}`
        default:
          return `${formatConversionMetricValue(key, value)} no período selecionado`
      }
    }
    const currentMetricSubtitle = (key: ConversionMetricKey) => {
      switch (key) {
        case 'periodAttendanceTotal':
          return 'Atendimentos do período'
        case 'rankedDoctorTotal':
          return 'Produção dos doutores elegíveis'
        case 'dailyGoal':
          return 'Meta do período ÷ Dias período'
        case 'periodGoal':
          return 'Meta diária × Dias período'
        case 'periodOperationalDays':
          return 'Dias operacionais do filtro'
        case 'average':
          return 'Total produzido ÷ Doutores elegíveis'
        case 'median':
          return 'Produção dos doutores elegíveis'
        case 'standardDeviation':
          return 'Produção dos doutores elegíveis'
        case 'upperLimit':
          return 'Linha Corte + Intervalo'
        case 'cutLine':
          return 'Média + Mediana + Meta diária'
        case 'interval':
          return 'Desvio Padrão × Multiplicador'
        case 'lowerLimit':
          return 'Linha Corte − Intervalo'
        default:
          return CONVERSION_METRIC_DEFINITIONS.find((definition) => definition.key === key)?.calculation || ''
      }
    }
    const buildConversionRows = (metricKeys: ConversionMetricKey[]) => metricKeys
      .flatMap((key): AtendimentoMetricGroupRow[] => {
        const metric = conversionMetrics[key]
        const definition = conversionDefinitions.get(key)
        if (!metric || !definition) return []
        const exactCalculation = currentMetricCalculation(key, Number(metric.weekValue || 0))
        const tooltip = key === 'dailyGoal' || key === 'periodGoal' || key === 'periodOperationalDays'
          ? buildGoalPlanTooltip(definition, exactCalculation, goalPlan)
          : buildMetricTooltip(definition, exactCalculation, {
            usage: `${definition.usage} Todas as métricas exibidas aqui usam o período filtrado.`,
          })
        return [{
          key,
          label: key === 'rankedDoctorTotal' ? 'Total produzido' : definition.label,
          value: key === 'intervalMultiplier' && conversionSection?.optimization?.selectedMultiplier == null
            ? 'Não aplicável'
            : key === 'level0' || key === 'level1' || key === 'level2' || key === 'level3'
            ? `${formatNumberBR(Number(metric.weekValue || 0))} · ${new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 }).format(Number(metric.proportion || 0))}`
            : formatConversionMetricValue(key, Number(metric.weekValue || 0)),
          detail: metric.position || '',
          calculation: currentMetricSubtitle(key),
          tooltip,
          icon: CONVERSION_METRIC_ICON_BY_KEY[key],
          tone: CONVERSION_METRIC_TONE_BY_KEY[key],
          presentation: key === 'rankedDoctorTotal' ? 'detail' : undefined,
        }]
      })
    const buildDoctorProductionRows = (parentKey: 'average' | 'median') => (conversionSection?.doctors || [])
      .filter((doctor) => isRenderableConversionDoctor(doctor.name))
      .map((doctor, index): AtendimentoMetricGroupRow => {
        const rank = Number(doctor.rank || index + 1)
        const canonicalName = getCanonicalDoctorName(doctor.name)
        return {
          key: `${parentKey}:doctor:${rank}:${canonicalName}`,
          label: canonicalName,
          value: formatCurrencyBRL(Number(doctor.weekValue || 0)),
          tooltip: {
            what: `Produção de ${canonicalName} usada nas estatísticas do ranking.`,
            calculation: 'Soma dos atendimentos atribuídos ao profissional elegível no período e na unidade ativos.',
            usage: parentKey === 'average'
              ? 'Esta produção compõe o total dividido pela quantidade de doutores para obter a média.'
              : 'Os valores ordenados dos doutores determinam a posição central da mediana.',
          },
          icon: Stethoscope,
          tone: 'sky',
          avatarUrl: getDoctorAvatarUrl(doctor.name),
        }
      })
    const buildGoalSegmentRows = () => (goalPlan?.segments || [])
      .filter((segment) => (goalPlan?.segments || []).length > 1)
      .map((segment): AtendimentoMetricGroupRow => ({
        key: `dailyGoal:segment:${segment.monthKey}`,
        label: monthLabel(segment.monthKey),
        value: formatCurrencyBRL(Number(segment.periodGoal || 0)),
        calculation: `${formatCurrencyBRL(Number(segment.dailyGoal || 0))} × ${formatNumberBR(Number(segment.periodOperationalDays || 0))} dias`,
        tooltip: {
          what: `Parcela da meta do período em ${monthLabel(segment.monthKey)}.`,
          calculation: 'Meta diária daquele mês × dias operacionais do mês presentes no filtro.',
          usage: 'As parcelas dos meses são somadas no backend para formar a meta do período antes da meta diária média.',
        },
        icon: Target,
        tone: 'emerald',
      }))
    const buildStatsHierarchy = (averageDoctorRows: AtendimentoMetricGroupRow[], medianDoctorRows: AtendimentoMetricGroupRow[], goalSegmentRows: AtendimentoMetricGroupRow[]): AtendimentoMetricHierarchyNode[] => [
      { key: 'upperLimit' },
      { key: 'lowerLimit' },
      { key: 'cutLine' },
      { key: 'dailyGoal', children: [{ key: 'periodGoal' }, { key: 'periodOperationalDays' }, ...goalSegmentRows.map((row) => ({ key: row.key }))] },
      { key: 'average', children: [...averageDoctorRows.map((row) => ({ key: row.key })), { key: 'rankedDoctorTotal' }] },
      { key: 'median', children: medianDoctorRows.map((row) => ({ key: row.key })) },
      { key: 'interval', children: [{ key: 'standardDeviation' }, { key: 'intervalMultiplier' }] },
    ]
    const distributionGroups = CONVERSION_DISTRIBUTION_DETAIL_GROUPS
      .map((group) => {
        const averageDoctorRows = buildDoctorProductionRows('average')
        const medianDoctorRows = buildDoctorProductionRows('median')
        const goalSegmentRows = buildGoalSegmentRows()
        const rows = [...buildConversionRows(group.metricKeys), ...averageDoctorRows, ...medianDoctorRows, ...goalSegmentRows]
        return {
          ...group,
          rows,
          hierarchy: group.key === 'conversion:stats'
            ? buildStatsHierarchy(averageDoctorRows, medianDoctorRows, goalSegmentRows)
            : group.hierarchy,
        }
      })
      .filter((group) => group.rows.length)
    if (!aggregateNotice && conversionSection?.doctors?.length && distributionGroups.length) {
      tiles.push({
        key: 'conversion:distribution',
        label: 'Desempenho por doutor',
        subtitle: filters.unit === 'all' ? 'Ranking por pontos obtidos em cada unidade.' : 'Ranking, totais e faixas do período.',
        value: `${formatNumberBR(conversionSection.doctors.length)} doutores`,
        detail: conversionPeriodDetail,
        icon: Gauge,
        tone: 'violet',
        description: filters.unit === 'all'
          ? 'Cada coluna mostra a soma dos pontos que o doutor obteve na comparação da própria unidade. Produção bruta não determina a posição entre unidades.'
          : 'Cada coluna mostra o total do período por doutor. As faixas horizontais mantêm os níveis 0 a 3 na mesma escala para facilitar a leitura do corte e do ranking.',
        wrapperClassName: 'col-span-full',
        content: (
          <ConversionDoctorBandsContent
            unitName={conversionSection.unitName}
            doctors={conversionSection.doctors}
            professionals={references?.professionals || []}
            metrics={conversionMetrics}
            optimization={conversionSection.optimization}
            detailGroups={distributionGroups}
            isAggregate={conversionSection.isAggregate || conversionSection.comparisonMetric === 'unit-score'}
          />
        ),
      })
    }

    return tiles
  }, [
    filters.unit,
    managementConversionReport,
    references?.professionals,
  ])

  const metricDisplayLayout = useMemo(() => {
    const availableKeys = new Set(metricTiles.map((tile) => tile.key))
    const seen = new Set<string>()
    const current = metricLayout.filter((item) => {
      if (!availableKeys.has(item.key) || seen.has(item.key)) return false
      seen.add(item.key)
      return true
    })
    const missing = metricTiles
      .filter((tile) => !seen.has(tile.key))
      .map((tile) => ({ key: tile.key, visible: true }))
    return [...current, ...missing]
  }, [metricLayout, metricTiles])

  const visibleMetricTiles = useMemo(() => {
    const byKey = new Map(metricTiles.map((tile) => [tile.key, tile]))
    return metricDisplayLayout
      .map((config) => {
        const tile = byKey.get(config.key)
        if (!tile || !config.visible) return null
        return tile
      })
      .filter(Boolean) as AtendimentoMetricTileConfig[]
  }, [metricDisplayLayout, metricTiles])

  const hiddenMetricTiles = useMemo(() => {
    const byKey = new Map(metricTiles.map((tile) => [tile.key, tile]))
    return metricDisplayLayout
      .filter((config) => !config.visible)
      .map((config) => byKey.get(config.key))
      .filter(Boolean) as AtendimentoMetricTileConfig[]
  }, [metricDisplayLayout, metricTiles])

  const conversionRankingText = useMemo(
    () => (managementConversionReport?.doctorRanking?.topDoctors || [])
      .map((doctor) => `${doctor.name} ${doctor.unitName} ${formatNumberBR(Number(doctor.score || 0))} pts ${doctor.position || ''}`)
      .join(' '),
    [managementConversionReport],
  )

  const updateMetricTile = (key: AtendimentoMetricKey, patch: Partial<AtendimentoMetricLayoutItem>) => {
    setMetricLayout((prev) => {
      if (prev.some((item) => item.key === key)) {
        return prev.map((item) => (item.key === key ? { ...item, ...patch } : item))
      }
      return [...prev, { key, visible: patch.visible !== false }]
    })
  }

  const handleMetricDragEnd = (result: DropResult) => {
    if (!result.destination || result.destination.droppableId !== 'atendimento-metrics') return
    if (result.source.index === result.destination.index) return
    const visibleKeys = metricDisplayLayout.filter((item) => item.visible).map((item) => item.key)
    const movedKey = visibleKeys[result.source.index]
    if (!movedKey) return
    setMetricLayout(() => {
      const next = [...metricDisplayLayout]
      const sourceIndex = next.findIndex((item) => item.key === movedKey)
      if (sourceIndex < 0) return metricDisplayLayout
      const [entry] = next.splice(sourceIndex, 1)
      const visibleAfterRemoval = next.filter((item) => item.visible)
      const beforeKey = visibleAfterRemoval[result.destination?.index ?? 0]?.key
      const destinationIndex = beforeKey ? next.findIndex((item) => item.key === beforeKey) : next.length
      next.splice(destinationIndex < 0 ? next.length : destinationIndex, 0, entry)
      return next
    })
  }

  const openEdit = (row: AtendimentoAttendance) => {
    setForm(asForm(row))
    setFormError('')
    setFormOpen(true)
  }

  const saveForm = async () => {
    const validation = validateAtendimentoForm(form, allowedCodes)
    if (validation) {
      setFormError(validation)
      return
    }
    setSaving(true)
    setFormError('')
    const { value: _value, ...payload } = { ...form, code: normalizeCode(form.code) }
    const result = form.id
      ? await updateAtendimentoAttendance(form.id, payload)
      : await createAtendimentoAttendance(payload, createIdempotencyKey())
    setSaving(false)
    if (!result.ok) {
      setFormError(result.error || 'Não foi possível salvar.')
      return
    }
    setFormOpen(false)
    conversionReportCacheRef.current.clear()
    await load()
    await loadManagement({ force: true })
  }

  const updateInlineForm = (patch: Partial<AtendimentoForm>) => setInlineForm((prev) => ({ ...prev, ...patch }))

  const updateInlineProcedure = (procedureName: string) => {
    const selectedProcedure = (references?.procedures || []).find((item) => item.name === procedureName)
    updateInlineForm({ procedureName, code: selectedProcedure?.codes?.[0] || '' })
  }

  const saveInlineForm = useCallback(async () => {
    if (!hasAtendimentoInlineDraft(inlineForm)) return
    const validation = validateAtendimentoForm(inlineForm, inlineAllowedCodes)
    if (validation) {
      setInlineError(validation)
      return
    }
    setSaving(true)
    setInlineError('')
    const { value: _value, ...payload } = { ...inlineForm, code: normalizeCode(inlineForm.code) }
    const result = await createAtendimentoAttendance(payload, createIdempotencyKey())
    setSaving(false)
    if (!result.ok) {
      setInlineError(result.error || 'Não foi possível salvar.')
      return
    }
    inlineScheduleRequestKeyRef.current = ''
    setInlineForm(buildInlineForm())
    conversionReportCacheRef.current.clear()
    await load()
    await loadManagement({ force: true })
  }, [buildInlineForm, inlineAllowedCodes, inlineForm, load, loadManagement])

  const rowFormFor = useCallback((row: AtendimentoAttendance) => rowDrafts[row.id] || asForm(row), [rowDrafts])

  const updateRowDraft = (row: AtendimentoAttendance, patch: Partial<AtendimentoForm>) => {
    setRowDrafts((prev) => ({ ...prev, [row.id]: { ...asForm(row), ...(prev[row.id] || {}), ...patch } }))
  }

  const commitRowForm = useCallback(async (row: AtendimentoAttendance, override?: Partial<AtendimentoForm>) => {
    const current = { ...asForm(row), ...(rowDrafts[row.id] || {}), ...(override || {}) }
    const selectedProcedure = (references?.procedures || []).find((item) => item.name === current.procedureName)
    const allowed = selectedProcedure?.codes || []
    const normalized = { ...current, code: current.code || allowed[0] || '' }
    const validation = validateAtendimentoForm(normalized, allowed)
    if (validation) {
      setRowErrors((prev) => ({ ...prev, [row.id]: validation }))
      return
    }
    setRowSavingId(row.id)
    setRowErrors((prev) => {
      const next = { ...prev }
      delete next[row.id]
      return next
    })
    const { value: _value, ...payload } = { ...normalized, code: normalizeCode(normalized.code), revision: row.revision }
    const result = await updateAtendimentoAttendance(row.id, payload)
    setRowSavingId('')
    if (!result.ok) {
      setRowErrors((prev) => ({ ...prev, [row.id]: result.error || 'Não foi possível salvar.' }))
      return
    }
    if (result.data) setRows((prev) => prev.map((item) => item.id === row.id ? result.data : item))
    setRowDrafts((prev) => {
      const next = { ...prev }
      delete next[row.id]
      return next
    })
    conversionReportCacheRef.current.clear()
    void loadManagement({ force: true })
  }, [loadManagement, references?.procedures, rowDrafts])

  const commitRowPatch = (row: AtendimentoAttendance, patch: Partial<AtendimentoForm>) => {
    updateRowDraft(row, patch)
    void commitRowForm(row, patch)
  }

  const handleAttendanceSort = (key: AtendimentoSortKey) => {
    if (attendanceSortKey === key) {
      setAttendanceSortDir((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }
    setAttendanceSortKey(key)
    setAttendanceSortDir(key === 'date' || key === 'value' ? 'desc' : 'asc')
  }

  const sortedRows = useMemo(() => {
    const multiplier = attendanceSortDir === 'asc' ? 1 : -1
    return [...rows].sort((left, right) => {
      if (attendanceSortKey === 'value') return ((Number(left.value) || 0) - (Number(right.value) || 0)) * multiplier
      const leftValue = String(left[attendanceSortKey] || '')
      const rightValue = String(right[attendanceSortKey] || '')
      return leftValue.localeCompare(rightValue, 'pt-BR', { numeric: true, sensitivity: 'base' }) * multiplier
    })
  }, [attendanceSortDir, attendanceSortKey, rows])
  const clientSuggestionsByUnit = useMemo(() => {
    const byUnit = new Map<string, Map<string, { name: string; usageCount: number }>>()
    const loadedClients = new Map<string, { name: string; usageCount: number }>()
    for (const row of rows) {
      const unitSlug = String(row.unitSlug || '').trim()
      const clientName = String(row.clientName || '').trim()
      if (!clientName) continue
      const key = clientName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')
      const loaded = loadedClients.get(key)
      loadedClients.set(key, { name: loaded?.name || clientName, usageCount: (loaded?.usageCount || 0) + 1 })
      if (unitSlug) {
        const clients = byUnit.get(unitSlug) || new Map<string, { name: string; usageCount: number }>()
        const existing = clients.get(key)
        clients.set(key, { name: existing?.name || clientName, usageCount: (existing?.usageCount || 0) + 1 })
        byUnit.set(unitSlug, clients)
      }
    }
    const suggestions = new Map([...byUnit.entries()].map(([unitSlug, clients]) => [unitSlug, [...clients.values()]]))
    // Legacy rows without unit_slug cannot be used to broaden a server query.
    // They remain only as a visible, read-only fallback until the local API is
    // refreshed, and are restricted to data already present in this table.
    suggestions.set('__loaded__', [...loadedClients.values()])
    return suggestions
  }, [rows])

  const isMissingAssignment = useCallback((value: string | null | undefined, emptyOption: string) => {
    const normalized = String(value || '').trim().toLowerCase()
    return !normalized || normalized === 'none' || normalized === emptyOption
  }, [])
  const hasMissingInjector = useCallback((row: AtendimentoAttendance) => isMissingAssignment(rowFormFor(row).injectorName, 'sem injetor'), [isMissingAssignment, rowFormFor])
  const hasMissingConsultant = useCallback((row: AtendimentoAttendance) => isMissingAssignment(rowFormFor(row).consultantName, 'sem consultor'), [isMissingAssignment, rowFormFor])
  const incompleteInjectorCount = useMemo(() => rows.filter(hasMissingInjector).length, [hasMissingInjector, rows])
  const incompleteConsultantCount = useMemo(() => rows.filter(hasMissingConsultant).length, [hasMissingConsultant, rows])
  const visibleSortedRows = useMemo(
    () => assignmentIssueFilter === 'injector'
      ? sortedRows.filter(hasMissingInjector)
      : assignmentIssueFilter === 'consultant'
        ? sortedRows.filter(hasMissingConsultant)
        : sortedRows,
    [assignmentIssueFilter, hasMissingConsultant, hasMissingInjector, sortedRows]
  )

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setSaving(true)
    const result = await deleteAtendimentoAttendance(deleteTarget.id, deleteTarget.revision)
    setSaving(false)
    if (!result.ok) {
      setError(result.error || 'Não foi possível excluir.')
      return
    }
    setDeleteTarget(null)
    conversionReportCacheRef.current.clear()
    await load()
    await loadManagement({ force: true })
  }

  const runGerenciaImport = async (dryRun: boolean) => {
    if (!canManageConsultant) {
      setImportResult('A importação é restrita a gestores e gerentes.')
      return
    }
    setImporting(true)
    setImportResult('')
    const result = await importGerenciaGoogleSheet(dryRun)
    setImporting(false)
    if (!result.ok) {
      setImportResult(result.error || 'Falha na importação da Gerência.')
      return
    }
    setImportResult(dryRun
      ? `Gerência dry-run: ${formatNumberBR(result.tabCount || result.tabs?.length || 0)} abas, ${formatNumberBR(result.rawRows || 0)} linhas brutas, ${formatNumberBR(result.schedules || 0)} dias de escala.`
      : `Gerência importada: ${formatNumberBR(result.tabCount || result.tabs?.length || 0)} abas, ${formatNumberBR(result.rawRows || 0)} linhas brutas, ${formatNumberBR(result.inventory || 0)} itens de inventário.`)
    if (!dryRun) {
      conversionReportCacheRef.current.clear()
      await load()
      await loadManagement({ force: true })
    }
  }

  const suggestDoctor = async () => {
    if (!form.unitSlug || !form.date) return
    setFormError('')
    const result = await fetchAtendimentoDoctorSuggestion(form.unitSlug, form.date)
    if (!result.ok) {
      setFormError(result.error || 'Não foi possível consultar a escala.')
      return
    }
    if (!result.doctorName) {
      setFormError('Não há injetor na escala para esta unidade/data.')
      return
    }
    updateForm(scheduledInjectorPatch(result.doctorId, result.doctorName))
  }

  const loadReportPreview = useCallback(async () => {
    setReportLoading(true)
    const result = await fetchAtendimentoReportPreview({
      unit: filters.unit,
      from: filters.from || filters.to || new Date().toISOString().slice(0, 10),
      to: filters.to || filters.from || new Date().toISOString().slice(0, 10),
    })
    setReportLoading(false)
    if (!result.ok) {
      setError(result.error || 'Não foi possível carregar a prévia de relatório.')
      return
    }
    setReportPreview(result)
  }, [filters.from, filters.to, filters.unit])

  const updateFilter = useCallback((patch: Partial<AtendimentoFilters>) => setFilters((prev) => ({ ...prev, ...patch })), [])
  const openImport = useCallback(() => {
    if (canManageConsultant) setImportOpen(true)
  }, [canManageConsultant])
  const updateForm = (patch: Partial<AtendimentoForm>) => setForm((prev) => ({ ...prev, ...patch }))
  const headerPeriodOperationalDays = useMemo(() => {
    const sections = managementConversionReport?.doctorRanking?.sections || []
    const unitSections = sections.filter((item) => !item.isAggregate && item.unitSlug !== 'all')
    const section = filters.unit === 'all'
      ? unitSections.length === 1 ? unitSections[0] : null
      : sections.find((item) => item.unitSlug === filters.unit)
    const value = Number(section?.goalPlan?.periodOperationalDays ?? section?.metrics?.periodOperationalDays?.weekValue)
    return Number.isFinite(value) && value >= 0 ? value : null
  }, [filters.unit, managementConversionReport])
  const localMirrorSummary = localMirrorStatus
    ? `${localMirrorStatus.mode.startsWith('google-sheets') ? 'Google Sheets' : 'Origem histórica'}${localMirrorStatus.syncedAt ? ` - sincronizado em ${new Date(localMirrorStatus.syncedAt).toLocaleString('pt-BR')}` : ' - ainda não sincronizado'}`
    : ''
  const localMirrorDetail = localMirrorStatus
    ? `${formatNumberBR(localMirrorStatus.attendances)} atendimentos${localMirrorStatus.minServiceDate && localMirrorStatus.maxServiceDate ? `, de ${localMirrorStatus.minServiceDate} a ${localMirrorStatus.maxServiceDate}` : ''}`
    : ''

  useAtendimentoHeaderBridge({
    loading,
    canManage: canManageConsultant,
    filters,
    units: (references?.units || []).map((unit) => ({ value: unit.slug, label: unit.name })),
    procedures: (references?.procedures || []).map((procedure) => ({ value: procedure.name, label: procedure.name })),
    injectors: filterInjectors.map((name) => ({ value: name, label: name })),
    activeUnitLabel,
    periodLabel: periodLabel(filters),
    periodOperationalDays: headerPeriodOperationalDays,
    latestImportLabel,
    localMirrorSummary,
    localMirrorDetail,
    total,
    refresh: load,
    refreshManagement: loadManagement,
    openImport,
    openReport: loadReportPreview,
    updateFilters: updateFilter,
  })

  return (
    <div className="atendimento-surface flex min-h-full flex-col gap-5 px-3 pb-6 pt-3 text-white sm:px-6">
      {error ? <ErrorBanner message={error} /> : null}

      <section className="rounded-2xl border border-slate-800/80 bg-slate-950/35 p-2 shadow-[0_16px_48px_rgba(2,6,23,0.16)]" data-testid="atendimento-analysis">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 rounded-xl px-2 py-1.5 text-left transition hover:bg-slate-900/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70"
          aria-expanded={analysisExpanded}
          aria-controls="atendimento-analysis-content"
          data-testid="atendimento-analysis-toggle"
          onClick={() => setAnalysisExpanded((current) => !current)}
        >
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-100">Análise do período</span>
            <span className="block text-[11px] text-slate-400">Ranking, metas e faixas são carregados somente quando necessários.</span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-sky-200">
            {analysisExpanded ? 'Recolher' : 'Ver análise'}
            {analysisExpanded ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
          </span>
        </button>
        {analysisExpanded ? (
      <div id="atendimento-analysis-content" className="space-y-2 pt-2" data-testid="atendimento-kpis">
        {analysisLoading ? (
          <div className="rounded-xl border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-xs text-sky-100" role="status" data-testid="atendimento-analysis-loading">
            Carregando análise do período…
          </div>
        ) : null}
        <span className="sr-only" data-testid="atendimento-conversion-ranking">
          {conversionRankingText}
        </span>
        {hiddenMetricTiles.length ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Ocultas</span>
            {hiddenMetricTiles.map((tile) => (
              <Button
                key={tile.key}
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 rounded-full border border-slate-800 bg-slate-900/55 px-2 text-[11px] text-slate-300 hover:border-sky-400/35 hover:bg-slate-800/80 hover:text-white"
                onClick={() => updateMetricTile(tile.key, { visible: true })}
              >
                <Eye className="h-3.5 w-3.5" />
                {tile.label}
              </Button>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] text-slate-400 hover:bg-slate-800/80 hover:text-white"
              onClick={() => setMetricLayout(metricTiles.map((tile) => ({ key: tile.key, visible: true })))}
            >
              Restaurar padrão
            </Button>
          </div>
        ) : null}
        <DragDropContext onDragEnd={handleMetricDragEnd}>
          <Droppable droppableId="atendimento-metrics" direction="horizontal">
            {(dropProvided) => (
              <div
                ref={dropProvided.innerRef}
                {...dropProvided.droppableProps}
                className="grid grid-cols-[repeat(auto-fit,minmax(11.25rem,1fr))] gap-2"
              >
                {visibleMetricTiles.length ? visibleMetricTiles.map((tile, index) => (
                  <Draggable key={tile.key} draggableId={`atendimento-metric-${tile.key}`} index={index}>
                    {(dragProvided, snapshot) => (
                      <div
                        ref={dragProvided.innerRef}
                        {...dragProvided.draggableProps}
                        className={`${tile.wrapperClassName || ''} ${snapshot.isDragging ? 'z-30' : ''}`}
                        style={dragProvided.draggableProps.style as CSSProperties}
                      >
                        <MetricTile
                          loading={loading}
                          label={tile.label}
                          value={tile.value}
                          detail={tile.detail}
                          icon={tile.icon}
                          tone={tile.tone}
                          description={tile.description}
                          subtitle={tile.subtitle}
                          badge={tile.badge}
                          progress={tile.progress}
                          content={tile.content}
                          dragHandleProps={dragProvided.dragHandleProps}
                          onHide={() => updateMetricTile(tile.key, { visible: false })}
                          isDragging={snapshot.isDragging}
                        />
                      </div>
                    )}
                  </Draggable>
                )) : (
                  <Card className={`${panelClass} md:col-span-2 lg:col-span-3 xl:col-span-4`}>
                    <CardContent className="flex min-h-[5rem] items-center justify-between gap-3 p-4 text-sm text-slate-300">
                      <span>Nenhuma métrica visível no resumo.</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="border-slate-700 bg-slate-900/60 text-slate-100 hover:bg-slate-800/80"
                        onClick={() => setMetricLayout(metricTiles.map((tile) => ({ key: tile.key, visible: true })))}
                      >
                        Restaurar métricas
                      </Button>
                    </CardContent>
                  </Card>
                )}
                {dropProvided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      </div>
        ) : (
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs leading-relaxed text-slate-400" data-testid="atendimento-analysis-collapsed">
            A análise detalhada está recolhida. Abra-a para calcular conversão, ranking, metas e faixas para os filtros atuais.
          </div>
        )}
      </section>

      <div className="grid min-h-0 flex-1 gap-4">
        <section className="min-h-0 overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-950/45 shadow-[0_20px_80px_rgba(2,6,23,0.24)] backdrop-blur-xl" aria-label="Atendimentos">
          {filters.unit === 'all' ? (
            <div className="flex items-center justify-end gap-3 border-b border-slate-800/75 px-3 py-2">
              <div className="flex flex-wrap items-center justify-end gap-1.5" data-testid="atendimento-unit-legend" aria-label="Legenda de unidades">
                {unitLegend.map((unit) => (
                  <TooltipLabel key={unit.slug} label={unit.name} description="Cor aplicada nas linhas da tabela para identificar a unidade quando todas estão selecionadas.">
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold ${unit.visual.badgeClassName}`}>
                      <span className={`h-2 w-2 rounded-full ${unit.visual.dotClassName}`} />
                      {unit.name}
                    </span>
                  </TooltipLabel>
                ))}
              </div>
            </div>
          ) : null}
          {reportPreview ? (
            <div className="mx-3 mt-3 grid gap-2 lg:grid-cols-2">
              {reportPreview ? (
                <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-50">
                  Prévia: {formatNumberBR(reportPreview.summary.attendances)} registros, {formatNumberBR(reportPreview.summary.quantityTotal || 0)} em quantidade, {formatCurrencyBRL(reportPreview.summary.totalValue)} total, {formatCurrencyBRL(reportPreview.summary.remuneration)} remuneração estimada (política legada em validação).
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="min-h-0">
            <div className="max-h-[56vh] overflow-y-auto overflow-x-hidden" data-testid="atendimento-table-scroll" onScroll={handleAttendanceScroll}>
              <table data-testid="atendimento-table" className="w-full min-w-0 table-fixed caption-bottom border-separate border-spacing-0 text-sm">
                <colgroup>
                  <col className="w-[11%]" />
                  <col className="w-[24%]" />
                  <col className="w-[16%]" />
                  <col className="w-[18%]" />
                  <col className="w-[18%]" />
                  <col className="w-[13%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-white/10">
                    <SortableAttendanceHead sortKey="date" label="Data" align="center" activeKey={attendanceSortKey} sortDir={attendanceSortDir} onSort={handleAttendanceSort} stickyLeft testId="atendimento-table-head-date" />
                    <SortableAttendanceHead sortKey="clientName" label="Cliente" align="center" activeKey={attendanceSortKey} sortDir={attendanceSortDir} onSort={handleAttendanceSort}>
                      <span className="block text-[10px] font-normal leading-tight text-slate-500" data-testid="atendimento-distinct-clients">
                        {formatNumberBR(overview?.summary.distinctClients || 0)} distintos
                      </span>
                    </SortableAttendanceHead>
                    <SortableAttendanceHead sortKey="procedureName" label="Procedimento" align="center" activeKey={attendanceSortKey} sortDir={attendanceSortDir} onSort={handleAttendanceSort} />
                    <SortableAttendanceHead
                      sortKey="injectorName"
                      label="Injetor"
                      align="center"
                      activeKey={attendanceSortKey}
                      sortDir={attendanceSortDir}
                      onSort={handleAttendanceSort}
                      action={incompleteInjectorCount ? (
                        <TooltipLabel label={assignmentIssueFilter === 'injector' ? 'Mostrar todos os atendimentos' : 'Filtrar injetores pendentes'} description={`${formatNumberBR(incompleteInjectorCount)} atendimento${incompleteInjectorCount === 1 ? '' : 's'} sem injetor definido.`}>
                          <button type="button" className={`inline-flex h-5 w-5 items-center justify-center rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300/60 ${assignmentIssueFilter === 'injector' ? 'border-rose-300/80 bg-rose-400/20 text-rose-100' : 'border-rose-300/35 bg-rose-400/10 text-rose-200 hover:bg-rose-400/20'}`} onClick={() => setAssignmentIssueFilter((current) => current === 'injector' ? null : 'injector')} aria-pressed={assignmentIssueFilter === 'injector'} aria-label="Filtrar atendimentos sem injetor" data-testid="atendimento-incomplete-filter">
                            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                          </button>
                        </TooltipLabel>
                      ) : null}
                    />
                    <SortableAttendanceHead
                      sortKey="consultantName"
                      label="Consultor"
                      align="center"
                      activeKey={attendanceSortKey}
                      sortDir={attendanceSortDir}
                      onSort={handleAttendanceSort}
                      action={incompleteConsultantCount ? (
                        <TooltipLabel label={assignmentIssueFilter === 'consultant' ? 'Mostrar todos os atendimentos' : 'Filtrar consultores pendentes'} description={`${formatNumberBR(incompleteConsultantCount)} atendimento${incompleteConsultantCount === 1 ? '' : 's'} sem consultor definido.`}>
                          <button type="button" className={`inline-flex h-5 w-5 items-center justify-center rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300/60 ${assignmentIssueFilter === 'consultant' ? 'border-rose-300/80 bg-rose-400/20 text-rose-100' : 'border-rose-300/35 bg-rose-400/10 text-rose-200 hover:bg-rose-400/20'}`} onClick={() => setAssignmentIssueFilter((current) => current === 'consultant' ? null : 'consultant')} aria-pressed={assignmentIssueFilter === 'consultant'} aria-label="Filtrar atendimentos sem consultor" data-testid="atendimento-incomplete-consultant-filter">
                            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                          </button>
                        </TooltipLabel>
                      ) : null}
                    />
                    <SortableAttendanceHead sortKey="value" label="Valor" align="center" activeKey={attendanceSortKey} sortDir={attendanceSortDir} onSort={handleAttendanceSort} />
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-sky-400/20 bg-sky-400/[0.035] text-slate-100">
                    <td className="sticky left-0 z-10 border-b border-slate-800 bg-slate-950 px-2 py-2 text-center align-middle shadow-[1px_0_0_rgba(30,41,59,0.65)]">
                      <AtendimentoDatePicker
                        value={inlineForm.date}
                        onValueChange={(date) => updateInlineForm({ date })}
                        className="h-8 min-w-0 w-full"
                        testId="atendimento-inline-date"
                        ariaLabel="Data do novo atendimento"
                      />
                    </td>
                    <td className="border-b border-slate-800 px-2 py-2 text-center align-middle">
                      <AtendimentoClientAutocomplete
                        value={inlineForm.clientName}
                        unitSlug={inlineForm.unitSlug}
                        fallbackSuggestions={clientSuggestionsByUnit.get(inlineForm.unitSlug) || clientSuggestionsByUnit.get('__loaded__')}
                        onValueChange={(clientName) => updateInlineForm({ clientName })}
                        className="h-8 min-w-0 w-full border-slate-700 bg-slate-950/70 px-2 text-center text-xs text-white placeholder:text-slate-500"
                        placeholder="Cliente"
                        data-testid="atendimento-inline-client"
                        aria-label="Cliente do novo atendimento"
                      />
                    </td>
                    <td className="border-b border-slate-800 px-2 py-2 text-center align-middle">
                      <Select value={inlineForm.procedureName} onValueChange={updateInlineProcedure}>
                        <SelectTrigger className="h-8 min-w-0 w-full justify-center border-slate-700 bg-slate-950/70 px-2 text-center text-xs text-white" data-testid="atendimento-inline-procedure" aria-label="Procedimento do novo atendimento">
                          <SelectValue placeholder="Procedimento" />
                        </SelectTrigger>
                        <SelectContent>{(references?.procedures || []).map((item) => <SelectItem key={item.name} value={item.name}>{item.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                    <td className="border-b border-slate-800 px-2 py-2 text-center align-middle">
                      {isConsultant ? (
                        <LockedInjectorValue
                          name={inlineForm.injectorName}
                          unresolved={!inlineForm.injectorId}
                          compact
                          testId="atendimento-inline-injector-locked"
                          ariaLabel="Injetor definido pela Escala; alteração restrita a gestão"
                        />
                      ) : (
                        <Select value={inlineForm.injectorName || 'none'} onValueChange={(injectorName) => updateInlineForm(injectorName === 'none' ? { injectorName: '', injectorId: null } : professionalIdentityPatch(references?.professionals || [], 'injector', injectorName))}>
                          <SelectTrigger className="h-8 min-w-0 w-full justify-center border-slate-700 bg-slate-950/70 px-2 text-center text-xs text-white" data-testid="atendimento-inline-injector" aria-label="Injetor do novo atendimento">
                            <SelectValue placeholder="Injetor" />
                          </SelectTrigger>
                          <SelectContent><SelectItem value="none">Sem injetor</SelectItem>{inlineInjectors.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
                        </Select>
                      )}
                    </td>
                    <td className="border-b border-slate-800 px-2 py-2 text-center align-middle">
                      {canManageConsultant ? (
                        <Select value={inlineForm.consultantName || 'none'} onValueChange={(consultantName) => updateInlineForm(consultantName === 'none' ? { consultantName: '', consultantId: null } : professionalIdentityPatch(references?.professionals || [], 'consultant', consultantName))}>
                          <SelectTrigger className="h-8 min-w-0 w-full justify-center border-slate-700 bg-slate-950/70 px-2 text-center text-xs text-white" data-testid="atendimento-inline-consultant" aria-label="Consultor do novo atendimento">
                            <SelectValue placeholder="Consultor" />
                          </SelectTrigger>
                          <SelectContent><SelectItem value="none">Sem consultor</SelectItem>{inlineConsultants.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
                        </Select>
                      ) : (
                        <LockedConsultantValue
                          name={consultantDisplayForUnit(inlineForm.unitSlug, inlineForm.consultantName).name}
                          unresolved={consultantDisplayForUnit(inlineForm.unitSlug, inlineForm.consultantName).unresolved}
                          compact
                          testId="atendimento-inline-consultant-locked"
                          ariaLabel="Consultor atribuído automaticamente"
                        />
                      )}
                    </td>
                    <td className="border-b border-slate-800 px-3 py-2 text-center align-middle text-xs font-semibold whitespace-nowrap text-emerald-100" data-testid="atendimento-inline-preview">
                      <div className="flex items-center justify-center gap-2">
                        <span>{formatCurrencyBRL(inlinePreviewValue)}</span>
                        <Button
                          type="button"
                          size="sm"
                          className="h-7 px-2 text-[11px]"
                          disabled={saving || !hasAtendimentoInlineDraft(inlineForm)}
                          onClick={() => void saveInlineForm()}
                          data-testid="atendimento-inline-save"
                        >
                          {saving ? 'Salvando…' : 'Salvar'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                  {inlineError ? (
                    <tr>
                      <td colSpan={6} className="border-b border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-100">
                        {inlineError}
                      </td>
                    </tr>
                  ) : null}
                  {visibleSortedRows.map((row) => {
                    const rowForm = rowFormFor(row)
                    const rowUnitName = rowForm.unitName || references?.units.find((unit) => unit.slug === rowForm.unitSlug)?.name || rowForm.unitSlug
                    const rowShift = determineAtendimentoShift(rowUnitName)
                    // Registros históricos podem apontar para um profissional que já não está
                    // ativo na escala atual. Mantemos esse valor visível e editável sem
                    // reintroduzi-lo como opção para novos lançamentos.
                    const rowInjectors = canonicalProfessionalOptions([
                      ...filterProfessionalsByUnitRole(references?.professionals || [], rowUnitName, 'Injetor'),
                      rowForm.injectorName,
                    ])
                    const rowConsultants = canonicalProfessionalOptions([
                      ...filterProfessionalsByUnitRole(references?.professionals || [], rowUnitName, 'Consultor', rowShift),
                      rowForm.consultantName,
                    ])
                    const rowProcedure = (references?.procedures || []).find((item) => item.name === rowForm.procedureName)
                    const rowValue = calculateAtendimentoValue(rowForm)
                    const unitVisual = filters.unit === 'all' ? atendimentoUnitVisual(row.unitSlug || row.unitName) : null
                    const assignmentIsMissing = (value: string | null | undefined, emptyOption: string) => {
                      const normalized = String(value || '').trim().toLowerCase()
                      return !normalized || normalized === 'none' || normalized === emptyOption
                    }
                    const missingInjector = assignmentIsMissing(rowForm.injectorName, 'sem injetor')
                    const missingConsultant = assignmentIsMissing(rowForm.consultantName, 'sem consultor')
                    const hasMissingProfessional = missingInjector || missingConsultant
                    const rowColor = atendimentoProfessionalColor(rowForm.injectorName, references?.professionals || [])
                    const rowStyle = hasMissingProfessional
                      ? { backgroundColor: 'rgba(127, 29, 29, 0.22)', boxShadow: 'inset 3px 0 0 rgba(251, 113, 133, 0.82)' }
                      : { background: `linear-gradient(90deg, ${atendimentoColorWithAlpha(rowColor, 0.2)}, ${atendimentoColorWithAlpha(rowColor, 0.06)})`, boxShadow: `inset 3px 0 0 ${atendimentoColorWithAlpha(rowColor, 0.72)}` }
                    return (
                      <React.Fragment key={row.id}>
                        <tr className={`group border-b border-slate-800/80 text-slate-200 transition hover:brightness-110 ${unitVisual ? 'relative' : ''}`} style={rowStyle} data-unit={row.unitSlug || row.unitName}>
                          <td className={`sticky left-0 z-10 border-b border-slate-800 bg-transparent px-2 py-2 text-center align-middle shadow-[1px_0_0_rgba(30,41,59,0.65)] ${unitVisual ? 'relative' : ''}`}>
                            {unitVisual ? <span className={`absolute left-0 top-0 h-full w-1 ${unitVisual.stripeClassName}`} aria-hidden="true" /> : null}
                            <AtendimentoDatePicker
                              value={rowForm.date}
                              onValueChange={(date) => commitRowPatch(row, { date })}
                              className="h-8 min-w-0 w-full"
                              ariaLabel={`Data de ${row.clientName}`}
                            />
                          </td>
                          <td className="border-b border-slate-800 bg-transparent px-2 py-2 text-center align-middle">
                            <AtendimentoClientAutocomplete
                              value={rowForm.clientName}
                              unitSlug={rowForm.unitSlug}
                              fallbackSuggestions={clientSuggestionsByUnit.get(rowForm.unitSlug) || clientSuggestionsByUnit.get('__loaded__')}
                              onValueChange={(clientName) => updateRowDraft(row, { clientName })}
                              onClientSelected={(clientName) => commitRowPatch(row, { clientName })}
                              onBlur={() => void commitRowForm(row)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') event.currentTarget.blur()
                              }}
                              className="h-8 min-w-0 w-full border-transparent bg-transparent px-1 text-center text-sm font-medium text-white hover:border-slate-700 hover:bg-slate-950/70 focus:border-sky-400/40 focus:bg-slate-950/80"
                              aria-label={`Cliente ${row.clientName}`}
                              data-testid={`atendimento-row-client-${row.id}`}
                            />
                          </td>
                          <td className="border-b border-slate-800 bg-transparent px-2 py-2 text-center align-middle">
                            <Select value={rowForm.procedureName} onValueChange={(procedureName) => {
                              const selectedProcedure = (references?.procedures || []).find((item) => item.name === procedureName)
                              commitRowPatch(row, { procedureName, code: selectedProcedure?.codes?.[0] || rowProcedure?.codes?.[0] || rowForm.code })
                            }}>
                              <SelectTrigger className="h-8 min-w-0 w-full justify-center border-transparent bg-transparent px-1 text-center text-sm text-slate-200 hover:border-slate-700 hover:bg-slate-950/70 focus:border-sky-400/40" aria-label={`Procedimento de ${row.clientName}`}>
                                <SelectValue placeholder="Procedimento" />
                              </SelectTrigger>
                              <SelectContent>{(references?.procedures || []).map((item) => <SelectItem key={item.name} value={item.name}>{item.name}</SelectItem>)}</SelectContent>
                            </Select>
                          </td>
                          <td className="border-b border-slate-800 bg-transparent px-2 py-2 text-center align-middle">
                            <div className="relative">
                              {isConsultant ? (
                                <LockedInjectorValue
                                  name={rowForm.injectorName}
                                  unresolved={missingInjector}
                                  compact
                                  testId={`atendimento-row-injector-locked-${row.id}`}
                                  ariaLabel={`Injetor de ${row.clientName}; definido pela Escala`}
                                />
                              ) : (
                                <Select value={rowForm.injectorName || 'none'} onValueChange={(injectorName) => commitRowPatch(row, injectorName === 'none' ? { injectorName: '', injectorId: null } : professionalIdentityPatch(references?.professionals || [], 'injector', injectorName))}>
                                  <SelectTrigger className={`h-8 min-w-0 w-full justify-center border-transparent bg-transparent px-1 text-center text-sm text-slate-200 hover:border-slate-700 hover:bg-slate-950/70 focus:border-sky-400/40 ${missingInjector ? 'border-rose-400/50 bg-rose-950/35 pr-7 text-rose-100' : ''}`} aria-label={`Injetor de ${row.clientName}`}>
                                    <SelectValue placeholder="Injetor" />
                                  </SelectTrigger>
                                  <SelectContent><SelectItem value="none">Sem injetor</SelectItem>{rowInjectors.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
                                </Select>
                              )}
                              {missingInjector ? <TooltipLabel label="Injetor ausente" description="Este atendimento não possui um profissional responsável. Selecione um injetor antes de validar o lançamento."><span className="pointer-events-auto absolute right-2 top-1/2 -translate-y-1/2 text-rose-200"><AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /></span></TooltipLabel> : null}
                            </div>
                          </td>
                          <td className="border-b border-slate-800 bg-transparent px-2 py-2 text-center align-middle">
                            <div className="relative">
                              {canManageConsultant ? (
                                <Select value={rowForm.consultantName || 'none'} onValueChange={(consultantName) => commitRowPatch(row, consultantName === 'none' ? { consultantName: '', consultantId: null } : professionalIdentityPatch(references?.professionals || [], 'consultant', consultantName))}>
                                  <SelectTrigger className={`h-8 min-w-0 w-full justify-center border-transparent bg-transparent px-1 text-center text-sm text-slate-200 hover:border-slate-700 hover:bg-slate-950/70 focus:border-sky-400/40 ${missingConsultant ? 'border-rose-400/50 bg-rose-950/35 pr-7 text-rose-100' : ''}`} aria-label={`Consultor de ${row.clientName}`}>
                                    <SelectValue placeholder="Consultor" />
                                  </SelectTrigger>
                                  <SelectContent><SelectItem value="none">Sem consultor</SelectItem>{rowConsultants.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
                                </Select>
                              ) : (
                                <LockedConsultantValue
                                  name={rowForm.consultantName}
                                  compact
                                  testId={`atendimento-row-consultant-locked-${row.id}`}
                                  ariaLabel={`Consultor de ${row.clientName}; alteração restrita a gestão`}
                                />
                              )}
                              {missingConsultant ? <TooltipLabel label="Consultor ausente" description="Este atendimento não possui a pessoa que lançou o registro. Selecione um consultor antes de validar o lançamento."><span className="pointer-events-auto absolute right-2 top-1/2 -translate-y-1/2 text-rose-200"><AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /></span></TooltipLabel> : null}
                            </div>
                          </td>
                          <td className="border-b border-slate-800 bg-transparent px-3 py-2 text-center align-middle text-sm font-semibold whitespace-nowrap text-white">
                            {rowSavingId === row.id ? <span className="text-[11px] text-sky-200">Salvando...</span> : formatCurrencyBRL(rowValue)}
                          </td>
                        </tr>
                        {rowErrors[row.id] ? (
                          <tr>
                            <td colSpan={6} className="border-b border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-100">
                              {rowErrors[row.id]}
                            </td>
                          </tr>
                        ) : null}
                      </React.Fragment>
                    )
                  })}
                  {!visibleSortedRows.length ? (
                    <tr><td colSpan={6} className="py-8 text-center text-slate-400">{assignmentIssueFilter ? 'Nenhum atendimento com essa pendência encontrado.' : 'Nenhum atendimento encontrado.'}</td></tr>
                  ) : null}
                  {loadingMoreRows ? (
                    <tr><td colSpan={6} className="py-4 text-center text-xs text-sky-200">Carregando mais atendimentos...</td></tr>
                  ) : null}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5} className="sticky bottom-0 z-30 border-t border-slate-800 bg-slate-950 px-3 py-2 text-xs font-medium text-slate-400">
                      <div className="flex items-center gap-2">
                        <TooltipLabel label="Linhas carregadas" description="Quantidade carregada na tabela sobre o total filtrado. Mais linhas são carregadas automaticamente ao chegar ao fim da lista.">
                          <span className="rounded-full border border-slate-700 bg-slate-900/70 px-2 py-0.5 text-[10px] font-semibold text-slate-200" data-testid="atendimento-loaded-count">
                            {formatNumberBR(rows.length)}/{formatNumberBR(total)}
                          </span>
                        </TooltipLabel>
                        <span className="ml-auto pr-1 text-right">Total</span>
                      </div>
                    </td>
                    <td className="sticky bottom-0 z-30 border-t border-slate-800 bg-slate-950 px-3 py-2 text-right text-sm font-bold text-emerald-100" data-testid="atendimento-table-revenue">
                      {formatCurrencyBRL(overview?.summary.totalValue || 0)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </section>

        <AtendimentoChartsPanel overview={overview} professionals={references?.professionals || []} slots={chartSlots} onSlotsChange={setChartSlots} />
      </div>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="border-slate-800 bg-slate-950 text-slate-100 sm:max-w-lg" data-testid="atendimento-import-modal">
          <DialogHeader>
            <DialogTitle>Importação da Gerência</DialogTitle>
            <DialogDescription className="text-slate-300">
              Use dry-run para conferir a planilha antes de gravar. O CRM mantém snapshot bruto e dados normalizados para Atendimento, Insumos, Escala e Faturamento.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/55 p-3 text-sm text-slate-300">
              Inventário de brindes é exposto como feed de Insumos; equipe e escala como feed de Escala; Comercial/Caixa aparecem em Faturamento.
            </div>
            {importResult ? <div className="rounded-2xl border border-sky-400/25 bg-sky-400/10 p-3 text-sm text-sky-50">{importResult}</div> : null}
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="outline" className="border-slate-700 bg-slate-900/60 text-white hover:bg-slate-800/80" disabled={importing} onClick={() => runGerenciaImport(true)} data-testid="gerencia-import-dry-run">
              <Download className="h-4 w-4" />Dry-run
            </Button>
            <Button disabled={importing} onClick={() => runGerenciaImport(false)} data-testid="gerencia-import-commit">
              {importing ? 'Importando...' : 'Importar Gerência'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="border-slate-800 bg-slate-950 text-slate-100 sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{form.id ? 'Editar atendimento' : 'Novo atendimento'}</DialogTitle>
            <DialogDescription className="text-slate-300">O valor segue a regra migrada da planilha.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 md:grid-cols-3">
            <FormField label="Unidade">
              <Select value={form.unitSlug} onValueChange={(unitSlug) => {
                const unit = references?.units.find((item) => item.slug === unitSlug)
                updateForm({ unitSlug, unitName: unit?.name || unitSlug })
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{(references?.units || []).map((unit) => <SelectItem key={unit.slug} value={unit.slug}>{unit.name}</SelectItem>)}</SelectContent>
              </Select>
            </FormField>
            <FormField label="Data"><Input type="date" value={form.date} onChange={(e) => updateForm({ date: e.target.value })} data-testid="atendimento-field-date" /></FormField>
            <FormField label="Cliente"><Input value={form.clientName} onChange={(e) => updateForm({ clientName: e.target.value })} data-testid="atendimento-field-client" /></FormField>
            <FormField label="Procedimento">
              <Select value={form.procedureName} onValueChange={(procedureName) => updateForm({ procedureName, code: '' })}>
                <SelectTrigger data-testid="atendimento-field-procedure"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{(references?.procedures || []).map((item) => <SelectItem key={item.name} value={item.name}>{item.name}</SelectItem>)}</SelectContent>
              </Select>
            </FormField>
            <FormField label="Código">
              <Select value={form.code} onValueChange={(code) => updateForm({ code })}>
                <SelectTrigger data-testid="atendimento-field-code"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{allowedCodes.map((code) => <SelectItem key={code} value={code}>{code}</SelectItem>)}</SelectContent>
              </Select>
            </FormField>
            <FormField label="Quantidade"><Input type="number" min="0" step="1" value={form.quantity} onChange={(e) => updateForm({ quantity: Number(e.target.value) })} data-testid="atendimento-field-quantity" /></FormField>
            <FormField label="Outro"><Input value={String(form.otherValue)} onChange={(e) => updateForm({ otherValue: parseBrazilCurrency(e.target.value) })} data-testid="atendimento-field-other" /></FormField>
            <FormField label="Injetor">
              {isConsultant ? (
                <LockedInjectorValue
                  name={form.injectorName}
                  unresolved={!form.injectorId}
                  testId="atendimento-field-injector-locked"
                  ariaLabel="Injetor definido pela Escala; alteração restrita a gestão"
                />
              ) : (
                <div className="flex gap-2">
                  <Select value={form.injectorName || 'none'} onValueChange={(injectorName) => updateForm(injectorName === 'none' ? { injectorName: '', injectorId: null } : professionalIdentityPatch(references?.professionals || [], 'injector', injectorName))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="none">Sem injetor</SelectItem>{injectors.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button type="button" variant="outline" className="shrink-0" onClick={suggestDoctor}>Escala</Button>
                </div>
              )}
            </FormField>
            <FormField label="Consultor">
              {canManageConsultant ? (
                <Select value={form.consultantName || 'none'} onValueChange={(consultantName) => updateForm(consultantName === 'none' ? { consultantName: '', consultantId: null } : professionalIdentityPatch(references?.professionals || [], 'consultant', consultantName))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">Sem consultor</SelectItem>{consultants.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
                </Select>
              ) : (
                <LockedConsultantValue
                  name={form.id ? form.consultantName : consultantDisplayForUnit(form.unitSlug, form.consultantName).name}
                  unresolved={!form.id && consultantDisplayForUnit(form.unitSlug, form.consultantName).unresolved}
                  testId="atendimento-field-consultant-locked"
                  ariaLabel="Consultor atribuído automaticamente; alteração restrita a gestão"
                />
              )}
            </FormField>
            <div className="flex items-center gap-3 rounded-lg border border-white/10 p-3">
              <Switch checked={form.discount} onCheckedChange={(discount) => updateForm({ discount })} />
              <span className="text-sm text-slate-200">Desconto</span>
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-white/10 p-3">
              <Switch checked={form.roundValue} onCheckedChange={(roundValue) => updateForm({ roundValue })} />
              <span className="text-sm text-slate-200">Arredondar</span>
            </div>
            <div className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 p-3">
              <div className="text-xs text-emerald-100/70">Valor previsto</div>
              <div className="text-xl font-bold text-emerald-50">{formatCurrencyBRL(previewValue)}</div>
            </div>
            <FormField label="Observação">
              <Input className="md:col-span-3" value={form.observation} onChange={(e) => updateForm({ observation: e.target.value })} />
            </FormField>
          </div>
          {formError ? <div className="rounded-lg border border-red-400/30 bg-red-500/10 p-2 text-sm text-red-100">{formError}</div> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancelar</Button>
            <Button onClick={saveForm} disabled={saving} data-testid="atendimento-save">{saving ? 'Salvando...' : 'Salvar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="border-slate-800 bg-slate-950 text-slate-100 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir atendimento?</DialogTitle>
            <DialogDescription className="text-slate-300">Esta ação remove o lançamento da visão operacional e registra auditoria.</DialogDescription>
          </DialogHeader>
          <div className="text-sm text-slate-200">{deleteTarget?.clientName} · {deleteTarget?.procedureName}</div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={saving} data-testid="atendimento-delete-confirm">Excluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
