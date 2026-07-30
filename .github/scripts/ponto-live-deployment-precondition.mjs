import fs from "node:fs";
import { pathToFileURL } from "node:url";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{40}$/i;
const SURFACES = new Set(["coreApi", "identityWorkforce"]);
const BASELINE_SURFACES = new Set(["timekeeping", "coreApi", "identityWorkforce"]);
const TARGET_PREDECESSORS = {
  canary: new Set(["pilot"]),
  production: new Set(["canary"]),
  rollback: new Set(["pilot", "canary", "production"]),
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function activeDeployment(status) {
  const latest = status?.latest && typeof status.latest === "object" ? status.latest : status;
  return {
    id: String(latest?.id || latest?.deployment_id || "").toLowerCase(),
    versions: Array.isArray(latest?.versions) ? latest.versions : [],
  };
}

function versionWeights(versions) {
  const weights = new Map();
  for (const item of versions) {
    const id = String(item?.version_id || item?.id || "").toLowerCase();
    const percentage = Number(item?.percentage);
    assert(UUID.test(id), "live deployment contains an invalid Worker version ID");
    assert(Number.isFinite(percentage) && percentage >= 0 && percentage <= 100, "live deployment contains an invalid percentage");
    assert(!weights.has(id), "live deployment repeats a Worker version ID");
    weights.set(id, percentage);
  }
  assert(
    [...weights.values()].filter(value => value > 0).reduce((sum, value) => sum + value, 0) === 100,
    "live deployment active percentages must total 100",
  );
  return weights;
}

export function validateLiveDeploymentPrecondition({
  status,
  evidence,
  surfaceName,
  target,
  predecessorStage,
  rollbackFromStage = "",
  releaseSha,
  expectedCandidateVersionId,
  expectedIncumbentVersionId,
}) {
  assert(SURFACES.has(surfaceName), "surface must be coreApi or identityWorkforce");
  assert(TARGET_PREDECESSORS[target], "target must be canary, production, or rollback");
  assert(TARGET_PREDECESSORS[target].has(predecessorStage), `invalid ${target} predecessor stage`);
  if (target === "rollback") {
    assert(rollbackFromStage === predecessorStage, "rollback_from_stage differs from governed predecessor evidence");
  }
  assert(SHA.test(releaseSha), "release SHA must be full");
  assert(UUID.test(expectedCandidateVersionId), "governed candidate version ID is invalid");
  assert(UUID.test(expectedIncumbentVersionId), "governed incumbent version ID is invalid");
  assert(expectedCandidateVersionId.toLowerCase() !== expectedIncumbentVersionId.toLowerCase(), "candidate and incumbent IDs must differ");

  assert(evidence?.schemaVersion === 2 && evidence?.unit === "ponto", "predecessor evidence envelope is invalid");
  assert(evidence.stage === predecessorStage, "predecessor evidence stage differs");
  assert(String(evidence.sourceSha || "").toLowerCase() === releaseSha.toLowerCase(), "predecessor evidence SHA differs");
  const surface = evidence.surfaces?.[surfaceName];
  assert(surface && typeof surface === "object", `predecessor evidence lacks ${surfaceName}`);
  const candidateId = String(surface.candidateVersionId || "").toLowerCase();
  const incumbentId = String(surface.incumbentVersionId || "").toLowerCase();
  assert(candidateId === expectedCandidateVersionId.toLowerCase(), "predecessor candidate ID differs from the governed gate");
  assert(incumbentId === expectedIncumbentVersionId.toLowerCase(), "predecessor incumbent ID differs from the governed gate");
  assert(UUID.test(surface.deploymentId), "predecessor deployment ID is invalid");
  assert(Number.isInteger(surface.candidatePercent), "predecessor candidate percentage is invalid");
  assert(Number.isInteger(surface.incumbentPercent), "predecessor incumbent percentage is invalid");
  assert(surface.candidatePercent + surface.incumbentPercent === 100, "predecessor percentages must total 100");

  const expectedWeightsByStage = {
    pilot: [0, 100],
    canary: [0, 100],
    production: [100, 0],
  };
  const expectedStageWeights = expectedWeightsByStage[predecessorStage];
  assert(
    surface.candidatePercent === expectedStageWeights[0] &&
      surface.incumbentPercent === expectedStageWeights[1],
    "predecessor surface weights are invalid for its governed stage",
  );

  const live = activeDeployment(status);
  assert(UUID.test(live.id), "live deployment ID is invalid");
  assert(live.id === String(surface.deploymentId).toLowerCase(), "live deployment ID drifted from predecessor evidence");
  const weights = versionWeights(live.versions);
  const expectedLiveWeights = predecessorStage === "production"
    ? new Map([[candidateId, 100]])
    : new Map([[candidateId, 0], [incumbentId, 100]]);
  assert(weights.size === expectedLiveWeights.size, "live deployment version set drifted from governed command semantics");
  for (const [id, expectedPercentage] of expectedLiveWeights) {
    assert(weights.has(id), `live deployment is missing governed version ${id}`);
    assert(weights.get(id) === expectedPercentage, `live percentage for ${id} drifted from predecessor evidence`);
  }

  return {
    schemaVersion: 1,
    passed: true,
    surface: surfaceName,
    target,
    predecessorStage,
    releaseSha: releaseSha.toLowerCase(),
    deploymentId: live.id,
    candidateVersionId: candidateId,
    incumbentVersionId: incumbentId,
    candidatePercent: surface.candidatePercent,
    incumbentPercent: surface.incumbentPercent,
    exactVersionSet: true,
    stalePredecessorRejected: true,
    mutationPerformed: false,
    credentialsIncluded: false,
    piiIncluded: false,
  };
}

export function validatePilotBaselineOwnership({
  status,
  surfaceName,
  expectedDeploymentId,
  expectedVersionId,
}) {
  assert(BASELINE_SURFACES.has(surfaceName), "baseline surface must be timekeeping, coreApi, or identityWorkforce");
  assert(UUID.test(expectedDeploymentId), "baseline deployment ID is invalid");
  assert(UUID.test(expectedVersionId), "baseline version ID is invalid");

  const live = activeDeployment(status);
  assert(UUID.test(live.id), "live baseline deployment ID is invalid");
  assert(
    live.id === expectedDeploymentId.toLowerCase(),
    `${surfaceName} deployment ID drifted from the immutable pre-pilot baseline`,
  );
  const weights = versionWeights(live.versions);
  assert(
    weights.size === 1
      && weights.get(expectedVersionId.toLowerCase()) === 100,
    `${surfaceName} version set drifted from the immutable pre-pilot baseline`,
  );

  return {
    schemaVersion: 1,
    passed: true,
    surface: surfaceName,
    stage: "pilot",
    deploymentId: live.id,
    incumbentVersionId: expectedVersionId.toLowerCase(),
    incumbentPercent: 100,
    exactDeployment: true,
    exactVersionSet: true,
    mutationPerformed: false,
    credentialsIncluded: false,
    piiIncluded: false,
  };
}

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === "pilot-baseline") {
    const [, statusFile, surfaceName, reportFile] = args;
    assert(
      statusFile && surfaceName,
      "usage: ponto-live-deployment-precondition.mjs pilot-baseline <status.json> <surface> [report.json]",
    );
    let report;
    try {
      report = validatePilotBaselineOwnership({
        status: JSON.parse(fs.readFileSync(statusFile, "utf8")),
        surfaceName,
        expectedDeploymentId: required("PONTO_BASELINE_DEPLOYMENT_ID"),
        expectedVersionId: required("PONTO_BASELINE_VERSION_ID"),
      });
    } catch (error) {
      if (reportFile) {
        fs.writeFileSync(reportFile, `${JSON.stringify({
          schemaVersion: 1,
          passed: false,
          surface: surfaceName,
          stage: "pilot",
          mutationPerformed: false,
          credentialsIncluded: false,
          piiIncluded: false,
          error: error.message,
        }, null, 2)}\n`, { mode: 0o600 });
      }
      throw error;
    }
    if (reportFile) fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(
      `Live ${surfaceName} still matches immutable baseline deployment ${report.deploymentId} at version ${report.incumbentVersionId}@100.\n`,
    );
    return;
  }

  const [statusFile, evidenceFile, surfaceName, reportFile] = args;
  assert(statusFile && evidenceFile && surfaceName, "usage: ponto-live-deployment-precondition.mjs <status.json> <evidence.json> <surface> [report.json]");
  let report;
  try {
    report = validateLiveDeploymentPrecondition({
      status: JSON.parse(fs.readFileSync(statusFile, "utf8")),
      evidence: JSON.parse(fs.readFileSync(evidenceFile, "utf8")),
      surfaceName,
      target: required("PONTO_LIVE_TARGET"),
      predecessorStage: required("PONTO_LIVE_PREDECESSOR_STAGE"),
      rollbackFromStage: String(process.env.PONTO_LIVE_ROLLBACK_FROM_STAGE || "").trim(),
      releaseSha: required("PONTO_LIVE_RELEASE_SHA"),
      expectedCandidateVersionId: required("PONTO_LIVE_CANDIDATE_VERSION_ID"),
      expectedIncumbentVersionId: required("PONTO_LIVE_INCUMBENT_VERSION_ID"),
    });
  } catch (error) {
    if (reportFile) {
      fs.writeFileSync(reportFile, `${JSON.stringify({
        schemaVersion: 1,
        passed: false,
        surface: surfaceName,
        target: process.env.PONTO_LIVE_TARGET || "",
        predecessorStage: process.env.PONTO_LIVE_PREDECESSOR_STAGE || "",
        mutationPerformed: false,
        credentialsIncluded: false,
        piiIncluded: false,
        error: error.message,
      }, null, 2)}\n`, { mode: 0o600 });
    }
    throw error;
  }
  if (reportFile) fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`Live ${surfaceName} still matches governed ${report.predecessorStage} deployment ${report.deploymentId}.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Ponto live deployment precondition failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
