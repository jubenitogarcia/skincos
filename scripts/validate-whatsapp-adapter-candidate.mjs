#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const BASELINE_SOURCE_COMMIT = '8dfd728e31149517e4d4e6202fa4ef36d50ff46f'
export const BASELINE_SOURCE_TREE = 'a15c7b088a393452d4c12c82f07a29997df8acc5'
export const PORTABLE_LAYOUT = Object.freeze([
  { source: 'messaging/channels/whatsapp/adapter-package.json', target: 'package.json' },
  { source: 'messaging/channels/whatsapp/adapter-README.md', target: 'README.md' },
  { source: 'messaging/channels/whatsapp/adapter-boundary.json', target: 'adapter-boundary.json' },
  { source: 'crm/api/services/evolutionOrchestrator.js', target: 'crm/api/services/evolutionOrchestrator.js' },
  { source: 'crm/api/services/whatsappOrchestrator.js', target: 'crm/api/services/whatsappOrchestrator.js' },
  { source: 'crm/api/services/__tests__/evolutionOrchestrator.test.js', target: 'crm/api/services/__tests__/evolutionOrchestrator.test.js' },
  { source: 'crm/api/services/__tests__/whatsappOrchestrator.basic.test.js', target: 'crm/api/services/__tests__/whatsappOrchestrator.basic.test.js' },
  { source: 'scripts/validate-whatsapp-adapter-candidate.mjs', target: 'scripts/validate-whatsapp-adapter-candidate.mjs' }
])
export const PORTABLE_FILES = Object.freeze(PORTABLE_LAYOUT.map((entry) => entry.target).sort())
export const PORTABLE_VALIDATOR_PATH = 'scripts/validate-whatsapp-adapter-candidate.mjs'
const PORTABLE_DIRECTORIES = Object.freeze([...new Set(
  PORTABLE_FILES.flatMap((entry) => {
    const parts = entry.split('/')
    const directories = []
    parts.pop()
    while (parts.length) {
      directories.push(parts.join('/'))
      parts.pop()
    }
    return directories
  })
)].sort())
export const REQUIRED_EVIDENCE_KEYS = Object.freeze([
  'exactPrivatePackageForCrm',
  'pinnedUpstreamArtifact',
  'signedPlatformOpsCustody',
  'singlePublisherServiceAndRollback'
])
export const REVIEWED_ADAPTER_SOURCE_DIGESTS = Object.freeze({
  'crm/api/services/evolutionOrchestrator.js': '0b5902d384e8a6038aa47b232b54324a3e81010f67a5ccdb56c40532b4aab9ed',
  'crm/api/services/whatsappOrchestrator.js': '3dd6afe61cae3eabf11a41945ada94bb230ff948be383089c7bd06e27bce844f',
  'crm/api/services/__tests__/evolutionOrchestrator.test.js': '02215c705c79db812cb9f2e8050d967811b4918fb510796c44713b5a40f00416',
  'crm/api/services/__tests__/whatsappOrchestrator.basic.test.js': 'ad2fbf92209a8f95064eab16bed523bdf342fa161fbeab60c4deeecf34327c3c'
})
const EXPECTED_PACKAGE_FIELDS = Object.freeze([
  'description',
  'exports',
  'name',
  'private',
  'scripts',
  'type',
  'version'
])
const EXPECTED_PACKAGE_EXPORTS = Object.freeze({
  './evolution-orchestrator': './crm/api/services/evolutionOrchestrator.js',
  './compatibility-orchestrator': './crm/api/services/whatsappOrchestrator.js'
})
const EXPECTED_PACKAGE_SCRIPTS = Object.freeze({
  test: 'node --test crm/api/services/__tests__/whatsappOrchestrator.basic.test.js crm/api/services/__tests__/evolutionOrchestrator.test.js'
})

const MAX_CANDIDATE_FILE_BYTES = 2 * 1024 * 1024
const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024
const MAX_CANDIDATE_DIRECTORY_ENTRIES = PORTABLE_FILES.length + PORTABLE_DIRECTORIES.length + 8
const MAX_CANDIDATE_DIRECTORY_DEPTH = Math.max(...PORTABLE_FILES.map((entry) => entry.split('/').length)) + 1
const MAX_CANDIDATE_DIRECTORY_BYTES = MAX_ARCHIVE_BYTES
const PROHIBITED_PATHS = Object.freeze([
  'messaging/channels/whatsapp/engine/',
  'crm/api/services/waMessageMetaStore.js',
  'crm/api/server.js',
  'ops/',
  '.github/',
  'scripts/runtime/'
])

function fail(message) {
  throw new Error('WhatsApp adapter cutover candidate: ' + message)
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function string(value, label) {
  if (typeof value !== 'string' || !value.trim()) fail(label + ' must be a non-empty string.')
  return value.trim()
}

function digest(value, label) {
  const normalized = string(value, label).toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(normalized)) fail(label + ' must be a lowercase SHA-256 digest.')
  return normalized
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

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function exactList(actual, expected, label) {
  if (!Array.isArray(actual) || actual.length !== expected.length) fail(label + ' must match the reviewed list exactly.')
  const normalized = actual.map((entry, index) => string(entry, label + '[' + index + ']')).sort()
  const wanted = [...expected].sort()
  if (JSON.stringify(normalized) !== JSON.stringify(wanted)) fail(label + ' must match the reviewed list exactly.')
  return normalized
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

function parseJson(bytes, label) {
  try {
    const parsed = JSON.parse(Buffer.from(bytes).toString('utf8'))
    if (!isObject(parsed)) fail(label + ' must be a JSON object.')
    return parsed
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('WhatsApp adapter cutover candidate:')) throw error
    fail(label + ' is invalid JSON.')
  }
}

function assertProhibitedPath(relative) {
  const normalized = safeRelativePath(relative, 'candidate path')
  for (const forbidden of PROHIBITED_PATHS) {
    if (normalized === forbidden.slice(0, -1) || normalized.startsWith(forbidden)) {
      fail('candidate must not contain prohibited path ' + JSON.stringify(normalized) + '.')
    }
  }
}

function assertExactCandidateFiles(files, directories) {
  const observed = [...files.keys()].map((entry) => safeRelativePath(entry, 'candidate file')).sort()
  for (const entry of observed) assertProhibitedPath(entry)
  const missing = PORTABLE_FILES.filter((entry) => !files.has(entry))
  const unexpected = observed.filter((entry) => !PORTABLE_FILES.includes(entry))
  if (missing.length || unexpected.length) {
    fail('candidate closure must contain exactly the reviewed portable files; missing=' + JSON.stringify(missing) + ', unexpected=' + JSON.stringify(unexpected) + '.')
  }
  const unexpectedDirectories = [...directories]
    .map((entry) => safeRelativePath(entry, 'candidate directory'))
    .filter((entry) => !PORTABLE_DIRECTORIES.includes(entry))
    .sort()
  if (unexpectedDirectories.length) {
    fail('candidate closure must not contain unexpected directories: ' + JSON.stringify(unexpectedDirectories) + '.')
  }
}

function readDirectoryCandidate(candidate) {
  let rootStat
  try {
    rootStat = fs.lstatSync(candidate)
  } catch {
    fail('candidate directory is unavailable.')
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('candidate directory must be a real directory.')

  const files = new Map()
  const directories = new Set()
  let entriesSeen = 0
  let bytesRead = 0
  const visit = (directory, relative, depth) => {
    if (depth > MAX_CANDIDATE_DIRECTORY_DEPTH) {
      fail('candidate directory exceeds the safe nesting depth.')
    }
    const handle = fs.opendirSync(directory)
    try {
      while (true) {
        const entry = handle.readSync()
        if (!entry) break
        if (!relative && entry.name === '.git') continue
        entriesSeen += 1
        if (entriesSeen > MAX_CANDIDATE_DIRECTORY_ENTRIES) {
          fail('candidate directory exceeds the safe entry limit.')
        }
        const childRelative = relative ? relative + '/' + entry.name : entry.name
        const normalized = safeRelativePath(childRelative, 'candidate path')
        const child = path.join(directory, entry.name)
        const stat = fs.lstatSync(child)
        if (stat.isSymbolicLink()) fail('candidate must not contain symbolic links: ' + normalized + '.')
        if (stat.isDirectory()) {
          if (!PORTABLE_DIRECTORIES.includes(normalized)) {
            fail('candidate closure must not contain unexpected directory: ' + normalized + '.')
          }
          directories.add(normalized)
          visit(child, normalized, depth + 1)
          continue
        }
        if (!stat.isFile()) fail('candidate must contain only regular files: ' + normalized + '.')
        if (!PORTABLE_FILES.includes(normalized)) {
          fail('candidate closure must not contain unexpected file: ' + normalized + '.')
        }
        if (stat.size > MAX_CANDIDATE_FILE_BYTES) fail('candidate file exceeds the safe size limit: ' + normalized + '.')
        bytesRead += stat.size
        if (bytesRead > MAX_CANDIDATE_DIRECTORY_BYTES) {
          fail('candidate directory exceeds the safe total size limit.')
        }
        if (files.has(normalized)) fail('candidate contains a duplicate file path: ' + normalized + '.')
        files.set(normalized, fs.readFileSync(child))
      }
    } finally {
      handle.closeSync()
    }
  }
  visit(path.resolve(candidate), '', 0)
  return { candidateType: 'directory', files, directories, archiveSha256: null }
}

function normalizeTarPath(raw) {
  let normalized = String(raw || '').replace(/\r$/, '')
  while (normalized.startsWith('./')) normalized = normalized.slice(2)
  if (!normalized || normalized === '.') return { directory: true, path: null }
  const directory = normalized.endsWith('/')
  if (directory) normalized = normalized.replace(/\/+$/, '')
  return { directory, path: safeRelativePath(normalized, 'archive entry') }
}

function tarString(bytes, start, length) {
  const end = bytes.indexOf(0, start)
  const sliceEnd = end === -1 || end > start + length ? start + length : end
  return bytes.subarray(start, sliceEnd).toString('utf8')
}

function tarOctal(bytes, start, length, label) {
  const raw = tarString(bytes, start, length).trim()
  if (!raw) return 0
  if (!/^[0-7]+$/.test(raw)) fail('candidate archive has an invalid ' + label + '.')
  const value = Number.parseInt(raw, 8)
  if (!Number.isSafeInteger(value) || value < 0) fail('candidate archive has an invalid ' + label + '.')
  return value
}

function isEmptyTarBlock(block) {
  for (const byte of block) {
    if (byte !== 0) return false
  }
  return true
}

function tarChecksum(header) {
  let total = 0
  for (let index = 0; index < 512; index += 1) {
    total += index >= 148 && index < 156 ? 32 : header[index]
  }
  return total
}

function readArchiveCandidate(candidate) {
  let stat
  try {
    stat = fs.lstatSync(candidate)
  } catch {
    fail('candidate archive is unavailable.')
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail('candidate archive must be a regular file.')
  if (stat.size > MAX_ARCHIVE_BYTES) fail('candidate archive exceeds the safe size limit.')

  const archive = fs.readFileSync(candidate)
  if (archive.length < 1024 || archive.length % 512 !== 0) fail('candidate archive must be a complete regular TAR archive.')
  const files = new Map()
  const directories = new Set()
  let offset = 0
  let terminalBlocks = 0
  while (offset < archive.length) {
    const header = archive.subarray(offset, offset + 512)
    if (isEmptyTarBlock(header)) {
      terminalBlocks += 1
      offset += 512
      continue
    }
    if (terminalBlocks > 0) fail('candidate archive has data after its terminal TAR blocks.')
    if (tarOctal(header, 148, 8, 'header checksum') !== tarChecksum(header)) {
      fail('candidate archive header checksum does not match.')
    }

    const type = header[156]
    if (type !== 0 && type !== 48 && type !== 53) {
      fail('candidate archive must not contain links, devices or special records.')
    }
    const name = tarString(header, 0, 100)
    const prefix = tarString(header, 345, 155)
    const rawPath = prefix ? prefix + '/' + name : name
    const entry = normalizeTarPath(rawPath + (type === 53 && !rawPath.endsWith('/') ? '/' : ''))
    const size = tarOctal(header, 124, 12, 'entry size')
    const dataStart = offset + 512
    const paddedSize = Math.ceil(size / 512) * 512
    const nextOffset = dataStart + paddedSize
    if (nextOffset > archive.length) fail('candidate archive entry is truncated.')

    if (type === 53) {
      if (size !== 0) fail('candidate archive directory entries must be empty.')
      if (entry.path) {
        assertProhibitedPath(entry.path)
        if (directories.has(entry.path)) fail('candidate archive contains a duplicate directory path: ' + entry.path + '.')
        directories.add(entry.path)
      }
    } else {
      if (!entry.path || entry.directory) fail('candidate archive file entry has an invalid path.')
      assertProhibitedPath(entry.path)
      if (files.has(entry.path)) fail('candidate archive contains a duplicate file path: ' + entry.path + '.')
      const data = archive.subarray(dataStart, dataStart + size)
      if (data.length > MAX_CANDIDATE_FILE_BYTES) fail('candidate archive entry exceeds the safe size limit: ' + entry.path + '.')
      files.set(entry.path, data)
    }
    offset = nextOffset
  }
  if (terminalBlocks < 2) fail('candidate archive must end with two empty TAR blocks.')

  for (const [normalized, data] of files) {
    if (data.length > MAX_CANDIDATE_FILE_BYTES) fail('candidate archive entry exceeds the safe size limit: ' + normalized + '.')
  }
  return {
    candidateType: 'archive',
    files,
    directories,
    archiveSha256: sha256(archive)
  }
}

function readCandidate(candidate) {
  if (typeof candidate !== 'string' || !candidate.trim()) fail('candidate is required.')
  let stat
  try {
    stat = fs.lstatSync(candidate)
  } catch {
    fail('candidate is unavailable.')
  }
  if (stat.isDirectory()) return readDirectoryCandidate(candidate)
  if (stat.isFile()) return readArchiveCandidate(candidate)
  fail('candidate must be a directory or a regular TAR archive.')
}

function closureSha256(files) {
  const hash = crypto.createHash('sha256')
  for (const relative of [...files.keys()].sort()) {
    const fileDigest = sha256(files.get(relative))
    hash.update(relative)
    hash.update('\0')
    hash.update(fileDigest)
    hash.update('\n')
  }
  return hash.digest('hex')
}

function assertManifest(manifest) {
  if (manifest.schemaVersion !== 2) fail('adapter-boundary schemaVersion must equal 2.')
  if (manifest.candidateRepository !== 'skincos-whatsapp-adapter') fail('candidateRepository must be skincos-whatsapp-adapter.')
  if (manifest.status !== 'pre-cut') fail('candidate status must remain pre-cut until every cutover fact is proven.')
  if (!isObject(manifest.baseline)) fail('adapter-boundary baseline must be an object.')
  if (manifest.baseline.sourceCommit !== BASELINE_SOURCE_COMMIT || manifest.baseline.sourceTree !== BASELINE_SOURCE_TREE) {
    fail('candidate baseline must match the reviewed source commit and tree exactly.')
  }
  if (!isObject(manifest.portableClosure)) fail('portableClosure must be an object.')
  exactLayout(manifest.portableClosure.layout)
  if (!isObject(manifest.cutoverGate)) fail('cutoverGate must be an object.')
  exactList(manifest.cutoverGate.requiredEvidence, REQUIRED_EVIDENCE_KEYS, 'cutoverGate.requiredEvidence')
  const action = string(manifest.cutoverGate.currentAction, 'cutoverGate.currentAction')
  if (!action.includes('No repository creation')) fail('cutoverGate.currentAction must forbid repository creation.')
}

function assertPackage(packageJson) {
  exactList(Object.keys(packageJson), EXPECTED_PACKAGE_FIELDS, 'candidate package fields')
  if (packageJson.name !== '@jubenitogarcia/skincos-whatsapp-adapter') fail('candidate package name is not pinned.')
  if (packageJson.version !== '0.0.0-precut') fail('candidate package version must remain 0.0.0-precut.')
  if (packageJson.private !== true) fail('candidate package must remain private while pre-cut.')
  if (packageJson.type !== 'module') fail('candidate package must use the reviewed module mode.')
  if (typeof packageJson.description !== 'string' || !packageJson.description.trim()) fail('candidate package description must remain explicit.')
  for (const [label, actual, expected] of [
    ['candidate package exports', packageJson.exports, EXPECTED_PACKAGE_EXPORTS],
    ['candidate package scripts', packageJson.scripts, EXPECTED_PACKAGE_SCRIPTS]
  ]) {
    if (!isObject(actual)) fail(label + ' must be an object.')
    exactList(Object.keys(actual), Object.keys(expected), label + ' keys')
    for (const [key, value] of Object.entries(expected)) {
      if (actual[key] !== value) fail(label + ' must match the reviewed value for ' + key + '.')
    }
  }
}

function assertAdapterSources(files) {
  for (const [relative, expectedDigest] of Object.entries(REVIEWED_ADAPTER_SOURCE_DIGESTS)) {
    if (sha256(files.get(relative)) !== expectedDigest) {
      fail('portable adapter source digest does not match the reviewed ' + BASELINE_SOURCE_COMMIT + ' baseline: ' + relative + '.')
    }
  }
  const compatibility = files.get('crm/api/services/whatsappOrchestrator.js').toString('utf8')
  const evolution = files.get('crm/api/services/evolutionOrchestrator.js').toString('utf8')
  const forbidden = [
    'child_process',
    'spawn(',
    'fork(',
    'systemctl',
    'start-evolution-api.sh',
    'messaging/channels/whatsapp/engine',
    'waMessageMetaStore',
    'WA_MESSAGE_META_FILE'
  ]
  for (const token of forbidden) {
    if (compatibility.includes(token)) fail('portable compatibility adapter must not contain ' + JSON.stringify(token) + '.')
    if (evolution.includes(token)) fail('portable Evolution HTTP adapter must not contain ' + JSON.stringify(token) + '.')
  }
  if (!compatibility.includes("import { evolutionOrchestrator } from './evolutionOrchestrator.js'")) {
    fail('portable compatibility adapter must delegate to the Evolution HTTP adapter.')
  }
  if (!compatibility.includes('single native WhatsApp engine')) fail('portable compatibility adapter must preserve the single-engine contract.')
  if (!evolution.includes("'http://127.0.0.1:8080'")) fail('portable Evolution HTTP adapter must preserve the local engine target.')
  if (!evolution.includes("const DEFAULT_INSTANCE_PREFIX = 'crm-channel-'")) fail('portable Evolution HTTP adapter must preserve CRM instance names.')
  if (!evolution.includes('const DEFAULT_CHANNELS = Array.from({ length: 9 }')) fail('portable Evolution HTTP adapter must preserve channels 1 through 9.')
  if (!evolution.includes('fetch(')) fail('portable Evolution HTTP adapter must remain an HTTP consumer.')
}

function assertExpectedValidatorIdentity(files, expectedValidatorSha256) {
  const expected = digest(expectedValidatorSha256, 'trusted portable validator SHA-256')
  const observed = sha256(files.get(PORTABLE_VALIDATOR_PATH))
  if (observed !== expected) {
    fail('portable validator SHA-256 does not match the trusted reviewed identity.')
  }
}

function parseEvidence(value) {
  if (isObject(value)) return value
  if (typeof value !== 'string' || !value.trim()) fail('candidate evidence is required.')
  let bytes
  try {
    const stat = fs.lstatSync(value)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_CANDIDATE_FILE_BYTES) fail('candidate evidence must be a bounded regular file.')
    bytes = fs.readFileSync(value)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('WhatsApp adapter cutover candidate:')) throw error
    fail('candidate evidence is unavailable.')
  }
  return parseJson(bytes, 'candidate evidence')
}

function assertEvidenceEntry(entry, key) {
  if (!isObject(entry)) fail('candidate evidence gate ' + key + ' must be an object.')
  if (entry.status !== 'proven' && entry.status !== 'unproven') fail('candidate evidence gate ' + key + ' has an invalid status.')
  if (entry.status === 'proven') {
    string(entry.ref, 'candidate evidence gate ' + key + '.ref')
    digest(entry.sha256, 'candidate evidence gate ' + key + '.sha256')
  } else if (entry.ref !== null || entry.sha256 !== null) {
    fail('unproven candidate evidence gate ' + key + ' must not carry unverifiable evidence.')
  }
  return entry.status
}

function evaluateEvidence(evidence, identity) {
  if (!isObject(evidence)) fail('candidate evidence must be an object.')
  if (evidence.schemaVersion !== 1) fail('candidate evidence schemaVersion must equal 1.')
  if (!isObject(evidence.source)) fail('candidate evidence source must be an object.')
  if (evidence.source.commit !== BASELINE_SOURCE_COMMIT || evidence.source.tree !== BASELINE_SOURCE_TREE) {
    fail('candidate evidence source commit and tree must match the reviewed baseline exactly.')
  }
  if (digest(evidence.source.candidateClosureSha256, 'candidate evidence source.candidateClosureSha256') !== identity.candidateClosureSha256) {
    fail('candidate evidence closure digest does not match the candidate.')
  }
  if (identity.archiveSha256) {
    if (digest(evidence.source.archiveSha256, 'candidate evidence source.archiveSha256') !== identity.archiveSha256) {
      fail('candidate evidence archive digest does not match the candidate archive.')
    }
  } else if (evidence.source.archiveSha256 !== null) {
    fail('directory candidate evidence must set archiveSha256 to null.')
  }
  if (!isObject(evidence.gates)) fail('candidate evidence gates must be an object.')
  const observedKeys = Object.keys(evidence.gates).sort()
  const expectedKeys = [...REQUIRED_EVIDENCE_KEYS].sort()
  if (JSON.stringify(observedKeys) !== JSON.stringify(expectedKeys)) fail('candidate evidence gates must name all four required facts exactly.')
  const blockers = ['status is pre-cut']
  for (const key of REQUIRED_EVIDENCE_KEYS) {
    if (assertEvidenceEntry(evidence.gates[key], key) !== 'proven') blockers.push('missing evidence for ' + key)
  }
  return blockers
}

export function measureWhatsappAdapterCandidate({ candidate, expectedValidatorSha256 } = {}) {
  const representation = readCandidate(candidate)
  assertExactCandidateFiles(representation.files, representation.directories)
  const manifest = parseJson(representation.files.get('adapter-boundary.json'), 'candidate adapter-boundary.json')
  assertManifest(manifest)
  assertPackage(parseJson(representation.files.get('package.json'), 'candidate package.json'))
  assertAdapterSources(representation.files)
  if (expectedValidatorSha256 !== undefined) {
    assertExpectedValidatorIdentity(representation.files, expectedValidatorSha256)
  }
  return {
    candidateType: representation.candidateType,
    candidateClosureSha256: closureSha256(representation.files),
    archiveSha256: representation.archiveSha256
  }
}

export function inspectWhatsappAdapterCandidate({ candidate, evidence, expectedValidatorSha256 } = {}) {
  if (expectedValidatorSha256 === undefined) {
    fail('a trusted portable validator SHA-256 is required for candidate inspection.')
  }
  const identity = measureWhatsappAdapterCandidate({ candidate, expectedValidatorSha256 })
  return {
    ok: true,
    eligible: false,
    ...identity,
    blockers: evaluateEvidence(parseEvidence(evidence), identity)
  }
}

export function assertWhatsappAdapterCandidateEligible(options = {}) {
  const result = inspectWhatsappAdapterCandidate(options)
  if (!result.eligible) fail('candidate is not eligible for repository creation or publishing: ' + result.blockers.join('; ') + '.')
  return result
}

function parseArguments(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index]
    if (option === '--candidate' || option === '--evidence' || option === '--trusted-validator-sha256') {
      const value = argv[index + 1]
      if (!value) fail(option + ' requires a value.')
      const key = option === '--trusted-validator-sha256' ? 'trustedValidatorSha256' : option.slice(2)
      options[key] = value
      index += 1
      continue
    }
    if (option === '-h' || option === '--help') {
      process.stdout.write('Usage: node scripts/validate-whatsapp-adapter-candidate.mjs --candidate <directory-or-tar> --evidence <json> --trusted-validator-sha256 <sha256>\n')
      process.exit(0)
    }
    fail('unknown option ' + JSON.stringify(option) + '.')
  }
  if (!options.candidate || !options.evidence || !options.trustedValidatorSha256) {
    fail('--candidate, --evidence and --trusted-validator-sha256 are required.')
  }
  return options
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2))
    const result = assertWhatsappAdapterCandidateEligible({
      candidate: options.candidate,
      evidence: options.evidence,
      expectedValidatorSha256: options.trustedValidatorSha256
    })
    process.stdout.write(JSON.stringify(result) + '\n')
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n')
    process.exitCode = 78
  }
}
