import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertPontoSourceClosureUnchanged } from "./ponto-source-closure.mjs";

const TITLE = /^Ponto (preview|staging|bootstrap|pilot|canary|production|rollback) ([0-9a-f]{40}) orchestrator=([1-9][0-9]*)$/;
const FAILURE_CONCLUSIONS = new Set(["failure", "cancelled", "timed_out"]);
const NON_TERMINAL_STATUSES = ["queued", "in_progress", "waiting", "pending", "requested"];

function sourceMatchesImmutableRelease(releaseSha, observedSha, assertSource) {
  const release = String(releaseSha || "").trim().toLowerCase();
  const observed = String(observedSha || "").trim().toLowerCase();
  if (!release || !observed) return false;
  if (release === observed) return true;
  try {
    assertSource(release, observed);
    return true;
  } catch {
    return false;
  }
}

export const targetForStage = (stage) => {
  if (stage === "preview") return null;
  return stage === "staging" ? "staging" : "production";
};

export function parseActivePeerCoordinator(run, {
  coordinatorRunId,
  workflow,
  repository,
  repositoryId,
  stage,
  releaseSha,
  assertReleaseSource = assertPontoSourceClosureUnchanged,
}) {
  const match = TITLE.exec(String(run?.display_title || ""));
  if (
    !match
    || String(run?.id || "") === String(coordinatorRunId)
    || !NON_TERMINAL_STATUSES.includes(String(run?.status || ""))
    || run?.workflow_id !== workflow?.id
    || ![workflow?.path, `${workflow?.path}@refs/heads/main`].includes(run?.path)
    || run?.event !== "workflow_dispatch"
    || run?.head_branch !== "main"
    || run?.name !== `Ponto ${match[1]} ${match[2]} orchestrator=${match[3]}`
    || String(run?.id || "") !== match[3]
    || match[1] !== stage
    || match[2] !== releaseSha
    || Number(run?.run_attempt) !== 1
    || run?.repository?.full_name !== repository
    || String(run?.repository?.id || "") !== String(repositoryId)
    || run?.head_repository?.full_name !== repository
    || String(run?.head_repository?.id || "") !== String(repositoryId)
    || !sourceMatchesImmutableRelease(releaseSha, run?.head_sha, assertReleaseSource)
  ) return null;
  return {
    runId: String(run.id),
    status: String(run.status),
  };
}

async function findActivePeerCoordinator({
  request,
  coordinatorRunId,
  workflow,
  repository,
  repositoryId,
  stage,
  releaseSha,
  assertReleaseSource,
}) {
  for (const status of NON_TERMINAL_STATUSES) {
    const payload = await request(
      `/repos/${repository}/actions/workflows/${workflow.id}/runs?event=workflow_dispatch&status=${encodeURIComponent(status)}&per_page=100&page=1`,
    );
    const runs = Array.isArray(payload?.workflow_runs) ? payload.workflow_runs : [];
    for (const candidate of runs) {
      const peer = parseActivePeerCoordinator(candidate, {
        coordinatorRunId,
        workflow,
        repository,
        repositoryId,
        stage,
        releaseSha,
        assertReleaseSource,
      });
      if (peer) return peer;
    }
  }
  return null;
}

export async function validateWatchdogContext({
  event,
  repository,
  repositoryId,
  token,
  apiBase = "https://api.github.com",
  workflowRef,
  gitRef,
  watchdogRunAttempt,
  request: requestOverride,
  assertReleaseSource = assertPontoSourceClosureUnchanged,
}) {
  if (
    !repository?.includes("/")
    || !/^[1-9][0-9]*$/.test(String(repositoryId || ""))
    || !token
    || String(watchdogRunAttempt) !== "1"
    || gitRef !== "refs/heads/main"
    || workflowRef !== `${repository}/.github/workflows/ponto-release-watchdog.yml@refs/heads/main`
  ) throw new Error("watchdog source custody is invalid");
  const request = requestOverride || (async (pathname) => {
    const response = await fetch(`${apiBase.replace(/\/$/, "")}${pathname}`, {
      signal: AbortSignal.timeout(30_000),
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
      },
    });
    if (!response.ok) throw new Error(`GitHub API GET ${pathname} returned ${response.status}`);
    return response.json();
  });
  const eventRun = event?.workflow_run;
  if (!Number.isInteger(eventRun?.id)) throw new Error("workflow_run event is absent");
  const [workflow, run, jobs] = await Promise.all([
    request(`/repos/${repository}/actions/workflows/ponto-progressive-release.yml`),
    request(`/repos/${repository}/actions/runs/${eventRun.id}`),
    request(`/repos/${repository}/actions/runs/${eventRun.id}/jobs?per_page=100`),
  ]);
  const match = TITLE.exec(String(run?.display_title || ""));
  const sourceMatchesRelease = sourceMatchesImmutableRelease(
    match?.[2],
    run?.head_sha,
    assertReleaseSource,
  );
  const runAttempt = Number(run?.run_attempt);
  const eventAttempt = Number(eventRun?.run_attempt);
  const unauthorizedReplay = Number.isInteger(runAttempt) && runAttempt > 1;
  const validConclusion = unauthorizedReplay
    ? typeof run?.conclusion === "string" && run.conclusion.length > 0
    : FAILURE_CONCLUSIONS.has(run?.conclusion) || run?.conclusion === "success";
  if (
    !(
      workflow?.state === "active"
      || /^disabled_(?:fork|inactivity|manually)$/.test(String(workflow?.state || ""))
    )
    || workflow?.path !== ".github/workflows/ponto-progressive-release.yml"
    || !Number.isInteger(workflow?.id)
    || run?.id !== eventRun.id
    || run?.workflow_id !== workflow.id
    || ![workflow.path, `${workflow.path}@refs/heads/main`].includes(run?.path)
    || run?.status !== "completed"
    || !Number.isInteger(runAttempt)
    || runAttempt < 1
    || !validConclusion
    || run?.event !== "workflow_dispatch"
    || run?.head_branch !== "main"
    || run?.name !== `Ponto ${match[1]} ${match[2]} orchestrator=${match[3]}`
    || run?.repository?.full_name !== repository
    || String(run?.repository?.id || "") !== String(repositoryId)
    || run?.head_repository?.full_name !== repository
    || String(run?.head_repository?.id || "") !== String(repositoryId)
    || !match
    || String(run.id) !== match[3]
    || !sourceMatchesRelease
    || eventRun.workflow_id !== workflow.id
    || eventRun.path !== run.path
    || eventRun.head_sha !== run.head_sha
    || eventAttempt !== runAttempt
    || eventRun.conclusion !== run.conclusion
  ) throw new Error("failed coordinator provenance is invalid");
  const stage = match[1];
  // Only an entered orchestrate job can acquire the composite release lease or
  // dispatch mutable child capabilities.  An explicit empty job inventory is
  // therefore safe to ignore; an unavailable or malformed inventory remains
  // fail-closed and preserves the existing recovery behavior.
  const coordinatorStarted = !Array.isArray(jobs?.jobs)
    || jobs.jobs.some((job) => job?.name === "orchestrate");
  const closeCandidate = stage !== "preview"
    && coordinatorStarted
    && (unauthorizedReplay || FAILURE_CONCLUSIONS.has(run.conclusion));
  let activePeer = null;
  let activePeerDiscovery = "not-required";
  // A cancelled duplicate must never close or reconcile the surface while an
  // exact, first-attempt coordinator still owns the same immutable release.
  // Unauthorized reruns remain fail-closed even if another run is active.
  if (closeCandidate && !unauthorizedReplay) {
    try {
      activePeer = await findActivePeerCoordinator({
        request,
        coordinatorRunId: String(run.id),
        workflow,
        repository,
        repositoryId,
        stage,
        releaseSha: match[2],
        assertReleaseSource,
      });
      activePeerDiscovery = activePeer ? "verified-peer" : "no-eligible-peer";
    } catch {
      // If GitHub cannot prove an eligible peer, retain the fail-closed path.
      activePeerDiscovery = "unavailable";
    }
  }
  const requiresClose = closeCandidate && !activePeer;
  return {
    schemaVersion: 1,
    coordinatorRunId: String(run.id),
    coordinatorWorkflowId: String(workflow.id),
    stage,
    target: targetForStage(stage),
    releaseSha: match[2],
    conclusion: run.conclusion,
    runAttempt,
    unauthorizedReplay,
    activePeerCoordinatorRunId: activePeer?.runId || null,
    activePeerDiscovery,
    requiresClose,
    passed: true,
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const context = await validateWatchdogContext({
    event,
    repository: process.env.GITHUB_REPOSITORY,
    repositoryId: process.env.GITHUB_REPOSITORY_ID,
    token: process.env.GH_TOKEN,
    apiBase: process.env.GITHUB_API_URL,
    workflowRef: process.env.GITHUB_WORKFLOW_REF,
    gitRef: process.env.GITHUB_REF,
    watchdogRunAttempt: process.env.GITHUB_RUN_ATTEMPT,
  });
  fs.writeFileSync(process.env.PONTO_WATCHDOG_CONTEXT_FILE, `${JSON.stringify(context, null, 2)}\n`, { mode: 0o600 });
  fs.appendFileSync(process.env.GITHUB_OUTPUT, [
    `coordinator_run_id=${context.coordinatorRunId}`,
    `stage=${context.stage}`,
    `target=${context.target || ""}`,
    `release_sha=${context.releaseSha}`,
    `requires_close=${context.requiresClose ? "true" : "false"}`,
    "",
  ].join("\n"));
}
