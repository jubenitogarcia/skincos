import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SCHEDULE_PUBLIC_READ_ADAPTER_BOOTSTRAP_CONTRACT,
  SCHEDULE_PUBLIC_READ_ADAPTER_STAGING_WORKER,
  SCHEDULE_PUBLIC_READ_ADAPTER_WORKFLOW,
  createSchedulePublicReadAdapterBootstrapEvidence,
  lifecycleConfigDigest,
  verifySchedulePublicReadAdapterBootstrapEvidence,
} from './scripts/public-read-bootstrap-evidence.mjs'

const sourceSha = 'a'.repeat(40)
const workflowRunId = '123456789'
const digest = lifecycleConfigDigest('name = "schedule-public-read"\n[[migrations]]\ntag = "v1"\n')

test('disabled adapter bootstrap evidence binds the canonical workflow, staging worker, and lifecycle config', () => {
  const evidence = createSchedulePublicReadAdapterBootstrapEvidence({ sourceSha, workflowRunId, lifecycleConfigDigest: digest })
  assert.deepEqual(evidence, {
    schemaVersion: 1,
    contract: SCHEDULE_PUBLIC_READ_ADAPTER_BOOTSTRAP_CONTRACT,
    unit: 'schedule-public-read-adapter',
    target: 'staging',
    workflowPath: SCHEDULE_PUBLIC_READ_ADAPTER_WORKFLOW,
    workflowRunId,
    workflowRunAttempt: 1,
    sourceSha,
    worker: SCHEDULE_PUBLIC_READ_ADAPTER_STAGING_WORKER,
    operation: 'bootstrap-disabled',
    schedulePublicReadEnabled: false,
    lifecycleConfigDigest: digest,
  })
  assert.deepEqual(verifySchedulePublicReadAdapterBootstrapEvidence(evidence, { sourceSha, workflowRunId, lifecycleConfigDigest: digest }), evidence)
})

test('disabled adapter bootstrap evidence rejects a changed source, lifecycle, enabled flag, rerun, or extra field', () => {
  const evidence = createSchedulePublicReadAdapterBootstrapEvidence({ sourceSha, workflowRunId, lifecycleConfigDigest: digest })
  assert.throws(() => verifySchedulePublicReadAdapterBootstrapEvidence(evidence, { sourceSha: 'b'.repeat(40), workflowRunId, lifecycleConfigDigest: digest }), /sourceSha/)
  assert.throws(() => verifySchedulePublicReadAdapterBootstrapEvidence({ ...evidence, lifecycleConfigDigest: 'b'.repeat(64) }, { workflowRunId, lifecycleConfigDigest: digest }), /lifecycleConfigDigest/)
  assert.throws(() => verifySchedulePublicReadAdapterBootstrapEvidence({ ...evidence, schedulePublicReadEnabled: true }, { workflowRunId, lifecycleConfigDigest: digest }), /schedulePublicReadEnabled/)
  assert.throws(() => verifySchedulePublicReadAdapterBootstrapEvidence({ ...evidence, workflowRunAttempt: 2 }, { workflowRunId, lifecycleConfigDigest: digest }), /workflowRunAttempt/)
  assert.throws(() => verifySchedulePublicReadAdapterBootstrapEvidence({ ...evidence, extra: true }, { workflowRunId, lifecycleConfigDigest: digest }), /unexpected field/)
})
