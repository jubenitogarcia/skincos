import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const EXCLUDED_DIRECTORIES = new Set([
  '.cache',
  '.git',
  '.next',
  '.vite',
  '.wrangler',
  '.wrangler-staging',
  'coverage',
  'dist',
  'e2e',
  'node_modules',
  'playwright-report',
  'test-results',
  'tests',
])

const EXCLUDED_FILES = new Set([
  '.dev.vars',
])

const normalizeRelativePath = (value) => value.split(path.sep).join('/')

function shouldIncludeFile(relativePath) {
  const normalized = normalizeRelativePath(relativePath)
  const base = path.posix.basename(normalized)
  if (EXCLUDED_FILES.has(base)) return false
  if (base.endsWith('.log') || base.endsWith('.pid') || base.endsWith('.tmp')) return false
  if (/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(base)) return false
  if (base.startsWith('.dev.vars.')) return false
  return true
}

function collectBuildFiles(root, directory = root, result = []) {
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, 'en'))

  for (const entry of entries) {
    const absolute = path.join(directory, entry.name)
    const relative = path.relative(root, absolute)
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name)) collectBuildFiles(root, absolute, result)
      continue
    }
    if ((entry.isFile() || entry.isSymbolicLink()) && shouldIncludeFile(relative)) {
      result.push({ absolute, relative: normalizeRelativePath(relative), symbolicLink: entry.isSymbolicLink() })
    }
  }
  return result
}

function hashFileSet(files) {
  const hash = crypto.createHash('sha256')
  for (const file of files) {
    const content = file.symbolicLink
      ? Buffer.from(`symlink:${fs.readlinkSync(file.absolute)}`, 'utf8')
      : fs.readFileSync(file.absolute)
    hash.update(`${Buffer.byteLength(file.relative, 'utf8')}:`, 'utf8')
    hash.update(file.relative, 'utf8')
    hash.update(`\0${content.length}:`, 'utf8')
    hash.update(content)
    hash.update('\0', 'utf8')
  }
  return hash.digest('hex')
}

function hashFile(file) {
  if (!fs.existsSync(file)) return null
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

export function calculateBuildInputs(root) {
  const resolvedRoot = fs.realpathSync(root)
  const files = collectBuildFiles(resolvedRoot)
  return {
    inputFingerprint: hashFileSet(files),
    lockFingerprint: hashFile(path.join(resolvedRoot, 'package-lock.json')),
    fileCount: files.length,
    files: files.map((file) => file.relative),
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

export function evaluateBuildReuse({ root, statePath, distPath = path.join(root, 'dist') }) {
  const current = calculateBuildInputs(root)
  const previous = readJson(statePath)
  const distReady = fs.existsSync(path.join(distPath, 'index.html'))
  const fingerprintMatches = previous?.inputFingerprint === current.inputFingerprint
  const lockMatches = Boolean(current.lockFingerprint) && previous?.lockFingerprint === current.lockFingerprint

  let reason = 'input_changed'
  if (!distReady) reason = 'dist_missing'
  else if (!previous) reason = 'state_missing'
  else if (!fingerprintMatches) reason = 'input_changed'
  else reason = 'fingerprint_match'

  return {
    action: distReady && fingerprintMatches ? 'reuse' : 'build',
    reason,
    lockChanged: !lockMatches,
    ...current,
  }
}

export function writeBuildState({ root, statePath, persona, commit, sourceFingerprint }) {
  const current = calculateBuildInputs(root)
  const payload = {
    version: 2,
    persona: persona || null,
    commit: commit || null,
    sourceFingerprint: sourceFingerprint || null,
    inputFingerprint: current.inputFingerprint,
    lockFingerprint: current.lockFingerprint,
    fileCount: current.fileCount,
    updatedAt: new Date().toISOString(),
  }
  fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 })
  const temporary = `${statePath}.tmp.${process.pid}.${crypto.randomBytes(6).toString('hex')}`
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
    fs.renameSync(temporary, statePath)
  } finally {
    try { fs.unlinkSync(temporary) } catch {}
  }
  return payload
}

function parseArgs(argv) {
  const values = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!argument?.startsWith('--')) continue
    values[argument.slice(2)] = argv[index + 1]
    index += 1
  }
  return values
}

function requireArgument(args, name) {
  const value = args[name]
  if (!value) throw new Error(`Missing required argument --${name}`)
  return value
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    const command = process.argv[2]
    const args = parseArgs(process.argv.slice(3))
    const root = requireArgument(args, 'root')
    const statePath = requireArgument(args, 'state')

    if (command === 'evaluate') {
      const result = evaluateBuildReuse({ root, statePath, distPath: args.dist || path.join(root, 'dist') })
      if (args.format === 'tsv') {
        process.stdout.write([
          result.action,
          result.reason,
          String(result.lockChanged),
          result.inputFingerprint,
          result.lockFingerprint || 'missing',
          String(result.fileCount),
        ].join('\t') + '\n')
      } else {
        process.stdout.write(`${JSON.stringify(result)}\n`)
      }
    } else if (command === 'write') {
      const result = writeBuildState({
        root,
        statePath,
        persona: args.persona,
        commit: args.commit,
        sourceFingerprint: args['source-fingerprint'],
      })
      process.stdout.write(`${JSON.stringify(result)}\n`)
    } else {
      throw new Error(`Unsupported command '${command || ''}'. Use evaluate or write.`)
    }
  } catch (error) {
    process.stderr.write(`[crm-local-build] ${error.message}\n`)
    process.exitCode = 1
  }
}
