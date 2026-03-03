import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/badge'
import { Button } from '@/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Input } from '@/input'
import { LoadingPercentText } from '@/LoadingPattern'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/select'
import { useAuth } from '@/contexts'
import { cn, getStatusColor } from '@/utils'
import {
  addClosedDay,
  addHoliday,
  addScheduleEntry,
  fetchEscalaOverview,
  fetchEscalaProfessionals,
  fetchEscalaSchedule,
  removeClosedDay,
  removeHoliday,
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

export function EscalaProfissionaisModule() {
  const { user } = useAuth()
  const roleKey = String(user?.role || '').trim().toUpperCase()
  const canAccess = roleKey === 'GESTOR' || roleKey === 'GERENTE'

  const [units, setUnits] = useState<string[]>([])
  const [months, setMonths] = useState<string[]>([])
  const [selectedUnit, setSelectedUnit] = useState<string>('')
  const [selectedMonth, setSelectedMonth] = useState<string>('')
  const [selectedProfessional, setSelectedProfessional] = useState<string>('Todos')
  const [search, setSearch] = useState('')
  const [professionals, setProfessionals] = useState<EscalaProfessional[]>([])
  const [schedule, setSchedule] = useState<EscalaScheduleEntry[]>([])
  const [closedDays, setClosedDays] = useState<EscalaClosedDay[]>([])
  const [holidays, setHolidays] = useState<EscalaHoliday[]>([])
  const [loadingOverview, setLoadingOverview] = useState(true)
  const [loadingSchedule, setLoadingSchedule] = useState(false)
  const [loadingProfessionals, setLoadingProfessionals] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editorDate, setEditorDate] = useState('')
  const [editorProfessionals, setEditorProfessionals] = useState('')
  const [editorSingleProfessional, setEditorSingleProfessional] = useState('')
  const [editorReason, setEditorReason] = useState('')
  const [editorHolidayName, setEditorHolidayName] = useState('')
  const [editorLoading, setEditorLoading] = useState(false)

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

  const ensureEditorReady = () => {
    if (!selectedUnit) {
      toast.error('Selecione uma unidade antes de editar a escala.')
      return false
    }
    if (!editorDate) {
      toast.error('Informe a data da escala.')
      return false
    }
    return true
  }

  const handleReplaceSchedule = async () => {
    if (!ensureEditorReady()) return
    const list = parseProfessionals(editorProfessionals)
    if (!list.length) {
      toast.error('Informe ao menos um profissional para substituir a agenda.')
      return
    }
    setEditorLoading(true)
    const res = await replaceScheduleEntries({ date: editorDate, unit: selectedUnit, professionals: list })
    setEditorLoading(false)
    if (!res.ok) {
      toast.error(res.error || 'Falha ao atualizar a agenda.')
      return
    }
    toast.success('Agenda atualizada.')
    void refreshSchedule()
    void refreshOverview()
  }

  const handleAddScheduleEntry = async () => {
    if (!ensureEditorReady()) return
    const professional = editorSingleProfessional.trim()
    if (!professional) {
      toast.error('Selecione um profissional para adicionar.')
      return
    }
    setEditorLoading(true)
    const res = await addScheduleEntry({ date: editorDate, unit: selectedUnit, professional })
    setEditorLoading(false)
    if (!res.ok) {
      toast.error(res.error || 'Falha ao adicionar profissional.')
      return
    }
    toast.success('Profissional adicionado ao dia.')
    void refreshSchedule()
    void refreshOverview()
  }

  const handleRemoveScheduleEntry = async () => {
    if (!ensureEditorReady()) return
    const professional = editorSingleProfessional.trim()
    if (!professional) {
      toast.error('Selecione um profissional para remover.')
      return
    }
    setEditorLoading(true)
    const res = await removeScheduleEntry({ date: editorDate, unit: selectedUnit, professional })
    setEditorLoading(false)
    if (!res.ok) {
      toast.error(res.error || 'Falha ao remover profissional.')
      return
    }
    toast.success('Profissional removido do dia.')
    void refreshSchedule()
    void refreshOverview()
  }

  const handleCloseDay = async () => {
    if (!ensureEditorReady()) return
    setEditorLoading(true)
    const res = await addClosedDay({ date: editorDate, unit: selectedUnit, reason: editorReason })
    setEditorLoading(false)
    if (!res.ok) {
      toast.error(res.error || 'Falha ao bloquear dia.')
      return
    }
    toast.success('Dia bloqueado.')
    void refreshSchedule()
    void refreshOverview()
  }

  const handleOpenDay = async () => {
    if (!ensureEditorReady()) return
    setEditorLoading(true)
    const res = await removeClosedDay({ date: editorDate, unit: selectedUnit })
    setEditorLoading(false)
    if (!res.ok) {
      toast.error(res.error || 'Falha ao remover bloqueio.')
      return
    }
    toast.success('Bloqueio removido.')
    void refreshSchedule()
    void refreshOverview()
  }

  const handleAddHoliday = async () => {
    if (!ensureEditorReady()) return
    if (!editorHolidayName.trim()) {
      toast.error('Informe o nome do feriado.')
      return
    }
    setEditorLoading(true)
    const res = await addHoliday({ date: editorDate, unit: selectedUnit, name: editorHolidayName })
    setEditorLoading(false)
    if (!res.ok) {
      toast.error(res.error || 'Falha ao cadastrar feriado.')
      return
    }
    toast.success('Feriado cadastrado.')
    void refreshSchedule()
    void refreshOverview()
  }

  const handleRemoveHoliday = async () => {
    if (!ensureEditorReady()) return
    if (!editorHolidayName.trim()) {
      toast.error('Informe o nome do feriado.')
      return
    }
    setEditorLoading(true)
    const res = await removeHoliday({ date: editorDate, unit: selectedUnit, name: editorHolidayName })
    setEditorLoading(false)
    if (!res.ok) {
      toast.error(res.error || 'Falha ao remover feriado.')
      return
    }
    toast.success('Feriado removido.')
    void refreshSchedule()
    void refreshOverview()
  }

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

  const scheduleNames = useMemo(() => new Set(schedule.map((e) => e.professional)), [schedule])
  const mergedProfessionals = useMemo(() => mergeProfessionals(scheduleNames, professionals), [scheduleNames, professionals])

  const professionalsByUnit = useMemo(() => {
    if (!selectedUnit) return mergedProfessionals
    return mergedProfessionals.filter((p) => !p.units.length || p.units.includes(selectedUnit))
  }, [mergedProfessionals, selectedUnit])

  const filteredProfessionals = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const list = professionalsByUnit
    if (!needle) return list
    return list.filter((p) => p.name.toLowerCase().includes(needle) || p.role.toLowerCase().includes(needle))
  }, [professionalsByUnit, search])

  const professionalOptions = useMemo(() => {
    return professionalsByUnit.map((prof) => prof.name)
  }, [professionalsByUnit])

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
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.45),_rgba(14,165,233,0.18),_transparent_70%)]" />
        <CardHeader>
          <div className="relative flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="text-white">Escala de Profissionais</CardTitle>
              <div className="text-sm text-slate-200/80">
                Visualize a escala cadastrada no CRM e organize os atendimentos por unidade, mês e profissional.
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
        <CardContent className="flex flex-col gap-4">
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
                  {filteredProfessionals.map((prof) => (
                    <SelectItem key={prof.name} value={prof.name}>
                      {prof.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="glass-morphism rounded-xl border border-white/10 px-4 py-3">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-300/70">Dias com atendimento</div>
              <div className="mt-2 text-2xl font-semibold text-white">{totalScheduledDays}</div>
              <div className="text-xs text-slate-300/80">no mês selecionado</div>
            </div>
            <div className="glass-morphism rounded-xl border border-white/10 px-4 py-3">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-300/70">Dias sem atendimento</div>
              <div className="mt-2 text-2xl font-semibold text-white">{closedDaysForMonth.length}</div>
              <div className="text-xs text-slate-300/80">para {selectedUnit || '—'}</div>
            </div>
            <div className="glass-morphism rounded-xl border border-white/10 px-4 py-3">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-300/70">Profissionais escalados</div>
              <div className="mt-2 text-2xl font-semibold text-white">{monthProfessionals.length}</div>
              <div className="text-xs text-slate-300/80">com pelo menos 1 atendimento</div>
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
                const isClosed = closedDates.has(cell.date)
                const holidayLabels = holidayByDate.get(cell.date) || []
                const visibleEntries = selectedProfessional === 'Todos'
                  ? entries
                  : entries.filter((entry) => entry.professional === selectedProfessional)
                const highlight = selectedProfessional !== 'Todos' && visibleEntries.length

                return (
                  <div
                    key={cell.date}
                    className={cn(
                      'flex h-full flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-slate-100/90 transition-all',
                      highlight && 'ring-2 ring-emerald-400/40'
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
                      {visibleEntries.map((entry) => (
                        <div key={`${entry.date}-${entry.professional}`} className="rounded-lg bg-white/10 px-2 py-1 text-[11px]">
                          {entry.professional}
                        </div>
                      ))}
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
                  </div>
                )}
              )}
            </div>
          </CardContent>
        </Card>

        <div className="flex min-h-0 flex-col gap-4">
          <Card className="glass-card" id="escala-editor">
            <CardHeader className="border-b border-white/10">
              <CardTitle className="text-white">Editor da escala</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-xs text-slate-100/90">
              <div className="grid gap-3">
                <div className="space-y-1">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-slate-300/70">Data</div>
                  <Input
                    type="date"
                    value={editorDate}
                    onChange={(event) => setEditorDate(event.target.value)}
                    className="bg-white/5"
                  />
                </div>
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
                    onClick={handleReplaceSchedule}
                    disabled={editorLoading}
                  >
                    Substituir agenda do dia
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
                          Nenhum profissional encontrado
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button variant="premium" onClick={handleAddScheduleEntry} disabled={editorLoading}>
                      Adicionar ao dia
                    </Button>
                    <Button variant="outline" onClick={handleRemoveScheduleEntry} disabled={editorLoading}>
                      Remover do dia
                    </Button>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-slate-300/70">Bloqueio do dia</div>
                  <Input
                    value={editorReason}
                    onChange={(event) => setEditorReason(event.target.value)}
                    placeholder="Motivo do bloqueio"
                    className="bg-white/5"
                  />
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button variant="premium" onClick={handleCloseDay} disabled={editorLoading}>
                      Bloquear dia
                    </Button>
                    <Button variant="outline" onClick={handleOpenDay} disabled={editorLoading}>
                      Remover bloqueio
                    </Button>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-slate-300/70">Feriado</div>
                  <Input
                    value={editorHolidayName}
                    onChange={(event) => setEditorHolidayName(event.target.value)}
                    placeholder="Nome do feriado"
                    className="bg-white/5"
                  />
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button variant="premium" onClick={handleAddHoliday} disabled={editorLoading}>
                      Adicionar feriado
                    </Button>
                    <Button variant="outline" onClick={handleRemoveHoliday} disabled={editorLoading}>
                      Remover feriado
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader className="border-b border-white/10">
              <div className="flex items-center justify-between">
                <CardTitle className="text-white">Profissionais</CardTitle>
                {loadingProfessionals && (
                  <div className="text-xs text-slate-300/80">
                    <LoadingPercentText label="Sincronizando" showPercent={false} />
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Busque por nome ou cargo"
                className="bg-white/5"
              />
              <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
                {filteredProfessionals.map((prof) => (
                  <button
                    key={prof.name}
                    type="button"
                    onClick={() => setSelectedProfessional(prof.name)}
                    className={cn(
                      'flex w-full flex-col gap-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-xs transition-all hover:border-white/20',
                      selectedProfessional === prof.name && 'border-emerald-400/40 bg-emerald-500/10'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-white/90">{prof.name}</span>
                      <Badge className={cn('text-[10px]', getStatusColor(prof.status))}>{prof.status || '—'}</Badge>
                    </div>
                    <div className="text-[11px] text-slate-200/80">{prof.role || 'Profissional'}</div>
                    {prof.units.length ? (
                      <div className="flex flex-wrap gap-1 text-[10px] text-slate-300/80">
                        {prof.units.map((unit) => (
                          <span key={unit} className="rounded-md bg-white/10 px-2 py-0.5">
                            {unit}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader className="border-b border-white/10">
              <CardTitle className="text-white">Próximos atendimentos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              {selectedProfessional === 'Todos' && (
                <div className="text-slate-200/80">
                  Selecione um profissional para ver as próximas datas confirmadas.
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
              <CardTitle className="text-white">Feriados & Bloqueios</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div>
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-300/70">Feriados</div>
                <div className="mt-2 space-y-2">
                  {!holidaysForMonth.length && (
                    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-slate-200/80">
                      Nenhum feriado cadastrado no mês.
                    </div>
                  )}
                  {holidaysForMonth.slice(0, 6).map((holiday) => (
                    <div key={`${holiday.date}-${holiday.name}`} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-300/70">{holiday.date}</div>
                      <div className="text-sm font-semibold text-white">{holiday.name}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-300/70">Dias sem atendimento</div>
                <div className="mt-2 space-y-2">
                  {!closedDaysForMonth.length && (
                    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-slate-200/80">
                      Nenhum bloqueio registrado.
                    </div>
                  )}
                  {closedDaysForMonth.slice(0, 6).map((entry) => (
                    <div key={`${entry.date}-${entry.unit}`} className="rounded-lg border border-rose-300/30 bg-rose-500/10 px-3 py-2">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-rose-100/70">{entry.date}</div>
                      <div className="text-sm font-semibold text-white">{entry.reason}</div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
