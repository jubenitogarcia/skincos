import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { manifestFromEnv, PRODUCTION_RESOURCES, assertProbeOwnership, assertProductionReadback } from './public-read-production-manifest.mjs'
import { boundedProductionJson } from './public-read-production-http.mjs'

async function main() {
  const operation = process.argv[2]
  const manifest = manifestFromEnv()
  const runId = process.env.GITHUB_RUN_ID
  if (!/^[1-9][0-9]*$/.test(runId || '') || !process.env.CLOUDFLARE_API_TOKEN || !process.env.RUNNER_TEMP) throw new Error('probe_operator_identity_invalid')
  const marker = join(process.env.RUNNER_TEMP, 'schedule-production-probe-ownership.json')
  const surface = process.argv[3]
  const mode = process.argv[4]
  const resourceOperations = new Set(['checkpoint', 'readback'])
  if (resourceOperations.has(operation) && !['adapter', 'core'].includes(surface)) throw new Error('production_surface_invalid')
  const worker = resourceOperations.has(operation) ? PRODUCTION_RESOURCES[`${surface}Worker`] : PRODUCTION_RESOURCES.probeWorker
  const path = `/accounts/${manifest.accountId}/workers/scripts/${worker}`
  async function api(suffix, method = 'GET', absentAllowed = false) {
    const response = await fetch(`https://api.cloudflare.com/client/v4${path}${suffix}`, {
      method, headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` }, signal: AbortSignal.timeout(15_000), redirect: 'error',
    })
    if (response.status === 404 && absentAllowed) return null
    const body = await boundedProductionJson(response)
    if (!response.ok || body?.success !== true) throw new Error('probe_resource_operation_failed')
    return body.result
  }
  async function currentVersion(state) {
    const versionId = state?.deployments?.[0]?.versions?.[0]?.version_id
    if (!/^[0-9a-f-]{36}$/.test(versionId || '')) throw new Error('production_version_invalid')
    return api(`/versions/${versionId}`)
  }
  if (operation === 'checkpoint') {
    const state = await api('/deployments', 'GET', true)
    const versions = state?.deployments?.[0]?.versions || []
    const safe = { contract: 'schedule-production-resource-checkpoint/v1', sourceSha: manifest.sourceSha, runId, worker,
      existed: state !== null, deploymentId: state?.deployments?.[0]?.id || null,
      versions: versions.map(item => ({ versionId: item.version_id, percentage: item.percentage })) }
    writeFileSync(join(process.env.RUNNER_TEMP, `schedule-production-${surface}-checkpoint.json`), JSON.stringify(safe), { mode: 0o600, flag: 'wx' })
    console.log('{"ok":true,"checkpointRecorded":true}')
    return
  }
  if (operation === 'readback') {
    if (!['ready', 'disabled', 'bootstrap-disabled'].includes(mode)) throw new Error('production_mode_invalid')
    const state = await api('/deployments')
    const version = await currentVersion(state)
    assertProductionReadback(state.deployments?.[0], version, { surface, mode, sourceSha: manifest.sourceSha, runId })
    if (surface === 'adapter') {
      const domain = await api('/subdomain')
      if (domain?.enabled !== false || domain?.previews_enabled !== false) throw new Error('production_adapter_not_private')
    }
    writeFileSync(join(process.env.RUNNER_TEMP, `schedule-production-${surface}-${mode}-readback.json`), JSON.stringify({
      contract: 'schedule-production-resource-readback/v1', sourceSha: manifest.sourceSha, runId, worker, mode,
      versionId: version.id, deploymentId: state.deployments[0].id, privateAdapter: surface === 'adapter',
    }), { mode: 0o600, flag: 'wx' })
    console.log('{"ok":true,"resourceReadback":true}')
    return
  }
  if (operation === 'prepare') {
    if (await api('/settings', 'GET', true) !== null) throw new Error('probe_resource_already_exists')
    writeFileSync(marker, JSON.stringify({ sourceSha: manifest.sourceSha, runId }), { mode: 0o600, flag: 'wx' })
    // An interrupted creation can be reconciled only against this exact run.
    console.log('{"ok":true,"probeAbsent":true}')
    return
  }
  if (operation !== 'cleanup') throw new Error('probe_operation_invalid')
  const owner = JSON.parse(readFileSync(marker, 'utf8'))
  if (owner.sourceSha !== manifest.sourceSha || owner.runId !== runId) throw new Error('probe_marker_invalid')
  const state = await api('/deployments', 'GET', true)
  if (state !== null) {
    assertProbeOwnership(state.deployments?.[0], owner, await currentVersion(state))
    await api('', 'DELETE')
  }
  if (await api('/settings', 'GET', true) !== null) throw new Error('probe_cleanup_readback_failed')
  writeFileSync(join(process.env.RUNNER_TEMP, 'schedule-production-probe-cleanup.json'), JSON.stringify({
    contract: 'schedule-production-probe-cleanup/v1', sourceSha: manifest.sourceSha, runId, worker, removed: true,
  }), { mode: 0o600, flag: 'wx' })
  console.log('{"ok":true,"probeRemoved":true,"cleanupReadback":true}')
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main() } catch { console.error('schedule_production_probe_resource_failed'); process.exitCode = 1 }
}
