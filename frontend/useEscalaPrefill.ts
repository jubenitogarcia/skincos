import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { fetchEscalaPrefill, replaceScheduleEntriesBatch } from '@/escalaApi'
import {
  applyPrefillUpdatesToSchedule,
  type CalendarCell,
  type EscalaClosedDay,
  type EscalaScheduleEntry,
  type PrefillSuggestion,
} from '@/escalaDomain'

type PrefillUiStatus = 'idle' | 'analyzing' | 'ready' | 'applying' | 'done' | 'error' | 'ignored'

type PrefillState = {
  status: PrefillUiStatus
  message: string
  total: number
  completed: number
  windowMonths: string[]
  suggestions: PrefillSuggestion[]
  requestId?: string
}

const EMPTY_STATE: PrefillState = {
  status: 'idle',
  message: '',
  total: 0,
  completed: 0,
  windowMonths: [],
  suggestions: [],
}

function emitPrefillTelemetry(event: string, payload: Record<string, unknown>) {
  try {
    console.info(JSON.stringify({ event, ...payload }))
  } catch {
    // ignore telemetry emission issues
  }
}

export function useEscalaPrefill(params: {
  selectedUnit: string
  selectedMonth: string
  loadingSchedule: boolean
  calendarCells: CalendarCell[]
  schedule: EscalaScheduleEntry[]
  closedDays: EscalaClosedDay[]
  scheduleVersion: string
  onScheduleApplied: (next: EscalaScheduleEntry[]) => void
}) {
  const {
    selectedUnit,
    selectedMonth,
    loadingSchedule,
    calendarCells,
    schedule,
    closedDays,
    scheduleVersion,
    onScheduleApplied,
  } = params

  const [state, setState] = useState<PrefillState>(EMPTY_STATE)
  const cacheRef = useRef(new Map<string, PrefillState>())
  const ignoredRef = useRef(new Set<string>())
  const appliedRef = useRef(new Map<string, Map<string, PrefillSuggestion>>())

  const cacheKey = useMemo(() => {
    if (!selectedUnit || !selectedMonth) return ''
    return `${selectedUnit}__${selectedMonth}__${scheduleVersion}`
  }, [scheduleVersion, selectedMonth, selectedUnit])

  const appliedSuggestionMap = useMemo(() => {
    const monthKey = `${selectedUnit}__${selectedMonth}`
    return appliedRef.current.get(monthKey) || new Map<string, PrefillSuggestion>()
  }, [selectedMonth, selectedUnit, state.completed])

  const activeSuggestionMap = useMemo(() => {
    const base = new Map<string, PrefillSuggestion>()
    state.suggestions.forEach((suggestion) => base.set(suggestion.date, suggestion))
    appliedSuggestionMap.forEach((suggestion, date) => {
      if (!base.has(date)) base.set(date, suggestion)
    })
    return base
  }, [appliedSuggestionMap, state.suggestions])

  const clearState = useCallback(() => {
    setState(EMPTY_STATE)
  }, [])

  useEffect(() => {
    if (!selectedUnit || !selectedMonth) {
      clearState()
      return
    }
    if (loadingSchedule) return
    if (!cacheKey) return
    if (ignoredRef.current.has(cacheKey)) {
      setState((current) => ({
        ...current,
        status: 'ignored',
        message: 'Sugestões ignoradas para esta versão do mês.',
      }))
      return
    }

    const cached = cacheRef.current.get(cacheKey)
    if (cached) {
      setState(cached)
      return
    }

    let cancelled = false
    const startedAt = Date.now()
    setState({
      status: 'analyzing',
      message: 'Analisando histórico para sugerir a agenda do mês…',
      total: 0,
      completed: 0,
      windowMonths: [],
      suggestions: [],
    })
    emitPrefillTelemetry('escala.prefill.analyze.started', {
      unit: selectedUnit,
      month: selectedMonth,
      scheduleVersion,
    })

    void (async () => {
      const response = await fetchEscalaPrefill(selectedUnit, selectedMonth)
      if (cancelled) return
      if (!response.ok) {
        const nextState = {
          status: 'error' as const,
          message: response.error || 'Falha ao analisar histórico da Escala.',
          total: 0,
          completed: 0,
          windowMonths: [],
          suggestions: [],
          requestId: response.requestId,
        }
        setState(nextState)
        emitPrefillTelemetry('escala.prefill.analyze.failed', {
          unit: selectedUnit,
          month: selectedMonth,
          durationMs: Date.now() - startedAt,
          requestId: response.requestId,
        })
        return
      }

      const suggestions = Array.isArray(response.suggestions) ? response.suggestions : []
      const nextState: PrefillState = suggestions.length
        ? {
            status: 'ready',
            message: suggestions.length === 1
              ? '1 data futura está pronta para sugestão.'
              : `${suggestions.length} datas futuras estão prontas para sugestão.`,
            total: suggestions.length,
            completed: 0,
            windowMonths: Array.isArray(response.windowMonths) ? response.windowMonths : [],
            suggestions,
            requestId: response.requestId,
          }
        : {
            status: 'done',
            message: 'Nenhuma sugestão automática foi encontrada para este mês.',
            total: 0,
            completed: 0,
            windowMonths: Array.isArray(response.windowMonths) ? response.windowMonths : [],
            suggestions: [],
            requestId: response.requestId,
          }

      cacheRef.current.set(cacheKey, nextState)
      setState(nextState)
      emitPrefillTelemetry('escala.prefill.analyze.completed', {
        unit: selectedUnit,
        month: selectedMonth,
        candidateDates: suggestions.length,
        durationMs: Date.now() - startedAt,
        requestId: response.requestId,
      })
    })()

    return () => {
      cancelled = true
    }
  }, [cacheKey, clearState, loadingSchedule, scheduleVersion, selectedMonth, selectedUnit])

  const ignoreSuggestions = useCallback(() => {
    if (!cacheKey) return
    ignoredRef.current.add(cacheKey)
    setState((current) => ({
      ...current,
      status: 'ignored',
      message: 'Sugestões ignoradas para este mês. Elas voltam se a agenda mudar.',
    }))
  }, [cacheKey])

  const retryAnalysis = useCallback(() => {
    if (!cacheKey) return
    ignoredRef.current.delete(cacheKey)
    cacheRef.current.delete(cacheKey)
    setState(EMPTY_STATE)
  }, [cacheKey])

  const applySuggestions = useCallback(async () => {
    if (!selectedUnit || !selectedMonth) return { ok: false }
    const suggestions = state.suggestions
    if (!suggestions.length) return { ok: true }

    const startedAt = Date.now()
    setState((current) => ({
      ...current,
      status: 'applying',
      message: suggestions.length === 1
        ? 'Aplicando 1 sugestão à agenda…'
        : `Aplicando ${suggestions.length} sugestões à agenda…`,
      total: suggestions.length,
      completed: 0,
    }))
    emitPrefillTelemetry('escala.prefill.apply.started', {
      unit: selectedUnit,
      month: selectedMonth,
      candidateDates: suggestions.length,
      requestId: state.requestId,
    })

    const response = await replaceScheduleEntriesBatch({
      unit: selectedUnit,
      entries: suggestions.map((suggestion) => ({
        date: suggestion.date,
        professionals: [suggestion.professional],
      })),
    })
    if (!response.ok) {
      setState((current) => ({
        ...current,
        status: 'error',
        message: response.error || 'Falha ao aplicar as sugestões de agenda.',
        requestId: response.requestId,
      }))
      emitPrefillTelemetry('escala.prefill.apply.failed', {
        unit: selectedUnit,
        month: selectedMonth,
        candidateDates: suggestions.length,
        durationMs: Date.now() - startedAt,
        requestId: response.requestId,
      })
      toast.error(response.error || 'Falha ao aplicar as sugestões da Escala.')
      return { ok: false }
    }

    const nextSchedule = applyPrefillUpdatesToSchedule(
      schedule,
      selectedUnit,
      suggestions.map((suggestion) => ({
        date: suggestion.date,
        professional: suggestion.professional,
      })),
    )
    const monthKey = `${selectedUnit}__${selectedMonth}`
    appliedRef.current.set(
      monthKey,
      new Map(suggestions.map((suggestion) => [suggestion.date, suggestion])),
    )
    onScheduleApplied(nextSchedule)
    ignoredRef.current.delete(cacheKey)
    const nextState: PrefillState = {
      status: 'done',
      message: suggestions.length === 1
        ? '1 sugestão foi aplicada à agenda.'
        : `${suggestions.length} sugestões foram aplicadas à agenda.`,
      total: suggestions.length,
      completed: suggestions.length,
      windowMonths: state.windowMonths,
      suggestions,
      requestId: response.requestId,
    }
    cacheRef.current.set(cacheKey, nextState)
    setState(nextState)
    emitPrefillTelemetry('escala.prefill.apply.completed', {
      unit: selectedUnit,
      month: selectedMonth,
      candidateDates: suggestions.length,
      appliedDates: suggestions.length,
      durationMs: Date.now() - startedAt,
      requestId: response.requestId,
    })
    toast.success(
      suggestions.length === 1
        ? '1 data foi preenchida com a sugestão automática.'
        : `${suggestions.length} datas foram preenchidas com sugestões automáticas.`,
    )
    return { ok: true }
  }, [cacheKey, onScheduleApplied, schedule, selectedMonth, selectedUnit, state.requestId, state.suggestions, state.windowMonths])

  const candidateFutureDates = useMemo(
    () => calendarCells.filter((cell) => cell.monthOffset === 0).length,
    [calendarCells],
  )

  return {
    prefillState: state,
    activeSuggestionMap,
    appliedSuggestionMap,
    candidateFutureDates,
    applySuggestions,
    ignoreSuggestions,
    retryAnalysis,
  }
}
