import { createSchedulePublicReadHeaders } from '../public-read-contract.js'
import { PROBE_CONTRACT, PROBE_SERVICE } from '../public-read-production-probe.js'
import { manifestFromEnv } from './public-read-production-manifest.mjs'
import { boundedProductionJson } from './public-read-production-http.mjs'

const manifest = manifestFromEnv()
const mode = process.env.SCHEDULE_PUBLIC_READ_SMOKE_MODE || 'ready'
if (!['ready', 'disabled'].includes(mode)) throw new Error('probe_mode_invalid')
const secret = String(process.env.SCHEDULE_PUBLIC_READ_PROBE_HMAC_KEY || '').trim()
if (secret.length < 32) throw new Error('probe_custody_missing')
const url = `${manifest.probeOrigin}/verify/${mode}`
let passed = false
for (let attempt = 0; attempt < 5 && !passed; attempt++) {
  try {
    const headers = await createSchedulePublicReadHeaders({ secret, url, service: PROBE_SERVICE })
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000), redirect: 'error' })
    const body = await boundedProductionJson(response, 2048)
    const expectedChecks = mode === 'disabled' ? { disabled: true } : {
      readiness: true, replayRejected: true, unsignedRejected: true, invalidHmacRejected: true,
    }
    const expected = { ok: true, contract: PROBE_CONTRACT, sourceSha: manifest.sourceSha, mode, checks: expectedChecks }
    passed = response.status === 200 && JSON.stringify(body) === JSON.stringify(expected)
  } catch { passed = false }
  if (!passed && attempt < 4) await new Promise(resolve => setTimeout(resolve, 2000))
}
if (!passed) throw new Error('schedule_production_probe_smoke_failed')
console.log(JSON.stringify({ ok: true, mode, authenticatedPrivateSmoke: true }))
