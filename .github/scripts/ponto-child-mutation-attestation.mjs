const GATED_CHILD_WORKFLOWS = new Set([
  ".github/workflows/deploy-timekeeping.yml",
  ".github/workflows/deploy-core-workers.yml",
  ".github/workflows/deploy-crm-pages.yml",
  ".github/workflows/cloudflare-workers-sync-ponto-secrets.yml",
  ".github/workflows/cloudflare-pages-sync-ponto.yml",
]);

const TERMINAL_FAILURES = new Set(["failure", "startup_failure"]);

const normalizedWorkflowPath = (value) => String(value || "").split("@")[0];

/**
 * A reusable Ponto child cannot mutate a surface before its coordination gate
 * succeeds. This predicate is deliberately narrower than “the child failed”:
 * it only accepts a terminal first-attempt run whose only executed job is the
 * reusable coordination gate and whose downstream jobs were all skipped.
 */
export function attestTerminalPreMutationGateFailure({ run, jobs }) {
  const workflowPath = normalizedWorkflowPath(run?.path);
  if (
    !GATED_CHILD_WORKFLOWS.has(workflowPath)
    || run?.status !== "completed"
    || !TERMINAL_FAILURES.has(String(run?.conclusion || ""))
    || Number(run?.run_attempt || 0) !== 1
    || !Array.isArray(jobs)
    || jobs.length < 1
  ) return null;

  const completedJobs = jobs.filter((job) => job?.status === "completed");
  const coordination = completedJobs.filter((job) => job?.name === "coordination / consume");
  const downstream = completedJobs.filter((job) => job?.name !== "coordination / consume");
  if (
    completedJobs.length !== jobs.length
    || coordination.length !== 1
    || coordination[0]?.conclusion !== "failure"
    || downstream.some((job) => job?.conclusion !== "skipped")
  ) return null;

  return {
    workflowPath,
    coordinationJobId: String(coordination[0]?.id || ""),
    downstreamJobCount: downstream.length,
    reason: "terminal-pre-mutation-gate-failure",
    mutationStarted: false,
  };
}

