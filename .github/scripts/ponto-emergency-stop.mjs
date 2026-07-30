import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isCorrelatedChild, isTerminalRun } from "./ponto-reconcile-children.mjs";
import {
  capabilityExternalId,
  resolveCapabilityVerifier,
  transitionCapabilityDocument,
  verifyCapabilityDocument,
} from "./ponto-orchestrator-lease.mjs";

const COORDINATOR_TITLE = /^Ponto (staging|pilot|canary|production|rollback) ([0-9a-f]{40}) orchestrator=([1-9][0-9]*)$/;
export const NON_TERMINAL_STATUSES = ["queued", "in_progress", "waiting", "pending", "requested"];
const NON_TERMINAL = new Set(NON_TERMINAL_STATUSES);
const ALLOWED_HIGH_RISK_EVENTS = new Set(["workflow_dispatch", "schedule"]);

export const HIGH_RISK_WORKFLOWS = Object.freeze([
  { path: ".github/workflows/deploy-timekeeping.yml", title: /^Timekeeping (preview|staging|pilot|canary|production|rollback)(?:\s|$)/ },
  { path: ".github/workflows/deploy-core-workers.yml", title: /^Core (?:api|inventory|all) (preview|staging|pilot|canary|production|rollback)(?:\s|$)/ },
  { path: ".github/workflows/deploy-crm-pages.yml", title: /^CRM Pages (preview|staging|pilot|canary|production|rollback)(?:\s|$)/ },
  { path: ".github/workflows/module-availability.yml", title: /^Module (?:finance|timekeeping) (staging|production)(?:\s|$)/ },
  { path: ".github/workflows/cloudflare-workers-sync-ponto-secrets.yml", title: /^Attest Ponto Workers (staging|production)(?:\s|$)/ },
  { path: ".github/workflows/cloudflare-pages-sync-ponto.yml", title: /^Attest CRM Pages (staging|production)(?:\s|$)/ },
  { path: ".github/workflows/ponto-core-baseline-publisher.yml", targets: ["staging", "production"] },
  { path: ".github/workflows/timekeeping-staging-journey.yml", targets: ["staging"] },
  { path: ".github/workflows/ponto-staging-rollback-drill.yml", targets: ["staging"] },
  { path: ".github/workflows/ponto-production-baseline.yml", targets: ["production"] },
  { path: ".github/workflows/ponto-production-slo.yml", targets: ["production"] },
]);

export const targetForStage = (stage) => stage === "staging" ? "staging" : "production";
export const isBodylessResponseStatus = (status) => status === 202 || status === 204;
export const isInventoryWorkflowState = (state) =>
  state === "active" || /^disabled_(?:fork|inactivity|manually)$/.test(String(state || ""));

export function isWithinCoordinatorWindow(child, coordinator) {
  const childCreated = Date.parse(String(child?.created_at || ""));
  const childUpdated = Date.parse(String(child?.updated_at || child?.created_at || ""));
  const coordinatorCreated = Date.parse(String(coordinator?.created_at || ""));
  const coordinatorUpdated = Date.parse(String(coordinator?.updated_at || coordinator?.created_at || ""));
  if (![childCreated, childUpdated, coordinatorCreated, coordinatorUpdated].every(Number.isFinite)) {
    return false;
  }
  const lowerBound = coordinatorCreated - 60_000;
  const upperBound = Math.max(coordinatorUpdated, coordinatorCreated) + 6 * 60 * 60 * 1_000;
  return childCreated >= lowerBound
    && childCreated <= upperBound
    && childUpdated >= childCreated;
}

export async function loadCanonicalHighRiskWorkflows({ repository, request }) {
  const byId = new Map();
  for (const specification of HIGH_RISK_WORKFLOWS) {
    const file = specification.path.split("/").at(-1);
    const workflow = await request(`/repos/${repository}/actions/workflows/${encodeURIComponent(file)}`);
    if (
      !isInventoryWorkflowState(workflow?.state)
      || workflow?.path !== specification.path
      || !Number.isInteger(workflow?.id)
      || byId.has(workflow.id)
    ) {
      throw new Error(`canonical high-risk Ponto workflow is unavailable: ${specification.path}`);
    }
    byId.set(workflow.id, { ...specification, id: workflow.id, state: workflow.state });
  }
  return byId;
}

export function classifyHighRiskRun(run, {
  repository,
  workflowsById,
  target,
  currentEmergencyRunId = "",
}) {
  const specification = workflowsById.get(run?.workflow_id);
  const workflowPath = String(run?.path || "").split("@")[0];
  const runId = String(run?.id || "");
  if (
    !specification
    || workflowPath !== specification.path
    || !ALLOWED_HIGH_RISK_EVENTS.has(run?.event)
    || run?.head_branch !== "main"
    || run?.repository?.full_name !== repository
    || run?.head_repository?.full_name !== repository
    || !/^[1-9][0-9]*$/.test(runId)
    || (
      specification.path === ".github/workflows/module-availability.yml"
      && runId === currentEmergencyRunId
    )
  ) return null;

  let targets = specification.targets || [];
  let classification = specification.targets ? "static" : "title";
  if (!specification.targets) {
    const match = run.event === "workflow_dispatch"
      ? specification.title.exec(String(run?.display_title || ""))
      : null;
    const stage = match?.[1] || "";
    if (stage === "preview") targets = [];
    else if (stage === "staging") targets = ["staging"];
    else if (["pilot", "canary", "production", "rollback"].includes(stage)) targets = ["production"];
    else if (stage === "production") targets = ["production"];
    else {
      // A canonical legacy/scheduled run with no parseable target could touch
      // either environment and is therefore reconciled fail-closed.
      targets = ["staging", "production"];
      classification = "ambiguous-fail-closed";
    }
  }
  if (!targets.includes(target)) return null;
  return {
    runId,
    workflowId: specification.id,
    workflowPath,
    workflowState: specification.state,
    targetScope: targets,
    classification,
    status: String(run?.status || ""),
    conclusion: run?.conclusion || null,
  };
}

export function parseCoordinator(run, {
  repository,
  workflowId,
  target,
}) {
  const match = COORDINATOR_TITLE.exec(String(run?.display_title || ""));
  if (
    !match
    || run?.workflow_id !== workflowId
    || run?.path !== ".github/workflows/ponto-progressive-release.yml@refs/heads/main"
    || run?.event !== "workflow_dispatch"
    || run?.head_branch !== "main"
    || run?.name !== "Ponto progressive release"
    || run?.repository?.full_name !== repository
    || run?.head_repository?.full_name !== repository
    || String(run?.id || "") !== match[3]
    || targetForStage(match[1]) !== target
    || !/^[0-9a-f]{40}$/.test(String(run?.head_sha || "").toLowerCase())
    || String(run.head_sha).toLowerCase() !== match[2]
  ) return null;
  return {
    runId: String(run.id),
    stage: match[1],
    releaseSha: match[2],
    status: String(run.status || ""),
    conclusion: run.conclusion || null,
  };
}

const invokedAsScript = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedAsScript) {
  const token = String(process.env.GH_TOKEN || "").trim();
  const repository = String(process.env.GITHUB_REPOSITORY || "").trim();
  const repositoryId = String(process.env.GITHUB_REPOSITORY_ID || "").trim();
  const capabilityPublicKeysJson = String(
    process.env.PONTO_ORCHESTRATOR_CAPABILITY_PUBLIC_KEYS_JSON || "",
  );
  const apiBase = String(process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
  const target = String(process.env.PONTO_EMERGENCY_TARGET || "").trim().toLowerCase();
  const currentEmergencyRunId = String(process.env.GITHUB_RUN_ID || "").trim();
  const exactCoordinatorRunId = String(
    process.env.PONTO_EMERGENCY_COORDINATOR_RUN_ID || "",
  ).trim();
  const reportFile = String(process.env.PONTO_EMERGENCY_REPORT || "").trim();
  const timeoutSeconds = Number(process.env.PONTO_EMERGENCY_TIMEOUT_SECONDS || "900");
  const quietSeconds = Number(process.env.PONTO_EMERGENCY_QUIET_SECONDS || "30");
  const pollMs = Number(process.env.PONTO_EMERGENCY_POLL_MS || "5000");
  if (
    !token
    || !repository.includes("/")
    || !/^[1-9][0-9]*$/.test(repositoryId)
    || !capabilityPublicKeysJson
    || !["staging", "production"].includes(target)
    || !/^[1-9][0-9]*$/.test(currentEmergencyRunId)
    || (exactCoordinatorRunId && !/^[1-9][0-9]*$/.test(exactCoordinatorRunId))
    || !reportFile
    || !Number.isInteger(timeoutSeconds)
    || timeoutSeconds < 300
    || timeoutSeconds > 1_200
    || !Number.isInteger(quietSeconds)
    || quietSeconds < 0
    || quietSeconds > 60
    || !Number.isInteger(pollMs)
    || pollMs < 1
    || pollMs > 10_000
  ) throw new Error("emergency stop custody or timeout is invalid");
  const capabilityVerifier = resolveCapabilityVerifier(capabilityPublicKeysJson, target);

  const request = async (pathname, init = {}, accepted = []) => {
    const response = await fetch(`${apiBase}${pathname}`, {
      ...init,
      signal: AbortSignal.timeout(30_000),
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
        ...(init.headers || {}),
      },
    });
    if (!response.ok && !accepted.includes(response.status)) {
      throw new Error(`GitHub API ${init.method || "GET"} ${pathname} returned ${response.status}`);
    }
    if (isBodylessResponseStatus(response.status) || accepted.includes(response.status)) return null;
    return response.json();
  };

  const workflow = await request(`/repos/${repository}/actions/workflows/ponto-progressive-release.yml`);
  if (
    !isInventoryWorkflowState(workflow?.state)
    || workflow?.path !== ".github/workflows/ponto-progressive-release.yml"
    || !Number.isInteger(workflow?.id)
  ) throw new Error("canonical Ponto coordinator workflow is unavailable");
  const highRiskWorkflows = await loadCanonicalHighRiskWorkflows({ repository, request });

  const startedAt = new Date().toISOString();
  const deadline = Date.now() + timeoutSeconds * 1_000;
  const coordinators = new Map();
  const children = new Map();
  const unprovenChildren = new Map();
  const invalidCoordinatorIds = new Set();
  const capabilityInvalidationErrors = [];
  const completedWindowRuns = new Map();
  const completedWindowScans = new Set();
  let completedCoordinatorDiscoveryDone = false;
  let quietSince = null;

  const listCandidateRuns = async () => {
    const found = new Map();
    for (const status of NON_TERMINAL) {
      let exhausted = false;
      for (let page = 1; page <= 20; page += 1) {
        const payload = await request(`/repos/${repository}/actions/runs?branch=main&status=${status}&per_page=100&page=${page}`);
        const rows = payload?.workflow_runs || [];
        for (const run of rows) {
          if (ALLOWED_HIGH_RISK_EVENTS.has(run?.event)) found.set(String(run.id), run);
        }
        if (rows.length < 100) {
          exhausted = true;
          break;
        }
      }
      if (!exhausted) {
        throw new Error(`non-terminal ${status} run inventory exceeds the governed discovery bound`);
      }
    }
    const coordinatorCandidates = new Map(
      [...coordinators.values()]
        .filter(record => record.live)
        .map(record => [record.runId, record.live]),
    );
    if (exactCoordinatorRunId && !coordinatorCandidates.has(exactCoordinatorRunId)) {
      coordinatorCandidates.set(
        exactCoordinatorRunId,
        await request(`/repos/${repository}/actions/runs/${exactCoordinatorRunId}`),
      );
    }
    if (!completedCoordinatorDiscoveryDone) {
      const recentSince = new Date(Date.parse(startedAt) - 24 * 60 * 60 * 1_000).toISOString();
      let coordinatorInventoryExhausted = false;
      for (let page = 1; page <= 20; page += 1) {
        const payload = await request(
          `/repos/${repository}/actions/workflows/${workflow.id}/runs?event=workflow_dispatch&branch=main&status=completed&created=${encodeURIComponent(`>=${recentSince}`)}&per_page=100&page=${page}`,
        );
        const rows = payload?.workflow_runs || [];
        for (const row of rows) coordinatorCandidates.set(String(row.id), row);
        if (rows.length < 100) {
          coordinatorInventoryExhausted = true;
          break;
        }
      }
      if (!coordinatorInventoryExhausted) {
        throw new Error("completed coordinator inventory exceeds the governed recent window");
      }
      completedCoordinatorDiscoveryDone = true;
    }
    for (const coordinatorRun of coordinatorCandidates.values()) {
      const parsed = parseCoordinator(coordinatorRun, {
        repository,
        workflowId: workflow.id,
        target,
      });
      if (!parsed) continue;
      found.set(parsed.runId, coordinatorRun);
      if (completedWindowScans.has(parsed.runId)) continue;
      const from = Date.parse(String(coordinatorRun.created_at || ""));
      const updated = Date.parse(String(coordinatorRun.updated_at || ""));
      if (!Number.isFinite(from) || !Number.isFinite(updated)) {
        throw new Error("completed coordinator lifecycle timestamps are unavailable");
      }
      const to = Math.max(from, updated) + 6 * 60 * 60 * 1_000;
      const createdRange = `${new Date(from - 60_000).toISOString()}..${new Date(to).toISOString()}`;
      for (const specification of highRiskWorkflows.values()) {
        let exhausted = false;
        for (let page = 1; page <= 20; page += 1) {
          const payload = await request(
            `/repos/${repository}/actions/workflows/${specification.id}/runs?event=workflow_dispatch&branch=main&status=completed&created=${encodeURIComponent(createdRange)}&per_page=100&page=${page}`,
          );
          const rows = payload?.workflow_runs || [];
          for (const row of rows) completedWindowRuns.set(String(row.id), row);
          if (rows.length < 100) {
            exhausted = true;
            break;
          }
        }
        if (!exhausted) {
          throw new Error(`completed ${specification.path} inventory exceeds the coordinator window`);
        }
      }
      completedWindowScans.add(parsed.runId);
    }
    for (const row of completedWindowRuns.values()) found.set(String(row.id), row);
    return [...found.values()];
  };

  const authorizeAndInvalidateCapability = async (record) => {
    record.invalidatedCapabilityCheckRunIds ||= [];
    record.capabilityInventoryScans = (record.capabilityInventoryScans || 0) + 1;
    const run = record.live;
    try {
      const checks = [];
      let exhausted = false;
      for (let page = 1; page <= 20; page += 1) {
        const payload = await request(
          `/repos/${repository}/commits/${run.head_sha}/check-runs?filter=all&per_page=100&page=${page}`,
        );
        const rows = payload?.check_runs || [];
        checks.push(...rows);
        if (rows.length < 100) {
          exhausted = true;
          break;
        }
      }
      if (!exhausted) throw new Error("capability check inventory exceeds the governed bound");
      const pattern = new RegExp(
        `^ponto-lease\\/([a-z][a-z0-9-]{1,63})\\/${record.runId}\\/([0-9a-f]{32})$`,
      );
      const candidates = checks.filter(check =>
        pattern.test(String(check?.name || ""))
        && check?.head_sha === run.head_sha
        && check?.app?.slug === "github-actions"
        && Number.isInteger(check?.id));
      if (candidates.length > 1) {
        throw new Error("child capability check is ambiguous");
      }
      if (!candidates.length) {
        record.capabilityAuthorization = "absent";
        return false;
      }

      const check = await request(`/repos/${repository}/check-runs/${candidates[0].id}`);
      const match = pattern.exec(String(check?.name || ""));
      const document = JSON.parse(String(check?.output?.summary || ""));
      const claims = document?.claims || {};
      const capabilityState = String(document?.transition?.state || "");
      const childWorkflowPath = String(run?.path || "").split("@")[0];
      const specification = highRiskWorkflows.get(run?.workflow_id);
      const allowedStage = target === "staging"
        ? claims.stage === "staging"
        : ["pilot", "canary", "production", "rollback"].includes(claims.stage);
      const delegated = String(claims.issuerRunId || "") !== String(claims.parentRunId || "");
      if (
        !match
        || !specification
        || specification.path !== childWorkflowPath
        || claims.parentWorkflowId !== workflow.id
        || claims.parentWorkflowPath !== workflow.path
        || claims.parentRunId !== record.orchestratorRunId
        || !Number.isInteger(claims.issuerWorkflowId)
        || !/^\.github\/workflows\/[a-z0-9-]+\.yml$/.test(String(claims.issuerWorkflowPath || ""))
        || !/^[1-9][0-9]*$/.test(String(claims.issuerRunId || ""))
        || claims.childWorkflowId !== run.workflow_id
        || claims.childWorkflowPath !== childWorkflowPath
        || claims.childRunId !== record.runId
        || claims.leaseKey !== match[1]
        || claims.dispatchNonce !== match[2]
        || claims.releaseSha !== run.head_sha
        || claims.target !== target
        || claims.keyId !== capabilityVerifier.keyId
        || !allowedStage
        || (
          delegated
          && (
            claims.issuerWorkflowPath !== ".github/workflows/ponto-staging-rollback-drill.yml"
            || childWorkflowPath !== ".github/workflows/module-availability.yml"
            || !["rollback-incumbent-open", "rollback-candidate-open"].includes(claims.leaseKey)
            || target !== "staging"
          )
        )
        || (!delegated && (
          claims.issuerWorkflowId !== claims.parentWorkflowId
          || claims.issuerWorkflowPath !== claims.parentWorkflowPath
        ))
        || !["issued", "consumed", "invalidated"].includes(capabilityState)
        || (
          capabilityState === "issued"
          && (check?.status !== "in_progress" || check?.conclusion != null)
        )
        || (
          capabilityState === "consumed"
          && (check?.status !== "completed" || check?.conclusion !== "success")
        )
        || (
          capabilityState === "invalidated"
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
      ) throw new Error("child capability chain is invalid");
      verifyCapabilityDocument(document, {
        publicKey: capabilityVerifier.publicKey,
        keyId: capabilityVerifier.keyId,
        repositoryId,
        repository,
        parentWorkflowId: workflow.id,
        parentWorkflowPath: workflow.path,
        parentRunId: claims.parentRunId,
        issuerWorkflowId: claims.issuerWorkflowId,
        issuerWorkflowPath: claims.issuerWorkflowPath,
        issuerRunId: claims.issuerRunId,
        childWorkflowId: run.workflow_id,
        childWorkflowPath,
        childRunId: record.runId,
        leaseKey: claims.leaseKey,
        stage: claims.stage,
        target,
        releaseSha: run.head_sha,
        dispatchNonce: claims.dispatchNonce,
        intentDigest: claims.intentDigest,
        state: capabilityState,
        allowExpired: true,
      });
      record.capabilityVerified = true;
      record.capabilityState = capabilityState;
      record.capabilityCheckRunId = String(check.id);
      if (capabilityState !== "issued") {
        record.capabilityAuthorization = capabilityState;
        return true;
      }
      const invalidatedDocument = transitionCapabilityDocument(document, {
        state: "invalidated",
      });
      await request(`/repos/${repository}/check-runs/${check.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: "completed",
          conclusion: "cancelled",
          output: {
            title: "Ponto child capability invalidated by emergency stop",
            summary: JSON.stringify(invalidatedDocument),
          },
        }),
      });
      // GitHub check-run updates are not compare-and-swap. Re-read the server
      // state and rely on the emergency latch plus terminal run reconciliation
      // as the surrounding safety boundary.
      const invalidated = await request(`/repos/${repository}/check-runs/${check.id}`);
      if (
        invalidated?.id !== check.id
        || invalidated?.status !== "completed"
        || invalidated?.conclusion !== "cancelled"
        || invalidated?.external_id !== check.external_id
      ) throw new Error("unused child capability invalidation was not attested");
      const invalidatedFromServer = JSON.parse(String(invalidated?.output?.summary || ""));
      if (
        invalidatedFromServer?.signature?.valueBase64url
          !== document?.signature?.valueBase64url
        || JSON.stringify(invalidatedFromServer?.claims) !== JSON.stringify(document?.claims)
      ) throw new Error("unused child capability invalidation rewrote the signed document");
      verifyCapabilityDocument(invalidatedFromServer, {
        publicKey: capabilityVerifier.publicKey,
        keyId: capabilityVerifier.keyId,
        repositoryId,
        repository,
        parentWorkflowId: workflow.id,
        parentWorkflowPath: workflow.path,
        parentRunId: claims.parentRunId,
        issuerWorkflowId: claims.issuerWorkflowId,
        issuerWorkflowPath: claims.issuerWorkflowPath,
        issuerRunId: claims.issuerRunId,
        childWorkflowId: run.workflow_id,
        childWorkflowPath,
        childRunId: record.runId,
        leaseKey: claims.leaseKey,
        stage: claims.stage,
        target,
        releaseSha: run.head_sha,
        dispatchNonce: claims.dispatchNonce,
        intentDigest: claims.intentDigest,
        state: "invalidated",
        allowExpired: true,
      });
      if (!record.invalidatedCapabilityCheckRunIds.includes(String(check.id))) {
        record.invalidatedCapabilityCheckRunIds.push(String(check.id));
      }
      record.capabilityState = "invalidated";
      record.capabilityAuthorization = "invalidated-before-cancel";
      return true;
    } catch (error) {
      record.capabilityAuthorization = "unproven";
      record.capabilityAuthorizationError = String(error?.message || error);
      if (record.capabilityVerified) {
        const failure = {
          childRunId: record.runId,
          reason: record.capabilityAuthorizationError,
        };
        if (!capabilityInvalidationErrors.some(existing =>
          existing.childRunId === failure.childRunId
          && existing.reason === failure.reason)) {
          capabilityInvalidationErrors.push(failure);
        }
      }
      return false;
    }
  };

  const requestCancellation = async (record, { forceAfterMs = 60_000, force = true } = {}) => {
    if (isTerminalRun(record.live)) return;
    if (!record.cancelRequestedAt) {
      try {
        await request(`/repos/${repository}/actions/runs/${record.runId}/cancel`, { method: "POST" }, [409]);
        record.cancelRequestedAt = Date.now();
      } catch (error) {
        record.cancelError = String(error?.message || error);
      }
    }
    if (
      force
      && record.cancelRequestedAt
      && !record.forceCancelRequested
      && Date.now() - record.cancelRequestedAt >= forceAfterMs
    ) {
      try {
        await request(`/repos/${repository}/actions/runs/${record.runId}/force-cancel`, { method: "POST" }, [409]);
        record.forceCancelRequested = true;
      } catch (error) {
        record.forceCancelError = String(error?.message || error);
      }
    }
  };

  while (Date.now() < deadline) {
    const runs = await listCandidateRuns();
    for (const run of runs) {
      const parsed = parseCoordinator(run, {
        repository,
        workflowId: workflow.id,
        target,
      });
      if (!parsed) continue;
      const record = coordinators.get(parsed.runId) || {
        ...parsed,
        firstObservedAt: new Date().toISOString(),
      };
      record.live = run;
      record.status = run.status;
      record.conclusion = run.conclusion || null;
      coordinators.set(parsed.runId, record);
      if (!isTerminalRun(run)) {
        // Recovery is no longer trapped in the coordinator job. The
        // independent latched overlay is already closed before this script,
        // and the default-branch workflow_run watchdog remains responsible
        // after a force-cancelled coordinator becomes terminal.
        await requestCancellation(record, { force: true });
      }
    }

    // Resolve every non-terminal correlation back to its exact coordinator.
    // This catches a child that outlives a coordinator which became terminal
    // before the emergency workflow started, without a time-window shortcut.
    for (const run of runs) {
      const correlation = /orchestrator=([1-9][0-9]*)(?: nonce=[0-9a-f]{32})?$/.exec(
        String(run?.display_title || ""),
      );
      const coordinatorRunId = correlation?.[1] || "";
      if (!coordinatorRunId || coordinators.has(coordinatorRunId) || invalidCoordinatorIds.has(coordinatorRunId)) continue;
      const coordinatorRun = await request(`/repos/${repository}/actions/runs/${coordinatorRunId}`);
      const parsed = parseCoordinator(coordinatorRun, {
        repository,
        workflowId: workflow.id,
        target,
      });
      if (!parsed) {
        invalidCoordinatorIds.add(coordinatorRunId);
        continue;
      }
      coordinators.set(parsed.runId, {
        ...parsed,
        firstObservedAt: new Date().toISOString(),
        live: coordinatorRun,
      });
    }

    for (const coordinator of coordinators.values()) {
      if (!coordinator.live || isTerminalRun(coordinator.live)) continue;
      try {
        coordinator.live = await request(`/repos/${repository}/actions/runs/${coordinator.runId}`);
        coordinator.status = coordinator.live.status;
        coordinator.conclusion = coordinator.live.conclusion || null;
      } catch (error) {
        coordinator.refreshError = String(error?.message || error);
      }
    }

    for (const run of runs) {
      for (const coordinator of coordinators.values()) {
        if (!isCorrelatedChild(run, {
          repository,
          orchestratorRunId: coordinator.runId,
          orchestratorHeadSha: coordinator.releaseSha,
        })) continue;
        const runId = String(run.id);
        const workflowPath = String(run.path || "").split("@")[0];
        const specification = highRiskWorkflows.get(run.workflow_id);
        const classified = classifyHighRiskRun(run, {
          repository,
          workflowsById: highRiskWorkflows,
          target,
          currentEmergencyRunId,
        });
        if (
          !specification
          || specification.path !== workflowPath
          || !classified
          || !isWithinCoordinatorWindow(run, coordinator.live)
        ) continue;
        const record = children.get(runId) || unprovenChildren.get(runId) || {
          runId,
          orchestratorRunId: coordinator.runId,
          workflowPath,
          workflowId: run.workflow_id,
          highRisk: true,
          targetScope: classified.targetScope,
          classification: classified.classification,
          firstObservedAt: new Date().toISOString(),
        };
        record.orchestratorRunId = coordinator.runId;
        record.live = run;
        record.status = run.status;
        record.conclusion = run.conclusion || null;
        if (await authorizeAndInvalidateCapability(record)) {
          unprovenChildren.delete(runId);
          children.set(runId, record);
          if (!isTerminalRun(run)) await requestCancellation(record);
        } else {
          unprovenChildren.set(runId, record);
          // Capability custody authorizes later artifact/journal trust; it is
          // never a prerequisite to stop a canonical high-risk mutator.
          // Historical definitions and late/forged checks must still be
          // cancelled before rollback is allowed to start.
          if (!isTerminalRun(run)) await requestCancellation(record);
        }
      }
    }

    for (const child of children.values()) {
      if (!child.live) continue;
      try {
        if (!isTerminalRun(child.live)) {
          child.live = await request(`/repos/${repository}/actions/runs/${child.runId}`);
          child.status = child.live.status;
          child.conclusion = child.live.conclusion || null;
        }
        // Re-scan while the child is non-terminal and once more after it
        // becomes terminal. This closes the late-issuance window where the
        // dispatcher creates a capability after the first emergency scan.
        if (!isTerminalRun(child.live)) await requestCancellation(child);
      } catch (error) {
        child.refreshError = String(error?.message || error);
      }
    }

    for (const record of unprovenChildren.values()) {
      if (!record.live) continue;
      try {
        // A dispatcher can publish the signed check after the run first
        // becomes visible. Keep rescanning even after cancellation reaches a
        // terminal state so no late-issued capability is left usable.
        if (await authorizeAndInvalidateCapability(record)) {
          unprovenChildren.delete(record.runId);
          children.set(record.runId, record);
          continue;
        }
        if (isTerminalRun(record.live)) continue;
        record.live = await request(`/repos/${repository}/actions/runs/${record.runId}`);
        record.status = record.live.status;
        record.conclusion = record.live.conclusion || null;
        if (!isTerminalRun(record.live)) await requestCancellation(record);
      } catch (error) {
        record.refreshError = String(error?.message || error);
      }
    }

    const activeCoordinator = [...coordinators.values()].some((record) => !isTerminalRun(record.live));
    const activeChild = [...children.values(), ...unprovenChildren.values()]
      .some((record) => !isTerminalRun(record.live));
    if (!activeCoordinator && !activeChild) {
      quietSince ||= Date.now();
      if (Date.now() - quietSince >= quietSeconds * 1_000) break;
    } else {
      quietSince = null;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  const summarize = (record) => ({
    runId: record.runId,
    ...(record.stage ? { stage: record.stage, releaseSha: record.releaseSha } : {}),
    ...(record.orchestratorRunId ? { orchestratorRunId: record.orchestratorRunId } : {}),
    ...(record.workflowPath ? { workflowPath: record.workflowPath } : {}),
    ...(record.workflowId ? { workflowId: record.workflowId } : {}),
    ...(record.targetScope ? { targetScope: record.targetScope } : {}),
    ...(record.classification ? { classification: record.classification } : {}),
    status: record.live?.status || record.status || "unknown",
    conclusion: record.live?.conclusion || record.conclusion || "unknown",
    cancellationRequested: Boolean(record.cancelRequestedAt),
    forceCancellationRequested: record.forceCancelRequested === true,
    ...(record.capabilityAuthorization
      ? { capabilityAuthorization: record.capabilityAuthorization }
      : {}),
    ...(record.capabilityState ? { capabilityState: record.capabilityState } : {}),
    ...(record.capabilityCheckRunId
      ? { capabilityCheckRunId: record.capabilityCheckRunId }
      : {}),
    ...(record.capabilityInventoryScans
      ? { capabilityInventoryScans: record.capabilityInventoryScans }
      : {}),
    ...(record.invalidatedCapabilityCheckRunIds
      ? { invalidatedCapabilityCheckRunIds: record.invalidatedCapabilityCheckRunIds }
      : {}),
  });
  const coordinatorRecords = [...coordinators.values()].map(summarize);
  const childRecords = [...children.values()].map(summarize);
  const ignoredUnprovenRecords = [...unprovenChildren.values()].map(summarize);
  const highRiskRecords = [...children.values(), ...unprovenChildren.values()]
    .filter((record) => record.highRisk)
    .map(summarize);
  const unresolved = [
    ...coordinatorRecords
      .filter((record) => record.status !== "completed")
      .map((record) => ({ runId: record.runId, reason: "coordinator-not-terminal" })),
    ...childRecords
      .filter((record) => record.status !== "completed")
      .map((record) => ({ runId: record.runId, reason: "child-not-terminal" })),
    ...ignoredUnprovenRecords.map((record) => ({
      runId: record.runId,
      reason: record.status === "completed"
        ? "child-capability-unproven"
        : "unproven-child-not-terminal",
    })),
    ...capabilityInvalidationErrors.map((record) => ({
      runId: record.childRunId,
      reason: "capability-invalidation-failed",
    })),
  ];
  const report = {
    schemaVersion: 1,
    target,
    startedAt,
    completedAt: new Date().toISOString(),
    canonicalHighRiskWorkflows: [...highRiskWorkflows.values()].map((entry) => ({
      workflowId: entry.id,
      workflowPath: entry.path,
      workflowState: entry.state,
      targetScope: entry.targets || ["title-derived"],
    })),
    coordinators: coordinatorRecords,
    children: childRecords,
    ignoredUnprovenRuns: ignoredUnprovenRecords,
    highRiskRuns: highRiskRecords,
    capabilityInvalidationErrors,
    unresolved,
    passed: unresolved.length === 0,
    credentialsIncluded: false,
    piiIncluded: false,
  };
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  if (!report.passed) throw new Error("Ponto emergency stop reconciliation is incomplete");
}
