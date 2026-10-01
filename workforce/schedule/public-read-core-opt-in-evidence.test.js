import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SCHEDULE_PUBLIC_READ_CORE_OPT_IN_CONTRACT,
  SCHEDULE_PUBLIC_READ_CORE_STAGING_WORKER,
  SCHEDULE_PUBLIC_READ_CORE_WORKFLOW,
  createSchedulePublicReadCoreOptInEvidence,
  verifySchedulePublicReadCoreOptInEvidence,
} from './scripts/public-read-core-opt-in-evidence.mjs'

const sourceSha = 'a'.repeat(40)
const workflowRunId = '123456789'

test('Schedule core opt-in evidence binds the canonical staging publisher and immutable source', () => {
  const evidence = createSchedulePublicReadCoreOptInEvidence({ sourceSha, workflowRunId })
  assert.deepEqual(evidence, {
    schemaVersion: 1,
    contract: SCHEDULE_PUBLIC_READ_CORE_OPT_IN_CONTRACT,
    unit: 'escala-api',
    target: 'staging',
    workflowPath: SCHEDULE_PUBLIC_READ_CORE_WORKFLOW,
    workflowRunId,
    workflowRunAttempt: 1,
    sourceSha,
    coreWorker: SCHEDULE_PUBLIC_READ_CORE_STAGING_WORKER,
    schedulePublicReadEnabled: true,
  })
  assert.deepEqual(verifySchedulePublicReadCoreOptInEvidence(evidence, { sourceSha, workflowRunId }), evidence)
})

test('Schedule core opt-in evidence rejects a wrong source, rerun, target, or unexpected capability', () => {
  const evidence = createSchedulePublicReadCoreOptInEvidence({ sourceSha, workflowRunId })
  assert.throws(() => verifySchedulePublicReadCoreOptInEvidence({ ...evidence, sourceSha: 'b'.repeat(40) }, { sourceSha, workflowRunId }), /sourceSha/)
  assert.throws(() => verifySchedulePublicReadCoreOptInEvidence({ ...evidence, workflowRunAttempt: 2 }, { sourceSha, workflowRunId }), /workflowRunAttempt/)
  assert.throws(() => verifySchedulePublicReadCoreOptInEvidence({ ...evidence, target: 'production' }, { sourceSha, workflowRunId }), /target/)
  assert.throws(() => verifySchedulePublicReadCoreOptInEvidence({ ...evidence, schedulePublicReadEnabled: false }, { sourceSha, workflowRunId }), /schedulePublicReadEnabled/)
  assert.throws(() => verifySchedulePublicReadCoreOptInEvidence({ ...evidence, extra: true }, { sourceSha, workflowRunId }), /unexpected field/)
})
