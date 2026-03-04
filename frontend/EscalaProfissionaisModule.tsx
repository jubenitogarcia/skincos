import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/badge'
import { Button } from '@/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Input } from '@/input'
import { LoadingPercentText } from '@/LoadingPattern'
import { Popover, PopoverContent, PopoverTrigger } from '@/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { useAuth } from '@/contexts'
import { cn } from '@/utils'
import {
  addClosedDay,
  addScheduleEntry,
  fetchEscalaOverview,
  fetchEscalaProfessionals,
  fetchEscalaSchedule,
  removeClosedDay,
  removeScheduleEntry,
  replaceScheduleEntries
} from '@/escalaApi'

type CalendarCell = {
  date: string
  day: number
}

type EscalaProfessional = {
  name: string
  status: string
  units: string[]
  role: string
  shift: string
  nickname: string
  phone: string
  email: string
  instagram: string
}

type EscalaScheduleEntry = { date: string; unit: string; professional: string }
type EscalaClosedDay = { date: string; unit: string; reason: string }
type EscalaHoliday = { date: string; unit: string; name: string }
type EscalaBlockEntry = { date: string; label: string; type: 'Bloqueio' | 'Feriado legado' }

const MONTH_LABELS = new Map<string, string>()

function formatMonthLabel(value: string) {
  if (MONTH_LABELS.has(value)) return MONTH_LABELS.get(value) as string
  const [year, month] = value.split('-').map(Number)
  const date = new Date(year, month - 1, 1)
  let label = date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  label = label.charAt(0).toUpperCase() + label.slice(1)
  MONTH_LABELS.set(value, label)
  return label
}

function buildCalendarCells(monthValue: string): CalendarCell[] {
  const [year, month] = monthValue.split('-').map(Number)
  const firstDay = new Date(year, month - 1, 1)
  const daysInMonth = new Date(year, month, 0).getDate()
  const mondayIndex = (firstDay.getDay() + 6) % 7
  const pad = (value: number) => String(value).padStart(2, '0')
  const cells: CalendarCell[] = []
  for (let i = 0; i < mondayIndex; i += 1) {
    cells.push({ date: '', day: 0 })
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = `${year}-${pad(month)}-${pad(day)}`
    cells.push({ date: iso, day })
  }
  return cells
}

function normalizeText(value: string) {
  return String(value || '').trim().toLowerCase()
}

function isActiveInjector(prof: EscalaProfessional) {
  const role = normalizeText(prof.role)
  const status = normalizeText(prof.status)
  return role.includes('injetor') && status === 'ativo'
}

function mergeProfessionals(scheduleNames: Set<string>, base: EscalaProfessional[]) {
  const map = new Map(base.map((p) => [p.name, p]))
  scheduleNames.forEach((name) => {
    if (map.has(name)) return
    map.set(name, {
      name,
      status: 'Sem cadastro',
      units: [],
      role: 'Profissional',
      shift: '',
      nickname: '',
      phone: '',
      email: '',
      instagram: ''
    })
  })
  return Array.from(map.values())
}

function uniqueNames(values: string[]) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)))
}

export function EscalaProfissionaisModule() {
  const { user } = useAuth()
  const roleKey = String(user?.role || '').trim().toUpperCase()
  const canAccess = roleKey === 'GESTOR' || roleKey === 'GERENTE'

  const [units, setUnits] = useState<string[]>([])
  const [months, setMonths] = useState<string[]>([])
  const [selectedUnit, setSelectedUnit] = useState<string>('')
  const [selectedMonth, setSelectedMonth] = useState<string>('')
  const [selectedProfessional, setSelectedProfessional] = useState<string>('Todos')
  const [selectedDates, setSelectedDates] = useState<string[]>([])
  const [professionals, setProfessionals] = useState<EscalaProfessional[]>([])
  const [schedule, setSchedule] = useState<EscalaScheduleEntry[]>([])
  const [closedDays, setClosedDays] = useState<EscalaClosedDay[]>([])
  const [holidays, setHolidays] = useState<EscalaHoliday[]>([])
  const [loadingOverview, setLoadingOverview] = useState(true)
  const [loadingSchedule, setLoadingSchedule] = useState(false)
  const [loadingProfessionals, setLoadingProfessionals] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editorProfessionals, setEditorProfessionals] = useState('')
  const [editorSingleProfessional, setEditorSingleProfessional] = useState('')
  const [editorReason, setEditorReason] = useState('')
  const [editorLoading, setEditorLoading] = useState(false)
  const [quickSwapByEntryKey, setQuickSwapByEntryKey] = useState<Record<string, string>>({})
  const [quickActionEntryKey, setQuickActionEntryKey] = useState<string | null>(null)

  const refreshOverview = useCallback(async () => {
    setLoadingOverview(true)
    const res = await fetchEscalaOverview()
    if (!res.ok) {
      setError(res.error || 'Não foi possível carregar a escala.')
      setLoadingOverview(false)
      return
    }
    const nextUnits = Array.isArray(res.units) ? res.units : []
    const nextMonths = Array.isArray(res.months) ? res.months : []
    setUnits(nextUnits)
    setMonths(nextMonths)
    setSelectedUnit((prev) => (prev || nextUnits[0] || prev))
    setSelectedMonth((prev) => (prev || nextMonths[nextMonths.length - 1] || prev))
    setError(null)
    setLoadingOverview(false)
  }, [])

  const refreshProfessionals = useCallback(async (unitOverride?: string) => {
    const unit = unitOverride || selectedUnit
    if (!unit) return
    setLoadingProfessionals(true)
    const res = await fetchEscalaProfessionals(unit)
    if (!res.ok) {
      setError(res.error || 'Não foi possível carregar profissionais.')
      setLoadingProfessionals(false)
      return
    }
    setProfessionals(Array.isArray(res.data) ? res.data : [])
    setError(null)
    setLoadingProfessionals(false)
  }, [selectedUnit])

  const refreshSchedule = useCallback(async (unitOverride?: string, monthOverride?: string) => {
    const unit = unitOverride || selectedUnit
    const month = monthOverride || selectedMonth
    if (!unit || !month) return
    setLoadingSchedule(true)
    const res = await fetchEscalaSchedule(unit, month)
    if (!res.ok) {
      setError(res.error || 'Não foi possível carregar a agenda.')
      setLoadingSchedule(false)
      return
    }
    setSchedule(Array.isArray(res.schedule) ? res.schedule : [])
    setClosedDays(Array.isArray(res.closedDays) ? res.closedDays : [])
    setHolidays(Array.isArray(res.holidays) ? res.holidays : [])
    setError(null)
    setLoadingSchedule(false)
  }, [selectedMonth, selectedUnit])

  const parseProfessionals = useCallback((value: string) => {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }, [])

  const toggleDateSelection = useCallback((date: string) => {
    setSelectedDates((prev) => {
      if (prev.includes(date)) return prev.filter((item) => item !== date)
      return [...prev, date].sort()
    })
  }, [])

  const clearDateSelection = useCallback(() => {
    setSelectedDates([])
  }, [])

  const ensureEditorReady = useCallback(() => {
    if (!selectedUnit) {
      toast.error('Selecione uma unidade antes de editar a escala.')
      return false
    }
    if (!selectedDates.length) {
      toast.error('Selecione ao menos um dia na agenda para editar.')
      return false
    }
    return true
  }, [selectedDates.length, selectedUnit])

  const runOnSelectedDates = useCallback(async (
    actionLabel: string,
    runner: (date: string) => Promise<{ ok: boolean; error?: string }>
  ) => {
    if (!ensureEditorReady()) return false
    setEditorLoading(true)
    const failures: string[] = []
    for (const date of selectedDates) {
      const res = await runner(date)
      if (!res.ok) failures.push(`${date}: ${res.error || 'falha desconhecida'}`)
    }
    setEditorLoading(false)

    if (failures.length) {
      toast.error(`Falha em ${failures.length} dia(s). Primeiro erro: ${failures[0]}`)
      return false
    }

    toast.success(`${actionLabel} em ${selectedDates.length} dia(s).`)
    await refreshSchedule()
    await refreshOverview()
    return true
  }, [ensureEditorReady, refreshOverview, refreshSchedule, selectedDates])

  const handleReplaceSchedule = useCallback(async () => {
    const list = uniqueNames(parseProfessionals(editorProfessionals))
    if (!list.length) {
      toast.error('Informe ao menos um profissional para substituir a agenda.')
      return
    }
    await runOnSelectedDates('Agenda substituída', (date) => replaceScheduleEntries({ date, unit: selectedUnit, professionals: list }))
  }, [editorProfessionals, parseProfessionals, runOnSelectedDates, selectedUnit])

  const handleAddScheduleEntry = useCallback(async () => {
    const professional = editorSingleProfessional.trim()
    if (!professional) {
      toast.error('Selecione um profissional para adicionar.')
      return
    }
    await runOnSelectedDates('Profissional adicionado', (date) => addScheduleEntry({ date, unit: selectedUnit, professional }))
  }, [editorSingleProfessional, runOnSelectedDates, selectedUnit])

  const handleRemoveScheduleEntry = useCallback(async () => {
    const professional = editorSingleProfessional.trim()
    if (!professional) {
      toast.error('Selecione um profissional para remover.')
      return
    }
    await runOnSelectedDates('Profissional removido', (date) => removeScheduleEntry({ date, unit: selectedUnit, professional }))
  }, [editorSingleProfessional, runOnSelectedDates, selectedUnit])

  const handleCloseDay = useCallback(async () => {
    await runOnSelectedDates('Dias bloqueados', (date) => addClosedDay({ date, unit: selectedUnit, reason: editorReason }))
  }, [editorReason, runOnSelectedDates, selectedUnit])

  const handleOpenDay = useCallback(async () => {
    await runOnSelectedDates('Bloqueios removidos', (date) => removeClosedDay({ date, unit: selectedUnit }))
  }, [runOnSelectedDates, selectedUnit])

  const scrollToEditor = useCallback(() => {
    const el = document.getElementById('escala-editor')
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  useEffect(() => {
    void refreshOverview()
  }, [refreshOverview])

  useEffect(() => {
    if (!selectedUnit) return
    void refreshProfessionals(selectedUnit)
  }, [selectedUnit, refreshProfessionals])

  useEffect(() => {
    if (!selectedUnit || !selectedMonth) return
    void refreshSchedule(selectedUnit, selectedMonth)
  }, [selectedMonth, selectedUnit, refreshSchedule])

  useEffect(() => {
    if (!selectedMonth) return
    setSelectedDates((prev) => prev.filter((date) => date.startsWith(`${selectedMonth}-`)))
  }, [selectedMonth])

  const scheduleNames = useMemo(() => new Set(schedule.map((e) => e.professional)), [schedule])
  const mergedProfessionals = useMemo(() => mergeProfessionals(scheduleNames, professionals), [scheduleNames, professionals])

  const professionalsByUnit = useMemo(() => {
    if (!selectedUnit) return mergedProfessionals
    return mergedProfessionals.filter((p) => !p.units.length || p.units.includes(selectedUnit))
  }, [mergedProfessionals, selectedUnit])

  const activeInjectors = useMemo(() => professionalsByUnit.filter(isActiveInjector), [professionalsByUnit])

  const professionalOptions = useMemo(() => activeInjectors.map((prof) => prof.name), [activeInjectors])

  useEffect(() => {
    if (selectedProfessional === 'Todos') return
    if (!professionalOptions.includes(selectedProfessional)) {
      setSelectedProfessional('Todos')
    }
  }, [professionalOptions, selectedProfessional])

  useEffect(() => {
    if (!editorSingleProfessional) return
    if (!professionalOptions.includes(editorSingleProfessional)) {
      setEditorSingleProfessional('')
    }
  }, [editorSingleProfessional, professionalOptions])

  const scheduleForMonth = schedule
  const closedDaysForMonth = closedDays
  const holidaysForMonth = holidays

  const scheduleByDate = useMemo(() => {
    const map = new Map<string, EscalaScheduleEntry[]>()
    scheduleForMonth.forEach((entry) => {
      const next = map.get(entry.date) || []
      next.push(entry)
      map.set(entry.date, next)
    })
    return map
  }, [scheduleForMonth])

  const closedDates = useMemo(() => new Set(closedDaysForMonth.map((d) => d.date)), [closedDaysForMonth])
  const holidayByDate = useMemo(() => {
    const map = new Map<string, string[]>()
    holidaysForMonth.forEach((entry) => {
      const next = map.get(entry.date) || []
      next.push(entry.name)
      map.set(entry.date, next)
    })
    return map
  }, [holidaysForMonth])

  const blockedDates = useMemo(() => {
    const set = new Set<string>()
    closedDaysForMonth.forEach((entry) => set.add(entry.date))
    holidaysForMonth.forEach((entry) => set.add(entry.date))
    return set
  }, [closedDaysForMonth, holidaysForMonth])

  const blockedEntries = useMemo<EscalaBlockEntry[]>(() => {
    const legacy = holidaysForMonth.map((entry) => ({
      date: entry.date,
      label: entry.name,
      type: 'Feriado legado' as const
    }))
    const blocked = closedDaysForMonth.map((entry) => ({
      date: entry.date,
      label: entry.reason || 'Sem atendimento',
      type: 'Bloqueio' as const
    }))
    return [...blocked, ...legacy].sort((a, b) => a.date.localeCompare(b.date))
  }, [closedDaysForMonth, holidaysForMonth])

  const calendarCells = useMemo(() => (selectedMonth ? buildCalendarCells(selectedMonth) : []), [selectedMonth])

  const monthProfessionals = useMemo(() => {
    const set = new Set(scheduleForMonth.map((entry) => entry.professional))
    return Array.from(set)
  }, [scheduleForMonth])

  const upcomingForProfessional = useMemo(() => {
    if (selectedProfessional === 'Todos') return []
    return scheduleForMonth
      .filter((entry) => entry.professional === selectedProfessional)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 8)
  }, [scheduleForMonth, selectedProfessional])

  const totalScheduledDays = useMemo(() => {
    return new Set(scheduleForMonth.map((entry) => entry.date)).size
  }, [scheduleForMonth])

  const handleQuickReplace = useCallback(async (entry: EscalaScheduleEntry, key: string) => {
    const nextProfessional = String(quickSwapByEntryKey[key] || '').trim()
    if (!nextProfessional || nextProfessional === entry.professional) return
    const dayEntries = (scheduleByDate.get(entry.date) || []).map((item) => item.professional)
    const nextNames = uniqueNames(dayEntries.map((name) => (name === entry.professional ? nextProfessional : name)))
    if (!nextNames.length) return

    setQuickActionEntryKey(key)
    const res = await replaceScheduleEntries({ date: entry.date, unit: selectedUnit, professionals: nextNames })
    setQuickActionEntryKey(null)
    if (!res.ok) {
      toast.error(res.error || 'Falha ao trocar profissional.')
      return
    }
    toast.success('Profissional alterado.')
    await refreshSchedule()
    await refreshOverview()
  }, [quickSwapByEntryKey, refreshOverview, refreshSchedule, scheduleByDate, selectedUnit])

  const handleQuickRemove = useCallback(async (entry: EscalaScheduleEntry, key: string) => {
    setQuickActionEntryKey(key)
    const res = await removeScheduleEntry({ date: entry.date, unit: selectedUnit, professional: entry.professional })
    setQuickActionEntryKey(null)
    if (!res.ok) {
      toast.error(res.error || 'Falha ao remover profissional.')
      return
    }
    toast.success('Profissional removido do dia.')
    await refreshSchedule()
    await refreshOverview()
  }, [refreshOverview, refreshSchedule, selectedUnit])

  if (!canAccess) {
    return (
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-white">Acesso restrito</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-200/80">
          O módulo de escala está disponível apenas para usuários gestores.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="escala-surface flex h-full min-h-0 flex-col gap-4 px-4 pb-6 pt-2">
      <Card className="glass-card escala-hero relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.45),_rgba(14,165,233,0.18),_transparent_70%)]" />
        <CardHeader className="relative z-10">
          <div className="relative flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="text-white">Escala de Profissionais</CardTitle>
              <div className="text-sm text-slate-200/80">
                Clique nos dias da agenda para selecionar múltiplas datas e editar em lote.
              </div>
              {loadingOverview && (
                <div className="mt-2 text-xs text-slate-300/80">
                  <LoadingPercentText label="Carregando visão geral" showPercent={false} />
                </div>
              )}
              {error && (
                <div className="mt-2 rounded-xl border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100/80">
                  {error}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="border-white/20 bg-white/5 text-white/90" disabled>
                Exportar resumo
              </Button>
              <Button variant="premium" onClick={scrollToEditor}>
                Ir para o editor
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="relative z-10 flex flex-col gap-4">
          <div className="grid gap-3 md:grid-cols-[1.2fr_1fr_1fr]">
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-300/70">Unidade</div>
              <Select value={selectedUnit} onValueChange={setSelectedUnit}>
                <SelectTrigger className="bg-white/5">
                  <SelectValue placeholder="Escolha" />
                </SelectTrigger>
                <SelectContent>
                  {units.length ? (
                    units.map((unit) => (
                      <SelectItem key={unit} value={unit}>
                        {unit}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="__empty" disabled>
                      Nenhuma unidade carregada
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-300/70">Mês</div>
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger className="bg-white/5">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {months.length ? (
                    months.map((month) => (
                      <SelectItem key={month} value={month}>
                        {formatMonthLabel(month)}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="__empty-month" disabled>
                      Nenhum mês carregado
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-300/70">Profissional</div>
              <Select value={selectedProfessional} onValueChange={setSelectedProfessional}>
                <SelectTrigger className="bg-white/5">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Todos">Todos</SelectItem>
                  {professionalOptions.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs text-slate-200/90">
            <div className="flex flex-wrap items-center gap-2">
              <span className="uppercase tracking-[0.2em] text-slate-300/70">Dias selecionados</span>
              <Badge className="bg-emerald-500/20 text-emerald-100">{selectedDates.length}</Badge>
              {selectedDates.slice(0, 4).map((date) => (
                <Badge key={date} variant="outline" className="border-white/20 bg-white/10 text-white/90">
                  {date}
                </Badge>
              ))}
              {selectedDates.length > 4 && (
                <Badge variant="outline" className="border-white/20 bg-white/10 text-white/90">
                  +{selectedDates.length - 4}
                </Badge>
              )}
            </div>
            <Button variant="outline" className="border-white/20 bg-white/5 text-white/90" onClick={clearDateSelection} disabled={!selectedDates.length}>
              Limpar seleção
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="glass-morphism rounded-xl border border-white/10 px-4 py-3">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-300/70">Dias com atendimento</div>
              <div className="mt-2 text-2xl font-semibold text-white">{totalScheduledDays}</div>
              <div className="text-xs text-slate-300/80">no mês selecionado</div>
            </div>
            <div className="glass-morphism rounded-xl border border-white/10 px-4 py-3">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-300/70">Dias sem atendimento</div>
              <div className="mt-2 text-2xl font-semibold text-white">{blockedDates.size}</div>
              <div className="text-xs text-slate-300/80">para {selectedUnit || '—'}</div>
            </div>
            <div className="glass-morphism rounded-xl border border-white/10 px-4 py-3">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-300/70">Injetores ativos</div>
              <div className="mt-2 text-2xl font-semibold text-white">{professionalOptions.length}</div>
              <div className="text-xs text-slate-300/80">disponíveis para escala</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[2.1fr_1fr]">
        <Card className="glass-card flex min-h-0 flex-col">
          <CardHeader className="border-b border-white/10">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-white">
                Agenda de {selectedMonth ? formatMonthLabel(selectedMonth) : '—'}
              </CardTitle>
              {loadingSchedule && (
                <div className="text-xs text-slate-300/80">
                  <LoadingPercentText label="Atualizando agenda" showPercent={false} />
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-col gap-3">
            <div className="grid grid-cols-7 gap-2 text-xs uppercase tracking-[0.2em] text-slate-300/70">
              {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((label) => (
                <div key={label} className="text-center">
                  {label}
                </div>
              ))}
            </div>
            <div className="grid flex-1 grid-cols-7 gap-2">
              {calendarCells.map((cell, index) => {
                if (!cell.date) {
                  return <div key={`empty-${index}`} className="rounded-xl border border-dashed border-white/5" />
                }
                const entries = scheduleByDate.get(cell.date) || []
                const isClosed = blockedDates.has(cell.date)
                const holidayLabels = holidayByDate.get(cell.date) || []
                const visibleEntries = selectedProfessional === 'Todos'
                  ? entries
                  : entries.filter((entry) => entry.professional === selectedProfessional)
                const highlight = selectedProfessional !== 'Todos' && visibleEntries.length
                const selected = selectedDates.includes(cell.date)

                return (
                  <button
                    key={cell.date}
                    type="button"
                    data-testid={`escala-day-${cell.date}`}
                    onClick={() => toggleDateSelection(cell.date)}
                    className={cn(
                      'flex h-full flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-3 text-left text-xs text-slate-100/90 transition-all hover:border-white/30',
                      highlight && 'ring-2 ring-emerald-400/40',
                      selected && 'border-cyan-300/70 ring-2 ring-cyan-300/50'
                    )}
                  >
                    <div className="flex items-center justify-between text-[11px] text-slate-300/80">
                      <span className="font-semibold text-white/80">{cell.day}</span>
                      {holidayLabels.length ? (
                        <Badge variant="warning" className="px-2 py-0.5 text-[10px]">
                          {holidayLabels[0]}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="space-y-1">
                      {visibleEntries.map((entry) => {
                        const entryKey = `${entry.date}__${entry.professional}`
                        const quickValue = quickSwapByEntryKey[entryKey] || entry.professional
                        const quickOptions = uniqueNames([entry.professional, ...professionalOptions])
                        return (
                          <Popover key={entryKey}>
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                className="w-full rounded-lg bg-white/10 px-2 py-1 text-left text-[11px] hover:bg-white/20"
                                onClick={(event) => event.stopPropagation()}
                              >
                                {entry.professional}
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-72 border-white/15 bg-slate-900/95 text-slate-100" onClick={(event) => event.stopPropagation()}>
                              <div className="space-y-3 text-xs">
                                <div>
                                  <div className="text-[11px] uppercase tracking-[0.2em] text-slate-300/70">Edição rápida</div>
                                  <div className="text-sm text-white">{entry.date}</div>
                                  <div className="text-[11px] text-slate-300/80">{entry.professional}</div>
                                </div>
                                <Select value={quickValue} onValueChange={(value) => setQuickSwapByEntryKey((prev) => ({ ...prev, [entryKey]: value }))}>
                                  <SelectTrigger className="bg-white/5">
                                    <SelectValue placeholder="Selecione" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {quickOptions.map((name) => (
                                      <SelectItem key={`${entryKey}-${name}`} value={name}>
                                        {name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <div className="flex gap-2">
                                  <Button
                                    variant="premium"
                                    className="flex-1"
                                    onClick={() => void handleQuickReplace(entry, entryKey)}
                                    disabled={quickActionEntryKey === entryKey}
                                  >
                                    Trocar
                                  </Button>
                                  <Button
                                    variant="outline"
                                    className="flex-1"
                                    onClick={() => void handleQuickRemove(entry, entryKey)}
                                    disabled={quickActionEntryKey === entryKey}
                                  >
                                    Remover
                                  </Button>
                                </div>
                              </div>
                            </PopoverContent>
                          </Popover>
                        )
                      })}
                      {!visibleEntries.length && isClosed && (
                        <div className="rounded-lg border border-rose-300/30 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-100/80">
                          Sem atendimento
                        </div>
                      )}
                      {!visibleEntries.length && !isClosed && (
                        <div className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-300/80">
                          Livre
                        </div>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <div className="flex min-h-0 flex-col gap-4">
          <Card className="glass-card" id="escala-editor">
            <CardHeader className="border-b border-white/10">
              <CardTitle className="text-white">Editor da escala</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-xs text-slate-100/90">
              <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-slate-200/80">
                Dias selecionados na agenda: <span className="font-semibold text-white">{selectedDates.length}</span>
              </div>

              <div className="grid gap-3">
                <div className="space-y-1">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-slate-300/70">Profissionais (CSV)</div>
                  <Input
                    value={editorProfessionals}
                    onChange={(event) => setEditorProfessionals(event.target.value)}
                    placeholder="ex: Dra. Ana, Dr. Lucas"
                    className="bg-white/5"
                  />
                  <Button
                    variant="outline"
                    className="mt-2 border-white/20 bg-white/5 text-white/90"
                    onClick={() => void handleReplaceSchedule()}
                    disabled={editorLoading}
                  >
                    Substituir agenda dos dias selecionados
                  </Button>
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-slate-300/70">Profissional único</div>
                  <Select value={editorSingleProfessional} onValueChange={setEditorSingleProfessional}>
                    <SelectTrigger className="bg-white/5" data-testid="escala-editor-professional">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {professionalOptions.length ? (
                        professionalOptions.map((name) => (
                          <SelectItem key={name} value={name}>
                            {name}
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="__empty" disabled>
                          Nenhum injetor ativo encontrado
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button variant="premium" onClick={() => void handleAddScheduleEntry()} disabled={editorLoading}>
                      Adicionar nos dias selecionados
                    </Button>
                    <Button variant="outline" onClick={() => void handleRemoveScheduleEntry()} disabled={editorLoading}>
                      Remover dos dias selecionados
                    </Button>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-slate-300/70">Bloqueio (inclui feriados)</div>
                  <Input
                    value={editorReason}
                    onChange={(event) => setEditorReason(event.target.value)}
                    placeholder="Motivo do bloqueio (ex: Feriado Nacional)"
                    className="bg-white/5"
                  />
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button variant="premium" onClick={() => void handleCloseDay()} disabled={editorLoading}>
                      Bloquear dias selecionados
                    </Button>
                    <Button variant="outline" onClick={() => void handleOpenDay()} disabled={editorLoading}>
                      Remover bloqueio
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader className="border-b border-white/10">
              <div className="flex items-center justify-between">
                <CardTitle className="text-white">Próximos atendimentos</CardTitle>
                {loadingProfessionals && (
                  <div className="text-xs text-slate-300/80">
                    <LoadingPercentText label="Sincronizando" showPercent={false} />
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {selectedProfessional === 'Todos' && (
                <div className="text-slate-200/80">
                  Selecione um profissional no filtro do topo para ver as próximas datas confirmadas.
                </div>
              )}
              {selectedProfessional !== 'Todos' && !upcomingForProfessional.length && (
                <div className="text-slate-200/80">Nenhum atendimento encontrado no mês selecionado.</div>
              )}
              {upcomingForProfessional.map((entry) => (
                <div key={`${entry.date}-${entry.professional}`} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-slate-300/70">{entry.date}</div>
                  <div className="text-sm font-semibold text-white">{entry.professional}</div>
                  <div className="text-[11px] text-slate-200/80">{selectedUnit || '—'}</div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader className="border-b border-white/10">
              <CardTitle className="text-white">Bloqueios do mês</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {!blockedEntries.length && (
                <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-slate-200/80">
                  Nenhum bloqueio registrado.
                </div>
              )}
              {blockedEntries.slice(0, 10).map((entry, index) => (
                <div key={`${entry.date}-${entry.label}-${index}`} className="rounded-lg border border-rose-300/30 bg-rose-500/10 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-rose-100/70">{entry.date}</div>
                    <Badge variant="outline" className="border-rose-200/40 text-rose-100/90">{entry.type}</Badge>
                  </div>
                  <div className="text-sm font-semibold text-white">{entry.label}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
