import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { matchesDispatchedRun } from "./ponto-dispatch-run-match.mjs";
import {
  capabilityCheckName,
  capabilityExternalId,
  canonicalizeGovernedIntent,
  createCapabilityCheck,
  expectedGovernedRunName,
  resolveCapabilityVerifier,
  verifyCapabilityDocument,
} from "./ponto-orchestrator-lease.mjs";

export const isBodylessResponseStatus = (status) => status === 202 || status === 204;
export const readGitHubResponse = (response) => (
  isBodylessResponseStatus(response.status) ? null : response.json()
);

export const minimumDispatchTimeoutMsByWorkflow = Object.freeze({
  "timekeeping-staging-journey.yml": 35 * 60 * 1000,
  "ponto-staging-rollback-drill.yml": 65 * 60 * 1000,
  // The protected preflight and 30-minute clinic job are sequential, while
  // environment review and runner admission can consume additional wall time.
  "ponto-production-slo.yml": 65 * 60 * 1000,
});

export const dispatchTimeoutMsFor = (workflow, configuredTimeoutMs) => Math.max(
  configuredTimeoutMs,
  minimumDispatchTimeoutMsByWorkflow[workflow] || 0,
);

export function assertMainShaUnchanged(orchestratorSha, mainSha) {
  const expected = String(orchestratorSha || "").trim().toLowerCase();
  const observed = String(mainSha || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(expected) || observed !== expected) {
    throw new Error("main advanced after the immutable Ponto coordinator was selected");
  }
  return expected;
}

export function governedLeaseKeyFor(workflow, inputs) {
  if (workflow === "deploy-timekeeping.yml" && inputs.target !== "preview") return "timekeeping";
  if (
    workflow === "deploy-core-workers.yml"
    && inputs.release_scope === "ponto"
    && inputs.target !== "preview"
  ) {
    if (inputs.unit === "inventory") return "core-inventory";
    if (inputs.unit === "api") return "core-api";
    throw new Error("governed Ponto Core dispatch requires unit api or inventory");
  }
  if (
    workflow === "deploy-crm-pages.yml"
    && inputs.release_scope === "ponto"
    && inputs.target !== "preview"
  ) return "pages";
  if (workflow === "cloudflare-workers-sync-ponto-secrets.yml") return "workers-secrets";
  if (workflow === "cloudflare-pages-sync-ponto.yml") return "pages-secrets";
  if (workflow === "timekeeping-staging-journey.yml") return "staging-journey";
  if (workflow === "ponto-staging-rollback-drill.yml") return "staging-rollback";
  if (workflow === "ponto-production-baseline.yml") return "production-baseline";
  if (workflow === "ponto-production-slo.yml") return "production-slo";
  if (
    workflow === "module-availability.yml"
    && inputs.module === "timekeeping"
    && ["canary", "active"].includes(inputs.state)
    && String(inputs.orchestrator_run_id || "") !== ""
  ) return String(inputs.orchestrator_lease_key || "module-open");
  return "";
}

export function verifyConsumedCapabilityCheck({
  checkRuns,
  detail,
  expectedCheckId,
  expectedAppId,
  checkName,
  externalId,
  releaseSha,
  documentClaims,
}) {
  const named = (checkRuns || []).filter((candidate) => candidate?.name === checkName);
  if (named.length !== 1) {
    throw new Error("Ponto child capability check is absent or ambiguous at completion");
  }
  const listed = named[0];
  for (const candidate of [listed, detail]) {
    if (
      candidate?.id !== expectedCheckId
      || candidate?.name !== checkName
      || candidate?.external_id !== externalId
      || candidate?.head_sha !== releaseSha
      || candidate?.status !== "completed"
      || candidate?.conclusion !== "success"
      || candidate?.app?.slug !== "github-actions"
      || candidate?.app?.id !== expectedAppId
    ) {
      throw new Error("Ponto child capability check did not finish as the exact consumed subject");
    }
  }
  let document;
  try {
    document = JSON.parse(String(detail?.output?.summary || ""));
  } catch {
    throw new Error("Ponto child capability consumed document is malformed");
  }
  verifyCapabilityDocument(document, {
    ...documentClaims,
    state: "consumed",
  });
  return {
    checkId: expectedCheckId,
    state: document.transition.state,
    transitionedAt: document.transition.transitionedAt,
  };
}

async function main() {
const [workflow, correlation, inputsFile, outputFile] = process.argv.slice(2);
const token = String(process.env.GH_TOKEN || "").trim();
const repository = String(process.env.GITHUB_REPOSITORY || "").trim();
const output = String(process.env.GITHUB_OUTPUT || "").trim();
const apiBase = String(process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
const orchestratorHeadSha = String(process.env.GITHUB_SHA || "").trim().toLowerCase();
const repositoryId = String(process.env.GITHUB_REPOSITORY_ID || "").trim();
const capabilityPrivateKey = String(process.env.PONTO_ORCHESTRATOR_CAPABILITY_PRIVATE_KEY || "");
const capabilityPublicKeysJson = String(
  process.env.PONTO_ORCHESTRATOR_CAPABILITY_PUBLIC_KEYS_JSON || "",
);
const issuerRunId = String(process.env.GITHUB_RUN_ID || "").trim();
const issuerRunAttempt = String(process.env.GITHUB_RUN_ATTEMPT || "").trim();
const startedAt = Date.now();
const configuredTimeoutMs = Number(process.env.PONTO_DISPATCH_TIMEOUT_MS || 1_200_000);
const timeoutMs = dispatchTimeoutMsFor(workflow, configuredTimeoutMs);

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
  return readGitHubResponse(response);
};

const currentMain = await request(`/repos/${repository}/commits/main`);
assertMainShaUnchanged(orchestratorHeadSha, currentMain?.sha);

const inputs = JSON.parse(fs.readFileSync(inputsFile, "utf8"));
inputs.orchestrator_run_id = correlation;
const leaseKey = governedLeaseKeyFor(workflow, inputs);
let dispatchNonce = "";
let intentDigest = "";
let normalizedIntent;
let capabilityTarget = "";
let capabilityVerifier;
if (leaseKey) {
  const orchestratorStage = String(process.env.STAGE || "").trim().toLowerCase();
  if (!["staging", "pilot", "canary", "production", "rollback"].includes(orchestratorStage)) {
    throw new Error("governed child dispatch requires the exact orchestrator stage");
  }
  capabilityTarget = orchestratorStage === "staging" ? "staging" : "production";
  if (
    !/^[1-9][0-9]*$/.test(repositoryId)
    || !capabilityPrivateKey
    || !capabilityPublicKeysJson
  ) {
    throw new Error("target-bound Ponto Ed25519 capability custody is unavailable");
  }
  capabilityVerifier = resolveCapabilityVerifier(capabilityPublicKeysJson, capabilityTarget);
  if (issuerRunId !== correlation || issuerRunAttempt !== "1") {
    throw new Error("root Ponto dispatcher must be the exact first-attempt coordinator");
  }
  inputs.orchestrator_stage = orchestratorStage;
  inputs.orchestrator_issuer_run_id = issuerRunId;
  dispatchNonce = crypto.randomBytes(16).toString("hex");
  inputs.orchestrator_nonce = dispatchNonce;
  if (workflow === "module-availability.yml") {
    const orchestratorReleaseSha = String(process.env.RELEASE_SHA || "").trim().toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(orchestratorReleaseSha)) throw new Error("module transition requires the coordinator release SHA");
    inputs.orchestrator_release_sha = orchestratorReleaseSha;
  }
  const canonical = canonicalizeGovernedIntent(`.github/workflows/${workflow}`, inputs);
  intentDigest = canonical.digest;
  normalizedIntent = canonical.normalizedInputs;
  const inputTarget = String(normalizedIntent.target || "");
  if (
    inputTarget
    && (inputTarget === "staging" ? "staging" : "production") !== capabilityTarget
  ) throw new Error("governed child target differs from target-bound signing custody");
}
const workflowMetadata = await request(`/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}`);
const expectedPath = `.github/workflows/${workflow}`;
const pathMatchesMainRef = (actual, expected) => actual === expected || actual === `${expected}@refs/heads/main`;
if (
  workflowMetadata?.state !== "active"
  || workflowMetadata?.path !== expectedPath
  || !Number.isInteger(workflowMetadata?.id)
) {
  throw new Error(`${workflow} is not the active canonical workflow at ${expectedPath}`);
}
const dispatchRequestedAt = new Date().toISOString();
let parentWorkflow;
let parentRun;
if (leaseKey) {
  [parentWorkflow, parentRun] = await Promise.all([
    request(`/repos/${repository}/actions/workflows/ponto-progressive-release.yml`),
    request(`/repos/${repository}/actions/runs/${correlation}`),
  ]);
  if (
    parentWorkflow?.state !== "active"
    || parentWorkflow?.path !== ".github/workflows/ponto-progressive-release.yml"
    || parentRun?.workflow_id !== parentWorkflow.id
    || String(parentRun?.id || "") !== correlation
    || !pathMatchesMainRef(parentRun?.path, parentWorkflow.path)
    || parentRun?.run_attempt !== 1
    || parentRun?.status !== "in_progress"
    || parentRun?.conclusion != null
    || parentRun?.event !== "workflow_dispatch"
    || parentRun?.head_branch !== "main"
    || parentRun?.head_sha !== orchestratorHeadSha
    || String(parentRun?.repository?.id || "") !== repositoryId
    || parentRun?.repository?.full_name !== repository
    || parentRun?.head_repository?.full_name !== repository
    || String(parentRun?.head_repository?.id || "") !== repositoryId
    || parentRun?.name !== `Ponto ${process.env.STAGE} ${orchestratorHeadSha} orchestrator=${correlation}`
    || parentRun?.display_title !== `Ponto ${process.env.STAGE} ${orchestratorHeadSha} orchestrator=${correlation}`
  ) throw new Error("active Ponto coordinator cannot issue a child-bound capability");
}
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
  orchestratorRunId: correlation,
  dispatchNonce,
  leaseKey,
  intentDigest,
}, null, 2)}\n`, { mode: 0o600 });
await request(`/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    ref: "main",
    inputs: Object.fromEntries(Object.entries(normalizedIntent || inputs).map(([name, value]) => [
      name,
      typeof value === "boolean" ? (value ? "true" : "false") : String(value),
    ])),
  }),
});

let run;
let persistedRunId = "";
let capabilityIssued = false;
let capabilityCheckId = 0;
let capabilityCheckAppId = 0;
while (Date.now() - startedAt < timeoutMs) {
  const payload = await request(`/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/runs?event=workflow_dispatch&branch=main&per_page=50`);
  const matches = (payload.workflow_runs || [])
    .filter((item) => matchesDispatchedRun(item, {
      workflowId: workflowMetadata.id,
      expectedPath,
      orchestratorHeadSha,
      correlation,
      dispatchRequestedAt,
      expectedDisplayTitle: leaseKey
        ? expectedGovernedRunName(expectedPath, normalizedIntent)
        : undefined,
      dispatchNonce: leaseKey ? dispatchNonce : undefined,
    }));
  if (matches.length > 1) {
    throw new Error(`dispatched ${workflow} correlation is ambiguous`);
  }
  run = matches[0];
  if (run && leaseKey && !capabilityIssued) {
    run = await request(`/repos/${repository}/actions/runs/${run.id}`);
    const childRunId = String(run.id);
    const expectedDisplayTitle = expectedGovernedRunName(expectedPath, normalizedIntent);
    if (
      run.workflow_id !== workflowMetadata.id
      || !pathMatchesMainRef(run.path, expectedPath)
      || run.run_attempt !== 1
      || run.status === "completed"
      || run.conclusion != null
      || run.event !== "workflow_dispatch"
      || run.head_branch !== "main"
      || run.head_sha !== orchestratorHeadSha
      || run.name !== expectedDisplayTitle
      || run.display_title !== expectedDisplayTitle
      || String(run?.repository?.id || "") !== repositoryId
      || run?.repository?.full_name !== repository
      || String(run?.head_repository?.id || "") !== repositoryId
      || run?.head_repository?.full_name !== repository
    ) throw new Error("dispatched Ponto child is not an active first-attempt capability subject");
    const checkName = capabilityCheckName(leaseKey, childRunId, dispatchNonce);
    const externalId = capabilityExternalId(
      correlation,
      issuerRunId,
      childRunId,
      leaseKey,
      dispatchNonce,
      intentDigest,
    );
    const before = await request(`/repos/${repository}/commits/${orchestratorHeadSha}/check-runs?check_name=${encodeURIComponent(checkName)}&filter=all&per_page=100`);
    if ((before?.check_runs || []).some(candidate => candidate?.name === checkName)) {
      throw new Error(`duplicate Ponto child capability check exists for run ${childRunId}`);
    }
    const payload = createCapabilityCheck({
      privateKey: capabilityPrivateKey,
      keyId: capabilityVerifier.keyId,
      repositoryId,
      repository,
      parentWorkflowId: parentWorkflow.id,
      parentWorkflowPath: parentWorkflow.path,
      parentRunId: correlation,
      issuerWorkflowId: parentWorkflow.id,
      issuerWorkflowPath: parentWorkflow.path,
      issuerRunId,
      childWorkflowId: workflowMetadata.id,
      childWorkflowPath: expectedPath,
      childRunId,
      leaseKey,
      stage: String(process.env.STAGE || "").trim().toLowerCase(),
      target: capabilityTarget,
      releaseSha: orchestratorHeadSha,
      dispatchNonce,
      intentDigest,
    });
    const created = await request(`/repos/${repository}/check-runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (
      !Number.isInteger(created?.id)
      || created?.name !== checkName
      || created?.external_id !== externalId
      || created?.head_sha !== orchestratorHeadSha
      || created?.status !== "in_progress"
      || created?.conclusion != null
      || created?.app?.slug !== "github-actions"
      || !Number.isInteger(created?.app?.id)
    ) throw new Error("Ponto child capability check creation was not attested");
    verifyCapabilityDocument(
      JSON.parse(String(payload.output.summary || "")),
      {
        publicKey: capabilityVerifier.publicKey,
        keyId: capabilityVerifier.keyId,
        repositoryId,
        repository,
        parentWorkflowId: parentWorkflow.id,
        parentWorkflowPath: parentWorkflow.path,
        parentRunId: correlation,
        issuerWorkflowId: parentWorkflow.id,
        issuerWorkflowPath: parentWorkflow.path,
        issuerRunId,
        childWorkflowId: workflowMetadata.id,
        childWorkflowPath: expectedPath,
        childRunId,
        leaseKey,
        stage: String(process.env.STAGE || "").trim().toLowerCase(),
        target: capabilityTarget,
        releaseSha: orchestratorHeadSha,
        dispatchNonce,
        intentDigest,
      },
    );
    const after = await request(`/repos/${repository}/commits/${orchestratorHeadSha}/check-runs?check_name=${encodeURIComponent(checkName)}&filter=all&per_page=100`);
    const exact = (after?.check_runs || []).filter(candidate =>
      candidate?.name === checkName
      && candidate?.external_id === externalId
      && candidate?.app?.slug === "github-actions");
    if (exact.length !== 1 || exact[0]?.id !== created.id) {
      throw new Error("Ponto child capability check is absent or ambiguous after creation");
    }
    capabilityCheckId = created.id;
    capabilityCheckAppId = created.app.id;
    capabilityIssued = true;
  }
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
  || !pathMatchesMainRef(run.path, expectedPath)
  || run.run_attempt !== 1
  || run.head_sha !== orchestratorHeadSha
  || run.event !== "workflow_dispatch"
  || run.head_branch !== "main"
  || run.repository?.full_name !== repository
  || run.head_repository?.full_name !== repository
) {
  throw new Error(`${workflow} run ${run.id} failed provenance or success checks`);
}
if (leaseKey && (
  String(run.id) !== persistedRunId
  || run.name !== expectedGovernedRunName(expectedPath, normalizedIntent)
  || run.display_title !== expectedGovernedRunName(expectedPath, normalizedIntent)
  || String(run?.repository?.id || "") !== repositoryId
  || run?.repository?.full_name !== repository
  || String(run?.head_repository?.id || "") !== repositoryId
  || run?.head_repository?.full_name !== repository
)) {
  throw new Error(`${workflow} run ${run.id} is not the exact governed capability subject at completion`);
}
if (leaseKey && run.conclusion === "success") {
  if (!capabilityIssued || !capabilityCheckId || !capabilityCheckAppId) {
    throw new Error(`${workflow} run ${run.id} succeeded without an issued child capability`);
  }
  const checkName = capabilityCheckName(leaseKey, String(run.id), dispatchNonce);
  const externalId = capabilityExternalId(
    correlation,
    issuerRunId,
    String(run.id),
    leaseKey,
    dispatchNonce,
    intentDigest,
  );
  const checks = await request(`/repos/${repository}/commits/${orchestratorHeadSha}/check-runs?check_name=${encodeURIComponent(checkName)}&filter=all&per_page=100`);
  const detail = await request(`/repos/${repository}/check-runs/${capabilityCheckId}`);
  verifyConsumedCapabilityCheck({
    checkRuns: checks?.check_runs,
    detail,
    expectedCheckId: capabilityCheckId,
    expectedAppId: capabilityCheckAppId,
    checkName,
    externalId,
    releaseSha: orchestratorHeadSha,
    documentClaims: {
      publicKey: capabilityVerifier.publicKey,
      keyId: capabilityVerifier.keyId,
      repositoryId,
      repository,
      parentWorkflowId: parentWorkflow.id,
      parentWorkflowPath: parentWorkflow.path,
      parentRunId: correlation,
      issuerWorkflowId: parentWorkflow.id,
      issuerWorkflowPath: parentWorkflow.path,
      issuerRunId,
      childWorkflowId: workflowMetadata.id,
      childRunId: String(run.id),
      leaseKey,
      stage: String(process.env.STAGE || "").trim().toLowerCase(),
      target: capabilityTarget,
      releaseSha: orchestratorHeadSha,
      childWorkflowPath: expectedPath,
      dispatchNonce,
      intentDigest,
    },
  });
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
}

const invokedAsScript = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsScript) await main();
