import assert from 'node:assert/strict'
import test from 'node:test'

import { waitForReadySchedulePublicReadHealth } from './scripts/public-read-ready-health.mjs'

function health(status, body = undefined) {
  return {
    status,
    json: async () => body,
  }
}

test('ready staging health retries only transient pre-convergence responses until the ready endpoint is available', async () => {
  let now = 0
  const requestTimeouts = []
  const sleeps = []
  const transientTimeout = Object.assign(new Error('request timed out'), { name: 'TimeoutError' })
  const outcomes = [
    health(404),
    health(503, { ok: false, error: 'SCHEDULE_PUBLIC_READ_UNAVAILABLE' }),
    transientTimeout,
    health(200, { ok: true, ready: true }),
  ]

  const response = await waitForReadySchedulePublicReadHealth({
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

  assert.equal(response.status, 200)
  assert.deepEqual(requestTimeouts, [5_000, 4_000, 3_000, 2_000])
  assert.deepEqual(sleeps, [1_000, 1_000, 1_000])
})

test('ready staging health fails closed when a 503 is not the known disabled contract', async () => {
  let attempts = 0
  let sleeps = 0

  await assert.rejects(
    () => waitForReadySchedulePublicReadHealth({
      request: async () => {
        attempts += 1
        return health(503, { ok: false, error: 'SCHEDULE_PUBLIC_READ_UPSTREAM_UNAVAILABLE' })
      },
      sleep: async () => {
        sleeps += 1
      },
    }),
    /unexpected error code/,
  )

  assert.equal(attempts, 1)
  assert.equal(sleeps, 0)
})

test('ready staging health fails closed without retrying a wrong stable response', async () => {
  let attempts = 0
  let sleeps = 0

  await assert.rejects(
    () => waitForReadySchedulePublicReadHealth({
      request: async () => {
        attempts += 1
        return health(401)
      },
      sleep: async () => {
        sleeps += 1
      },
    }),
    /returned HTTP 401; expected 200/,
  )

  assert.equal(attempts, 1)
  assert.equal(sleeps, 0)
})
