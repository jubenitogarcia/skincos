import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const PRODUCTION_RESOURCES = Object.freeze({
  adapterWorker: 'skincos-schedule-public-read',
  coreWorker: 'skincos-escala-api',
  probeWorker: 'skincos-schedule-public-read-probe-staging',
  probeOrigin: 'https://skincos-schedule-public-read-probe-staging.skincos.workers.dev',
})
export function assertProbeOwnership(deployment, { sourceSha, runId }, version = null) {
  const message = deployment?.annotations?.['workers/message'] || version?.annotations?.['workers/message']
  if (message !== `schedule-public-read-probe:${sourceSha}:${runId}`
    || deployment.versions?.length !== 1 || deployment.versions[0].percentage !== 100
    || (version && version.id !== deployment.versions[0].version_id)) throw new Error('probe_ownership_not_verified')
}
export function assertProductionReadback(deployment, version, { surface, mode, sourceSha, runId }) {
  const prefix = surface === 'core' ? `escala-api:production-schedule-public-read${mode === 'disabled' ? '-disabled' : ''}`
    : `schedule-public-read-adapter:production${mode === 'bootstrap-disabled' ? '-bootstrap-disabled' : mode === 'disabled' ? '-disabled' : ''}`
  const message = deployment?.annotations?.['workers/message'] || version?.annotations?.['workers/message']
  const flag = version?.resources?.bindings?.find(binding => binding.name === 'SCHEDULE_PUBLIC_READ_ENABLED')
  if (message !== `${prefix}:${sourceSha}:${runId}` || deployment.versions?.length !== 1 || deployment.versions[0].percentage !== 100
    || version?.id !== deployment.versions[0].version_id || flag?.type !== 'plain_text'
    || flag.text !== String(mode === 'ready')) throw new Error('production_readback_invalid')
  if (surface === 'adapter') {
    const bindings = version.resources.bindings
    if (bindings.some(binding => binding.type === 'd1') || !bindings.some(binding => binding.name === 'SCHEDULE_CORE' && binding.type === 'service'
      && binding.service === PRODUCTION_RESOURCES.coreWorker)) throw new Error('production_readback_invalid')
  }
}
export function productionConfigDigest() {
  const files = ['../public-read.wrangler.toml', '../public-read-production-probe.wrangler.toml', '../public-read-production-probe.js']
  const hash = createHash('sha256')
  for (const path of files) hash.update(path).update('\0').update(readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')).update('\0')
  return hash.digest('hex')
}
export function validateProductionManifest(raw, { sourceSha, accountId, expectedDigest, configDigest = productionConfigDigest(), now = Date.now() }) {
  const fail = () => { throw new Error('schedule_production_manifest_invalid') }
  if (typeof raw !== 'string' || raw.length > 4096 || !/^[0-9a-f]{64}$/.test(expectedDigest || '')
    || createHash('sha256').update(raw).digest('hex') !== expectedDigest) fail()
  let document
  try { document = JSON.parse(raw) } catch { fail() }
  const expected = {
    contract: 'schedule-public-read-production-manifest/v1', sourceSha, accountId, configDigest, ...PRODUCTION_RESOURCES,
    probeLifetimeSeconds: 1800,
  }
  if (!/^[0-9a-f]{40}$/.test(sourceSha || '') || !/^[0-9a-f]{32}$/.test(accountId || '')) fail()
  if (!document || Object.keys(document).length !== Object.keys(expected).length + 1) fail()
  for (const [key, value] of Object.entries(expected)) if (document[key] !== value) fail()
  const expiresAt = Date.parse(document.expiresAt)
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + 24 * 60 * 60_000) fail()
  return Object.freeze({ ...document })
}
export function manifestFromEnv(env = process.env) {
  return validateProductionManifest(env.SCHEDULE_PUBLIC_READ_PRODUCTION_MANIFEST, {
    sourceSha: env.RELEASE_SHA, accountId: env.CLOUDFLARE_ACCOUNT_ID,
    expectedDigest: env.PRODUCTION_MANIFEST_SHA256,
  })
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === 'config-digest') process.stdout.write(productionConfigDigest())
  else { manifestFromEnv(); console.log('{"ok":true,"manifestVerified":true}') }
}
