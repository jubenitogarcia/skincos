import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { manifestFromEnv, PRODUCTION_RESOURCES } from './public-read-production-manifest.mjs'
import { lifecycleConfigDigest } from './public-read-bootstrap-evidence.mjs'
import { boundedProductionJson } from './public-read-production-http.mjs'

export function lifecycleDigest() {
  return lifecycleConfigDigest(readFileSync(new URL('../public-read.wrangler.toml', import.meta.url), 'utf8'))
}
export function assertReleaseWindow(manifest, now = Date.now()) {
  // Each production publication job is bounded to at most 20 minutes; retain
  // another 15 minutes for cancellation/fallback/cleanup while its runner lives.
  const remaining = Date.parse(manifest.expiresAt) - now
  if (!Number.isFinite(remaining) || remaining < 35 * 60_000) throw new Error('production_release_window_too_short')
}
export function assertDurableDisableProof(deployment, version, { sourceSha, configDigest = lifecycleDigest() }) {
  const bindings = version?.resources?.bindings || []
  const value = name => bindings.find(item => item.type === 'plain_text' && item.name === name)?.text
  const message = deployment?.annotations?.['workers/message'] || version?.annotations?.['workers/message']
  const match = /^schedule-public-read-adapter:production(?:-bootstrap-disabled|-disabled)?:([a-f0-9]{40}):([1-9][0-9]*)$/.exec(message || '')
  if (!match || match[1] !== sourceSha || deployment?.versions?.length !== 1 || deployment.versions[0].percentage !== 100
    || deployment.versions[0].version_id !== version?.id || value('SCHEDULE_PUBLIC_READ_SOURCE_SHA') !== sourceSha
    || value('SCHEDULE_PUBLIC_READ_LIFECYCLE_SHA256') !== configDigest
    || !['true', 'false'].includes(value('SCHEDULE_PUBLIC_READ_ENABLED'))
    || bindings.some(item => item.type === 'd1')
    || !bindings.some(item => item.name === 'SCHEDULE_CORE' && item.type === 'service' && item.service === PRODUCTION_RESOURCES.coreWorker)
    || !bindings.some(item => item.name === 'SCHEDULE_PUBLIC_READ_NONCE_GUARD' && item.type === 'durable_object_namespace'
      && item.class_name === 'SchedulePublicReadNonceGuard' && typeof item.namespace_id === 'string' && item.namespace_id.length > 0)) {
    throw new Error('production_durable_disable_proof_invalid')
  }
  return { sourceSha, configDigest, predecessorRunId: match[2], versionId: version.id }
}
async function main() {
  const operation = process.argv[2]
  if (operation === 'lifecycle') {
    console.log(`SCHEDULE_PUBLIC_READ_LIFECYCLE_SHA256=${lifecycleDigest()}`)
    return
  }
  const manifest = manifestFromEnv()
  if (operation === 'window') { assertReleaseWindow(manifest); console.log('{"ok":true,"releaseWindowVerified":true}'); return }
  if (operation !== 'disable' || !/^[1-9][0-9]*$/.test(process.env.GITHUB_RUN_ID || '')
    || !process.env.RUNNER_TEMP || !process.env.CLOUDFLARE_API_TOKEN) throw new Error('production_disable_input_invalid')
  const path = `/accounts/${manifest.accountId}/workers/scripts/${PRODUCTION_RESOURCES.adapterWorker}`
  const api = async suffix => {
    const response = await fetch(`https://api.cloudflare.com/client/v4${path}${suffix}`, {
      headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` }, redirect: 'error', signal: AbortSignal.timeout(15_000),
    })
    const body = await boundedProductionJson(response)
    if (!response.ok || body?.success !== true) throw new Error('production_disable_readback_failed')
    return body.result
  }
  const state = await api('/deployments')
  const deployment = state?.deployments?.[0]
  const id = deployment?.versions?.[0]?.version_id
  if (!/^[a-f0-9-]{36}$/.test(id || '')) throw new Error('production_disable_version_invalid')
  const proof = assertDurableDisableProof(deployment, await api(`/versions/${id}`), { sourceSha: manifest.sourceSha })
  const domain = await api('/subdomain')
  if (domain?.enabled !== false || domain?.previews_enabled !== false) throw new Error('production_disable_private_surface_invalid')
  writeFileSync(join(process.env.RUNNER_TEMP, 'schedule-production-durable-disable-proof.json'), JSON.stringify({
    contract: 'schedule-public-read-durable-disable-proof/v1', runId: process.env.GITHUB_RUN_ID, worker: PRODUCTION_RESOURCES.adapterWorker, ...proof,
  }), { mode: 0o600, flag: 'wx' })
  console.log('{"ok":true,"durableDisableProofVerified":true}')
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main() } catch { console.error('schedule_production_release_guard_failed'); process.exitCode = 1 }
}
