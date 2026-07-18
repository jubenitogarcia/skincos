import assert from 'node:assert/strict'
import test from 'node:test'
import worker from './worker.js'

test('health is public and does not disclose secrets', async () => {
  const response = await worker.fetch(new Request('https://timekeeping.local/api/ponto/health'), { APP_VERSION: 'test', DB: {} })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.service, 'workforce-timekeeping')
  assert.equal(JSON.stringify(body).includes('PONTO_'), false)
})

test('readiness fails closed when D1 is unavailable', async () => {
  const response = await worker.fetch(new Request('https://timekeeping.local/api/ponto/readiness'), {})
  assert.equal(response.status, 503)
  assert.equal((await response.json()).code, 'DATABASE_UNAVAILABLE')
})
