import assert from 'node:assert/strict'
import test from 'node:test'

import { waitForDisabledSchedulePublicReadHealth } from './scripts/public-read-disabled-health.mjs'

function health(status, body = undefined) {
  return {
    status,
    json: async () => body,
  }
}

test('disabled staging health retries 404 and transient network delay until the disabled contract converges', async () => {
  let now = 0
  const requestTimeouts = []
  const sleeps = []
  const transientTimeout = Object.assign(new Error('request timed out'), { name: 'TimeoutError' })
  const outcomes = [health(404), transientTimeout, health(503, {
    ok: false,
    error: 'SCHEDULE_PUBLIC_READ_UNAVAILABLE',
  })]

  const response = await waitForDisabledSchedulePublicReadHealth({
    request: async ({ timeoutMs }) => {
      requestTimeouts.push(timeoutMs)
      const outcome = outcomes.shift()
      if (outcome instanceof Error) throw outcome
      return outcome
    },
    now: () => now,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds)
      now += milliseconds
    },
    maxWaitMs: 5_000,
    retryDelayMs: 1_000,
  })

  assert.equal(response.status, 503)
  assert.deepEqual(requestTimeouts, [5_000, 4_000, 3_000])
  assert.deepEqual(sleeps, [1_000, 1_000])
})

test('disabled staging health times out after the bounded transient 404 window', async () => {
  let now = 0
  let attempts = 0
  const sleeps = []

  await assert.rejects(
    () => waitForDisabledSchedulePublicReadHealth({
      request: async () => {
        attempts += 1
        return health(404)
      },
      now: () => now,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds)
        now += milliseconds
      },
      maxWaitMs: 2_500,
      retryDelayMs: 1_000,
    }),
    /did not converge to 503 within 2500ms after 3 attempts \(last transient: HTTP 404\)/,
  )

  assert.equal(attempts, 3)
  assert.deepEqual(sleeps, [1_000, 1_000, 500])
})

test('disabled staging health fails closed without retrying a wrong response', async () => {
  let attempts = 0
  let sleeps = 0

  await assert.rejects(
    () => waitForDisabledSchedulePublicReadHealth({
      request: async () => {
        attempts += 1
        return health(200, { ok: true })
      },
      sleep: async () => {
        sleeps += 1
      },
      maxWaitMs: 5_000,
      retryDelayMs: 1_000,
    }),
    /returned HTTP 200; expected 503/,
  )

  assert.equal(attempts, 1)
  assert.equal(sleeps, 0)
})

test('disabled staging health fails closed when a 503 does not satisfy the disabled contract', async () => {
  let attempts = 0
  let sleeps = 0

  await assert.rejects(
    () => waitForDisabledSchedulePublicReadHealth({
      request: async () => {
        attempts += 1
        return health(503, { ok: true })
      },
      sleep: async () => {
        sleeps += 1
      },
      maxWaitMs: 5_000,
      retryDelayMs: 1_000,
    }),
    /must return ok=false/,
  )

  assert.equal(attempts, 1)
  assert.equal(sleeps, 0)
})
