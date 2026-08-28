import assert from 'node:assert/strict'

import { createSchedulePublicReadHeaders } from '../public-read-contract.js'
import adapter from '../public-read-worker.js'

const key = 'local-only-schedule-public-read-dry-run-key'
const path = '/schedule-public-read/v1/availability?unit=novo-hamburgo&date=2026-09-15'

const disabled = await adapter.fetch(new Request('https://adapter.local/health'), {})
assert.equal(disabled.status, 503)

const url = `https://adapter.local${path}`
const headers = await createSchedulePublicReadHeaders({
  secret: key,
  url,
  nonce: 'schedule-public-read-dry-run-0001',
})
let forwardedPath = ''
const response = await adapter.fetch(new Request(url, { headers }), {
  SCHEDULE_PUBLIC_READ_ENABLED: 'true',
  SCHEDULE_PUBLIC_READ_HMAC_KEY: key,
  SCHEDULE_CORE: {
    async fetch(request) {
      forwardedPath = `${new URL(request.url).pathname}${new URL(request.url).search}`
      return Response.json({
        ok: true,
        contract: 'schedule-public-read/v1',
        data: { unit: 'novohamburgo', date: '2026-09-15', closed: false, professionalNames: [] },
      })
    },
  },
})
assert.equal(response.status, 200)
assert.equal(forwardedPath, '/api/escala/internal/schedule-public-read/v1/availability?unit=novo-hamburgo&date=2026-09-15')
assert.equal((await response.json()).contract, 'schedule-public-read/v1')

console.log(JSON.stringify({
  ok: true,
  mode: 'local-only',
  defaultDisabledStatus: disabled.status,
  authenticatedForwardStatus: response.status,
  forwardedPath,
}))
