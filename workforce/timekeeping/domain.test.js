import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateDay, calculatePeriod } from './domain.js'

test('calculates a regular day with one break deterministically', () => {
  const result = calculateDay({
    date: '2026-07-18', rule: { expectedMinutes: 480, lateToleranceMinutes: 5 },
    schedule: { expectedMinutes: 480, startAt: '2026-07-18T11:00:00.000Z', endAt: '2026-07-18T20:00:00.000Z' },
    events: [
      { id: '1', eventType: 'WORK_START', occurredAt: '2026-07-18T11:03:00.000Z' },
      { id: '2', eventType: 'BREAK_START', occurredAt: '2026-07-18T15:00:00.000Z' },
      { id: '3', eventType: 'BREAK_END', occurredAt: '2026-07-18T16:00:00.000Z' },
      { id: '4', eventType: 'WORK_END', occurredAt: '2026-07-18T20:00:00.000Z' },
    ],
  })
  assert.equal(result.workedMinutes, 477)
  assert.equal(result.breakMinutes, 60)
  assert.equal(result.lateMinutes, 0)
  assert.equal(result.dailyBalanceMinutes, -3)
})

test('flags incomplete and invalid sequences without inventing an event', () => {
  const result = calculateDay({ events: [{ id: 'a', eventType: 'BREAK_END', occurredAt: '2026-07-18T11:00:00.000Z' }] })
  assert.equal(result.status, 'INCONSISTENT')
  assert.equal(result.inconsistencies[0].code, 'BREAK_END_OUT_OF_ORDER')
})

test('supports an overnight shift using UTC instants', () => {
  const result = calculateDay({
    date: '2026-07-18', schedule: { expectedMinutes: 480 },
    events: [
      { eventType: 'WORK_START', occurredAt: '2026-07-18T22:00:00.000Z' },
      { eventType: 'WORK_END', occurredAt: '2026-07-19T06:00:00.000Z' },
    ],
  })
  assert.equal(result.workedMinutes, 480)
  assert.equal(result.dailyBalanceMinutes, 0)
})

test('accumulates bank balance without changing daily snapshots', () => {
  const result = calculatePeriod({ days: [{ dailyBalanceMinutes: 30 }, { dailyBalanceMinutes: -10 }], openingBalanceMinutes: 20 })
  assert.equal(result.closingBalanceMinutes, 40)
  assert.deepEqual(result.days.map((day) => day.accumulatedBalanceMinutes), [50, 40])
})

test('supports multiple intervals without counting them as worked time', () => {
  const result = calculateDay({
    date: '2026-07-20', rule: { expectedMinutes: 450 },
    events: [
      { eventType: 'WORK_START', occurredAt: '2026-07-20T11:00:00.000Z' },
      { eventType: 'BREAK_START', occurredAt: '2026-07-20T14:00:00.000Z' },
      { eventType: 'BREAK_END', occurredAt: '2026-07-20T14:15:00.000Z' },
      { eventType: 'BREAK_START', occurredAt: '2026-07-20T17:15:00.000Z' },
      { eventType: 'BREAK_END', occurredAt: '2026-07-20T18:00:00.000Z' },
      { eventType: 'WORK_END', occurredAt: '2026-07-20T19:30:00.000Z' },
    ],
  })
  assert.equal(result.workedMinutes, 450)
  assert.equal(result.breakMinutes, 60)
  assert.equal(result.status, 'CALCULATED')
})

test('applies delay, early-leave and overtime tolerances independently', () => {
  const result = calculateDay({
    date: '2026-07-21', rule: { expectedMinutes: 450, lateToleranceMinutes: 5, earlyLeaveToleranceMinutes: 5, overtimeToleranceMinutes: 10 },
    schedule: { expectedMinutes: 450, startAt: '2026-07-21T11:00:00.000Z', endAt: '2026-07-21T18:30:00.000Z' },
    events: [{ eventType: 'WORK_START', occurredAt: '2026-07-21T11:06:00.000Z' }, { eventType: 'WORK_END', occurredAt: '2026-07-21T18:24:00.000Z' }],
  })
  assert.equal(result.lateMinutes, 6)
  assert.equal(result.earlyLeaveMinutes, 6)
  assert.equal(result.overtimeMinutes, 0)
})

test('treats configured holidays and justified absences as zero expected time', () => {
  const holiday = calculateDay({ date: '2026-12-25', holiday: true, rule: { expectedMinutes: 480 } })
  const absence = calculateDay({ date: '2026-07-22', absence: { id: 'leave-1', kind: 'JUSTIFIED' }, rule: { expectedMinutes: 480 } })
  assert.equal(holiday.expectedMinutes, 0); assert.equal(holiday.status, 'HOLIDAY')
  assert.equal(absence.expectedMinutes, 0); assert.equal(absence.status, 'ABSENCE')
})

test('reports missing scheduled work and excessive worked time', () => {
  const missing = calculateDay({ date: '2026-07-23', schedule: { expectedMinutes: 480 } })
  const excessive = calculateDay({ date: '2026-07-24', rule: { expectedMinutes: 480, maxWorkedMinutes: 600 }, events: [{ eventType: 'WORK_START', occurredAt: '2026-07-24T08:00:00.000Z' }, { eventType: 'WORK_END', occurredAt: '2026-07-24T19:00:00.000Z' }] })
  assert.equal(missing.status, 'MISSING')
  assert.equal(excessive.inconsistencies.some((item) => item.code === 'MAX_WORKED_EXCEEDED'), true)
})

test('uses actual instants safely across a daylight-saving transition', () => {
  const result = calculateDay({ date: '2026-11-01', rule: { timeZone: 'America/New_York', expectedMinutes: 180 }, events: [{ eventType: 'WORK_START', occurredAt: '2026-11-01T04:30:00.000Z' }, { eventType: 'WORK_END', occurredAt: '2026-11-01T07:30:00.000Z' }] })
  assert.equal(result.workedMinutes, 180)
  assert.equal(result.dailyBalanceMinutes, 0)
})
