import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildWorkerRollbackArgs } from "./ponto-automatic-rollback-command.mjs";
import { attestPontoCloudflareResources } from "./ponto-cloudflare-resource-identity.mjs";
import { rollbackPagesWithReconciliation } from "./ponto-pages-rollback.mjs";
import {
  completePagesRollbackIntent,
  createPagesRollbackIntent,
  readPagesRollbackIntent,
  recordCreatedPagesRollbackIntent,
} from "./ponto-pages-rollback-intent.mjs";
import {
  attestPagesIncumbentState,
  classifyPagesRollbackOwnership,
  classifyWorkerRollbackOwnership,
} from "./ponto-rollback-ownership.mjs";
import { releaseTagFor } from "./ponto-release-identity.mjs";
import { attestBrokerFailCloseEvidence } from "./ponto-recovery-evidence.mjs";
import { readCloudflareKvJson } from "./ponto-kv-readback.mjs";

const [artifactRoot, reportFile] = process.argv.slice(2);
const releaseSha = String(process.env.RELEASE_SHA || "").trim().toLowerCase();
const stage = String(process.env.STAGE || "").trim().toLowerCase();
const orchestratorRunId = String(
  process.env.PONTO_COORDINATOR_RUN_ID || process.env.GITHUB_RUN_ID || "",
);
const repository = String(process.env.GITHUB_REPOSITORY || "");
const repositoryId = String(process.env.GITHUB_REPOSITORY_ID || "");
const recoveryRunId = String(process.env.GITHUB_RUN_ID || "");
const ghToken = String(process.env.GH_TOKEN || "");
const rollbackCheckToken = String(process.env.PONTO_ROLLBACK_CHECK_TOKEN || "");
const githubApiBase = String(process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
const pagesRollbackIntentHmacKey = String(
  process.env.PONTO_PAGES_ROLLBACK_INTENT_HMAC_KEY || "",
);
const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "");
const apiToken = String(process.env.CLOUDFLARE_API_TOKEN || "");
const pagesProject = String(process.env.CLOUDFLARE_PAGES_PROJECT || "");
const moduleControlNamespaceId = String(process.env.MODULE_CONTROL_KV_ID || "");
const moduleHealthUrl = String(process.env.PONTO_MODULE_HEALTH_URL || "").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const staging = stage === "staging";
const expectedPagesProject = staging ? "skincos-staging" : "skincos";
const expectedPagesBranch = staging ? "staging" : "main";
const expectedPagesAlias = staging ? "crm-staging.skincos.com.br" : "crm.skincos.com.br";
const expectedModuleHealthUrl = staging
  ? "https://api-staging.skincos.com.br/api/ponto/health"
  : "https://api.skincos.com.br/api/ponto/health";
const accessHeaders = {};
if (process.env.CF_ACCESS_CLIENT_ID || process.env.CF_ACCESS_CLIENT_SECRET) {
  if (!process.env.CF_ACCESS_CLIENT_ID || !process.env.CF_ACCESS_CLIENT_SECRET) throw new Error("partial Cloudflare Access credential");
  accessHeaders["CF-Access-Client-Id"] = process.env.CF_ACCESS_CLIENT_ID;
  accessHeaders["CF-Access-Client-Secret"] = process.env.CF_ACCESS_CLIENT_SECRET;
}

if (!artifactRoot || !reportFile) throw new Error("automatic rollback artifact root and report path are required");
if (!/^[0-9a-f]{40}$/.test(releaseSha) || !["staging", "pilot", "canary", "production"].includes(stage)) throw new Error("invalid automatic rollback identity");
const expectedReleaseBranch = releaseTagFor("ponto", releaseSha);
if (
  !/^[0-9]+$/.test(orchestratorRunId)
  || !repository.includes("/")
  || !/^[1-9][0-9]*$/.test(repositoryId)
  || !/^[1-9][0-9]*$/.test(recoveryRunId)
  || !ghToken
  || !rollbackCheckToken
  || Buffer.byteLength(pagesRollbackIntentHmacKey, "utf8") < 32
) throw new Error("invalid orchestrator or rollback-intent provenance");
if (
  !/^[0-9a-f]{32}$/.test(accountId)
  || !apiToken
  || pagesProject !== expectedPagesProject
  || !/^[0-9a-f]{32}$/i.test(moduleControlNamespaceId)
) throw new Error(`${stage} Cloudflare custody is unavailable`);

await attestPontoCloudflareResources({
  env: {
    ...process.env,
    PONTO_RESOURCE_TARGET: staging ? "staging" : "production",
    PONTO_MODULE_CONTROL_KV_ID: moduleControlNamespaceId,
    PONTO_OPPOSITE_MODULE_CONTROL_KV_ID: process.env.PONTO_OPPOSITE_MODULE_CONTROL_KV_ID,
  },
});

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const workerOwnershipReportFile = String(process.env.PONTO_WORKER_OWNERSHIP_REPORT || "");
const authorizedWorkerOwnership = (() => {
  if (!workerOwnershipReportFile) return null;
  if (!fs.existsSync(workerOwnershipReportFile)) throw new Error("authorized Worker ownership evidence is missing");
  const report = readJson(workerOwnershipReportFile);
  const expectedCandidateVersionId = String(process.env.PONTO_TIMEKEEPING_CANDIDATE_VERSION_ID || "").toLowerCase();
  if (
    report.schemaVersion !== 1
    || report.target !== (staging ? "staging" : stage)
    || report.workerName !== (staging ? "skincos-timekeeping-staging" : "skincos-timekeeping")
    || String(report.candidateVersionId || "").toLowerCase() !== expectedCandidateVersionId
    || report.passed !== true
    || report.credentialsIncluded !== false
    || report.piiIncluded !== false
    || !/^ponto:auto-abort:[0-9a-f]{40}:orchestrator-[1-9][0-9]*$/.test(String(report.authorizedReplacementMessage || ""))
  ) throw new Error("authorized Worker ownership evidence is invalid");
  return report;
})();
const brokerFailCloseFile = path.join(
  artifactRoot,
  "automatic-rollback/ponto-broker-fail-close.json",
);
const brokerFailClose = fs.existsSync(brokerFailCloseFile)
  ? readJson(brokerFailCloseFile)
  : null;
const safeReadbackFailureCode = (error) => {
  const code = String(error?.code || "cloudflare-kv-readback-failed");
  return /^[a-z0-9-]{1,96}$/.test(code) ? code : "cloudflare-kv-readback-failed";
};
const classifyBrokerReadback = ({ moduleControl, emergencyLatch }) => {
  const target = staging ? "staging" : "production";
  if (!brokerFailClose) return "broker-evidence-missing";
  if (!moduleControl) return "module-control-unavailable";
  if (moduleControl.schemaVersion !== 2) return "module-control-schema-mismatch";
  if (moduleControl.state !== "maintenance") return "module-control-state-mismatch";
  if (moduleControl.changedAt !== brokerFailClose.controlChangedAt) return "module-control-timestamp-mismatch";
  if (moduleControl.emergencyLatchRef?.stopRunId !== orchestratorRunId) return "module-control-stop-run-mismatch";
  if (moduleControl.emergencyLatchRef?.emergencyRunId !== brokerFailClose.emergencyRunId) return "module-control-emergency-run-mismatch";
  if (moduleControl.emergencyLatchRef?.latchChangedAt !== brokerFailClose.latchChangedAt) return "module-control-latch-timestamp-mismatch";
  if (!emergencyLatch) return "emergency-latch-unavailable";
  if (emergencyLatch.schemaVersion !== 1) return "emergency-latch-schema-mismatch";
  if (emergencyLatch.module !== "timekeeping") return "emergency-latch-module-mismatch";
  if (emergencyLatch.target !== target) return "emergency-latch-target-mismatch";
  if (emergencyLatch.latched !== true) return "emergency-latch-state-mismatch";
  if (emergencyLatch.changedAt !== brokerFailClose.latchChangedAt) return "emergency-latch-timestamp-mismatch";
  if (emergencyLatch.stopRunId !== orchestratorRunId) return "emergency-latch-stop-run-mismatch";
  if (emergencyLatch.emergencyRunId !== brokerFailClose.emergencyRunId) return "emergency-latch-emergency-run-mismatch";
  return "broker-evidence-attestation-mismatch";
};
const readExternalModuleHealth = async () => {
  if (moduleHealthUrl !== expectedModuleHealthUrl) {
    return { passed: false, status: 0, reason: "module-health-url-not-pinned" };
  }
  try {
    const response = await fetch(moduleHealthUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: { accept: "application/json", ...accessHeaders },
    });
    const payload = await response.json().catch(() => null);
    const availability = payload?.availability;
    return {
      passed: response.status === 200
        && payload?.ok === false
        && payload?.ready === false
        && availability?.state === "maintenance"
        && availability?.source === "control"
        && Number.isFinite(Date.parse(String(availability?.changedAt || "")))
        && availability?.changedAt === brokerFailClose?.controlChangedAt,
      status: response.status,
      state: String(availability?.state || ""),
      source: String(availability?.source || ""),
      changedAt: String(availability?.changedAt || ""),
    };
  } catch {
    return { passed: false, status: 0, reason: "module-health-probe-failed" };
  }
};
const attestNoSurfaceRollback = async () => {
  // A failed coordinator can legitimately discover zero child mutations. In
  // that case there is no incumbent deployment to restore; require the
  // immutable close artifact and a fresh external maintenance probe instead
  // of pretending that a direct KV readback or deployment rollback occurred.
  if (Object.keys(plan).length !== 0 || !brokerFailClose) return null;
  const evidenceValid = brokerFailClose.schemaVersion === 1
    && brokerFailClose.contractId === "skincos/ponto/emergency-close/v1"
    && brokerFailClose.coordinatorRunId === orchestratorRunId
    && brokerFailClose.releaseSha === releaseSha
    && brokerFailClose.stage === stage
    && brokerFailClose.target === (staging ? "staging" : "production")
    && brokerFailClose.state === "maintenance"
    && brokerFailClose.latched === true
    && Number.isFinite(Date.parse(String(brokerFailClose.controlChangedAt || "")))
    && Number.isFinite(Date.parse(String(brokerFailClose.latchChangedAt || "")))
    && brokerFailClose.emergencyLatchRef?.stopRunId === orchestratorRunId
    && brokerFailClose.emergencyLatchRef?.emergencyRunId === brokerFailClose.emergencyRunId
    && brokerFailClose.emergencyLatchRef?.latchChangedAt === brokerFailClose.latchChangedAt
    && brokerFailClose.propagation?.passed === true
    && brokerFailClose.passed === true
    && brokerFailClose.credentialsIncluded === false
    && brokerFailClose.piiIncluded === false;
  const health = await readExternalModuleHealth();
  if (!evidenceValid || !health.passed) return null;
  return {
    passed: true,
    emergencyRunId: brokerFailClose.emergencyRunId,
    state: "maintenance",
    controlChangedAt: brokerFailClose.controlChangedAt,
    latchChangedAt: brokerFailClose.latchChangedAt,
    readbackMode: "external-health-noop",
    externalHealth: health,
  };
};
const readAndAttestBrokerFailClose = async () => {
  let moduleControl = null;
  let emergencyLatch = null;
  let readbackFailure = "";
  try {
    try {
      moduleControl = await readCloudflareKvJson({
        accountId,
        namespaceId: moduleControlNamespaceId,
        key: "module-control:timekeeping",
        apiToken,
      });
    } catch (error) {
      readbackFailure = `control-${safeReadbackFailureCode(error)}`;
      throw error;
    }
    try {
      emergencyLatch = await readCloudflareKvJson({
        accountId,
        namespaceId: moduleControlNamespaceId,
        key: "module-control:timekeeping:emergency-latch",
        apiToken,
      });
    } catch (error) {
      readbackFailure = `latch-${safeReadbackFailureCode(error)}`;
      throw error;
    }
  } catch {
    moduleControl = null;
    emergencyLatch = null;
    if (!readbackFailure) readbackFailure = "cloudflare-kv-readback-failed";
  }
  const directAttestation = attestBrokerFailCloseEvidence({
    evidence: brokerFailClose,
    moduleControl,
    emergencyLatch,
    coordinatorRunId: orchestratorRunId,
    releaseSha,
    stage,
    target: staging ? "staging" : "production",
  });
  if (directAttestation.passed) {
    return {
      moduleControl,
      emergencyLatch,
      attestation: { ...directAttestation, readbackMode: "direct-kv", readbackFailure: "" },
    };
  }
  const noSurfaceAttestation = await attestNoSurfaceRollback();
  return {
    moduleControl,
    emergencyLatch,
    attestation: noSurfaceAttestation || {
      ...directAttestation,
      readbackFailure: readbackFailure || classifyBrokerReadback({ moduleControl, emergencyLatch }),
    },
  };
};
const surfaceSpecs = {
  timekeeping: {
    path: "surfaces/timekeeping/surface.json",
    journal: "mutations/timekeeping/mutation.json",
    run: "runs/timekeeping.json",
    workflow: "deploy-timekeeping.yml",
    workerName: staging ? "skincos-timekeeping-staging" : "skincos-timekeeping",
  },
  identityWorkforce: {
    path: "surfaces/identity/surface.json",
    journal: "mutations/identity/mutation.json",
    run: "runs/identity.json",
    workflow: "deploy-core-workers.yml",
    workerName: staging ? "skincos-insumos-staging" : "skincos-insumos",
  },
  coreApi: {
    path: "surfaces/core/surface.json",
    journal: "mutations/core/mutation.json",
    run: "runs/core.json",
    workflow: "deploy-core-workers.yml",
    workerName: staging ? "skincos-ponto-core-staging" : "skincos-ponto-core",
  },
  crmPages: {
    path: "surfaces/pages/surface.json",
    journal: "mutations/pages/mutation.json",
    run: "runs/pages.json",
    workflow: "deploy-crm-pages.yml",
  },
};
const expectedWeights = {
  staging: { timekeeping: 100, identityWorkforce: 100, coreApi: 100 },
  pilot: { timekeeping: 0, identityWorkforce: 0, coreApi: 0 },
  canary: { timekeeping: 0, identityWorkforce: 0, coreApi: 0 },
  production: { timekeeping: 100, identityWorkforce: 100, coreApi: 100 },
};
const isExactImmutableChildRun = (run, workflow) => (
  run?.workflow === workflow
  && run.status === "completed"
  && ["success", "failure", "cancelled", "timed_out", "action_required", "startup_failure"].includes(String(run.conclusion || ""))
  && run.event === "workflow_dispatch"
  && run.headBranch === expectedReleaseBranch
  && String(run.headSha || "").toLowerCase() === releaseSha
  && run.repository === repository
);
const plan = {};
const unresolved = [];
const untouched = {};
const retainedDataChanges = {};
for (const [name, spec] of Object.entries(surfaceSpecs)) {
  const surfaceFile = path.join(artifactRoot, spec.path);
  const runFile = path.join(artifactRoot, spec.run);
  const journalFile = path.join(artifactRoot, spec.journal);
  if (!fs.existsSync(runFile)) {
    untouched[name] = "not-dispatched";
    continue;
  }
  const run = readJson(runFile);
  if (!isExactImmutableChildRun(run, spec.workflow)) {
    unresolved.push({ surface: name, reason: "child-run-provenance-invalid" });
    continue;
  }
  const journal = fs.existsSync(journalFile) ? readJson(journalFile) : null;
  const journalValid = journal
    && journal.schemaVersion === 1
    && journal.surface === name
    && journal.stage === stage
    && String(journal.sourceSha || "").toLowerCase() === releaseSha
    && String(journal.runId) === String(run.runId)
    && String(journal.orchestratorRunId) === orchestratorRunId
    && journal.credentialsIncluded === false
    && journal.piiIncluded === false;
  if (!journalValid) unresolved.push({ surface: name, childRunId: String(run.runId), reason: "mutation-journal-missing-or-invalid" });
  const migrationStarted = journalValid && journal.migrationStarted === true;
  if (migrationStarted) {
    const migrationResolved = journal.migrationCompleted === true
      && journal.migrationDisposition === "retained-additive-schema"
      && typeof journal.checkpoint?.artifactName === "string"
      && journal.checkpoint.artifactName.includes(releaseSha)
      && /^[0-9a-f]{64}$/.test(String(journal.checkpoint?.sha256 || ""));
    retainedDataChanges[name] = {
      passed: migrationResolved,
      disposition: "retained-additive-schema",
      checkpointArtifact: String(journal.checkpoint?.artifactName || ""),
      checkpointSha256: String(journal.checkpoint?.sha256 || ""),
    };
    if (!migrationResolved) {
      unresolved.push({ surface: name, childRunId: String(run.runId), reason: "additive-migration-or-checkpoint-unresolved" });
    }
  }

  const surface = fs.existsSync(surfaceFile) ? readJson(surfaceFile) : null;
  const surfaceValid = surface
    && surface.surface === name
    && surface.stage === stage
    && String(surface.sourceSha || "").toLowerCase() === releaseSha
    && String(surface.runId) === String(run.runId)
    && run.conclusion === "success";
  if (surface && !surfaceValid) unresolved.push({ surface: name, childRunId: String(run.runId), reason: "surface-provenance-invalid" });
  if (!surfaceValid && journalValid && journal.mutationStarted !== true) {
    untouched[name] = migrationStarted
      ? "no-worker-traffic-mutation-additive-schema-retained"
      : "journal-proves-no-live-mutation";
    continue;
  }
  if (!surfaceValid && !journalValid) continue;
  const source = surfaceValid ? surface : journal;
  if (!surfaceValid && run.conclusion === "success") {
    unresolved.push({ surface: name, childRunId: String(run.runId), reason: "successful-child-surface-missing" });
  }
  if (!surfaceValid && journal?.mutationStarted !== true) continue;

  if (name === "crmPages") {
    const candidateDeploymentId = String(surfaceValid ? source.deploymentId : source.candidateDeploymentId || "");
    const incumbentDeploymentId = String(surfaceValid ? source.rollbackDeploymentId : source.incumbentDeploymentId || "");
    const restoredDeploymentId = journalValid && journal.rollbackCompleted === true
      ? String(journal.restoredDeploymentId || "")
      : "";
    if (
      !UUID.test(incumbentDeploymentId)
      || (candidateDeploymentId && !UUID.test(candidateDeploymentId))
      || (restoredDeploymentId && !UUID.test(restoredDeploymentId))
      || (journalValid && journal.rollbackCompleted === true && !restoredDeploymentId)
      || candidateDeploymentId === incumbentDeploymentId
      || (restoredDeploymentId && restoredDeploymentId === candidateDeploymentId)
      || (restoredDeploymentId && restoredDeploymentId === incumbentDeploymentId)
    ) {
      unresolved.push({ surface: name, childRunId: String(run.runId), reason: "pages-rollback-identities-invalid" });
      continue;
    }
    plan[name] = {
      childRunId: String(run.runId),
      source: surfaceValid ? "surface-manifest" : "mutation-journal",
      candidateDeploymentId,
      incumbentDeploymentId,
      restoredDeploymentId,
      alias: expectedPagesAlias,
    };
  } else {
    const candidateVersionId = String(source.candidateVersionId || "");
    const incumbentVersionId = String(source.incumbentVersionId || "");
    if (!UUID.test(incumbentVersionId) || !UUID.test(candidateVersionId) || candidateVersionId === incumbentVersionId) {
      unresolved.push({ surface: name, childRunId: String(run.runId), reason: "worker-rollback-identities-invalid" });
      continue;
    }
    if (surfaceValid && (
      Number(surface.candidatePercent) !== expectedWeights[stage][name]
      || Number(surface.incumbentPercent) !== 100 - expectedWeights[stage][name]
    )) {
      unresolved.push({ surface: name, childRunId: String(run.runId), reason: "surface-weight-policy-mismatch" });
      continue;
    }
    plan[name] = {
      childRunId: String(run.runId),
      source: surfaceValid ? "surface-manifest" : "mutation-journal",
      workerName: spec.workerName,
      candidateVersionId,
      incumbentVersionId,
      deploymentId: String(source.deploymentId || ""),
      candidatePercent: expectedWeights[stage][name],
      incumbentPercent: 100 - expectedWeights[stage][name],
      ...(name === "timekeeping" && authorizedWorkerOwnership
        ? { authorizedReplacementMessage: authorizedWorkerOwnership.authorizedReplacementMessage }
        : {}),
    };
  }
}

const environmentPrerequisites = {};
const pagesProvisionRunFile = path.join(artifactRoot, "runs/provision-pages.json");
if (fs.existsSync(pagesProvisionRunFile)) {
  const run = readJson(pagesProvisionRunFile);
  const journalFile = path.join(artifactRoot, "provisioning/pages/pages-release-probe-evidence.json");
  const runValid = isExactImmutableChildRun(run, "cloudflare-pages-sync-ponto.yml");
  if (!runValid) {
    unresolved.push({ surface: "pagesEnvironmentSecrets", reason: "child-run-provenance-invalid" });
  } else if (!fs.existsSync(journalFile)) {
    unresolved.push({
      surface: "pagesEnvironmentSecrets",
      childRunId: String(run.runId || ""),
      reason: "mutation-journal-missing",
    });
  } else {
    const journal = readJson(journalFile);
    const journalValid = journal.schemaVersion === 1
      && journal.surface === "pagesEnvironmentSecrets"
      && journal.target === (staging ? "staging" : "production")
      && journal.project === expectedPagesProject
      && String(journal.releaseSha || "").toLowerCase() === releaseSha
      && String(journal.orchestratorRunId || "") === orchestratorRunId
      && journal.retentionPolicy === "environment-scoped-deterministic-prerequisite"
      && journal.valuesIncluded === false
      && journal.credentialsIncluded === false
      && journal.piiIncluded === false;
    if (!journalValid) {
      unresolved.push({
        surface: "pagesEnvironmentSecrets",
        childRunId: String(run.runId || ""),
        reason: "mutation-journal-invalid",
      });
    } else if (journal.mutationStarted !== true) {
      environmentPrerequisites.pagesEnvironmentSecrets = {
        passed: true,
        childRunId: String(run.runId || ""),
        mutationStarted: false,
        disposition: "no-remote-mutation",
      };
    } else {
      const retainedSafely = run.conclusion === "success"
        && journal.mutationCompleted === true
        && journal.remoteAttestationCompleted === true
        && journal.mutationSafety?.maintenanceRequired === true
        && journal.mutationSafety?.deterministicRerun === true
        && journal.mutationSafety?.retainedOnCodeRollback === true;
      environmentPrerequisites.pagesEnvironmentSecrets = {
        passed: retainedSafely,
        childRunId: String(run.runId || ""),
        mutationStarted: true,
        mutationCompleted: journal.mutationCompleted === true,
        remoteAttestationCompleted: journal.remoteAttestationCompleted === true,
        disposition: retainedSafely
          ? "retained-environment-prerequisite-under-maintenance"
          : "unresolved-secret-configuration-mutation",
      };
      if (!retainedSafely) {
        unresolved.push({
          surface: "pagesEnvironmentSecrets",
          childRunId: String(run.runId || ""),
          reason: "secret-configuration-mutation-not-fully-attested",
        });
      }
    }
  }
}

const childReconciliationFile = path.join(artifactRoot, "automatic-rollback/ponto-child-reconciliation.json");
const childReconciliation = fs.existsSync(childReconciliationFile)
  ? readJson(childReconciliationFile)
  : null;
const childReconciliationPassed = childReconciliation?.schemaVersion === 1
  && String(childReconciliation?.orchestratorRunId || "") === orchestratorRunId
  && String(childReconciliation?.orchestratorHeadSha || "").toLowerCase() === releaseSha
  && childReconciliation?.passed === true
  && Array.isArray(childReconciliation?.unresolved)
  && childReconciliation.unresolved.length === 0
  && childReconciliation?.credentialsIncluded === false
  && childReconciliation?.piiIncluded === false;
if (!childReconciliationPassed) {
  unresolved.push({ surface: "governedChildren", reason: "child-cancellation-reconciliation-unresolved" });
}
let drillOwnershipResolved = true;
const drillRunFile = path.join(artifactRoot, "runs/staging-rollback-drill.json");
if (staging && fs.existsSync(drillRunFile)) {
  const run = readJson(drillRunFile);
  const drillFile = path.join(artifactRoot, "staging-rollback-drill/ponto-staging-rollback-drill.json");
  const runValid = isExactImmutableChildRun(run, "ponto-staging-rollback-drill.yml");
  if (!runValid || !fs.existsSync(drillFile)) {
    drillOwnershipResolved = false;
    unresolved.push({ surface: "stagingRollbackDrill", reason: "drill-run-or-evidence-provenance-invalid" });
  } else {
    const drill = readJson(drillFile);
    const drillValid = drill.schemaVersion === 2
      && String(drill.releaseSha || "").toLowerCase() === releaseSha
      && String(drill.runId || "") === String(run.runId)
      && String(drill.orchestratorRunId || "") === orchestratorRunId
      && drill.credentialsIncluded === false
      && drill.piiIncluded === false;
    if (!drillValid) {
      drillOwnershipResolved = false;
      unresolved.push({ surface: "stagingRollbackDrill", reason: "drill-evidence-provenance-invalid" });
    } else {
      const phases = [
        ["rollback", "incumbent"],
        ["restoration", "candidate"],
        ["failureCompensation", "incumbent"],
      ];
      for (const name of Object.keys(surfaceSpecs)) {
        const attempted = phases.filter(([phase]) => drill[phase]?.attempted === true);
        if (!attempted.length) continue;
        const [phase, side] = attempted.at(-1);
        const proof = drill[phase]?.surfaces?.[name];
        const item = plan[name];
        if (!item || proof?.passed !== true) {
          drillOwnershipResolved = false;
          unresolved.push({ surface: name, childRunId: String(run.runId), reason: "drill-latest-surface-state-unresolved" });
          continue;
        }
        if (name === "crmPages") {
          const activeDeploymentId = String(proof.activeDeploymentId || "");
          const expectedSource = side === "candidate"
            ? item.candidateDeploymentId
            : item.incumbentDeploymentId;
          if (
            !UUID.test(activeDeploymentId)
            || String(proof.sourceDeploymentId || "").toLowerCase() !== String(expectedSource || "").toLowerCase()
          ) {
            drillOwnershipResolved = false;
            unresolved.push({ surface: name, childRunId: String(run.runId), reason: "drill-pages-ownership-invalid" });
          } else if (side === "candidate") {
            item.candidateDeploymentId = activeDeploymentId;
          } else {
            item.restoredDeploymentId = activeDeploymentId;
          }
        } else {
          const expectedVersionId = side === "candidate"
            ? item.candidateVersionId
            : item.incumbentVersionId;
          if (
            !UUID.test(proof.deploymentId || "")
            || String(proof.versionId || "").toLowerCase() !== expectedVersionId.toLowerCase()
            || proof.worker !== item.workerName
          ) {
            drillOwnershipResolved = false;
            unresolved.push({ surface: name, childRunId: String(run.runId), reason: "drill-worker-ownership-invalid" });
          } else if (side === "candidate") {
            item.deploymentId = String(proof.deploymentId);
          }
        }
      }
    }
  }
}
// A durable broker artifact alone is not authority to mutate. Read both live
// KV records and bind the regular control to the exact still-true emergency
// latch before any Worker or Pages rollback. The workflow-level surface mutex
// excludes the protected latch reset until the final readback below.
const preMutationFailClose = await readAndAttestBrokerFailClose();
if (!preMutationFailClose.attestation.passed) {
  unresolved.push({
    surface: "moduleControl",
    reason: "broker-fail-close-precondition-unresolved",
  });
}
const rollbackPermitted = childReconciliationPassed
  && drillOwnershipResolved
  && preMutationFailClose.attestation.passed;

const proofs = {};
const workerStatus = (workerName) => spawnSync("npx", [
  "--yes",
  "wrangler@4.112.0",
  "deployments",
  "status",
  "--name",
  workerName,
  "--json",
], { encoding: "utf8", env: process.env, maxBuffer: 10 * 1024 * 1024 });

const rollbackWorker = (name, item) => {
  if (!rollbackPermitted) {
    proofs[name] = {
      passed: false,
      mutationPerformed: false,
      targetVersionId: item.incumbentVersionId,
      reason: "rollback-blocked-by-custody-reconciliation",
    };
    return;
  }
  const before = workerStatus(item.workerName);
  let ownership;
  try {
    if (before.status !== 0) throw new Error("status command failed");
    ownership = classifyWorkerRollbackOwnership(JSON.parse(before.stdout), item, stage);
  } catch {
    ownership = "ownership-conflict";
  }
  if (ownership === "ownership-conflict") {
    proofs[name] = {
      passed: false,
      mutationPerformed: false,
      targetVersionId: item.incumbentVersionId,
      reason: "current-worker-ownership-conflict",
    };
    unresolved.push({ surface: name, childRunId: item.childRunId, reason: "current-worker-ownership-conflict" });
    return;
  }
  if (ownership === "already-incumbent") {
    proofs[name] = {
      passed: true,
      mutationPerformed: false,
      workerName: item.workerName,
      targetVersionId: item.incumbentVersionId,
      candidatePercent: 0,
      incumbentPercent: 100,
      disposition: "already-incumbent",
    };
    return;
  }
  const rollback = spawnSync("npx", buildWorkerRollbackArgs({
    incumbentVersionId: item.incumbentVersionId,
    workerName: item.workerName,
    releaseSha,
    orchestratorRunId,
  }), { encoding: "utf8", env: process.env, maxBuffer: 10 * 1024 * 1024 });
  if (rollback.status !== 0) {
    proofs[name] = {
      passed: false,
      mutationPerformed: true,
      targetVersionId: item.incumbentVersionId,
      reason: "rollback-command-failed",
    };
    return;
  }
  const status = workerStatus(item.workerName);
  try {
    if (status.status !== 0) throw new Error("status command failed");
    const payload = JSON.parse(status.stdout);
    const versions = payload.versions || payload.latest?.versions || [];
    const exact = versions.length === 1
      && String(versions[0]?.version_id || versions[0]?.id || "").toLowerCase() === item.incumbentVersionId.toLowerCase()
      && Number(versions[0]?.percentage) === 100;
    if (!exact) throw new Error("active weight differs");
    proofs[name] = {
      passed: true,
      mutationPerformed: true,
      workerName: item.workerName,
      targetVersionId: item.incumbentVersionId,
      candidatePercent: 0,
      incumbentPercent: 100,
      disposition: ownership === "candidate-owned-reconciled"
        ? "candidate-owned-reconciled"
        : "candidate-owned",
    };
  } catch {
    proofs[name] = {
      passed: false,
      mutationPerformed: true,
      targetVersionId: item.incumbentVersionId,
      reason: "post-rollback-weight-attestation-failed",
    };
  }
};

const cloudflare = async (pathname, init = {}) => {
  const response = await fetch(`https://api.cloudflare.com/client/v4${pathname}`, {
    ...init,
    signal: AbortSignal.timeout(30_000),
    headers: {
      authorization: `Bearer ${apiToken}`,
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) throw new Error(`Cloudflare API returned ${response.status}`);
  return payload;
};

const github = async (pathname, init = {}) => {
  const requestToken = pathname.includes("/check-runs") ? rollbackCheckToken : ghToken;
  const response = await fetch(`${githubApiBase}${pathname}`, {
    ...init,
    signal: AbortSignal.timeout(30_000),
    headers: {
      authorization: `Bearer ${requestToken}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`GitHub rollback-intent API returned ${response.status}`);
  return payload;
};

let pagesCreatedDeploymentId = "";
let pagesMutationAttempted = false;
let pagesMutationObserved = false;
let pagesIntent = null;
const pagesIntentInput = plan.crmPages && UUID.test(plan.crmPages.candidateDeploymentId || "") ? {
  request: github,
  secret: pagesRollbackIntentHmacKey,
  repositoryId,
  repository,
  coordinatorRunId: orchestratorRunId,
  sourceSha: releaseSha,
  stage,
  project: expectedPagesProject,
  branch: expectedPagesBranch,
  alias: expectedPagesAlias,
  candidateDeploymentId: plan.crmPages.candidateDeploymentId,
  incumbentDeploymentId: plan.crmPages.incumbentDeploymentId,
} : null;
if (pagesIntentInput) {
  pagesIntent = await readPagesRollbackIntent(pagesIntentInput);
  pagesMutationAttempted = Boolean(pagesIntent);
  if (["created", "restored"].includes(pagesIntent?.claims?.state)) {
    plan.crmPages.restoredDeploymentId = pagesIntent.claims.restoredDeploymentId;
    pagesCreatedDeploymentId = pagesIntent.claims.restoredDeploymentId;
    pagesMutationObserved = true;
  }
}
const persistPagesAttempt = async () => {
  pagesIntent = await createPagesRollbackIntent({
    ...pagesIntentInput,
    recoveryRunId,
  });
  if (pagesIntent.created !== true) {
    throw new Error("durable Pages rollback intent already exists; a second POST is forbidden");
  }
  pagesMutationAttempted = true;
  const attemptFile = path.join(
    artifactRoot,
    "automatic-rollback/ponto-pages-rollback-attempt.json",
  );
  fs.mkdirSync(path.dirname(attemptFile), { recursive: true });
  fs.writeFileSync(attemptFile, `${JSON.stringify({
    schemaVersion: 1,
    sourceSha: releaseSha,
    failedStage: stage,
    orchestratorRunId,
    candidateDeploymentId: plan.crmPages.candidateDeploymentId,
    incumbentDeploymentId: plan.crmPages.incumbentDeploymentId,
    mutationAttempted: true,
    mutationOutcome: "indeterminate-until-reconciled",
    attemptedAt: new Date().toISOString(),
    credentialsIncluded: false,
    piiIncluded: false,
  }, null, 2)}\n`, { mode: 0o600 });
};
const persistPagesCreatedId = async (deploymentId, source) => {
  if (!pagesIntent) throw new Error("Pages rollback created ID has no durable one-shot intent");
  pagesIntent = await recordCreatedPagesRollbackIntent({
    request: github,
    secret: pagesRollbackIntentHmacKey,
    intent: pagesIntent,
    restoredDeploymentId: deploymentId,
  });
  pagesCreatedDeploymentId = deploymentId;
  pagesMutationObserved = true;
  plan.crmPages.restoredDeploymentId = deploymentId;
  const journalFile = path.join(
    artifactRoot,
    "automatic-rollback/ponto-pages-rollback-created.json",
  );
  fs.mkdirSync(path.dirname(journalFile), { recursive: true });
  fs.writeFileSync(journalFile, `${JSON.stringify({
    schemaVersion: 1,
    sourceSha: releaseSha,
    failedStage: stage,
    orchestratorRunId,
    candidateDeploymentId: plan.crmPages.candidateDeploymentId,
    incumbentDeploymentId: plan.crmPages.incumbentDeploymentId,
    restoredDeploymentId: deploymentId,
    source,
    mutationAttempted: true,
    mutationOutcome: "created-id-observed",
    recordedAt: new Date().toISOString(),
    credentialsIncluded: false,
    piiIncluded: false,
  }, null, 2)}\n`, { mode: 0o600 });
};
const persistPagesExistingIncumbentId = async (deploymentId, source) => {
  if (!pagesIntent) throw new Error("Pages rollback existing incumbent has no durable one-shot intent");
  if (String(deploymentId || "").toLowerCase() !== String(plan.crmPages.incumbentDeploymentId || "").toLowerCase()) {
    throw new Error("Pages rollback existing incumbent identity differs from the attested incumbent");
  }
  pagesIntent = await completePagesRollbackIntent({
    request: github,
    secret: pagesRollbackIntentHmacKey,
    intent: pagesIntent,
    restoredDeploymentId: deploymentId,
    allowExistingIncumbent: true,
  });
  pagesCreatedDeploymentId = deploymentId;
  pagesMutationObserved = true;
  plan.crmPages.restoredDeploymentId = deploymentId;
  const journalFile = path.join(
    artifactRoot,
    "automatic-rollback/ponto-pages-rollback-restored.json",
  );
  fs.mkdirSync(path.dirname(journalFile), { recursive: true });
  fs.writeFileSync(journalFile, `${JSON.stringify({
    schemaVersion: 1,
    sourceSha: releaseSha,
    failedStage: stage,
    orchestratorRunId,
    candidateDeploymentId: plan.crmPages.candidateDeploymentId,
    incumbentDeploymentId: plan.crmPages.incumbentDeploymentId,
    restoredDeploymentId: deploymentId,
    restoredExistingIncumbent: true,
    source,
    mutationAttempted: true,
    mutationOutcome: "existing-incumbent-reconciled",
    recordedAt: new Date().toISOString(),
    credentialsIncluded: false,
    piiIncluded: false,
  }, null, 2)}\n`, { mode: 0o600 });
};

if (plan.crmPages) {
  if (!rollbackPermitted) {
    proofs.crmPages = {
      passed: false,
      mutationPerformed: false,
      requestedDeploymentId: plan.crmPages.incumbentDeploymentId,
      reason: "rollback-blocked-by-custody-reconciliation",
    };
  } else try {
    const requested = plan.crmPages.incumbentDeploymentId;
    const before = await cloudflare(
      `/accounts/${accountId}/pages/projects/${encodeURIComponent(pagesProject)}/deployments?env=production&per_page=25`,
    );
    let ownership = classifyPagesRollbackOwnership(before, plan.crmPages);
    if (
      ownership === "ownership-conflict"
      && ["attempted", "created"].includes(pagesIntent?.claims?.state)
    ) ownership = "durable-intent-reconcile";
    if (ownership === "ownership-conflict") {
      unresolved.push({
        surface: "crmPages",
        childRunId: plan.crmPages.childRunId,
        reason: "current-pages-ownership-conflict",
      });
      proofs.crmPages = {
        passed: false,
        mutationPerformed: false,
        requestedDeploymentId: requested,
        reason: "current-pages-ownership-conflict",
      };
    } else if (["already-incumbent", "already-restored"].includes(ownership)) {
      const existingIncumbentReconciled = ownership === "already-incumbent"
        && pagesIntent
        && pagesIntent.claims.state !== "restored";
      const activeId = ownership === "already-restored"
        ? plan.crmPages.restoredDeploymentId
        : requested;
      const [incumbentPayload, activePayload] = await Promise.all([
        cloudflare(`/accounts/${accountId}/pages/projects/${encodeURIComponent(pagesProject)}/deployments/${requested}`),
        cloudflare(`/accounts/${accountId}/pages/projects/${encodeURIComponent(pagesProject)}/deployments/${activeId}`),
      ]);
      const incumbent = incumbentPayload.result;
      const active = activePayload.result;
      const attestation = attestPagesIncumbentState(incumbent, active, {
        incumbentDeploymentId: requested,
        activeDeploymentId: activeId,
        project: expectedPagesProject,
        branch: expectedPagesBranch,
        alias: expectedPagesAlias,
      });
      if (!attestation.passed) throw new Error("existing Pages rollback deployment does not attest the incumbent");
      if (pagesIntent && pagesIntent.claims.state !== "restored") {
        pagesIntent = await completePagesRollbackIntent({
          request: github,
          secret: pagesRollbackIntentHmacKey,
          intent: pagesIntent,
          restoredDeploymentId: activeId,
          allowExistingIncumbent: ownership === "already-incumbent",
        });
      }
      proofs.crmPages = {
        passed: true,
        mutationPerformed: Boolean(existingIncumbentReconciled),
        requestedDeploymentId: requested,
        activeDeploymentId: activeId,
        project: pagesProject,
        sourceCommitSha: attestation.sourceCommitSha,
        disposition: existingIncumbentReconciled
          ? "already-incumbent-after-intent"
          : ownership,
        publicAliasesAttested: true,
      };
    } else {
      const rolledBack = await rollbackPagesWithReconciliation({
        request: cloudflare,
        accountId,
        project: expectedPagesProject,
        branch: expectedPagesBranch,
        alias: expectedPagesAlias,
        candidateDeploymentId: plan.crmPages.candidateDeploymentId,
        candidateCommitSha: releaseSha,
        incumbentDeploymentId: requested,
        mutationAllowed: !pagesIntent,
        knownRestoredDeploymentId: ["created", "restored"].includes(
          pagesIntent?.claims?.state,
        )
          ? pagesIntent.claims.restoredDeploymentId
          : "",
        persistAttempt: persistPagesAttempt,
        persistCreatedId: persistPagesCreatedId,
        persistExistingIncumbentId: persistPagesExistingIncumbentId,
      });
      if (!pagesIntent) throw new Error("Pages rollback completed without durable intent");
      pagesIntent = await completePagesRollbackIntent({
        request: github,
        secret: pagesRollbackIntentHmacKey,
        intent: pagesIntent,
        restoredDeploymentId: rolledBack.activeDeploymentId,
        allowExistingIncumbent: rolledBack.restoredExistingIncumbent === true,
      });
      proofs.crmPages = {
        passed: true,
        mutationPerformed: rolledBack.mutationPerformed,
        mutationAttempted: true,
        mutationOutcome: "attested-incumbent",
        requestedDeploymentId: requested,
        activeDeploymentId: rolledBack.activeDeploymentId,
        activeDeploymentUrl: String(rolledBack.active?.url || ""),
        project: pagesProject,
        sourceCommitSha: rolledBack.incumbentCommitSha,
        disposition: rolledBack.disposition,
        rollbackAttempts: rolledBack.attempts,
        publicAliasesAttested: true,
      };
    }
  } catch {
    unresolved.push({
      surface: "crmPages",
      childRunId: plan.crmPages.childRunId,
      reason: "pages-rollback-or-attestation-failed",
    });
    proofs.crmPages = {
      passed: false,
      ...(pagesMutationObserved ? { mutationPerformed: true } : {}),
      mutationAttempted: pagesMutationAttempted,
      mutationOutcome: pagesMutationObserved
        ? "created-id-observed-but-unresolved"
        : pagesMutationAttempted
          ? "indeterminate"
          : "not-attempted",
      requestedDeploymentId: plan.crmPages.incumbentDeploymentId,
      ...(pagesCreatedDeploymentId
        ? { activeDeploymentId: pagesCreatedDeploymentId }
        : {}),
      reason: "pages-rollback-or-attestation-failed",
    };
  }
}

for (const name of ["coreApi", "identityWorkforce", "timekeeping"]) {
  if (plan[name]) rollbackWorker(name, plan[name]);
}

const external = {};
if (plan.identityWorkforce && proofs.identityWorkforce?.passed) {
  try {
    const response = await fetch(staging
      ? "https://api-staging.skincos.com.br/insumos/health"
      : "https://api.skincos.com.br/insumos/health", {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: { accept: "application/json", ...accessHeaders },
    });
    const json = await response.json().catch(() => null);
    external.identity = {
      passed: response.status === 200
        && json?.environment === (staging ? "staging" : "production")
        && String(json?.workerVersion?.id || json?.worker_version?.id || "").toLowerCase() === plan.identityWorkforce.incumbentVersionId.toLowerCase(),
      status: response.status,
      versionId: String(json?.workerVersion?.id || json?.worker_version?.id || ""),
    };
  } catch {
    external.identity = { passed: false, status: 0 };
  }
}
if (plan.coreApi && plan.timekeeping && proofs.coreApi?.passed && proofs.timekeeping?.passed) {
  try {
    const response = await fetch(staging
      ? "https://crm-staging.skincos.com.br/api/ponto/health"
      : "https://crm.skincos.com.br/api/ponto/health", {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: { accept: "application/json", ...accessHeaders },
    });
    const json = await response.json().catch(() => null);
    const dependencies = json?.dependencies && typeof json.dependencies === "object" ? Object.entries(json.dependencies) : [];
    const maintenanceOnly = json?.ok === false
      && json?.ready === false
      && json?.availability?.state === "maintenance"
      && json?.dependencies?.module_control?.state === "unavailable"
      && json?.dependencies?.module_control?.reason === "MODULE_MAINTENANCE"
      && dependencies.every(([name, dependency]) => name === "module_control" || dependency?.required !== true || dependency?.state === "healthy");
    external.composite = {
      passed: response.status === 200
        && maintenanceOnly
        && String(response.headers.get("x-skincos-gateway-version-id") || "").toLowerCase() === plan.coreApi.incumbentVersionId.toLowerCase()
        && String(response.headers.get("x-skincos-timekeeping-version-id") || "").toLowerCase() === plan.timekeeping.incumbentVersionId.toLowerCase(),
      status: response.status,
      coreVersionId: String(response.headers.get("x-skincos-gateway-version-id") || ""),
      timekeepingVersionId: String(response.headers.get("x-skincos-timekeeping-version-id") || ""),
    };
  } catch {
    external.composite = { passed: false, status: 0 };
  }
}

// Re-read after every mutation while still holding the surface mutex. A reset,
// drift, or broker/control mismatch makes the recovery unresolved even when all
// deployment commands themselves succeeded.
const postMutationFailClose = await readAndAttestBrokerFailClose();
if (!postMutationFailClose.attestation.passed) {
  unresolved.push({
    surface: "moduleControl",
    reason: "broker-fail-close-postcondition-unresolved",
  });
}
const moduleFailCloseAttestation = postMutationFailClose.attestation;
const moduleFailClosed = preMutationFailClose.attestation.passed
  && postMutationFailClose.attestation.passed;
const plannedNames = Object.keys(plan);
const allRollbacksPassed = plannedNames.every((name) => proofs[name]?.passed === true);
const allExternalPassed = Object.values(external).every((proof) => proof.passed === true);
const allEnvironmentPrerequisitesPassed = Object.values(environmentPrerequisites).every((proof) => proof.passed === true);
const allRetainedDataChangesPassed = Object.values(retainedDataChanges).every((proof) => proof.passed === true);
const allMutationStateResolved = unresolved.length === 0;
const report = {
  schemaVersion: 1,
  automaticInterruption: true,
  sourceSha: releaseSha,
  failedStage: stage,
  orchestratorRunId,
  moduleMaintenanceRunId: moduleFailCloseAttestation.emergencyRunId,
  moduleFailClosed,
  moduleTransition: moduleFailClosed ? {
    state: "maintenance",
    changedAt: moduleFailCloseAttestation.controlChangedAt,
    emergencyLatchChangedAt: moduleFailCloseAttestation.latchChangedAt,
    preMutationReadbackMatched: true,
    remoteKvReadbackMatched: preMutationFailClose.attestation.readbackMode === "direct-kv"
      && postMutationFailClose.attestation.readbackMode === "direct-kv",
    emergencyLatchReadbackMatched: preMutationFailClose.attestation.readbackMode === "direct-kv"
      && postMutationFailClose.attestation.readbackMode === "direct-kv",
    externalHealthReadbackMatched: preMutationFailClose.attestation.readbackMode === "external-health-noop"
      && postMutationFailClose.attestation.readbackMode === "external-health-noop",
    rollbackDisposition: plannedNames.length === 0
      ? "no-dispatched-surface-noop"
      : "restored-dispatched-surfaces",
  } : {
    state: "unresolved",
    remoteKvReadbackMatched: false,
    emergencyLatchReadbackMatched: false,
    readbackFailure: [
      preMutationFailClose.attestation.readbackFailure,
      postMutationFailClose.attestation.readbackFailure,
    ].filter(Boolean),
  },
  childReconciliation: childReconciliationPassed ? {
    passed: true,
    discoveredChildren: Number(childReconciliation.discoveredChildren || 0),
  } : {
    passed: false,
  },
  childRunIds: Object.fromEntries(Object.entries(plan).map(([name, item]) => [name, item.childRunId])),
  plannedSurfaces: plannedNames,
  planSource: Object.fromEntries(Object.entries(plan).map(([name, item]) => [name, item.source])),
  untouchedSurfaces: untouched,
  unresolved,
  proofs,
  environmentPrerequisites,
  retainedDataChanges,
  external,
  passed: moduleFailClosed
    && allMutationStateResolved
    && allRollbacksPassed
    && allEnvironmentPrerequisitesPassed
    && allRetainedDataChangesPassed
    && allExternalPassed,
  credentialsIncluded: false,
  piiIncluded: false,
};
fs.mkdirSync(path.dirname(reportFile), { recursive: true });
fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
if (!report.passed) throw new Error("automatic rollback did not resolve, restore, and attest every dispatched surface");
process.stdout.write(`Automatic rollback restored ${plannedNames.length} successfully mutated surface(s).\n`);
