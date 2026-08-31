#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BASELINE_SOURCE_COMMIT,
  BASELINE_SOURCE_TREE,
  PORTABLE_LAYOUT,
  REQUIRED_EVIDENCE_KEYS,
  REVIEWED_ADAPTER_SOURCE_DIGESTS
} from './validate-whatsapp-adapter-candidate.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const DEFAULT_ROOT = path.resolve(__dirname, '..')
export const DEFAULT_MANIFEST = 'messaging/channels/whatsapp/adapter-boundary.json'

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

function fail(message) {
  throw new Error('WhatsApp adapter baseline: ' + message)
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function string(value, label) {
  if (typeof value !== 'string' || !value.trim()) fail(label + ' must be a non-empty string.')
  return value.trim()
}

function stringArray(value, label) {
  if (!Array.isArray(value)) fail(label + ' must be an array.')
  return value.map((entry, index) => string(entry, label + '[' + index + ']'))
}

function safeRelativePath(value, label) {
  const normalized = string(value, label).replaceAll('\\', '/')
  if (
    normalized === '.' ||
    normalized.startsWith('/') ||
    normalized.includes('\0') ||
    normalized.split('/').includes('..') ||
    path.posix.normalize(normalized) !== normalized
  ) {
    fail(label + ' is not a safe repository-relative path.')
  }
  return normalized
}

function exactList(actual, expected, label) {
  if (!Array.isArray(actual) || actual.length !== expected.length) fail(label + ' must match the reviewed list exactly.')
  const observed = actual.map((entry, index) => string(entry, label + '[' + index + ']')).sort()
  const wanted = [...expected].sort()
  if (JSON.stringify(observed) !== JSON.stringify(wanted)) fail(label + ' must match the reviewed list exactly.')
}

function exactLayout(actual) {
  if (!Array.isArray(actual) || actual.length !== PORTABLE_LAYOUT.length) fail('portableClosure.layout must match the reviewed layout exactly.')
  const normalize = (entry, index) => {
    if (!isObject(entry)) fail('portableClosure.layout[' + index + '] must be an object.')
    return safeRelativePath(entry.source, 'portableClosure.layout[' + index + '].source') + '\0' +
      safeRelativePath(entry.target, 'portableClosure.layout[' + index + '].target')
  }
  const observed = actual.map(normalize).sort()
  const expected = PORTABLE_LAYOUT.map((entry) => entry.source + '\0' + entry.target).sort()
  if (JSON.stringify(observed) !== JSON.stringify(expected)) fail('portableClosure.layout must match the reviewed layout exactly.')
}

function resolveFile(root, relative, label) {
  const safe = safeRelativePath(relative, label)
  const candidate = path.resolve(root, safe)
  const resolvedRoot = path.resolve(root)
  if (candidate === resolvedRoot || !candidate.startsWith(resolvedRoot + path.sep)) fail(label + ' escapes the repository root.')
  let stat
  try {
    stat = fs.lstatSync(candidate)
  } catch {
    fail(label + ' is missing: ' + safe + '.')
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail(label + ' must identify a regular file: ' + safe + '.')
  return candidate
}

function readFile(root, relative, label) {
  return fs.readFileSync(resolveFile(root, relative, label), 'utf8')
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function parseManifest(manifestFile) {
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
    if (!isObject(parsed)) fail('manifest must be a JSON object.')
    return parsed
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('WhatsApp adapter baseline:')) throw error
    fail('manifest is invalid JSON.')
  }
}

function requireContains(text, expected, label) {
  if (!text.includes(expected)) fail(label + ' must contain ' + JSON.stringify(expected) + '.')
}

function requireNotContains(text, forbidden, label) {
  if (text.includes(forbidden)) fail(label + ' must not contain ' + JSON.stringify(forbidden) + '.')
}

function gitOutput(root, args, label) {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim().toLowerCase()
  } catch {
    fail(label + ' could not be verified from Git.')
  }
}

function gitBytes(root, args, label) {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'buffer',
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch {
    fail(label + ' could not be verified from Git.')
  }
}

function assertBaselineIdentity(manifest, root) {
  if (!isObject(manifest.baseline)) fail('baseline must be an object.')
  if (manifest.baseline.sourceCommit !== BASELINE_SOURCE_COMMIT || manifest.baseline.sourceTree !== BASELINE_SOURCE_TREE) {
    fail('baseline source commit and tree must match the reviewed values exactly.')
  }
  const observedTree = gitOutput(root, ['rev-parse', BASELINE_SOURCE_COMMIT + '^{tree}'], 'baseline source tree')
  if (observedTree !== BASELINE_SOURCE_TREE) fail('baseline source tree does not resolve to the reviewed Git tree.')
}

function assertPortableSourceClosure(manifest, root) {
  if (!isObject(manifest.portableClosure)) fail('portableClosure must be an object.')
  exactLayout(manifest.portableClosure.layout)
  for (const entry of manifest.portableClosure.layout) {
    const source = safeRelativePath(entry.source, 'portableClosure source')
    const target = safeRelativePath(entry.target, 'portableClosure target')
    if (
      source.startsWith('messaging/channels/whatsapp/engine/') ||
      source === 'crm/api/services/waMessageMetaStore.js' ||
      source === 'crm/api/server.js' ||
      source.startsWith('scripts/runtime/')
    ) {
      fail('portableClosure must not include engine, CRM state/routes or unreworked native custody.')
    }
    resolveFile(root, source, 'portableClosure source')
    if (!target) fail('portableClosure target is required.')
  }
  for (const [relative, expectedDigest] of Object.entries(REVIEWED_ADAPTER_SOURCE_DIGESTS)) {
    const reviewedDigest = sha256(gitBytes(root, ['show', BASELINE_SOURCE_COMMIT + ':' + relative], 'reviewed portable adapter source'))
    if (reviewedDigest !== expectedDigest) {
      fail('reviewed portable adapter source digest is not bound to the ' + BASELINE_SOURCE_COMMIT + ' Git blob: ' + relative + '.')
    }
    const observedDigest = sha256(fs.readFileSync(resolveFile(root, relative, 'reviewed portable adapter source')))
    if (observedDigest !== expectedDigest) {
      fail('reviewed portable adapter source digest does not match the ' + BASELINE_SOURCE_COMMIT + ' baseline: ' + relative + '.')
    }
  }

  const compatibility = readFile(root, 'crm/api/services/whatsappOrchestrator.js', 'CRM compatibility adapter')
  const evolution = readFile(root, 'crm/api/services/evolutionOrchestrator.js', 'CRM Evolution HTTP adapter')
  for (const forbidden of ['child_process', 'spawn(', 'fork(', 'systemctl', 'start-evolution-api.sh', 'messaging/channels/whatsapp/engine', 'waMessageMetaStore']) {
    requireNotContains(compatibility, forbidden, 'CRM compatibility adapter')
    requireNotContains(evolution, forbidden, 'CRM Evolution HTTP adapter')
  }
  requireContains(compatibility, "import { evolutionOrchestrator } from './evolutionOrchestrator.js'", 'CRM compatibility adapter')
  requireContains(compatibility, 'single native WhatsApp engine', 'CRM compatibility adapter')
  requireContains(evolution, "'http://127.0.0.1:8080'", 'CRM Evolution HTTP adapter')
  requireContains(evolution, "const DEFAULT_INSTANCE_PREFIX = 'crm-channel-'", 'CRM Evolution HTTP adapter')
  requireContains(evolution, 'const DEFAULT_CHANNELS = Array.from({ length: 9 }', 'CRM Evolution HTTP adapter')
  requireContains(evolution, 'fetch(', 'CRM Evolution HTTP adapter')

  const packageTemplate = JSON.parse(readFile(root, 'messaging/channels/whatsapp/adapter-package.json', 'portable package template'))
  if (packageTemplate.private !== true || packageTemplate.version !== '0.0.0-precut') {
    fail('portable package template must remain private and pre-cut.')
  }
}

function assertCustodyBaseline(manifest, root) {
  if (!isObject(manifest.custodyReleaseBaseline)) fail('custodyReleaseBaseline must be an object.')
  if (manifest.custodyReleaseBaseline.transferMode !== 'rewrite-after-pinned-upstream-input') {
    fail('custodyReleaseBaseline.transferMode must require a pinned upstream input.')
  }
  exactList(manifest.custodyReleaseBaseline.sourcePaths, CUSTODY_RELEASE_BASELINE, 'custodyReleaseBaseline.sourcePaths')
  for (const entry of manifest.custodyReleaseBaseline.sourcePaths) {
    resolveFile(root, entry, 'custodyReleaseBaseline source')
    if (entry.startsWith('messaging/channels/whatsapp/engine/')) {
      fail('custodyReleaseBaseline must not transfer Evolution engine source.')
    }
  }
  requireContains(string(manifest.custodyReleaseBaseline.requiredRewrite, 'custodyReleaseBaseline.requiredRewrite'), 'pinned immutable upstream artifact', 'custodyReleaseBaseline.requiredRewrite')

  const facts = manifest.custodyReleaseBaseline.requiredReleaseFacts
  exactList(facts, [
    'only release-source-<SHA> candidates are release inputs',
    'promotion requires an installed attested predecessor',
    'external authenticated custody binds workflow run, artifact identity and source-archive digest before apply',
    'rollback restarts messaging-whatsapp.service and verifies http://127.0.0.1:8080/health'
  ], 'custodyReleaseBaseline.requiredReleaseFacts')

  exactList(manifest.sharedPlatformInputs, SHARED_PLATFORM_INPUTS, 'sharedPlatformInputs')
  for (const entry of manifest.sharedPlatformInputs) resolveFile(root, entry, 'sharedPlatformInputs entry')
}

function assertCrmCompatibility(manifest, root) {
  if (!isObject(manifest.crmCompatibility)) fail('crmCompatibility must be an object.')
  const compatibility = manifest.crmCompatibility
  exactList(
    compatibility.consumerSources,
    ['crm/api/services/evolutionOrchestrator.js', 'crm/api/services/whatsappOrchestrator.js'],
    'crmCompatibility.consumerSources'
  )
  if (compatibility.legacyRouteNamespace !== '/api/wa-orchestrator/*') {
    fail('crmCompatibility.legacyRouteNamespace must preserve the CRM proxy namespace.')
  }
  if (compatibility.defaultEngineUrl !== 'http://127.0.0.1:8080') {
    fail('crmCompatibility.defaultEngineUrl must remain the single local engine target.')
  }
  if (compatibility.instancePrefix !== 'crm-channel-') {
    fail('crmCompatibility.instancePrefix must preserve CRM channel names.')
  }
  const channels = compatibility.channels
  if (!isObject(channels) || channels.first !== 1 || channels.last !== 9 || channels.legacyFirstPort !== 3001 || channels.legacyLastPort !== 3009) {
    fail('crmCompatibility.channels must preserve the reviewed 1-9 and 3001-3009 mapping.')
  }
  if (!isObject(compatibility.crmOnlyState)) fail('crmCompatibility.crmOnlyState must be an object.')
  const crmOnlyState = compatibility.crmOnlyState
  if (
    crmOnlyState.source !== 'crm/api/services/waMessageMetaStore.js' ||
    crmOnlyState.environmentVariable !== 'WA_MESSAGE_META_FILE' ||
    crmOnlyState.defaultSuffix !== 'core/wa_message_meta.json'
  ) {
    fail('crmCompatibility.crmOnlyState must preserve CRM ownership of message metadata.')
  }

  const metadata = readFile(root, 'crm/api/services/waMessageMetaStore.js', 'CRM message metadata store')
  requireContains(metadata, 'WA_MESSAGE_META_FILE', 'CRM message metadata store')
  requireContains(metadata, 'wa_message_meta.json', 'CRM message metadata store')
}

function assertRuntimeAndCrmOwnership(manifest, root) {
  exactList(manifest.excludedSourcePaths, [
    'messaging/channels/whatsapp/engine/**',
    'crm/api/services/waMessageMetaStore.js',
    'crm/api/server.js'
  ], 'excludedSourcePaths')
  if (!isObject(manifest.runtimeAndObservability)) fail('runtimeAndObservability must be an object.')
  const runtime = manifest.runtimeAndObservability
  if (runtime.singleServiceUnit !== 'messaging-whatsapp.service') fail('runtimeAndObservability.singleServiceUnit must remain messaging-whatsapp.service.')
  if (runtime.serviceTemplate !== 'ops/runtime/units/messaging-whatsapp.service') fail('runtimeAndObservability.serviceTemplate must remain the reviewed service unit.')
  if (runtime.releaseRoot !== '/opt/skincos/current/messaging-whatsapp') fail('runtimeAndObservability.releaseRoot must remain the immutable release link.')
  exactList(runtime.statePaths, [
    '__STATE_ROOT__/messaging-whatsapp/instances',
    '__STATE_ROOT__/messaging-whatsapp/store'
  ], 'runtimeAndObservability.statePaths')
  if (runtime.configurationPath !== '__CONFIG_ROOT__/messaging-whatsapp.env') fail('runtimeAndObservability.configurationPath must remain private.')
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
    if (!prohibited.includes(expected)) {
      fail('runtimeAndObservability.prohibited is missing ' + JSON.stringify(expected) + '.')
    }
  }

  const service = readFile(root, runtime.serviceTemplate, 'messaging service template')
  if ((service.match(/^ExecStart=/gm) || []).length !== 1) fail('messaging service template must define exactly one ExecStart.')
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
  if (manifest.schemaVersion !== 2) fail('schemaVersion must equal 2.')
  if (manifest.candidateRepository !== 'skincos-whatsapp-adapter') fail('candidateRepository must be skincos-whatsapp-adapter.')
  if (manifest.status !== 'pre-cut') fail('status must remain pre-cut until the future cutover proves every fact.')
  if (!isObject(manifest.ownership) || manifest.ownership.futureRepositoryOwner !== 'Messaging') {
    fail('ownership.futureRepositoryOwner must remain Messaging.')
  }
  if (!isObject(manifest.cutoverGate)) fail('cutoverGate must be an object.')
  exactList(manifest.cutoverGate.requiredEvidence, REQUIRED_EVIDENCE_KEYS, 'cutoverGate.requiredEvidence')
  exactList(manifest.cutoverGate.requiredBeforeRepositoryCreation, [
    'package the direct adapter closure with an exact private version for CRM',
    'replace the embedded engine source input with a pinned external upstream artifact and digest',
    'define the signed Platform/Ops custody interface without copying global coordinator code',
    'prove a single publisher, single service unit, preview or staging smoke and executable rollback'
  ], 'cutoverGate.requiredBeforeRepositoryCreation')
  requireContains(string(manifest.cutoverGate.currentAction, 'cutoverGate.currentAction'), 'No repository creation', 'cutoverGate.currentAction')
}

export function validateWhatsappAdapterBaseline({ root = DEFAULT_ROOT, manifestFile } = {}) {
  const resolvedRoot = path.resolve(root)
  const resolvedManifest = manifestFile ? path.resolve(manifestFile) : resolveFile(resolvedRoot, DEFAULT_MANIFEST, 'manifest')
  const manifest = parseManifest(resolvedManifest)
  assertCutoverGate(manifest)
  assertBaselineIdentity(manifest, resolvedRoot)
  assertPortableSourceClosure(manifest, resolvedRoot)
  assertCustodyBaseline(manifest, resolvedRoot)
  assertCrmCompatibility(manifest, resolvedRoot)
  assertRuntimeAndCrmOwnership(manifest, resolvedRoot)
  return {
    ok: true,
    status: manifest.status,
    baselineSourceCommit: BASELINE_SOURCE_COMMIT,
    portableSourceFiles: PORTABLE_LAYOUT.length,
    custodyBaselineFiles: CUSTODY_RELEASE_BASELINE.length,
    singleServiceUnit: manifest.runtimeAndObservability.singleServiceUnit
  }
}

function parseArguments(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index]
    if (option === '--root' || option === '--manifest') {
      const value = argv[index + 1]
      if (!value) fail(option + ' requires a value.')
      options[option.slice(2) === 'root' ? 'root' : 'manifestFile'] = value
      index += 1
      continue
    }
    if (option === '-h' || option === '--help') {
      process.stdout.write('Usage: node scripts/validate-whatsapp-adapter-baseline.mjs [--root <repo-root>] [--manifest <file>]\n')
      process.exit(0)
    }
    fail('unknown option ' + JSON.stringify(option) + '.')
  }
  return options
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(JSON.stringify(validateWhatsappAdapterBaseline(parseArguments(process.argv.slice(2)))) + '\n')
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n')
    process.exitCode = 78
  }
}
