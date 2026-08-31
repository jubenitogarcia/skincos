import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { assessClientesReadonlyStagingRelease } from '../src/release-contract.js'

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : null
}

const planPath = argument('--plan')
const requireReady = process.argv.includes('--require-ready')
const expectedSourceSha = argument('--expected-source-sha')
if (!planPath) {
  console.error('Usage: node scripts/release-gate.mjs --plan <path> [--require-ready --expected-source-sha <sha>]')
  process.exit(2)
}

const absolutePlanPath = path.resolve(process.cwd(), planPath)
let plan
try {
  plan = JSON.parse(fs.readFileSync(absolutePlanPath, 'utf8'))
} catch {
  console.error('CLIENTES_RELEASE_PLAN_INVALID')
  process.exit(2)
}

const result = assessClientesReadonlyStagingRelease(plan, {
  expectedSourceSha: requireReady ? expectedSourceSha : undefined,
})
console.log(JSON.stringify(result))
if (requireReady && !result.ok) process.exit(1)
