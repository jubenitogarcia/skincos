import assert from 'node:assert/strict'

import {
  SCHEDULE_PUBLIC_READ_CONTRACT_VERSION,
  SCHEDULE_PUBLIC_READ_CORE_SERVICE,
  createSchedulePublicReadHeaders,
  normalizeSchedulePublicReadSecret,
} from '../public-read-contract.js'

const allowedOrigin = 'https://escala-api-staging.skincos.com.br'
const mode = String(process.env.SCHEDULE_PUBLIC_READ_CORE_SMOKE_MODE || 'ready').trim()
const configuredOrigin = String(process.env.SCHEDULE_PUBLIC_READ_CORE_SMOKE_BASE_URL || allowedOrigin).replace(/\/+$/, '')
const readinessPath = '/api/escala/internal/schedule-public-read/v1/readiness'

if (!['ready', 'disabled'].includes(mode)) throw new Error('SCHEDULE_PUBLIC_READ_CORE_SMOKE_MODE must be ready or disabled')
if (configuredOrigin !== allowedOrigin) throw new Error('Schedule public-read core smoke is pinned to the isolated Escala staging origin')

async function request(init = {}) {
  return fetch(`${configuredOrigin}${readinessPath}`, {
    ...init,
    signal: AbortSignal.timeout(15_000),
  })
}

async function json(response, label) {
  const body = await response.json().catch(() => null)
  assert.ok(body && typeof body === 'object', `${label} must return JSON`)
  return body
}

if (mode === 'disabled') {
  const response = await request()
  assert.equal(response.status, 503)
  const body = await json(response, 'disabled core readiness')
  assert.equal(body.ok, false)
  assert.equal(body.error, 'SCHEDULE_PUBLIC_READ_UNAVAILABLE')
  console.log(JSON.stringify({ ok: true, mode, readinessStatus: response.status }))
  process.exit(0)
}

const coreKey = normalizeSchedulePublicReadSecret(process.env.SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY)
if (!coreKey) throw new Error('SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY is required for the core staging smoke')

const readinessUrl = `${configuredOrigin}${readinessPath}`
const headers = await createSchedulePublicReadHeaders({
  secret: coreKey,
  url: readinessUrl,
  service: SCHEDULE_PUBLIC_READ_CORE_SERVICE,
  nonce: `schedule-public-read-core-staging-${crypto.randomUUID()}`,
})
const response = await request({ headers })
assert.equal(response.status, 200)
assert.equal(response.headers.get('x-skincos-schedule-public-read-contract'), SCHEDULE_PUBLIC_READ_CONTRACT_VERSION)
const body = await json(response, 'core readiness')
assert.equal(body.ok, true)
assert.equal(body.contract, SCHEDULE_PUBLIC_READ_CONTRACT_VERSION)
assert.equal(body.ready, true)

console.log(JSON.stringify({ ok: true, mode, readinessStatus: response.status }))
