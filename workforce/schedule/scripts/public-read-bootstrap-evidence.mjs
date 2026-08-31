import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

export const SCHEDULE_PUBLIC_READ_ADAPTER_BOOTSTRAP_CONTRACT = 'schedule-public-read-adapter-bootstrap/v1'
export const SCHEDULE_PUBLIC_READ_ADAPTER_WORKFLOW = '.github/workflows/deploy-schedule-public-read-adapter.yml'
export const SCHEDULE_PUBLIC_READ_ADAPTER_STAGING_WORKER = 'skincos-schedule-public-read-staging'

const SHA = /^[0-9a-f]{40}$/
const RUN_ID = /^[1-9][0-9]*$/
const DIGEST = /^[0-9a-f]{64}$/

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

function requiredDigest(value, label) {
  const normalized = requiredText(value, label).toLowerCase()
  if (!DIGEST.test(normalized)) throw new Error(`${label} must be a SHA-256 digest`)
  return normalized
}

export function lifecycleConfigDigest(configText) {
  return createHash('sha256')
    .update(String(configText || '').replace(/\r\n/g, '\n'), 'utf8')
    .digest('hex')
}

export function createSchedulePublicReadAdapterBootstrapEvidence({ sourceSha, workflowRunId, workflowRunAttempt = '1', lifecycleConfigDigest: digest }) {
  const normalizedAttempt = requiredText(workflowRunAttempt, 'workflowRunAttempt')
  if (normalizedAttempt !== '1') throw new Error('workflowRunAttempt must be 1')
  return {
    schemaVersion: 1,
    contract: SCHEDULE_PUBLIC_READ_ADAPTER_BOOTSTRAP_CONTRACT,
    unit: 'schedule-public-read-adapter',
    target: 'staging',
    workflowPath: SCHEDULE_PUBLIC_READ_ADAPTER_WORKFLOW,
    workflowRunId: requiredRunId(workflowRunId, 'workflowRunId'),
    workflowRunAttempt: 1,
    sourceSha: requiredSha(sourceSha, 'sourceSha'),
    worker: SCHEDULE_PUBLIC_READ_ADAPTER_STAGING_WORKER,
    operation: 'bootstrap-disabled',
    schedulePublicReadEnabled: false,
    lifecycleConfigDigest: requiredDigest(digest, 'lifecycleConfigDigest'),
  }
}

export function verifySchedulePublicReadAdapterBootstrapEvidence(document, { sourceSha, workflowRunId, lifecycleConfigDigest: digest } = {}) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('adapter bootstrap evidence must be an object')
  }
  const expected = createSchedulePublicReadAdapterBootstrapEvidence({
    sourceSha: sourceSha || document.sourceSha,
    workflowRunId: workflowRunId || document.workflowRunId,
    workflowRunAttempt: String(document.workflowRunAttempt || ''),
    lifecycleConfigDigest: digest || document.lifecycleConfigDigest,
  })
  for (const [key, value] of Object.entries(expected)) {
    if (document[key] !== value) throw new Error(`adapter bootstrap evidence field differs: ${key}`)
  }
  const allowedKeys = new Set(Object.keys(expected))
  for (const key of Object.keys(document)) {
    if (!allowedKeys.has(key)) throw new Error(`adapter bootstrap evidence has an unexpected field: ${key}`)
  }
  return expected
}

async function readLifecycleConfigDigest(configPath) {
  return lifecycleConfigDigest(await readFile(configPath, 'utf8'))
}

async function writeEvidence(filePath, configPath) {
  const evidence = createSchedulePublicReadAdapterBootstrapEvidence({
    sourceSha: process.env.PROMOTION_SOURCE_SHA,
    workflowRunId: process.env.GITHUB_RUN_ID,
    workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT,
    lifecycleConfigDigest: await readLifecycleConfigDigest(configPath),
  })
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(evidence)}\n`, 'utf8')
}

async function verifyEvidence(filePath, configPath) {
  const document = JSON.parse(await readFile(filePath, 'utf8'))
  verifySchedulePublicReadAdapterBootstrapEvidence(document, {
    sourceSha: process.env.SCHEDULE_PUBLIC_READ_EXPECTED_SOURCE_SHA,
    workflowRunId: process.env.SCHEDULE_PUBLIC_READ_EXPECTED_WORKFLOW_RUN_ID,
    lifecycleConfigDigest: process.env.SCHEDULE_PUBLIC_READ_EXPECTED_LIFECYCLE_CONFIG_DIGEST || await readLifecycleConfigDigest(configPath),
  })
}

async function main() {
  const [command, firstPath, secondPath] = process.argv.slice(2)
  if (command === 'digest' && firstPath && !secondPath) {
    process.stdout.write(await readLifecycleConfigDigest(firstPath))
    return
  }
  if (!['write', 'verify'].includes(command) || !firstPath || !secondPath) {
    throw new Error('usage: public-read-bootstrap-evidence.mjs <digest config|write evidence config|verify evidence config>')
  }
  if (command === 'write') await writeEvidence(firstPath, secondPath)
  else await verifyEvidence(firstPath, secondPath)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
