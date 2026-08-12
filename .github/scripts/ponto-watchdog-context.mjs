import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertPontoSourceClosureUnchanged } from "./ponto-source-closure.mjs";

const TITLE = /^Ponto (preview|staging|pilot|canary|production|rollback) ([0-9a-f]{40}) orchestrator=([1-9][0-9]*)$/;
const FAILURE_CONCLUSIONS = new Set(["failure", "cancelled", "timed_out"]);

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
  const requiresClose = stage !== "preview"
    && coordinatorStarted
    && (unauthorizedReplay || FAILURE_CONCLUSIONS.has(run.conclusion));
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
