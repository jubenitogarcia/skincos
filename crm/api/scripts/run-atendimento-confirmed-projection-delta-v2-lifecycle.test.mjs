import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

test('keeps the v5 lifecycle explicit, production-source-only, and delivery-free', async () => {
  const path = fileURLToPath(new URL('./run-atendimento-confirmed-projection-delta-v2-lifecycle.mjs', import.meta.url))
  const source = await readFile(path, 'utf8')
  for (const action of ['--prepare', '--load', '--accept', '--ready', '--reconcile']) assert.match(source, new RegExp(action.replace(/-/g, '\\-')))
  assert.match(source, /--controlled-production-source/)
  assert.match(source, /--target=production/)
  assert.match(source, /ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_HMAC_KEY/)
  assert.match(source, /prepareConfirmedProjectionDeltaV2Baseline/)
  assert.match(source, /loadConfirmedProjectionDeltaV2BaselineCustody/)
  assert.match(source, /acceptConfirmedProjectionDeltaV2Baseline/)
  assert.match(source, /markConfirmedProjectionDeltaV2Ready/)
  assert.match(source, /reconcileConfirmedProjectionDeltaV2/)
  assert.doesNotMatch(source, /(?:fetch\(|wrangler|cloudflare|transport\.deliver)/i)
})
