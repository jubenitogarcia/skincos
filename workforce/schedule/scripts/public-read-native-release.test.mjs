import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NATIVE_MANIFEST_CONTRACT, NATIVE_RESOURCES, NATIVE_WRANGLER_VERSION, assertNativeVersion, nativeDigest, nativeMessage, snapshotNativeData, validateNativeManifest } from './public-read-native-manifest.mjs'
import { assertNativeAuthority, nativeResource } from './public-read-native-authority.mjs'
import { createNativeJournal, readNativePredecessor } from './public-read-native-receipts.mjs'
import { validateProjectionProbe, runNativeRelease } from './public-read-native-release.mjs'
import { assertNativeMutationCommand } from './public-read-native-http.mjs'

const sourceSha = 'a'.repeat(40), sourceTree = 'b'.repeat(40), configDigest = 'c'.repeat(64)
const releaseId = '11aa0000-1234-4321-aaaa-123456789abc', versionId = '22aa0000-1234-4321-aaaa-123456789abc'
const now = Date.parse('2026-10-14T12:00:00Z')
const manifest = { contract: NATIVE_MANIFEST_CONTRACT, sourceSha, sourceTree, configDigest, ...NATIVE_RESOURCES,
  wranglerVersion: NATIVE_WRANGLER_VERSION, probeLifetimeSeconds: 1800, releaseId,
  createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 3600000).toISOString() }
const validate = object => {
  const raw = JSON.stringify(object)
  return validateNativeManifest(raw, { sourceSha, sourceTree, configDigest, expectedDigest: nativeDigest(raw), now, starting: true })
}

test('native manifest is a separate bounded authority and binds source, real resource names, digest and release window', () => {
  assert.equal(validate(manifest).releaseId, releaseId)
  for (const delta of [{ contract: 'schedule-public-read-production-manifest/v1' }, { releaseId: '12345' },
    { sourceSha: 'd'.repeat(40) }, { coreDatabaseId: 'different' }, { probeLifetimeSeconds: 3600 },
    { expiresAt: new Date(now + 34 * 60000).toISOString() }, { expiresAt: new Date(now + 25 * 3600000).toISOString() },
    { workflowRunId: '12345' }]) assert.throws(() => validate({ ...manifest, ...delta }))
})

test('options cannot use getters or a mutable caller object to change an authorized destination', () => {
  let accessed = false
  assert.throws(() => snapshotNativeData({ get accountId() { accessed = true; return manifest.accountId } }))
  assert.equal(accessed, false)
  const input = { resource: { worker: manifest.coreWorker } }, frozen = snapshotNativeData(input)
  input.resource.worker = 'another-worker'
  assert.equal(frozen.resource.worker, manifest.coreWorker)
  assert.throws(() => { frozen.resource.worker = 'another-worker' })
})

test('an unleased or foreign-resource operation cannot claim native publication authority', () => {
  assert.throws(() => assertNativeAuthority({ async check() { return { passed: true, fencingToken: 1 } } }))
  assert.equal(nativeResource('core-enable').resource, 'global:escala-writer')
  assert.equal(nativeResource('adapter-enable').resource, 'deploy:schedule-public-read-adapter:production')
  for (const operation of ['global-coordinator', 'ponto', 'd1-migrate', 'rotate-actor', 'staging']) assert.throws(() => nativeResource(operation))
})

test('a core lease scope admits only its exact native command and additive new capability', () => {
  const args = ['versions', 'upload', '--config', 'workforce/schedule/wrangler.toml', '--keep-vars',
    '--var', 'SCHEDULE_PUBLIC_READ_ENABLED:true', '--var', `SCHEDULE_PUBLIC_READ_SOURCE_SHA:${sourceSha}`,
    '--var', `SCHEDULE_PUBLIC_READ_NATIVE_RELEASE_ID:${releaseId}`, '--var', `SCHEDULE_PUBLIC_READ_NATIVE_CONFIG_SHA256:${configDigest}`,
    '--message', nativeMessage(manifest, 'core', 'ready'), '--tag', `native-core-ready-${releaseId}`, '--secrets-file', '/dev/stdin']
  const options = { operation: 'core-enable', manifest, secrets: { SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY: 'f'.repeat(64) } }
  assert.equal(assertNativeMutationCommand(args, options), 'core')
  for (const changed of [args.map(item => item === 'workforce/schedule/wrangler.toml' ? 'workforce/schedule/public-read.wrangler.toml' : item),
    [...args, '--env', 'staging'], [...args, '--name', 'foreign-worker'], ['delete', 'skincos-global-coordinator-production']]) {
    assert.throws(() => assertNativeMutationCommand(changed, options))
  }
  assert.throws(() => assertNativeMutationCommand(args, { ...options, secrets: { ...options.secrets, ESCALA_ACTOR_HMAC_KEY: 'e'.repeat(64) } }))
  assert.throws(() => assertNativeMutationCommand(args, { ...options, operation: 'adapter-enable' }))
})

const nativeState = (surface, mode) => {
  const binding = (name, text) => ({ name, type: 'plain_text', text: String(text) })
  const bindings = [binding('SCHEDULE_PUBLIC_READ_ENABLED', mode === 'ready'), binding('SCHEDULE_PUBLIC_READ_SOURCE_SHA', sourceSha),
    binding('SCHEDULE_PUBLIC_READ_NATIVE_RELEASE_ID', releaseId), binding('SCHEDULE_PUBLIC_READ_NATIVE_CONFIG_SHA256', configDigest),
    { name: 'SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY', type: 'secret_text' }]
  if (surface === 'core') bindings.push({ name: 'DB', type: 'd1', id: manifest.coreDatabaseId }, { name: 'ESCALA_ACTOR_HMAC_KEY', type: 'secret_text' })
  else bindings.push({ name: 'SCHEDULE_CORE', type: 'service', service: manifest.coreWorker },
    { name: 'SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY', type: 'secret_text' },
    { name: 'SCHEDULE_PUBLIC_READ_NONCE_GUARD', type: 'durable_object_namespace', class_name: 'SchedulePublicReadNonceGuard', namespace_id: 'real-readback-id' })
  return { deployment: { id: 'actual-deployment', versions: [{ version_id: versionId, percentage: 100 }],
    annotations: { 'workers/message': nativeMessage(manifest, surface, mode) } }, version: { id: versionId, resources: { bindings } } }
}
test('live readback refuses split traffic, foreign ownership, changed DB, missing custody and direct D1 on the adapter', () => {
  for (const surface of ['core', 'adapter']) {
    const state = nativeState(surface, 'ready')
    assert.equal(assertNativeVersion(state.deployment, state.version, { manifest, surface, mode: 'ready' }).versionId, versionId)
    const split = structuredClone(state); split.deployment.versions[0].percentage = 99
    assert.throws(() => assertNativeVersion(split.deployment, split.version, { manifest, surface, mode: 'ready' }))
    const foreign = structuredClone(state); foreign.deployment.annotations['workers/message'] += ':foreign'
    assert.throws(() => assertNativeVersion(foreign.deployment, foreign.version, { manifest, surface, mode: 'ready' }))
  }
  const core = nativeState('core', 'ready'); core.version.resources.bindings.find(item => item.name === 'DB').id = 'foreign'
  assert.throws(() => assertNativeVersion(core.deployment, core.version, { manifest, surface: 'core', mode: 'ready' }))
  const adapter = nativeState('adapter', 'ready'); adapter.version.resources.bindings.push({ name: 'FOREIGN_DB', type: 'd1', id: manifest.coreDatabaseId })
  assert.throws(() => assertNativeVersion(adapter.deployment, adapter.version, { manifest, surface: 'adapter', mode: 'ready' }))
})

test('native projection proof accepts only aggregates from both units and rejects upstream payload or mismatched identities', () => {
  const proof = { ok: true, contract: 'schedule-public-read-production-probe/v1', sourceSha, releaseId, mode: 'public-projection',
    checks: { publicProjection: true, date: '2026-10-14', units: ['novo-hamburgo', 'barra-shopping-sul'].map(unit => ({ unit,
      rosterCount: 3, availabilityCount: 2, closed: false, rosterDigest: 'd'.repeat(64), availabilityDigest: 'e'.repeat(64) })) } }
  assert.equal(validateProjectionProbe(proof, manifest).units.length, 2)
  for (const delta of [{ releaseId: versionId }, { sourceSha: 'd'.repeat(40) }, { mode: 'ready' }, { payload: [{ name: 'fixture-name' }] }]) {
    assert.throws(() => validateProjectionProbe({ ...proof, ...delta }, manifest))
  }
  const leaked = structuredClone(proof); leaked.checks.units[0].name = 'fixture-name'
  assert.throws(() => validateProjectionProbe(leaked, manifest))
})

test('private receipts are exclusive and chained; an uncertain operation cannot become a predecessor or be rerun', () => {
  assert.equal(process.platform, 'linux')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-native-fixture-')); fs.chmodSync(directory, 0o700)
  try {
    const journal = createNativeJournal({ directory, root: '/fixture-source-root', manifest, operation: 'core-enable' })
    journal.append('prepared', { remoteMutations: 0 })
    assert.throws(() => createNativeJournal({ directory, root: '/fixture-source-root', manifest, operation: 'core-enable' }))
    assert.throws(() => readNativePredecessor({ directory, root: '/fixture-source-root', manifest, operation: 'core-enable' }))
    journal.complete({ versionId })
    assert.equal(readNativePredecessor({ directory, root: '/fixture-source-root', manifest, operation: 'core-enable' }).data.metadata.versionId, versionId)
    const first = path.join(journal.operationRoot, '000-prepared.json')
    fs.writeFileSync(first, fs.readFileSync(first, 'utf8').replace('"remoteMutations":0', '"remoteMutations":1'))
    assert.throws(() => readNativePredecessor({ directory, root: '/fixture-source-root', manifest, operation: 'core-enable' }))
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('a foreign source is rejected before custody, credential retrieval or any provider request', async () => {
  await assert.rejects(runNativeRelease({ operation: 'core-enable', sourceSha: '0'.repeat(40) }))
})
