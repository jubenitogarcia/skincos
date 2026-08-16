#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const PREVIEW_IDENTITY_VERSION = 2
export const WEBSITE_MODULE = 'website'
export const DEFAULT_PREVIEW_ROUTE = '/beleza-em-movimento/local-preview'
export const DEFAULT_PREVIEW_PROTOCOL = 'beauty-movement-local-preview-v2'
export const DEFAULT_BUILD_CONTRACT = 'next-dev-isolated-v1'

const HASH_ALGORITHM = 'sha256'
const HASH_PREFIX = `${HASH_ALGORITHM}:`
const DEFAULT_SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EXCLUDED_DIRECTORY_NAMES = new Set([
  '.next',
  '.next-codex-preview',
  '.open-next',
  '.wrangler',
  'docs',
  'logs',
  'node_modules',
  'reports',
  'tests',
  'tmp',
])
const DEFAULT_CONTRACT_PATHS = Object.freeze([
  '.codex/environments/environment.toml',
  'scripts/start-beauty-movement-local-preview.ps1',
  'scripts/materialize-website-local-preview-source.sh',
  'scripts/run-local-website.sh',
  'scripts/website-local-preview-state.mjs',
])
const ROOT_RUNTIME_FILE_NAMES = new Set([
  '.npmrc',
  'next-env.d.ts',
  'npm-shrinkwrap.json',
  'package-lock.json',
  'package.json',
  'pnpm-lock.yaml',
  'yarn.lock',
])
const ROOT_RUNTIME_FILE_PATTERNS = [
  /^contentsecuritypolicy\.[a-z0-9]+$/,
  /^instrumentation\.[a-z0-9]+$/,
  /^middleware\.[a-z0-9]+$/,
  /^next\.config\.[a-z0-9]+$/,
  /^open-next\.config\.[a-z0-9]+$/,
  /^postcss\.config\.[a-z0-9]+$/,
  /^proxy\.[a-z0-9]+$/,
  /^tailwind\.config\.[a-z0-9]+$/,
  /^tsconfig(?:\.[a-z0-9_-]+)?\.json$/,
  /^wrangler(?:-[a-z0-9_-]+)?\.(?:json|toml)$/,
  /^[a-z0-9_.-]+\.d\.ts$/,
]

export class PreviewIdentityError extends Error {
  constructor(code, message, details = undefined) {
    super(message)
    this.name = 'PreviewIdentityError'
    this.code = code
    this.details = details
  }
}

function compareNames(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function normalizePath(value) {
  return value.split(path.sep).join('/')
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function hashText(value) {
  return createHash(HASH_ALGORITHM).update(value).digest('hex')
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

function fingerprintEntries(entries, namespace) {
  const hash = createHash(HASH_ALGORITHM)
  hash.update(`skincos:${namespace}:v${PREVIEW_IDENTITY_VERSION}\0`)
  for (const entry of entries) {
    const encodedPath = Buffer.from(entry.path, 'utf8')
    hash.update(`${encodedPath.length}:`)
    hash.update(encodedPath)
    hash.update(`\0${entry.type}\0${entry.size}\0${entry.digest}\0${entry.sensitive ? 'sensitive' : 'regular'}\n`)
  }
  return `${HASH_PREFIX}${hash.digest('hex')}`
}

function fingerprintDescriptor(descriptor) {
  const hash = createHash(HASH_ALGORITHM)
  hash.update(`skincos:website-local-preview-instance:v${PREVIEW_IDENTITY_VERSION}\0`)
  for (const [key, value] of Object.entries(descriptor)) {
    const encodedKey = Buffer.from(key, 'utf8')
    const encodedValue = Buffer.from(String(value), 'utf8')
    hash.update(`${encodedKey.length}:`)
    hash.update(encodedKey)
    hash.update(`\0${encodedValue.length}:`)
    hash.update(encodedValue)
    hash.update('\n')
  }
  return `${HASH_PREFIX}${hash.digest('hex')}`
}

function validateIdentityText(value, name) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 || /[\0\r\n]/.test(value)) {
    throw new PreviewIdentityError('INVALID_IDENTITY_VALUE', `${name} must be a non-empty one-line value`)
  }
  return value
}

function normalizeRoute(route) {
  const normalized = validateIdentityText(route, 'route')
  if (!normalized.startsWith('/')) {
    throw new PreviewIdentityError('INVALID_ROUTE', 'route must start with /')
  }
  return normalized
}

function isSensitiveRootFile(name) {
  const lower = name.toLowerCase()
  return lower.startsWith('.env') || lower === '.dev.vars' || lower.startsWith('.dev.vars.')
}

function isRuntimeRootFile(name) {
  const lower = name.toLowerCase()
  return isSensitiveRootFile(lower) ||
    ROOT_RUNTIME_FILE_NAMES.has(lower) ||
    ROOT_RUNTIME_FILE_PATTERNS.some((pattern) => pattern.test(lower))
}

function pathHasExcludedDirectory(relativePath) {
  return normalizePath(relativePath)
    .split('/')
    .some((segment) => EXCLUDED_DIRECTORY_NAMES.has(segment.toLowerCase()))
}

function normalizeContractPath(value) {
  const normalized = validateIdentityText(value, 'contract path').replace(/\\/g, '/')
  if (normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || normalized.split('/').includes('..')) {
    throw new PreviewIdentityError('INVALID_CONTRACT_PATH', `contract path must stay below the source root: ${value}`)
  }
  return normalized.replace(/^\.\//, '')
}

async function pathKind(filePath) {
  try {
    const stat = await fs.lstat(filePath)
    if (stat.isSymbolicLink()) return 'symlink'
    if (stat.isFile()) return 'file'
    if (stat.isDirectory()) return 'directory'
    return 'other'
  } catch (error) {
    if (error?.code === 'ENOENT') return 'missing'
    throw error
  }
}

async function resolveFileEntry(absolutePath, relativePath, { sensitive = false, allowedRoot }) {
  const kind = await pathKind(absolutePath)
  if (kind === 'missing') return null
  if (kind === 'directory' || kind === 'other') {
    throw new PreviewIdentityError('UNSUPPORTED_INPUT', `Preview input is not a regular file: ${absolutePath}`)
  }
  if (kind === 'symlink') {
    const target = await fs.realpath(absolutePath)
    if (!isWithin(allowedRoot, target)) {
      throw new PreviewIdentityError('UNSAFE_SYMLINK', `Preview input symlink resolves outside website: ${absolutePath}`)
    }
    const targetStat = await fs.stat(absolutePath)
    if (!targetStat.isFile()) {
      throw new PreviewIdentityError('UNSUPPORTED_SYMLINK', `Preview input symlink must target a file: ${absolutePath}`)
    }
    const hashed = await hashFile(absolutePath)
    return { path: relativePath, ...hashed, type: 'symlink-file', sensitive }
  }
  const hashed = await hashFile(absolutePath)
  return { path: relativePath, ...hashed, type: 'file', sensitive }
}

async function collectDirectoryEntries(directory, prefix, websiteRoot) {
  let children
  try {
    children = await fs.readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  children.sort((left, right) => compareNames(left.name, right.name))
  const entries = []
  for (const child of children) {
    const relativePath = path.join(prefix, child.name)
    if (pathHasExcludedDirectory(relativePath)) continue
    const absolutePath = path.join(directory, child.name)
    if (child.isDirectory()) {
      entries.push(...await collectDirectoryEntries(absolutePath, relativePath, websiteRoot))
      continue
    }
    if (child.isSymbolicLink()) {
      const target = await fs.realpath(absolutePath)
      const targetStat = await fs.stat(absolutePath)
      if (targetStat.isDirectory()) {
        throw new PreviewIdentityError('UNSUPPORTED_SYMLINK', `Preview input symlink must not target a directory: ${absolutePath}`)
      }
      if (!isWithin(websiteRoot, target)) {
        throw new PreviewIdentityError('UNSAFE_SYMLINK', `Preview input symlink resolves outside website: ${absolutePath}`)
      }
    }
    const entry = await resolveFileEntry(absolutePath, normalizePath(relativePath), { allowedRoot: websiteRoot })
    if (entry) entries.push(entry)
  }
  return entries
}

function sanitizeEntries(entries) {
  return entries.map(({ path: entryPath, type, size, sensitive }) => ({
    path: entryPath,
    type,
    size,
    ...(sensitive ? { sensitive: true } : {}),
  }))
}

async function resolvePreviewSource(sourceRoot) {
  const requestedRoot = path.resolve(sourceRoot)
  let canonicalRoot
  try {
    canonicalRoot = await fs.realpath(requestedRoot)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new PreviewIdentityError('SOURCE_ROOT_MISSING', `Preview source root does not exist: ${requestedRoot}`)
    }
    throw error
  }
  const sourceStat = await fs.stat(canonicalRoot)
  if (!sourceStat.isDirectory()) {
    throw new PreviewIdentityError('SOURCE_ROOT_INVALID', `Preview source root is not a directory: ${canonicalRoot}`)
  }
  const websiteRoot = path.join(canonicalRoot, WEBSITE_MODULE)
  try {
    if (!(await fs.stat(websiteRoot)).isDirectory()) {
      throw new PreviewIdentityError('WEBSITE_MISSING', `Preview source root does not contain website/: ${canonicalRoot}`)
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new PreviewIdentityError('WEBSITE_MISSING', `Preview source root does not contain website/: ${canonicalRoot}`)
    }
    throw error
  }
  return {
    sourceRoot: normalizePath(canonicalRoot),
    sourceRootNative: canonicalRoot,
    websiteRoot: normalizePath(websiteRoot),
    websiteRootNative: websiteRoot,
  }
}

async function fingerprintResolvedWebsiteInputs(source) {
  const entries = []
  let rootEntries
  try {
    rootEntries = await fs.readdir(source.websiteRootNative, { withFileTypes: true })
  } catch (error) {
    throw new PreviewIdentityError('WEBSITE_READ_FAILED', `Could not read website inputs: ${source.websiteRoot}`, error?.code)
  }
  rootEntries.sort((left, right) => compareNames(left.name, right.name))
  for (const entry of rootEntries) {
    const absolutePath = path.join(source.websiteRootNative, entry.name)
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRECTORY_NAMES.has(entry.name.toLowerCase())) continue
      entries.push(...await collectDirectoryEntries(absolutePath, entry.name, source.websiteRootNative))
      continue
    }
    if (!isRuntimeRootFile(entry.name)) continue
    const fileEntry = await resolveFileEntry(absolutePath, entry.name, {
      sensitive: isSensitiveRootFile(entry.name),
      allowedRoot: source.websiteRootNative,
    })
    if (fileEntry) entries.push(fileEntry)
  }
  entries.sort((left, right) => compareNames(left.path, right.path))
  return {
    fingerprint: fingerprintEntries(entries, 'website-preview-inputs'),
    fileCount: entries.length,
    totalBytes: entries.reduce((total, entry) => total + entry.size, 0),
    sensitiveFileCount: entries.filter((entry) => entry.sensitive).length,
    entries,
  }
}

async function fingerprintPreviewContract(source, contractPaths) {
  const entries = []
  const uniquePaths = [...new Set(contractPaths.map(normalizeContractPath))].sort(compareNames)
  for (const contractPath of uniquePaths) {
    const nativeRelative = contractPath.split('/').join(path.sep)
    const absolutePath = path.resolve(source.sourceRootNative, nativeRelative)
    if (!isWithin(source.sourceRootNative, absolutePath)) {
      throw new PreviewIdentityError('INVALID_CONTRACT_PATH', `contract path escapes source root: ${contractPath}`)
    }
    const entry = await resolveFileEntry(absolutePath, `repo/${contractPath}`, {
      allowedRoot: source.sourceRootNative,
    })
    if (entry) {
      entries.push(entry)
      continue
    }
    entries.push({
      path: `repo/${contractPath}`,
      digest: hashText(`missing:${contractPath}`),
      size: 0,
      type: 'missing',
      sensitive: false,
    })
  }
  return {
    fingerprint: fingerprintEntries(entries, 'website-preview-contract'),
    fileCount: entries.length,
    totalBytes: entries.reduce((total, entry) => total + entry.size, 0),
    entries,
  }
}

function getGitHead(sourceRoot) {
  const result = spawnSync('git', ['-C', sourceRoot, 'rev-parse', '--verify', 'HEAD^{commit}'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.status !== 0) return null
  const commit = String(result.stdout || '').trim().toLowerCase()
  return /^[0-9a-f]{40}$/.test(commit) ? commit : null
}

function normalizePid(value) {
  const text = String(value)
  if (!/^[1-9][0-9]*$/.test(text)) {
    throw new PreviewIdentityError('INVALID_PID', 'pid must be a positive integer')
  }
  const pid = Number(text)
  if (!Number.isSafeInteger(pid)) {
    throw new PreviewIdentityError('INVALID_PID', 'pid is outside the safe integer range')
  }
  return pid
}

function normalizeStartTicks(value) {
  if (value === undefined || value === null || value === '') return null
  const text = String(value)
  if (!/^[0-9]+$/.test(text)) {
    throw new PreviewIdentityError('INVALID_START_TICKS', 'expected start ticks must be decimal digits')
  }
  return text
}

async function readProcFile(pid, name) {
  try {
    return await fs.readFile(`/proc/${pid}/${name}`)
  } catch (error) {
    if (['EACCES', 'ENOENT', 'ESRCH'].includes(error?.code)) return null
    throw error
  }
}

function parseProcStartTicks(stat) {
  const text = String(stat || '')
  const commandEnd = text.lastIndexOf(')')
  if (commandEnd < 0) return null
  const fields = text.slice(commandEnd + 2).trim().split(/\s+/)
  const startTicks = fields[19]
  return /^[0-9]+$/.test(startTicks || '') ? startTicks : null
}

/**
 * Proves that a manifest PID still names the exact WSL supervisor that was
 * started for this worktree.  A missing/reused/unreadable PID is not an error
 * condition for callers: it is an explicitly unprovable, fail-closed result.
 * The command line itself is intentionally not returned because it can carry
 * unrelated sensitive arguments; callers receive a marker check and digest.
 */
export async function inspectWebsitePreviewSupervisor(pid, {
  sourceRoot = DEFAULT_SOURCE_ROOT,
  expectedStartTicks = null,
  scriptMarker = 'scripts/run-local-website.sh',
} = {}) {
  const normalizedPid = normalizePid(pid)
  const normalizedExpectedStartTicks = normalizeStartTicks(expectedStartTicks)
  const normalizedMarker = validateIdentityText(scriptMarker, 'script marker')
  const source = await resolvePreviewSource(sourceRoot)
  const base = {
    pid: normalizedPid,
    sourceRoot: source.sourceRoot,
    expectedStartTicks: normalizedExpectedStartTicks,
    scriptMarker: normalizedMarker,
    alive: false,
    startTicks: null,
    cwd: null,
    cwdMatches: false,
    commandMarkerMatches: false,
    commandLineFingerprint: null,
    valid: false,
    reason: null,
  }
  if (process.platform !== 'linux') {
    return { ...base, reason: 'linux_procfs_unavailable' }
  }

  const stat = await readProcFile(normalizedPid, 'stat')
  if (!stat) return { ...base, reason: 'process_missing' }
  const startTicks = parseProcStartTicks(stat.toString('utf8'))
  if (!startTicks) return { ...base, reason: 'start_ticks_unavailable' }

  let cwd
  try {
    cwd = normalizePath(await fs.realpath(`/proc/${normalizedPid}/cwd`))
  } catch (error) {
    if (['EACCES', 'ENOENT', 'ESRCH'].includes(error?.code)) {
      return { ...base, alive: true, startTicks, reason: 'cwd_unavailable' }
    }
    throw error
  }
  const commandLine = await readProcFile(normalizedPid, 'cmdline')
  if (!commandLine) {
    return {
      ...base,
      alive: true,
      startTicks,
      cwd,
      cwdMatches: cwd === source.sourceRoot,
      reason: 'cmdline_unavailable',
    }
  }
  const commandText = commandLine.toString('utf8').replace(/\0/g, ' ').trim()
  const cwdMatches = cwd === source.sourceRoot
  const commandMarkerMatches = commandText.includes(normalizedMarker)
  const startTicksMatch = normalizedExpectedStartTicks === null || startTicks === normalizedExpectedStartTicks
  const valid = startTicksMatch && cwdMatches && commandMarkerMatches
  return {
    ...base,
    alive: true,
    startTicks,
    cwd,
    cwdMatches,
    commandMarkerMatches,
    commandLineFingerprint: `${HASH_PREFIX}${hashText(commandLine)}`,
    valid,
    reason: valid
      ? 'verified'
      : !startTicksMatch
        ? 'start_ticks_mismatch'
        : !cwdMatches
          ? 'cwd_mismatch'
          : 'script_marker_mismatch',
  }
}

export async function fingerprintWebsitePreviewInputs(sourceRoot = DEFAULT_SOURCE_ROOT, { includeEntries = false } = {}) {
  const source = await resolvePreviewSource(sourceRoot)
  const result = await fingerprintResolvedWebsiteInputs(source)
  return {
    fingerprint: result.fingerprint,
    fileCount: result.fileCount,
    totalBytes: result.totalBytes,
    sensitiveFileCount: result.sensitiveFileCount,
    ...(includeEntries ? { entries: sanitizeEntries(result.entries) } : {}),
  }
}

export async function calculateWebsitePreviewIdentity(sourceRoot = DEFAULT_SOURCE_ROOT, {
  route = DEFAULT_PREVIEW_ROUTE,
  protocol = DEFAULT_PREVIEW_PROTOCOL,
  buildContract = DEFAULT_BUILD_CONTRACT,
  contractPaths = DEFAULT_CONTRACT_PATHS,
  includeEntries = false,
  sourceCommit = undefined,
} = {}) {
  const normalizedRoute = normalizeRoute(route)
  const normalizedProtocol = validateIdentityText(protocol, 'protocol')
  const normalizedBuildContract = validateIdentityText(buildContract, 'build contract')
  if (!Array.isArray(contractPaths)) {
    throw new PreviewIdentityError('INVALID_CONTRACT_PATHS', 'contractPaths must be an array')
  }
  const source = await resolvePreviewSource(sourceRoot)
  const [inputs, contract] = await Promise.all([
    fingerprintResolvedWebsiteInputs(source),
    fingerprintPreviewContract(source, contractPaths),
  ])
  const diagnosticCommit = sourceCommit === undefined ? getGitHead(source.sourceRootNative) : sourceCommit
  if (diagnosticCommit !== null && diagnosticCommit !== undefined &&
    (typeof diagnosticCommit !== 'string' || !/^[0-9a-f]{40}$/i.test(diagnosticCommit))) {
    throw new PreviewIdentityError('INVALID_SOURCE_COMMIT', 'sourceCommit must be a Git SHA or null')
  }
  const instanceFingerprint = fingerprintDescriptor({
    sourceRoot: source.sourceRoot,
    module: WEBSITE_MODULE,
    route: normalizedRoute,
    protocol: normalizedProtocol,
    buildContract: normalizedBuildContract,
    inputFingerprint: inputs.fingerprint,
    contractFingerprint: contract.fingerprint,
  })
  return {
    version: PREVIEW_IDENTITY_VERSION,
    algorithm: HASH_ALGORITHM,
    module: WEBSITE_MODULE,
    sourceRoot: source.sourceRoot,
    websiteRoot: source.websiteRoot,
    route: normalizedRoute,
    protocol: normalizedProtocol,
    buildContract: normalizedBuildContract,
    sourceCommit: diagnosticCommit ? diagnosticCommit.toLowerCase() : null,
    inputFingerprint: inputs.fingerprint,
    contractFingerprint: contract.fingerprint,
    instanceFingerprint,
    cacheKey: instanceFingerprint.slice(HASH_PREFIX.length),
    inputFileCount: inputs.fileCount,
    contractFileCount: contract.fileCount,
    totalBytes: inputs.totalBytes + contract.totalBytes,
    sensitiveFileCount: inputs.sensitiveFileCount,
    ...(includeEntries ? {
      inputEntries: sanitizeEntries(inputs.entries),
      contractEntries: sanitizeEntries(contract.entries),
    } : {}),
  }
}

function parseArgs(argv) {
  const options = { json: false, entries: false, contractFiles: [] }
  const positional = []
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--json') {
      options.json = true
    } else if (value === '--entries') {
      options.entries = true
    } else if (value === '--contract-file') {
      const next = argv[index + 1]
      if (next === undefined || next.startsWith('--')) {
        throw new PreviewIdentityError('USAGE', 'Missing value for --contract-file')
      }
      options.contractFiles.push(next)
      index += 1
    } else if (value.startsWith('--')) {
      const key = value.slice(2)
      const next = argv[index + 1]
      if (next === undefined || next.startsWith('--')) {
        throw new PreviewIdentityError('USAGE', `Missing value for ${value}`)
      }
      options[key] = next
      index += 1
    } else {
      positional.push(value)
    }
  }
  return { command: positional[0], options }
}

function printUsage() {
  process.stdout.write(`Usage:\n  website-local-preview-state.mjs identity [--source-root PATH] [--route ROUTE] [--protocol VALUE] [--build-contract VALUE] [--contract-file PATH]... [--entries] [--json]\n  website-local-preview-state.mjs inputs [--source-root PATH] [--entries] [--json]\n  website-local-preview-state.mjs process --pid PID [--source-root PATH] [--expected-start-ticks TICKS] [--script-marker TEXT] [--json]\n`)
}

function printResult(result, { json = false } = {}) {
  if (json) {
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`)
    return
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

async function runCli(argv) {
  const { command, options } = parseArgs(argv)
  if (!command || command === 'help') {
    printUsage()
    return
  }
  const sourceRoot = options['source-root'] || DEFAULT_SOURCE_ROOT
  if (command === 'inputs') {
    const result = await fingerprintWebsitePreviewInputs(sourceRoot, { includeEntries: options.entries })
    printResult(result, options)
    return
  }
  if (command === 'identity') {
    const result = await calculateWebsitePreviewIdentity(sourceRoot, {
      route: options.route || DEFAULT_PREVIEW_ROUTE,
      protocol: options.protocol || DEFAULT_PREVIEW_PROTOCOL,
      buildContract: options['build-contract'] || DEFAULT_BUILD_CONTRACT,
      contractPaths: [...DEFAULT_CONTRACT_PATHS, ...options.contractFiles],
      includeEntries: options.entries,
    })
    printResult(result, options)
    return
  }
  if (command === 'process') {
    if (!options.pid) throw new PreviewIdentityError('USAGE', 'Missing required option --pid')
    const result = await inspectWebsitePreviewSupervisor(options.pid, {
      sourceRoot,
      expectedStartTicks: options['expected-start-ticks'] || null,
      scriptMarker: options['script-marker'] || 'scripts/run-local-website.sh',
    })
    printResult(result, options)
    return
  }
  throw new PreviewIdentityError('USAGE', `Unknown command: ${command}`)
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
    else process.stderr.write(`[website-local-preview-state] ${payload.error.code}: ${payload.error.message}\n`)
    process.exitCode = error?.code === 'USAGE' ? 2 : 1
  })
}
