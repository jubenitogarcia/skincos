import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  isCorrelatedChild,
  isJournalAuthorizedRun,
} from "./ponto-reconcile-children.mjs";
import {
  capabilityExternalId,
  resolveCapabilityVerifier,
  verifyCapabilityDocument,
} from "./ponto-orchestrator-lease.mjs";

const DISPATCH_NONCE = /^[0-9a-f]{32}$/;
const hasExactNonceTitle = (title, expectedPrefix) => {
  if (!expectedPrefix) return false;
  const marker = `${expectedPrefix} nonce=`;
  const actual = String(title || "");
  return actual.startsWith(marker)
    && DISPATCH_NONCE.test(actual.slice(marker.length));
};

const SURFACES = Object.freeze({
  timekeeping: {
    workflowPath: ".github/workflows/deploy-timekeeping.yml",
    titlePrefix: (stage, sha, runId) =>
      `Timekeeping ${stage} ${sha} orchestrator=${runId}`,
    runFile: "runs/timekeeping.json",
    artifacts: (stage, sha) => [
      [`ponto-surface-timekeeping-${stage}-${sha}`, "surfaces/timekeeping"],
      [`ponto-mutation-timekeeping-${stage}-${sha}`, "mutations/timekeeping"],
    ],
  },
  identityWorkforce: {
    workflowPath: ".github/workflows/deploy-core-workers.yml",
    titlePrefix: (stage, sha, runId) =>
      `Core inventory ${stage} ${sha} orchestrator=${runId}`,
    runFile: "runs/identity.json",
    artifacts: (stage, sha) => [
      [`ponto-surface-identity-workforce-${stage}-${sha}`, "surfaces/identity"],
      [`ponto-mutation-identity-workforce-${stage}-${sha}`, "mutations/identity"],
    ],
  },
  coreApi: {
    workflowPath: ".github/workflows/deploy-core-workers.yml",
    titlePrefix: (stage, sha, runId) =>
      `Core api ${stage} ${sha} orchestrator=${runId}`,
    runFile: "runs/core.json",
    artifacts: (stage, sha) => [
      [`ponto-surface-core-api-${stage}-${sha}`, "surfaces/core"],
      [`ponto-mutation-core-api-${stage}-${sha}`, "mutations/core"],
    ],
  },
  crmPages: {
    workflowPath: ".github/workflows/deploy-crm-pages.yml",
    titlePrefix: (stage, sha, runId) =>
      `CRM Pages ${stage} ${sha} orchestrator=${runId}`,
    runFile: "runs/pages.json",
    artifacts: (stage, sha) => [
      [`ponto-surface-crm-pages-${stage}-${sha}`, "surfaces/pages"],
      [`ponto-mutation-crm-pages-${stage}-${sha}`, "mutations/pages"],
    ],
  },
  pagesEnvironmentSecrets: {
    workflowPath: ".github/workflows/cloudflare-pages-sync-ponto.yml",
    titlePrefix: (stage, sha, runId) =>
      `Attest CRM Pages ${stage === "staging" ? "staging" : "production"} ${sha} orchestrator=${runId}`,
    runFile: "runs/provision-pages.json",
    artifacts: (stage, sha) => [
      [`ponto-pages-secret-attestation-${stage === "staging" ? "staging" : "production"}-${sha}`, "provisioning/pages"],
    ],
  },
  stagingRollbackDrill: {
    workflowPath: ".github/workflows/ponto-staging-rollback-drill.yml",
    titlePrefix: (stage, sha, runId) => stage === "staging"
      ? `Ponto staging rollback drill ${sha} orchestrator=${runId}`
      : null,
    runFile: "runs/staging-rollback-drill.json",
    artifacts: (_stage, sha) => [
      [`ponto-staging-rollback-drill-${sha}`, "staging-rollback-drill"],
    ],
    stages: new Set(["staging"]),
  },
});

const CAPABILITY_NAME =
  /^ponto-lease\/([a-z][a-z0-9-]{1,63})\/([1-9][0-9]*)\/([0-9a-f]{32})$/;

async function loadCapabilityInventory({ repository, releaseSha, request }) {
  const checks = [];
  let exhausted = false;
  for (let page = 1; page <= 20; page += 1) {
    const payload = await request(
      `/repos/${repository}/commits/${releaseSha}/check-runs?filter=all&per_page=100&page=${page}`,
    );
    const rows = payload?.check_runs || [];
    checks.push(...rows);
    if (rows.length < 100) {
      exhausted = true;
      break;
    }
  }
  if (!exhausted) throw new Error("watchdog capability inventory exceeded the governed bound");
  return checks;
}

async function verifyCapabilityAnchor({
  run,
  checks,
  request,
  repository,
  repositoryId,
  coordinatorWorkflowId,
  coordinatorRunId,
  releaseSha,
  stage,
  target,
  capabilityVerifier,
}) {
  const candidates = checks.filter((check) => {
    const match = CAPABILITY_NAME.exec(String(check?.name || ""));
    return match?.[2] === String(run.id)
      && check?.head_sha === releaseSha
      && check?.app?.slug === "github-actions"
      && Number.isInteger(check?.id);
  });
  if (candidates.length > 1) throw new Error("watchdog child capability is ambiguous");
  if (!candidates.length) return null;
  const check = await request(`/repos/${repository}/check-runs/${candidates[0].id}`);
  const match = CAPABILITY_NAME.exec(String(check?.name || ""));
  const document = JSON.parse(String(check?.output?.summary || ""));
  const claims = document?.claims || {};
  const state = String(document?.transition?.state || "");
  const childWorkflowPath = String(run.path || "").split("@")[0];
  if (
    !match
    || run?.run_attempt !== 1
    || run?.repository?.full_name !== repository
    || run?.head_repository?.full_name !== repository
    || match[2] !== String(run.id)
    || claims.parentWorkflowId !== coordinatorWorkflowId
    || claims.parentWorkflowPath !== ".github/workflows/ponto-progressive-release.yml"
    || claims.parentRunId !== String(coordinatorRunId)
    || claims.issuerWorkflowId !== claims.parentWorkflowId
    || claims.issuerWorkflowPath !== claims.parentWorkflowPath
    || claims.issuerRunId !== claims.parentRunId
    || claims.childWorkflowId !== run.workflow_id
    || claims.childWorkflowPath !== childWorkflowPath
    || claims.childRunId !== String(run.id)
    || claims.leaseKey !== match[1]
    || claims.dispatchNonce !== match[3]
    || claims.releaseSha !== releaseSha
    || claims.stage !== stage
    || claims.target !== target
    || claims.keyId !== capabilityVerifier.keyId
    || !["issued", "consumed", "invalidated"].includes(state)
    || (
      state === "issued"
      && (check?.status !== "in_progress" || check?.conclusion != null)
    )
    || (
      state === "consumed"
      && (check?.status !== "completed" || check?.conclusion !== "success")
    )
    || (
      state === "invalidated"
      && (check?.status !== "completed" || check?.conclusion !== "cancelled")
    )
    || check?.external_id !== capabilityExternalId(
      claims.parentRunId,
      claims.issuerRunId,
      claims.childRunId,
      claims.leaseKey,
      claims.dispatchNonce,
      claims.intentDigest,
    )
  ) throw new Error("watchdog child capability chain is invalid");
  verifyCapabilityDocument(document, {
    publicKey: capabilityVerifier.publicKey,
    keyId: capabilityVerifier.keyId,
    repositoryId,
    repository,
    parentWorkflowId: coordinatorWorkflowId,
    parentWorkflowPath: claims.parentWorkflowPath,
    parentRunId: claims.parentRunId,
    issuerWorkflowId: claims.issuerWorkflowId,
    issuerWorkflowPath: claims.issuerWorkflowPath,
    issuerRunId: claims.issuerRunId,
    childWorkflowId: run.workflow_id,
    childWorkflowPath,
    childRunId: String(run.id),
    leaseKey: claims.leaseKey,
    stage,
    target,
    releaseSha,
    dispatchNonce: claims.dispatchNonce,
    intentDigest: claims.intentDigest,
    state,
    allowExpired: true,
  });
  return {
    checkId: String(check.id),
    state,
    leaseKey: claims.leaseKey,
    dispatchNonce: claims.dispatchNonce,
    intentDigest: claims.intentDigest,
  };
}

export async function reconstructWatchdogJournal({
  repository,
  coordinatorRunId,
  releaseSha,
  stage,
  artifactRoot,
  request,
  repositoryId = "",
  capabilityPublicKeysJson = "",
}) {
  if (
    !repository?.includes("/")
    || !/^[1-9][0-9]*$/.test(String(coordinatorRunId || ""))
    || !/^[0-9a-f]{40}$/.test(String(releaseSha || ""))
    || !["staging", "pilot", "canary", "production"].includes(stage)
    || !artifactRoot
  ) throw new Error("watchdog journal identity is invalid");

  const applicableSurfaces = Object.entries(SURFACES)
    .filter(([, specification]) => !specification.stages || specification.stages.has(stage));
  const coordinator = await request(
    `/repos/${repository}/actions/runs/${coordinatorRunId}`,
  );
  const coordinatorCreated = Date.parse(String(coordinator?.created_at || ""));
  const coordinatorUpdated = Date.parse(
    String(coordinator?.updated_at || coordinator?.created_at || ""),
  );
  if (
    String(coordinator?.id || "") !== String(coordinatorRunId)
    || ![".github/workflows/ponto-progressive-release.yml", ".github/workflows/ponto-progressive-release.yml@refs/heads/main"].includes(coordinator?.path)
    || coordinator?.event !== "workflow_dispatch"
    || coordinator?.head_branch !== "main"
    || String(coordinator?.head_sha || "").toLowerCase() !== releaseSha
    || coordinator?.repository?.full_name !== repository
    || coordinator?.head_repository?.full_name !== repository
    || !Number.isFinite(coordinatorCreated)
    || !Number.isFinite(coordinatorUpdated)
    || coordinatorUpdated < coordinatorCreated
  ) throw new Error("watchdog coordinator lifecycle provenance is invalid");
  const coordinatorWorkflow = await request(
    `/repos/${repository}/actions/workflows/ponto-progressive-release.yml`,
  );
  if (
    !Number.isInteger(coordinatorWorkflow?.id)
    || coordinatorWorkflow.id !== coordinator.workflow_id
    || coordinatorWorkflow.path !== ".github/workflows/ponto-progressive-release.yml"
    || !["active", "disabled_manually", "disabled_inactivity"].includes(
      coordinatorWorkflow.state,
    )
  ) throw new Error("watchdog canonical coordinator workflow is unavailable");
  const createdRange = [
    new Date(coordinatorCreated - 60_000).toISOString(),
    new Date(Math.max(coordinatorCreated, coordinatorUpdated) + 6 * 60 * 60 * 1_000).toISOString(),
  ].join("..");
  const savedBySurface = new Map();
  for (const [surface, specification] of applicableSurfaces) {
    const file = path.join(artifactRoot, specification.runFile);
    if (!fs.existsSync(file)) continue;
    let saved;
    try {
      saved = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      throw new Error(`watchdog journal anchor is unreadable for ${surface}`);
    }
    savedBySurface.set(surface, saved);
  }
  const savedEntries = [...savedBySurface.values()];
  const target = stage === "staging" ? "staging" : "production";
  let capabilityVerifier = null;
  if (/^[1-9][0-9]*$/.test(String(repositoryId)) && capabilityPublicKeysJson) {
    capabilityVerifier = resolveCapabilityVerifier(capabilityPublicKeysJson, target);
  }
  const capabilityCustodyAvailable = Boolean(capabilityVerifier);
  if (!savedEntries.length && !capabilityCustodyAvailable) {
    const report = {
      schemaVersion: 1,
      coordinatorRunId,
      releaseSha,
      stage,
      discoveredChildren: 0,
      downloads: [],
      unresolved: [{
        reason: "durable-journal-and-capability-custody-missing",
      }],
      passed: false,
      credentialsIncluded: false,
      piiIncluded: false,
    };
    fs.mkdirSync(artifactRoot, { recursive: true });
    fs.writeFileSync(
      path.join(artifactRoot, "watchdog-journal.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      { mode: 0o600 },
    );
    return report;
  }

  const discoveredById = new Map();
  const workflowMetadataByPath = new Map();
  for (const [, specification] of applicableSurfaces) {
    if (workflowMetadataByPath.has(specification.workflowPath)) continue;
    const file = specification.workflowPath.split("/").at(-1);
    const metadata = await request(
      `/repos/${repository}/actions/workflows/${encodeURIComponent(file)}`,
    );
    if (
      !Number.isInteger(metadata?.id)
      || metadata?.path !== specification.workflowPath
      || !["active", "disabled_manually", "disabled_inactivity"].includes(metadata?.state)
    ) throw new Error("watchdog canonical child workflow is unavailable");
    workflowMetadataByPath.set(specification.workflowPath, metadata);
    let exhausted = false;
    for (let page = 1; page <= 20; page += 1) {
      const payload = await request(
        `/repos/${repository}/actions/workflows/${metadata.id}/runs?event=workflow_dispatch&branch=main&created=${encodeURIComponent(createdRange)}&per_page=100&page=${page}`,
      );
      const rows = payload?.workflow_runs || [];
      for (const run of rows) {
        if (isCorrelatedChild(run, {
          repository,
          orchestratorRunId: coordinatorRunId,
          orchestratorHeadSha: releaseSha,
        })) discoveredById.set(String(run.id), run);
      }
      if (rows.length < 100) {
        exhausted = true;
        break;
      }
    }
    if (!exhausted) {
      throw new Error(`watchdog ${specification.workflowPath} discovery exceeded the coordinator window`);
    }
  }
  const discovered = [...discoveredById.values()];

  // Exact durable run IDs remain authoritative even if a busy repository
  // pushes them outside the bounded discovery pages.
  const discoveredIds = new Set(discovered.map((run) => String(run.id)));
  for (const saved of savedEntries) {
    const runId = String(saved?.runId || "");
    if (!/^[1-9][0-9]*$/.test(runId) || discoveredIds.has(runId)) continue;
    const run = await request(`/repos/${repository}/actions/runs/${runId}`);
    if (
      isCorrelatedChild(run, {
        repository,
        orchestratorRunId: coordinatorRunId,
        orchestratorHeadSha: releaseSha,
      })
      && isJournalAuthorizedRun(run, [saved])
    ) {
      discovered.push(run);
      discoveredIds.add(runId);
    }
  }

  const downloads = [];
  const unresolved = [];
  const ignoredUnprovenChildren = [];
  let acceptedChildren = 0;
  let capabilityChecks = null;
  let coordinatorWorkflowId = coordinatorWorkflow.id;
  const capabilityAnchorFor = async (run) => {
    if (!capabilityCustodyAvailable) return null;
    if (!coordinatorWorkflowId) {
      const workflow = await request(
        `/repos/${repository}/actions/workflows/ponto-progressive-release.yml`,
      );
      if (
        !Number.isInteger(workflow?.id)
        || workflow?.path !== ".github/workflows/ponto-progressive-release.yml"
        || !["active", "disabled_manually", "disabled_inactivity"].includes(workflow?.state)
      ) throw new Error("canonical Ponto coordinator workflow is unavailable");
      coordinatorWorkflowId = workflow.id;
    }
    capabilityChecks ||= await loadCapabilityInventory({
      repository,
      releaseSha,
      request,
    });
    return verifyCapabilityAnchor({
      run,
      checks: capabilityChecks,
      request,
      repository,
      repositoryId,
      coordinatorWorkflowId,
      coordinatorRunId,
      releaseSha,
      stage,
      target,
      capabilityVerifier,
    });
  };
  fs.mkdirSync(path.join(artifactRoot, "runs"), { recursive: true });
  for (const [surface, specification] of applicableSurfaces) {
    const saved = savedBySurface.get(surface);
    const expectedTitlePrefix = specification.titlePrefix(
      stage,
      releaseSha,
      coordinatorRunId,
    );
    const candidates = discovered.filter((run) =>
      String(run.path || "").split("@")[0] === specification.workflowPath
      && hasExactNonceTitle(run.display_title, expectedTitlePrefix));
    let matches = saved
      ? candidates.filter((run) => isJournalAuthorizedRun(run, [saved]))
      : [];
    const capabilityByRun = new Map();
    const trustedIds = new Set(matches.map(run => String(run.id)));
    for (const run of candidates) {
      if (trustedIds.has(String(run.id))) continue;
      if (capabilityCustodyAvailable) {
        try {
          const capability = await capabilityAnchorFor(run);
          if (capability) {
            matches.push(run);
            trustedIds.add(String(run.id));
            capabilityByRun.set(String(run.id), capability);
          } else {
            const failure = {
              surface,
              runId: String(run.id),
              reason: "capability-absent",
            };
            ignoredUnprovenChildren.push(failure);
            unresolved.push({
              surface,
              runId: String(run.id),
              reason: "canonical-correlated-child-untrusted",
            });
          }
        } catch (error) {
          const failure = {
            surface,
            runId: String(run.id),
            reason: String(error?.message || error),
          };
          ignoredUnprovenChildren.push(failure);
          unresolved.push({
            surface,
            runId: String(run.id),
            reason: "canonical-correlated-child-untrusted",
          });
        }
      } else {
        ignoredUnprovenChildren.push({
          surface,
          runId: String(run.id),
          reason: "durable-journal-anchor-absent",
        });
        unresolved.push({
          surface,
          runId: String(run.id),
          reason: "canonical-correlated-child-untrusted",
        });
      }
    }
    if (matches.length > 1) {
      unresolved.push({ surface, reason: "ambiguous-journal-authorized-child" });
      continue;
    }
    if (!matches.length) {
      if (saved) {
        unresolved.push({ surface, reason: "journal-authorized-child-unavailable" });
      }
      continue;
    }
    const run = matches[0];
    acceptedChildren += 1;
    const capability = capabilityByRun.get(String(run.id)) || null;
    const record = {
      ...(saved || {}),
      workflow: specification.workflowPath.split("/").at(-1),
      workflowId: Number(run.workflow_id),
      workflowPath: specification.workflowPath,
      runId: String(run.id),
      status: String(run.status || ""),
      conclusion: String(run.conclusion || "unknown"),
      event: String(run.event || ""),
      headBranch: String(run.head_branch || ""),
      headSha: String(run.head_sha || "").toLowerCase(),
      repository,
      url: String(run.html_url || ""),
      reconstructedByWatchdog: true,
      ...(capability ? {
        reconstructedFromCapability: true,
        capabilityCheckRunId: capability.checkId,
        capabilityState: capability.state,
        dispatchNonce: capability.dispatchNonce,
        leaseKey: capability.leaseKey,
        intentDigest: capability.intentDigest,
      } : {}),
    };
    fs.writeFileSync(path.join(artifactRoot, specification.runFile), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    for (const [artifact, destination] of specification.artifacts(stage, releaseSha)) {
      downloads.push({ surface, runId: String(run.id), artifact, destination });
    }
  }
  const report = {
    schemaVersion: 1,
    coordinatorRunId,
    releaseSha,
    stage,
    candidateChildren: discovered.length,
    discoveredChildren: acceptedChildren,
    downloads,
    unresolved,
    ignoredUnprovenChildren,
    passed: unresolved.length === 0,
    credentialsIncluded: false,
    piiIncluded: false,
  };
  fs.writeFileSync(path.join(artifactRoot, "watchdog-journal.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return report;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  const token = String(process.env.GH_TOKEN || "");
  const repository = String(process.env.GITHUB_REPOSITORY || "");
  const apiBase = String(process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
  const request = async (pathname) => {
    const response = await fetch(`${apiBase}${pathname}`, {
      signal: AbortSignal.timeout(30_000),
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
      },
    });
    if (!response.ok) throw new Error(`GitHub API GET ${pathname} returned ${response.status}`);
    return response.json();
  };
  const report = await reconstructWatchdogJournal({
    repository,
    coordinatorRunId: process.env.PONTO_COORDINATOR_RUN_ID,
    releaseSha: process.env.PONTO_COORDINATOR_SHA,
    stage: process.env.PONTO_COORDINATOR_STAGE,
    artifactRoot: process.env.PONTO_RECOVERY_ARTIFACT_ROOT,
    request,
    repositoryId: process.env.GITHUB_REPOSITORY_ID,
    capabilityPublicKeysJson: process.env.PONTO_ORCHESTRATOR_CAPABILITY_PUBLIC_KEYS_JSON,
  });
  if (!report.passed) throw new Error("watchdog journal reconstruction is ambiguous");
}
