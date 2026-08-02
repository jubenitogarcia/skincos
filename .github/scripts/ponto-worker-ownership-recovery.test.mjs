import assert from "node:assert/strict";
import test from "node:test";
import { buildAuthorizedWorkerOwnership } from "./ponto-worker-ownership-recovery.mjs";

const releaseSha = "a".repeat(40);
const candidateVersionId = "11111111-1111-4111-8111-111111111111";
const recoveryRunId = "987654321";
const coordinatorRunId = "123456789";

const run = {
  id: Number(recoveryRunId),
  path: ".github/workflows/ponto-staging-recovery-rollback.yml",
  status: "completed",
  conclusion: "success",
  run_attempt: 1,
  head_branch: "main",
  head_sha: "b".repeat(40),
  display_title: `Ponto staging recovery rollback ${releaseSha} coordinator=${coordinatorRunId}`,
  repository: { full_name: "jubenitogarcia/skincos" },
};

const replay = {
  schemaVersion: 1,
  automaticInterruption: true,
  sourceSha: releaseSha,
  failedStage: "staging",
  orchestratorRunId: coordinatorRunId,
  moduleMaintenanceRunId: recoveryRunId,
  moduleFailClosed: true,
  passed: true,
  credentialsIncluded: false,
  piiIncluded: false,
  proofs: {
    timekeeping: {
      passed: true,
      workerName: "skincos-timekeeping-staging",
      targetVersionId: candidateVersionId,
      candidatePercent: 0,
      incumbentPercent: 100,
      disposition: "already-incumbent",
    },
  },
};

test("builds a bounded replacement ownership message from a successful recovery artifact", () => {
  assert.deepEqual(
    buildAuthorizedWorkerOwnership({
      run,
      replay,
      repository: "jubenitogarcia/skincos",
      recoveryRunId,
      coordinatorRunId,
      releaseSha,
      candidateVersionId,
    }),
    {
      schemaVersion: 1,
      target: "staging",
      workerName: "skincos-timekeeping-staging",
      candidateVersionId,
      priorRecoveryRunId: recoveryRunId,
      priorCoordinatorRunId: coordinatorRunId,
      priorReleaseSha: releaseSha,
      authorizedReplacementMessage: `ponto:auto-abort:${releaseSha}:orchestrator-${coordinatorRunId}`,
      passed: true,
      credentialsIncluded: false,
      piiIncluded: false,
    },
  );
});

test("rejects an unsuccessful or differently owned prior recovery", () => {
  assert.throws(
    () => buildAuthorizedWorkerOwnership({
      run: { ...run, conclusion: "failure" },
      replay,
      repository: "jubenitogarcia/skincos",
      recoveryRunId,
      coordinatorRunId,
      releaseSha,
      candidateVersionId,
    }),
    /prior Ponto recovery ownership provenance is invalid/,
  );
  assert.throws(
    () => buildAuthorizedWorkerOwnership({
      run,
      replay: {
        ...replay,
        proofs: { timekeeping: { ...replay.proofs.timekeeping, targetVersionId: "22222222-2222-4222-8222-222222222222" } },
      },
      repository: "jubenitogarcia/skincos",
      recoveryRunId,
      coordinatorRunId,
      releaseSha,
      candidateVersionId,
    }),
    /does not prove the current candidate worker ownership/,
  );
});
