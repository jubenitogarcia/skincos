#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { assertNativeSource, createNativeAuthority, nativeResource } from './public-read-native-authority.mjs'
import { assertNativeVersion, nativeConfigDigest, nativeDigest, nativeMessage, NATIVE_UUID, validateNativeManifest, snapshotNativeData,
  NATIVE_MANIFEST_CONTRACT, NATIVE_RESOURCES, NATIVE_WRANGLER_VERSION } from './public-read-native-manifest.mjs'
import { assertPrivateDirectory, createNativeJournal, readNativePredecessor, readPrivateJson } from './public-read-native-receipts.mjs'
import { createNativeTransport, resolveNativeWrangler, runNativeProcess } from './public-read-native-http.mjs'
import { createSchedulePublicReadHeaders } from '../public-read-contract.js'
import { boundedProductionJson } from './public-read-production-http.mjs'

const ROOT = path.resolve(import.meta.dirname, '../../..')
const fail = code => { throw new Error(code) }
const OPERATIONS = ['preflight', 'core-enable', 'core-disable', 'adapter-bootstrap-disabled', 'adapter-enable', 'adapter-disable', 'reconcile-probe']
const CORE_CONFIG = 'workforce/schedule/wrangler.toml'
const ADAPTER_CONFIG = 'workforce/schedule/public-read.wrangler.toml'
const PROBE_CONFIG = 'workforce/schedule/public-read-production-probe.wrangler.toml'
const sha256Pattern = /^[a-f0-9]{64}$/

export function prepareNativeManifest({ sourceSha, receiptDirectory }) {
  const source = assertNativeSource(sourceSha)
  assertPrivateDirectory(receiptDirectory, ROOT)
  const now = Date.now()
  const manifest = { contract: NATIVE_MANIFEST_CONTRACT, ...source, configDigest: nativeConfigDigest(), ...NATIVE_RESOURCES,
    wranglerVersion: NATIVE_WRANGLER_VERSION, probeLifetimeSeconds: 1800, releaseId: randomUUID(),
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 60 * 60_000).toISOString() }
  const raw = JSON.stringify(manifest) + '\n', digest = nativeDigest(raw)
  validateNativeManifest(raw, { ...source, configDigest: manifest.configDigest, expectedDigest: digest, now, starting: true })
  const file = path.join(receiptDirectory, `${manifest.releaseId}-manifest.json`)
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600)
  try { fs.writeFileSync(fd, raw); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  const directoryFd = fs.openSync(receiptDirectory, fs.constants.O_RDONLY)
  try { fs.fsyncSync(directoryFd) } finally { fs.closeSync(directoryFd) }
  return Object.freeze({ ok: true, contract: manifest.contract, sourceSha, releaseId: manifest.releaseId, manifestFile: file,
    manifestDigest: digest, expiresAt: manifest.expiresAt, remoteMutations: 0 })
}

function readCapabilities() {
  const directory = '/etc/skincos/schedule-public-read'
  const parent = fs.lstatSync(directory)
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== 0 || (parent.mode & 0o777) !== 0o750
    || fs.realpathSync(directory) !== directory) fail('schedule_native_capabilities_unavailable')
  const { data } = readPrivateJson(`${directory}/native-capabilities.json`, { maxBytes: 8192, mode: 0o640, uid: 0 })
  const names = ['SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY', 'SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY', 'SCHEDULE_PUBLIC_READ_PROBE_HMAC_KEY']
  if (Object.keys(data).length !== names.length || names.some(name => !sha256Pattern.test(data[name] ?? ''))
    || new Set(names.map(name => data[name])).size !== names.length) fail('schedule_native_capabilities_unavailable')
  return data
}

function bundleDigest(directory) {
  const items = []
  const walk = (base, relative = '') => {
    for (const name of fs.readdirSync(base).sort()) {
      const file = path.join(base, name), item = relative ? `${relative}/${name}` : name
      const info = fs.lstatSync(file)
      if (info.isSymbolicLink() || items.length > 200 || info.size > 32 * 1024 * 1024) fail('schedule_native_build_invalid')
      if (info.isDirectory()) walk(file, item)
      else if (info.isFile()) items.push({ path: item, bytes: info.size, digest: nativeDigest(fs.readFileSync(file)) })
      else fail('schedule_native_build_invalid')
    }
  }
  walk(directory)
  if (!items.length) fail('schedule_native_build_invalid')
  return { digest: nativeDigest(JSON.stringify(items)), files: items.length, bytes: items.reduce((sum, item) => sum + item.bytes, 0) }
}

// These are actual local commands, not manufactured GitHub status/check IDs.
// Every mutating invocation recomputes this preflight under the clean source.
export async function nativePreflight({ manifest, cliFile, journal, recovery = false }) {
  assertNativeSource(manifest.sourceSha)
  const cli = resolveNativeWrangler(cliFile)
  const version = await runNativeProcess([cli, '--version'], { cwd: ROOT, timeoutMs: 30000, maxBytes: 32768 })
  if (!version.stdout.trim().split(/\r?\n/).some(line => line.trim() === manifest.wranglerVersion)) fail('schedule_native_toolchain_invalid')
  execFileSync('git', ['-C', ROOT, 'diff', '--check', manifest.sourceSha], { timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] })
  const tests = fs.readdirSync(path.join(ROOT, 'workforce/schedule')).filter(file => /^public-read.*\.test\.js$/.test(file)).sort()
    .map(file => `workforce/schedule/${file}`)
  if (!tests.includes('workforce/schedule/public-read-projection.test.js') || tests.length < 10) fail('schedule_native_test_scope_invalid')
  tests.push('workforce/schedule/scripts/public-read-native-release.test.mjs', '.github/scripts/validate-cloudflare-single-writer.test.mjs')
  await runNativeProcess(['--test', '--test-concurrency=1', ...tests], { cwd: ROOT, timeoutMs: 180000, maxBytes: 4 * 1024 * 1024 })
  await runNativeProcess(['.github/scripts/validate-cloudflare-single-writer.mjs'], { cwd: ROOT, timeoutMs: 60000 })
  const builds = []
  for (const [surface, config] of [['core', CORE_CONFIG], ['adapter', ADAPTER_CONFIG], ['probe', PROBE_CONFIG]]) {
    const output = path.join(journal.operationRoot, `${surface}-dry-run`)
    fs.mkdirSync(output, { mode: 0o700 })
    await runNativeProcess([cli, 'deploy', '--dry-run', '--config', config, '--outdir', output], { cwd: ROOT, timeoutMs: 120000 })
    builds.push({ surface, ...bundleDigest(output) })
  }
  assertNativeSource(manifest.sourceSha)
  if (nativeConfigDigest() !== manifest.configDigest || !recovery && Date.parse(manifest.expiresAt) <= Date.now()) fail('schedule_native_source_changed')
  return journal.append('preflight-passed', { checks: { diffCheck: true, focalValidation: true, singleWriterPolicy: true,
    rollbackPlan: 'disable-native-version-before-website-accepted-writes', exceptionalStop: 'unknown-mutation-no-retry' },
    testFiles: tests, builds, wranglerVersion: manifest.wranglerVersion })
}

async function currentVersion(transport, manifest, worker, allowMissing = false) {
  const base = `/accounts/${manifest.accountId}/workers/scripts/${worker}`
  const settings = await transport.get(`${base}/settings`, { allowMissing })
  if (settings === null) return null
  const deployments = await transport.get(`${base}/deployments`)
  const deployment = deployments?.deployments?.[0]
  if (!deployment || deployment.versions?.length !== 1 || deployment.versions[0].percentage !== 100
    || !NATIVE_UUID.test(deployment.versions[0].version_id ?? '')) fail('schedule_native_live_version_invalid')
  const version = await transport.get(`${base}/versions/${deployment.versions[0].version_id}`)
  const subdomain = await transport.get(`${base}/subdomain`)
  return { deployment, version, subdomain }
}

async function readback(transport, manifest, surface, mode, options = {}) {
  const worker = manifest[`${surface}Worker`]
  const state = await currentVersion(transport, manifest, worker)
  const identity = assertNativeVersion(state.deployment, state.version, { manifest, surface, mode, ...options })
  if (surface === 'adapter') {
    if (state.subdomain?.enabled !== false || state.subdomain?.previews_enabled !== false) fail('schedule_native_adapter_not_private')
    await transport.privateAdapter()
  } else if (surface === 'probe' && (state.subdomain?.enabled !== true || state.subdomain?.previews_enabled !== false)) fail('schedule_native_probe_surface_invalid')
  return { ...identity, namespaceId: surface === 'adapter'
    ? state.version.resources.bindings.find(item => item.name === 'SCHEDULE_PUBLIC_READ_NONCE_GUARD').namespace_id : null }
}

function versionArgs(manifest, surface, mode) {
  return ['--config', surface === 'core' ? CORE_CONFIG : ADAPTER_CONFIG, '--keep-vars',
    '--var', `SCHEDULE_PUBLIC_READ_ENABLED:${mode === 'ready'}`, '--var', `SCHEDULE_PUBLIC_READ_SOURCE_SHA:${manifest.sourceSha}`,
    '--var', `SCHEDULE_PUBLIC_READ_NATIVE_RELEASE_ID:${manifest.releaseId}`, '--var', `SCHEDULE_PUBLIC_READ_NATIVE_CONFIG_SHA256:${manifest.configDigest}`,
    '--message', nativeMessage(manifest, surface, mode)]
}

async function publish(transport, manifest, surface, mode, secrets, journal) {
  const tag = `native-${surface}-${mode}-${manifest.releaseId}`
  await transport.mutateWrangler(['versions', 'upload', ...versionArgs(manifest, surface, mode), '--tag', tag, '--secrets-file', '/dev/stdin'],
    { secrets, phase: `${surface}-upload` })
  // Unique immutable tag comes from this actual release. Readback, rather
  // than parsing human provider diagnostics, identifies the deployed UUID.
  await transport.mutateWrangler(['versions', 'deploy', '--config', surface === 'core' ? CORE_CONFIG : ADAPTER_CONFIG,
    '--version-tag', `${tag}@100%`, '--yes', '--message', nativeMessage(manifest, surface, mode)], { phase: `${surface}-deploy` })
  const proof = await readback(transport, manifest, surface, mode)
  journal.append(`${surface}-readback`, proof)
  return proof
}

export function validateProjectionProbe(body, manifest) {
  const units = body?.checks?.units
  if (body?.ok !== true || body.contract !== 'schedule-public-read-production-probe/v1' || body.sourceSha !== manifest.sourceSha
    || body.releaseId !== manifest.releaseId || body.mode !== 'public-projection' || body.checks?.publicProjection !== true
    || Object.keys(body).length !== 6 || Object.keys(body.checks).length !== 3
    || !/^\d{4}-\d{2}-\d{2}$/.test(body.checks.date ?? '') || !Array.isArray(units) || units.length !== 2
    || units.some((item, index) => item.unit !== ['novo-hamburgo', 'barra-shopping-sul'][index]
      || !Number.isSafeInteger(item.rosterCount) || item.rosterCount < 0 || item.rosterCount > 512
      || !Number.isSafeInteger(item.availabilityCount) || item.availabilityCount < 0 || item.availabilityCount > item.rosterCount
      || typeof item.closed !== 'boolean' || !sha256Pattern.test(item.rosterDigest ?? '') || !sha256Pattern.test(item.availabilityDigest ?? '')
      || Object.keys(item).length !== 6)) fail('schedule_native_projection_probe_failed')
  return { date: body.checks.date, units }
}

async function verifyProjection({ transport, manifest, capabilities, journal }) {
  if (await currentVersion(transport, manifest, manifest.probeWorker, true) !== null) fail('schedule_native_probe_already_exists')
  const expiresAtMs = Math.min(Date.now() + 30 * 60_000, Date.parse(manifest.expiresAt))
  journal.append('probe-identity', { expiresAtMs, sourceSha: manifest.sourceSha, releaseId: manifest.releaseId })
  await transport.mutateWrangler(['deploy', '--config', PROBE_CONFIG, '--name', manifest.probeWorker, '--keep-vars',
    '--var', `PROBE_SOURCE_SHA:${manifest.sourceSha}`, '--var', `PROBE_NATIVE_RELEASE_ID:${manifest.releaseId}`,
    '--var', `PROBE_EXPIRES_AT_MS:${expiresAtMs}`, '--message', nativeMessage(manifest, 'probe', 'probe'), '--secrets-file', '/dev/stdin'],
    { phase: 'probe-create', secrets: { SCHEDULE_PUBLIC_READ_PROBE_HMAC_KEY: capabilities.SCHEDULE_PUBLIC_READ_PROBE_HMAC_KEY,
      SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY: capabilities.SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY } })
  const proof = await readback(transport, manifest, 'probe', 'probe', { expiresAtMs })
  journal.append('probe-readback', { ...proof, expiresAtMs })
  const url = `${manifest.probeOrigin}/verify/public-projection`
  const headers = await createSchedulePublicReadHeaders({ secret: capabilities.SCHEDULE_PUBLIC_READ_PROBE_HMAC_KEY,
    service: 'schedule-production-verifier', url })
  let projected
  try {
    const response = await fetch(url, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(10000) })
    if (!response.ok) fail('schedule_native_projection_probe_failed')
    projected = validateProjectionProbe(await boundedProductionJson(response, 32768), manifest)
    journal.append('projection-verified', projected)
  } finally {
    // Ownership must still match the exact version/UUID/expiry before DELETE.
    await readback(transport, manifest, 'probe', 'probe', { expectedVersionId: proof.versionId, expiresAtMs })
    await transport.deleteOwnedProbe({ expectedVersionId: proof.versionId, expiresAtMs })
  }
  return projected
}

export async function runNativeRelease(options) {
  const { operation, sourceSha, manifestFile, manifestDigest, receiptDirectory, cliFile, owner } = snapshotNativeData(options)
  if (!OPERATIONS.includes(operation)) fail('schedule_native_operation_invalid')
  const source = assertNativeSource(sourceSha)
  assertPrivateDirectory(receiptDirectory, ROOT)
  const document = readPrivateJson(manifestFile, { maxBytes: 8192 })
  const manifest = validateNativeManifest(document.raw, { ...source, configDigest: nativeConfigDigest(), expectedDigest: manifestDigest,
    starting: !['preflight', 'reconcile-probe'].includes(operation), recovery: operation === 'reconcile-probe' })
  const journal = createNativeJournal({ directory: receiptDirectory, root: ROOT, manifest, operation })
  journal.append('prepared', { manifestDigest: document.digest, productionFreeze: false, websiteAcceptedWritesAuthorized: false })
  const preflight = await nativePreflight({ manifest, cliFile, journal, recovery: operation === 'reconcile-probe' })
  if (operation === 'preflight') return journal.complete({ preflightDigest: preflight.digest, remoteMutations: 0 })
  const capabilities = readCapabilities()
  const authority = await createNativeAuthority({ manifest, operation, owner, artifacts: [
    { name: 'schedule-native-manifest', id: manifest.releaseId, digest: document.digest },
    { name: 'schedule-native-preflight', id: manifest.releaseId, digest: preflight.digest },
  ] })
  try {
    const transport = createNativeTransport({ cliFile, root: ROOT, manifest, journal, authority })
    const surface = operation.startsWith('core-') ? 'core' : 'adapter'
    const before = await currentVersion(transport, manifest, manifest[`${surface}Worker`], operation === 'adapter-bootstrap-disabled')
    journal.append('checkpoint', { worker: manifest[`${surface}Worker`], versionId: before?.version?.id ?? null,
      deploymentId: before?.deployment?.id ?? null, absent: before === null })
    let metadata
    if (operation === 'adapter-bootstrap-disabled') {
      if (before !== null) fail('schedule_native_bootstrap_requires_absence')
      await transport.mutateWrangler(['deploy', ...versionArgs(manifest, 'adapter', 'bootstrap-disabled'), '--secrets-file', '/dev/stdin'],
        { phase: 'adapter-bootstrap', secrets: { SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY: capabilities.SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY,
          SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY: capabilities.SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY } })
      metadata = await readback(transport, manifest, 'adapter', 'bootstrap-disabled')
    } else if (operation === 'adapter-enable') {
      const core = readNativePredecessor({ directory: receiptDirectory, root: ROOT, manifest, operation: 'core-enable' })
      const bootstrap = readNativePredecessor({ directory: receiptDirectory, root: ROOT, manifest, operation: 'adapter-bootstrap-disabled' })
      await readback(transport, manifest, 'core', 'ready', { expectedVersionId: core.data.metadata.versionId })
      const disabled = await readback(transport, manifest, 'adapter', 'bootstrap-disabled', { expectedVersionId: bootstrap.data.metadata.versionId })
      if (disabled.namespaceId !== bootstrap.data.metadata.namespaceId) fail('schedule_native_namespace_changed')
      metadata = await publish(transport, manifest, 'adapter', 'ready', { SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY: capabilities.SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY,
        SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY: capabilities.SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY }, journal)
      if (metadata.namespaceId !== disabled.namespaceId) fail('schedule_native_namespace_changed')
      metadata = { ...metadata, publicProjection: await verifyProjection({ transport, manifest, capabilities, journal }) }
    } else if (operation === 'reconcile-probe') {
      const state = await currentVersion(transport, manifest, manifest.probeWorker, true)
      if (!state) fail('schedule_native_probe_reconcile_not_needed')
      const expiry = Number(state.version.resources?.bindings?.find(item => item.name === 'PROBE_EXPIRES_AT_MS')?.text)
      if (!Number.isSafeInteger(expiry) || expiry > Date.now()) fail('schedule_native_probe_not_expired')
      const identity = assertNativeVersion(state.deployment, state.version, { manifest, surface: 'probe', mode: 'probe', expiresAtMs: expiry })
      // The same manifest, own UUID and exact source fence recovery; no
      // numeric workflow run or foreign probe is accepted as ownership.
      await transport.deleteOwnedProbe({ expectedVersionId: identity.versionId, expiresAtMs: expiry }); metadata = { ...identity, absent: true }
    } else {
      if (!before) fail('schedule_native_checkpoint_missing')
      if (operation === 'adapter-disable') {
        const bindings = before.version.resources?.bindings
        if (!bindings?.some(item => item.name === 'SCHEDULE_PUBLIC_READ_NONCE_GUARD' && typeof item.namespace_id === 'string')) fail('schedule_native_namespace_unavailable')
      }
      metadata = await publish(transport, manifest, surface, operation.endsWith('enable') ? 'ready' : 'disabled', surface === 'core'
        ? { SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY: capabilities.SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY }
        : { SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY: capabilities.SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY,
          SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY: capabilities.SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY }, journal)
      if (operation === 'adapter-disable' && metadata.namespaceId !== before.version.resources.bindings.find(item => item.name === 'SCHEDULE_PUBLIC_READ_NONCE_GUARD').namespace_id) fail('schedule_native_namespace_changed')
    }
    assertNativeSource(sourceSha); await authority.check()
    return journal.complete({ ...metadata, resource: nativeResource(operation).resource, websiteAcceptedWritesAuthorized: false })
  } catch {
    journal.append('blocked', { nextStep: 'readback-and-owned-reconciliation-before-any-new-write', websiteAcceptedWritesAuthorized: false })
    fail('schedule_native_operation_blocked')
  } finally { await authority.release() }
}

function commandOptions(args) {
  const names = ['--operation', '--source-sha', '--manifest', '--manifest-sha256', '--receipts', '--wrangler-cli', '--owner']
  const out = Object.create(null)
  if (args.length !== names.length * 2) fail('schedule_native_arguments_invalid')
  for (let index = 0; index < args.length; index += 2) {
    if (!names.includes(args[index]) || Object.hasOwn(out, args[index]) || !args[index + 1]) fail('schedule_native_arguments_invalid')
    out[args[index]] = args[index + 1]
  }
  return { operation: out['--operation'], sourceSha: out['--source-sha'], manifestFile: out['--manifest'], manifestDigest: out['--manifest-sha256'],
    receiptDirectory: out['--receipts'], cliFile: out['--wrangler-cli'], owner: readPrivateJson(out['--owner'], { maxBytes: 8192 }).data }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === '--prepare-manifest') {
      if (process.argv.length !== 7 || process.argv[3] !== '--source-sha' || process.argv[5] !== '--receipts') fail('schedule_native_arguments_invalid')
      process.stdout.write(JSON.stringify(prepareNativeManifest({ sourceSha: process.argv[4], receiptDirectory: process.argv[6] })) + '\n')
    } else {
    const result = await runNativeRelease(commandOptions(process.argv.slice(2)))
    process.stdout.write(JSON.stringify({ ok: true, contract: result.record.contract, operation: result.record.operation,
      sourceSha: result.record.sourceSha, releaseId: result.record.releaseId, receiptDigest: result.digest,
      websiteAcceptedWritesAuthorized: false }) + '\n')
    }
  } catch { process.stderr.write('schedule_native_operation_blocked\n'); process.exitCode = 1 }
}
