import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchEscalaOverview,
  fetchEscalaProfessionals,
  fetchEscalaSchedule,
} from '@/escalaApi'
import {
  buildYearOptions,
  DEFAULT_MONTH_NUMBER,
  DEFAULT_YEAR,
  resolveVisibleMonth,
} from '@/escalaShared'
import type {
  EscalaClosedDay,
  EscalaHoliday,
  EscalaProfessional,
  EscalaScheduleEntry,
} from '@/escalaTypes'

type EscalaDataControllerResult = {
  units: string[]
  availableMonths: string[]
  selectedUnit: string
  selectedMonth: string
  selectedMonthNumber: string
  selectedYear: string
  professionals: EscalaProfessional[]
  schedule: EscalaScheduleEntry[]
  closedDays: EscalaClosedDay[]
  holidays: EscalaHoliday[]
  loadingSchedule: boolean
  error: string | null
  teamLoadError: string | null
  yearOptions: string[]
  setError: React.Dispatch<React.SetStateAction<string | null>>
  setSelectedUnit: React.Dispatch<React.SetStateAction<string>>
  setSelectedMonthNumber: React.Dispatch<React.SetStateAction<string>>
  setSelectedYear: React.Dispatch<React.SetStateAction<string>>
  setSchedule: React.Dispatch<React.SetStateAction<EscalaScheduleEntry[]>>
  setProfessionals: React.Dispatch<React.SetStateAction<EscalaProfessional[]>>
  setClosedDays: React.Dispatch<React.SetStateAction<EscalaClosedDay[]>>
  setHolidays: React.Dispatch<React.SetStateAction<EscalaHoliday[]>>
  setTeamLoadError: React.Dispatch<React.SetStateAction<string | null>>
  markMonthSelectionTouched: () => void
  refreshOverview: () => Promise<void>
  refreshProfessionals: (unitOverride?: string) => Promise<void>
  refreshSchedule: (unitOverride?: string, monthOverride?: string) => Promise<void>
}

export function useEscalaDataController(): EscalaDataControllerResult {
  const [units, setUnits] = useState<string[]>([])
  const [availableMonths, setAvailableMonths] = useState<string[]>([])
  const [selectedUnit, setSelectedUnit] = useState<string>('')
  const [selectedMonthNumber, setSelectedMonthNumber] = useState<string>(DEFAULT_MONTH_NUMBER)
  const [selectedYear, setSelectedYear] = useState<string>(DEFAULT_YEAR)
  const [professionals, setProfessionals] = useState<EscalaProfessional[]>([])
  const [schedule, setSchedule] = useState<EscalaScheduleEntry[]>([])
  const [closedDays, setClosedDays] = useState<EscalaClosedDay[]>([])
  const [holidays, setHolidays] = useState<EscalaHoliday[]>([])
  const [loadingSchedule, setLoadingSchedule] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [teamLoadError, setTeamLoadError] = useState<string | null>(null)

  const selectedPeriodRef = useRef<{ year: string; monthNumber: string }>({
    year: DEFAULT_YEAR,
    monthNumber: DEFAULT_MONTH_NUMBER,
  })
  const monthSelectionTouchedRef = useRef(false)
  const overviewRequestRef = useRef(0)
  const professionalsRequestRef = useRef(0)
  const scheduleRequestRef = useRef(0)

  const selectedMonth = useMemo(
    () => (selectedYear && selectedMonthNumber ? `${selectedYear}-${selectedMonthNumber}` : ''),
    [selectedMonthNumber, selectedYear],
  )
  const yearOptions = useMemo(() => buildYearOptions(availableMonths), [availableMonths])

  useEffect(() => {
    selectedPeriodRef.current = {
      year: selectedYear || DEFAULT_YEAR,
      monthNumber: selectedMonthNumber || DEFAULT_MONTH_NUMBER,
    }
  }, [selectedMonthNumber, selectedYear])

  const refreshOverview = useCallback(async () => {
    const requestId = overviewRequestRef.current + 1
    overviewRequestRef.current = requestId
    const res = await fetchEscalaOverview()
    if (overviewRequestRef.current !== requestId) return
    if (!res.ok) {
      setError(res.error || 'Não foi possível carregar a escala.')
      return
    }

    const nextUnits = Array.isArray(res.units) ? res.units : []
    const nextMonths = Array.isArray(res.months) ? res.months : []
    setUnits(nextUnits)
    setAvailableMonths(nextMonths)
    setSelectedUnit((prev) => (prev || nextUnits[0] || prev))

    if (!monthSelectionTouchedRef.current && nextMonths.length) {
      const resolvedMonth = resolveVisibleMonth(
        nextMonths,
        selectedPeriodRef.current.year,
        selectedPeriodRef.current.monthNumber,
      )
      setSelectedYear(resolvedMonth.year)
      setSelectedMonthNumber(resolvedMonth.monthNumber)
    } else {
      setSelectedMonthNumber((prev) => prev || DEFAULT_MONTH_NUMBER)
      setSelectedYear((prev) => prev || DEFAULT_YEAR)
    }
    setError(null)
  }, [])

  const refreshProfessionals = useCallback(async (unitOverride?: string) => {
    const unit = unitOverride || selectedUnit
    if (!unit) return
    const requestId = professionalsRequestRef.current + 1
    professionalsRequestRef.current = requestId
    const res = await fetchEscalaProfessionals(unit)
    if (professionalsRequestRef.current !== requestId) return
    if (!res.ok) {
      setProfessionals([])
      setTeamLoadError(res.error || 'Falha ao carregar a equipe do cadastro.')
      return
    }
    setProfessionals(Array.isArray(res.data) ? res.data : [])
    setTeamLoadError(null)
  }, [selectedUnit])

  const refreshSchedule = useCallback(async (unitOverride?: string, monthOverride?: string) => {
    const unit = unitOverride || selectedUnit
    const month = monthOverride || (selectedYear && selectedMonthNumber ? `${selectedYear}-${selectedMonthNumber}` : '')
    if (!unit || !month) return
    const requestId = scheduleRequestRef.current + 1
    scheduleRequestRef.current = requestId
    setLoadingSchedule(true)
    const res = await fetchEscalaSchedule(unit, month)
    if (scheduleRequestRef.current !== requestId) return
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

  useEffect(() => {
    void refreshOverview()
  }, [refreshOverview])

  useEffect(() => {
    if (!selectedUnit) return
    void refreshProfessionals(selectedUnit)
  }, [refreshProfessionals, selectedUnit])

  useEffect(() => {
    if (!selectedUnit || !selectedMonth) return
    void refreshSchedule(selectedUnit, selectedMonth)
  }, [refreshSchedule, selectedMonth, selectedUnit])

  const markMonthSelectionTouched = useCallback(() => {
    monthSelectionTouchedRef.current = true
  }, [])

  return {
    units,
    availableMonths,
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
    setError,
    setSelectedUnit,
    setSelectedMonthNumber,
    setSelectedYear,
    setSchedule,
    setProfessionals,
    setClosedDays,
    setHolidays,
    setTeamLoadError,
    markMonthSelectionTouched,
    refreshOverview,
    refreshProfessionals,
    refreshSchedule,
  }
}
