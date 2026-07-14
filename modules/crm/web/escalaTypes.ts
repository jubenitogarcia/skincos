export type CalendarCell = {
  date: string
  day: number
  monthOffset: -1 | 0 | 1
}

export type EscalaProfessional = {
  name: string
  status: string
  units: string[]
  role: string
  shift: string
  nickname: string
  phone: string
  email: string
  instagram: string
  color: string
}

export type EscalaScheduleEntry = {
  date: string
  unit: string
  professional: string
}

export type EscalaClosedDay = {
  date: string
  unit: string
  reason: string
}

export type EscalaHoliday = {
  date: string
  unit: string
  name: string
}

export type WeekdayDefaultMap = Partial<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, string>>

export type PrefillSuggestion = {
  date: string
  professional: string
  confidence: number
  sampleSize: number
}

export type DayPlanSource = 'manual' | 'auto' | 'blocked' | 'empty'

export type EscalaHighlightMode = Extract<DayPlanSource, 'manual' | 'auto' | 'blocked' | 'empty'>

export type EscalaHeaderState = {
  units: string[]
  monthOptions: string[]
  yearOptions: string[]
  selectedUnit: string
  selectedMonthNumber: string
  selectedYear: string
  totalScheduledDays: number
  unavailableDaysCount?: number
  manualDays?: number
  autoDays?: number
  blockedDays?: number
  emptyDays?: number
  coveredDays?: number
  highlightMode?: EscalaHighlightMode | null
}

export type EscalaHeaderAction =
  | { type: 'set-unit'; value: string }
  | { type: 'set-month'; value: string }
  | { type: 'set-year'; value: string }
  | { type: 'toggle-highlight'; value: EscalaHighlightMode }
  | { type: 'clear-selection' }

export type EscalaActionResult = {
  ok: boolean
  changed: boolean
  error?: string
}

export type EscalaTeamFormMode = 'idle' | 'edit' | 'add'
