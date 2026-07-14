import type {
  CalendarCell,
  DayPlanSource,
  EscalaClosedDay,
  EscalaScheduleEntry,
  PrefillSuggestion,
  WeekdayDefaultMap,
} from '@/escalaTypes'

export function buildCalendarCells(monthValue: string): CalendarCell[] {
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

export function getWeekdayFromIsoDate(value: string) {
  const [year, month, day] = String(value || '').split('-').map(Number)
  if (!year || !month || !day) return -1
  return new Date(year, month - 1, day).getDay()
}

export function buildPreviousMonthKeys(monthValue: string, count = 3) {
  const [year, month] = monthValue.split('-').map(Number)
  if (!year || !month || count <= 0) return [] as string[]
  const keys: string[] = []
  for (let index = 1; index <= count; index += 1) {
    const date = new Date(year, month - 1 - index, 1)
    keys.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`)
  }
  return keys
}

export function deriveWeekdayDefaultProfessionals(entries: EscalaScheduleEntry[]): WeekdayDefaultMap {
  const byWeekday = new Map<number, Map<string, number>>()
  entries.forEach((entry) => {
    const professional = String(entry?.professional || '').trim()
    const weekday = getWeekdayFromIsoDate(String(entry?.date || ''))
    if (!professional || weekday < 0) return
    const currentMap = byWeekday.get(weekday) || new Map<string, number>()
    currentMap.set(professional, (currentMap.get(professional) || 0) + 1)
    byWeekday.set(weekday, currentMap)
  })

  const defaults: WeekdayDefaultMap = {}
  byWeekday.forEach((countByProfessional, weekday) => {
    const winner = Array.from(countByProfessional.entries())
      .sort((left, right) => {
        if (right[1] !== left[1]) return right[1] - left[1]
        return left[0].localeCompare(right[0])
      })[0]
    if (!winner) return
    defaults[weekday as 0 | 1 | 2 | 3 | 4 | 5 | 6] = winner[0]
  })

  return defaults
}

export function buildWeekdayPrefillAssignments(dates: string[], historicalEntries: EscalaScheduleEntry[]) {
  const weekdayDefaults = deriveWeekdayDefaultProfessionals(historicalEntries)
  return dates
    .map((date) => {
      const weekday = getWeekdayFromIsoDate(date)
      const professional = weekdayDefaults[weekday as 0 | 1 | 2 | 3 | 4 | 5 | 6]
      if (!professional) return null
      return { date, professional }
    })
    .filter((item): item is { date: string; professional: string } => Boolean(item))
}

export function applyPrefillUpdatesToSchedule(
  entries: EscalaScheduleEntry[],
  unit: string,
  updates: Array<{ date: string; professional: string }>,
) {
  const updateMap = new Map(updates.map((update) => [update.date, update.professional]))
  const preserved = entries.filter((entry) => !updateMap.has(entry.date))
  const inserted = updates.map((update) => ({
    date: update.date,
    unit,
    professional: update.professional,
  }))
  return [...preserved, ...inserted].sort((left, right) => {
    const dateCompare = left.date.localeCompare(right.date)
    if (dateCompare !== 0) return dateCompare
    return left.professional.localeCompare(right.professional)
  })
}

export function buildScheduleVersion(
  entries: EscalaScheduleEntry[],
  closedDays: EscalaClosedDay[],
  month: string,
) {
  const schedulePart = entries
    .filter((entry) => entry.date.startsWith(`${month}-`))
    .map((entry) => `${entry.date}:${entry.professional}`)
    .sort()
    .join('|')
  const closedPart = closedDays
    .filter((entry) => entry.date.startsWith(`${month}-`))
    .map((entry) => `${entry.date}:${String(entry.reason || '').trim()}`)
    .sort()
    .join('|')
  return `${schedulePart}__${closedPart}`
}

export function resolveDayPlanSource(params: {
  date: string
  entryNames: string[]
  blocked: boolean
  autoSuggestion?: PrefillSuggestion | null
}) {
  if (params.blocked) return 'blocked' as DayPlanSource
  if (!params.entryNames.length) return 'empty' as DayPlanSource
  if (
    params.autoSuggestion
    && params.entryNames.length === 1
    && params.entryNames[0] === params.autoSuggestion.professional
  ) {
    return 'auto' as DayPlanSource
  }
  return 'manual' as DayPlanSource
}

export function buildMonthPlanMetrics(
  calendarCells: CalendarCell[],
  scheduleByDate: Map<string, EscalaScheduleEntry[]>,
  blockedDates: Set<string>,
  autoSuggestionMap: Map<string, PrefillSuggestion>,
) {
  return calendarCells.reduce((acc, cell) => {
    if (cell.monthOffset !== 0) return acc
    const entries = scheduleByDate.get(cell.date) || []
    const source = resolveDayPlanSource({
      date: cell.date,
      entryNames: entries.map((entry) => entry.professional),
      blocked: blockedDates.has(cell.date),
      autoSuggestion: autoSuggestionMap.get(cell.date) || null,
    })
    if (source === 'blocked') acc.blocked += 1
    if (source === 'empty') acc.empty += 1
    if (source === 'manual') acc.manual += 1
    if (source === 'auto') acc.auto += 1
    if (source === 'manual' || source === 'auto') acc.covered += 1
    return acc
  }, {
    covered: 0,
    blocked: 0,
    empty: 0,
    manual: 0,
    auto: 0,
  })
}
