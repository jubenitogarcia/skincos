import React, { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { DragDropContext, Draggable, Droppable, type DraggableProvidedDragHandleProps, type DropResult } from '@hello-pangea/dnd'
import {
  AlertTriangle,
  AreaChart as AreaChartIcon,
  ArrowDownToLine,
  ArrowUpToLine,
  BarChart3,
  Calculator,
  CalendarRange,
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
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/dialog'
import { Input } from '@/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { Switch } from '@/switch'
import { TooltipLabel } from '@/tooltip'
import {
  emitAtendimentoClinicaHeaderState,
  subscribeAtendimentoClinicaHeaderAction,
} from '@/atendimentoClinicaHeaderBridge'
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
  type AtendimentoClinicaFilters,
  type AtendimentoClinicaForm,
} from '@/atendimentoClinicaDomain'
import {
  createAtendimentoAttendance,
  deleteAtendimentoAttendance,
  fetchAtendimentoAttendances,
  fetchAtendimentoDoctorSuggestion,
  fetchAtendimentoManagementCatalog,
  fetchAtendimentoManagementConversionReport,
  fetchAtendimentoOverview,
  fetchAtendimentoReportPreview,
  fetchAtendimentoReferences,
  importGerenciaGoogleSheet,
  updateAtendimentoAttendance,
  type AtendimentoClinicaAttendance,
  type AtendimentoClinicaOverview,
  type AtendimentoClinicaReferences,
  type AtendimentoClinicaReportPreview,
  type AtendimentoManagementCatalog,
  type AtendimentoManagementConversionReport,
} from '@/atendimentoClinicaApi'

function monthLabel(value: string) {
  const [year, month] = String(value || '').split('-').map(Number)
  if (!year || !month) return value
  const label = new Date(year, month - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
  return label.replace('.', '')
}

function asForm(row: AtendimentoClinicaAttendance): AtendimentoClinicaForm {
  return {
    id: row.id,
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
    injectorName: row.injectorName,
    consultantName: row.consultantName,
    observation: row.observation || '',
  }
}

function hasAtendimentoInlineDraft(form: AtendimentoClinicaForm) {
  return Boolean(
    form.date ||
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

const panelClass = 'border-slate-800/80 bg-slate-950/60 shadow-[0_20px_80px_rgba(2,6,23,0.35)] backdrop-blur-xl'
const ATENDIMENTO_METRIC_LAYOUT_KEY = 'skincos.atendimentoClinica.layout.metrics.v2'
const ATENDIMENTO_CHART_LAYOUT_KEY = 'skincos.atendimentoClinica.layout.charts.v2'
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
  tooltip?: MetricTooltipSpec
  icon: LucideIcon
  tone: AtendimentoMetricTone
}
type MetricTooltipSpec = {
  what: string
  calculation: string
  usage: string
}

type AtendimentoSortKey = 'date' | 'clientName' | 'procedureName' | 'injectorName' | 'consultantName' | 'value'
type AtendimentoSortDir = 'asc' | 'desc'
type AtendimentoChartPreset = 'monthly' | 'procedures' | 'injectors' | 'consultants'
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
  { presetId: 'procedures', metric: 'value', view: 'bar', topN: 5 },
  { presetId: 'injectors', metric: 'value', view: 'bar', topN: 5 },
  { presetId: 'consultants', metric: 'value', view: 'bar', topN: 5 },
]

const ATENDIMENTO_CHART_PRESETS: Array<{ id: AtendimentoChartPreset; label: string; icon: LucideIcon }> = [
  { id: 'monthly', label: 'Série mensal', icon: TrendingUp },
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
      return { presetId, metric, view, topN }
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
  tooltipAlign = 'left',
  children,
  className = '',
  type = 'button',
  ...buttonProps
}, ref) => {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={`group relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-700 bg-slate-900/60 text-slate-100 transition hover:border-sky-400/40 hover:bg-slate-800/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/55 ${className}`}
      {...buttonProps}
    >
      {children}
      <span className={`pointer-events-none absolute top-[calc(100%+0.55rem)] z-50 hidden w-max max-w-64 rounded-xl border border-white/12 bg-slate-950/96 px-3 py-2 text-left text-[11px] text-slate-50 shadow-[0_16px_36px_rgba(15,23,42,0.34)] backdrop-blur-xl group-hover:block group-focus-visible:block ${tooltipAlign === 'right' ? 'right-0' : 'left-0'}`}>
        <span className="block font-medium leading-tight text-white">{label}</span>
        {description ? <span className="mt-1 block text-[10px] leading-snug text-slate-300/92">{description}</span> : null}
      </span>
    </button>
  )
})
IconOnlyAction.displayName = 'IconOnlyAction'

function SortableAttendanceHead({
  sortKey,
  label,
  align = 'left',
  activeKey,
  sortDir,
  onSort,
  children,
  className = '',
  stickyLeft = false,
  testId,
}: {
  sortKey: AtendimentoSortKey
  label: string
  align?: 'left' | 'right'
  activeKey: AtendimentoSortKey
  sortDir: AtendimentoSortDir
  onSort: (key: AtendimentoSortKey) => void
  children?: React.ReactNode
  className?: string
  stickyLeft?: boolean
  testId?: string
}) {
  const isActive = activeKey === sortKey
  return (
    <th
      className={`${stickyLeft ? 'sticky left-0 top-0 z-40 shadow-[1px_0_0_rgba(30,41,59,0.9)]' : 'sticky top-0 z-30'} h-12 border-b border-slate-800 bg-slate-950 px-3 align-middle font-medium text-slate-300 ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}
      data-testid={testId}
    >
      <button
        type="button"
        className={`inline-flex max-w-full select-none items-center gap-1.5 rounded-sm px-0.5 text-xs leading-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/40 ${align === 'right' ? 'justify-end' : 'justify-start'} ${isActive ? 'text-white' : 'text-blue-100/80'} hover:underline`}
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
      <div><span className="font-semibold text-slate-100">Cálculo:</span> {info.calculation}</div>
      <div><span className="font-semibold text-slate-100">Uso:</span> {info.usage}</div>
    </div>
  )
}

function MetricTooltip({
  label,
  info,
  children,
}: {
  label: string
  info?: MetricTooltipSpec
  children: React.ReactNode
}) {
  if (!info) return <>{children}</>
  return (
    <TooltipLabel
      label={label}
      description={<MetricTooltipContent info={info} />}
      contentClassName="max-w-[22rem]"
    >
      {children}
    </TooltipLabel>
  )
}

function MetricGroupContent({ rows }: { rows: AtendimentoMetricGroupRow[] }) {
  return (
    <div className="grid gap-1.5 pt-0.5">
      {rows.map((row) => {
        const RowIcon = row.icon
        return (
          <div key={row.key} className="flex min-w-0 items-center gap-2">
            <MetricTooltip label={row.label} info={row.tooltip}>
              <span
                className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${metricToneClass(row.tone)}`}
                aria-label={`Detalhes de ${row.label}`}
              >
                <RowIcon className="h-3 w-3" />
              </span>
            </MetricTooltip>
            <div className="min-w-0 flex-1">
              <MetricTooltip label={row.label} info={row.tooltip}>
                <span className="inline-flex max-w-full items-center gap-1 truncate text-[11px] font-medium leading-tight text-slate-300">
                  <span className="truncate">{row.label}</span>
                  {row.tooltip ? <Info className="h-2.5 w-2.5 shrink-0 text-slate-500" /> : null}
                </span>
              </MetricTooltip>
              {row.detail ? <div className="truncate text-[10px] leading-tight text-slate-500">{row.detail}</div> : null}
            </div>
            <div className="shrink-0 text-[11px] font-semibold text-white">{row.value}</div>
          </div>
        )
      })}
    </div>
  )
}

function MetricTile({
  label,
  value,
  detail,
  icon: Icon,
  loading,
  tone = 'sky',
  description,
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
    <div className="min-w-0 truncate text-[11px] font-medium leading-tight text-slate-400">
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
            {description ? (
              <TooltipLabel label={label} description={description}>
                {labelContent}
              </TooltipLabel>
            ) : labelContent}
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

function periodLabel(filters: AtendimentoClinicaFilters) {
  if (filters.from && filters.to) return `${filters.from.split('-').reverse().join('/')} até ${filters.to.split('-').reverse().join('/')}`
  if (filters.from) return `A partir de ${filters.from.split('-').reverse().join('/')}`
  if (filters.to) return `Até ${filters.to.split('-').reverse().join('/')}`
  return 'Todos os períodos'
}

function formatIsoDateBR(date?: string) {
  const [year, month, day] = String(date || '').slice(0, 10).split('-')
  if (!year || !month || !day) return ''
  return `${day}/${month}/${year}`
}

function inferGoalMonth(filters: AtendimentoClinicaFilters) {
  const base = filters.to || filters.from || new Date().toISOString().slice(0, 10)
  return /^\d{4}-\d{2}/.test(base) ? base.slice(0, 7) : new Date().toISOString().slice(0, 7)
}

const CONVERSION_METRIC_DEFINITIONS = [
  { key: 'total', label: 'TOTAL', description: 'Resultado total dos doutores elegíveis no período de conversão.', calculation: 'Soma do realizado dos injetores ativos elegíveis no período.', usage: 'Base de média, mediana, corte, níveis e ranking.' },
  { key: 'rankedDoctorTotal', label: 'Total ranqueável', description: 'Soma apenas dos atendimentos atribuídos aos doutores elegíveis.', calculation: 'Soma do valor realizado dos injetores ativos da unidade no período.', usage: 'Compara o volume usado no ranking contra o total geral do período.' },
  { key: 'periodAttendanceTotal', label: 'Total geral', description: 'Faturamento total dos atendimentos no período filtrado.', calculation: 'Soma de todos os atendimentos da unidade/período, incluindo itens fora do ranking.', usage: 'Serve para conferência; não substitui o total ranqueável nas estatísticas dos doutores.' },
  { key: 'eligibleDoctorCount', label: 'Doutores elegíveis', description: 'Quantidade de injetores ativos considerados no ranking.', calculation: 'Profissionais ativos com função Injetor na unidade selecionada.', usage: 'Define o universo usado em média, mediana, desvio, níveis e ranking.' },
  { key: 'monthlyGoal', label: 'Meta mensal', description: 'Meta mensal da unidade usada como base comercial.', calculation: '1ª meta mensal cadastrada no CRM para unidade, mês e ano.', usage: 'Origina meta diária e meta do período.' },
  { key: 'dailyGoal', label: 'Meta diária', description: 'Meta esperada por dia trabalhado.', calculation: 'meta_mensal / dias_trabalhados_mes.', usage: 'Compõe 50% da linha de corte.' },
  { key: 'weeklyGoal', label: 'Meta período', description: 'Meta proporcional aos dias trabalhados no período selecionado.', calculation: 'meta_diaria * dias_trabalhados_periodo.', usage: 'Confere se a janela filtrada está acima ou abaixo do esperado.' },
  { key: 'monthOperationalDays', label: 'Dias mês', description: 'Dias trabalhados usados para diluir a meta mensal.', calculation: 'Dias operacionais do mês pela Escala CRM ou fallback histórico.', usage: 'Define a meta diária.' },
  { key: 'periodOperationalDays', label: 'Dias período', description: 'Dias trabalhados dentro do filtro ativo.', calculation: 'Dias operacionais entre início e fim do período selecionado.', usage: 'Define a meta proporcional do período.' },
  { key: 'average', label: 'Média', description: 'Média do realizado dos doutores elegíveis.', calculation: 'total_ranqueável / doutores_elegíveis.', usage: 'Compõe 30% da linha de corte.' },
  { key: 'median', label: 'Mediana', description: 'Valor central do realizado dos doutores elegíveis.', calculation: 'Ordena os realizados e pega o centro; em par, média dos dois centrais.', usage: 'Compõe 20% da linha de corte e reduz distorção por extremos.' },
  { key: 'standardDeviation', label: 'Desvio padrão', description: 'Dispersão do realizado entre doutores elegíveis.', calculation: 'Desvio padrão amostral dos valores realizados.', usage: 'Multiplicado pelo fator de intervalo para definir a largura das faixas.' },
  { key: 'cutLine', label: 'Linha Corte', description: 'Centro das faixas de classificação.', calculation: 'linha_corte = (média * 0,30) + (mediana * 0,20) + (meta_diária * 0,50).', usage: 'Separa níveis 1/2 e orienta os limites inferior e superior.' },
  { key: 'interval', label: 'Intervalo', description: 'Largura das faixas ao redor da linha de corte.', calculation: 'intervalo = desvio_padrao(realizado_doutores) * multiplicador_intervalo.', usage: 'Define limite inferior e superior.' },
  { key: 'intervalMultiplier', label: 'Multiplicador', description: 'Fator aplicado ao desvio padrão.', calculation: 'Configuração rankingDoctor.intervalMultiplier, com fallback 0,75.', usage: 'Ajusta a distribuição dos doutores entre os níveis.' },
  { key: 'lowerLimit', label: 'Limite inferior', description: 'Piso da faixa central.', calculation: 'linha_corte - intervalo.', usage: 'Abaixo dele o doutor entra no nível 0.' },
  { key: 'upperLimit', label: 'Limite superior', description: 'Teto da faixa central.', calculation: 'linha_corte + intervalo.', usage: 'Acima dele o doutor entra no nível 3.' },
  { key: 'level0', label: 'Nível 0', description: 'Doutores abaixo do limite inferior.', calculation: 'Conta realizado < limite_inferior.', usage: 'Entra no divisor das razões com peso 0.' },
  { key: 'level1', label: 'Nível 1', description: 'Doutores entre limite inferior e linha de corte.', calculation: 'Conta limite_inferior <= realizado < linha_corte.', usage: 'Entra no divisor das razões com peso 1.' },
  { key: 'level2', label: 'Nível 2', description: 'Doutores entre linha de corte e limite superior.', calculation: 'Conta linha_corte <= realizado < limite_superior.', usage: 'Entra no divisor das razões com peso 2.' },
  { key: 'level3', label: 'Nível 3', description: 'Doutores acima do limite superior.', calculation: 'Conta realizado >= limite_superior.', usage: 'Entra no divisor das razões com peso 3.' },
  { key: 'upperRatio', label: 'Razão Superior', description: 'Percentual ponderado dos níveis superiores.', calculation: '((level2 * 2) + (level3 * 3)) / divisor.', usage: 'Mostra concentração ponderada acima da linha de corte; é percentual, não R$.' },
  { key: 'lowerRatio', label: 'Razão Inferior', description: 'Percentual ponderado do nível inferior próximo ao corte.', calculation: '(level1 * 1) / divisor.', usage: 'Mostra peso relativo abaixo da linha de corte; é percentual, não R$.' },
  { key: 'innerRatio', label: 'Razão Interior', description: 'Percentual ponderado dos níveis próximos ao centro.', calculation: '((level1 * 1) + (level2 * 2)) / divisor.', usage: 'Ajuda a avaliar concentração ao redor da linha de corte.' },
  { key: 'outerRatio', label: 'Razão Exterior', description: 'Percentual ponderado dos destaques externos.', calculation: '(level3 * 3) / divisor.', usage: 'Ajuda a identificar concentração acima do limite superior.' },
  { key: 'ratioDivisor', label: 'Divisor razões', description: 'Base ponderada usada nas razões.', calculation: 'divisor = (level0 * 0) + (level1 * 1) + (level2 * 2) + (level3 * 3).', usage: 'Normaliza as razões para virar percentual.' },
] as const

type ConversionMetricKey = typeof CONVERSION_METRIC_DEFINITIONS[number]['key']
const CONVERSION_RATIO_KEYS = new Set<ConversionMetricKey>(['upperRatio', 'lowerRatio', 'innerRatio', 'outerRatio'])
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
  monthlyGoal: Target,
  dailyGoal: CalendarRange,
  weeklyGoal: CalendarRange,
  monthOperationalDays: CalendarRange,
  periodOperationalDays: CalendarRange,
  average: Gauge,
  median: Calculator,
  standardDeviation: BarChart3,
  upperRatio: Target,
  lowerRatio: Crosshair,
  innerRatio: Percent,
  outerRatio: Divide,
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
  monthlyGoal: 'emerald',
  dailyGoal: 'emerald',
  weeklyGoal: 'emerald',
  monthOperationalDays: 'sky',
  periodOperationalDays: 'sky',
  average: 'violet',
  median: 'violet',
  standardDeviation: 'sky',
  upperRatio: 'amber',
  lowerRatio: 'amber',
  innerRatio: 'sky',
  outerRatio: 'sky',
  ratioDivisor: 'violet',
  cutLine: 'amber',
  interval: 'violet',
  intervalMultiplier: 'sky',
  lowerLimit: 'amber',
  upperLimit: 'emerald',
  level0: 'amber',
  level1: 'amber',
  level2: 'sky',
  level3: 'emerald',
}

const CONVERSION_METRIC_GROUPS: Array<{
  key: string
  label: string
  icon: LucideIcon
  tone: AtendimentoMetricTone
  description: string
  metricKeys: ConversionMetricKey[]
}> = [
  {
    key: 'conversion:stats',
    label: 'Resumo',
    icon: Sigma,
    tone: 'sky',
    description: 'Totais, doutores elegíveis e dispersão calculados pelo CRM para auditar a base do ranking.',
    metricKeys: ['rankedDoctorTotal', 'periodAttendanceTotal', 'eligibleDoctorCount', 'average', 'median', 'standardDeviation'],
  },
  {
    key: 'conversion:goals',
    label: 'Metas',
    icon: Target,
    tone: 'emerald',
    description: 'Metas e dias trabalhados usados para compor a linha de corte.',
    metricKeys: ['monthlyGoal', 'dailyGoal', 'weeklyGoal', 'monthOperationalDays', 'periodOperationalDays'],
  },
  {
    key: 'conversion:cut',
    label: 'Corte e faixas',
    icon: Ruler,
    tone: 'violet',
    description: 'Linha de corte, intervalo e limites inferior/superior usados para separar faixas de desempenho.',
    metricKeys: ['cutLine', 'interval', 'intervalMultiplier', 'lowerLimit', 'upperLimit'],
  },
  {
    key: 'conversion:levels',
    label: 'Níveis',
    icon: Trophy,
    tone: 'amber',
    description: 'Quantidade de doutores classificados nos níveis 0, 1, 2 e 3.',
    metricKeys: ['level0', 'level1', 'level2', 'level3'],
  },
  {
    key: 'conversion:ratios',
    label: 'Razões',
    icon: Percent,
    tone: 'amber',
    description: 'Razões superior, inferior, interior e exterior usadas na comparação das faixas.',
    metricKeys: ['upperRatio', 'lowerRatio', 'innerRatio', 'outerRatio', 'ratioDivisor'],
  },
]

function buildMetricTooltip(
  definition: typeof CONVERSION_METRIC_DEFINITIONS[number],
  formula?: string
): MetricTooltipSpec {
  return {
    what: definition.description,
    calculation: formula || definition.calculation,
    usage: definition.usage,
  }
}

function scheduleSourceLabel(source?: string) {
  if (source === 'escala-crm') return 'Escala CRM'
  if (source === 'legacy-import') return 'Fallback histórico'
  return source || 'Não informado'
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

function resolveAtendimentoChartPreset(id: AtendimentoChartPreset) {
  return ATENDIMENTO_CHART_PRESETS.find((preset) => preset.id === id) || ATENDIMENTO_CHART_PRESETS[0]
}

function getAtendimentoChartData(slot: AtendimentoChartSlot, overview: AtendimentoClinicaOverview | null) {
  if (slot.presetId === 'monthly') {
    return (overview?.monthly || []).slice(-Math.max(3, slot.topN)).map((item) => ({
      label: monthLabel(item.month),
      value: Number(item.value || 0),
      count: Number(item.count || 0),
    }))
  }
  const rows = slot.presetId === 'injectors'
    ? overview?.rankings.injectors || []
    : slot.presetId === 'consultants'
      ? overview?.rankings.consultants || []
      : overview?.rankings.procedures || []
  return rows.slice(0, slot.topN).map((item) => ({
    label: item.label,
    value: Number(item.value || 0),
    count: Number(item.count || 0),
  }))
}

function AtendimentoChartCard({
  slot,
  overview,
  onChange,
  onRemove,
  canRemove,
}: {
  slot: AtendimentoChartSlot
  overview: AtendimentoClinicaOverview | null
  onChange: (patch: Partial<AtendimentoChartSlot>) => void
  onRemove: () => void
  canRemove: boolean
}) {
  const preset = resolveAtendimentoChartPreset(slot.presetId)
  const PresetIcon = preset.icon
  const data = getAtendimentoChartData(slot, overview)
  const dataKey = slot.metric === 'count' ? 'count' : 'value'
  const labelFormatter = (value: unknown) => String(value || '')
  const valueFormatter = (value: unknown) => slot.metric === 'count'
    ? formatNumberBR(Number(value || 0))
    : formatCurrencyBRL(Number(value || 0))
  const view = slot.presetId === 'monthly' ? slot.view : slot.view === 'area' ? 'bar' : slot.view
  const height = slot.presetId === 'monthly' ? 250 : 220
  return (
    <Card className={`${panelClass} min-w-0`}>
      <CardHeader className="flex flex-col gap-3 pb-2">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <CardTitle className="flex min-w-0 items-center gap-2 text-base text-white">
            <PresetIcon className="h-4.5 w-4.5 shrink-0 text-sky-300" />
            <span className="truncate">{preset.label}</span>
          </CardTitle>
          {canRemove ? (
            <IconOnlyAction label="Remover gráfico" description="Retirar este gráfico do painel." onClick={onRemove} tooltipAlign="right">
              <Trash2 className="h-4 w-4" />
            </IconOnlyAction>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={slot.presetId} onValueChange={(value) => onChange({ presetId: value as AtendimentoChartPreset, view: value === 'monthly' ? 'area' : 'bar' })}>
            <SelectTrigger className="h-8 min-w-[9rem] border-slate-700 bg-slate-900/70 text-xs text-slate-100">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ATENDIMENTO_CHART_PRESETS.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={slot.metric} onValueChange={(value) => onChange({ metric: value as AtendimentoChartMetric })}>
            <SelectTrigger className="h-8 w-24 border-slate-700 bg-slate-900/70 text-xs text-slate-100">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="value">R$</SelectItem>
              <SelectItem value="count">Qtd</SelectItem>
            </SelectContent>
          </Select>
          <Select value={view} onValueChange={(value) => onChange({ view: value as AtendimentoChartView })}>
            <SelectTrigger className="h-8 w-28 border-slate-700 bg-slate-900/70 text-xs text-slate-100">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ATENDIMENTO_CHART_VIEWS.filter((item) => slot.presetId === 'monthly' || item.id !== 'area').map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={String(slot.topN)} onValueChange={(value) => onChange({ topN: Number(value) })}>
            <SelectTrigger className="h-8 w-24 border-slate-700 bg-slate-900/70 text-xs text-slate-100">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[5, 8, 10, 12].map((value) => <SelectItem key={value} value={String(value)}>Top {value}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {data.length ? (
          <div className="w-full" style={{ height }}>
            <ResponsiveContainer width="100%" height="100%">
              {view === 'line' ? (
                <LineChart data={data} margin={{ left: 0, right: 8, top: 12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(value) => String(value).slice(0, 14)} />
                  <YAxis tickLine={false} axisLine={false} width={48} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(value) => slot.metric === 'count' ? formatNumberBR(Number(value || 0)) : formatCurrencyBRL(Number(value || 0)).replace(',00', '')} />
                  <RechartsTooltip
                    contentStyle={{ background: 'rgba(2,6,23,0.94)', border: '1px solid rgba(51,65,85,0.8)', borderRadius: 14, color: '#e2e8f0' }}
                    formatter={(value) => valueFormatter(value)}
                    labelFormatter={labelFormatter}
                    labelStyle={{ color: '#bae6fd' }}
                  />
                  <Line type="monotone" dataKey={dataKey} stroke="#38bdf8" strokeWidth={2} dot={false} />
                </LineChart>
              ) : view === 'bar' ? (
                <BarChart data={data} layout={slot.presetId === 'monthly' ? 'horizontal' : 'vertical'} margin={{ left: 8, right: 12, top: 12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
                  {slot.presetId === 'monthly' ? (
                    <>
                      <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                      <YAxis tickLine={false} axisLine={false} width={48} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(value) => slot.metric === 'count' ? formatNumberBR(Number(value || 0)) : formatCurrencyBRL(Number(value || 0)).replace(',00', '')} />
                    </>
                  ) : (
                    <>
                      <XAxis type="number" tickLine={false} axisLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(value) => slot.metric === 'count' ? formatNumberBR(Number(value || 0)) : formatCurrencyBRL(Number(value || 0)).replace(',00', '')} />
                      <YAxis type="category" dataKey="label" width={120} tickLine={false} axisLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(value) => String(value).slice(0, 18)} />
                    </>
                  )}
                  <RechartsTooltip
                    contentStyle={{ background: 'rgba(2,6,23,0.94)', border: '1px solid rgba(51,65,85,0.8)', borderRadius: 14, color: '#e2e8f0' }}
                    formatter={(value) => valueFormatter(value)}
                    labelFormatter={labelFormatter}
                    labelStyle={{ color: '#bae6fd' }}
                  />
                  <Bar dataKey={dataKey} fill="#38bdf8" radius={slot.presetId === 'monthly' ? [6, 6, 0, 0] : [0, 6, 6, 0]} />
                </BarChart>
              ) : (
                <AreaChart data={data} margin={{ left: 0, right: 8, top: 12, bottom: 0 }}>
                  <defs>
                    <linearGradient id={`atendimentoChartFill-${slot.presetId}-${slot.metric}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.32} />
                      <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <YAxis tickLine={false} axisLine={false} width={48} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(value) => slot.metric === 'count' ? formatNumberBR(Number(value || 0)) : formatCurrencyBRL(Number(value || 0)).replace(',00', '')} />
                  <RechartsTooltip
                    contentStyle={{ background: 'rgba(2,6,23,0.94)', border: '1px solid rgba(51,65,85,0.8)', borderRadius: 14, color: '#e2e8f0' }}
                    formatter={(value) => valueFormatter(value)}
                    labelFormatter={labelFormatter}
                    labelStyle={{ color: '#bae6fd' }}
                  />
                  <Area type="monotone" dataKey={dataKey} stroke="#38bdf8" strokeWidth={2} fill={`url(#atendimentoChartFill-${slot.presetId}-${slot.metric})`} />
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/35 p-4 text-sm text-slate-400">Sem dados para este gráfico.</div>
        )}
      </CardContent>
    </Card>
  )
}

function AtendimentoChartsPanel({
  overview,
  slots,
  onSlotsChange,
}: {
  overview: AtendimentoClinicaOverview | null
  slots: AtendimentoChartSlot[]
  onSlotsChange: React.Dispatch<React.SetStateAction<AtendimentoChartSlot[]>>
}) {
  const updateSlot = (index: number, patch: Partial<AtendimentoChartSlot>) => {
    onSlotsChange((prev) => prev.map((slot, current) => current === index ? { ...slot, ...patch } : slot))
  }
  const addChart = () => {
    onSlotsChange((prev) => prev.length >= 6 ? prev : [...prev, { presetId: 'injectors', metric: 'value', view: 'bar', topN: 5 }])
  }
  const resetCharts = () => onSlotsChange(DEFAULT_ATENDIMENTO_CHART_SLOTS)
  return (
    <section className="space-y-3 border-t border-slate-800/70 pt-3" data-testid="atendimento-charts-panel" aria-label="Gráficos">
      <div className="flex items-center justify-between gap-3 px-1">
        <h2 className="flex items-center gap-2 text-base font-semibold text-white">
          <AreaChartIcon className="h-5 w-5 text-emerald-300" />
          Gráficos
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          <IconOnlyAction label="Adicionar gráfico" description="Criar outro gráfico configurável no painel." onClick={addChart} disabled={slots.length >= 6} tooltipAlign="right" data-testid="atendimento-chart-add">
            <Plus className="h-4 w-4" />
          </IconOnlyAction>
          <IconOnlyAction label="Resetar gráficos" description="Restaurar a seleção padrão de gráficos." onClick={resetCharts} tooltipAlign="right" data-testid="atendimento-chart-reset">
            <RefreshCw className="h-4 w-4" />
          </IconOnlyAction>
        </div>
      </div>
      <div className={`grid gap-3 ${slots.length <= 1 ? 'grid-cols-1' : slots.length === 2 ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1 lg:grid-cols-2 xl:grid-cols-3'}`}>
        {slots.map((slot, index) => (
          <AtendimentoChartCard
            key={`${index}-${slot.presetId}-${slot.metric}-${slot.view}`}
            slot={slot}
            overview={overview}
            onChange={(patch) => updateSlot(index, patch)}
            onRemove={() => onSlotsChange((prev) => prev.filter((_, current) => current !== index))}
            canRemove={slots.length > 1}
          />
        ))}
      </div>
    </section>
  )
}

export function AtendimentoClinicaModule() {
  const [filters, setFilters] = useState<AtendimentoClinicaFilters>(DEFAULT_ATENDIMENTO_FILTERS)
  const [references, setReferences] = useState<AtendimentoClinicaReferences | null>(null)
  const [overview, setOverview] = useState<AtendimentoClinicaOverview | null>(null)
  const [rows, setRows] = useState<AtendimentoClinicaAttendance[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMoreRows, setLoadingMoreRows] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AtendimentoClinicaAttendance | null>(null)
  const [form, setForm] = useState<AtendimentoClinicaForm>(EMPTY_ATENDIMENTO_FORM)
  const [formError, setFormError] = useState('')
  const [inlineForm, setInlineForm] = useState<AtendimentoClinicaForm>({ ...EMPTY_ATENDIMENTO_FORM, date: '' })
  const [inlineError, setInlineError] = useState('')
  const [rowDrafts, setRowDrafts] = useState<Record<string, AtendimentoClinicaForm>>({})
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [rowSavingId, setRowSavingId] = useState('')
  const [attendanceSortKey, setAttendanceSortKey] = useState<AtendimentoSortKey>('date')
  const [attendanceSortDir, setAttendanceSortDir] = useState<AtendimentoSortDir>('desc')
  const [importOpen, setImportOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState('')
  const [reportLoading, setReportLoading] = useState(false)
  const [reportPreview, setReportPreview] = useState<AtendimentoClinicaReportPreview | null>(null)
  const [managementCatalog, setManagementCatalog] = useState<AtendimentoManagementCatalog | null>(null)
  const [managementConversionReport, setManagementConversionReport] = useState<AtendimentoManagementConversionReport | null>(null)
  const loadingMoreRowsRef = React.useRef(false)
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

  const load = useCallback(async () => {
    setLoading(true)
    loadingMoreRowsRef.current = false
    setLoadingMoreRows(false)
    setError('')
    const [refs, ov, list] = await Promise.all([
      fetchAtendimentoReferences(),
      fetchAtendimentoOverview(filters),
      fetchAtendimentoAttendances(filters, { limit: ATTENDANCE_PAGE_SIZE, offset: 0 }),
    ])
    if (!refs.ok) setError(refs.error || 'Não foi possível carregar referências.')
    if (!ov.ok) setError(ov.error || 'Não foi possível carregar indicadores.')
    if (!list.ok) setError(list.error || 'Não foi possível carregar atendimentos.')
    if (refs.ok) setReferences({ units: refs.units || [], professionals: refs.professionals || [], procedures: refs.procedures || [] })
    if (ov.ok) setOverview({ summary: ov.summary, monthly: ov.monthly || [], rankings: ov.rankings })
    if (list.ok) {
      setRows(list.data || [])
      setTotal(Number(list.total || 0))
    }
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

  const loadManagement = useCallback(async () => {
    const conversionDate = filters.to || filters.from || `${selectedGoalMonth}-15`
    const [catalog, conversionReport] = await Promise.all([
      fetchAtendimentoManagementCatalog(),
      fetchAtendimentoManagementConversionReport(conversionDate, { unit: filters.unit, from: filters.from, to: filters.to }),
    ])
    if (catalog.ok) setManagementCatalog(catalog)
    if (conversionReport.ok) setManagementConversionReport(conversionReport)
  }, [filters.from, filters.to, filters.unit, selectedGoalMonth])

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
  const injectors = useMemo(
    () => filterProfessionalsByUnitRole(references?.professionals || [], formUnitName, 'Injetor'),
    [formUnitName, references?.professionals],
  )
  const consultants = useMemo(
    () => filterProfessionalsByUnitRole(references?.professionals || [], formUnitName, 'Consultor', formShift),
    [formShift, formUnitName, references?.professionals],
  )
  const previewValue = calculateAtendimentoValue(form)

  const buildInlineForm = useCallback((): AtendimentoClinicaForm => {
    const selectedUnit = filters.unit !== 'all'
      ? references?.units.find((unit) => unit.slug === filters.unit)
      : references?.units[0]
    return {
      ...EMPTY_ATENDIMENTO_FORM,
      date: '',
      unitSlug: selectedUnit?.slug || EMPTY_ATENDIMENTO_FORM.unitSlug,
      unitName: selectedUnit?.name || EMPTY_ATENDIMENTO_FORM.unitName,
    }
  }, [filters.unit, references?.units])

  useEffect(() => {
    setInlineForm((prev) => (hasAtendimentoInlineDraft(prev) ? prev : buildInlineForm()))
  }, [buildInlineForm])

  const inlineProcedure = useMemo(
    () => (references?.procedures || []).find((item) => item.name === inlineForm.procedureName) || null,
    [inlineForm.procedureName, references?.procedures],
  )
  const inlineAllowedCodes = inlineProcedure?.codes || []
  const inlineUnitName = inlineForm.unitName || references?.units.find((unit) => unit.slug === inlineForm.unitSlug)?.name || inlineForm.unitSlug
  const inlineShift = determineAtendimentoShift(inlineUnitName)
  const inlineInjectors = useMemo(
    () => filterProfessionalsByUnitRole(references?.professionals || [], inlineUnitName, 'Injetor'),
    [inlineUnitName, references?.professionals],
  )
  const inlineConsultants = useMemo(
    () => filterProfessionalsByUnitRole(references?.professionals || [], inlineUnitName, 'Consultor', inlineShift),
    [inlineShift, inlineUnitName, references?.professionals],
  )
  const inlinePreviewValue = calculateAtendimentoValue(inlineForm)

  const filterInjectors = useMemo(() => {
    const unitName = filters.unit === 'all'
      ? ''
      : references?.units.find((unit) => unit.slug === filters.unit)?.name || filters.unit
    if (unitName) return filterProfessionalsByUnitRole(references?.professionals || [], unitName, 'Injetor')
    return [...new Set((references?.professionals || [])
      .filter((professional) => {
        if (professional.status && professional.status !== 'Ativo') return false
        const roles = [
          ...(Array.isArray(professional.roles) ? professional.roles : []),
          professional.role || '',
        ].map((role) => String(role).toLowerCase())
        return roles.some((role) => role.includes('injetor') || role.includes('medico') || role.includes('médico'))
      })
      .map((professional) => professional.name)
      .filter(Boolean))]
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
    const period = doctorRanking?.period
    const conversionStart = period?.metricStart || period?.weekStart
    const conversionEnd = period?.metricEnd || period?.weekEnd
    const conversionPeriodDetail = conversionStart && conversionEnd
      ? `${formatIsoDateBR(conversionStart)} a ${formatIsoDateBR(conversionEnd)}`
      : conversionSection?.unitName || 'Conversão'
    const scheduleSource = managementConversionReport?.summary?.scheduleSource
    const scheduleSourceRow: AtendimentoMetricGroupRow = {
      key: 'scheduleSource',
      label: 'Fonte agenda',
      value: scheduleSourceLabel(scheduleSource),
      detail: managementConversionReport?.summary?.doctorRankingSource === 'crm' ? 'CRM' : 'Conversão',
      icon: CalendarRange,
      tone: scheduleSource === 'escala-crm' ? 'emerald' : 'amber',
      tooltip: {
        what: 'Origem dos dias trabalhados usados nas metas.',
        calculation: 'O CRM prioriza a Escala; se não houver cobertura, usa o fallback histórico importado.',
        usage: 'Afeta dias do mês, dias do período, meta diária e meta proporcional.',
      },
    }
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
        wrapperClassName: 'sm:col-span-2',
        content: (
          <div className="pt-0.5 text-[11px] leading-snug text-slate-400">
            {aggregateNotice}
          </div>
        ),
      })
    }
    const conversionDefinitions = new Map(CONVERSION_METRIC_DEFINITIONS.map((definition) => [definition.key, definition]))
    for (const group of CONVERSION_METRIC_GROUPS) {
      const rows = group.metricKeys
        .flatMap((key): AtendimentoMetricGroupRow[] => {
          const metric = conversionMetrics[key]
          const definition = conversionDefinitions.get(key)
          if (!metric || !definition) return []
          return [{
            key,
            label: definition.label,
            value: formatConversionMetricValue(key, Number(metric.weekValue || 0)),
            detail: metric.position || conversionSection?.unitName || '',
            tooltip: buildMetricTooltip(definition, metric.formula),
            icon: CONVERSION_METRIC_ICON_BY_KEY[key],
            tone: CONVERSION_METRIC_TONE_BY_KEY[key],
          }]
        })
      if (group.key === 'conversion:goals') rows.push(scheduleSourceRow)
      if (!rows.length) continue
      tiles.push({
        key: group.key,
        label: group.label,
        value: `${rows.length} índices`,
        detail: conversionPeriodDetail,
        icon: group.icon,
        tone: group.tone,
        description: group.description,
        wrapperClassName: group.key === 'conversion:ratios' ? 'sm:col-span-2' : '',
        content: <MetricGroupContent rows={rows} />,
      })
    }

    tiles.push({
      key: 'ticket',
      label: 'Ticket médio',
      value: formatCurrencyBRL(overview?.summary.averageTicket || 0),
      detail: 'Média por atendimento',
      icon: TrendingUp,
      tone: 'violet',
      description: 'Faturamento filtrado dividido pela quantidade de atendimentos no período.',
    })

    const topDoctors = (managementConversionReport?.doctorRanking?.topDoctors || []).slice(0, 3)
    if (topDoctors.length) {
      tiles.push({
        key: 'doctor-ranking',
        label: 'Ranking',
        value: `${topDoctors.length} doutores`,
        detail: 'Top 3 do período',
        icon: Trophy,
        tone: 'amber',
        description: 'Ranking interno do CRM para o período selecionado. Exibe os três doutores com maior pontuação calculada para conversão.',
        wrapperClassName: 'sm:col-span-2',
        content: (
          <div className="space-y-1.5 pt-0.5">
            {topDoctors.map((doctor) => {
              const score = Number(doctor.score || 0)
              const doctorTooltip: MetricTooltipSpec = {
                what: 'Posição do doutor no ranking de conversão do período.',
                calculation: `Realizado: ${formatCurrencyBRL(Number(doctor.weekValue || 0))}. Nível: ${Number(doctor.level ?? 0)}. Pontuação: ${formatNumberBR(score)} pts.`,
                usage: 'O ranking ordena por realizado, depois nível/pontuação, e usa nome como desempate estável.',
              }
              return (
                <div key={`${doctor.unitSlug}-${doctor.rank}-${doctor.name}`} className="flex min-w-0 items-center gap-2">
                  <PodiumBadge rank={doctor.rank} />
                  <div className="min-w-0 flex-1">
                    <MetricTooltip label={doctor.name} info={doctorTooltip}>
                      <span className="block truncate text-[11px] font-semibold leading-tight text-white">{doctor.name}</span>
                    </MetricTooltip>
                    <div className="truncate text-[10px] leading-tight text-slate-500">{doctor.unitName}</div>
                  </div>
                  <div className="shrink-0 text-[11px] font-semibold text-slate-200">{formatNumberBR(score)} pts</div>
                </div>
              )
            })}
          </div>
        ),
      })
    }

    return tiles
  }, [
    filters.unit,
    managementConversionReport,
    overview?.summary.averageTicket,
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
    if (!result.destination || result.destination.droppableId !== 'atendimento-clinica-metrics') return
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

  const openEdit = (row: AtendimentoClinicaAttendance) => {
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
    const payload = { ...form, code: normalizeCode(form.code), value: previewValue }
    const result = form.id ? await updateAtendimentoAttendance(form.id, payload) : await createAtendimentoAttendance(payload)
    setSaving(false)
    if (!result.ok) {
      setFormError(result.error || 'Não foi possível salvar.')
      return
    }
    setFormOpen(false)
    await load()
  }

  const updateInlineForm = (patch: Partial<AtendimentoClinicaForm>) => setInlineForm((prev) => ({ ...prev, ...patch }))

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
    const payload = { ...inlineForm, code: normalizeCode(inlineForm.code), value: inlinePreviewValue }
    const result = await createAtendimentoAttendance(payload)
    setSaving(false)
    if (!result.ok) {
      setInlineError(result.error || 'Não foi possível salvar.')
      return
    }
    setInlineForm(buildInlineForm())
    await load()
  }, [buildInlineForm, inlineAllowedCodes, inlineForm, inlinePreviewValue, load])

  useEffect(() => {
    if (saving) return
    if (!inlineForm.date || !inlineForm.clientName.trim() || !inlineForm.procedureName || !inlineForm.code || !inlineForm.injectorName) return
    const timer = window.setTimeout(() => {
      void saveInlineForm()
    }, 550)
    return () => window.clearTimeout(timer)
  }, [inlineForm.clientName, inlineForm.code, inlineForm.date, inlineForm.injectorName, inlineForm.procedureName, saveInlineForm, saving])

  const rowFormFor = useCallback((row: AtendimentoClinicaAttendance) => rowDrafts[row.id] || asForm(row), [rowDrafts])

  const updateRowDraft = (row: AtendimentoClinicaAttendance, patch: Partial<AtendimentoClinicaForm>) => {
    setRowDrafts((prev) => ({ ...prev, [row.id]: { ...asForm(row), ...(prev[row.id] || {}), ...patch } }))
  }

  const commitRowForm = useCallback(async (row: AtendimentoClinicaAttendance, override?: Partial<AtendimentoClinicaForm>) => {
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
    const payload = { ...normalized, code: normalizeCode(normalized.code), value: calculateAtendimentoValue(normalized) }
    const result = await updateAtendimentoAttendance(row.id, payload)
    setRowSavingId('')
    if (!result.ok) {
      setRowErrors((prev) => ({ ...prev, [row.id]: result.error || 'Não foi possível salvar.' }))
      return
    }
    setRows((prev) => prev.map((item) => item.id === row.id ? { ...item, ...payload } : item))
    setRowDrafts((prev) => {
      const next = { ...prev }
      delete next[row.id]
      return next
    })
  }, [references?.procedures, rowDrafts])

  const commitRowPatch = (row: AtendimentoClinicaAttendance, patch: Partial<AtendimentoClinicaForm>) => {
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

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setSaving(true)
    const result = await deleteAtendimentoAttendance(deleteTarget.id)
    setSaving(false)
    if (!result.ok) {
      setError(result.error || 'Não foi possível excluir.')
      return
    }
    setDeleteTarget(null)
    await load()
  }

  const runGerenciaImport = async (dryRun: boolean) => {
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
      await load()
      await loadManagement()
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
    updateForm({ injectorName: result.doctorName })
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

  const updateFilter = useCallback((patch: Partial<AtendimentoClinicaFilters>) => setFilters((prev) => ({ ...prev, ...patch })), [])
  const updateForm = (patch: Partial<AtendimentoClinicaForm>) => setForm((prev) => ({ ...prev, ...patch }))

  useEffect(() => {
    emitAtendimentoClinicaHeaderState({
      loading,
      filters,
      units: (references?.units || []).map((unit) => ({ value: unit.slug, label: unit.name })),
      procedures: (references?.procedures || []).map((procedure) => ({ value: procedure.name, label: procedure.name })),
      injectors: filterInjectors.map((name) => ({ value: name, label: name })),
      activeUnitLabel,
      periodLabel: periodLabel(filters),
      latestImportLabel,
      total,
    })
    return () => emitAtendimentoClinicaHeaderState(null)
  }, [activeUnitLabel, filterInjectors, filters, latestImportLabel, loading, references?.procedures, references?.units, total])

  useEffect(() => {
    return subscribeAtendimentoClinicaHeaderAction((action) => {
      if (action.type === 'refresh') {
        void load()
        void loadManagement()
        return
      }
      if (action.type === 'open-import') {
        setImportOpen(true)
        return
      }
      if (action.type === 'report') {
        void loadReportPreview()
        return
      }
      if (action.type === 'set-filter') {
        updateFilter(action.patch)
      }
    })
  }, [load, loadManagement, loadReportPreview, updateFilter])

  return (
    <div className="atendimento-clinica-surface flex min-h-full flex-col gap-5 px-3 pb-6 pt-3 text-white sm:px-6">
      {error ? <ErrorBanner message={error} /> : null}

      <div className="space-y-2" data-testid="atendimento-kpis">
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
          <Droppable droppableId="atendimento-clinica-metrics" direction="horizontal">
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

      <div className="grid min-h-0 flex-1 gap-4">
        <section className="min-h-0 overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-950/45 shadow-[0_20px_80px_rgba(2,6,23,0.24)] backdrop-blur-xl" aria-label="Atendimentos">
          <div className="flex items-center justify-between gap-3 border-b border-slate-800/75 px-3 py-2">
            <TooltipLabel label="Linhas carregadas" description="Quantidade carregada na tabela sobre o total filtrado. Mais linhas são carregadas automaticamente ao chegar ao fim da lista.">
              <span className="rounded-full border border-slate-800 bg-slate-950/65 px-2.5 py-1 text-[11px] font-medium text-slate-300" data-testid="atendimento-loaded-count">
                {formatNumberBR(rows.length)}/{formatNumberBR(total)}
              </span>
            </TooltipLabel>
            {filters.unit === 'all' ? (
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
            ) : null}
          </div>
          {reportPreview ? (
            <div className="mx-3 mt-3 grid gap-2 lg:grid-cols-2">
              {reportPreview ? (
                <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-50">
                  Prévia: {formatNumberBR(reportPreview.summary.attendances)} atendimentos, {formatCurrencyBRL(reportPreview.summary.totalValue)} total, {formatCurrencyBRL(reportPreview.summary.remuneration)} remuneração.
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="min-h-0">
            <div className="max-h-[56vh] overflow-auto" data-testid="atendimento-table-scroll" onScroll={handleAttendanceScroll}>
              <table data-testid="atendimento-table" className="w-full min-w-[58rem] table-fixed caption-bottom border-separate border-spacing-0 text-sm">
                <colgroup>
                  <col className="w-[10rem]" />
                  <col className="w-[15rem]" />
                  <col className="w-[14rem]" />
                  <col className="w-[14rem]" />
                  <col className="w-[14rem]" />
                  <col className="w-[9rem]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-white/10">
                    <SortableAttendanceHead sortKey="date" label="Data" activeKey={attendanceSortKey} sortDir={attendanceSortDir} onSort={handleAttendanceSort} stickyLeft testId="atendimento-table-head-date" />
                    <SortableAttendanceHead sortKey="clientName" label="Cliente" activeKey={attendanceSortKey} sortDir={attendanceSortDir} onSort={handleAttendanceSort}>
                      <span className="block text-[10px] font-normal leading-tight text-slate-500" data-testid="atendimento-distinct-clients">
                        {formatNumberBR(overview?.summary.distinctClients || 0)} distintos
                      </span>
                    </SortableAttendanceHead>
                    <SortableAttendanceHead sortKey="procedureName" label="Procedimento" activeKey={attendanceSortKey} sortDir={attendanceSortDir} onSort={handleAttendanceSort} />
                    <SortableAttendanceHead sortKey="injectorName" label="Injetor" activeKey={attendanceSortKey} sortDir={attendanceSortDir} onSort={handleAttendanceSort} />
                    <SortableAttendanceHead sortKey="consultantName" label="Consultor" activeKey={attendanceSortKey} sortDir={attendanceSortDir} onSort={handleAttendanceSort} />
                    <SortableAttendanceHead sortKey="value" label="Valor" align="right" activeKey={attendanceSortKey} sortDir={attendanceSortDir} onSort={handleAttendanceSort} />
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-sky-400/20 bg-sky-400/[0.035] text-slate-100">
                    <td className="sticky left-0 z-10 border-b border-slate-800 bg-slate-950 px-2 py-2 align-middle shadow-[1px_0_0_rgba(30,41,59,0.65)]">
                      <Input
                        type="date"
                        value={inlineForm.date}
                        onChange={(event) => updateInlineForm({ date: event.target.value })}
                        className="h-8 min-w-[8.5rem] border-slate-700 bg-slate-950/80 px-2 text-xs text-white"
                        data-testid="atendimento-inline-date"
                        aria-label="Data do novo atendimento"
                      />
                    </td>
                    <td className="border-b border-slate-800 px-2 py-2 align-middle">
                      <Input
                        value={inlineForm.clientName}
                        onChange={(event) => updateInlineForm({ clientName: event.target.value })}
                        className="h-8 min-w-[12rem] border-slate-700 bg-slate-950/70 px-2 text-xs text-white placeholder:text-slate-500"
                        placeholder="Cliente"
                        data-testid="atendimento-inline-client"
                        aria-label="Cliente do novo atendimento"
                      />
                    </td>
                    <td className="border-b border-slate-800 px-2 py-2 align-middle">
                      <Select value={inlineForm.procedureName} onValueChange={updateInlineProcedure}>
                        <SelectTrigger className="h-8 min-w-[11rem] border-slate-700 bg-slate-950/70 px-2 text-xs text-white" data-testid="atendimento-inline-procedure" aria-label="Procedimento do novo atendimento">
                          <SelectValue placeholder="Procedimento" />
                        </SelectTrigger>
                        <SelectContent>{(references?.procedures || []).map((item) => <SelectItem key={item.name} value={item.name}>{item.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                    <td className="border-b border-slate-800 px-2 py-2 align-middle">
                      <Select value={inlineForm.injectorName || 'none'} onValueChange={(injectorName) => updateInlineForm({ injectorName: injectorName === 'none' ? '' : injectorName })}>
                        <SelectTrigger className="h-8 min-w-[11rem] border-slate-700 bg-slate-950/70 px-2 text-xs text-white" data-testid="atendimento-inline-injector" aria-label="Injetor do novo atendimento">
                          <SelectValue placeholder="Injetor" />
                        </SelectTrigger>
                        <SelectContent><SelectItem value="none">Sem injetor</SelectItem>{inlineInjectors.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                    <td className="border-b border-slate-800 px-2 py-2 align-middle">
                      <Select value={inlineForm.consultantName || 'none'} onValueChange={(consultantName) => updateInlineForm({ consultantName: consultantName === 'none' ? '' : consultantName })}>
                        <SelectTrigger className="h-8 min-w-[11rem] border-slate-700 bg-slate-950/70 px-2 text-xs text-white" data-testid="atendimento-inline-consultant" aria-label="Consultor do novo atendimento">
                          <SelectValue placeholder="Consultor" />
                        </SelectTrigger>
                        <SelectContent><SelectItem value="none">Sem consultor</SelectItem>{inlineConsultants.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                    <td className="border-b border-slate-800 px-3 py-2 text-right align-middle text-xs font-semibold whitespace-nowrap text-emerald-100" data-testid="atendimento-inline-preview">
                      {formatCurrencyBRL(inlinePreviewValue)}
                    </td>
                  </tr>
                  {inlineError ? (
                    <tr>
                      <td colSpan={6} className="border-b border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-100">
                        {inlineError}
                      </td>
                    </tr>
                  ) : null}
                  {sortedRows.map((row) => {
                    const rowForm = rowFormFor(row)
                    const rowUnitName = rowForm.unitName || references?.units.find((unit) => unit.slug === rowForm.unitSlug)?.name || rowForm.unitSlug
                    const rowShift = determineAtendimentoShift(rowUnitName)
                    const rowInjectors = filterProfessionalsByUnitRole(references?.professionals || [], rowUnitName, 'Injetor')
                    const rowConsultants = filterProfessionalsByUnitRole(references?.professionals || [], rowUnitName, 'Consultor', rowShift)
                    const rowProcedure = (references?.procedures || []).find((item) => item.name === rowForm.procedureName)
                    const rowValue = calculateAtendimentoValue(rowForm)
                    const unitVisual = filters.unit === 'all' ? atendimentoUnitVisual(row.unitSlug || row.unitName) : null
                    return (
                      <React.Fragment key={row.id}>
                        <tr className={`group border-b border-slate-800/80 text-slate-200 transition ${unitVisual?.rowClassName || 'hover:bg-slate-900/70'}`} data-unit={row.unitSlug || row.unitName}>
                          <td className={`sticky left-0 z-10 border-b border-slate-800 px-2 py-2 align-middle shadow-[1px_0_0_rgba(30,41,59,0.65)] ${unitVisual ? 'relative' : ''} ${unitVisual?.stickyClassName || 'bg-slate-950/95'}`}>
                            {unitVisual ? <span className={`absolute left-0 top-0 h-full w-1 ${unitVisual.stripeClassName}`} aria-hidden="true" /> : null}
                            <Input
                              type="date"
                              value={rowForm.date}
                              onChange={(event) => updateRowDraft(row, { date: event.target.value })}
                              onBlur={() => void commitRowForm(row)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') event.currentTarget.blur()
                              }}
                              className="h-8 border-transparent bg-transparent px-1 text-xs font-medium text-slate-100 hover:border-slate-700 hover:bg-slate-950/70 focus:border-sky-400/40 focus:bg-slate-950/80"
                              aria-label={`Data de ${row.clientName}`}
                            />
                          </td>
                          <td className={`border-b border-slate-800 px-2 py-2 align-middle ${unitVisual?.cellClassName || ''}`}>
                            <Input
                              value={rowForm.clientName}
                              onChange={(event) => updateRowDraft(row, { clientName: event.target.value })}
                              onBlur={() => void commitRowForm(row)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') event.currentTarget.blur()
                              }}
                              className="h-8 border-transparent bg-transparent px-1 text-sm font-medium text-white hover:border-slate-700 hover:bg-slate-950/70 focus:border-sky-400/40 focus:bg-slate-950/80"
                              aria-label={`Cliente ${row.clientName}`}
                              data-testid={`atendimento-row-client-${row.id}`}
                            />
                          </td>
                          <td className={`border-b border-slate-800 px-2 py-2 align-middle ${unitVisual?.cellClassName || ''}`}>
                            <Select value={rowForm.procedureName} onValueChange={(procedureName) => {
                              const selectedProcedure = (references?.procedures || []).find((item) => item.name === procedureName)
                              commitRowPatch(row, { procedureName, code: selectedProcedure?.codes?.[0] || rowProcedure?.codes?.[0] || rowForm.code })
                            }}>
                              <SelectTrigger className="h-8 border-transparent bg-transparent px-1 text-sm text-slate-200 hover:border-slate-700 hover:bg-slate-950/70 focus:border-sky-400/40" aria-label={`Procedimento de ${row.clientName}`}>
                                <SelectValue placeholder="Procedimento" />
                              </SelectTrigger>
                              <SelectContent>{(references?.procedures || []).map((item) => <SelectItem key={item.name} value={item.name}>{item.name}</SelectItem>)}</SelectContent>
                            </Select>
                          </td>
                          <td className={`border-b border-slate-800 px-2 py-2 align-middle ${unitVisual?.cellClassName || ''}`}>
                            <Select value={rowForm.injectorName || 'none'} onValueChange={(injectorName) => commitRowPatch(row, { injectorName: injectorName === 'none' ? '' : injectorName })}>
                              <SelectTrigger className="h-8 border-transparent bg-transparent px-1 text-sm text-slate-200 hover:border-slate-700 hover:bg-slate-950/70 focus:border-sky-400/40" aria-label={`Injetor de ${row.clientName}`}>
                                <SelectValue placeholder="Injetor" />
                              </SelectTrigger>
                              <SelectContent><SelectItem value="none">Sem injetor</SelectItem>{rowInjectors.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
                            </Select>
                          </td>
                          <td className={`border-b border-slate-800 px-2 py-2 align-middle ${unitVisual?.cellClassName || ''}`}>
                            <Select value={rowForm.consultantName || 'none'} onValueChange={(consultantName) => commitRowPatch(row, { consultantName: consultantName === 'none' ? '' : consultantName })}>
                              <SelectTrigger className="h-8 border-transparent bg-transparent px-1 text-sm text-slate-200 hover:border-slate-700 hover:bg-slate-950/70 focus:border-sky-400/40" aria-label={`Consultor de ${row.clientName}`}>
                                <SelectValue placeholder="Consultor" />
                              </SelectTrigger>
                              <SelectContent><SelectItem value="none">Sem consultor</SelectItem>{rowConsultants.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
                            </Select>
                          </td>
                          <td className={`border-b border-slate-800 px-3 py-2 text-right align-middle text-sm font-semibold whitespace-nowrap text-white ${unitVisual?.cellClassName || ''}`}>
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
                  {!rows.length ? (
                    <tr><td colSpan={6} className="py-8 text-center text-slate-400">Nenhum atendimento encontrado.</td></tr>
                  ) : null}
                  {loadingMoreRows ? (
                    <tr><td colSpan={6} className="py-4 text-center text-xs text-sky-200">Carregando mais atendimentos...</td></tr>
                  ) : null}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5} className="sticky bottom-0 z-30 border-t border-slate-800 bg-slate-950 px-3 py-2 text-right text-xs font-medium text-slate-400">
                      Faturamento filtrado
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

        <AtendimentoChartsPanel overview={overview} slots={chartSlots} onSlotsChange={setChartSlots} />
      </div>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="border-slate-800 bg-slate-950 text-slate-100 sm:max-w-lg" data-testid="atendimento-import-modal">
          <DialogHeader>
            <DialogTitle>Importação da Gerência</DialogTitle>
            <DialogDescription className="text-slate-300">
              Use dry-run para conferir a planilha antes de gravar. O CRM mantém snapshot bruto e dados normalizados para Atend. Clínica, Insumos, Escala e Faturamento.
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
              <div className="flex gap-2">
                <Select value={form.injectorName || 'none'} onValueChange={(injectorName) => updateForm({ injectorName: injectorName === 'none' ? '' : injectorName })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">Sem injetor</SelectItem>{injectors.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
                </Select>
                <Button type="button" variant="outline" className="shrink-0" onClick={suggestDoctor}>Escala</Button>
              </div>
            </FormField>
            <FormField label="Consultor">
              <Select value={form.consultantName || 'none'} onValueChange={(consultantName) => updateForm({ consultantName: consultantName === 'none' ? '' : consultantName })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="none">Sem consultor</SelectItem>{consultants.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
              </Select>
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
