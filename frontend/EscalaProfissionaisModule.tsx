import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Shield } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/badge'
import { Button } from '@/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { Checkbox } from '@/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/dialog'
import { Input } from '@/input'
import { LoadingPercentText } from '@/LoadingPattern'
import { Popover, PopoverContent, PopoverTrigger } from '@/popover'
import { useAuth } from '@/contexts'
import { cn } from '@/utils'
import {
  addClosedDay,
  fetchEscalaOverview,
  fetchEscalaProfessionals,
  fetchEscalaSchedule,
  removeScheduleEntry,
  removeClosedDay,
  replaceScheduleEntries
} from '@/escalaApi'

type CalendarCell = {
  date: string
  day: number
  monthOffset: -1 | 0 | 1
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
const DEFAULT_DATE = new Date()
const DEFAULT_MONTH_NUMBER = String(DEFAULT_DATE.getMonth() + 1).padStart(2, '0')
const DEFAULT_YEAR = String(DEFAULT_DATE.getFullYear())
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0'))
const ALL_PROFESSIONALS_OPTION = '–'

function formatMonthLabel(value: string) {
  if (MONTH_LABELS.has(value)) return MONTH_LABELS.get(value) as string
  const [year, month] = value.split('-').map(Number)
  const date = new Date(year, month - 1, 1)
  let label = date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  label = label.charAt(0).toUpperCase() + label.slice(1)
  MONTH_LABELS.set(value, label)
  return label
}

function formatMonthName(value: string) {
  const month = Number(value)
  if (!month) return value
  const date = new Date(2000, month - 1, 1)
  let label = date.toLocaleDateString('pt-BR', { month: 'long' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function formatDisplayDate(value: string) {
  const [year, month, day] = String(value || '').split('-')
  if (!year || !month || !day) return value
  return `${day}/${month}/${year}`
}

function shiftMonthValue(monthValue: string, offset: number) {
  const [year, month] = monthValue.split('-').map(Number)
  const date = new Date(year, month - 1 + offset, 1)
  return {
    year: String(date.getFullYear()),
    monthNumber: String(date.getMonth() + 1).padStart(2, '0'),
  }
}

function buildCalendarCells(monthValue: string): CalendarCell[] {
  const [year, month] = monthValue.split('-').map(Number)
  const firstDay = new Date(year, month - 1, 1)
  const daysInMonth = new Date(year, month, 0).getDate()
  const mondayIndex = (firstDay.getDay() + 6) % 7
  const pad = (value: number) => String(value).padStart(2, '0')
  const cells: CalendarCell[] = []
  const previousMonthDate = new Date(year, month - 2, 1)
  const previousMonthDays = new Date(year, month - 1, 0).getDate()
  const previousMonthYear = previousMonthDate.getFullYear()
  const previousMonthNumber = previousMonthDate.getMonth() + 1
  for (let i = 0; i < mondayIndex; i += 1) {
    const day = previousMonthDays - mondayIndex + i + 1
    cells.push({
      date: `${previousMonthYear}-${pad(previousMonthNumber)}-${pad(day)}`,
      day,
      monthOffset: -1,
    })
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = `${year}-${pad(month)}-${pad(day)}`
    cells.push({ date: iso, day, monthOffset: 0 })
  }
  const trailingCount = (7 - (cells.length % 7)) % 7
  const nextMonthDate = new Date(year, month, 1)
  const nextMonthYear = nextMonthDate.getFullYear()
  const nextMonthNumber = nextMonthDate.getMonth() + 1
  for (let day = 1; day <= trailingCount; day += 1) {
    cells.push({
      date: `${nextMonthYear}-${pad(nextMonthNumber)}-${pad(day)}`,
      day,
      monthOffset: 1,
    })
  }
  return cells
}

function normalizeText(value: string) {
  return String(value || '').trim().toLowerCase()
}

function normalizeUnitKey(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim()
}

function unitsMatch(left: string, right: string) {
  return normalizeUnitKey(left) === normalizeUnitKey(right)
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

function buildYearOptions(monthKeys: string[]) {
  const currentYear = Number(DEFAULT_YEAR)
  const years = new Set<string>([String(currentYear - 1), DEFAULT_YEAR, String(currentYear + 1), String(currentYear + 2)])
  monthKeys.forEach((value) => {
    const year = String(value || '').slice(0, 4)
    if (/^\d{4}$/.test(year)) years.add(year)
  })
  return Array.from(years).sort((a, b) => Number(a) - Number(b))
}

function hashString(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = value.charCodeAt(index) + ((hash << 5) - hash)
  }
  return Math.abs(hash)
}

function getProfessionalBadgeStyle(name: string, mode: 'default' | 'active' | 'muted' = 'default') {
  const hash = hashString(name)
  const hue = hash % 360
  const baseText = `hsl(${hue} 88% 92%)`

  if (mode === 'active') {
    return {
      background: `linear-gradient(135deg, hsla(${hue}, 82%, 56%, 0.38), hsla(${(hue + 28) % 360}, 82%, 58%, 0.26))`,
      borderColor: `hsla(${hue}, 88%, 74%, 0.9)`,
      color: 'white',
      boxShadow: `0 0 0 1px hsla(${hue}, 90%, 74%, 0.45), 0 16px 28px hsla(${hue}, 90%, 20%, 0.28), inset 0 1px 0 rgba(255,255,255,0.18)`,
      opacity: 1,
    } as React.CSSProperties
  }

  if (mode === 'muted') {
    return {
      background: 'rgba(15, 23, 42, 0.28)',
      borderColor: 'rgba(148, 163, 184, 0.18)',
      color: 'rgba(226, 232, 240, 0.58)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)',
      opacity: 0.72,
    } as React.CSSProperties
  }

  return {
    background: `linear-gradient(135deg, hsla(${hue}, 78%, 56%, 0.22), hsla(${(hue + 24) % 360}, 78%, 58%, 0.14))`,
    borderColor: `hsla(${hue}, 84%, 72%, 0.4)`,
    color: baseText,
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
    opacity: 1,
  } as React.CSSProperties
}

function getProfessionalCardHighlightStyle(name: string) {
  const hue = hashString(name) % 360
  return {
    borderColor: `hsla(${hue}, 88%, 74%, 0.72)`,
    background: `linear-gradient(180deg, hsla(${hue}, 86%, 54%, 0.12), rgba(15, 23, 42, 0.34))`,
    boxShadow: `0 0 0 1px hsla(${hue}, 88%, 74%, 0.25), 0 18px 34px hsla(${hue}, 90%, 18%, 0.24), inset 0 1px 0 rgba(255,255,255,0.06)`,
  } as React.CSSProperties
}

function getAdjacentMonthCardStyle(type: 'previous-month' | 'next-month', position: number, total: number) {
  if (!total || !position) return {} as React.CSSProperties
  const step = 0.8 / total
  const transparency = type === 'previous-month'
    ? Math.min(0.9, 0.1 + step * (total - position + 1))
    : Math.min(0.9, 0.1 + step * (position - 1))
  const opacity = 1 - transparency * 0.58
  const blur = 8 + transparency * 10
  const saturation = 0.84 - transparency * 0.36
  const grayscale = 0.12 + transparency * 0.52
  const borderAlpha = 0.08 + transparency * 0.18
  const topAlpha = 0.025 + transparency * 0.07
  const bottomAlpha = 0.045 + transparency * 0.12
  return {
    opacity: Number(opacity.toFixed(3)),
    borderColor: `rgba(148, 163, 184, ${borderAlpha.toFixed(3)})`,
    background: `linear-gradient(180deg, rgba(255,255,255,${topAlpha.toFixed(3)}), rgba(148,163,184,${bottomAlpha.toFixed(3)}))`,
    boxShadow: `inset 0 1px 0 rgba(255,255,255,${(0.03 + transparency * 0.06).toFixed(3)}), 0 10px 24px rgba(15,23,42,${(0.05 + transparency * 0.08).toFixed(3)})`,
    filter: `grayscale(${grayscale.toFixed(2)}) saturate(${saturation.toFixed(2)})`,
    backdropFilter: `blur(${blur.toFixed(1)}px) saturate(${(0.9 - transparency * 0.18).toFixed(2)})`,
    WebkitBackdropFilter: `blur(${blur.toFixed(1)}px) saturate(${(0.9 - transparency * 0.18).toFixed(2)})`,
  } as React.CSSProperties
}

function slugifySegment(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export function EscalaProfissionaisModule() {
  const { user } = useAuth()
  const roleKey = String(user?.role || '').trim().toUpperCase()
  const canAccess = roleKey === 'GESTOR' || roleKey === 'GERENTE'

  const [units, setUnits] = useState<string[]>([])
  const [availableMonths, setAvailableMonths] = useState<string[]>([])
  const [selectedUnit, setSelectedUnit] = useState<string>('')
  const [selectedMonthNumber, setSelectedMonthNumber] = useState<string>(DEFAULT_MONTH_NUMBER)
  const [selectedYear, setSelectedYear] = useState<string>(DEFAULT_YEAR)
  const [selectedProfessional, setSelectedProfessional] = useState<string>(ALL_PROFESSIONALS_OPTION)
  const [professionals, setProfessionals] = useState<EscalaProfessional[]>([])
  const [schedule, setSchedule] = useState<EscalaScheduleEntry[]>([])
  const [closedDays, setClosedDays] = useState<EscalaClosedDay[]>([])
  const [holidays, setHolidays] = useState<EscalaHoliday[]>([])
  const [loadingOverview, setLoadingOverview] = useState(true)
  const [loadingSchedule, setLoadingSchedule] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dayProfessionalDrafts, setDayProfessionalDrafts] = useState<Record<string, string[]>>({})
  const [dayBlockReasons, setDayBlockReasons] = useState<Record<string, string>>({})
  const [dayActionKey, setDayActionKey] = useState<string | null>(null)
  const [activeDate, setActiveDate] = useState<string | null>(null)
  const [highlightMode, setHighlightMode] = useState<'scheduled' | 'blocked' | 'empty' | null>(null)
  const activeDateRef = useRef<string | null>(null)
  const selectedMonth = useMemo(
    () => (selectedYear && selectedMonthNumber ? `${selectedYear}-${selectedMonthNumber}` : ''),
    [selectedMonthNumber, selectedYear],
  )

  useEffect(() => {
    activeDateRef.current = activeDate
  }, [activeDate])

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
    setAvailableMonths(nextMonths)
    setSelectedUnit((prev) => (prev || nextUnits[0] || prev))
    setSelectedMonthNumber((prev) => prev || DEFAULT_MONTH_NUMBER)
    setSelectedYear((prev) => prev || DEFAULT_YEAR)
    setError(null)
    setLoadingOverview(false)
  }, [])

  const refreshProfessionals = useCallback(async (unitOverride?: string) => {
    const unit = unitOverride || selectedUnit
    if (!unit) return
    const res = await fetchEscalaProfessionals(unit)
    if (!res.ok) {
      setError(res.error || 'Não foi possível carregar profissionais.')
      return
    }
    setProfessionals(Array.isArray(res.data) ? res.data : [])
    setError(null)
  }, [selectedUnit])

  const refreshSchedule = useCallback(async (unitOverride?: string, monthOverride?: string) => {
    const unit = unitOverride || selectedUnit
    const month = monthOverride || (selectedYear && selectedMonthNumber ? `${selectedYear}-${selectedMonthNumber}` : '')
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
  }, [selectedMonthNumber, selectedUnit, selectedYear])

  const clearInteractiveState = useCallback(() => {
    setSelectedProfessional(ALL_PROFESSIONALS_OPTION)
    setActiveDate(null)
    setHighlightMode(null)
  }, [])

  const focusProfessional = useCallback((name: string) => {
    setSelectedProfessional((prev) => (prev === name ? ALL_PROFESSIONALS_OPTION : name))
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
  }, [refreshSchedule, selectedMonthNumber, selectedUnit, selectedYear])

  useEffect(() => {
    const activeMonth = selectedYear && selectedMonthNumber ? `${selectedYear}-${selectedMonthNumber}` : ''
    if (!activeMonth) return
    setActiveDate((prev) => (prev && prev.startsWith(`${activeMonth}-`) ? prev : null))
  }, [selectedMonthNumber, selectedYear])

  const scheduleNames = useMemo(() => new Set(schedule.map((e) => e.professional)), [schedule])
  const mergedProfessionals = useMemo(() => mergeProfessionals(scheduleNames, professionals), [scheduleNames, professionals])

  const professionalsByUnit = useMemo(() => {
    if (!selectedUnit) return mergedProfessionals
    return mergedProfessionals.filter((p) => !p.units.length || p.units.some((unit) => unitsMatch(unit, selectedUnit)))
  }, [mergedProfessionals, selectedUnit])

  const activeInjectors = useMemo(() => professionalsByUnit.filter(isActiveInjector), [professionalsByUnit])
  const professionalOptions = useMemo(() => uniqueNames(activeInjectors.map((prof) => prof.name)), [activeInjectors])
  const headerProfessionalOptions = useMemo(
    () => uniqueNames(selectedProfessional !== ALL_PROFESSIONALS_OPTION ? [...professionalOptions, selectedProfessional] : professionalOptions),
    [professionalOptions, selectedProfessional],
  )
  const assignableProfessionalOptions = useMemo(
    () => uniqueNames([...professionalOptions, ...schedule.map((entry) => entry.professional)]),
    [professionalOptions, schedule],
  )
  const yearOptions = useMemo(() => buildYearOptions(availableMonths), [availableMonths])

  useEffect(() => {
    if (selectedProfessional === ALL_PROFESSIONALS_OPTION) return
    if (!headerProfessionalOptions.includes(selectedProfessional)) {
      setSelectedProfessional(ALL_PROFESSIONALS_OPTION)
    }
  }, [headerProfessionalOptions, selectedProfessional])

  useEffect(() => {
    setDayProfessionalDrafts({})
  }, [selectedMonth, selectedUnit, selectedProfessional])

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
  const closedReasonByDate = useMemo(() => {
    const map = new Map<string, string>()
    closedDaysForMonth.forEach((entry) => {
      map.set(entry.date, entry.reason || 'Sem atendimento')
    })
    return map
  }, [closedDaysForMonth])
  const closedDateSet = useMemo(() => new Set(closedDaysForMonth.map((entry) => entry.date)), [closedDaysForMonth])

  const calendarCells = useMemo(() => (selectedMonth ? buildCalendarCells(selectedMonth) : []), [selectedMonth])

  const totalScheduledDays = useMemo(() => {
    return new Set(scheduleForMonth.map((entry) => entry.date)).size
  }, [scheduleForMonth])
  const unavailableDaysCount = useMemo(() => {
    return calendarCells.reduce((total, cell) => {
      if (cell.monthOffset !== 0) return total
      const hasEntries = (scheduleByDate.get(cell.date) || []).length > 0
      const isBlocked = blockedDates.has(cell.date)
      return !hasEntries && !isBlocked ? total + 1 : total
    }, blockedDates.size)
  }, [blockedDates, calendarCells, scheduleByDate])
  const firstCurrentMonthIndex = useMemo(() => calendarCells.findIndex((cell) => cell.monthOffset === 0), [calendarCells])
  const previousMonthCellsCount = useMemo(() => calendarCells.filter((cell) => cell.monthOffset === -1).length, [calendarCells])
  const nextMonthCellsCount = useMemo(() => calendarCells.filter((cell) => cell.monthOffset === 1).length, [calendarCells])

  useEffect(() => {
    try {
      window.dispatchEvent(new CustomEvent('skincos:escala:header', {
        detail: {
          units,
          monthOptions: MONTH_OPTIONS,
          yearOptions,
          selectedUnit,
          selectedMonth,
          selectedMonthNumber,
          selectedYear,
          selectedProfessional,
          professionalOptions: headerProfessionalOptions,
          totalScheduledDays,
          unavailableDaysCount,
          activeInjectors: professionalOptions.length,
          selectedDatesCount: 0,
          highlightMode,
          loadingOverview
        }
      }))
    } catch {
      // ignore header sync errors
    }
  }, [
    blockedDates.size,
    headerProfessionalOptions,
    loadingOverview,
    professionalOptions,
    selectedMonthNumber,
    selectedMonth,
    selectedProfessional,
    selectedUnit,
    selectedYear,
    totalScheduledDays,
    unavailableDaysCount,
    units,
    yearOptions,
    highlightMode
  ])

  useEffect(() => {
    return () => {
      try {
        window.dispatchEvent(new CustomEvent('skincos:escala:header', { detail: null }))
      } catch {
        // ignore cleanup errors
      }
    }
  }, [])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string; value?: string }>)?.detail || {}
      const action = String(detail?.action || '')
      if (!action) return

      if (action === 'set-unit' && detail.value != null) setSelectedUnit(String(detail.value))
      if (action === 'set-month' && detail.value != null) setSelectedMonthNumber(String(detail.value))
      if (action === 'set-year' && detail.value != null) setSelectedYear(String(detail.value))
      if (action === 'set-professional' && detail.value != null) setSelectedProfessional(String(detail.value))
      if (action === 'toggle-highlight-mode' && detail.value != null) {
        const next = String(detail.value)
        if (next === 'scheduled' || next === 'empty') {
          setHighlightMode((prev) => (prev === next ? null : next))
        }
      }
      if (action === 'clear-selection') clearInteractiveState()
    }

    window.addEventListener('skincos:escala:action', handler as EventListener)
    return () => window.removeEventListener('skincos:escala:action', handler as EventListener)
  }, [clearInteractiveState])

  useEffect(() => {
    if ((selectedProfessional === ALL_PROFESSIONALS_OPTION && !highlightMode) || activeDate) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (!target) return
      if (target.closest('[data-escala-preserve-filter="true"]')) return
      setSelectedProfessional(ALL_PROFESSIONALS_OPTION)
      setHighlightMode(null)
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [activeDate, highlightMode, selectedProfessional])

  const getDayDraft = useCallback((date: string, entries: EscalaScheduleEntry[]) => {
    return dayProfessionalDrafts[date] || uniqueNames(entries.map((entry) => entry.professional))
  }, [dayProfessionalDrafts])

  const toggleDayProfessional = useCallback((date: string, name: string, entries: EscalaScheduleEntry[]) => {
    setDayProfessionalDrafts((prev) => {
      const base = prev[date] || uniqueNames(entries.map((entry) => entry.professional))
      const next = base.includes(name)
        ? base.filter((item) => item !== name)
        : [...base, name]
      return { ...prev, [date]: uniqueNames(next) }
    })
  }, [])

  const handleApplyDayProfessionals = useCallback(async (date: string, entries: EscalaScheduleEntry[]) => {
    if (!selectedUnit) {
      toast.error('Selecione uma unidade antes de alterar a agenda.')
      return false
    }
    const nextNames = uniqueNames(getDayDraft(date, entries))
    const currentNames = uniqueNames(entries.map((entry) => entry.professional))
    const unchanged = nextNames.length === currentNames.length && nextNames.every((name) => currentNames.includes(name))
    if (unchanged) return true

    setDayActionKey(`assign:${date}`)
    const res = nextNames.length
      ? await replaceScheduleEntries({ date, unit: selectedUnit, professionals: nextNames })
      : await removeScheduleEntry({ date, unit: selectedUnit })
    setDayActionKey(null)
    if (!res.ok) {
      toast.error(res.error || 'Falha ao atualizar profissionais do dia.')
      return false
    }
    toast.success(nextNames.length ? 'Agenda do dia atualizada.' : 'Agenda do dia limpa.')
    setDayProfessionalDrafts((prev) => {
      const next = { ...prev }
      delete next[date]
      return next
    })
    await refreshSchedule()
    await refreshOverview()
    return true
  }, [getDayDraft, refreshOverview, refreshSchedule, selectedUnit])

  const closeActiveDateWithSave = useCallback(async () => {
    const date = activeDateRef.current
    if (!date) {
      setActiveDate(null)
      return
    }

    if (!blockedDates.has(date)) {
      const entries = scheduleByDate.get(date) || []
      const saved = await handleApplyDayProfessionals(date, entries)
      if (!saved) return
    }

    setActiveDate(null)
  }, [blockedDates, handleApplyDayProfessionals, scheduleByDate])

  const shiftSelectedMonth = useCallback((offset: number) => {
    const next = shiftMonthValue(selectedMonth, offset)
    setSelectedYear(next.year)
    setSelectedMonthNumber(next.monthNumber)
  }, [selectedMonth])

  const handleToggleDayBlock = useCallback(async (date: string) => {
    if (!selectedUnit) {
      toast.error('Selecione uma unidade antes de bloquear uma data.')
      return
    }

    const isDirectlyBlocked = closedDateSet.has(date)
    setDayActionKey(`block:${date}`)

    if (isDirectlyBlocked) {
      const res = await removeClosedDay({ date, unit: selectedUnit })
      setDayActionKey(null)
      if (!res.ok) {
        toast.error(res.error || 'Falha ao remover bloqueio do dia.')
        return
      }
      toast.success('Bloqueio removido.')
      setDayBlockReasons((prev) => {
        const next = { ...prev }
        delete next[date]
        return next
      })
      setActiveDate(null)
      await refreshSchedule()
      await refreshOverview()
      return
    }

    const reason = String(dayBlockReasons[date] || closedReasonByDate.get(date) || '').trim()
    const clearDayRes = await removeScheduleEntry({ date, unit: selectedUnit })
    if (!clearDayRes.ok) {
      setDayActionKey(null)
      toast.error(clearDayRes.error || 'Falha ao limpar a agenda antes do bloqueio.')
      return
    }

    const res = await addClosedDay({ date, unit: selectedUnit, reason: reason || undefined })
    setDayActionKey(null)
    if (!res.ok) {
      toast.error(res.error || 'Falha ao bloquear o dia.')
      return
    }
    toast.success('Data bloqueada.')
    setDayProfessionalDrafts((prev) => {
      const next = { ...prev }
      delete next[date]
      return next
    })
    setActiveDate(null)
    await refreshSchedule()
    await refreshOverview()
  }, [closedDateSet, closedReasonByDate, dayBlockReasons, refreshOverview, refreshSchedule, selectedUnit])

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
      {error ? (
        <div className="rounded-xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-100/80">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        <Card className="glass-card flex min-h-0 flex-col">
          <CardContent className="flex min-h-0 flex-col gap-2 pt-3">
            <div className="flex items-center justify-end gap-2 pb-1">
              {loadingSchedule ? (
                <div className="text-[11px] text-slate-300/75">
                  <LoadingPercentText label="Atualizando agenda" showPercent={false} />
                </div>
              ) : null}
            </div>
            <div className="grid grid-cols-7 gap-1.5 text-[10px] uppercase tracking-[0.2em] text-slate-300/70">
              {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((label) => (
                <div key={label} className="text-center">
                  {label}
                </div>
              ))}
            </div>
            <div className="grid flex-1 grid-cols-7 gap-1.5">
              {calendarCells.map((cell, index) => {
                const entries = scheduleByDate.get(cell.date) || []
                const entryNames = uniqueNames(entries.map((entry) => entry.professional))
                const isBlocked = blockedDates.has(cell.date)
                const holidayLabels = holidayByDate.get(cell.date) || []
                const displayEntryNames = isBlocked ? [] : entryNames
                const isWithinSelectedMonth = cell.monthOffset === 0
                const matchesSelectedProfessional = selectedProfessional !== ALL_PROFESSIONALS_OPTION && displayEntryNames.includes(selectedProfessional)
                const matchesHighlightMode = highlightMode === 'scheduled'
                  ? isWithinSelectedMonth && !isBlocked && entryNames.length > 0
                  : highlightMode === 'empty'
                    ? isWithinSelectedMonth && (isBlocked || entryNames.length === 0)
                    : false
                const hasTrackedFilter = selectedProfessional !== ALL_PROFESSIONALS_OPTION || highlightMode !== null
                const isTracked = matchesSelectedProfessional || matchesHighlightMode
                const isActiveDate = activeDate === cell.date
                const dimmedByActiveDate = !!activeDate && !isActiveDate
                const dimmedByTrackedFilter = hasTrackedFilter && !isTracked
                const isEmptyDay = isWithinSelectedMonth && !isBlocked && entryNames.length === 0
                const isAdjacentMonth = cell.monthOffset !== 0
                const isPrevMonthShortcut = index === firstCurrentMonthIndex - 1
                const isNextMonthShortcut = cell.monthOffset === 1 && cell.day === 1
                const adjacentPosition = cell.monthOffset === -1
                  ? index + 1
                  : cell.monthOffset === 1
                    ? cell.day
                    : 0
                const adjacentTotal = cell.monthOffset === -1 ? previousMonthCellsCount : nextMonthCellsCount
                const blockReason = dayBlockReasons[cell.date] || closedReasonByDate.get(cell.date) || ''
                const blockBadgeLabel = String(closedReasonByDate.get(cell.date) || blockReason || '').trim() || 'Sem Atendimento'
                const trackedCardStyle = matchesSelectedProfessional
                  ? getProfessionalCardHighlightStyle(selectedProfessional)
                  : matchesHighlightMode && highlightMode === 'scheduled'
                    ? {
                        borderColor: 'rgba(125, 211, 252, 0.68)',
                        background: 'linear-gradient(180deg, rgba(56, 189, 248, 0.13), rgba(15, 23, 42, 0.32))',
                        boxShadow: '0 0 0 1px rgba(125, 211, 252, 0.18), 0 14px 28px rgba(2, 132, 199, 0.16), inset 0 1px 0 rgba(255,255,255,0.05)',
                      } as React.CSSProperties
                    : matchesHighlightMode && highlightMode === 'empty'
                      ? {
                          borderColor: isBlocked ? 'rgba(251, 113, 133, 0.7)' : 'rgba(250, 204, 21, 0.6)',
                          background: isBlocked
                            ? 'linear-gradient(180deg, rgba(244, 63, 94, 0.14), rgba(15, 23, 42, 0.34))'
                            : 'linear-gradient(180deg, rgba(250, 204, 21, 0.1), rgba(15, 23, 42, 0.32))',
                          boxShadow: isBlocked
                            ? '0 0 0 1px rgba(251, 113, 133, 0.18), 0 14px 28px rgba(159, 18, 57, 0.16), inset 0 1px 0 rgba(255,255,255,0.04)'
                            : '0 0 0 1px rgba(250, 204, 21, 0.16), 0 14px 28px rgba(120, 53, 15, 0.14), inset 0 1px 0 rgba(255,255,255,0.04)',
                        } as React.CSSProperties
                      : undefined
                const cardStyle = isAdjacentMonth
                  ? getAdjacentMonthCardStyle(cell.monthOffset === -1 ? 'previous-month' : 'next-month', adjacentPosition, adjacentTotal)
                  : trackedCardStyle
                const handleOpenDate = () => {
                  if (selectedProfessional !== ALL_PROFESSIONALS_OPTION) {
                    setSelectedProfessional(ALL_PROFESSIONALS_OPTION)
                    setHighlightMode(null)
                    return
                  }
                  if (highlightMode) {
                    setHighlightMode(null)
                    return
                  }
                  setActiveDate(cell.date)
                }

                return (
                  <div
                    key={cell.date}
                    role={isAdjacentMonth ? undefined : 'button'}
                    tabIndex={isAdjacentMonth ? undefined : 0}
                    data-testid={`escala-day-${cell.date}`}
                    data-escala-preserve-filter="true"
                    onClick={isAdjacentMonth ? undefined : handleOpenDate}
                    onKeyDown={isAdjacentMonth ? undefined : (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        handleOpenDate()
                      }
                    }}
                    className={cn(
                      'escala-day-card flex h-full min-h-[68px] flex-col gap-1 rounded-xl border border-white/10 bg-white/[0.045] px-2 py-1.5 text-left text-[11px] text-slate-100/90 transition-all',
                      isAdjacentMonth ? 'border-slate-400/8 bg-slate-400/[0.03] text-slate-500/65 saturate-50' : 'hover:border-white/30',
                      isBlocked && 'border-rose-300/45 bg-rose-500/12 text-rose-50/95',
                      isTracked && 'escala-day-card--tracked',
                      isActiveDate && 'escala-day-card--selected border-sky-200/80 bg-sky-300/14 ring-2 ring-sky-300/32',
                      (dimmedByActiveDate || dimmedByTrackedFilter) && 'opacity-45 saturate-75'
                    )}
                    style={cardStyle}
                  >
                    <div className={cn('flex items-start gap-2', isAdjacentMonth && 'min-h-full flex-col items-center justify-center gap-2 text-center')}>
                      <div className={cn(
                        'flex min-w-[1.4rem] items-start gap-1 pt-0.5 text-[13px] font-semibold leading-none text-white/92',
                        isAdjacentMonth && 'min-w-0 justify-center pt-0 text-slate-500/60'
                      )}>
                        <span className={cn(isAdjacentMonth && 'text-slate-400/60')}>{cell.day}</span>
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        {isAdjacentMonth ? (
                          <div className="flex min-h-[30px] w-full items-center justify-center">
                            {isPrevMonthShortcut ? (
                              <button
                                type="button"
                                className="flex size-10 items-center justify-center rounded-full border border-white/14 bg-white/[0.07] text-slate-200/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition hover:border-white/25 hover:bg-white/[0.12] hover:text-white"
                                data-escala-preserve-filter="true"
                                aria-label="Mês anterior"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  shiftSelectedMonth(-1)
                                }}
                              >
                                <ChevronLeft className="size-5" />
                              </button>
                            ) : null}
                            {isNextMonthShortcut ? (
                              <button
                                type="button"
                                className="flex size-10 items-center justify-center rounded-full border border-white/14 bg-white/[0.07] text-slate-200/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition hover:border-white/25 hover:bg-white/[0.12] hover:text-white"
                                data-escala-preserve-filter="true"
                                aria-label="Próximo mês"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  shiftSelectedMonth(1)
                                }}
                              >
                                <ChevronRight className="size-5" />
                              </button>
                            ) : null}
                          </div>
                        ) : !!displayEntryNames.length ? (
                          <div className="flex flex-wrap gap-1">
                          {displayEntryNames.map((name) => {
                            const isActiveSelection = selectedProfessional !== ALL_PROFESSIONALS_OPTION && name === selectedProfessional
                            const isMuted = selectedProfessional !== ALL_PROFESSIONALS_OPTION && name !== selectedProfessional
                            return (
                              <button
                                key={`${cell.date}__${name}`}
                                type="button"
                                data-testid={`escala-pill-${cell.date}-${slugifySegment(name)}`}
                                data-escala-preserve-filter="true"
                                className={cn(
                                  'escala-entry-pill rounded-full border px-1.5 py-0.5 text-[10px] font-semibold transition-all',
                                  isActiveSelection && 'escala-entry-pill--active',
                                  isMuted && 'escala-entry-pill--muted',
                                )}
                                style={getProfessionalBadgeStyle(name, isActiveSelection ? 'active' : (isMuted ? 'muted' : 'default'))}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  focusProfessional(name)
                                }}
                                aria-pressed={isActiveSelection}
                              >
                                {name}
                              </button>
                            )
                          })}
                          </div>
                        ) : null}
                        {!isAdjacentMonth && !displayEntryNames.length && isBlocked ? (
                          <Badge variant="outline" className="max-w-full border-rose-200/35 bg-rose-500/16 px-1.5 py-0.5 text-[10px] text-rose-50">
                            {blockBadgeLabel}
                          </Badge>
                        ) : null}
                        {!isAdjacentMonth && !displayEntryNames.length && !isBlocked && (
                          <div className={cn(
                            'rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-300/80',
                            highlightMode === 'empty' && isEmptyDay && 'border-amber-300/35 bg-amber-400/12 text-amber-50'
                          )}>
                            Sem atendimento
                          </div>
                        )}
                        {!isAdjacentMonth && holidayLabels.length ? (
                          <Badge variant="warning" className="max-w-full px-1.5 py-0.5 text-[10px]">
                            {holidayLabels[0]}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={!!activeDate}
        onOpenChange={(open) => {
          if (open) return
          void closeActiveDateWithSave()
        }}
      >
        <DialogContent className="max-w-sm border-white/10 bg-slate-950/96 text-slate-100" data-escala-preserve-filter="true">
          {activeDate ? (
            <>
              <DialogHeader className="space-y-1">
                <div className="flex items-start justify-between gap-3 pr-8">
                  <div className="flex items-center gap-2">
                    <DialogTitle className="text-base">Injetores do dia</DialogTitle>
                    <DialogDescription className="text-xs text-slate-300/75">
                      {formatDisplayDate(activeDate)}
                    </DialogDescription>
                  </div>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        data-testid={`escala-block-${activeDate}`}
                        className={cn(
                          'escala-card-action rounded-full border p-2 hover:bg-white/[0.12]',
                          blockedDates.has(activeDate)
                            ? 'border-rose-300/40 bg-rose-500/15 text-rose-100'
                            : 'border-white/15 bg-white/[0.06] text-white/85'
                        )}
                        aria-label={`Bloquear data ${activeDate}`}
                      >
                        <Shield className="size-4.5" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="w-72 border-white/15 bg-slate-900/95 text-slate-100"
                      align="end"
                      data-escala-preserve-filter="true"
                    >
                      <div className="space-y-3 text-xs">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-300/70">Bloqueio de data</div>
                          <div className="text-sm text-white">{activeDate}</div>
                        </div>
                        <Input
                          value={dayBlockReasons[activeDate] || closedReasonByDate.get(activeDate) || ''}
                          onChange={(event) => setDayBlockReasons((prev) => ({ ...prev, [activeDate]: event.target.value }))}
                          placeholder="escreva o motivo"
                          className="h-9 bg-white/5"
                          data-testid={`escala-block-reason-${activeDate}`}
                          disabled={blockedDates.has(activeDate) && !closedDateSet.has(activeDate)}
                        />
                        {blockedDates.has(activeDate) && !closedDateSet.has(activeDate) ? (
                          <div className="rounded-lg border border-amber-300/25 bg-amber-500/10 px-3 py-2 text-amber-100/85">
                            Esta data está bloqueada por feriado legado e não pode ser liberada por este atalho.
                          </div>
                        ) : null}
                        <Button
                          variant={closedDateSet.has(activeDate) ? 'outline' : 'premium'}
                          size="sm"
                          className="w-full"
                          data-testid={`escala-toggle-block-${activeDate}`}
                          onClick={() => void handleToggleDayBlock(activeDate)}
                          disabled={dayActionKey === `block:${activeDate}` || (blockedDates.has(activeDate) && !closedDateSet.has(activeDate))}
                        >
                          {closedDateSet.has(activeDate) ? 'Remover bloqueio' : 'Bloquear data'}
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </DialogHeader>

              <div className="grid grid-cols-2 gap-2">
                {assignableProfessionalOptions.length ? assignableProfessionalOptions.map((name) => {
                  const checked = blockedDates.has(activeDate)
                    ? false
                    : getDayDraft(activeDate, scheduleByDate.get(activeDate) || []).includes(name)
                  return (
                    <label
                      key={`${activeDate}-${name}`}
                      className={cn(
                        'flex min-w-0 cursor-pointer items-center gap-2 rounded-xl border px-2 py-1.5 text-xs transition-all',
                        checked ? 'shadow-[0_10px_24px_rgba(15,23,42,0.18)]' : 'bg-white/[0.03]',
                      )}
                      style={getProfessionalBadgeStyle(name, checked ? 'active' : 'default')}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleDayProfessional(activeDate, name, scheduleByDate.get(activeDate) || [])}
                        disabled={blockedDates.has(activeDate)}
                      />
                      <span className="truncate font-medium">{name}</span>
                    </label>
                  )
                }) : (
                  <div className="col-span-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-300/80">
                    Nenhum injetor ativo disponível.
                  </div>
                )}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
