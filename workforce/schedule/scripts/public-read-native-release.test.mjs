import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { NATIVE_MANIFEST_CONTRACT, NATIVE_RESOURCES, NATIVE_WRANGLER_VERSION, assertNativeVersion, nativeDigest, nativeMessage, snapshotNativeData, validateNativeManifest } from './public-read-native-manifest.mjs'
import { assertNativeAuthority, nativeResource } from './public-read-native-authority.mjs'
import { createNativeJournal, readNativeAdapterHistory, readNativePredecessor } from './public-read-native-receipts.mjs'
import { validateProjectionProbe, runNativeRelease, transitionNativeAdapter } from './public-read-native-release.mjs'
import { assertNativeMutationCommand } from './public-read-native-http.mjs'

const sourceSha = 'a'.repeat(40), sourceTree = 'b'.repeat(40), configDigest = 'c'.repeat(64)
const releaseId = '11aa0000-1234-4321-aaaa-123456789abc', versionId = '22aa0000-1234-4321-aaaa-123456789abc'
const now = Date.parse('2026-10-14T12:00:00Z')
const manifest = { contract: NATIVE_MANIFEST_CONTRACT, sourceSha, sourceTree, configDigest, ...NATIVE_RESOURCES,
  wranglerVersion: NATIVE_WRANGLER_VERSION, probeLifetimeSeconds: 1800, releaseId, adapterPredecessor: null,
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

function lifecycleFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-native-lifecycle-')); fs.chmodSync(directory, 0o700)
  const states = {}, writes = [], namespaceId = '1'.repeat(32)
  let unknownNext = false, changeNamespace = false
  const saveManifest = (prior = null, changedSource = false) => {
    const item = { ...manifest, releaseId: randomUUID(), adapterPredecessor: prior,
      sourceSha: changedSource ? 'd'.repeat(40) : sourceSha, sourceTree: changedSource ? 'e'.repeat(40) : sourceTree,
      configDigest: changedSource ? 'f'.repeat(64) : configDigest,
      createdAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString() }
    const raw = JSON.stringify(item) + '\n'
    fs.writeFileSync(path.join(directory, item.releaseId + '-manifest.json'), raw, { mode: 0o600, flag: 'wx' })
    validateNativeManifest(raw, { sourceSha: item.sourceSha, sourceTree: item.sourceTree, configDigest: item.configDigest,
      expectedDigest: nativeDigest(raw), starting: true })
    return item
  }
  const digest = item => nativeDigest(fs.readFileSync(path.join(directory, item.releaseId + '-manifest.json')))
  const stateFor = (item, surface, mode) => {
    const state = structuredClone(nativeState(surface, mode))
    state.version.id = randomUUID(); state.deployment.id = randomUUID(); state.deployment.versions[0].version_id = state.version.id
    state.deployment.annotations['workers/message'] = nativeMessage(item, surface, mode)
    for (const [name, value] of Object.entries({ SCHEDULE_PUBLIC_READ_SOURCE_SHA: item.sourceSha,
      SCHEDULE_PUBLIC_READ_NATIVE_RELEASE_ID: item.releaseId, SCHEDULE_PUBLIC_READ_NATIVE_CONFIG_SHA256: item.configDigest })) {
      state.version.resources.bindings.find(binding => binding.name === name).text = value
    }
    if (surface === 'adapter') state.version.resources.bindings.find(binding => binding.name === 'SCHEDULE_PUBLIC_READ_NONCE_GUARD').namespace_id = namespaceId
    state.subdomain = { enabled: false, previews_enabled: false }
    return state
  }
  const journalFor = (item, operation) => {
    const journal = createNativeJournal({ directory, root: '/fixture-source-root', manifest: item, operation })
    journal.append('prepared', { manifestDigest: digest(item) })
    return journal
  }
  const core = item => {
    states[manifest.coreWorker] = stateFor(item, 'core', 'ready')
    const state = states[manifest.coreWorker]
    journalFor(item, 'core-enable').complete({ ...assertNativeVersion(state.deployment, state.version, { manifest: item, surface: 'core', mode: 'ready' }),
      namespaceId: null, resource: nativeResource('core-enable').resource, websiteAcceptedWritesAuthorized: false })
  }
  const prior = (item, operation) => readNativeAdapterHistory({ directory, root: '/fixture-source-root',
    releaseId: item.releaseId, operation, manifestDigest: digest(item) }).descriptor
  const invoke = async (item, operation, { failAfterReadback = false } = {}) => {
    const journal = journalFor(item, operation)
    let pending
    const transport = {
      async get(pathname, options = {}) {
        const worker = pathname.split('/workers/scripts/')[1].split('/')[0], state = states[worker]
        if (!state) { if (options.allowMissing) return null; throw Error('fixture_worker_missing') }
        if (pathname.endsWith('/settings')) return { bindings: state.version.resources.bindings }
        if (pathname.endsWith('/deployments')) return { deployments: [state.deployment] }
        if (pathname.endsWith('/subdomain')) return state.subdomain
        if (pathname.endsWith('/versions/' + state.version.id)) return state.version
        throw Error('fixture_path_invalid')
      },
      async privateAdapter() { return true },
      async mutateWrangler(args, options) {
        assertNativeMutationCommand(args, { operation, manifest: item, secrets: options.secrets })
        writes.push([...args]); journal.append(options.phase + '-started', { fixture: true })
        if (unknownNext) { unknownNext = false; throw Error('fixture_unknown_ack') }
        const mode = operation === 'adapter-bootstrap-disabled' ? 'bootstrap-disabled'
          : operation === 'adapter-reconcile-disable' ? 'reconciled-disabled' : operation === 'adapter-enable' ? 'ready' : 'disabled'
        if (args[0] === 'deploy' || args[0] === 'versions' && args[1] === 'upload') {
          pending = stateFor(item, 'adapter', mode)
          if (changeNamespace) pending.version.resources.bindings.find(binding => binding.name === 'SCHEDULE_PUBLIC_READ_NONCE_GUARD').namespace_id = '2'.repeat(32)
        }
        if (args[0] === 'deploy' || args[0] === 'versions' && args[1] === 'deploy') states[manifest.adapterWorker] = pending
      },
    }
    try {
      const result = await transitionNativeAdapter({ operation, transport, manifest: item, manifestDigest: digest(item), receiptDirectory: directory,
        journal, capabilities: { SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY: 'f'.repeat(64), SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY: 'e'.repeat(64) } })
      if (failAfterReadback) throw Error('fixture_projection_failed_after_readback')
      return journal.complete({ ...result, resource: nativeResource(operation).resource, websiteAcceptedWritesAuthorized: false })
    } catch (error) { journal.append('blocked', { fixture: true }); throw error }
  }
  return { directory, saveManifest, core, prior, invoke, writes, states, namespaceId,
    unknown() { unknownNext = true }, changeNamespace() { changeNamespace = true },
    cleanup() { fs.rmSync(directory, { recursive: true, force: true }) } }
}

test('adapter lifecycle bootstraps once, publishes a second source, and reactivates after disable without deleting its Worker or namespace', async () => {
  const fixture = lifecycleFixture()
  try {
    const a = fixture.saveManifest(); fixture.core(a)
    await fixture.invoke(a, 'adapter-bootstrap-disabled'); await fixture.invoke(a, 'adapter-enable')
    const first = fixture.prior(a, 'adapter-enable')
    const b = fixture.saveManifest(first, true)
    await fixture.invoke(b, 'adapter-disable'); fixture.core(b); await fixture.invoke(b, 'adapter-enable')
    const second = fixture.prior(b, 'adapter-enable')
    assert.notEqual(second.versionId, first.versionId); assert.equal(second.sourceSha, b.sourceSha)
    await fixture.invoke(b, 'adapter-disable').then(() => assert.fail('same operation must remain exclusive'), error => assert.equal(error.code, 'EEXIST'))
    // B.disable is already consumed by staging. Disable in a new governed cycle C.
    const c = fixture.saveManifest(second, true)
    await fixture.invoke(c, 'adapter-disable')
    const disabled = fixture.prior(c, 'adapter-disable'); assert.equal(disabled.mode, 'disabled')
    const d = fixture.saveManifest(disabled, true)
    await fixture.invoke(d, 'adapter-disable'); fixture.core(d); await fixture.invoke(d, 'adapter-enable')
    const reactivated = fixture.prior(d, 'adapter-enable')
    assert.equal(reactivated.namespaceId, fixture.namespaceId)
    assert.equal(first.namespaceId, fixture.namespaceId); assert.equal(second.namespaceId, fixture.namespaceId)
    assert.equal(fixture.writes.filter(args => args[0] === 'deploy').length, 1)
    assert.equal(fixture.writes.some(args => args.includes('delete')), false)
    assert.equal(fixture.writes.every(args => args[0] === 'deploy' || ['upload', 'deploy'].includes(args[1])), true)
  } finally { fixture.cleanup() }
})

test('an uncertain adapter transition cannot be repeated using another releaseId or its still-current predecessor', async () => {
  const fixture = lifecycleFixture()
  try {
    const a = fixture.saveManifest(); fixture.core(a)
    await fixture.invoke(a, 'adapter-bootstrap-disabled'); await fixture.invoke(a, 'adapter-enable')
    const first = fixture.prior(a, 'adapter-enable'), b = fixture.saveManifest(first, true)
    fixture.unknown(); await assert.rejects(fixture.invoke(b, 'adapter-disable'), /fixture_unknown_ack/)
    assert.throws(() => fixture.prior(b, 'adapter-disable'))
    const count = fixture.writes.length
    await assert.rejects(fixture.invoke(b, 'adapter-disable'), { code: 'EEXIST' })
    const c = fixture.saveManifest(first, true)
    await assert.rejects(fixture.invoke(c, 'adapter-disable'), { code: 'EEXIST' })
    assert.equal(fixture.writes.length, count)
  } finally { fixture.cleanup() }
})

test('stale lineage and tampered completed receipt metadata fail before another adapter write', async () => {
  const fixture = lifecycleFixture()
  try {
    const a = fixture.saveManifest(); fixture.core(a)
    await fixture.invoke(a, 'adapter-bootstrap-disabled'); await fixture.invoke(a, 'adapter-enable')
    const first = fixture.prior(a, 'adapter-enable')
    await fixture.invoke(a, 'adapter-disable')
    const count = fixture.writes.length, b = fixture.saveManifest(first, true)
    await assert.rejects(fixture.invoke(b, 'adapter-disable'))
    assert.equal(fixture.writes.length, count)
    const receiptFile = path.join(fixture.directory, a.releaseId, 'adapter-disable', 'receipt.json')
    const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8')); receipt.metadata.namespaceId = '2'.repeat(32)
    fs.writeFileSync(receiptFile, JSON.stringify(receipt) + '\n')
    assert.throws(() => fixture.prior(a, 'adapter-disable'), /schedule_native_receipt_invalid/)
  } finally { fixture.cleanup() }
})

test('adapter activation requires one completed local bootstrap or disable and rejects namespace replacement', async () => {
  const fixture = lifecycleFixture()
  try {
    const a = fixture.saveManifest(); fixture.core(a)
    await fixture.invoke(a, 'adapter-bootstrap-disabled'); await fixture.invoke(a, 'adapter-enable')
    const b = fixture.saveManifest(fixture.prior(a, 'adapter-enable'), true)
    fixture.changeNamespace(); await assert.rejects(fixture.invoke(b, 'adapter-disable'), /schedule_native_namespace_changed/)
    assert.throws(() => fixture.prior(b, 'adapter-disable'))
    assert.equal(fixture.writes.some(args => args.includes('delete')), false)
  } finally { fixture.cleanup() }
})

test('current manifests require explicit lineage shape while historical reads can retain the old manifest schema', () => {
  const missing = { ...manifest }; delete missing.adapterPredecessor
  assert.throws(() => validate(missing))
  const raw = JSON.stringify(missing)
  assert.equal(validateNativeManifest(raw, { sourceSha, sourceTree, configDigest, expectedDigest: nativeDigest(raw), now,
    historical: true, recovery: true }).releaseId, releaseId)
  const invalid = { ...manifest, adapterPredecessor: { releaseId: versionId } }
  assert.throws(() => validate(invalid))
})


test('an existing adapter cannot bootstrap again or activate without a completed unambiguous staging predecessor', async () => {
  const fixture = lifecycleFixture()
  try {
    const a = fixture.saveManifest(); fixture.core(a)
    await fixture.invoke(a, 'adapter-bootstrap-disabled'); await fixture.invoke(a, 'adapter-enable')
    const first = fixture.prior(a, 'adapter-enable'), count = fixture.writes.length
    const b = fixture.saveManifest(first, true)
    await assert.rejects(fixture.invoke(b, 'adapter-bootstrap-disabled'), /schedule_native_bootstrap_requires_absence/)
    fixture.core(b)
    await assert.rejects(fixture.invoke(b, 'adapter-enable'), /ENOENT/)
    const missing = fixture.saveManifest(first, true); fixture.core(missing)
    await assert.rejects(fixture.invoke(missing, 'adapter-enable'), /schedule_native_adapter_predecessor_invalid/)
    const c = fixture.saveManifest(first, true); fixture.core(c)
    const digest = nativeDigest(fs.readFileSync(path.join(fixture.directory, c.releaseId + '-manifest.json')))
    const staged = createNativeJournal({ directory: fixture.directory, root: '/fixture-source-root', manifest: c, operation: 'adapter-disable' })
    staged.append('prepared', { manifestDigest: digest })
    await assert.rejects(fixture.invoke(c, 'adapter-enable'))
    const d = fixture.saveManifest(first, true); fixture.core(d)
    for (const operation of ['adapter-bootstrap-disabled', 'adapter-disable']) {
      const journal = createNativeJournal({ directory: fixture.directory, root: '/fixture-source-root', manifest: d, operation })
      journal.append('prepared', { manifestDigest: nativeDigest(fs.readFileSync(path.join(fixture.directory, d.releaseId + '-manifest.json'))) })
      journal.complete({ versionId, deploymentId: 'fixture-deployment', namespaceId: fixture.namespaceId })
    }
    await assert.rejects(fixture.invoke(d, 'adapter-enable'), /schedule_native_adapter_predecessor_invalid/)
    assert.equal(fixture.writes.length, count)
  } finally { fixture.cleanup() }
})

test('historical adapter lineage verifies an original-schema manifest against its exact terminal receipt', () => {
  const fixture = lifecycleFixture()
  try {
    const original = fixture.saveManifest(); delete original.adapterPredecessor
    const raw = JSON.stringify(original) + '\n', manifestDigest = nativeDigest(raw)
    fs.writeFileSync(path.join(fixture.directory, original.releaseId + '-manifest.json'), raw)
    const journal = createNativeJournal({ directory: fixture.directory, root: '/fixture-source-root', manifest: original, operation: 'adapter-enable' })
    journal.append('prepared', { manifestDigest })
    journal.complete({ versionId, deploymentId: 'fixture-deployment', namespaceId: fixture.namespaceId, mode: 'ready', surface: 'adapter' })
    const history = readNativeAdapterHistory({ directory: fixture.directory, root: '/fixture-source-root', releaseId: original.releaseId,
      operation: 'adapter-enable', manifestDigest })
    assert.equal(history.descriptor.manifestDigest, manifestDigest)
    assert.equal(history.descriptor.namespaceId, fixture.namespaceId)
    assert.equal(history.descriptor.operation, 'adapter-enable')
    assert.equal(fixture.writes.length, 0)
  } finally { fixture.cleanup() }
})


test('a ready readback followed by failed projection can be reconciled disabled without approving or repeating activation', async () => {
  const fixture = lifecycleFixture()
  try {
    const a = fixture.saveManifest(); fixture.core(a)
    await fixture.invoke(a, 'adapter-bootstrap-disabled'); await fixture.invoke(a, 'adapter-enable')
    const b = fixture.saveManifest(fixture.prior(a, 'adapter-enable'), true)
    await fixture.invoke(b, 'adapter-disable'); fixture.core(b)
    await assert.rejects(fixture.invoke(b, 'adapter-enable', { failAfterReadback: true }), /fixture_projection_failed_after_readback/)
    assert.throws(() => fixture.prior(b, 'adapter-enable'))
    const count = fixture.writes.length
    const recovery = await fixture.invoke(b, 'adapter-reconcile-disable')
    assert.equal(fixture.writes.length, count + 2)
    assert.equal(recovery.record.metadata.incompleteActivationReconciled, true)
    assert.equal(recovery.record.metadata.activationApproved, false)
    assert.equal(recovery.record.metadata.mode, 'reconciled-disabled')
    assert.equal(recovery.record.metadata.namespaceId, fixture.namespaceId)
    assert.throws(() => fixture.prior(b, 'adapter-enable'))
    await assert.rejects(fixture.invoke(b, 'adapter-reconcile-disable'), { code: 'EEXIST' })
    const c = fixture.saveManifest(fixture.prior(b, 'adapter-reconcile-disable'), true)
    await fixture.invoke(c, 'adapter-disable'); fixture.core(c); await fixture.invoke(c, 'adapter-enable')
    assert.equal(fixture.prior(c, 'adapter-enable').namespaceId, fixture.namespaceId)
    assert.equal(fixture.writes.some(args => args.includes('delete')), false)
  } finally { fixture.cleanup() }
})

test('an uncertain enable without a recorded ready readback cannot use owned compensation', async () => {
  const fixture = lifecycleFixture()
  try {
    const a = fixture.saveManifest(); fixture.core(a)
    await fixture.invoke(a, 'adapter-bootstrap-disabled'); await fixture.invoke(a, 'adapter-enable')
    const b = fixture.saveManifest(fixture.prior(a, 'adapter-enable'), true)
    await fixture.invoke(b, 'adapter-disable'); fixture.core(b)
    fixture.unknown(); await assert.rejects(fixture.invoke(b, 'adapter-enable'), /fixture_unknown_ack/)
    const count = fixture.writes.length
    await assert.rejects(fixture.invoke(b, 'adapter-reconcile-disable'), /schedule_native_receipt_invalid/)
    assert.equal(fixture.writes.length, count)
    assert.throws(() => fixture.prior(b, 'adapter-enable'))
  } finally { fixture.cleanup() }
})
