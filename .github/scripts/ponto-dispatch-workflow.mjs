import fs from "node:fs";
import path from "node:path";
import { matchesDispatchedRun } from "./ponto-dispatch-run-match.mjs";

const [workflow, correlation, inputsFile, outputFile] = process.argv.slice(2);
const token = String(process.env.GH_TOKEN || "").trim();
const repository = String(process.env.GITHUB_REPOSITORY || "").trim();
const output = String(process.env.GITHUB_OUTPUT || "").trim();
const apiBase = String(process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
const orchestratorHeadSha = String(process.env.GITHUB_SHA || "").trim().toLowerCase();
const startedAt = Date.now();
const configuredTimeoutMs = Number(process.env.PONTO_DISPATCH_TIMEOUT_MS || 1_200_000);
const minimumTimeoutByWorkflow = {
  "timekeeping-staging-journey.yml": 35 * 60 * 1000,
  "ponto-staging-rollback-drill.yml": 65 * 60 * 1000,
};
const timeoutMs = Math.max(configuredTimeoutMs, minimumTimeoutByWorkflow[workflow] || 0);

if (!workflow || !/^[0-9]+$/.test(correlation || "") || !inputsFile || !outputFile) {
  throw new Error("usage: ponto-dispatch-workflow.mjs <workflow> <correlation-run-id> <inputs.json> <output.json>");
}
if (!Number.isFinite(configuredTimeoutMs) || configuredTimeoutMs < 5 * 60 * 1000 || configuredTimeoutMs > 90 * 60 * 1000) {
  throw new Error("PONTO_DISPATCH_TIMEOUT_MS must be between 5 and 90 minutes");
}
if (!token || !repository.includes("/") || !/^[0-9a-f]{40}$/.test(orchestratorHeadSha)) {
  throw new Error("GH_TOKEN, GITHUB_REPOSITORY, and immutable orchestrator GITHUB_SHA are required");
}

const request = async (pathname, init = {}) => {
  const response = await fetch(`${apiBase}${pathname}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${init.method || "GET"} ${pathname} returned ${response.status}`);
  return response.status === 204 ? null : response.json();
};

const inputs = JSON.parse(fs.readFileSync(inputsFile, "utf8"));
inputs.orchestrator_run_id = correlation;
const leaseKeyFor = () => {
  if (workflow === "deploy-timekeeping.yml") return "timekeeping";
  if (workflow === "deploy-core-workers.yml") {
    if (inputs.unit === "inventory") return "core-inventory";
    if (inputs.unit === "api") return "core-api";
  }
  if (workflow === "deploy-crm-pages.yml") return "pages";
  if (workflow === "cloudflare-workers-sync-ponto-secrets.yml") return "workers-secrets";
  if (workflow === "cloudflare-pages-sync-ponto.yml") return "pages-secrets";
  if (workflow === "timekeeping-staging-journey.yml") return "staging-journey";
  if (workflow === "ponto-staging-rollback-drill.yml") return "staging-rollback";
  if (workflow === "module-availability.yml" && ["canary", "active"].includes(inputs.state)) {
    return String(inputs.orchestrator_lease_key || "module-open");
  }
  return "";
};
const leaseKey = leaseKeyFor();
if (leaseKey) {
  const tokensFile = String(process.env.PONTO_LEASE_TOKENS_FILE || "").trim();
  if (!tokensFile || !fs.existsSync(tokensFile)) throw new Error(`single-use ${leaseKey} orchestrator capability is unavailable`);
  const leaseTokens = JSON.parse(fs.readFileSync(tokensFile, "utf8"));
  const leaseToken = String(leaseTokens?.[leaseKey] || "");
  if (!/^[A-Za-z0-9_-]{43}$/.test(leaseToken)) throw new Error(`single-use ${leaseKey} orchestrator capability is invalid`);
  const orchestratorStage = String(process.env.STAGE || "").trim().toLowerCase();
  if (!["staging", "pilot", "canary", "production", "rollback"].includes(orchestratorStage)) {
    throw new Error("governed child dispatch requires the exact orchestrator stage");
  }
  inputs.orchestrator_lease_token = leaseToken;
  inputs.orchestrator_stage = orchestratorStage;
  if (workflow === "module-availability.yml") {
    const orchestratorReleaseSha = String(process.env.RELEASE_SHA || "").trim().toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(orchestratorReleaseSha)) throw new Error("module transition requires the coordinator release SHA");
    inputs.orchestrator_release_sha = orchestratorReleaseSha;
  }
  if (workflow === "ponto-staging-rollback-drill.yml") {
    for (const [inputName, extraKey] of [
      ["rollback_incumbent_open_lease_token", "rollback-incumbent-open"],
      ["rollback_candidate_open_lease_token", "rollback-candidate-open"],
    ]) {
      const extraToken = String(leaseTokens?.[extraKey] || "");
      if (!/^[A-Za-z0-9_-]{43}$/.test(extraToken)) throw new Error(`single-use ${extraKey} orchestrator capability is invalid`);
      inputs[inputName] = extraToken;
    }
  }
}
const workflowMetadata = await request(`/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}`);
const expectedPath = `.github/workflows/${workflow}`;
if (
  workflowMetadata?.state !== "active"
  || workflowMetadata?.path !== expectedPath
  || !Number.isInteger(workflowMetadata?.id)
) {
  throw new Error(`${workflow} is not the active canonical workflow at ${expectedPath}`);
}
const dispatchRequestedAt = new Date().toISOString();
fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, `${JSON.stringify({
  schemaVersion: 1,
  workflow,
  workflowId: workflowMetadata.id,
  workflowPath: expectedPath,
  runId: "",
  status: "dispatch-requested",
  conclusion: "unknown",
  event: "workflow_dispatch",
  headBranch: "main",
  headSha: "",
  repository,
  url: "",
  dispatchRequestedAt,
}, null, 2)}\n`, { mode: 0o600 });
await request(`/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ ref: "main", inputs }),
});

let run;
let persistedRunId = "";
while (Date.now() - startedAt < timeoutMs) {
  const payload = await request(`/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/runs?event=workflow_dispatch&branch=main&per_page=50`);
  run = (payload.workflow_runs || [])
    .filter((item) => matchesDispatchedRun(item, {
      workflowId: workflowMetadata.id,
      expectedPath,
      orchestratorHeadSha,
      correlation,
      dispatchRequestedAt,
    }))
    .sort((a, b) => Number(b.id) - Number(a.id))[0];
  if (run && String(run.id) !== persistedRunId) {
    persistedRunId = String(run.id);
    fs.writeFileSync(outputFile, `${JSON.stringify({
      schemaVersion: 1,
      workflow,
      workflowId: workflowMetadata.id,
      workflowPath: expectedPath,
      runId: persistedRunId,
      status: run.status,
      conclusion: run.conclusion || "unknown",
      event: run.event,
      headBranch: run.head_branch,
      headSha: run.head_sha,
      repository,
      url: run.html_url,
    }, null, 2)}\n`, { mode: 0o600 });
  }
  if (run?.status === "completed") break;
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}

if (!run) throw new Error(`dispatched ${workflow} run was not observed before timeout`);
if (run.status !== "completed") {
  let cancellationError = "";
  try {
    await request(`/repos/${repository}/actions/runs/${run.id}/cancel`, { method: "POST" });
  } catch (error) {
    cancellationError = String(error?.message || error);
  }
  const cancellationDeadline = Date.now() + 120_000;
  while (Date.now() < cancellationDeadline) {
    run = await request(`/repos/${repository}/actions/runs/${run.id}`);
    fs.writeFileSync(outputFile, `${JSON.stringify({
      schemaVersion: 1,
      workflow,
      workflowId: workflowMetadata.id,
      workflowPath: expectedPath,
      runId: String(run.id),
      status: run.status,
      conclusion: run.conclusion || "unknown",
      event: run.event,
      headBranch: run.head_branch,
      headSha: run.head_sha,
      repository,
      url: run.html_url,
      cancellationRequested: true,
      cancellationError,
    }, null, 2)}\n`, { mode: 0o600 });
    if (run.status === "completed") break;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  if (run.status !== "completed") {
    throw new Error(`${workflow} run ${run.id} did not reach a terminal state after timeout cancellation`);
  }
}
if (
  run.workflow_id !== workflowMetadata.id
  || run.path !== `${expectedPath}@refs/heads/main`
  || run.head_sha !== orchestratorHeadSha
  || run.event !== "workflow_dispatch"
  || run.head_branch !== "main"
  || run.repository?.full_name !== repository
  || run.head_repository?.full_name !== repository
) {
  throw new Error(`${workflow} run ${run.id} failed provenance or success checks`);
}

const sanitized = {
  schemaVersion: 1,
  workflow,
  workflowId: workflowMetadata.id,
  workflowPath: expectedPath,
  runId: String(run.id),
  status: run.status,
  conclusion: run.conclusion,
  event: run.event,
  headBranch: run.head_branch,
  headSha: run.head_sha,
  repository,
  url: run.html_url,
};
fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, `${JSON.stringify(sanitized, null, 2)}\n`, { mode: 0o600 });
if (run.conclusion !== "success") {
  throw new Error(`${workflow} run ${run.id} completed with ${run.conclusion || "unknown"}`);
}
if (output) fs.appendFileSync(output, `run_id=${run.id}\nrun_url=${run.html_url}\n`);
process.stdout.write(`${workflow} completed successfully as run ${run.id}.\n`);
