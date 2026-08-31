#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const DEFAULT_ROOT = path.resolve(__dirname, '..')
export const DEFAULT_MANIFEST = 'messaging/channels/whatsapp/adapter-boundary.json'

export const DIRECT_TRANSFER_CLOSURE = Object.freeze([
  'crm/api/services/evolutionOrchestrator.js',
  'crm/api/services/whatsappOrchestrator.js',
  'crm/api/services/__tests__/evolutionOrchestrator.test.js',
  'crm/api/services/__tests__/whatsappOrchestrator.basic.test.js',
  'docs/architecture/whatsapp-adapter-extraction.md',
  'messaging/channels/whatsapp/adapter-boundary.json',
  'scripts/tests/whatsapp-adapter-boundary.test.mjs',
  'scripts/validate-whatsapp-adapter-boundary.mjs'
])

export const CUSTODY_RELEASE_BASELINE = Object.freeze([
  '.github/workflows/messaging-whatsapp-release-contract.yml',
  'messaging/channels/whatsapp/README.md',
  'ops/runtime/units/messaging-whatsapp.service',
  'scripts/runtime/messaging-whatsapp-release-contract.mjs',
  'scripts/runtime/messaging-whatsapp-release-contract.test.mjs',
  'scripts/runtime/prepare-messaging-whatsapp-release.sh',
  'scripts/runtime/rollback-messaging-whatsapp-release.sh',
  'scripts/runtime/run-messaging-whatsapp-release.sh',
  'scripts/runtime/test-prepare-messaging-whatsapp-release.sh',
  'scripts/runtime/test-rollback-messaging-whatsapp-release.sh',
  'scripts/runtime/test-run-messaging-whatsapp-release.sh'
])

export const SHARED_PLATFORM_INPUTS = Object.freeze([
  '.github/workflows/prepare-release-candidate.yml',
  'scripts/codex-global-coordinator.mjs',
  'scripts/codex-release-manifest.mjs',
  'scripts/runtime/global-coordination-mini-pc.sh',
  'scripts/runtime/install-lifecycle-units.sh',
  'scripts/runtime/manage-native-runtime.sh',
  'scripts/runtime/prepare-lifecycle-layout.sh'
])

export const EXCLUDED_SOURCE_PATHS = Object.freeze([
  'messaging/channels/whatsapp/engine/**',
  'crm/api/services/waMessageMetaStore.js',
  'crm/api/server.js'
])

function fail(message) {
  throw new Error(`WhatsApp adapter extraction boundary: ${message}`)
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function string(value, label) {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} must be a non-empty string.`)
  return value.trim()
}

function safeRelativePath(value, label) {
  const normalized = string(value, label).replaceAll('\\', '/')
  if (
    normalized.startsWith('/') ||
    normalized.includes('\0') ||
    normalized.split('/').includes('..') ||
    path.posix.normalize(normalized) !== normalized
  ) {
    fail(`${label} is not a safe repository-relative path.`)
  }
  return normalized
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) fail(`${label} must be a non-empty array.`)
  const normalized = value.map((entry, index) => string(entry, `${label}[${index}]`))
  if (new Set(normalized).size !== normalized.length) fail(`${label} must not contain duplicate entries.`)
  return normalized
}

function exactList(actual, expected, label) {
  const observed = stringArray(actual, label)
  const observedSorted = [...observed].sort()
  const expectedSorted = [...expected].sort()
  if (JSON.stringify(observedSorted) !== JSON.stringify(expectedSorted)) {
    fail(`${label} must match the reviewed source list exactly.`)
  }
  return observed
}

function resolveFile(root, relative, label) {
  const safe = safeRelativePath(relative, label)
  const candidate = path.resolve(root, safe)
  const resolvedRoot = path.resolve(root)
  if (candidate === resolvedRoot || !candidate.startsWith(resolvedRoot + path.sep)) {
    fail(`${label} escapes the repository root.`)
  }
  let stat
  try {
    stat = fs.statSync(candidate)
  } catch {
    fail(`${label} is missing: ${safe}`)
  }
  if (!stat.isFile()) fail(`${label} must identify a regular file: ${safe}`)
  return candidate
}

function readFile(root, relative, label) {
  return fs.readFileSync(resolveFile(root, relative, label), 'utf8')
}

function requireContains(text, expected, label) {
  if (!text.includes(expected)) fail(`${label} must contain ${JSON.stringify(expected)}.`)
}

function requireNotContains(text, forbidden, label) {
  if (text.includes(forbidden)) fail(`${label} must not contain ${JSON.stringify(forbidden)}.`)
}

function parseManifest(manifestFile) {
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
    if (!isObject(parsed)) fail('manifest must be a JSON object.')
    return parsed
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('WhatsApp adapter extraction boundary:')) throw error
    fail(`manifest is invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function assertDirectClosure(manifest, root) {
  const closure = exactList(manifest.directTransferClosure, DIRECT_TRANSFER_CLOSURE, 'directTransferClosure')
  for (const entry of closure) {
    safeRelativePath(entry, 'directTransferClosure entry')
    if (entry.startsWith('messaging/channels/whatsapp/engine/')) {
      fail('directTransferClosure must never include Evolution engine source.')
    }
    if (entry === 'crm/api/services/waMessageMetaStore.js' || entry === 'crm/api/server.js') {
      fail('directTransferClosure must not move CRM-owned state or routes.')
    }
    if (entry.startsWith('scripts/runtime/')) {
      fail('directTransferClosure must not claim unreworked native custody scripts as portable adapter source.')
    }
    resolveFile(root, entry, 'directTransferClosure entry')
  }
}

function assertCustodyBaseline(manifest, root) {
  if (!isObject(manifest.custodyReleaseBaseline)) fail('custodyReleaseBaseline must be an object.')
  if (manifest.custodyReleaseBaseline.transferMode !== 'rewrite-after-pinned-upstream-input') {
    fail('custodyReleaseBaseline.transferMode must require a pinned external engine input.')
  }
  exactList(manifest.custodyReleaseBaseline.sourcePaths, CUSTODY_RELEASE_BASELINE, 'custodyReleaseBaseline.sourcePaths')
  for (const entry of manifest.custodyReleaseBaseline.sourcePaths) {
    resolveFile(root, entry, 'custodyReleaseBaseline source')
    if (entry.startsWith('messaging/channels/whatsapp/engine/')) {
      fail('custodyReleaseBaseline must not transfer Evolution engine source.')
    }
  }
  requireContains(string(manifest.custodyReleaseBaseline.requiredRewrite, 'custodyReleaseBaseline.requiredRewrite'), 'pinned immutable upstream artifact', 'custodyReleaseBaseline.requiredRewrite')
  const facts = stringArray(manifest.custodyReleaseBaseline.requiredReleaseFacts, 'custodyReleaseBaseline.requiredReleaseFacts')
  for (const expected of [
    'only release-source-<SHA> candidates are release inputs',
    'promotion requires an installed attested predecessor',
    'external authenticated custody binds workflow run, artifact identity and source-archive digest before apply',
    'rollback restarts messaging-whatsapp.service and verifies http://127.0.0.1:8080/health'
  ]) {
    if (!facts.includes(expected)) fail(`custodyReleaseBaseline.requiredReleaseFacts is missing ${JSON.stringify(expected)}.`)
  }
}

function assertPlatformOwnership(manifest, root) {
  exactList(manifest.sharedPlatformInputs, SHARED_PLATFORM_INPUTS, 'sharedPlatformInputs')
  for (const entry of manifest.sharedPlatformInputs) resolveFile(root, entry, 'sharedPlatformInputs entry')
  exactList(manifest.excludedSourcePaths, EXCLUDED_SOURCE_PATHS, 'excludedSourcePaths')
  if (manifest.excludedSourcePaths.some((entry) => entry.startsWith('messaging/channels/whatsapp/engine/') && entry !== 'messaging/channels/whatsapp/engine/**')) {
    fail('excludedSourcePaths must exclude the entire Evolution engine tree.')
  }
}

function assertCrmCompatibility(manifest, root) {
  if (!isObject(manifest.crmCompatibility)) fail('crmCompatibility must be an object.')
  exactList(
    manifest.crmCompatibility.consumerSources,
    ['crm/api/services/evolutionOrchestrator.js', 'crm/api/services/whatsappOrchestrator.js'],
    'crmCompatibility.consumerSources'
  )
  if (manifest.crmCompatibility.legacyRouteNamespace !== '/api/wa-orchestrator/*') {
    fail('crmCompatibility.legacyRouteNamespace must preserve the CRM proxy namespace.')
  }
  if (manifest.crmCompatibility.defaultEngineUrl !== 'http://127.0.0.1:8080') {
    fail('crmCompatibility.defaultEngineUrl must remain the single local engine target.')
  }
  if (manifest.crmCompatibility.instancePrefix !== 'crm-channel-') {
    fail('crmCompatibility.instancePrefix must preserve CRM channel names.')
  }
  const channels = manifest.crmCompatibility.channels
  if (!isObject(channels) || channels.first !== 1 || channels.last !== 9 || channels.legacyFirstPort !== 3001 || channels.legacyLastPort !== 3009) {
    fail('crmCompatibility.channels must preserve the reviewed 1-9 and 3001-3009 mapping.')
  }
  if (!isObject(manifest.crmCompatibility.crmOnlyState)) fail('crmCompatibility.crmOnlyState must be an object.')
  const crmOnlyState = manifest.crmCompatibility.crmOnlyState
  if (
    crmOnlyState.source !== 'crm/api/services/waMessageMetaStore.js' ||
    crmOnlyState.environmentVariable !== 'WA_MESSAGE_META_FILE' ||
    crmOnlyState.defaultSuffix !== 'core/wa_message_meta.json'
  ) {
    fail('crmCompatibility.crmOnlyState must preserve CRM ownership of message metadata.')
  }

  const adapter = readFile(root, 'crm/api/services/whatsappOrchestrator.js', 'CRM compatibility adapter')
  requireContains(adapter, "import { evolutionOrchestrator } from './evolutionOrchestrator.js'", 'CRM compatibility adapter')
  requireContains(adapter, 'delegated to\n * the single native WhatsApp engine', 'CRM compatibility adapter')
  for (const forbidden of ['child_process', 'spawn(', 'fork(', 'systemctl', 'start-evolution-api.sh', 'messaging/channels/whatsapp/engine']) {
    requireNotContains(adapter, forbidden, 'CRM compatibility adapter')
  }

  const evolution = readFile(root, 'crm/api/services/evolutionOrchestrator.js', 'CRM Evolution adapter')
  requireContains(evolution, "'http://127.0.0.1:8080'", 'CRM Evolution adapter')
  requireContains(evolution, "const DEFAULT_INSTANCE_PREFIX = 'crm-channel-'", 'CRM Evolution adapter')
  requireContains(evolution, 'const DEFAULT_CHANNELS = Array.from({ length: 9 }', 'CRM Evolution adapter')
  requireContains(evolution, 'fetch(', 'CRM Evolution adapter')
  for (const forbidden of ['child_process', 'spawn(', 'fork(', 'systemctl', 'start-evolution-api.sh', 'messaging/channels/whatsapp/engine']) {
    requireNotContains(evolution, forbidden, 'CRM Evolution adapter')
  }

  const metadata = readFile(root, 'crm/api/services/waMessageMetaStore.js', 'CRM message metadata store')
  requireContains(metadata, 'WA_MESSAGE_META_FILE', 'CRM message metadata store')
  requireContains(metadata, 'wa_message_meta.json', 'CRM message metadata store')
}

function assertRuntimeAndRollback(manifest, root) {
  if (!isObject(manifest.runtimeAndObservability)) fail('runtimeAndObservability must be an object.')
  const runtime = manifest.runtimeAndObservability
  if (runtime.singleServiceUnit !== 'messaging-whatsapp.service') {
    fail('runtimeAndObservability.singleServiceUnit must be messaging-whatsapp.service.')
  }
  if (runtime.serviceTemplate !== 'ops/runtime/units/messaging-whatsapp.service') {
    fail('runtimeAndObservability.serviceTemplate must name the reviewed service unit.')
  }
  if (runtime.releaseRoot !== '/opt/skincos/current/messaging-whatsapp') {
    fail('runtimeAndObservability.releaseRoot must name the immutable release link.')
  }
  exactList(runtime.statePaths, [
    '__STATE_ROOT__/messaging-whatsapp/instances',
    '__STATE_ROOT__/messaging-whatsapp/store'
  ], 'runtimeAndObservability.statePaths')
  if (runtime.configurationPath !== '__CONFIG_ROOT__/messaging-whatsapp.env') {
    fail('runtimeAndObservability.configurationPath must name the private service overlay.')
  }
  exactList(runtime.logPaths, [
    '__LOG_ROOT__/messaging-whatsapp/runtime.out.log',
    '__LOG_ROOT__/messaging-whatsapp/runtime.err.log'
  ], 'runtimeAndObservability.logPaths')
  const prohibited = stringArray(runtime.prohibited, 'runtimeAndObservability.prohibited')
  for (const expected of [
    'a second systemd unit or process manager for Evolution',
    'a checkout or worktree runtime root',
    'a copied Evolution source tree',
    'adapter ownership of CRM conversation metadata'
  ]) {
    if (!prohibited.includes(expected)) fail(`runtimeAndObservability.prohibited is missing ${JSON.stringify(expected)}.`)
  }

  const service = readFile(root, runtime.serviceTemplate, 'messaging service template')
  const execStarts = service.match(/^ExecStart=/gm) || []
  if (execStarts.length !== 1) fail('messaging service template must define exactly one ExecStart.')
  requireContains(service, 'WorkingDirectory=/opt/skincos/current/messaging-whatsapp', 'messaging service template')
  requireContains(service, 'ExecStart=/opt/skincos/current/messaging-whatsapp/.skincos-run-messaging-whatsapp-release.sh', 'messaging service template')
  requireContains(service, 'Environment=EVOLUTION_API_INSTANCES_DIR=__STATE_ROOT__/messaging-whatsapp/instances', 'messaging service template')
  requireContains(service, 'Environment=EVOLUTION_API_STORE_DIR=__STATE_ROOT__/messaging-whatsapp/store', 'messaging service template')
  requireContains(service, 'StandardOutput=append:__LOG_ROOT__/messaging-whatsapp/runtime.out.log', 'messaging service template')
  requireContains(service, 'StandardError=append:__LOG_ROOT__/messaging-whatsapp/runtime.err.log', 'messaging service template')
  for (const forbidden of ['crm/api', 'messaging/channels/whatsapp/engine', 'start-evolution-api.sh']) {
    requireNotContains(service, forbidden, 'messaging service template')
  }

  const prepare = readFile(root, 'scripts/runtime/prepare-messaging-whatsapp-release.sh', 'messaging promotion baseline')
  requireContains(prepare, 'release-source-<SHA>', 'messaging promotion baseline')
  requireContains(prepare, 'external authenticated release custody', 'messaging promotion baseline')
  requireContains(prepare, 'IMMUTABLE_ENGINE', 'messaging promotion baseline')
  requireNotContains(prepare, '"$ROOT_DIR/messaging/channels/whatsapp/engine/"', 'messaging promotion baseline')

  const launcher = readFile(root, 'scripts/runtime/run-messaging-whatsapp-release.sh', 'messaging runtime launcher')
  requireContains(launcher, 'exec "$NODE_BIN" dist/main.js', 'messaging runtime launcher')
  requireNotContains(launcher, 'npm --prefix', 'messaging runtime launcher')
  requireNotContains(launcher, 'prisma', 'messaging runtime launcher')

  const rollback = readFile(root, 'scripts/runtime/rollback-messaging-whatsapp-release.sh', 'messaging rollback baseline')
  requireContains(rollback, 'systemctl restart messaging-whatsapp.service', 'messaging rollback baseline')
  requireContains(rollback, 'http://127.0.0.1:8080/health', 'messaging rollback baseline')
  requireContains(rollback, 'external authenticated release custody', 'messaging rollback baseline')
}

function assertCutoverGate(manifest) {
  if (!isObject(manifest.cutoverGate)) fail('cutoverGate must be an object.')
  const requirements = stringArray(manifest.cutoverGate.requiredBeforeRepositoryCreation, 'cutoverGate.requiredBeforeRepositoryCreation')
  for (const expected of [
    'package the direct adapter closure with an exact private version for CRM',
    'replace the embedded engine source input with a pinned external upstream artifact and digest',
    'define the signed Platform/Ops custody interface without copying global coordinator code',
    'prove a single publisher, single service unit, preview or staging smoke and executable rollback'
  ]) {
    if (!requirements.includes(expected)) fail(`cutoverGate.requiredBeforeRepositoryCreation is missing ${JSON.stringify(expected)}.`)
  }
  requireContains(string(manifest.cutoverGate.currentAction, 'cutoverGate.currentAction'), 'No repository creation', 'cutoverGate.currentAction')
}

export function validateWhatsappAdapterBoundary({ root = DEFAULT_ROOT, manifestFile } = {}) {
  const resolvedRoot = path.resolve(root)
  const resolvedManifest = manifestFile ? path.resolve(manifestFile) : resolveFile(resolvedRoot, DEFAULT_MANIFEST, 'manifest')
  const manifest = parseManifest(resolvedManifest)

  if (manifest.schemaVersion !== 1) fail('schemaVersion must equal 1.')
  if (manifest.candidateRepository !== 'skincos-whatsapp-adapter') fail('candidateRepository must be skincos-whatsapp-adapter.')
  if (manifest.status !== 'pre-cut') fail('status must remain pre-cut until all cutover gates are proven.')
  if (!isObject(manifest.baseline)) fail('baseline must be an object.')
  if (!/^[0-9a-f]{40}$/i.test(string(manifest.baseline.sourceCommit, 'baseline.sourceCommit'))) {
    fail('baseline.sourceCommit must be a full Git SHA.')
  }
  if (!/^[0-9a-f]{40}$/i.test(string(manifest.baseline.sourceTree, 'baseline.sourceTree'))) {
    fail('baseline.sourceTree must be a full Git tree SHA.')
  }
  if (!isObject(manifest.ownership)) fail('ownership must be an object.')
  if (manifest.ownership.futureRepositoryOwner !== 'Messaging') fail('ownership.futureRepositoryOwner must remain Messaging.')

  assertDirectClosure(manifest, resolvedRoot)
  assertCustodyBaseline(manifest, resolvedRoot)
  assertPlatformOwnership(manifest, resolvedRoot)
  assertCrmCompatibility(manifest, resolvedRoot)
  assertRuntimeAndRollback(manifest, resolvedRoot)
  assertCutoverGate(manifest)

  return {
    ok: true,
    candidateRepository: manifest.candidateRepository,
    status: manifest.status,
    directTransferFiles: manifest.directTransferClosure.length,
    custodyBaselineFiles: manifest.custodyReleaseBaseline.sourcePaths.length,
    excludedEnginePath: manifest.excludedSourcePaths[0],
    singleServiceUnit: manifest.runtimeAndObservability.singleServiceUnit
  }
}

function parseArguments(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index]
    if (option === '--root') {
      if (!argv[index + 1]) fail('--root requires a value.')
      options.root = argv[index + 1]
      index += 1
      continue
    }
    if (option === '--manifest') {
      if (!argv[index + 1]) fail('--manifest requires a value.')
      options.manifestFile = argv[index + 1]
      index += 1
      continue
    }
    if (option === '-h' || option === '--help') {
      process.stdout.write('Usage: node scripts/validate-whatsapp-adapter-boundary.mjs [--root <repo-root>] [--manifest <file>]\n')
      process.exit(0)
    }
    fail(`unknown option ${JSON.stringify(option)}.`)
  }
  return options
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = validateWhatsappAdapterBoundary(parseArguments(process.argv.slice(2)))
  process.stdout.write(`${JSON.stringify(result)}\n`)
}
