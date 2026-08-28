import assert from 'node:assert/strict'

import {
  SCHEDULE_PUBLIC_READ_CORE_SERVICE,
  createSchedulePublicReadHeaders,
  verifySchedulePublicReadRequest,
} from '../public-read-contract.js'
import adapter from '../public-read-worker.js'

const edgeKey = 'local-only-schedule-public-read-edge-key'
const coreKey = 'local-only-schedule-public-read-core-key'
const path = '/schedule-public-read/v1/availability?unit=novo-hamburgo&date=2026-09-15'

const disabled = await adapter.fetch(new Request('https://adapter.local/health'), {})
assert.equal(disabled.status, 503)

const url = `https://adapter.local${path}`
const headers = await createSchedulePublicReadHeaders({
  secret: edgeKey,
  url,
  nonce: 'schedule-public-read-dry-run-0001',
})
let forwardedPath = ''
const response = await adapter.fetch(new Request(url, { headers }), {
  SCHEDULE_PUBLIC_READ_ENABLED: 'true',
  SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY: edgeKey,
  SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY: coreKey,
  SCHEDULE_CORE: {
    async fetch(request) {
      const authorization = await verifySchedulePublicReadRequest(request, coreKey, {
        allowedService: SCHEDULE_PUBLIC_READ_CORE_SERVICE,
      })
      assert.equal(authorization.ok, true)
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
