import test from 'node:test'
import assert from 'node:assert/strict'
import { DateTime } from 'luxon'
import { isWithinWorkingHours, defaultWorkingHoursForUnitSlug } from '../util/workingHours.js'

test('working hours: open within window', () => {
    const workingHours = defaultWorkingHoursForUnitSlug('novo_hamburgo')
    const now = DateTime.fromISO('2026-02-04T10:00:00', { zone: 'America/Sao_Paulo' }).toUTC().toISO()
    const out = isWithinWorkingHours({ workingHours, timezone: 'America/Sao_Paulo', now })
    assert.equal(out.open, true)
    assert.equal(out.nextOpenAt, null)
})

test('working hours: closed finds next opening', () => {
    const workingHours = defaultWorkingHoursForUnitSlug('novo_hamburgo')
    const now = DateTime.fromISO('2026-02-01T01:00:00', { zone: 'America/Sao_Paulo' }).toUTC().toISO()
    const out = isWithinWorkingHours({ workingHours, timezone: 'America/Sao_Paulo', now })
    assert.equal(out.open, false)
    assert.ok(out.nextOpenAt)
})

