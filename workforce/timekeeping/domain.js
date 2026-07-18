const EVENT_ORDER = Object.freeze({ WORK_START: 0, BREAK_START: 1, BREAK_END: 2, WORK_END: 3 })

export const EVENT_TYPES = Object.freeze(Object.keys(EVENT_ORDER))

export function canonicalEventType(value) {
  const type = String(value || '').trim().toUpperCase()
  if (type === 'IN') return 'WORK_START'
  if (type === 'OUT') return 'WORK_END'
  return EVENT_TYPES.includes(type) ? type : null
}

export function minutesBetween(start, end) {
  const a = Date.parse(start)
  const b = Date.parse(end)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null
  return Math.round((b - a) / 60000)
}

function isoDateInZone(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(instant))
  const read = (name) => parts.find((part) => part.type === name)?.value || ''
  return `${read('year')}-${read('month')}-${read('day')}`
}

function sortEvents(events) {
  return [...events]
    .map((event) => ({ ...event, eventType: canonicalEventType(event.eventType || event.type) }))
    .sort((a, b) => {
      const byTime = Date.parse(a.occurredAt || a.at) - Date.parse(b.occurredAt || b.at)
      if (byTime) return byTime
      const byType = (EVENT_ORDER[a.eventType] ?? 99) - (EVENT_ORDER[b.eventType] ?? 99)
      return byType || String(a.id || '').localeCompare(String(b.id || ''))
    })
}

function applyTolerance(value, tolerance) {
  const n = Math.max(0, Number(value || 0))
  return n <= Math.max(0, Number(tolerance || 0)) ? 0 : n
}

/**
 * Pure, deterministic calculation. The caller resolves schedule, leave and rule
 * versions before calling this function; payroll conversions intentionally stay out.
 */
export function calculateDay({ date, events = [], rule = {}, schedule = null, holiday = false, absence = null }) {
  const timeZone = rule.timeZone || 'America/Sao_Paulo'
  const ordered = sortEvents(events)
  const inconsistencies = []
  const workSegments = []
  const breaks = []
  let workStartedAt = null
  let breakStartedAt = null

  for (const event of ordered) {
    const at = event.occurredAt || event.at
    if (!event.eventType || !Number.isFinite(Date.parse(at))) {
      inconsistencies.push({ code: 'INVALID_EVENT', eventId: event.id || null })
      continue
    }
    if (event.eventType === 'WORK_START') {
      if (workStartedAt || breakStartedAt) inconsistencies.push({ code: 'WORK_START_OUT_OF_ORDER', eventId: event.id || null })
      else workStartedAt = at
    } else if (event.eventType === 'BREAK_START') {
      if (!workStartedAt || breakStartedAt) inconsistencies.push({ code: 'BREAK_START_OUT_OF_ORDER', eventId: event.id || null })
      else {
        const minutes = minutesBetween(workStartedAt, at)
        if (minutes !== null) workSegments.push(minutes)
        workStartedAt = null
        breakStartedAt = at
      }
    } else if (event.eventType === 'BREAK_END') {
      if (!breakStartedAt || workStartedAt) inconsistencies.push({ code: 'BREAK_END_OUT_OF_ORDER', eventId: event.id || null })
      else {
        const minutes = minutesBetween(breakStartedAt, at)
        if (minutes !== null) breaks.push(minutes)
        breakStartedAt = null
        workStartedAt = at
      }
    } else if (event.eventType === 'WORK_END') {
      if (!workStartedAt || breakStartedAt) inconsistencies.push({ code: 'WORK_END_OUT_OF_ORDER', eventId: event.id || null })
      else {
        const minutes = minutesBetween(workStartedAt, at)
        if (minutes !== null) workSegments.push(minutes)
        workStartedAt = null
      }
    }
  }

  if (workStartedAt) inconsistencies.push({ code: 'OPEN_WORK_SEGMENT' })
  if (breakStartedAt) inconsistencies.push({ code: 'OPEN_BREAK' })
  const workedMinutes = workSegments.reduce((sum, value) => sum + value, 0)
  const breakMinutes = breaks.reduce((sum, value) => sum + value, 0)
  const expectedMinutes = holiday || absence ? 0 : Math.max(0, Number(schedule?.expectedMinutes ?? rule.expectedMinutes ?? 0))
  const startAt = ordered.find((event) => event.eventType === 'WORK_START')?.occurredAt || ordered.find((event) => event.eventType === 'WORK_START')?.at || null
  const endAt = [...ordered].reverse().find((event) => event.eventType === 'WORK_END')?.occurredAt || [...ordered].reverse().find((event) => event.eventType === 'WORK_END')?.at || null
  const scheduledStart = schedule?.startAt || null
  const scheduledEnd = schedule?.endAt || null
  const lateMinutes = startAt && scheduledStart ? applyTolerance(minutesBetween(scheduledStart, startAt), rule.lateToleranceMinutes) : 0
  const earlyLeaveMinutes = endAt && scheduledEnd ? applyTolerance(minutesBetween(endAt, scheduledEnd), rule.earlyLeaveToleranceMinutes) : 0
  const balanceMinutes = workedMinutes - expectedMinutes
  const overtimeMinutes = Math.max(0, balanceMinutes - Math.max(0, Number(rule.overtimeToleranceMinutes || 0)))
  const maxWorked = Number(rule.maxWorkedMinutes || 0)
  if (maxWorked && workedMinutes > maxWorked) inconsistencies.push({ code: 'MAX_WORKED_EXCEEDED', actualMinutes: workedMinutes, maxMinutes: maxWorked })
  const dayDate = date || (ordered[0] ? isoDateInZone(ordered[0].occurredAt || ordered[0].at, timeZone) : null)
  const status = inconsistencies.length ? 'INCONSISTENT' : holiday ? 'HOLIDAY' : absence ? 'ABSENCE' : ordered.length ? 'CALCULATED' : expectedMinutes ? 'MISSING' : 'REST'

  return {
    date: dayDate,
    timeZone,
    expectedMinutes,
    workedMinutes,
    breakMinutes,
    lateMinutes,
    earlyLeaveMinutes,
    overtimeMinutes,
    dailyBalanceMinutes: balanceMinutes,
    status,
    inconsistencies,
    eventIds: ordered.map((event) => event.id).filter(Boolean),
    source: { ruleVersionId: rule.id || null, scheduleId: schedule?.id || null, holiday: !!holiday, absenceId: absence?.id || null },
  }
}

export function calculatePeriod({ days = [], openingBalanceMinutes = 0 }) {
  let balance = Number(openingBalanceMinutes || 0)
  const calculatedDays = days.map((day) => {
    const result = day.dailyBalanceMinutes === undefined ? calculateDay(day) : day
    balance += Number(result.dailyBalanceMinutes || 0)
    return { ...result, accumulatedBalanceMinutes: balance }
  })
  return { openingBalanceMinutes: Number(openingBalanceMinutes || 0), closingBalanceMinutes: balance, days: calculatedDays }
}

export const __testables = { isoDateInZone, sortEvents, applyTolerance }
