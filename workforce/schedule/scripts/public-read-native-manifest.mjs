import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

export const NATIVE_MANIFEST_CONTRACT = 'schedule-public-read-native-production-manifest/v1'
export const NATIVE_WRANGLER_VERSION = '4.143.1'
export const NATIVE_RESOURCES = Object.freeze({
  accountId: 'c5dfffe5652dfc8c85b3f29463452ac6',
  coreWorker: 'skincos-escala-api',
  adapterWorker: 'skincos-schedule-public-read',
  probeWorker: 'skincos-schedule-public-read-native-probe',
  probeOrigin: 'https://skincos-schedule-public-read-native-probe.skincos.workers.dev',
  coordinatorOrigin: 'https://skincos-global-coordinator-production.skincos.workers.dev',
  coreDatabaseId: '594fef1b-5597-476e-86f9-59920f284215',
})
export const NATIVE_CONFIG_FILES = Object.freeze([
  'workforce/schedule/wrangler.toml',
  'workforce/schedule/worker.js',
  'workforce/schedule/public-read.wrangler.toml',
  'workforce/schedule/public-read-worker.js',
  'workforce/schedule/public-read-adapter-runtime.js',
  'workforce/schedule/public-read-contract.js',
  'workforce/schedule/public-read-nonce-guard.js',
  'workforce/schedule/public-read-professional-identities.js',
  'workforce/schedule/public-read-projection.js',
  'workforce/schedule/public-read-production-probe.js',
  'workforce/schedule/public-read-production-probe.wrangler.toml',
  'workforce/schedule/scripts/public-read-native-manifest.mjs',
  'workforce/schedule/scripts/public-read-native-authority.mjs',
  'workforce/schedule/scripts/public-read-native-http.mjs',
  'workforce/schedule/scripts/public-read-native-receipts.mjs',
  'workforce/schedule/scripts/public-read-native-release.mjs',
  'workforce/schedule/scripts/public-read-production-http.mjs',
  'workforce/schedule/scripts/public-read-production-private-surface.mjs',
  'scripts/codex-global-coordination-client.mjs',
  'scripts/codex-global-coordinator.mjs',
  'ops/governance/global-coordination-core.mjs',
  'ops/governance/global-concurrency-policy.json',
  '.github/scripts/validate-cloudflare-single-writer.mjs',
  '.github/governance/cloudflare-single-writer-policy.json',
])
const sha = /^[a-f0-9]{40}$/
const digest = /^[a-f0-9]{64}$/
export const NATIVE_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const fail = () => { throw new Error('schedule_native_manifest_invalid') }
export const nativeDigest = bytes => createHash('sha256').update(bytes).digest('hex')

export function snapshotNativeData(value, depth = 0) {
  if (depth > 12) fail()
  if (value === null || typeof value === 'boolean' || typeof value === 'string'
    || typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length > 5000) fail()
    const descriptors = Object.getOwnPropertyDescriptors(value)
    if (Reflect.ownKeys(descriptors).length !== value.length + 1) fail()
    return Object.freeze(Array.from({ length: value.length }, (_, index) => {
      const item = descriptors[index]
      if (!item || !Object.hasOwn(item, 'value') || !item.enumerable) fail()
      return snapshotNativeData(item.value, depth + 1)
    }))
  }
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail()
  const out = Object.create(null)
  for (const [key, item] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!Object.hasOwn(item, 'value') || !item.enumerable || key.length > 128) fail()
    out[key] = snapshotNativeData(item.value, depth + 1)
  }
  if (Reflect.ownKeys(value).length !== Object.keys(out).length) fail()
  return Object.freeze(out)
}

export function nativeConfigDigest(root = path.resolve(import.meta.dirname, '../../..')) {
  const hash = createHash('sha256')
  for (const file of NATIVE_CONFIG_FILES) hash.update(file).update('\0').update(readFileSync(path.join(root, file))).update('\0')
  return hash.digest('hex')
}

export function validateNativeManifest(raw, { sourceSha, sourceTree, configDigest, expectedDigest, now = Date.now(), starting = false, recovery = false, historical = false }) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 8192 || !digest.test(expectedDigest ?? '')
    || nativeDigest(raw) !== expectedDigest || !sha.test(sourceSha ?? '') || !sha.test(sourceTree ?? '')
    || !digest.test(configDigest ?? '') || !Number.isSafeInteger(now)) fail()
  let parsed
  try { parsed = snapshotNativeData(JSON.parse(raw)) } catch { fail() }
  const expected = { contract: NATIVE_MANIFEST_CONTRACT, sourceSha, sourceTree, configDigest,
    ...NATIVE_RESOURCES, wranglerVersion: NATIVE_WRANGLER_VERSION, probeLifetimeSeconds: 1800 }
  const names = [...Object.keys(expected), 'releaseId', 'createdAt', 'expiresAt']
  if (!historical || Object.hasOwn(parsed, 'adapterPredecessor')) names.push('adapterPredecessor')
  if (Object.keys(parsed).length !== names.length || Object.keys(parsed).some(key => !names.includes(key))) fail()
  for (const [key, value] of Object.entries(expected)) if (parsed[key] !== value) fail()
  const created = Date.parse(parsed.createdAt), expiry = Date.parse(parsed.expiresAt)
  if (!NATIVE_UUID.test(parsed.releaseId ?? '') || !Number.isSafeInteger(created) || !Number.isSafeInteger(expiry)
    || created > now || !recovery && expiry <= now || expiry <= created || expiry - created > 24 * 60 * 60_000
    || starting && expiry - now < 35 * 60_000) fail()
  if (Object.hasOwn(parsed, 'adapterPredecessor') && parsed.adapterPredecessor !== null) {
    const prior = parsed.adapterPredecessor
    const keys = ['releaseId', 'sourceSha', 'sourceTree', 'configDigest', 'manifestDigest', 'receiptDigest',
      'operation', 'mode', 'versionId', 'deploymentId', 'namespaceId']
    if (!prior || Object.keys(prior).length !== keys.length || Object.keys(prior).some(key => !keys.includes(key))
      || !NATIVE_UUID.test(prior.releaseId ?? '') || prior.releaseId === parsed.releaseId
      || !sha.test(prior.sourceSha ?? '') || !sha.test(prior.sourceTree ?? '') || !digest.test(prior.configDigest ?? '')
      || !digest.test(prior.manifestDigest ?? '') || !digest.test(prior.receiptDigest ?? '')
      || prior.mode !== nativeAdapterMode(prior.operation) || !NATIVE_UUID.test(prior.versionId ?? '')
      || typeof prior.deploymentId !== 'string' || !prior.deploymentId || prior.deploymentId.length > 128
      || typeof prior.namespaceId !== 'string' || !prior.namespaceId || prior.namespaceId.length > 128) fail()
  }
  return parsed
}

export function nativeAdapterMode(operation) {
  if (operation === 'adapter-bootstrap-disabled') return 'bootstrap-disabled'
  if (operation === 'adapter-enable') return 'ready'
  if (operation === 'adapter-disable') return 'disabled'
  if (operation === 'adapter-reconcile-disable') return 'reconciled-disabled'
  fail()
}

export const nativeMessage = (manifest, surface, mode) => `schedule-native:${surface}:${mode}:${manifest.sourceSha}:${manifest.releaseId}`

export function assertNativeVersion(deployment, version, { manifest, surface, mode, expectedVersionId, expiresAtMs }) {
  if (!['core', 'adapter', 'probe'].includes(surface) || !['ready', 'disabled', 'bootstrap-disabled', 'reconciled-disabled', 'probe'].includes(mode)
    || mode === 'reconciled-disabled' && surface !== 'adapter'
    || !NATIVE_UUID.test(version?.id ?? '') || deployment?.versions?.length !== 1
    || deployment.versions[0].percentage !== 100 || deployment.versions[0].version_id !== version.id
    || expectedVersionId !== undefined && expectedVersionId !== version.id) fail()
  const wantedMessage = nativeMessage(manifest, surface, mode)
  const messages = [deployment?.annotations?.['workers/message'], version?.annotations?.['workers/message']].filter(value => value !== undefined)
  if (!messages.length || messages.some(value => value !== wantedMessage)) fail()
  const bindings = version?.resources?.bindings
  if (!Array.isArray(bindings) || bindings.length > 100 || new Set(bindings.map(item => item?.name)).size !== bindings.length) fail()
  const binding = name => bindings.find(item => item.name === name)
  const plain = (name, value) => binding(name)?.type === 'plain_text' && binding(name).text === String(value)
  if (surface === 'probe') {
    if (!plain('PROBE_SOURCE_SHA', manifest.sourceSha) || !plain('PROBE_NATIVE_RELEASE_ID', manifest.releaseId)
      || !Number.isSafeInteger(expiresAtMs) || !plain('PROBE_EXPIRES_AT_MS', expiresAtMs)
      || binding('SCHEDULE_PUBLIC_READ')?.type !== 'service'
      || binding('SCHEDULE_PUBLIC_READ').service !== manifest.adapterWorker
      || binding('SCHEDULE_PUBLIC_READ_PROBE_HMAC_KEY')?.type !== 'secret_text'
      || binding('SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY')?.type !== 'secret_text'
      || bindings.some(item => ['d1', 'durable_object_namespace'].includes(item.type))) fail()
  } else {
    if (!plain('SCHEDULE_PUBLIC_READ_ENABLED', mode === 'ready')
      || !plain('SCHEDULE_PUBLIC_READ_SOURCE_SHA', manifest.sourceSha)
      || !plain('SCHEDULE_PUBLIC_READ_NATIVE_RELEASE_ID', manifest.releaseId)
      || !plain('SCHEDULE_PUBLIC_READ_NATIVE_CONFIG_SHA256', manifest.configDigest)) fail()
    if (surface === 'core' && (binding('DB')?.type !== 'd1' || binding('DB').id !== manifest.coreDatabaseId
      || binding('ESCALA_ACTOR_HMAC_KEY')?.type !== 'secret_text'
      || binding('SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY')?.type !== 'secret_text')) fail()
    if (surface === 'adapter' && (bindings.some(item => item.type === 'd1')
      || binding('SCHEDULE_CORE')?.type !== 'service' || binding('SCHEDULE_CORE').service !== manifest.coreWorker
      || binding('SCHEDULE_CORE').environment !== undefined && binding('SCHEDULE_CORE').environment !== 'production'
      || binding('SCHEDULE_CORE').entrypoint !== undefined && binding('SCHEDULE_CORE').entrypoint !== null && binding('SCHEDULE_CORE').entrypoint !== ''
      || binding('SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY')?.type !== 'secret_text'
      || binding('SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY')?.type !== 'secret_text'
      || binding('SCHEDULE_PUBLIC_READ_NONCE_GUARD')?.type !== 'durable_object_namespace'
      || binding('SCHEDULE_PUBLIC_READ_NONCE_GUARD').class_name !== 'SchedulePublicReadNonceGuard'
      || typeof binding('SCHEDULE_PUBLIC_READ_NONCE_GUARD').namespace_id !== 'string'
      || !binding('SCHEDULE_PUBLIC_READ_NONCE_GUARD').namespace_id)) fail()
  }
  return Object.freeze({ versionId: version.id, deploymentId: deployment.id, surface, mode })
}
