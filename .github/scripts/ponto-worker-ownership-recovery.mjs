import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{40}$/;
const RUN_ID = /^[1-9][0-9]*$/;

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

export function buildAuthorizedWorkerOwnership({
  run,
  replay,
  repository,
  recoveryRunId,
  coordinatorRunId,
  releaseSha,
  candidateVersionId,
}) {
  const normalizedReleaseSha = String(releaseSha || "").toLowerCase();
  const normalizedCandidateVersionId = String(candidateVersionId || "").toLowerCase();
  if (
    !RUN_ID.test(String(recoveryRunId || ""))
    || !RUN_ID.test(String(coordinatorRunId || ""))
    || !repository?.includes("/")
    || !SHA.test(normalizedReleaseSha)
    || !UUID.test(normalizedCandidateVersionId)
    || String(run?.id || "") !== String(recoveryRunId)
    || run?.path !== ".github/workflows/ponto-staging-recovery-rollback.yml"
    || run?.status !== "completed"
    || run?.conclusion !== "success"
    || Number(run?.run_attempt) !== 1
    || run?.head_branch !== "main"
    || run?.repository?.full_name !== repository
    || !SHA.test(String(run?.head_sha || "").toLowerCase())
    || !String(run?.display_title || "").includes(`coordinator=${coordinatorRunId}`)
    || replay?.schemaVersion !== 1
    || replay?.automaticInterruption !== true
    || replay?.sourceSha !== normalizedReleaseSha
    || replay?.failedStage !== "staging"
    || replay?.orchestratorRunId !== String(coordinatorRunId)
    || replay?.moduleMaintenanceRunId !== String(recoveryRunId)
    || replay?.moduleFailClosed !== true
    || replay?.passed !== true
    || replay?.credentialsIncluded !== false
    || replay?.piiIncluded !== false
  ) throw new Error("prior Ponto recovery ownership provenance is invalid");

  const proof = replay.proofs?.timekeeping;
  if (
    proof?.passed !== true
    || proof?.workerName !== "skincos-timekeeping-staging"
    || String(proof?.targetVersionId || "").toLowerCase() !== normalizedCandidateVersionId
    || Number(proof?.candidatePercent) !== 0
    || Number(proof?.incumbentPercent) !== 100
    || !["already-incumbent", "candidate-owned-reconciled"].includes(String(proof?.disposition || ""))
  ) throw new Error("prior Ponto recovery does not prove the current candidate worker ownership");

  return {
    schemaVersion: 1,
    target: "staging",
    workerName: "skincos-timekeeping-staging",
    candidateVersionId: normalizedCandidateVersionId,
    priorRecoveryRunId: String(recoveryRunId),
    priorCoordinatorRunId: String(coordinatorRunId),
    priorReleaseSha: normalizedReleaseSha,
    authorizedReplacementMessage: `ponto:auto-abort:${normalizedReleaseSha}:orchestrator-${coordinatorRunId}`,
    passed: true,
    credentialsIncluded: false,
    piiIncluded: false,
  };
}

function main() {
  const [runFile, artifactRoot, reportFile] = process.argv.slice(2);
  if (!runFile || !artifactRoot || !reportFile) {
    throw new Error("usage: ponto-worker-ownership-recovery.mjs <run.json> <artifact-root> <report.json>");
  }
  const run = readJson(runFile);
  const replay = readJson(path.join(artifactRoot, "automatic-rollback/ponto-automatic-rollback-replay.json"));
  const report = buildAuthorizedWorkerOwnership({
    run,
    replay,
    repository: process.env.GITHUB_REPOSITORY,
    recoveryRunId: process.env.PONTO_PRIOR_RECOVERY_RUN_ID,
    coordinatorRunId: process.env.PONTO_PRIOR_RECOVERY_COORDINATOR_RUN_ID,
    releaseSha: process.env.PONTO_PRIOR_RECOVERY_RELEASE_SHA,
    candidateVersionId: process.env.PONTO_TIMEKEEPING_CANDIDATE_VERSION_ID,
  });
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write("Prior Ponto recovery worker ownership is attested.\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Ponto prior recovery ownership failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
