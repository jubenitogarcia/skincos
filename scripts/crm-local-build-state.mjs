#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const BUILD_STATE_VERSION = 1
export const BUILD_LOCK_VERSION = 1
export const DEFAULT_STALE_LOCK_MS = 15 * 60 * 1000

const HASH_ALGORITHM = 'sha256'
const HASH_PREFIX = `${HASH_ALGORITHM}:`
const DEFAULT_CONSOLE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'crm', 'console')
const EXTERNAL_BUILD_INPUT_DIRECTORIES = Object.freeze([
  'shared/identity-contract',
])

const BUILD_SOURCE_DIRECTORIES = new Set(['functions', 'modules', 'public', 'scripts'])
const EXCLUDED_DIRECTORIES = new Set([
  '.cache',
  '.git',
  '.playwright-cli',
  '.playwright-mcp',
  '.playwright-output',
  '.turbo',
  '.vite',
  '.wrangler',
  '.wrangler-staging',
  'coverage',
  'dist',
  'downloads',
  'e2e',
  'finance-remote',
  'node_modules',
  'output',
  'pids',
  'playwright-report',
  'logs',
  'test-results',
  'tests',
])
const ROOT_BUILD_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.cts',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.less',
  '.mjs',
  '.mts',
  '.sass',
  '.scss',
  '.ts',
  '.tsx',
  '.toml',
])
const ROOT_BUILD_FILES = new Set([
  'index.html',
  'npm-shrinkwrap.json',
  'package-lock.json',
  'package.json',
  'pnpm-lock.yaml',
  'wrangler.toml',
  'yarn.lock',
])

export class BuildStateError extends Error {
  constructor(code, message, details = undefined) {
    super(message)
    this.name = 'BuildStateError'
    this.code = code
    this.details = details
  }
}

function compareNames(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function normalizeRelativePath(value) {
  return value.split(path.sep).join('/')
}

function isExcludedFile(name) {
  const lower = name.toLowerCase()
  return lower === '.ds_store' ||
    lower === 'thumbs.db' ||
    lower === '.eslintcache' ||
    lower === '.dev.vars' ||
    lower.startsWith('.dev.vars.') ||
    lower.endsWith('.log') ||
    lower.includes('.log.') ||
    lower.endsWith('.pid') ||
    lower.endsWith('.pid.lock') ||
    lower.endsWith('.seed') ||
    lower.endsWith('.swp') ||
    lower.endsWith('.swo') ||
    lower.endsWith('.tmp') ||
    lower.endsWith('~')
}

function isBuildInput(relativePath) {
  const normalized = normalizeRelativePath(relativePath)
  const parts = normalized.split('/')
  if (parts.length > 1) return BUILD_SOURCE_DIRECTORIES.has(parts[0])

  const name = parts[0]
  const lower = name.toLowerCase()
  return ROOT_BUILD_FILES.has(lower) ||
    lower.startsWith('tsconfig') && lower.endsWith('.json') ||
    lower.startsWith('vite.') ||
    lower.startsWith('vitest.') ||
    lower.startsWith('postcss.') ||
    lower.startsWith('tailwind.') ||
    ROOT_BUILD_EXTENSIONS.has(path.extname(lower))
}

async function hashFile(filePath) {
  const hash = createHash(HASH_ALGORITHM)
  let size = 0
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => {
      size += chunk.length
      hash.update(chunk)
    })
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  return { digest: hash.digest('hex'), size }
}

async function collectTreeEntries(rootDir, {
  include = () => true,
  excludeTopLevelDirectories = true,
} = {}) {
  const root = path.resolve(rootDir)
  const entries = []

  async function visit(currentDir, relativeDir = '') {
    const children = await fs.readdir(currentDir, { withFileTypes: true })
    children.sort((left, right) => compareNames(left.name, right.name))

    for (const child of children) {
      const relativePath = relativeDir ? path.join(relativeDir, child.name) : child.name
      const normalizedPath = normalizeRelativePath(relativePath)
      if (child.isDirectory()) {
        const isExcludedTopLevel = excludeTopLevelDirectories &&
          relativeDir === '' &&
          EXCLUDED_DIRECTORIES.has(child.name.toLowerCase())
        if (!isExcludedTopLevel) {
          await visit(path.join(currentDir, child.name), relativePath)
        }
        continue
      }
      if (isExcludedFile(child.name) || !include(normalizedPath)) continue

      const absolutePath = path.join(currentDir, child.name)
      if (child.isSymbolicLink()) {
        const target = await fs.readlink(absolutePath)
        const content = Buffer.from(`symlink:${normalizeRelativePath(target)}`, 'utf8')
        entries.push({
          path: normalizedPath,
          digest: createHash(HASH_ALGORITHM).update(content).digest('hex'),
          size: content.length,
          type: 'symlink',
        })
        continue
      }
      if (!child.isFile()) continue
      const hashed = await hashFile(absolutePath)
      entries.push({ path: normalizedPath, ...hashed, type: 'file' })
    }
  }

  await visit(root)
  entries.sort((left, right) => compareNames(left.path, right.path))
  return entries
}

function fingerprintEntries(entries, namespace) {
  const hash = createHash(HASH_ALGORITHM)
  hash.update(`skincos:${namespace}:v1\0`)
  for (const entry of entries) {
    const encodedPath = Buffer.from(entry.path, 'utf8')
    hash.update(`${encodedPath.length}:`)
    hash.update(encodedPath)
    hash.update(`\0${entry.type}\0${entry.size}\0${entry.digest}\n`)
  }
  return `${HASH_PREFIX}${hash.digest('hex')}`
}

async function directoryExists(directory) {
  try {
    return (await fs.stat(directory)).isDirectory()
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function inferSourceRoot(consoleDir) {
  const resolvedConsole = path.resolve(consoleDir)
  const sourceRoot = path.resolve(resolvedConsole, '..', '..')
  return normalizeRelativePath(path.relative(sourceRoot, resolvedConsole)) === 'crm/console'
    ? sourceRoot
    : null
}

export async function fingerprintBuildInputs(consoleDir = DEFAULT_CONSOLE_DIR, {
  includeEntries = false,
  sourceRoot = inferSourceRoot(consoleDir),
} = {}) {
  const root = path.resolve(consoleDir)
  if (!await directoryExists(root)) {
    throw new BuildStateError('CONSOLE_DIR_MISSING', `CRM console directory does not exist: ${root}`)
  }
  const entries = await collectTreeEntries(root, { include: isBuildInput })
  if (sourceRoot) {
    const resolvedSourceRoot = path.resolve(sourceRoot)
    for (const relativeDirectory of EXTERNAL_BUILD_INPUT_DIRECTORIES) {
      const externalRoot = path.join(resolvedSourceRoot, relativeDirectory)
      if (!await directoryExists(externalRoot)) {
        throw new BuildStateError(
          'EXTERNAL_BUILD_INPUT_MISSING',
          `Required CRM build input directory does not exist: ${externalRoot}`,
        )
      }
      const externalEntries = await collectTreeEntries(externalRoot)
      entries.push(...externalEntries.map((entry) => ({
        ...entry,
        path: `repo/${normalizeRelativePath(relativeDirectory)}/${entry.path}`,
      })))
    }
    entries.sort((left, right) => compareNames(left.path, right.path))
  }
  const result = {
    fingerprint: fingerprintEntries(entries, 'crm-console-inputs'),
    fileCount: entries.length,
    totalBytes: entries.reduce((total, entry) => total + entry.size, 0),
  }
  if (includeEntries) result.entries = entries
  return result
}

export async function fingerprintLockfile(consoleDir = DEFAULT_CONSOLE_DIR) {
  const lockfilePath = path.join(path.resolve(consoleDir), 'package-lock.json')
  try {
    const hashed = await hashFile(lockfilePath)
    return {
      fingerprint: `${HASH_PREFIX}${hashed.digest}`,
      fileCount: 1,
      totalBytes: hashed.size,
      path: 'package-lock.json',
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { fingerprint: null, fileCount: 0, totalBytes: 0, path: 'package-lock.json' }
    }
    throw error
  }
}

export async function fingerprintDist(consoleDir = DEFAULT_CONSOLE_DIR, { includeEntries = false } = {}) {
  const distDir = path.join(path.resolve(consoleDir), 'dist')
  if (!await directoryExists(distDir)) {
    return { fingerprint: null, fileCount: 0, totalBytes: 0, exists: false }
  }
  const entries = await collectTreeEntries(distDir, { excludeTopLevelDirectories: false })
  const result = {
    fingerprint: fingerprintEntries(entries, 'crm-console-dist'),
    fileCount: entries.length,
    totalBytes: entries.reduce((total, entry) => total + entry.size, 0),
    exists: true,
  }
  if (includeEntries) result.entries = entries
  return result
}

export async function calculateBuildFingerprints(consoleDir = DEFAULT_CONSOLE_DIR, { includeEntries = false } = {}) {
  const resolvedConsoleDir = path.resolve(consoleDir)
  const [inputs, lockfile, dist] = await Promise.all([
    fingerprintBuildInputs(resolvedConsoleDir, { includeEntries }),
    fingerprintLockfile(resolvedConsoleDir),
    fingerprintDist(resolvedConsoleDir, { includeEntries }),
  ])
  return {
    version: BUILD_STATE_VERSION,
    algorithm: HASH_ALGORITHM,
    consoleDir: resolvedConsoleDir,
    inputs,
    lockfile,
    dist,
  }
}

async function distArtifactIsValid(consoleDir, dist) {
  if (!dist?.exists || !dist.fingerprint || dist.fileCount < 1) return false
  try {
    const index = await fs.stat(path.join(path.resolve(consoleDir), 'dist', 'index.html'))
    return index.isFile() && index.size > 0
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

export async function inspectBuildState(sourceRoot, stateFile) {
  const resolvedRoot = path.resolve(sourceRoot)
  const consoleDir = path.join(resolvedRoot, 'crm', 'console')
  const fingerprints = await calculateBuildFingerprints(consoleDir)
  const artifactFingerprint = await distArtifactIsValid(consoleDir, fingerprints.dist)
    ? fingerprints.dist.fingerprint
    : null
  const comparable = {
    ...fingerprints,
    dist: { ...fingerprints.dist, fingerprint: artifactFingerprint },
  }

  let state = null
  try {
    state = await readBuildState(stateFile)
  } catch (error) {
    if (error?.code !== 'INVALID_BUILD_STATE') throw error
  }
  return {
    inputFingerprint: fingerprints.inputs.fingerprint,
    lockfileFingerprint: fingerprints.lockfile.fingerprint,
    artifactFingerprint,
    stateValid: artifactFingerprint !== null && state !== null && buildStateMatches(state, comparable),
  }
}

function validFingerprint(value, { nullable = false } = {}) {
  if (nullable && value === null) return true
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value)
}

function validCount(value) {
  return Number.isSafeInteger(value) && value >= 0
}

export function validateBuildState(state) {
  const errors = []
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return { valid: false, errors: ['state must be a JSON object'] }
  }
  if (state.version !== BUILD_STATE_VERSION) errors.push(`version must equal ${BUILD_STATE_VERSION}`)
  if (!validFingerprint(state.inputFingerprint)) errors.push('inputFingerprint must be a sha256 fingerprint')
  if (!validFingerprint(state.lockfileFingerprint, { nullable: true })) errors.push('lockfileFingerprint must be null or a sha256 fingerprint')
  if (!validFingerprint(state.distFingerprint)) errors.push('distFingerprint must be a sha256 fingerprint')
  if (!validCount(state.inputFileCount)) errors.push('inputFileCount must be a non-negative integer')
  if (!validCount(state.distFileCount)) errors.push('distFileCount must be a non-negative integer')
  if (!validCount(state.inputBytes)) errors.push('inputBytes must be a non-negative integer')
  if (!validCount(state.distBytes)) errors.push('distBytes must be a non-negative integer')
  if (typeof state.builtAt !== 'string' || !Number.isFinite(Date.parse(state.builtAt))) {
    errors.push('builtAt must be an ISO date')
  }
  return { valid: errors.length === 0, errors }
}

export function createBuildState(fingerprints, { builtAt = new Date().toISOString() } = {}) {
  if (!fingerprints?.dist?.fingerprint) {
    throw new BuildStateError('DIST_MISSING', 'Cannot record a successful build without a dist fingerprint')
  }
  const state = {
    version: BUILD_STATE_VERSION,
    inputFingerprint: fingerprints.inputs?.fingerprint ?? null,
    lockfileFingerprint: fingerprints.lockfile?.fingerprint ?? null,
    distFingerprint: fingerprints.dist.fingerprint,
    inputFileCount: fingerprints.inputs?.fileCount ?? -1,
    distFileCount: fingerprints.dist.fileCount,
    inputBytes: fingerprints.inputs?.totalBytes ?? -1,
    distBytes: fingerprints.dist.totalBytes,
    builtAt,
  }
  const validation = validateBuildState(state)
  if (!validation.valid) {
    throw new BuildStateError('INVALID_BUILD_STATE', 'Generated build state is invalid', validation.errors)
  }
  return state
}

async function syncDirectory(directory) {
  let handle
  try {
    handle = await fs.open(directory, 'r')
    await handle.sync()
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM'].includes(error?.code)) throw error
  } finally {
    await handle?.close()
  }
}

async function writeJsonAtomic(filePath, value, { mode = 0o600 } = {}) {
  const target = path.resolve(filePath)
  const parent = path.dirname(target)
  const temporary = path.join(parent, `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`)
  await fs.mkdir(parent, { recursive: true, mode: 0o700 })
  let handle
  try {
    handle = await fs.open(temporary, 'wx', mode)
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await fs.rename(temporary, target)
    await fs.chmod(target, mode).catch((error) => {
      if (error?.code !== 'ENOSYS') throw error
    })
    await syncDirectory(parent)
  } finally {
    await handle?.close()
    await fs.rm(temporary, { force: true }).catch(() => {})
  }
}

export async function writeBuildStateAtomic(stateFile, state) {
  const validation = validateBuildState(state)
  if (!validation.valid) {
    throw new BuildStateError('INVALID_BUILD_STATE', 'Refusing to write invalid build state', validation.errors)
  }
  await writeJsonAtomic(stateFile, state)
  return state
}

export async function readBuildState(stateFile) {
  let parsed
  try {
    parsed = JSON.parse(await fs.readFile(path.resolve(stateFile), 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    if (error instanceof SyntaxError) {
      throw new BuildStateError('INVALID_BUILD_STATE', `Build state is not valid JSON: ${stateFile}`)
    }
    throw error
  }
  const validation = validateBuildState(parsed)
  if (!validation.valid) {
    throw new BuildStateError('INVALID_BUILD_STATE', `Build state failed validation: ${stateFile}`, validation.errors)
  }
  return parsed
}

export function buildStateMatches(state, fingerprints) {
  return validateBuildState(state).valid &&
    state.inputFingerprint === fingerprints?.inputs?.fingerprint &&
    state.lockfileFingerprint === fingerprints?.lockfile?.fingerprint &&
    state.distFingerprint === fingerprints?.dist?.fingerprint
}

async function processStartMarker(pid) {
  if (process.platform !== 'linux') return null
  try {
    const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8')
    const commandEnd = stat.lastIndexOf(')')
    if (commandEnd < 0) return null
    const fields = stat.slice(commandEnd + 2).trim().split(/\s+/)
    return fields[19] || null
  } catch {
    return null
  }
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

async function readLockOwner(lockDir) {
  try {
    return JSON.parse(await fs.readFile(path.join(lockDir, 'owner.json'), 'utf8'))
  } catch {
    return null
  }
}

async function lockAgeMs(lockDir, owner, now) {
  const acquired = Date.parse(owner?.acquiredAt)
  if (Number.isFinite(acquired)) return Math.max(0, now - acquired)
  try {
    return Math.max(0, now - (await fs.stat(lockDir)).mtimeMs)
  } catch {
    return 0
  }
}

async function evaluateLockOwner(lockDir, owner, { staleAfterMs, hostname, now }) {
  const ageMs = await lockAgeMs(lockDir, owner, now)
  if (!owner || owner.version !== BUILD_LOCK_VERSION || typeof owner.token !== 'string') {
    return { stale: ageMs >= staleAfterMs, reason: 'owner_missing_or_invalid', ageMs }
  }

  const sameHost = String(owner.hostname || '').toLowerCase() === hostname.toLowerCase()
  if (!sameHost) return { stale: ageMs >= staleAfterMs, reason: 'foreign_owner_expired', ageMs }
  if (!processIsAlive(owner.pid)) return { stale: true, reason: 'owner_dead', ageMs }

  if (owner.processStartMarker) {
    const currentMarker = await processStartMarker(owner.pid)
    if (currentMarker && currentMarker !== owner.processStartMarker) {
      return { stale: true, reason: 'pid_reused', ageMs }
    }
  }
  return { stale: false, reason: 'owner_alive', ageMs }
}

export async function inspectBuildLock(lockDir, {
  staleAfterMs = DEFAULT_STALE_LOCK_MS,
  hostname = os.hostname(),
  now = Date.now(),
} = {}) {
  const resolved = path.resolve(lockDir)
  try {
    const stat = await fs.stat(resolved)
    if (!stat.isDirectory()) {
      throw new BuildStateError('INVALID_BUILD_LOCK', `Build lock path is not a directory: ${resolved}`)
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, stale: false, owner: null, lockDir: resolved }
    throw error
  }
  const owner = await readLockOwner(resolved)
  const evaluation = await evaluateLockOwner(resolved, owner, { staleAfterMs, hostname, now })
  return { exists: true, owner, lockDir: resolved, ...evaluation }
}

export async function acquireBuildLock(lockDir, {
  ownerPid = process.ppid,
  staleAfterMs = DEFAULT_STALE_LOCK_MS,
  hostname = os.hostname(),
  token = randomUUID(),
  now = Date.now(),
} = {}) {
  if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) {
    throw new BuildStateError('INVALID_LOCK_OWNER', `Invalid lock owner PID: ${ownerPid}`)
  }
  if (!Number.isSafeInteger(staleAfterMs) || staleAfterMs < 1) {
    throw new BuildStateError('INVALID_STALE_TIMEOUT', `Invalid stale timeout: ${staleAfterMs}`)
  }

  const resolved = path.resolve(lockDir)
  await fs.mkdir(path.dirname(resolved), { recursive: true, mode: 0o700 })
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await fs.mkdir(resolved, { mode: 0o700 })
      const owner = {
        version: BUILD_LOCK_VERSION,
        token,
        pid: ownerPid,
        hostname,
        acquiredAt: new Date(now).toISOString(),
        processStartMarker: await processStartMarker(ownerPid),
      }
      try {
        await writeJsonAtomic(path.join(resolved, 'owner.json'), owner)
      } catch (error) {
        await fs.rm(resolved, { recursive: true, force: true }).catch(() => {})
        throw error
      }
      return { acquired: true, reason: 'acquired', owner, lockDir: resolved }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    }

    const inspection = await inspectBuildLock(resolved, { staleAfterMs, hostname, now })
    if (!inspection.exists) continue
    if (!inspection.stale) {
      return { acquired: false, reason: inspection.reason, owner: inspection.owner, lockDir: resolved }
    }

    const quarantine = `${resolved}.stale-${process.pid}-${randomUUID()}`
    try {
      await fs.rename(resolved, quarantine)
    } catch (error) {
      if (['ENOENT', 'EEXIST'].includes(error?.code)) continue
      throw error
    }
    await fs.rm(quarantine, { recursive: true, force: true })
  }
  throw new BuildStateError('LOCK_RACE', `Could not acquire build lock after repeated races: ${resolved}`)
}

export async function releaseBuildLock(lockDir, token) {
  if (!token) throw new BuildStateError('LOCK_TOKEN_REQUIRED', 'A lock token is required for release')
  const resolved = path.resolve(lockDir)
  const inspection = await inspectBuildLock(resolved)
  if (!inspection.exists) return { released: false, reason: 'missing', lockDir: resolved }
  if (inspection.owner?.token !== token) {
    throw new BuildStateError('LOCK_NOT_OWNER', `Build lock is owned by another token: ${resolved}`)
  }

  const quarantine = `${resolved}.release-${process.pid}-${randomUUID()}`
  try {
    await fs.rename(resolved, quarantine)
  } catch (error) {
    if (error?.code === 'ENOENT') return { released: false, reason: 'missing', lockDir: resolved }
    throw error
  }

  const movedOwner = await readLockOwner(quarantine)
  if (movedOwner?.token !== token) {
    await fs.rename(quarantine, resolved).catch(() => {})
    throw new BuildStateError('LOCK_NOT_OWNER', `Build lock ownership changed during release: ${resolved}`)
  }
  await fs.rm(quarantine, { recursive: true, force: true })
  return { released: true, reason: 'released', lockDir: resolved }
}

function parseArgs(argv) {
  const options = { json: false }
  const positional = []
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--json') {
      options.json = true
    } else if (value === '--entries') {
      options.entries = true
    } else if (value.startsWith('--')) {
      const key = value.slice(2)
      const next = argv[index + 1]
      if (next === undefined || next.startsWith('--')) {
        throw new BuildStateError('USAGE', `Missing value for ${value}`)
      }
      options[key] = next
      index += 1
    } else {
      positional.push(value)
    }
  }
  return { command: positional[0], options }
}

function requiredOption(options, name) {
  if (!options[name]) throw new BuildStateError('USAGE', `Missing required option --${name}`)
  return options[name]
}

function printResult(result, { json = false, scalar = undefined } = {}) {
  if (json) {
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`)
  } else if (scalar !== undefined) {
    process.stdout.write(`${scalar ?? 'missing'}\n`)
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  }
}

function printUsage() {
  process.stdout.write(`Usage:
  crm-local-build-state.mjs inspect --root SOURCE_ROOT --state STATE_PATH
  crm-local-build-state.mjs fingerprint [--console-dir PATH] [--entries] [--json]
  crm-local-build-state.mjs fingerprint-input [--console-dir PATH] [--json]
  crm-local-build-state.mjs fingerprint-lockfile [--console-dir PATH] [--json]
  crm-local-build-state.mjs fingerprint-dist [--console-dir PATH] [--json]
  crm-local-build-state.mjs state-read --state-file PATH [--json]
  crm-local-build-state.mjs state-validate --state-file PATH [--json]
  crm-local-build-state.mjs state-write --state-file PATH [--console-dir PATH] [--json]
  crm-local-build-state.mjs lock-acquire --lock-dir PATH [--owner-pid PID] [--stale-ms MS] [--json]
  crm-local-build-state.mjs lock-inspect --lock-dir PATH [--stale-ms MS] [--json]
  crm-local-build-state.mjs lock-release --lock-dir PATH --token TOKEN [--json]

For Bash, acquire with --owner-pid "$$" and persist the returned owner.token.
`)
}

async function runCli(argv) {
  const { command, options } = parseArgs(argv)
  const consoleDir = options['console-dir'] || DEFAULT_CONSOLE_DIR
  if (!command || command === 'help') {
    printUsage()
    return
  }

  if (command === 'inspect') {
    const result = await inspectBuildState(
      requiredOption(options, 'root'),
      requiredOption(options, 'state'),
    )
    process.stdout.write(`${JSON.stringify(result)}\n`)
    return
  }
  if (command === 'fingerprint') {
    const result = await calculateBuildFingerprints(consoleDir, { includeEntries: options.entries })
    printResult(result, options)
    return
  }
  if (command === 'fingerprint-input') {
    const result = await fingerprintBuildInputs(consoleDir, { includeEntries: options.entries })
    printResult(result, { ...options, scalar: result.fingerprint })
    return
  }
  if (command === 'fingerprint-lockfile') {
    const result = await fingerprintLockfile(consoleDir)
    printResult(result, { ...options, scalar: result.fingerprint })
    return
  }
  if (command === 'fingerprint-dist') {
    const result = await fingerprintDist(consoleDir, { includeEntries: options.entries })
    printResult(result, { ...options, scalar: result.fingerprint })
    return
  }
  if (command === 'state-read' || command === 'state-validate') {
    const stateFile = requiredOption(options, 'state-file')
    const state = await readBuildState(stateFile)
    const result = { stateFile: path.resolve(stateFile), exists: state !== null, valid: state !== null, state }
    printResult(result, options)
    return
  }
  if (command === 'state-write') {
    const stateFile = requiredOption(options, 'state-file')
    const fingerprints = await calculateBuildFingerprints(consoleDir)
    const state = createBuildState(fingerprints)
    await writeBuildStateAtomic(stateFile, state)
    printResult({ stateFile: path.resolve(stateFile), state }, options)
    return
  }
  if (command === 'lock-acquire') {
    const lockDir = requiredOption(options, 'lock-dir')
    const result = await acquireBuildLock(lockDir, {
      ownerPid: options['owner-pid'] ? Number(options['owner-pid']) : process.ppid,
      staleAfterMs: options['stale-ms'] ? Number(options['stale-ms']) : DEFAULT_STALE_LOCK_MS,
    })
    printResult(result, options)
    if (!result.acquired) process.exitCode = 73
    return
  }
  if (command === 'lock-inspect') {
    const result = await inspectBuildLock(requiredOption(options, 'lock-dir'), {
      staleAfterMs: options['stale-ms'] ? Number(options['stale-ms']) : DEFAULT_STALE_LOCK_MS,
    })
    printResult(result, options)
    return
  }
  if (command === 'lock-release') {
    const result = await releaseBuildLock(
      requiredOption(options, 'lock-dir'),
      requiredOption(options, 'token'),
    )
    printResult(result, options)
    return
  }
  throw new BuildStateError('USAGE', `Unknown command: ${command}`)
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) {
  runCli(process.argv.slice(2)).catch((error) => {
    const payload = {
      ok: false,
      error: {
        code: error?.code || 'UNEXPECTED',
        message: error?.message || String(error),
        details: error?.details,
      },
    }
    if (process.argv.includes('--json')) process.stderr.write(`${JSON.stringify(payload)}\n`)
    else process.stderr.write(`[crm-local-build-state] ${payload.error.code}: ${payload.error.message}\n`)
    process.exitCode = error?.code === 'USAGE' ? 2 : 1
  })
}
