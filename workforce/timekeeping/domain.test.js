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
