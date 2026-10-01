import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execFileSync } from 'node:child_process'

import { CLIENTES_READONLY_STAGING_RELEASE_EVIDENCE_CONTRACT_VERSION } from '../src/release-contract.js'

const SHA_PATTERN = /^[0-9a-f]{40}$/

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : null
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function insideDirectory(directory, candidate) {
  const relative = path.relative(directory, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

const sourceSha = String(argument('--source-sha') || '').trim()
const outputPath = argument('--output')
if (!SHA_PATTERN.test(sourceSha) || !outputPath) {
  console.error('Usage: node scripts/release-evidence.mjs --source-sha <sha> --output <external-path>')
  process.exit(2)
}

let repositoryRoot
let checkoutSha
let sourceTree
try {
  repositoryRoot = git(['rev-parse', '--show-toplevel'], process.cwd())
  checkoutSha = git(['rev-parse', 'HEAD'], repositoryRoot)
  sourceTree = git(['rev-parse', `${sourceSha}^{tree}`], repositoryRoot)
} catch {
  console.error('CLIENTES_RELEASE_EVIDENCE_GIT_IDENTITY_UNAVAILABLE')
  process.exit(2)
}

if (checkoutSha !== sourceSha || !SHA_PATTERN.test(sourceTree)) {
  console.error('CLIENTES_RELEASE_EVIDENCE_CHECKOUT_MISMATCH')
  process.exit(2)
}

const absoluteOutputPath = path.resolve(process.cwd(), outputPath)
if (insideDirectory(path.resolve(repositoryRoot), absoluteOutputPath)) {
  console.error('CLIENTES_RELEASE_EVIDENCE_MUST_BE_EXTERNAL')
  process.exit(2)
}

try {
  fs.mkdirSync(path.dirname(absoluteOutputPath), { recursive: true })
  fs.writeFileSync(absoluteOutputPath, `${JSON.stringify({
    contract: CLIENTES_READONLY_STAGING_RELEASE_EVIDENCE_CONTRACT_VERSION,
    target: 'staging',
    sourceSha,
    sourceTree,
  }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
} catch {
  console.error('CLIENTES_RELEASE_EVIDENCE_WRITE_FAILED')
  process.exit(2)
}

process.stdout.write(`${JSON.stringify({ ok: true, target: 'staging', sourceSha, sourceTree })}\n`)
