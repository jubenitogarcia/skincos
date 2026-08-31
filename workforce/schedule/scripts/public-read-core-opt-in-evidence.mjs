import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

export const SCHEDULE_PUBLIC_READ_CORE_OPT_IN_CONTRACT = 'schedule-public-read-core-opt-in/v1'
export const SCHEDULE_PUBLIC_READ_CORE_WORKFLOW = '.github/workflows/deploy-escala-api.yml'
export const SCHEDULE_PUBLIC_READ_CORE_STAGING_WORKER = 'skincos-escala-api-staging'

const SHA = /^[0-9a-f]{40}$/
const RUN_ID = /^[1-9][0-9]*$/

function requiredText(value, label) {
  const normalized = String(value || '').trim()
  if (!normalized) throw new Error(`${label} is required`)
  return normalized
}

function requiredSha(value, label) {
  const normalized = requiredText(value, label).toLowerCase()
  if (!SHA.test(normalized)) throw new Error(`${label} must be a full lowercase SHA`)
  return normalized
}

function requiredRunId(value, label) {
  const normalized = requiredText(value, label)
  if (!RUN_ID.test(normalized)) throw new Error(`${label} must be a positive numeric GitHub Actions run id`)
  return normalized
}

export function createSchedulePublicReadCoreOptInEvidence({ sourceSha, workflowRunId, workflowRunAttempt = '1' }) {
  const normalizedAttempt = requiredText(workflowRunAttempt, 'workflowRunAttempt')
  if (normalizedAttempt !== '1') throw new Error('workflowRunAttempt must be 1')
  return {
    schemaVersion: 1,
    contract: SCHEDULE_PUBLIC_READ_CORE_OPT_IN_CONTRACT,
    unit: 'escala-api',
    target: 'staging',
    workflowPath: SCHEDULE_PUBLIC_READ_CORE_WORKFLOW,
    workflowRunId: requiredRunId(workflowRunId, 'workflowRunId'),
    workflowRunAttempt: 1,
    sourceSha: requiredSha(sourceSha, 'sourceSha'),
    coreWorker: SCHEDULE_PUBLIC_READ_CORE_STAGING_WORKER,
    schedulePublicReadEnabled: true,
  }
}

export function verifySchedulePublicReadCoreOptInEvidence(document, { sourceSha, workflowRunId } = {}) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('core opt-in evidence must be an object')
  }
  const expected = createSchedulePublicReadCoreOptInEvidence({
    sourceSha: sourceSha || document.sourceSha,
    workflowRunId: workflowRunId || document.workflowRunId,
    workflowRunAttempt: String(document.workflowRunAttempt || ''),
  })
  for (const [key, value] of Object.entries(expected)) {
    if (document[key] !== value) throw new Error(`core opt-in evidence field differs: ${key}`)
  }
  const allowedKeys = new Set(Object.keys(expected))
  for (const key of Object.keys(document)) {
    if (!allowedKeys.has(key)) throw new Error(`core opt-in evidence has an unexpected field: ${key}`)
  }
  return expected
}

async function writeEvidence(filePath) {
  const evidence = createSchedulePublicReadCoreOptInEvidence({
    sourceSha: process.env.PROMOTION_SOURCE_SHA,
    workflowRunId: process.env.GITHUB_RUN_ID,
    workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT,
  })
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(evidence)}\n`, 'utf8')
}

async function verifyEvidence(filePath) {
  const document = JSON.parse(await readFile(filePath, 'utf8'))
  verifySchedulePublicReadCoreOptInEvidence(document, {
    sourceSha: process.env.SCHEDULE_PUBLIC_READ_EXPECTED_SOURCE_SHA,
    workflowRunId: process.env.SCHEDULE_PUBLIC_READ_EXPECTED_WORKFLOW_RUN_ID,
  })
}

async function main() {
  const [command, filePath] = process.argv.slice(2)
  if (!['write', 'verify'].includes(command) || !filePath) {
    throw new Error('usage: public-read-core-opt-in-evidence.mjs <write|verify> <file>')
  }
  if (command === 'write') await writeEvidence(filePath)
  else await verifyEvidence(filePath)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
