import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  validateLiveDeploymentPrecondition,
  validatePilotBaselineOwnership,
} from "./ponto-live-deployment-precondition.mjs";

const releaseSha = "a".repeat(40);
const candidate = "11111111-1111-4111-8111-111111111111";
const incumbent = "22222222-2222-4222-8222-222222222222";
const deploymentId = "33333333-3333-4333-8333-333333333333";

function fixture({ stage = "pilot", candidatePercent = 0, incumbentPercent = 100, surfaceName = "coreApi" } = {}) {
  return {
    status: {
      id: deploymentId,
      versions: [
        { version_id: incumbent, percentage: incumbentPercent },
        { version_id: candidate, percentage: candidatePercent },
      ],
    },
    evidence: {
      schemaVersion: 2,
      unit: "ponto",
      stage,
      sourceSha: releaseSha,
      surfaces: {
        [surfaceName]: {
          deploymentId,
          candidateVersionId: candidate,
          incumbentVersionId: incumbent,
          candidatePercent,
          incumbentPercent,
        },
      },
    },
    surfaceName,
    target: stage === "pilot" ? "canary" : stage === "canary" ? "production" : "rollback",
    predecessorStage: stage,
    rollbackFromStage: stage === "production" ? "production" : "",
    releaseSha,
    expectedCandidateVersionId: candidate,
    expectedIncumbentVersionId: incumbent,
  };
}

test("accepts a current canary precondition only when live Core equals pilot evidence", () => {
  const result = validateLiveDeploymentPrecondition(fixture());
  assert.equal(result.passed, true);
  assert.equal(result.deploymentId, deploymentId);
  assert.equal(result.mutationPerformed, false);
});

test("accepts production only while Identity still equals exact canary evidence", () => {
  const input = fixture({ stage: "canary", surfaceName: "identityWorkforce" });
  const result = validateLiveDeploymentPrecondition(input);
  assert.equal(result.surface, "identityWorkforce");
  assert.equal(result.target, "production");
});

test("accepts explicit rollback from production with a single active candidate at 100 percent", () => {
  const input = fixture({ stage: "production", candidatePercent: 100, incumbentPercent: 0 });
  input.status.versions = [{ version_id: candidate, percentage: 100 }];
  const result = validateLiveDeploymentPrecondition(input);
  assert.equal(result.target, "rollback");
  assert.equal(result.candidatePercent, 100);
});

test("rejects a stale predecessor deployment ID before rollback", () => {
  const input = fixture({ stage: "production", candidatePercent: 100, incumbentPercent: 0 });
  input.status.id = "44444444-4444-4444-8444-444444444444";
  assert.throws(() => validateLiveDeploymentPrecondition(input), /deployment ID drifted/);
});

test("rejects stale predecessor version IDs and weight drift", () => {
  const staleId = fixture();
  staleId.status.versions[0].version_id = "55555555-5555-4555-8555-555555555555";
  assert.throws(() => validateLiveDeploymentPrecondition(staleId), /missing governed version|version set drifted/);

  const staleWeight = fixture();
  staleWeight.status.versions[0].percentage = 90;
  staleWeight.status.versions[1].percentage = 10;
  assert.throws(
    () => validateLiveDeploymentPrecondition(staleWeight),
    /live percentage for .* drifted/,
  );
});

test("requires the governed zero-weight candidate to remain explicit for pilot and canary", () => {
  const pilot = fixture();
  pilot.status.versions = [{ version_id: incumbent, percentage: 100 }];
  assert.throws(() => validateLiveDeploymentPrecondition(pilot), /version set drifted/);

  const canary = fixture({ stage: "canary" });
  canary.status.versions = [{ version_id: incumbent, percentage: 100 }];
  assert.throws(() => validateLiveDeploymentPrecondition(canary), /version set drifted/);
});

test("requires production predecessor status to contain only candidate at 100 percent", () => {
  const production = fixture({ stage: "production", candidatePercent: 100, incumbentPercent: 0 });
  assert.throws(() => validateLiveDeploymentPrecondition(production), /version set drifted/);
  production.status.versions = [{ version_id: candidate, percentage: 100 }];
  assert.equal(validateLiveDeploymentPrecondition(production).exactVersionSet, true);
});

test("rejects rollback_from_stage that differs from governed evidence", () => {
  const input = fixture({ stage: "production", candidatePercent: 100, incumbentPercent: 0 });
  input.rollbackFromStage = "canary";
  assert.throws(() => validateLiveDeploymentPrecondition(input), /rollback_from_stage differs/);
});

test("pilot baseline requires the exact deployment ID as well as incumbent version at 100 percent", () => {
  const status = {
    id: deploymentId,
    versions: [{ version_id: incumbent, percentage: 100 }],
  };
  for (const surfaceName of ["timekeeping", "coreApi", "identityWorkforce"]) {
    const result = validatePilotBaselineOwnership({
      status,
      surfaceName,
      expectedDeploymentId: deploymentId,
      expectedVersionId: incumbent,
    });
    assert.equal(result.exactDeployment, true);
    assert.equal(result.exactVersionSet, true);
  }
});

test("pilot baseline rejects a newer deployment even when it reuses the baseline version at 100 percent", () => {
  assert.throws(
    () => validatePilotBaselineOwnership({
      status: {
        id: "44444444-4444-4444-8444-444444444444",
        versions: [{ version_id: incumbent, percentage: 100 }],
      },
      surfaceName: "coreApi",
      expectedDeploymentId: deploymentId,
      expectedVersionId: incumbent,
    }),
    /deployment ID drifted/,
  );
});

test("pilot baseline rejects a changed or expanded version set under the original deployment ID", () => {
  assert.throws(
    () => validatePilotBaselineOwnership({
      status: {
        id: deploymentId,
        versions: [{ version_id: candidate, percentage: 100 }],
      },
      surfaceName: "identityWorkforce",
      expectedDeploymentId: deploymentId,
      expectedVersionId: incumbent,
    }),
    /version set drifted/,
  );
  assert.throws(
    () => validatePilotBaselineOwnership({
      status: {
        id: deploymentId,
        versions: [
          { version_id: incumbent, percentage: 100 },
          { version_id: candidate, percentage: 0 },
        ],
      },
      surfaceName: "timekeeping",
      expectedDeploymentId: deploymentId,
      expectedVersionId: incumbent,
    }),
    /version set drifted/,
  );
});

test("workflow checks both live surfaces before mutation and retains both pilot baseline checks", () => {
  const workflow = fs.readFileSync(new URL("../workflows/deploy-core-workers.yml", import.meta.url), "utf8");
  const coreDrift = workflow.indexOf("Fail closed on live Ponto Core drift from governed predecessor");
  const coreMutation = workflow.indexOf("Deploy exact Core weights or execute rollback");
  const identityDrift = workflow.indexOf("Fail closed on live Identity drift from governed predecessor");
  const identityMutation = workflow.indexOf("Deploy exact Identity weights or execute rollback");
  assert(coreDrift > 0 && coreDrift < coreMutation);
  assert(identityDrift > 0 && identityDrift < identityMutation);
  assert.match(workflow, /Resolve incumbent Core version before pilot[\s\S]*baseline_core_deployment_id[\s\S]*pilot-baseline[\s\S]*coreApi/);
  assert.match(workflow, /Resolve incumbent Identity version before pilot[\s\S]*baseline_identity_deployment_id[\s\S]*pilot-baseline[\s\S]*identityWorkforce/);
  assert.match(workflow, /ponto-live-deployment-precondition\.mjs[\s\S]*coreApi/);
  assert.match(workflow, /ponto-live-deployment-precondition\.mjs[\s\S]*identityWorkforce/);
  assert.match(workflow, /concurrency:\s*\n\s*group:\s*ponto-surface-mutation\s*\n\s*cancel-in-progress:\s*false/);
  assert.doesNotMatch(workflow, /ponto-(?:child-core|release-custody|staging-release-custody|production-release-custody)|deploy-core-worker-\{0\}-preview/);
});

test("Timekeeping candidate upload requires both root secrets in the selected environment without repository fallback", () => {
  const workflow = fs.readFileSync(new URL("../workflows/deploy-timekeeping.yml", import.meta.url), "utf8");
  const custody = workflow.indexOf("Require selected-environment custody for both candidate root secrets");
  const upload = workflow.indexOf("Upload immutable candidate version");
  assert(custody > 0 && custody < upload);
  const block = workflow.slice(custody, upload);
  assert.match(block, /environments\/\$TARGET_ENVIRONMENT\/secrets\?per_page=100/);
  assert.match(block, /\["PONTO_PROFILE_DATA_KEY", "PONTO_IDEMPOTENCY_KEY"\]/);
  assert.match(block, /repository fallback is refused/);
});
