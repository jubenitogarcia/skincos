import assert from 'node:assert/strict'

import {
  SCHEDULE_PUBLIC_READ_CONTRACT_VERSION,
  createSchedulePublicReadHeaders,
  normalizeSchedulePublicReadSecret,
} from '../public-read-contract.js'
import { waitForDisabledSchedulePublicReadHealth } from './public-read-disabled-health.mjs'
import { waitForReadySchedulePublicReadHealth } from './public-read-ready-health.mjs'

const allowedOrigin = 'https://skincos-schedule-public-read-staging.skincos.workers.dev'
const mode = String(process.env.SCHEDULE_PUBLIC_READ_SMOKE_MODE || 'ready').trim()
const configuredOrigin = String(process.env.SCHEDULE_PUBLIC_READ_SMOKE_BASE_URL || allowedOrigin).replace(/\/+$/, '')

if (!['ready', 'disabled'].includes(mode)) throw new Error('SCHEDULE_PUBLIC_READ_SMOKE_MODE must be ready or disabled')
if (configuredOrigin !== allowedOrigin) throw new Error('Schedule public-read smoke is pinned to the isolated staging workers.dev origin')

async function request(path, init = {}, timeoutMs = 15_000) {
  return fetch(`${configuredOrigin}${path}`, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  })
}

async function json(response, label) {
  const body = await response.json().catch(() => null)
  assert.ok(body && typeof body === 'object', `${label} must return JSON`)
  return body
}

if (mode === 'disabled') {
  const response = await waitForDisabledSchedulePublicReadHealth({
    request: ({ timeoutMs }) => request('/health', {}, timeoutMs),
  })
  console.log(JSON.stringify({ ok: true, mode, healthStatus: response.status }))
  process.exit(0)
}

const edgeKey = normalizeSchedulePublicReadSecret(process.env.SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY)
if (!edgeKey) throw new Error('SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY is required for the staging smoke')

const health = await waitForReadySchedulePublicReadHealth({
  request: ({ timeoutMs }) => request('/health', {}, timeoutMs),
})
const healthBody = await json(health, 'health')
assert.equal(healthBody.ok, true)
assert.equal(healthBody.contract, SCHEDULE_PUBLIC_READ_CONTRACT_VERSION)
assert.equal(healthBody.ready, true)

const readinessUrl = `${configuredOrigin}/schedule-public-read/v1/readiness`
const headers = await createSchedulePublicReadHeaders({
  secret: edgeKey,
  url: readinessUrl,
  nonce: `schedule-public-read-staging-${crypto.randomUUID()}`,
})
const readiness = await request('/schedule-public-read/v1/readiness', { headers })
assert.equal(readiness.status, 200)
assert.equal(readiness.headers.get('x-skincos-schedule-public-read-contract'), SCHEDULE_PUBLIC_READ_CONTRACT_VERSION)
const readinessBody = await json(readiness, 'readiness')
assert.equal(readinessBody.ok, true)
assert.equal(readinessBody.contract, SCHEDULE_PUBLIC_READ_CONTRACT_VERSION)
assert.equal(readinessBody.ready, true)

const replay = await request('/schedule-public-read/v1/readiness', { headers })
assert.equal(replay.status, 409)
const replayBody = await json(replay, 'replay')
assert.equal(replayBody.error, 'SCHEDULE_PUBLIC_READ_REPLAYED')

const unsigned = await request('/schedule-public-read/v1/readiness')
assert.equal(unsigned.status, 401)
const unsignedBody = await json(unsigned, 'unsigned request')
assert.equal(unsignedBody.error, 'SCHEDULE_PUBLIC_READ_UNAUTHORIZED')

console.log(JSON.stringify({
  ok: true,
  mode,
  healthStatus: health.status,
  readinessStatus: readiness.status,
  replayStatus: replay.status,
  unsignedStatus: unsigned.status,
}))
