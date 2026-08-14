const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const rejected = reason => ({ passed: false, reason });

export function inspectCancelledBeforeRunnerDeployJob(payload) {
  const jobs = payload?.jobs;
  if (!Array.isArray(jobs) || Number(payload?.total_count) !== jobs.length) {
    return rejected("github-jobs-list-incomplete");
  }

  const deployJobs = jobs.filter(job => job?.name === "deploy");
  if (deployJobs.length !== 1) return rejected("deploy-job-not-unique");

  const deploy = deployJobs[0];
  if (deploy.status !== "completed" || deploy.conclusion !== "cancelled") {
    return rejected("deploy-job-not-cancelled");
  }
  if (!Array.isArray(deploy.steps) || deploy.steps.length !== 0) {
    return rejected("deploy-job-has-steps");
  }

  const runnerFields = [
    "runner_id",
    "runner_name",
    "runner_group_id",
    "runner_group_name",
  ];
  if (!runnerFields.every(field => deploy[field] == null)) {
    return rejected("deploy-job-had-runner");
  }

  const startedAt = Date.parse(String(deploy.started_at || ""));
  const completedAt = Date.parse(String(deploy.completed_at || ""));
  if (
    Number.isFinite(startedAt)
    && Number.isFinite(completedAt)
    && completedAt > startedAt
  ) {
    return rejected("deploy-job-has-execution-window");
  }

  return {
    passed: true,
    job: {
      conclusion: "cancelled",
      runnerAllocated: false,
      stepCount: 0,
      timing: Number.isFinite(startedAt) && Number.isFinite(completedAt)
        ? "completed-not-after-started"
        : "no-credible-execution-timestamp",
    },
  };
}

export function validateAttestedStagingCorePredecessor({ proof, releaseSha, workerName }) {
  if (
    proof?.schemaVersion !== 1
    || proof?.target !== "staging"
    || proof?.liveAttested !== true
    || proof?.worker !== workerName
    || !SHA_PATTERN.test(String(proof?.sourceSha || ""))
    || String(proof.sourceSha).toLowerCase() === String(releaseSha).toLowerCase()
    || !UUID_PATTERN.test(String(proof?.versionId || ""))
    || !UUID_PATTERN.test(String(proof?.deploymentId || ""))
    || proof?.credentialsIncluded !== false
    || proof?.piiIncluded !== false
  ) {
    return rejected("staging-core-predecessor-not-attested");
  }

  return {
    passed: true,
    predecessor: {
      mode: String(proof.predecessorMode || ""),
      sourceSha: String(proof.sourceSha).toLowerCase(),
      versionId: String(proof.versionId).toLowerCase(),
      deploymentId: String(proof.deploymentId).toLowerCase(),
      worker: String(proof.worker),
    },
  };
}
