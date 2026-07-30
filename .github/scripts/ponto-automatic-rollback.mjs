import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildWorkerRollbackArgs } from "./ponto-automatic-rollback-command.mjs";
import {
  attestPagesIncumbentState,
  classifyPagesRollbackOwnership,
  classifyWorkerRollbackOwnership,
} from "./ponto-rollback-ownership.mjs";

const [artifactRoot, reportFile] = process.argv.slice(2);
const releaseSha = String(process.env.RELEASE_SHA || "").trim().toLowerCase();
const stage = String(process.env.STAGE || "").trim().toLowerCase();
const orchestratorRunId = String(process.env.GITHUB_RUN_ID || "");
const repository = String(process.env.GITHUB_REPOSITORY || "");
const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "");
const apiToken = String(process.env.CLOUDFLARE_API_TOKEN || "");
const pagesProject = String(process.env.CLOUDFLARE_PAGES_PROJECT || "skincos");
const moduleControlNamespaceId = String(
  process.env.MODULE_CONTROL_KV_ID
  || process.env.MODULE_CONTROL_PRODUCTION_KV_ID
  || "",
);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const staging = stage === "staging";
const expectedPagesProject = staging ? "skincos-staging" : "skincos";
const expectedPagesBranch = staging ? "staging" : "main";
const expectedPagesAlias = staging ? "crm-staging.skincos.com.br" : "crm.skincos.com.br";

if (!artifactRoot || !reportFile) throw new Error("automatic rollback artifact root and report path are required");
if (!/^[0-9a-f]{40}$/.test(releaseSha) || !["staging", "pilot", "canary", "production"].includes(stage)) throw new Error("invalid automatic rollback identity");
if (!/^[0-9]+$/.test(orchestratorRunId) || !repository.includes("/")) throw new Error("invalid orchestrator provenance");
if (
  !/^[0-9a-f]{32}$/.test(accountId)
  || !apiToken
  || pagesProject !== expectedPagesProject
  || !/^[0-9a-f]{32}$/i.test(moduleControlNamespaceId)
) throw new Error(`${stage} Cloudflare custody is unavailable`);

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
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
  if (
    run.workflow !== spec.workflow
    || run.status !== "completed"
    || !["success", "failure", "cancelled", "timed_out", "action_required", "startup_failure"].includes(String(run.conclusion || ""))
    || run.event !== "workflow_dispatch"
    || run.headBranch !== "main"
    || run.repository !== repository
  ) {
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
    };
  }
}

const environmentPrerequisites = {};
const pagesProvisionRunFile = path.join(artifactRoot, "runs/provision-pages.json");
if (fs.existsSync(pagesProvisionRunFile)) {
  const run = readJson(pagesProvisionRunFile);
  const journalFile = path.join(artifactRoot, "provisioning/pages/pages-release-probe-evidence.json");
  const runValid = run.workflow === "cloudflare-pages-sync-ponto.yml"
    && run.status === "completed"
    && ["success", "failure", "cancelled", "timed_out", "action_required", "startup_failure"].includes(String(run.conclusion || ""))
    && run.event === "workflow_dispatch"
    && run.headBranch === "main"
    && run.repository === repository;
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
  const runValid = run.workflow === "ponto-staging-rollback-drill.yml"
    && run.status === "completed"
    && ["success", "failure", "cancelled", "timed_out", "action_required", "startup_failure"].includes(String(run.conclusion || ""))
    && run.event === "workflow_dispatch"
    && run.headBranch === "main"
    && run.repository === repository;
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
const rollbackPermitted = childReconciliationPassed && drillOwnershipResolved;

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

const waitForPagesDeployment = async (deploymentId, expectedCommitSha) => {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const payload = await cloudflare(
      `/accounts/${accountId}/pages/projects/${encodeURIComponent(pagesProject)}/deployments/${deploymentId}`,
    );
    const deployment = payload.result;
    const status = String(deployment?.latest_stage?.status || deployment?.stage?.status || "").toLowerCase();
    const aliasHosts = new Set((deployment?.aliases || []).map((alias) => {
      try { return new URL(alias).hostname; } catch { return String(alias).replace(/^https?:\/\//, "").replace(/\/.*$/, ""); }
    }));
    if (
      deployment?.id === deploymentId
      && deployment?.project_name === expectedPagesProject
      && deployment?.environment === "production"
      && deployment?.deployment_trigger?.metadata?.branch === expectedPagesBranch
      && String(deployment?.deployment_trigger?.metadata?.commit_hash || "").toLowerCase() === expectedCommitSha
      && ["success", "idle"].includes(status)
      && aliasHosts.has(expectedPagesAlias)
    ) return deployment;
    if (!["active", "queued", "waiting", "pending", "building", "initializing"].includes(status)) {
      throw new Error("Pages rollback entered a failed or invalid state");
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error("Pages rollback did not reach terminal success before timeout");
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
    const ownership = classifyPagesRollbackOwnership(before, plan.crmPages);
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
      proofs.crmPages = {
        passed: true,
        mutationPerformed: false,
        requestedDeploymentId: requested,
        activeDeploymentId: activeId,
        project: pagesProject,
        sourceCommitSha: attestation.sourceCommitSha,
        disposition: ownership,
        publicAliasesAttested: true,
      };
    } else {
      const requestedDeployment = await cloudflare(`/accounts/${accountId}/pages/projects/${encodeURIComponent(pagesProject)}/deployments/${requested}`);
      const requestedResult = requestedDeployment.result;
      const requestedCommitSha = String(requestedResult?.deployment_trigger?.metadata?.commit_hash || "").toLowerCase();
      if (
        requestedResult?.id !== requested
        || requestedResult?.project_name !== expectedPagesProject
        || requestedResult?.environment !== "production"
        || requestedResult?.deployment_trigger?.metadata?.branch !== expectedPagesBranch
        || !/^[0-9a-f]{40}$/.test(requestedCommitSha)
      ) throw new Error("requested Pages incumbent metadata is invalid");
      const rollback = await cloudflare(`/accounts/${accountId}/pages/projects/${encodeURIComponent(pagesProject)}/deployments/${requested}/rollback`, {
        method: "POST",
        body: "{}",
      });
      const createdId = String(rollback.result?.id || "");
      if (!UUID.test(createdId)) throw new Error("Pages rollback response omitted deployment id");
      const active = await waitForPagesDeployment(createdId, requestedCommitSha);
      const listing = await cloudflare(`/accounts/${accountId}/pages/projects/${encodeURIComponent(pagesProject)}/deployments?env=production&per_page=25`);
      const production = (listing.result || [])
        .filter((item) => item.environment === "production")
        .sort((a, b) => String(b.created_on).localeCompare(String(a.created_on)));
      const latest = production[0];
      if (
        latest?.id !== createdId
      ) throw new Error("Pages rollback is not the exact aliased incumbent production deployment");
      proofs.crmPages = {
        passed: true,
        mutationPerformed: true,
        requestedDeploymentId: requested,
        activeDeploymentId: createdId,
        activeDeploymentUrl: String(active?.url || ""),
        project: pagesProject,
        sourceCommitSha: requestedCommitSha,
        publicAliasesAttested: true,
      };
    }
  } catch {
    proofs.crmPages = {
      passed: false,
      mutationPerformed: false,
      requestedDeploymentId: plan.crmPages.incumbentDeploymentId,
      reason: "pages-rollback-or-attestation-failed",
    };
  }
}

for (const name of ["coreApi", "identityWorkforce", "timekeeping"]) {
  if (plan[name]) rollbackWorker(name, plan[name]);
}

const accessHeaders = {};
if (process.env.CF_ACCESS_CLIENT_ID || process.env.CF_ACCESS_CLIENT_SECRET) {
  if (!process.env.CF_ACCESS_CLIENT_ID || !process.env.CF_ACCESS_CLIENT_SECRET) throw new Error("partial Cloudflare Access credential");
  accessHeaders["CF-Access-Client-Id"] = process.env.CF_ACCESS_CLIENT_ID;
  accessHeaders["CF-Access-Client-Secret"] = process.env.CF_ACCESS_CLIENT_SECRET;
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

const moduleAbortFile = path.join(artifactRoot, "runs/module-abort.json");
const moduleAbort = fs.existsSync(moduleAbortFile) ? readJson(moduleAbortFile) : null;
const transitionFile = path.join(artifactRoot, "module-transitions/automatic-abort/module-transition.json");
const moduleTransition = fs.existsSync(transitionFile) ? readJson(transitionFile) : null;
let moduleReadback = null;
const readbackResult = spawnSync("npx", [
  "--yes",
  "wrangler@4.112.0",
  "kv",
  "key",
  "get",
  "module-control:timekeeping",
  "--namespace-id",
  moduleControlNamespaceId,
  "--remote",
], { encoding: "utf8", env: process.env, maxBuffer: 2 * 1024 * 1024 });
try {
  if (readbackResult.status !== 0) throw new Error("KV readback failed");
  moduleReadback = JSON.parse(readbackResult.stdout);
} catch {
  moduleReadback = null;
}
const moduleFailClosed = moduleAbort?.workflow === "module-availability.yml"
  && moduleAbort?.status === "completed"
  && moduleAbort?.conclusion === "success"
  && moduleAbort?.event === "workflow_dispatch"
  && moduleAbort?.headBranch === "main"
  && moduleAbort?.repository === repository
  && moduleTransition?.schemaVersion === 1
  && moduleTransition?.module === "timekeeping"
  && moduleTransition?.environment === (staging ? "staging" : "production")
  && moduleTransition?.state === "maintenance"
  && moduleTransition?.passed === true
  && Number.isFinite(Date.parse(String(moduleTransition?.changedAt || "")))
  && moduleTransition?.credentialsIncluded === false
  && moduleTransition?.piiIncluded === false
  && moduleReadback?.state === "maintenance"
  && moduleReadback?.changedAt === moduleTransition?.changedAt;
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
  moduleMaintenanceRunId: moduleAbort ? String(moduleAbort.runId) : "",
  moduleFailClosed,
  moduleTransition: moduleFailClosed ? {
    state: "maintenance",
    changedAt: moduleTransition.changedAt,
    remoteKvReadbackMatched: true,
  } : {
    state: "unresolved",
    remoteKvReadbackMatched: false,
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
