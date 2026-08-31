import assert from 'node:assert/strict'
import test from 'node:test'

import { SchedulePublicReadNonceGuard } from './public-read-nonce-guard.js'

function createState() {
  const entries = new Map()
  let alarmAt = null
  return {
    storage: {
      async get(key) { return entries.get(key) },
      async put(key, value) { entries.set(key, value) },
      async delete(key) { entries.delete(key) },
      async setAlarm(value) { alarmAt = value },
    },
    snapshot() { return { entries: new Map(entries), alarmAt } },
  }
}

test('nonce guard consumes an authenticated nonce once and removes it after its alarm', async () => {
  const state = createState()
  const guard = new SchedulePublicReadNonceGuard(state)
  const now = Date.now()
  const expiresAt = now + 60_000

  assert.deepEqual(await guard.consume({ expiresAt, now }), { ok: true })
  assert.deepEqual(await guard.consume({ expiresAt, now: now + 1 }), { ok: false, code: 'REPLAYED' })
  assert.equal(state.snapshot().alarmAt, expiresAt)

  await guard.alarm()
  assert.deepEqual(await guard.consume({ expiresAt: now + 120_000, now: now + 60_001 }), { ok: true })
})

test('nonce guard refuses malformed or unbounded expiries without retaining state', async () => {
  const state = createState()
  const guard = new SchedulePublicReadNonceGuard(state)
  const now = Date.now()

  for (const expiresAt of [undefined, now, now - 1, now + (16 * 60 * 1000), 'not-a-number']) {
    assert.deepEqual(await guard.consume({ expiresAt, now }), { ok: false, code: 'INVALID_EXPIRY' })
  }
  assert.equal(state.snapshot().entries.size, 0)
})
