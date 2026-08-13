import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectCancelledBeforeRunnerDeployJob,
  validateAttestedStagingCorePredecessor,
} from "./ponto-cancelled-core-before-mutation.mjs";

const releaseSha = "a".repeat(40);
const predecessorSha = "b".repeat(40);
const workerName = "skincos-ponto-core-staging";
const deployJob = {
  name: "deploy",
  status: "completed",
  conclusion: "cancelled",
  steps: [],
  runner_id: null,
  runner_name: null,
  runner_group_id: null,
  runner_group_name: null,
  started_at: "2026-08-13T17:34:47Z",
  completed_at: "2026-08-13T17:34:46Z",
};

test("accepts only a deploy job cancelled before runner allocation", () => {
  const result = inspectCancelledBeforeRunnerDeployJob({
    total_count: 1,
    jobs: [deployJob],
  });
  assert.deepEqual(result, {
    passed: true,
    job: {
      conclusion: "cancelled",
      runnerAllocated: false,
      stepCount: 0,
      timing: "completed-not-after-started",
    },
  });
});

test("rejects a cancelled deploy that received a runner, steps, or an execution window", () => {
  assert.equal(
    inspectCancelledBeforeRunnerDeployJob({
      total_count: 1,
      jobs: [{ ...deployJob, runner_id: 12 }],
    }).reason,
    "deploy-job-had-runner",
  );
  assert.equal(
    inspectCancelledBeforeRunnerDeployJob({
      total_count: 1,
      jobs: [{ ...deployJob, steps: [{ name: "checkout" }] }],
    }).reason,
    "deploy-job-has-steps",
  );
  assert.equal(
    inspectCancelledBeforeRunnerDeployJob({
      total_count: 1,
      jobs: [{ ...deployJob, completed_at: "2026-08-13T17:35:47Z" }],
    }).reason,
    "deploy-job-has-execution-window",
  );
});

test("requires a fresh, different, private staging Core predecessor attestation", () => {
  const proof = {
    schemaVersion: 1,
    target: "staging",
    predecessorMode: "staging-incumbent",
    sourceSha: predecessorSha,
    versionId: "b71704e3-0d6d-4327-83cf-3121010995b1",
    deploymentId: "e6845b49-0d6d-4327-83cf-3121010995b1",
    worker: workerName,
    liveAttested: true,
    credentialsIncluded: false,
    piiIncluded: false,
  };
  assert.equal(
    validateAttestedStagingCorePredecessor({ proof, releaseSha, workerName }).passed,
    true,
  );
  assert.equal(
    validateAttestedStagingCorePredecessor({
      proof: { ...proof, sourceSha: releaseSha },
      releaseSha,
      workerName,
    }).reason,
    "staging-core-predecessor-not-attested",
  );
  assert.equal(
    validateAttestedStagingCorePredecessor({
      proof: { ...proof, liveAttested: false },
      releaseSha,
      workerName,
    }).reason,
    "staging-core-predecessor-not-attested",
  );
});
