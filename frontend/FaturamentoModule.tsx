import React from 'react'
import { BarChart3, Banknote, BriefcaseBusiness, CalendarCheck, CalendarDays, CalendarRange, FileSpreadsheet, RefreshCw, Save, Target, WalletCards } from 'lucide-react'
import { Button } from '@/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Input } from '@/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { DEFAULT_ATENDIMENTO_FILTERS, formatCurrencyBRL, formatNumberBR, parseBrazilCurrency } from '@/atendimentoClinicaDomain'
import {
  fetchAtendimentoManagementCommercial,
  fetchAtendimentoManagementCharts,
  fetchAtendimentoManagementFinance,
  fetchAtendimentoMonthlyGoals,
  upsertAtendimentoMonthlyGoal,
  type AtendimentoManagementCharts,
  type AtendimentoManagementCommercial,
  type AtendimentoManagementFinance,
  type AtendimentoGoalTable,
  type AtendimentoMonthlyGoal,
  type AtendimentoMonthlyGoalLevel,
} from '@/atendimentoClinicaApi'

const panelClass = 'border-slate-800/80 bg-slate-950/60 shadow-[0_20px_80px_rgba(2,6,23,0.35)] backdrop-blur-xl'
const compactPanelClass = 'rounded-2xl border border-slate-800/75 bg-slate-950/45'
const MONTHLY_GOAL_LEVELS = [
  { key: 'first', label: '1ª META' },
  { key: 'second', label: '2ª META' },
  { key: 'third', label: '3ª META' },
  { key: 'super', label: 'SUPER META' },
] as const
type MonthlyGoalLevelKey = typeof MONTHLY_GOAL_LEVELS[number]['key']
type MonthlyGoalLevelInputs = Record<MonthlyGoalLevelKey, string>
const EMPTY_GOAL_LEVEL_INPUTS: MonthlyGoalLevelInputs = { first: '', second: '', third: '', super: '' }
const GOAL_LEVEL_BADGES: Record<MonthlyGoalLevelKey, string> = {
  first: '1ª meta',
  second: '2ª meta',
  third: '3ª meta',
  super: 'SUPER meta',
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <Card className={`${panelClass} overflow-hidden rounded-2xl`}>
      <CardContent className="p-4">
        <div className="text-xs font-medium text-slate-400">{label}</div>
        <div className="mt-2 truncate text-2xl font-semibold text-white">{value}</div>
        <div className="mt-1 text-xs text-slate-400">{detail}</div>
      </CardContent>
    </Card>
  )
}

function SourceRows({ rows, empty }: { rows: Array<{ label: string; value: string; detail?: string }>; empty: string }) {
  if (!rows.length) return <div className={`${compactPanelClass} p-4 text-sm text-slate-400`}>{empty}</div>
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={`${row.label}:${row.value}`} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800/70 bg-slate-900/40 px-3 py-2 text-sm">
          <div className="min-w-0">
            <div className="truncate font-medium text-slate-100">{row.label}</div>
            {row.detail ? <div className="truncate text-xs text-slate-500">{row.detail}</div> : null}
          </div>
          <div className="shrink-0 font-semibold text-white">{row.value}</div>
        </div>
      ))}
    </div>
  )
}

function buildChartRows(charts: Record<'Comercial' | 'Meta', AtendimentoManagementCharts | null>) {
  return (['Comercial', 'Meta'] as const).flatMap((tabName) => {
    const tab = charts[tabName]
    if (!tab) return []
    if (!tab.configured) {
      return [{
        label: tabName,
        value: 'sem credencial',
        detail: tab.hint || 'Service account não configurada para listar gráficos.',
      }]
    }
    const rows = tab.charts
      .filter((chart) => chart.tabName === tabName)
      .map((chart) => ({
        label: chart.title ? `${tabName} · ${chart.title}` : tabName,
        value: `#${chart.chartId}`,
        detail: `sheetId ${chart.sheetId ?? '-'}`,
      }))
    return rows.length ? rows : [{ label: tabName, value: '0 gráficos', detail: 'Nenhum gráfico embutido encontrado pela Sheets API.' }]
  })
}

function unwrapGoalCell(value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    if ('result' in record) return record.result
    if ('formattedValue' in record) return record.formattedValue
    if ('value' in record) return record.value
  }
  return value
}

function formatGoalCell(value: unknown, header = '') {
  const raw = unwrapGoalCell(value)
  if (raw === null || raw === undefined || raw === '') return '-'
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const normalizedHeader = String(header || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    if (normalizedHeader.includes('crescimento') || normalizedHeader.includes('rep.')) {
      return new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(raw)
    }
    if (normalizedHeader.includes('meta') || raw >= 1000) return formatCurrencyBRL(raw)
    return formatNumberBR(raw)
  }
  return String(raw).replace(/\s+/g, ' ').trim()
}

function findGoalLevel(
  goalLevels: AtendimentoMonthlyGoalLevel[],
  unitSlug: string,
  month: string,
  levelKey: MonthlyGoalLevelKey,
) {
  return goalLevels.find((goal) => goal.unitSlug === unitSlug && goal.month === month && goal.levelKey === levelKey)
}

function groupGoalLevels(goalLevels: AtendimentoMonthlyGoalLevel[]) {
  const grouped = new Map<string, { unitSlug: string; unitName: string; month: string; levels: Partial<Record<MonthlyGoalLevelKey, AtendimentoMonthlyGoalLevel>> }>()
  for (const goal of goalLevels) {
    const key = `${goal.unitSlug}:${goal.month}`
    const entry = grouped.get(key) || { unitSlug: goal.unitSlug, unitName: goal.unitName, month: goal.month, levels: {} }
    if (MONTHLY_GOAL_LEVELS.some((level) => level.key === goal.levelKey)) {
      entry.levels[goal.levelKey as MonthlyGoalLevelKey] = goal
    }
    grouped.set(key, entry)
  }
  return Array.from(grouped.values()).sort((a, b) => `${b.month}:${a.unitName}`.localeCompare(`${a.month}:${b.unitName}`, 'pt-BR'))
}

function daysInGoalMonth(month: string) {
  const [year, monthIndex] = String(month || '').split('-').map(Number)
  if (!year || !monthIndex) return 30
  return new Date(year, monthIndex, 0).getDate()
}

function getGoalLevelValue(
  selectedGoal: AtendimentoMonthlyGoal | undefined,
  selectedGoalLevels: Partial<Record<MonthlyGoalLevelKey, AtendimentoMonthlyGoalLevel>>,
  key: MonthlyGoalLevelKey,
) {
  return Number(selectedGoalLevels[key]?.value || (key === 'first' ? selectedGoal?.value : 0) || 0)
}

function GoalTargetsMatrix({
  selectedGoal,
  selectedGoalLevels,
  month,
}: {
  selectedGoal?: AtendimentoMonthlyGoal
  selectedGoalLevels: Partial<Record<MonthlyGoalLevelKey, AtendimentoMonthlyGoalLevel>>
  month: string
}) {
  const days = daysInGoalMonth(month)
  const columns = [
    { key: 'daily', label: 'Diária', icon: CalendarDays, getValue: (monthlyValue: number) => monthlyValue / days },
    { key: 'weekly', label: 'Semanal', icon: CalendarRange, getValue: (monthlyValue: number) => (monthlyValue / days) * 7 },
    { key: 'monthly', label: 'Mensal', icon: CalendarCheck, getValue: (monthlyValue: number) => monthlyValue },
  ]
  const hasAnyGoal = MONTHLY_GOAL_LEVELS.some((level) => getGoalLevelValue(selectedGoal, selectedGoalLevels, level.key) > 0)
  if (!hasAnyGoal) {
    return (
      <div className={`${compactPanelClass} p-4 text-sm text-slate-400`}>
        Nenhuma meta cadastrada para a unidade e mês selecionados.
      </div>
    )
  }
  return (
    <div className={`${compactPanelClass} overflow-hidden p-4`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white">Matriz de metas</div>
          <div className="text-xs text-slate-500">Projeção oficial do mês selecionado, sem vínculo com filtros customizados.</div>
        </div>
        <div className="rounded-full border border-slate-700 bg-slate-900/70 px-2.5 py-1 text-xs text-slate-300">
          {month.split('-').reverse().join('/')}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 px-1 pb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
        {columns.map((column) => {
          const Icon = column.icon
          return (
            <div key={column.key} className="flex items-center gap-1.5">
              <Icon className="h-3 w-3 text-emerald-300" />
              {column.label}
            </div>
          )
        })}
      </div>
      <div className="space-y-2">
        {MONTHLY_GOAL_LEVELS.map((level) => {
          const monthlyValue = getGoalLevelValue(selectedGoal, selectedGoalLevels, level.key)
          return (
            <div key={level.key} className="grid grid-cols-3 gap-2">
              {columns.map((column) => (
                <div key={column.key} className="min-w-0 rounded-xl border border-slate-800/80 bg-slate-950/45 px-2.5 py-2">
                  <span className="mb-1 inline-flex h-5 items-center rounded-md border border-emerald-400/25 bg-emerald-400/10 px-2 text-[10px] font-bold text-emerald-100">
                    {GOAL_LEVEL_BADGES[level.key]}
                  </span>
                  <div className="truncate text-sm font-semibold leading-tight text-white">
                    {formatCurrencyBRL(column.getValue(monthlyValue))}
                  </div>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function GoalTables({ tables }: { tables: AtendimentoGoalTable[] }) {
  const tabs = React.useMemo(() => Array.from(new Set(tables.map((table) => table.sourceTab))).sort((a, b) => b.localeCompare(a, 'pt-BR')), [tables])
  const [activeTab, setActiveTab] = React.useState('')
  React.useEffect(() => {
    if (!tabs.length) {
      setActiveTab('')
      return
    }
    setActiveTab((current) => (current && tabs.includes(current) ? current : tabs[0]))
  }, [tabs])
  const visibleTables = tables.filter((table) => table.sourceTab === activeTab)
  if (!tables.length) {
    return <div className={`${compactPanelClass} p-4 text-sm text-slate-400`}>Nenhuma tabela Meta 2025/2026 importada ainda.</div>
  }
  return (
    <Card className={`${panelClass}`}>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-white">
            <FileSpreadsheet className="h-5 w-5 text-emerald-300" />
            Tabelas Meta
          </CardTitle>
          <div className="mt-1 text-xs text-slate-500">Blocos importados das abas Meta 2025 e Meta 2026. As colunas 1ª, 2ª, 3ª e SUPER alimentam as metas mensais por unidade.</div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {tabs.map((tab) => (
            <Button
              key={tab}
              size="sm"
              variant="outline"
              className={`h-9 border-slate-700 text-xs ${activeTab === tab ? 'bg-emerald-500/15 text-emerald-100' : 'bg-slate-900/60 text-slate-300 hover:bg-slate-800/80'}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 xl:grid-cols-2">
        {visibleTables.map((table) => {
          const headerRow = table.rows.find((row) => row.label.toLowerCase() === 'período') || table.rows[0]
          const columns = (table.columns.length ? table.columns : (headerRow?.values || []).map((value) => String(unwrapGoalCell(value) || ''))).slice(0, 18)
          const rows = table.rows.filter((row) => row.id !== headerRow?.id)
          return (
            <div key={`${table.sourceTab}:${table.unitSlug}`} className={`${compactPanelClass} overflow-hidden`}>
              <div className="flex items-center justify-between gap-3 border-b border-slate-800/80 px-4 py-3">
                <div>
                  <div className="font-semibold text-white">{table.unitName}</div>
                  <div className="text-xs text-slate-500">{table.sourceTab}</div>
                </div>
                <div className="rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1 text-xs text-slate-300">{rows.length} linhas</div>
              </div>
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full min-w-[920px] text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-slate-950">
                    <tr className="border-b border-slate-800">
                      {columns.map((column, index) => (
                        <th key={`${table.unitSlug}:h:${index}`} className={`px-3 py-2 font-medium text-slate-300 ${index === 0 ? 'sticky left-0 z-20 bg-slate-950' : ''}`}>
                          {column || '-'}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className="border-b border-slate-800/60 hover:bg-slate-900/45">
                        {columns.map((column, index) => (
                          <td key={`${row.id}:${index}`} className={`px-3 py-2 text-slate-200 ${index === 0 ? 'sticky left-0 bg-slate-950/95 font-medium text-white' : index >= 8 && index <= 11 ? 'font-semibold text-emerald-100' : ''}`}>
                            {formatGoalCell(row.values[index], column)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

export function FaturamentoModule() {
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState('')
  const [chartsError, setChartsError] = React.useState('')
  const [goalMessage, setGoalMessage] = React.useState('')
  const [savingGoal, setSavingGoal] = React.useState(false)
  const [commercial, setCommercial] = React.useState<AtendimentoManagementCommercial | null>(null)
  const [finance, setFinance] = React.useState<AtendimentoManagementFinance | null>(null)
  const [goalUnits, setGoalUnits] = React.useState<Array<{ slug: string; name: string }>>([])
  const [monthlyGoals, setMonthlyGoals] = React.useState<AtendimentoMonthlyGoal[]>([])
  const [monthlyGoalLevels, setMonthlyGoalLevels] = React.useState<AtendimentoMonthlyGoalLevel[]>([])
  const [goalMonth, setGoalMonth] = React.useState(() => new Date().toISOString().slice(0, 7))
  const [goalUnit, setGoalUnit] = React.useState('')
  const [goalValues, setGoalValues] = React.useState<MonthlyGoalLevelInputs>(EMPTY_GOAL_LEVEL_INPUTS)
  const [charts, setCharts] = React.useState<Record<'Comercial' | 'Meta', AtendimentoManagementCharts | null>>({ Comercial: null, Meta: null })

  const load = React.useCallback(async () => {
    setLoading(true)
    setError('')
    setChartsError('')
    const [commercialResult, financeResult, goalsResult, comercialChartsResult, metaChartsResult] = await Promise.all([
      fetchAtendimentoManagementCommercial(DEFAULT_ATENDIMENTO_FILTERS),
      fetchAtendimentoManagementFinance(),
      fetchAtendimentoMonthlyGoals({ month: goalMonth }),
      fetchAtendimentoManagementCharts('Comercial'),
      fetchAtendimentoManagementCharts('Meta'),
    ])
    if (commercialResult.ok) setCommercial(commercialResult)
    if (financeResult.ok) setFinance(financeResult)
    if (goalsResult.ok) {
      setGoalUnits(goalsResult.units || [])
      setMonthlyGoals(goalsResult.goals || [])
      setMonthlyGoalLevels(goalsResult.goalLevels || [])
      setGoalUnit((current) => current || goalsResult.units?.[0]?.slug || '')
    }
    setCharts({
      Comercial: comercialChartsResult.ok ? comercialChartsResult : null,
      Meta: metaChartsResult.ok ? metaChartsResult : null,
    })
    const nextError = !commercialResult.ok
      ? commercialResult.error
      : !financeResult.ok
        ? financeResult.error
        : !goalsResult.ok
          ? goalsResult.error
          : ''
    if (nextError) setError(nextError || 'Não foi possível carregar Faturamento.')
    const optionalChartsError = !comercialChartsResult.ok
      ? comercialChartsResult.error
      : !metaChartsResult.ok
        ? metaChartsResult.error
        : ''
    if (optionalChartsError && optionalChartsError !== 'FORBIDDEN') setChartsError(optionalChartsError)
    setLoading(false)
  }, [goalMonth])

  React.useEffect(() => {
    void load()
  }, [load])

  const selectedGoal = monthlyGoals.find((goal) => goal.unitSlug === goalUnit && goal.month === goalMonth)
  const selectedGoalLevels = React.useMemo(() => {
    return Object.fromEntries(MONTHLY_GOAL_LEVELS.map((level) => [
      level.key,
      findGoalLevel(monthlyGoalLevels, goalUnit, goalMonth, level.key),
    ])) as Partial<Record<MonthlyGoalLevelKey, AtendimentoMonthlyGoalLevel>>
  }, [goalMonth, goalUnit, monthlyGoalLevels])
  const groupedMonthlyGoalLevels = React.useMemo(() => groupGoalLevels(monthlyGoalLevels), [monthlyGoalLevels])

  const saveMonthlyGoal = async () => {
    if (!goalUnit || !goalMonth) {
      setGoalMessage('Selecione unidade e mês.')
      return
    }
    setSavingGoal(true)
    setGoalMessage('')
    const levels = Object.fromEntries(MONTHLY_GOAL_LEVELS.map((level) => {
      const typedValue = goalValues[level.key]
      const fallback = selectedGoalLevels[level.key]?.value || (level.key === 'first' ? selectedGoal?.value : 0) || 0
      return [level.key, parseBrazilCurrency(typedValue || fallback)]
    }))
    const result = await upsertAtendimentoMonthlyGoal({
      unitSlug: goalUnit,
      month: goalMonth,
      levels,
    })
    setSavingGoal(false)
    if (!result.ok) {
      setGoalMessage(result.error || 'Não foi possível salvar a meta mensal.')
      return
    }
    setGoalValues(EMPTY_GOAL_LEVEL_INPUTS)
    setGoalMessage('Metas mensais salvas no banco do CRM.')
    await load()
  }

  return (
    <div className="atendimento-clinica-surface flex min-h-full flex-col gap-5 px-3 pb-6 pt-3 text-white sm:px-6">
      <Card className={`${panelClass} relative overflow-hidden`}>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.12),transparent_34%)]" />
        <CardHeader className="relative flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-white">
              <WalletCards className="h-5 w-5 text-emerald-300" />
              Faturamento
            </CardTitle>
            <div className="mt-1 text-sm text-slate-400">Comercial e Caixa migrados da Gerência para evolução financeira dedicada.</div>
          </div>
          <Button variant="outline" className="border-slate-700 bg-slate-900/60 text-white hover:bg-slate-800/80" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </CardHeader>
      </Card>

      {error ? <div className="rounded-2xl border border-amber-400/30 bg-amber-500/12 p-3 text-sm text-amber-100">{error}</div> : null}

      <div className="grid gap-3 md:grid-cols-3">
        <Metric label="Faturamento Atendimento" value={formatCurrencyBRL(commercial?.summary?.totalValue || 0)} detail="Base transacional do Atend. Clínica" />
        <Metric label="Atendimentos" value={formatNumberBR(commercial?.summary?.totalAttendances || 0)} detail="Volume usado na reconciliação futura" />
        <Metric label="Ticket médio" value={formatCurrencyBRL(commercial?.summary?.averageTicket || 0)} detail="Média por atendimento" />
      </div>

      <Card className={`${panelClass}`}>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-white">
              <Target className="h-5 w-5 text-emerald-300" />
              Metas mensais
            </CardTitle>
            <div className="mt-1 text-xs text-slate-500">Meta por unidade e mês usada pelo Atend. Clínica e demais módulos do CRM.</div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 xl:grid-cols-[1fr_1.25fr]">
          <div className={`${compactPanelClass} grid gap-3 p-4`}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs font-medium text-slate-400">
                <span>Unidade</span>
                <Select value={goalUnit} onValueChange={setGoalUnit}>
                  <SelectTrigger className="h-10 border-slate-700 bg-slate-900/70 text-white">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {goalUnits.map((unit) => <SelectItem key={unit.slug} value={unit.slug}>{unit.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>
              <label className="space-y-1 text-xs font-medium text-slate-400">
                <span>Mês</span>
                <Input type="month" value={goalMonth} onChange={(event) => setGoalMonth(event.target.value)} className="h-10 border-slate-700 bg-slate-900/70 text-white" />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {MONTHLY_GOAL_LEVELS.map((level) => {
                const selectedLevel = selectedGoalLevels[level.key]
                const fallback = selectedLevel?.value || (level.key === 'first' ? selectedGoal?.value : 0)
                return (
                  <label key={level.key} className="space-y-1 text-xs font-medium text-slate-400">
                    <span>{level.label}</span>
                    <Input
                      value={goalValues[level.key]}
                      onChange={(event) => setGoalValues((prev) => ({ ...prev, [level.key]: event.target.value }))}
                      placeholder={fallback ? formatCurrencyBRL(fallback) : 'R$ 0,00'}
                      className="h-10 border-slate-700 bg-slate-900/70 text-white"
                    />
                  </label>
                )
              })}
            </div>
            <div className="text-xs text-slate-500">Os quatro patamares vêm das fórmulas das abas Meta 2025/2026. Edite apenas quando o CRM precisar substituir o valor importado.</div>
            <Button className="border border-emerald-400/30 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25" onClick={saveMonthlyGoal} disabled={savingGoal || !goalUnit || !goalMonth}>
              <Save className={`h-4 w-4 ${savingGoal ? 'animate-pulse' : ''}`} />
              Salvar meta
            </Button>
            {goalMessage ? <div className="rounded-xl border border-slate-700/70 bg-slate-900/60 px-3 py-2 text-xs text-slate-300">{goalMessage}</div> : null}
          </div>
          <div className="grid gap-3">
            <GoalTargetsMatrix selectedGoal={selectedGoal} selectedGoalLevels={selectedGoalLevels} month={goalMonth} />
            <div className="grid gap-2">
              {groupedMonthlyGoalLevels.length ? groupedMonthlyGoalLevels.map((goal) => (
                <div key={`${goal.unitSlug}:${goal.month}`} className="rounded-2xl border border-slate-800/70 bg-slate-900/40 px-3 py-2 text-sm">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-emerald-400/25 bg-emerald-400/10 text-emerald-100">
                      <CalendarCheck className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-100">{goal.unitName}</div>
                      <div className="truncate text-xs text-slate-500">{goal.month.split('-').reverse().join('/')}</div>
                    </div>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {MONTHLY_GOAL_LEVELS.map((level) => (
                      <div key={level.key} className="flex items-center justify-between gap-2 rounded-xl border border-slate-800/70 bg-slate-950/45 px-2 py-1.5">
                        <span className="text-[11px] font-medium text-slate-400">{level.label}</span>
                        <span className="text-xs font-semibold text-white">{formatCurrencyBRL(goal.levels[level.key]?.value || 0)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )) : <div className={`${compactPanelClass} p-4 text-sm text-slate-400`}>Nenhuma meta mensal cadastrada para este mês.</div>}
            </div>
          </div>
        </CardContent>
      </Card>

      <GoalTables tables={finance?.goalTables || []} />

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className={`${panelClass}`}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white"><BriefcaseBusiness className="h-5 w-5 text-sky-300" />Comercial</CardTitle>
          </CardHeader>
          <CardContent>
            <SourceRows
              rows={(commercial?.sourceTabs || []).map((item) => ({
                label: item.sourceTab,
                value: `${formatNumberBR(item.rows)} linhas`,
                detail: item.activeRows === undefined ? '' : `${formatNumberBR(item.activeRows)} ativas`,
              }))}
              empty="Sem abas comerciais importadas."
            />
          </CardContent>
        </Card>
        <Card className={`${panelClass}`}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white"><BarChart3 className="h-5 w-5 text-cyan-300" />Gráficos da Gerência</CardTitle>
            <div className="text-xs text-slate-500">Equivalente às funções Apps Script que listavam chart IDs de Comercial e Meta.</div>
          </CardHeader>
          <CardContent className="space-y-3">
            <SourceRows rows={buildChartRows(charts)} empty="Gráficos disponíveis apenas para gestores com credencial Google configurada." />
            {chartsError ? <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-100">{chartsError}</div> : null}
          </CardContent>
        </Card>
        <Card className={`${panelClass}`}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white"><Banknote className="h-5 w-5 text-emerald-300" />Caixa</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <SourceRows
              rows={(finance?.attendanceTotals?.units || []).map((item) => ({
                label: item.unitName,
                value: formatCurrencyBRL(item.value),
                detail: `${formatNumberBR(item.count)} atendimentos`,
              }))}
              empty="Sem totais por unidade."
            />
            <SourceRows
              rows={(finance?.sourceTabs || []).map((item) => ({
                label: item.sourceTab,
                value: `${formatNumberBR(item.rows)} linhas`,
              }))}
              empty="Sem abas de caixa importadas."
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
