import React from 'react'
import { AreaChart as AreaChartIcon, BarChart3, Plus, RefreshCw, Stethoscope, Trash2, TrendingUp, Users, type LucideIcon } from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { formatCurrencyBRL, formatNumberBR } from '@/atendimentoDomain'
import type { AtendimentoOverview } from '@/atendimentoApi'

export type AtendimentoChartPreset = 'monthly' | 'ticket' | 'procedures' | 'injectors' | 'consultants'
export type AtendimentoChartMetric = 'value' | 'count'
export type AtendimentoChartView = 'area' | 'line' | 'bar'
export type AtendimentoChartSlot = {
  presetId: AtendimentoChartPreset
  metric: AtendimentoChartMetric
  view: AtendimentoChartView
  topN: number
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
}>(({ label, description, tooltipAlign = 'left', children, className = '', type = 'button', ...buttonProps }, ref) => (
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

function AtendimentoChartCard({ slot, overview, onChange, onRemove, canRemove }: {
  slot: AtendimentoChartSlot
  overview: AtendimentoOverview | null
  onChange: (patch: Partial<AtendimentoChartSlot>) => void
  onRemove: () => void
  canRemove: boolean
}) {
  const preset = resolveChartPreset(slot.presetId)
  const PresetIcon = preset.icon
  const data = chartData(slot, overview)
  const metric = slot.presetId === 'ticket' ? 'value' : slot.metric
  const dataKey = metric === 'count' ? 'count' : 'value'
  const labelFormatter = (value: unknown) => String(value || '')
  const valueFormatter = (value: unknown) => metric === 'count' ? formatNumberBR(Number(value || 0)) : formatCurrencyBRL(Number(value || 0))
  const view = slot.presetId === 'monthly' || slot.presetId === 'ticket' ? slot.view : slot.view === 'area' ? 'bar' : slot.view
  const height = slot.presetId === 'monthly' || slot.presetId === 'ticket' ? 250 : 220
  const axisFormatter = (value: number) => metric === 'count' ? formatNumberBR(Number(value || 0)) : formatCurrencyBRL(Number(value || 0)).replace(',00', '')
  const tooltip = <RechartsTooltip contentStyle={{ background: 'rgba(2,6,23,0.94)', border: '1px solid rgba(51,65,85,0.8)', borderRadius: 14, color: '#e2e8f0' }} formatter={(value) => valueFormatter(value)} labelFormatter={labelFormatter} labelStyle={{ color: '#bae6fd' }} />
  return (
    <Card className={`${panelClass} min-w-0`}>
      <CardHeader className="flex flex-col gap-3 pb-2">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <CardTitle className="flex min-w-0 items-center gap-2 text-base text-white"><PresetIcon className="h-4.5 w-4.5 shrink-0 text-sky-300" /><span className="truncate">{preset.label}</span></CardTitle>
          {canRemove ? <IconOnlyAction label="Remover gráfico" description="Retirar este gráfico do painel." onClick={onRemove} tooltipAlign="right"><Trash2 className="h-4 w-4" /></IconOnlyAction> : null}
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
          {view === 'line' ? <LineChart data={data} margin={{ left: 0, right: 8, top: 12, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" /><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(value) => String(value).slice(0, 14)} /><YAxis tickLine={false} axisLine={false} width={48} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={axisFormatter} />{tooltip}<Line type="monotone" dataKey={dataKey} stroke="#38bdf8" strokeWidth={2} dot={false} /></LineChart> : view === 'bar' ? <BarChart data={data} layout={slot.presetId === 'monthly' || slot.presetId === 'ticket' ? 'horizontal' : 'vertical'} margin={{ left: 8, right: 12, top: 12, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />{slot.presetId === 'monthly' || slot.presetId === 'ticket' ? <><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} /><YAxis tickLine={false} axisLine={false} width={48} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={axisFormatter} /></> : <><XAxis type="number" tickLine={false} axisLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={axisFormatter} /><YAxis type="category" dataKey="label" width={120} tickLine={false} axisLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={(value) => String(value).slice(0, 18)} /></>}{tooltip}<Bar dataKey={dataKey} fill="#38bdf8" radius={slot.presetId === 'monthly' || slot.presetId === 'ticket' ? [6, 6, 0, 0] : [0, 6, 6, 0]} /></BarChart> : <AreaChart data={data} margin={{ left: 0, right: 8, top: 12, bottom: 0 }}><defs><linearGradient id={`atendimentoChartFill-${slot.presetId}-${metric}`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#38bdf8" stopOpacity={0.32} /><stop offset="95%" stopColor="#38bdf8" stopOpacity={0.02} /></linearGradient></defs><XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} /><YAxis tickLine={false} axisLine={false} width={48} tick={{ fill: '#94a3b8', fontSize: 11 }} tickFormatter={axisFormatter} />{tooltip}<Area type="monotone" dataKey={dataKey} stroke="#38bdf8" strokeWidth={2} fill={`url(#atendimentoChartFill-${slot.presetId}-${metric})`} /></AreaChart>}
        </ResponsiveContainer></div> : <div className="rounded-2xl border border-slate-800 bg-slate-900/35 p-4 text-sm text-slate-400">Sem dados para este gráfico.</div>}
      </CardContent>
    </Card>
  )
}

export function AtendimentoChartsPanel({ overview, slots, onSlotsChange }: {
  overview: AtendimentoOverview | null
  slots: AtendimentoChartSlot[]
  onSlotsChange: React.Dispatch<React.SetStateAction<AtendimentoChartSlot[]>>
}) {
  const updateSlot = (index: number, patch: Partial<AtendimentoChartSlot>) => onSlotsChange((prev) => prev.map((slot, current) => current === index ? { ...slot, ...patch } : slot))
  const addChart = () => onSlotsChange((prev) => prev.length >= 6 ? prev : [...prev, { presetId: 'injectors', metric: 'value', view: 'bar', topN: 5 }])
  const resetCharts = () => onSlotsChange(DEFAULT_ATENDIMENTO_CHART_SLOTS)
  return (
    <section className="space-y-3 border-t border-slate-800/70 pt-3" data-testid="atendimento-charts-panel" aria-label="Gráficos">
      <div className="flex items-center justify-between gap-3 px-1"><h2 className="flex items-center gap-2 text-base font-semibold text-white"><AreaChartIcon className="h-5 w-5 text-emerald-300" />Gráficos</h2><div className="flex shrink-0 items-center gap-2"><IconOnlyAction label="Adicionar gráfico" description="Criar outro gráfico configurável no painel." onClick={addChart} disabled={slots.length >= 6} tooltipAlign="right" data-testid="atendimento-chart-add"><Plus className="h-4 w-4" /></IconOnlyAction><IconOnlyAction label="Resetar gráficos" description="Restaurar a seleção padrão de gráficos." onClick={resetCharts} tooltipAlign="right" data-testid="atendimento-chart-reset"><RefreshCw className="h-4 w-4" /></IconOnlyAction></div></div>
      <div className={`grid gap-3 ${slots.length <= 1 ? 'grid-cols-1' : slots.length === 2 ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1 lg:grid-cols-2 xl:grid-cols-3'}`}>{slots.map((slot, index) => <AtendimentoChartCard key={`${index}-${slot.presetId}-${slot.metric}-${slot.view}`} slot={slot} overview={overview} onChange={(patch) => updateSlot(index, patch)} onRemove={() => onSlotsChange((prev) => prev.filter((_, current) => current !== index))} canRemove={slots.length > 1} />)}</div>
    </section>
  )
}
