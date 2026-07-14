import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarX2, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/card'
import { LoadingPercentText } from '@/LoadingPattern'
import { EscalaDaySourceBadge, NoAttendanceChip } from '@/escalaComponents'
import {
  EscalaAssignDialog,
  EscalaPlanningAssistantModal,
  EscalaTeamPanel,
} from '@/escalaPanels'
import { useAuth } from '@/contexts'
import { cn } from '@/utils'
import { emitEscalaHeaderState, subscribeEscalaHeaderAction } from '@/escalaHeaderBridge'
import {
  applyPrefillUpdatesToSchedule,
  buildCalendarCells,
  buildMonthPlanMetrics,
  buildPreviousMonthKeys,
  buildScheduleVersion,
  buildWeekdayPrefillAssignments,
  deriveWeekdayDefaultProfessionals,
  resolveDayPlanSource,
} from '@/escalaDomain'
import {
  ALL_PROFESSIONALS_OPTION,
  createEmptyProfessional,
  DEFAULT_MONTH_NUMBER,
  DEFAULT_YEAR,
  formatBrazilPhone,
  formatDelimitedValues,
  formatDisplayDate,
  getAdjacentMonthCardStyle,
  getProfessionalBadgeStyle,
  getProfessionalCardHighlightStyle,
  hexToRgba,
  isActiveInjector,
  isInactiveInjector,
  isVisibleInjector,
  mergeProfessionals,
  MONTH_OPTIONS,
  NEW_TEAM_MEMBER_KEY,
  normalizeHexColor,
  normalizeProfessionalForCompare,
  normalizeText,
  parseDelimitedValues,
  parseUnitsInput,
  resolveVisibleMonth,
  shiftMonthValue,
  slugifySegment,
  uniqueNames,
  unitsMatch,
} from '@/escalaShared'
import { buildSelectedDatesLabel, buildSelectionScopeLabel, filterDatesToMonth, resolveNextActiveDate, toggleDateSelection } from '@/escalaSelection'
import type {
  EscalaActionResult,
  EscalaHeaderAction,
  EscalaHighlightMode,
  EscalaScheduleEntry,
  EscalaProfessional,
  EscalaTeamFormMode,
} from '@/escalaTypes'
import { useEscalaDataController } from '@/useEscalaDataController'
import { useEscalaPrefill } from '@/useEscalaPrefill'
import {
  addClosedDay,
  addEscalaProfessional,
  syncAtendimentoEscala,
  removeScheduleEntry,
  removeClosedDay,
  replaceScheduleEntries,
  updateEscalaProfessional,
  type EscalaAtendimentoImportResult,
} from '@/escalaApi'
export const __testables = {
  mergeProfessionals,
  resolveVisibleMonth,
  buildPreviousMonthKeys,
  deriveWeekdayDefaultProfessionals,
  buildWeekdayPrefillAssignments,
  applyPrefillUpdatesToSchedule,
}

export function EscalaProfissionaisModule() {
  const { user } = useAuth()
  const roleKey = String(user?.role || '').trim().toUpperCase()
  const canAccess = roleKey === 'GESTOR' || roleKey === 'GERENTE'

  const {
    units,
    selectedUnit,
    selectedMonth,
    selectedMonthNumber,
    selectedYear,
    professionals,
    schedule,
    closedDays,
    holidays,
    loadingSchedule,
    error,
    teamLoadError,
    yearOptions,
    setSelectedUnit,
    setSelectedMonthNumber,
    setSelectedYear,
    setSchedule,
    refreshOverview,
    refreshProfessionals,
    refreshSchedule,
    markMonthSelectionTouched,
  } = useEscalaDataController()
  const [selectedProfessional, setSelectedProfessional] = useState<string>(ALL_PROFESSIONALS_OPTION)
  const [dayProfessionalDrafts, setDayProfessionalDrafts] = useState<Record<string, string[]>>({})
  const [dayBlockReasons, setDayBlockReasons] = useState<Record<string, string>>({})
  const [dayActionKey, setDayActionKey] = useState<string | null>(null)
  const [activeDate, setActiveDate] = useState<string | null>(null)
  const [selectedDates, setSelectedDates] = useState<string[]>([])
  const [isDayAssignModalOpen, setIsDayAssignModalOpen] = useState(false)
  const [isBulkSelectionMode, setIsBulkSelectionMode] = useState(false)
  const [isBulkAssignModalOpen, setIsBulkAssignModalOpen] = useState(false)
  const [isPlanningAssistantModalOpen, setIsPlanningAssistantModalOpen] = useState(false)
  const [highlightMode, setHighlightMode] = useState<EscalaHighlightMode | null>(null)
  const [multiDateBlockReason, setMultiDateBlockReason] = useState('')
  const [selectedTeamMember, setSelectedTeamMember] = useState<string>('')
  const [teamMemberDrafts, setTeamMemberDrafts] = useState<Record<string, EscalaProfessional>>({})
  const [savingTeamMember, setSavingTeamMember] = useState(false)
  const [teamFormMode, setTeamFormMode] = useState<EscalaTeamFormMode>('idle')
  const [showInactiveTeamMembers, setShowInactiveTeamMembers] = useState(false)
  const [syncingAtendimento, setSyncingAtendimento] = useState(false)
  const [atendimentoSyncResult, setAtendimentoSyncResult] = useState<EscalaAtendimentoImportResult | null>(null)
  const activeDateRef = useRef<string | null>(null)
  const selectedDatesRef = useRef<string[]>([])
  const dismissedPlanningAssistantRef = useRef(new Set<string>())

  useEffect(() => {
    activeDateRef.current = activeDate
  }, [activeDate])

  useEffect(() => {
    selectedDatesRef.current = selectedDates
  }, [selectedDates])

  const clearInteractiveState = useCallback(() => {
    setSelectedProfessional(ALL_PROFESSIONALS_OPTION)
    setSelectedDates([])
    setActiveDate(null)
    setIsDayAssignModalOpen(false)
    setIsBulkSelectionMode(false)
    setIsBulkAssignModalOpen(false)
    setHighlightMode(null)
    setMultiDateBlockReason('')
  }, [])

  const focusProfessional = useCallback((name: string) => {
    setSelectedDates([])
    setActiveDate(null)
    setMultiDateBlockReason('')
    setSelectedProfessional((prev) => (prev === name ? ALL_PROFESSIONALS_OPTION : name))
  }, [])

  useEffect(() => {
    const activeMonth = selectedYear && selectedMonthNumber ? `${selectedYear}-${selectedMonthNumber}` : ''
    if (!activeMonth) return
    setActiveDate((prev) => (prev && prev.startsWith(`${activeMonth}-`) ? prev : null))
    setSelectedDates((prev) => filterDatesToMonth(prev, activeMonth))
    setIsDayAssignModalOpen(false)
    setIsBulkAssignModalOpen(false)
  }, [selectedMonthNumber, selectedYear])

  useEffect(() => {
    if (!selectedDates.length) {
      if (activeDate) setActiveDate(null)
      return
    }
    if (!activeDate || !selectedDates.includes(activeDate)) {
      setActiveDate(selectedDates[selectedDates.length - 1] || null)
    }
  }, [activeDate, selectedDates])

  const scheduleNames = useMemo(() => new Set(schedule.map((e) => e.professional)), [schedule])
  const mergedProfessionals = useMemo(() => mergeProfessionals(scheduleNames, professionals), [scheduleNames, professionals])

  const professionalsByUnit = useMemo(() => {
    if (!selectedUnit) return mergedProfessionals
    return mergedProfessionals.filter((p) => !p.units.length || p.units.some((unit) => unitsMatch(unit, selectedUnit)))
  }, [mergedProfessionals, selectedUnit])

  const visibleInjectors = useMemo(() => professionalsByUnit.filter(isVisibleInjector), [professionalsByUnit])
  const activeInjectors = useMemo(() => visibleInjectors.filter(isActiveInjector), [visibleInjectors])
  const inactiveInjectors = useMemo(() => visibleInjectors.filter(isInactiveInjector), [visibleInjectors])
  const professionalMap = useMemo(
    () => new Map(mergedProfessionals.map((prof) => [prof.name, prof])),
    [mergedProfessionals],
  )
  const professionalOptions = useMemo(() => uniqueNames(activeInjectors.map((prof) => prof.name)), [activeInjectors])
  const assignableProfessionalOptions = useMemo(
    () => uniqueNames([...professionalOptions, ...schedule.map((entry) => entry.professional)]),
    [professionalOptions, schedule],
  )

  useEffect(() => {
    if (selectedProfessional === ALL_PROFESSIONALS_OPTION) return
    if (!professionalOptions.includes(selectedProfessional)) {
      setSelectedProfessional(ALL_PROFESSIONALS_OPTION)
    }
  }, [professionalOptions, selectedProfessional])

  useEffect(() => {
    setDayProfessionalDrafts({})
  }, [selectedMonth, selectedUnit, selectedProfessional])

  useEffect(() => {
    setTeamMemberDrafts({})
    setTeamFormMode('idle')
    setShowInactiveTeamMembers(false)
  }, [selectedUnit])

  const scheduleForMonth = schedule
  const closedDaysForMonth = closedDays
  const holidaysForMonth = holidays

  useEffect(() => {
    setSelectedTeamMember((prev) => (prev && visibleInjectors.some((prof) => prof.name === prev) ? prev : ''))
  }, [visibleInjectors])

  useEffect(() => {
    if (selectedTeamMember && inactiveInjectors.some((prof) => prof.name === selectedTeamMember)) {
      setShowInactiveTeamMembers(true)
    }
  }, [inactiveInjectors, selectedTeamMember])

  const selectedTeamMemberBase = useMemo(
    () => ((teamFormMode === 'edit' || teamFormMode === 'idle') ? (visibleInjectors.find((prof) => prof.name === selectedTeamMember) || null) : null),
    [visibleInjectors, selectedTeamMember, teamFormMode],
  )

  const selectedTeamMemberDraft = useMemo(() => {
    if (teamFormMode === 'add') {
      return teamMemberDrafts[NEW_TEAM_MEMBER_KEY] || createEmptyProfessional(selectedUnit)
    }
    if (teamFormMode === 'idle') return null
    if (!selectedTeamMemberBase) return null
    return teamMemberDrafts[selectedTeamMemberBase.name] || { ...selectedTeamMemberBase, units: [...selectedTeamMemberBase.units] }
  }, [selectedTeamMemberBase, selectedUnit, teamFormMode, teamMemberDrafts])

  const selectedTeamMemberDirty = useMemo(() => {
    if (teamFormMode === 'idle') return false
    if (teamFormMode === 'add') {
      if (!selectedTeamMemberDraft) return false
      const normalizedDraft = normalizeProfessionalForCompare(selectedTeamMemberDraft)
      if (!normalizedDraft) return false
      return Boolean(
        normalizedDraft.name ||
        normalizedDraft.status ||
        normalizedDraft.units.length ||
        normalizedDraft.role ||
        normalizedDraft.shift ||
        normalizedDraft.nickname ||
        normalizedDraft.phone ||
        normalizedDraft.email ||
        normalizedDraft.instagram ||
        normalizedDraft.color
      )
    }
    const base = normalizeProfessionalForCompare(selectedTeamMemberBase)
    const draft = normalizeProfessionalForCompare(selectedTeamMemberDraft)
    if (!base || !draft) return false
    return JSON.stringify(base) !== JSON.stringify(draft)
  }, [selectedTeamMemberBase, selectedTeamMemberDraft, teamFormMode])

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

  const closedBlockedDates = useMemo(
    () => new Set<string>(closedDaysForMonth.map((entry) => entry.date)),
    [closedDaysForMonth],
  )
  const closedReasonByDate = useMemo(() => {
    const map = new Map<string, string>()
    closedDaysForMonth.forEach((entry) => {
      map.set(entry.date, entry.reason || 'Sem atendimento')
    })
    return map
  }, [closedDaysForMonth])
  const closedDateSet = useMemo(() => new Set(closedDaysForMonth.map((entry) => entry.date)), [closedDaysForMonth])
  const calendarCells = useMemo(() => (selectedMonth ? buildCalendarCells(selectedMonth) : []), [selectedMonth])
  const scheduleVersion = useMemo(
    () => (selectedMonth ? buildScheduleVersion(scheduleForMonth, closedDaysForMonth, selectedMonth) : ''),
    [closedDaysForMonth, scheduleForMonth, selectedMonth],
  )
  const totalScheduledDays = useMemo(() => {
    return new Set(scheduleForMonth.map((entry) => entry.date)).size
  }, [scheduleForMonth])
  const planningAssistantEnabled = Boolean(selectedUnit && selectedMonth && totalScheduledDays === 0)
  const {
    prefillState: autoPrefillState,
    activeSuggestionMap,
    appliedSuggestionMap,
    applySuggestions,
    ignoreSuggestions,
    retryAnalysis,
  } = useEscalaPrefill({
    enabled: planningAssistantEnabled,
    selectedUnit,
    selectedMonth,
    loadingSchedule,
    calendarCells,
    schedule: scheduleForMonth,
    closedDays: closedDaysForMonth,
    scheduleVersion,
    onScheduleApplied: setSchedule,
  })
  const planningAssistantSessionKey = useMemo(
    () => (selectedUnit && selectedMonth ? `${selectedUnit}__${selectedMonth}__${scheduleVersion}` : ''),
    [scheduleVersion, selectedMonth, selectedUnit],
  )

  useEffect(() => {
    if (selectedDates.length <= 1) {
      setMultiDateBlockReason('')
      return
    }
    const firstDate = selectedDates[0]
    if (!firstDate) {
      setMultiDateBlockReason('')
      return
    }
    const nextReason = String(dayBlockReasons[firstDate] || closedReasonByDate.get(firstDate) || '').trim()
    setMultiDateBlockReason(nextReason)
  }, [closedReasonByDate, dayBlockReasons, selectedDates])

  const selectedDateSet = useMemo(() => new Set(selectedDates), [selectedDates])
  const selectedDatesLabel = useMemo(
    () => buildSelectedDatesLabel(selectedDates, formatDisplayDate),
    [selectedDates],
  )

  const monthPlanMetrics = useMemo(
    () => buildMonthPlanMetrics(calendarCells, scheduleByDate, closedBlockedDates, appliedSuggestionMap),
    [appliedSuggestionMap, calendarCells, closedBlockedDates, scheduleByDate],
  )
  const autoPrefillProgress = useMemo(() => {
    if (autoPrefillState.status === 'analyzing') return 18
    if (autoPrefillState.status === 'ready') return 42
    if (autoPrefillState.status === 'applying') return 74
    if (autoPrefillState.status === 'done') return 100
    if (autoPrefillState.status === 'ignored') return 100
    return 0
  }, [autoPrefillState.status])
  const unavailableDaysCount = useMemo(() => {
    return calendarCells.reduce((total, cell) => {
      if (cell.monthOffset !== 0) return total
      const hasEntries = (scheduleByDate.get(cell.date) || []).length > 0
      const isBlocked = closedBlockedDates.has(cell.date)
      return !hasEntries && !isBlocked ? total + 1 : total
    }, closedBlockedDates.size)
  }, [calendarCells, closedBlockedDates, scheduleByDate])
  const firstCurrentMonthIndex = useMemo(() => calendarCells.findIndex((cell) => cell.monthOffset === 0), [calendarCells])
  const previousMonthCellsCount = useMemo(() => calendarCells.filter((cell) => cell.monthOffset === -1).length, [calendarCells])
  const nextMonthCellsCount = useMemo(() => calendarCells.filter((cell) => cell.monthOffset === 1).length, [calendarCells])
  const selectionScopeLabel = useMemo(
    () => buildSelectionScopeLabel(selectedDatesLabel, selectedDates.length),
    [selectedDates.length, selectedDatesLabel],
  )
  const planningAssistantTitle = useMemo(() => {
    if (autoPrefillState.status === 'analyzing') return 'Analisando histórico'
    if (autoPrefillState.status === 'ready') return 'Sugestões prontas para aplicar'
    if (autoPrefillState.status === 'applying') return 'Aplicando sugestões'
    if (autoPrefillState.status === 'done') return 'Sugestões concluídas'
    if (autoPrefillState.status === 'ignored') return 'Sugestões ignoradas neste mês'
    if (autoPrefillState.status === 'error') return 'Falha ao analisar sugestões'
    return 'Assistente de planejamento'
  }, [autoPrefillState.status])
  const planningAssistantProgressLabel = useMemo(() => {
    if (autoPrefillState.status === 'ready') return `${autoPrefillState.total || 0} prontas`
    if ((autoPrefillState.status === 'done' || autoPrefillState.status === 'ignored') && !autoPrefillState.total) return 'Sem sugestões'
    if (autoPrefillState.status === 'error') return 'Ação necessária'
    return `${autoPrefillState.completed}/${autoPrefillState.total || 0}`
  }, [autoPrefillState.completed, autoPrefillState.status, autoPrefillState.total])

  useEffect(() => {
    if (!planningAssistantEnabled || !planningAssistantSessionKey || loadingSchedule || autoPrefillState.status === 'idle') {
      setIsPlanningAssistantModalOpen(false)
      return
    }
    if (dismissedPlanningAssistantRef.current.has(planningAssistantSessionKey)) return
    setIsPlanningAssistantModalOpen(true)
  }, [
    autoPrefillState.status,
    loadingSchedule,
    planningAssistantEnabled,
    planningAssistantSessionKey,
  ])

  const handlePlanningAssistantOpenChange = useCallback((open: boolean) => {
    setIsPlanningAssistantModalOpen(open)
    if (!open && planningAssistantSessionKey) {
      dismissedPlanningAssistantRef.current.add(planningAssistantSessionKey)
    }
  }, [planningAssistantSessionKey])

  useEffect(() => {
    emitEscalaHeaderState({
      units,
      monthOptions: MONTH_OPTIONS,
      yearOptions,
      selectedUnit,
      selectedMonthNumber,
      selectedYear,
      totalScheduledDays,
      unavailableDaysCount,
      manualDays: monthPlanMetrics.manual,
      autoDays: monthPlanMetrics.auto,
      blockedDays: monthPlanMetrics.blocked,
      emptyDays: monthPlanMetrics.empty,
      coveredDays: monthPlanMetrics.covered,
      highlightMode,
    })
  }, [
    selectedMonthNumber,
    selectedUnit,
    selectedYear,
    totalScheduledDays,
    unavailableDaysCount,
    monthPlanMetrics,
    units,
    yearOptions,
    highlightMode,
  ])

  useEffect(() => () => emitEscalaHeaderState(null), [])

  useEffect(() => {
    return subscribeEscalaHeaderAction((action: EscalaHeaderAction) => {
      if (action.type === 'set-unit') {
        setSelectedUnit(action.value)
        return
      }
      if (action.type === 'set-month') {
        markMonthSelectionTouched()
        setSelectedMonthNumber(action.value)
        return
      }
      if (action.type === 'set-year') {
        markMonthSelectionTouched()
        setSelectedYear(action.value)
        return
      }
      if (action.type === 'toggle-highlight') {
        setHighlightMode((prev) => (prev === action.value ? null : action.value))
        return
      }
      clearInteractiveState()
    })
  }, [clearInteractiveState, markMonthSelectionTouched, setSelectedMonthNumber, setSelectedUnit, setSelectedYear])

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

  const getDatesSelectionState = useCallback((dates: string[], name: string) => {
    if (!dates.length) return false as boolean | 'indeterminate'
    const checkedCount = dates.reduce((total, date) => {
      const entries = scheduleByDate.get(date) || []
      return getDayDraft(date, entries).includes(name) ? total + 1 : total
    }, 0)
    if (checkedCount === 0) return false
    if (checkedCount === dates.length) return true
    return 'indeterminate'
  }, [getDayDraft, scheduleByDate])

  const toggleDayProfessional = useCallback((date: string, name: string, entries: EscalaScheduleEntry[]) => {
    setDayProfessionalDrafts((prev) => {
      const base = prev[date] || uniqueNames(entries.map((entry) => entry.professional))
      const next = base.includes(name)
        ? base.filter((item) => item !== name)
        : [...base, name]
      return { ...prev, [date]: uniqueNames(next) }
    })
  }, [])

  const toggleSelectedDatesProfessional = useCallback((name: string) => {
    const dates = selectedDatesRef.current.filter((date) => !closedBlockedDates.has(date))
    if (!dates.length) return
    setDayProfessionalDrafts((prev) => {
      const next = { ...prev }
      const allChecked = dates.every((date) => {
        const entries = scheduleByDate.get(date) || []
        const base = prev[date] || uniqueNames(entries.map((entry) => entry.professional))
        return base.includes(name)
      })
      dates.forEach((date) => {
        const entries = scheduleByDate.get(date) || []
        const base = prev[date] || uniqueNames(entries.map((entry) => entry.professional))
        next[date] = allChecked
          ? base.filter((item) => item !== name)
          : uniqueNames([...base, name])
      })
      return next
    })
  }, [closedBlockedDates, scheduleByDate])

  const handleApplyDayProfessionals = useCallback(async (dates: string[]): Promise<EscalaActionResult> => {
    if (!selectedUnit) {
      toast.error('Selecione uma unidade antes de alterar a agenda.')
      return { ok: false, changed: false }
    }

    const targetDates = uniqueNames(dates).filter((date) => !closedBlockedDates.has(date))
    if (!targetDates.length) return { ok: true, changed: false }

    setDayActionKey(targetDates.length === 1 ? `assign:${targetDates[0]}` : 'assign:multi')
    const changedDates: string[] = []
    for (const date of targetDates) {
      const entries = scheduleByDate.get(date) || []
      const nextNames = uniqueNames(getDayDraft(date, entries))
      const currentNames = uniqueNames(entries.map((entry) => entry.professional))
      const unchanged = nextNames.length === currentNames.length && nextNames.every((name) => currentNames.includes(name))
      if (unchanged) continue

      const res = nextNames.length
        ? await replaceScheduleEntries({ date, unit: selectedUnit, professionals: nextNames })
        : await removeScheduleEntry({ date, unit: selectedUnit })
      if (!res.ok) {
        setDayActionKey(null)
        toast.error(res.error || `Falha ao atualizar a agenda de ${formatDisplayDate(date)}.`)
        return { ok: false, changed: false }
      }
      changedDates.push(date)
    }
    setDayActionKey(null)

    if (changedDates.length) {
      toast.success(
        changedDates.length === 1
          ? 'Agenda do dia atualizada.'
          : `Agenda atualizada em ${changedDates.length} datas.`
      )
    }
    setDayProfessionalDrafts((prev) => {
      const next = { ...prev }
      changedDates.forEach((date) => {
        delete next[date]
      })
      return next
    })
    await refreshSchedule()
    await refreshOverview()
    return { ok: true, changed: changedDates.length > 0 }
  }, [closedBlockedDates, getDayDraft, refreshOverview, refreshSchedule, scheduleByDate, selectedUnit])

  const closeActiveDateWithSave = useCallback(async () => {
    const dates = uniqueNames(selectedDatesRef.current)
    if (!dates.length) {
      setIsDayAssignModalOpen(false)
      setSelectedDates([])
      setActiveDate(null)
      setMultiDateBlockReason('')
      setIsBulkAssignModalOpen(false)
      return
    }

    const result = await handleApplyDayProfessionals(dates)
    if (!result.ok) return

    if (isBulkSelectionMode) {
      setIsBulkAssignModalOpen(false)
      if (result.changed) {
        setIsBulkSelectionMode(false)
        setIsDayAssignModalOpen(false)
        setSelectedDates([])
        setActiveDate(null)
        setMultiDateBlockReason('')
      }
      return
    }

    setIsDayAssignModalOpen(false)
    setSelectedDates([])
    setActiveDate(null)
    setMultiDateBlockReason('')
    setIsBulkAssignModalOpen(false)
  }, [handleApplyDayProfessionals, isBulkSelectionMode])

  const closeAssignModalWithoutSave = useCallback(() => {
    const dates = uniqueNames(selectedDatesRef.current)
    setDayProfessionalDrafts((prev) => {
      if (!dates.length) return prev
      const next = { ...prev }
      dates.forEach((date) => {
        delete next[date]
      })
      return next
    })

    if (isBulkSelectionMode) {
      setIsBulkAssignModalOpen(false)
      return
    }

    setIsDayAssignModalOpen(false)
    setSelectedDates([])
    setActiveDate(null)
    setMultiDateBlockReason('')
  }, [isBulkSelectionMode])

  useEffect(() => {
    if (!isDayAssignModalOpen && !isBulkAssignModalOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeAssignModalWithoutSave()
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [closeAssignModalWithoutSave, isBulkAssignModalOpen, isDayAssignModalOpen])

  const enableBulkSelectionMode = useCallback(() => {
    setIsBulkSelectionMode(true)
    setIsBulkAssignModalOpen(false)
    setSelectedProfessional(ALL_PROFESSIONALS_OPTION)
    setHighlightMode(null)
    setSelectedDates([])
    setActiveDate(null)
    setMultiDateBlockReason('')
  }, [])

  const confirmBulkSelectionMode = useCallback(() => {
    const dates = uniqueNames(selectedDatesRef.current).sort()
    if (!dates.length) {
      toast.error('Selecione pelo menos uma data para continuar.')
      return
    }
    setSelectedDates(dates)
    setActiveDate(dates[dates.length - 1] || null)
    setIsBulkAssignModalOpen(true)
  }, [])

  const cancelBulkSelectionMode = useCallback(() => {
    setIsBulkSelectionMode(false)
    setIsBulkAssignModalOpen(false)
    setSelectedDates([])
    setActiveDate(null)
    setMultiDateBlockReason('')
  }, [])

  useEffect(() => {
    if (!isBulkSelectionMode) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (!target) return
      if (target.closest('[data-escala-bulk-preserve="true"]')) return
      event.preventDefault()
      event.stopPropagation()
      cancelBulkSelectionMode()
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [cancelBulkSelectionMode, isBulkSelectionMode])

  useEffect(() => {
    const hasInteractiveSelection = isBulkSelectionMode || selectedProfessional !== ALL_PROFESSIONALS_OPTION || highlightMode !== null
    if (!hasInteractiveSelection) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (isDayAssignModalOpen || isBulkAssignModalOpen || isPlanningAssistantModalOpen) return
      event.preventDefault()
      if (isBulkSelectionMode) {
        cancelBulkSelectionMode()
        return
      }
      clearInteractiveState()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [
    cancelBulkSelectionMode,
    clearInteractiveState,
    highlightMode,
    isBulkAssignModalOpen,
    isBulkSelectionMode,
    isDayAssignModalOpen,
    isPlanningAssistantModalOpen,
    selectedProfessional,
  ])

  const shiftSelectedMonth = useCallback((offset: number) => {
    markMonthSelectionTouched()
    const next = shiftMonthValue(selectedMonth, offset)
    setSelectedYear(next.year)
    setSelectedMonthNumber(next.monthNumber)
  }, [markMonthSelectionTouched, selectedMonth, setSelectedMonthNumber, setSelectedYear])

  const handleToggleDayBlock = useCallback(async (date: string): Promise<EscalaActionResult> => {
    if (!selectedUnit) {
      toast.error('Selecione uma unidade antes de bloquear uma data.')
      return { ok: false, changed: false, error: 'Selecione uma unidade antes de bloquear uma data.' }
    }

    const isDirectlyBlocked = closedDateSet.has(date)
    setDayActionKey(`block:${date}`)

    if (isDirectlyBlocked) {
      const res = await removeClosedDay({ date, unit: selectedUnit })
      setDayActionKey(null)
      if (!res.ok) {
        toast.error(res.error || 'Falha ao remover bloqueio do dia.')
        return { ok: false, changed: false, error: res.error || 'Falha ao remover bloqueio do dia.' }
      }
      toast.success('Bloqueio removido.')
      setDayBlockReasons((prev) => {
        const next = { ...prev }
        delete next[date]
        return next
      })
      setSelectedDates([])
      setActiveDate(null)
      setMultiDateBlockReason('')
      if (isBulkSelectionMode) setIsBulkSelectionMode(false)
      setIsBulkAssignModalOpen(false)
      await refreshSchedule()
      await refreshOverview()
      return { ok: true, changed: true }
    }

    const reason = String(dayBlockReasons[date] || closedReasonByDate.get(date) || '').trim()
    const clearDayRes = await removeScheduleEntry({ date, unit: selectedUnit })
    if (!clearDayRes.ok) {
      setDayActionKey(null)
      toast.error(clearDayRes.error || 'Falha ao limpar a agenda antes do bloqueio.')
      return { ok: false, changed: false, error: clearDayRes.error || 'Falha ao limpar a agenda antes do bloqueio.' }
    }

    const res = await addClosedDay({ date, unit: selectedUnit, reason: reason || undefined })
    setDayActionKey(null)
    if (!res.ok) {
      toast.error(res.error || 'Falha ao bloquear o dia.')
      return { ok: false, changed: false, error: res.error || 'Falha ao bloquear o dia.' }
    }
    toast.success('Data bloqueada.')
    setDayProfessionalDrafts((prev) => {
      const next = { ...prev }
      delete next[date]
      return next
    })
    setSelectedDates([])
    setActiveDate(null)
    setMultiDateBlockReason('')
    if (isBulkSelectionMode) setIsBulkSelectionMode(false)
    setIsBulkAssignModalOpen(false)
    await refreshSchedule()
    await refreshOverview()
    return { ok: true, changed: true }
  }, [closedDateSet, closedReasonByDate, dayBlockReasons, isBulkSelectionMode, refreshOverview, refreshSchedule, selectedUnit])

  const handleToggleSelectedDatesBlock = useCallback(async (): Promise<EscalaActionResult> => {
    if (!selectedUnit) {
      toast.error('Selecione uma unidade antes de bloquear datas.')
      return { ok: false, changed: false, error: 'Selecione uma unidade antes de bloquear datas.' }
    }

    const dates = uniqueNames(selectedDatesRef.current)
    if (!dates.length) return { ok: true, changed: false }
    if (dates.length === 1) {
      return handleToggleDayBlock(dates[0])
    }

    const allDirectlyBlocked = dates.every((date) => closedDateSet.has(date))
    setDayActionKey(dates.length === 1 ? `block:${dates[0]}` : 'block:multi')

    if (allDirectlyBlocked) {
      for (const date of dates) {
        const res = await removeClosedDay({ date, unit: selectedUnit })
        if (!res.ok) {
          setDayActionKey(null)
          toast.error(res.error || `Falha ao remover bloqueio de ${formatDisplayDate(date)}.`)
          return { ok: false, changed: false, error: res.error || `Falha ao remover bloqueio de ${formatDisplayDate(date)}.` }
        }
      }
      setDayActionKey(null)
      toast.success(dates.length === 1 ? 'Bloqueio removido.' : `Bloqueio removido de ${dates.length} datas.`)
      setDayBlockReasons((prev) => {
        const next = { ...prev }
        dates.forEach((date) => {
          delete next[date]
        })
        return next
      })
      setSelectedDates([])
      setActiveDate(null)
      setMultiDateBlockReason('')
      if (isBulkSelectionMode) setIsBulkSelectionMode(false)
      setIsBulkAssignModalOpen(false)
      await refreshSchedule()
      await refreshOverview()
      return { ok: true, changed: true }
    }

    for (const date of dates) {
      if (closedDateSet.has(date)) continue
      const clearDayRes = await removeScheduleEntry({ date, unit: selectedUnit })
      if (!clearDayRes.ok) {
        setDayActionKey(null)
        toast.error(clearDayRes.error || `Falha ao limpar a agenda de ${formatDisplayDate(date)} antes do bloqueio.`)
        return { ok: false, changed: false, error: clearDayRes.error || `Falha ao limpar a agenda de ${formatDisplayDate(date)} antes do bloqueio.` }
      }
      const reason = String(
        (dates.length > 1 ? multiDateBlockReason : dayBlockReasons[date]) ||
        closedReasonByDate.get(date) ||
        ''
      ).trim()
      const res = await addClosedDay({ date, unit: selectedUnit, reason: reason || undefined })
      if (!res.ok) {
        setDayActionKey(null)
        toast.error(res.error || `Falha ao bloquear ${formatDisplayDate(date)}.`)
        return { ok: false, changed: false, error: res.error || `Falha ao bloquear ${formatDisplayDate(date)}.` }
      }
    }

    setDayActionKey(null)
    toast.success(dates.length === 1 ? 'Data bloqueada.' : `${dates.length} datas bloqueadas.`)
    setDayProfessionalDrafts((prev) => {
      const next = { ...prev }
      dates.forEach((date) => {
        delete next[date]
      })
      return next
    })
    setSelectedDates([])
    setActiveDate(null)
    setMultiDateBlockReason('')
    if (isBulkSelectionMode) setIsBulkSelectionMode(false)
    setIsBulkAssignModalOpen(false)
    await refreshSchedule()
    await refreshOverview()
    return { ok: true, changed: true }
  }, [closedDateSet, closedReasonByDate, dayBlockReasons, handleToggleDayBlock, isBulkSelectionMode, multiDateBlockReason, refreshOverview, refreshSchedule, selectedUnit])

  const updateSelectedTeamMemberField = useCallback((field: keyof EscalaProfessional, value: string) => {
    const draftKey = teamFormMode === 'add' ? NEW_TEAM_MEMBER_KEY : selectedTeamMemberBase?.name
    if (!draftKey) return
    setTeamMemberDrafts((prev) => {
      const fallback = teamFormMode === 'add'
        ? createEmptyProfessional(selectedUnit)
        : (selectedTeamMemberBase ? { ...selectedTeamMemberBase, units: [...selectedTeamMemberBase.units] } : null)
      if (!fallback) return prev
      const current = prev[draftKey] || fallback
      return {
        ...prev,
        [draftKey]: {
          ...current,
          [field]: field === 'units'
            ? parseUnitsInput(value)
            : field === 'phone'
              ? formatBrazilPhone(value)
              : field === 'color'
                ? normalizeHexColor(value)
                : value
        }
      }
    })
  }, [selectedTeamMemberBase, selectedUnit, teamFormMode])

  const toggleSelectedTeamMemberOption = useCallback((field: 'units' | 'role', option: string) => {
    const draft = selectedTeamMemberDraft
    if (!draft) return
    if (field === 'units') {
      const next = draft.units.includes(option)
        ? draft.units.filter((item) => item !== option)
        : [...draft.units, option]
      updateSelectedTeamMemberField('units', formatDelimitedValues(next))
      return
    }
    const currentValues = parseDelimitedValues(draft[field])
    const nextValues = currentValues.includes(option)
      ? currentValues.filter((item) => item !== option)
      : [...currentValues, option]
    updateSelectedTeamMemberField(field, formatDelimitedValues(nextValues))
  }, [selectedTeamMemberDraft, updateSelectedTeamMemberField])

  const beginAddTeamMember = useCallback(() => {
    setTeamFormMode('add')
    setSelectedProfessional(ALL_PROFESSIONALS_OPTION)
    setSelectedDates([])
    setActiveDate(null)
    setHighlightMode(null)
    setTeamMemberDrafts((prev) => ({
      ...prev,
      [NEW_TEAM_MEMBER_KEY]: createEmptyProfessional(selectedUnit),
    }))
  }, [selectedUnit])

  const selectTeamMember = useCallback((name: string) => {
    const isSameSelection = selectedTeamMember === name && teamFormMode === 'idle'
    if (isSameSelection) {
      setSelectedTeamMember('')
      setSelectedProfessional(ALL_PROFESSIONALS_OPTION)
      setSelectedDates([])
      setActiveDate(null)
      setHighlightMode(null)
      return
    }
    if (inactiveInjectors.some((prof) => prof.name === name)) {
      setShowInactiveTeamMembers(true)
    }
    setSelectedTeamMember(name)
    setTeamFormMode('idle')
    setSelectedProfessional(name)
    setSelectedDates([])
    setActiveDate(null)
    setHighlightMode(null)
  }, [inactiveInjectors, selectedTeamMember, teamFormMode])

  const beginEditTeamMember = useCallback((name?: string) => {
    if (name) setSelectedTeamMember(name)
    setTeamFormMode('edit')
    setTeamMemberDrafts((prev) => {
      const next = { ...prev }
      delete next[NEW_TEAM_MEMBER_KEY]
      return next
    })
  }, [])

  const closeTeamPanel = useCallback(() => {
    setTeamFormMode('idle')
    setTeamMemberDrafts((prev) => {
      if (!(NEW_TEAM_MEMBER_KEY in prev)) return prev
      const next = { ...prev }
      delete next[NEW_TEAM_MEMBER_KEY]
      return next
    })
  }, [])

  const handleSaveTeamMember = useCallback(async () => {
    if (!selectedTeamMemberDraft || !selectedTeamMemberDirty) return

    setSavingTeamMember(true)
    const normalizedDraft = normalizeProfessionalForCompare(selectedTeamMemberDraft)
    if (!normalizedDraft?.name) {
      setSavingTeamMember(false)
      toast.error('Informe o nome do injetor.')
      return
    }
    const payload = {
      name: normalizedDraft.name,
      status: normalizedDraft.status || 'Ativo',
      units: normalizedDraft.units || [],
      role: normalizedDraft.role || '',
      shift: normalizedDraft.shift || '',
      nickname: normalizedDraft.nickname || '',
      phone: normalizedDraft.phone || '',
      email: normalizedDraft.email || '',
      instagram: normalizedDraft.instagram || '',
      color: normalizedDraft.color || '',
    }
    const res = teamFormMode === 'add'
      ? await addEscalaProfessional(payload)
      : await updateEscalaProfessional({
        currentName: selectedTeamMemberBase?.name || '',
        ...payload,
      })
    setSavingTeamMember(false)

    if (!res.ok) {
      toast.error(res.error || 'Falha ao salvar o cadastro do injetor.')
      return
    }

    const nextName = normalizedDraft.name
    toast.success(teamFormMode === 'add' ? 'Injetor adicionado.' : 'Cadastro do injetor atualizado.')
    setTeamMemberDrafts((prev) => {
      const next = { ...prev }
      if (selectedTeamMemberBase?.name) delete next[selectedTeamMemberBase.name]
      delete next[NEW_TEAM_MEMBER_KEY]
      return next
    })
    setSelectedTeamMember(nextName)
    setSelectedProfessional((prev) => (selectedTeamMemberBase?.name && prev === selectedTeamMemberBase.name ? nextName : prev))
    setTeamFormMode('idle')
    await refreshProfessionals(selectedUnit)
    await refreshSchedule(selectedUnit, selectedMonth)
    await refreshOverview()
  }, [
    refreshOverview,
    refreshProfessionals,
    refreshSchedule,
    selectedMonth,
    selectedTeamMemberBase,
    selectedTeamMemberDirty,
    selectedTeamMemberDraft,
    selectedUnit,
    teamFormMode,
  ])

  const atendimentoPendingCount = useMemo(() => {
    const summary = atendimentoSyncResult?.summary
    if (!summary) return 0
    return Number(summary.professionals?.toInsert || 0)
      + Number(summary.professionals?.toUpdate || 0)
      + Number(summary.schedule?.toInsert || 0)
      + Number(summary.closedDays?.toInsert || 0)
      + Number(summary.holidays?.toInsert || 0)
  }, [atendimentoSyncResult])

  const atendimentoConflictCount = useMemo(() => {
    const summary = atendimentoSyncResult?.summary
    if (!summary) return 0
    return Number(summary.schedule?.conflicts || 0) + Number(summary.closedDays?.conflicts || 0)
  }, [atendimentoSyncResult])

  const handleSyncAtendimento = useCallback(async (commit = false) => {
    setSyncingAtendimento(true)
    const result = await syncAtendimentoEscala({ commit })
    setSyncingAtendimento(false)
    if (!result.ok) {
      toast.error(result.error || 'Falha ao sincronizar a escala importada.')
      return
    }
    setAtendimentoSyncResult(result)
    const summary = result.summary || {}
    const pending = Number(summary.professionals?.toInsert || 0)
      + Number(summary.professionals?.toUpdate || 0)
      + Number(summary.schedule?.toInsert || 0)
      + Number(summary.closedDays?.toInsert || 0)
      + Number(summary.holidays?.toInsert || 0)
    if (commit) {
      toast.success(`Escala sincronizada: ${pending} item(ns) aplicados.`)
      await refreshProfessionals(selectedUnit)
      await refreshSchedule(selectedUnit, selectedMonth)
      await refreshOverview()
    } else {
      toast.success(pending ? `Dry-run concluído: ${pending} item(ns) faltantes.` : 'Dry-run concluído: Escala já está sincronizada.')
    }
  }, [refreshOverview, refreshProfessionals, refreshSchedule, selectedMonth, selectedUnit])

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
    <div className="escala-surface flex min-h-full flex-col gap-4 px-4 pb-6 pt-2">
      {error ? (
        <div className="rounded-xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-100/80">
          {error}
        </div>
      ) : null}

      <div className="flex-1">
        <Card className="glass-card flex flex-col">
          <CardContent className="flex flex-col gap-2 pt-3">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_344px]">
              <div className="flex flex-col gap-2" data-testid="escala-calendar-panel" data-escala-bulk-preserve="true">
                <div className="flex flex-wrap items-start justify-end gap-2 pb-1">
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-50/90 transition hover:border-emerald-200/40 hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-55"
                    disabled={syncingAtendimento}
                    onClick={() => void handleSyncAtendimento(false)}
                    title="Conferir profissionais, escala e dias sem atendimento vindos de Atendimento/Gerência antes de gravar."
                  >
                    <Sparkles className="size-4" />
                    {syncingAtendimento ? 'Conferindo...' : 'Conferir Atendimento'}
                  </button>
                  {atendimentoPendingCount > 0 ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 rounded-full border border-sky-300/20 bg-sky-400/10 px-3 py-2 text-xs font-semibold text-sky-50/90 transition hover:border-sky-200/40 hover:bg-sky-400/15 disabled:cursor-not-allowed disabled:opacity-55"
                      disabled={syncingAtendimento}
                      onClick={() => void handleSyncAtendimento(true)}
                      title="Aplicar apenas os dados faltantes sem sobrescrever ajustes manuais da Escala."
                    >
                      Aplicar {atendimentoPendingCount}
                    </button>
                  ) : null}
                  {loadingSchedule ? (
                    <div className="text-[11px] text-slate-300/75">
                      <LoadingPercentText label="Atualizando agenda" showPercent={false} />
                    </div>
                  ) : null}
                </div>
                {atendimentoSyncResult ? (
                  <div className="grid gap-2 rounded-2xl border border-white/10 bg-slate-950/35 px-3 py-2 text-[11px] text-slate-200/80 md:grid-cols-4">
                    <span>
                      Profissionais: {atendimentoSyncResult.summary?.professionals?.toInsert || 0} novos, {atendimentoSyncResult.summary?.professionals?.toUpdate || 0} atualizações
                    </span>
                    <span>Agenda: {atendimentoSyncResult.summary?.schedule?.toInsert || 0} faltantes</span>
                    <span>Sem atendimento: {atendimentoSyncResult.summary?.closedDays?.toInsert || 0} faltantes</span>
                    <span className={cn(atendimentoConflictCount ? 'text-amber-200' : 'text-emerald-200')}>
                      Conflitos preservados: {atendimentoConflictCount}
                    </span>
                  </div>
                ) : null}
                {selectedDates.length ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-sky-300/16 bg-sky-400/8 px-3 py-2 text-[11px] text-sky-100/80">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-sky-100/60">
                      Seleção ativa
                    </span>
                    <span>{selectionScopeLabel}</span>
                  </div>
                ) : null}
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
                    const isBlocked = closedBlockedDates.has(cell.date)
                    const appliedSuggestion = appliedSuggestionMap.get(cell.date) || null
                    const holidayLabels = holidayByDate.get(cell.date) || []
                    const displayEntryNames = isBlocked ? [] : entryNames
                    const isWithinSelectedMonth = cell.monthOffset === 0
                    const daySource = resolveDayPlanSource({
                      date: cell.date,
                      entryNames,
                      blocked: isBlocked,
                      autoSuggestion: appliedSuggestion,
                    })
                    const matchesSelectedProfessional = selectedProfessional !== ALL_PROFESSIONALS_OPTION && displayEntryNames.includes(selectedProfessional)
                    const matchesHighlightMode = highlightMode
                      ? isWithinSelectedMonth && daySource === highlightMode
                      : false
                    const hasTrackedFilter = selectedProfessional !== ALL_PROFESSIONALS_OPTION || highlightMode !== null
                    const isTracked = matchesSelectedProfessional || matchesHighlightMode
                    const isSelectedDate = selectedDateSet.has(cell.date)
                    const isPrimarySelectedDate = activeDate === cell.date
                    const dimmedByActiveDate = selectedDates.length > 0 && !isSelectedDate
                    const dimmedByTrackedFilter = hasTrackedFilter && !isTracked
                    const isEmptyDay = isWithinSelectedMonth && daySource === 'empty'
                    const isAdjacentMonth = cell.monthOffset !== 0
                    const isPrevMonthShortcut = index === firstCurrentMonthIndex - 1
                    const isNextMonthShortcut = cell.monthOffset === 1 && cell.day === 1
                    const selectedProfessionalColor = selectedProfessional !== ALL_PROFESSIONALS_OPTION
                      ? professionalMap.get(selectedProfessional)?.color
                      : ''
                    const adjacentPosition = cell.monthOffset === -1
                      ? index + 1
                      : cell.monthOffset === 1
                        ? cell.day
                        : 0
                    const adjacentTotal = cell.monthOffset === -1 ? previousMonthCellsCount : nextMonthCellsCount
                    const localBlockReason = String(dayBlockReasons[cell.date] || '').trim()
                    const blockReason = localBlockReason || closedReasonByDate.get(cell.date) || ''
                    const blockBadgeLabel = String(blockReason || '').trim() || 'Sem atendimento'
                    const trackedCardStyle = matchesSelectedProfessional
                      ? getProfessionalCardHighlightStyle(selectedProfessional, selectedProfessionalColor)
                      : matchesHighlightMode && highlightMode === 'manual'
                        ? {
                          borderColor: 'rgba(125, 211, 252, 0.68)',
                          background: 'linear-gradient(180deg, rgba(56, 189, 248, 0.13), rgba(15, 23, 42, 0.32))',
                          boxShadow: '0 0 0 1px rgba(125, 211, 252, 0.18), 0 14px 28px rgba(2, 132, 199, 0.16), inset 0 1px 0 rgba(255,255,255,0.05)',
                        } as React.CSSProperties
                        : matchesHighlightMode && highlightMode === 'auto'
                          ? {
                            borderColor: 'rgba(110, 231, 183, 0.72)',
                            background: 'linear-gradient(180deg, rgba(16, 185, 129, 0.15), rgba(15, 23, 42, 0.34))',
                            boxShadow: '0 0 0 1px rgba(110, 231, 183, 0.18), 0 14px 28px rgba(4, 120, 87, 0.18), inset 0 1px 0 rgba(255,255,255,0.05)',
                          } as React.CSSProperties
                          : matchesHighlightMode && highlightMode === 'blocked'
                            ? {
                              borderColor: 'rgba(251, 113, 133, 0.72)',
                              background: 'linear-gradient(180deg, rgba(244, 63, 94, 0.16), rgba(15, 23, 42, 0.34))',
                              boxShadow: '0 0 0 1px rgba(251, 113, 133, 0.18), 0 14px 28px rgba(159, 18, 57, 0.18), inset 0 1px 0 rgba(255,255,255,0.04)',
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
                    const handleOpenDate = (event?: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>) => {
                      if (isBulkSelectionMode) {
                        const { alreadySelected, nextDates } = toggleDateSelection(selectedDates, cell.date)
                        setSelectedDates(nextDates)
                        setActiveDate(resolveNextActiveDate(nextDates, cell.date, alreadySelected))
                        if (!nextDates.length) setMultiDateBlockReason('')
                        setIsBulkAssignModalOpen(false)
                        return
                      }
                      if (selectedProfessional !== ALL_PROFESSIONALS_OPTION) {
                        setSelectedProfessional(ALL_PROFESSIONALS_OPTION)
                        setHighlightMode(null)
                        return
                      }
                      if (highlightMode) {
                        setHighlightMode(null)
                        return
                      }
                      const multiSelect = Boolean((event as React.MouseEvent<HTMLDivElement> | undefined)?.metaKey || (event as React.MouseEvent<HTMLDivElement> | undefined)?.ctrlKey)
                      if (multiSelect) {
                        const { alreadySelected, nextDates } = toggleDateSelection(selectedDates, cell.date)
                        setSelectedDates(nextDates)
                        setActiveDate(resolveNextActiveDate(nextDates, cell.date, alreadySelected))
                        if (!nextDates.length) setMultiDateBlockReason('')
                        return
                      }
                      setSelectedDates([cell.date])
                      setActiveDate(cell.date)
                      setIsDayAssignModalOpen(true)
                    }

                    return (
                      <div
                        key={cell.date}
                        role={isAdjacentMonth ? undefined : 'button'}
                        tabIndex={isAdjacentMonth ? undefined : 0}
                        data-testid={`escala-day-${cell.date}`}
                        data-escala-preserve-filter="true"
                        onClick={isAdjacentMonth ? undefined : (event) => handleOpenDate(event)}
                        onKeyDown={isAdjacentMonth ? undefined : (event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            handleOpenDate(event)
                          }
                        }}
                        className={cn(
                          'escala-day-card grid h-full min-h-[108px] grid-rows-[auto_minmax(42px,1fr)_auto] content-start gap-1 rounded-xl border border-white/10 bg-white/[0.045] px-2 py-1.5 text-left text-[11px] text-slate-100/90 transition-all',
                          isAdjacentMonth ? 'place-items-center border-slate-400/8 bg-slate-400/[0.03] text-center text-slate-500/65 saturate-50' : 'hover:border-white/30',
                          isBlocked && 'border-rose-300/45 bg-rose-500/12 text-rose-50/95',
                          !isBlocked && daySource === 'auto' && 'border-emerald-300/25 bg-emerald-500/[0.075]',
                          isTracked && 'escala-day-card--tracked',
                          isSelectedDate && 'escala-day-card--selected border-sky-200/80 bg-sky-300/14',
                          isPrimarySelectedDate && 'ring-2 ring-sky-300/32',
                          (dimmedByActiveDate || dimmedByTrackedFilter) && 'opacity-45 saturate-75'
                        )}
                        style={cardStyle}
                      >
                        <div className={cn(
                          'flex min-h-[1.2rem] w-full items-start justify-between gap-2',
                          isAdjacentMonth && 'justify-center'
                        )}>
                          <div className={cn(
                            'flex min-w-[1.4rem] items-start gap-1 pt-0.5 text-[13px] font-semibold leading-none text-white/92',
                            isAdjacentMonth && 'min-w-0 justify-center pt-0 text-slate-500/60'
                          )}>
                            <span className={cn(isAdjacentMonth && 'text-slate-400/60')}>{cell.day}</span>
                          </div>
                        </div>

                        <div
                          className={cn(
                            'flex min-h-[34px] min-w-0 flex-wrap items-start justify-center gap-1 text-center',
                            isAdjacentMonth && 'min-h-[42px]'
                          )}
                        >
                          {isAdjacentMonth ? (
                            <>
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
                            </>
                          ) : displayEntryNames.length ? (
                            displayEntryNames.map((name) => {
                              const isActiveSelection = selectedProfessional !== ALL_PROFESSIONALS_OPTION && name === selectedProfessional
                              const isMuted = selectedProfessional !== ALL_PROFESSIONALS_OPTION && name !== selectedProfessional
                              const accentColor = professionalMap.get(name)?.color
                              return (
                                <button
                                  key={`${cell.date}__${name}`}
                                  type="button"
                                  data-testid={`escala-pill-${cell.date}-${slugifySegment(name)}`}
                                  data-escala-preserve-filter="true"
                                  className={cn(
                                    'escala-entry-pill rounded-full border px-1.5 py-0.5 text-[10px] font-semibold leading-tight transition-all',
                                    isActiveSelection && 'escala-entry-pill--active',
                                    isMuted && 'escala-entry-pill--muted',
                                  )}
                                  style={getProfessionalBadgeStyle(name, isActiveSelection ? 'active' : (isMuted ? 'muted' : 'default'), accentColor)}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    focusProfessional(name)
                                  }}
                                  aria-pressed={isActiveSelection}
                                >
                                  {name}
                                </button>
                              )
                            })
                          ) : null}
                        </div>

                        <div className="flex min-h-[30px] flex-col justify-end gap-1">
                          {!isAdjacentMonth && !displayEntryNames.length && isBlocked ? (
                            <NoAttendanceChip
                              date={cell.date}
                              blocked
                              label={localBlockReason ? blockBadgeLabel : undefined}
                            />
                          ) : null}
                          {!isAdjacentMonth && !displayEntryNames.length && !isBlocked && (
                            <div className={cn(highlightMode === 'empty' && isEmptyDay && '[&_div]:border-amber-300/35 [&_div]:bg-amber-400/12 [&_div]:text-amber-50')}>
                              <NoAttendanceChip date={cell.date} label="Sem atendimento" />
                            </div>
                          )}
                          {!isAdjacentMonth && holidayLabels.length ? (
                            <Badge variant="warning" className="max-w-full px-1.5 py-0.5 text-[10px]">
                              {holidayLabels[0]}
                            </Badge>
                          ) : null}
                          {!isAdjacentMonth ? (
                            <EscalaDaySourceBadge
                              date={cell.date}
                              daySource={daySource}
                              appliedSuggestion={appliedSuggestion}
                            />
                          ) : null}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <EscalaTeamPanel
                activeInjectors={activeInjectors}
                inactiveInjectors={inactiveInjectors}
                isBulkSelectionMode={isBulkSelectionMode}
                savingTeamMember={savingTeamMember}
                selectedTeamMember={selectedTeamMember}
                selectedTeamMemberDirty={selectedTeamMemberDirty}
                selectedTeamMemberDraft={selectedTeamMemberDraft}
                showInactiveTeamMembers={showInactiveTeamMembers}
                teamFormMode={teamFormMode}
                teamLoadError={teamLoadError}
                onBeginAddTeamMember={beginAddTeamMember}
                onBeginEditTeamMember={beginEditTeamMember}
                onCancelBulkSelectionMode={cancelBulkSelectionMode}
                onCloseTeamPanel={closeTeamPanel}
                onConfirmBulkSelectionMode={confirmBulkSelectionMode}
                onEnableBulkSelectionMode={enableBulkSelectionMode}
                onRetryProfessionals={() => void refreshProfessionals(selectedUnit)}
                onSaveTeamMember={() => void handleSaveTeamMember()}
                onSelectTeamMember={selectTeamMember}
                onToggleInactiveTeamMembers={() => setShowInactiveTeamMembers((prev) => !prev)}
                onToggleSelectedTeamMemberOption={toggleSelectedTeamMemberOption}
                onUpdateSelectedTeamMemberField={updateSelectedTeamMemberField}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <EscalaAssignDialog
        activeDate={activeDate}
        assignableProfessionalOptions={assignableProfessionalOptions}
        closedBlockedDates={closedBlockedDates}
        closedDateSet={closedDateSet}
        closedReasonByDate={closedReasonByDate}
        dayActionKey={dayActionKey}
        dayBlockReasons={dayBlockReasons}
        getDatesSelectionState={getDatesSelectionState}
        getDayDraft={getDayDraft}
        isBulkAssignModalOpen={isBulkAssignModalOpen}
        isBulkSelectionMode={isBulkSelectionMode}
        isDayAssignModalOpen={isDayAssignModalOpen}
        multiDateBlockReason={multiDateBlockReason}
        professionalMap={professionalMap}
        scheduleByDate={scheduleByDate}
        selectedDates={selectedDates}
        selectedDatesLabel={selectedDatesLabel}
        setDayBlockReasons={setDayBlockReasons}
        setIsBulkAssignModalOpen={setIsBulkAssignModalOpen}
        setIsDayAssignModalOpen={setIsDayAssignModalOpen}
        setMultiDateBlockReason={setMultiDateBlockReason}
        toggleDayProfessional={toggleDayProfessional}
        toggleSelectedDatesProfessional={toggleSelectedDatesProfessional}
        onCloseAssignModalWithoutSave={closeAssignModalWithoutSave}
        onCloseActiveDateWithSave={() => void closeActiveDateWithSave()}
        onToggleSelectedDatesBlock={() => void handleToggleSelectedDatesBlock()}
      />

      <EscalaPlanningAssistantModal
        autoPrefillProgress={autoPrefillProgress}
        autoPrefillState={autoPrefillState}
        onApplySuggestions={async () => {
          await applySuggestions()
        }}
        onIgnoreSuggestions={ignoreSuggestions}
        onOpenChange={handlePlanningAssistantOpenChange}
        onRetryAnalysis={retryAnalysis}
        open={isPlanningAssistantModalOpen}
        planningAssistantProgressLabel={planningAssistantProgressLabel}
        planningAssistantTitle={planningAssistantTitle}
        selectedMonth={selectedMonth}
      />
    </div>
  )
}
