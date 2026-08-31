import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execFileSync } from 'node:child_process'

import { assessClientesReadonlyStagingRelease } from '../src/release-contract.js'

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : null
}

const planPath = argument('--plan')
const releaseEvidencePath = argument('--release-evidence')
const requireReady = process.argv.includes('--require-ready')
const expectedSourceSha = argument('--expected-source-sha')
if (!planPath) {
  console.error('Usage: node scripts/release-gate.mjs --plan <path> [--require-ready --expected-source-sha <sha> --release-evidence <external-path>]')
  process.exit(2)
}

function insideDirectory(directory, candidate) {
  const relative = path.relative(directory, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

const absolutePlanPath = path.resolve(process.cwd(), planPath)
let plan
try {
  plan = JSON.parse(fs.readFileSync(absolutePlanPath, 'utf8'))
} catch {
  console.error('CLIENTES_RELEASE_PLAN_INVALID')
  process.exit(2)
}

let releaseEvidence
let expectedSourceTree
if (releaseEvidencePath) {
  const absoluteEvidencePath = path.resolve(process.cwd(), releaseEvidencePath)
  if (requireReady) {
    let repositoryRoot
    let checkoutSha
    try {
      repositoryRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: process.cwd(),
        encoding: 'utf8',
      }).trim()
      checkoutSha = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: repositoryRoot,
        encoding: 'utf8',
      }).trim()
    } catch {
      console.error('CLIENTES_RELEASE_EVIDENCE_GIT_IDENTITY_UNAVAILABLE')
      process.exit(2)
    }
    if (insideDirectory(path.resolve(repositoryRoot), absoluteEvidencePath)) {
      console.error('CLIENTES_RELEASE_EVIDENCE_MUST_BE_EXTERNAL')
      process.exit(2)
    }
    if (/^[0-9a-f]{40}$/.test(String(expectedSourceSha || ''))) {
      if (checkoutSha !== expectedSourceSha) {
        console.error('CLIENTES_RELEASE_EVIDENCE_CHECKOUT_MISMATCH')
        process.exit(2)
      }
      try {
        expectedSourceTree = execFileSync('git', ['rev-parse', `${expectedSourceSha}^{tree}`], {
          cwd: repositoryRoot,
          encoding: 'utf8',
        }).trim()
      } catch {
        console.error('CLIENTES_RELEASE_EVIDENCE_GIT_IDENTITY_UNAVAILABLE')
        process.exit(2)
      }
    }
  }
  try {
    releaseEvidence = JSON.parse(fs.readFileSync(absoluteEvidencePath, 'utf8'))
  } catch {
    console.error('CLIENTES_RELEASE_EVIDENCE_INVALID')
    process.exit(2)
  }
}

const result = assessClientesReadonlyStagingRelease(plan, {
  expectedSourceSha: requireReady ? expectedSourceSha : undefined,
  expectedSourceTree: requireReady ? expectedSourceTree : undefined,
  releaseEvidence,
})
console.log(JSON.stringify(result))
if (requireReady && !result.ok) process.exit(1)
