import React from 'react'
import { AreaChart as AreaChartIcon, BarChart3, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, Maximize2, Minimize2, Plus, RefreshCw, Stethoscope, Trash2, TrendingUp, Users, type LucideIcon } from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { formatCurrencyBRL, formatNumberBR } from '@/atendimentoDomain'
import type { AtendimentoOverview } from '@/atendimentoApi'
import { atendimentoEntityColor, atendimentoProfessionalColor, type AtendimentoVisualProfessional } from '@/atendimentoVisuals'
import { TooltipLabel } from '@/tooltip'

export type AtendimentoChartPreset = 'monthly' | 'ticket' | 'procedures' | 'injectors' | 'consultants'
export type AtendimentoChartMetric = 'value' | 'count'
export type AtendimentoChartView = 'area' | 'line' | 'bar'
export type AtendimentoChartSlot = {
  presetId: AtendimentoChartPreset
  metric: AtendimentoChartMetric
  view: AtendimentoChartView
  topN: number
  layout?: 'compact' | 'standard' | 'wide'
  collapsed?: boolean
}

const panelClass = 'border-slate-800/80 bg-slate-950/60 shadow-[0_20px_80px_rgba(2,6,23,0.35)] backdrop-blur-xl'

export const DEFAULT_ATENDIMENTO_CHART_SLOTS: AtendimentoChartSlot[] = [
  { presetId: 'monthly', metric: 'value', view: 'area', topN: 8 },
  { presetId: 'ticket', metric: 'value', view: 'line', topN: 8 },
  { presetId: 'procedures', metric: 'value', view: 'bar', topN: 5 },
  { presetId: 'injectors', metric: 'value', view: 'bar', topN: 5 },
  { presetId: 'consultants', metric: 'value', view: 'bar', topN: 5 },
]

const CHART_PRESETS: Array<{ id: AtendimentoChartPreset; label: string; icon: LucideIcon }> = [
  { id: 'monthly', label: 'Série mensal', icon: TrendingUp },
  { id: 'ticket', label: 'Ticket médio', icon: TrendingUp },
  { id: 'procedures', label: 'Procedimentos', icon: BarChart3 },
  { id: 'injectors', label: 'Injetores', icon: Stethoscope },
  { id: 'consultants', label: 'Consultores', icon: Users },
]

const CHART_VIEWS: Array<{ id: AtendimentoChartView; label: string }> = [
  { id: 'area', label: 'Área' },
  { id: 'line', label: 'Linha' },
  { id: 'bar', label: 'Barras' },
]

const IconOnlyAction = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  description?: string
  tooltipAlign?: 'left' | 'right'
  children: React.ReactNode
}>(({ label, description, tooltipAlign: _tooltipAlign, children, className = '', type = 'button', ...buttonProps }, ref) => (
  <TooltipLabel label={label} description={description}>
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-700 bg-slate-900/60 text-slate-100 transition hover:border-sky-400/40 hover:bg-slate-800/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/55 disabled:pointer-events-none disabled:opacity-45 ${className}`}
      {...buttonProps}
    >
      {children}
    </button>
  </TooltipLabel>
))
IconOnlyAction.displayName = 'AtendimentoChartIconOnlyAction'

function monthLabel(value: string) {
  const [year, month] = String(value || '').split('-').map(Number)
  if (!year || !month) return value
  const label = new Date(year, month - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
  return label.replace('.', '')
}

function resolveChartPreset(id: AtendimentoChartPreset) {
  return CHART_PRESETS.find((preset) => preset.id === id) || CHART_PRESETS[0]
}

function chartData(slot: AtendimentoChartSlot, overview: AtendimentoOverview | null) {
  if (slot.presetId === 'monthly') {
    return (overview?.monthly || []).slice(-Math.max(3, slot.topN)).map((item) => ({ label: monthLabel(item.month), value: Number(item.value || 0), count: Number(item.count || 0) }))
  }
  if (slot.presetId === 'ticket') {
    return (overview?.monthly || []).slice(-Math.max(3, slot.topN)).map((item) => {
      const count = Number(item.count || 0)
      const totalValue = Number(item.value || 0)
      return { label: monthLabel(item.month), value: count > 0 ? totalValue / count : 0, count }
    })
  }
  const rows = slot.presetId === 'injectors'
    ? overview?.rankings.injectors || []
    : slot.presetId === 'consultants'
      ? overview?.rankings.consultants || []
      : overview?.rankings.procedures || []
  return rows.slice(0, slot.topN).map((item) => ({ label: item.label, value: Number(item.value || 0), count: Number(item.count || 0) }))
}

function AtendimentoChartCard({ slot, overview, professionals, onChange, onRemove, onMove, onCycleLayout, onToggleWide, canRemove, canMoveLeft, canMoveRight }: {
  slot: AtendimentoChartSlot
  overview: AtendimentoOverview | null
  professionals: AtendimentoVisualProfessional[]
  onChange: (patch: Partial<AtendimentoChartSlot>) => void
  onRemove: () => void
  onMove: (direction: -1 | 1) => void
  onCycleLayout: () => void
  onToggleWide: () => void
  canRemove: boolean
  canMoveLeft: boolean
  canMoveRight: boolean
}) {
  const preset = resolveChartPreset(slot.presetId)
  const PresetIcon = preset.icon
  const data = chartData(slot, overview)
  const metric = slot.presetId === 'ticket' ? 'value' : slot.metric
  const dataKey = metric === 'count' ? 'count' : 'value'
  const labelFormatter = (value: unknown) => String(value || '')
  const valueFormatter = (value: unknown) => metric === 'count' ? formatNumberBR(Number(value || 0)) : formatCurrencyBRL(Number(value || 0))
  const view = slot.presetId === 'monthly' || slot.presetId === 'ticket' ? slot.view : slot.view === 'area' ? 'bar' : slot.view
  const height = slot.layout === 'wide' ? (slot.presetId === 'monthly' || slot.presetId === 'ticket' ? 300 : 264) : slot.presetId === 'monthly' || slot.presetId === 'ticket' ? 250 : 220
  const axisFormatter = (value: number) => metric === 'count' ? formatNumberBR(Number(value || 0)) : formatCurrencyBRL(Number(value || 0)).replace(',00', '')
  const tooltip = <RechartsTooltip contentStyle={{ background: 'rgba(2,6,23,0.94)', border: '1px solid rgba(51,65,85,0.8)', borderRadius: 14, color: '#e2e8f0' }} formatter={(value) => valueFormatter(value)} labelFormatter={labelFormatter} labelStyle={{ color: '#bae6fd' }} />
  const getBarColor = (label: string) => slot.presetId === 'injectors' || slot.presetId === 'consultants'
    ? atendimentoProfessionalColor(label, professionals)
    : slot.presetId === 'procedures'
      ? atendimentoEntityColor(label)
      : '#38bdf8'
  return (
    <Card className={`${panelClass} min-w-0 ${slot.layout === 'wide' ? 'lg:col-span-2' : ''}`} data-testid="atendimento-chart-card">
      <CardHeader className="flex flex-col gap-3 pb-2">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <CardTitle className="flex min-w-0 items-center gap-2 text-base text-white"><PresetIcon className="h-4.5 w-4.5 shrink-0 text-sky-300" /><span className="truncate">{preset.label}</span></CardTitle>
          <div className="flex shrink-0 items-center gap-1">
            <IconOnlyAction label="Mover gráfico para a esquerda" description="Reorganizar a posição deste gráfico no painel." onClick={() => onMove(-1)} disabled={!canMoveLeft} data-testid="atendimento-chart-move-left"><ChevronLeft className="h-4 w-4" /></IconOnlyAction>
            <IconOnlyAction label="Mover gráfico para a direita" description="Reorganizar a posição deste gráfico no painel." onClick={() => onMove(1)} disabled={!canMoveRight} data-testid="atendimento-chart-move-right"><ChevronRight className="h-4 w-4" /></IconOnlyAction>
            <IconOnlyAction label="Redimensionar gráfico" description="Alternar entre largura compacta, padrão e ampliada." onClick={onCycleLayout} data-testid="atendimento-chart-resize"><ChevronsUpDown className="h-4 w-4" /></IconOnlyAction>
            <IconOnlyAction label={slot.layout === 'wide' ? 'Restaurar largura do gráfico' : 'Expandir gráfico'} description={slot.layout === 'wide' ? 'Voltar para a largura padrão.' : 'Ocupar duas colunas quando houver espaço.'} onClick={onToggleWide} data-testid="atendimento-chart-expand">{slot.layout === 'wide' ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</IconOnlyAction>
            {canRemove ? <IconOnlyAction label="Remover gráfico" description="Retirar este gráfico do painel." onClick={onRemove} tooltipAlign="right"><Trash2 className="h-4 w-4" /></IconOnlyAction> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={slot.presetId} onValueChange={(value) => onChange({ presetId: value as AtendimentoChartPreset, view: value === 'monthly' ? 'area' : value === 'ticket' ? 'line' : 'bar', metric: value === 'ticket' ? 'value' : slot.metric })}>
            <SelectTrigger className="h-8 min-w-[9rem] border-slate-700 bg-slate-900/70 text-xs text-slate-100"><SelectValue /></SelectTrigger>
            <SelectContent>{CHART_PRESETS.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent>
          </Select>
          {slot.presetId === 'ticket' ? <span className="inline-flex h-8 items-center rounded-md border border-slate-700 bg-slate-900/70 px-2.5 text-xs text-slate-300">Média por registro</span> : (
            <Select value={slot.metric} onValueChange={(value) => onChange({ metric: value as AtendimentoChartMetric })}><SelectTrigger className="h-8 w-24 border-slate-700 bg-slate-900/70 text-xs text-slate-100"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="value">R$</SelectItem><SelectItem value="count">Qtd</SelectItem></SelectContent></Select>
          )}
          <Select value={view} onValueChange={(value) => onChange({ view: value as AtendimentoChartView })}><SelectTrigger className="h-8 w-28 border-slate-700 bg-slate-900/70 text-xs text-slate-100"><SelectValue /></SelectTrigger><SelectContent>{CHART_VIEWS.filter((item) => slot.presetId === 'monthly' || slot.presetId === 'ticket' || item.id !== 'area').map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent></Select>
          <Select value={String(slot.topN)} onValueChange={(value) => onChange({ topN: Number(value) })}><SelectTrigger className="h-8 w-24 border-slate-700 bg-slate-900/70 text-xs text-slate-100"><SelectValue /></SelectTrigger><SelectContent>{[5, 8, 10, 12].map((value) => <SelectItem key={value} value={String(value)}>Top {value}</SelectItem>)}</SelectContent></Select>
        </div>
      </CardHeader>
      <CardContent>
        {data.length ? <div className="w-full" style={{ height }}><ResponsiveContainer width="100%" height="100%">
          {view === 'line' ? <LineChart data={data} margin={{ left: 0, right: 8, top: 12, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" /><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(value) => String(value).slice(0, 14)} /><YAxis tickLine={false} axisLine={false} width={48} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={axisFormatter} />{tooltip}<Line type="monotone" dataKey={dataKey} stroke="#38bdf8" strokeWidth={2} dot={false} /></LineChart> : view === 'bar' ? <BarChart data={data} layout={slot.presetId === 'monthly' || slot.presetId === 'ticket' ? 'horizontal' : 'vertical'} margin={{ left: 8, right: 12, top: 12, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />{slot.presetId === 'monthly' || slot.presetId === 'ticket' ? <><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} /><YAxis tickLine={false} axisLine={false} width={48} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={axisFormatter} /></> : <><XAxis type="number" tickLine={false} axisLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={axisFormatter} /><YAxis type="category" dataKey="label" width={120} tickLine={false} axisLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(value) => String(value).slice(0, 18)} /></>}{tooltip}<Bar dataKey={dataKey} fill="#38bdf8" radius={slot.presetId === 'monthly' || slot.presetId === 'ticket' ? [6, 6, 0, 0] : [0, 6, 6, 0]}>{data.map((item) => <Cell key={item.label} fill={getBarColor(item.label)} />)}</Bar></BarChart> : <AreaChart data={data} margin={{ left: 0, right: 8, top: 12, bottom: 0 }}><defs><linearGradient id={`atendimentoChartFill-${slot.presetId}-${metric}`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#38bdf8" stopOpacity={0.32} /><stop offset="95%" stopColor="#38bdf8" stopOpacity={0.02} /></linearGradient></defs><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} /><YAxis tickLine={false} axisLine={false} width={48} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={axisFormatter} />{tooltip}<Area type="monotone" dataKey={dataKey} stroke="#38bdf8" strokeWidth={2} fill={`url(#atendimentoChartFill-${slot.presetId}-${metric})`} /></AreaChart>}
        </ResponsiveContainer></div> : <div className="rounded-2xl border border-slate-800 bg-slate-900/35 p-4 text-sm text-slate-400">Sem dados para este gráfico.</div>}
      </CardContent>
    </Card>
  )
}

export function AtendimentoChartsPanel({ overview, professionals = [], slots, onSlotsChange }: {
  overview: AtendimentoOverview | null
  professionals?: AtendimentoVisualProfessional[]
  slots: AtendimentoChartSlot[]
  onSlotsChange: React.Dispatch<React.SetStateAction<AtendimentoChartSlot[]>>
}) {
  const [expanded, setExpanded] = React.useState(() => {
    try { return window.localStorage.getItem('skincos.atendimento.charts.expanded.v1') !== 'false' } catch { return true }
  })
  React.useEffect(() => {
    try { window.localStorage.setItem('skincos.atendimento.charts.expanded.v1', String(expanded)) } catch { /* unavailable storage */ }
  }, [expanded])
  const updateSlot = (index: number, patch: Partial<AtendimentoChartSlot>) => onSlotsChange((prev) => prev.map((slot, current) => current === index ? { ...slot, ...patch } : slot))
  const addChart = () => onSlotsChange((prev) => prev.length >= 6 ? prev : [...prev, { presetId: 'injectors', metric: 'value', view: 'bar', topN: 5 }])
  const resetCharts = () => onSlotsChange(DEFAULT_ATENDIMENTO_CHART_SLOTS)
  const moveSlot = (index: number, direction: -1 | 1) => onSlotsChange((prev) => {
    const target = index + direction
    if (target < 0 || target >= prev.length) return prev
    const next = [...prev]
    ;[next[index], next[target]] = [next[target], next[index]]
    return next
  })
  const cycleLayout = (index: number) => {
    const layouts: Array<NonNullable<AtendimentoChartSlot['layout']>> = ['compact', 'standard', 'wide']
    const current = layouts.indexOf(slots[index]?.layout || 'standard')
    updateSlot(index, { layout: layouts[(current + 1) % layouts.length] })
  }
  return (
    <section className="space-y-3 border-t border-slate-800/70 pt-3" data-testid="atendimento-charts-panel" aria-label="Gráficos">
      <div className="flex items-center justify-between gap-3 px-1"><button type="button" className="flex min-w-0 items-center gap-2 text-left text-base font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded} aria-controls="atendimento-charts-content" data-testid="atendimento-charts-toggle"><AreaChartIcon className="h-5 w-5 shrink-0 text-emerald-300" />Gráficos{expanded ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}</button><div className="flex shrink-0 items-center gap-2"><IconOnlyAction label="Adicionar gráfico" description="Criar outro gráfico configurável no painel." onClick={addChart} disabled={slots.length >= 6} tooltipAlign="right" data-testid="atendimento-chart-add"><Plus className="h-4 w-4" /></IconOnlyAction><IconOnlyAction label="Resetar gráficos" description="Restaurar a seleção padrão de gráficos." onClick={resetCharts} tooltipAlign="right" data-testid="atendimento-chart-reset"><RefreshCw className="h-4 w-4" /></IconOnlyAction></div></div>
      {expanded ? <div id="atendimento-charts-content" className={`grid gap-3 ${slots.length <= 1 ? 'grid-cols-1' : slots.length === 2 ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1 lg:grid-cols-2 xl:grid-cols-3'}`}>{slots.map((slot, index) => <AtendimentoChartCard key={`${index}-${slot.presetId}-${slot.metric}-${slot.view}`} slot={slot} overview={overview} professionals={professionals} onChange={(patch) => updateSlot(index, patch)} onMove={(direction) => moveSlot(index, direction)} onCycleLayout={() => cycleLayout(index)} onToggleWide={() => updateSlot(index, { layout: slot.layout === 'wide' ? 'standard' : 'wide' })} onRemove={() => onSlotsChange((prev) => prev.filter((_, current) => current !== index))} canRemove={slots.length > 1} canMoveLeft={index > 0} canMoveRight={index < slots.length - 1} />)}</div> : <div id="atendimento-charts-content" className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-400">Os gráficos estão recolhidos. Abra a seção para consultar e configurar o painel.</div>}
    </section>
  )
}
