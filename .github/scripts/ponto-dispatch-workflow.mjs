import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { matchesDispatchedRun } from "./ponto-dispatch-run-match.mjs";
import {
  assertDependencyClosureUnchanged,
  dependencyClosureForSource,
  lockScopeFor,
  normalizeResourceKey,
} from "../../scripts/codex-global-coordinator.mjs";
import {
  acquireGlobalLease,
  buildLeaseRequest,
  checkGlobalLease,
  proofForLease,
  releaseGlobalLease,
  renewGlobalLease,
} from "../../scripts/codex-global-coordination-client.mjs";
import {
  capabilityCheckName,
  capabilityExternalId,
  canonicalizeGovernedIntent,
  createCapabilityCheck,
  expectedGovernedRunName,
  resolveCapabilityVerifier,
  verifyCapabilityDocument,
} from "./ponto-orchestrator-lease.mjs";
import { assertPontoSourceClosureUnchanged } from "./ponto-source-closure.mjs";
import {
  readAndVerifyReleaseIdentity,
  releaseRefFor,
  releaseTagApiPath,
  releaseTagFor,
} from "./ponto-release-identity.mjs";

const FULL_SHA = /^[0-9a-f]{40}$/;

export const isBodylessResponseStatus = (status) => status === 202 || status === 204;
export const readGitHubResponse = (response) => (
  isBodylessResponseStatus(response.status) ? null : response.json()
);

export function resolvePontoCoordinatorIdentity({ releaseSha, workflowSha } = {}) {
  const immutableReleaseSha = String(releaseSha || "").trim().toLowerCase();
  const immutableWorkflowSha = String(workflowSha || "").trim().toLowerCase();
  if (!FULL_SHA.test(immutableReleaseSha)) {
    throw new Error("RELEASE_SHA must be a full immutable Ponto release SHA");
  }
  if (!FULL_SHA.test(immutableWorkflowSha)) {
    throw new Error("GITHUB_SHA must be a full immutable Ponto coordinator workflow SHA");
  }
  return {
    releaseSha: immutableReleaseSha,
    workflowSha: immutableWorkflowSha,
  };
}

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

export function assertPontoDependencyClosureUnchanged(orchestratorDigest, mainDigest) {
  return assertDependencyClosureUnchanged(orchestratorDigest, mainDigest);
}

export function assertPontoReleaseIsCurrentMain(
  releaseSha,
  currentMainSha,
  assertReleaseSource = assertPontoSourceClosureUnchanged,
) {
  const release = String(releaseSha || "").trim().toLowerCase();
  const currentMain = String(currentMainSha || "").trim().toLowerCase();
  if (!FULL_SHA.test(release)) throw new Error("Ponto release SHA must be a full SHA");
  if (!FULL_SHA.test(currentMain)) throw new Error("current main SHA is unavailable");
  if (release !== currentMain) {
    try {
      assertReleaseSource(release, currentMain);
    } catch (error) {
      throw new Error("Ponto release dependency closure no longer matches current main", { cause: error });
    }
  }
  return { releaseSha: release, currentMainSha: currentMain };
}

export function globalResourceFor(workflow, inputs) {
  const target = String(inputs?.target || "").trim().toLowerCase();
  const stage = String(inputs?.stage || inputs?.orchestrator_stage || "").trim().toLowerCase();
  const lifecycle = target || stage;
  const environment = target || stage;
  if (!["preview", "staging", "pilot", "canary", "production", "rollback"].includes(lifecycle)) return "";
  if (workflow === "deploy-timekeeping.yml" && inputs.release_scope === "ponto") return normalizeResourceKey("global:ponto-workers-writer");
  if (workflow === "deploy-core-workers.yml" && inputs.release_scope === "ponto" && ["api", "inventory", "all"].includes(inputs.unit)) {
    return normalizeResourceKey("global:ponto-workers-writer");
  }
  if (workflow === "deploy-crm-pages.yml" && inputs.release_scope === "ponto") return normalizeResourceKey("global:crm-cloudflare-writer");
  if (workflow === "cloudflare-workers-sync-ponto-secrets.yml") return normalizeResourceKey("global:ponto-workers-writer");
  if (workflow === "cloudflare-pages-sync-ponto.yml") return normalizeResourceKey("global:crm-cloudflare-writer");
  if (["timekeeping-staging-journey.yml", "ponto-staging-rollback-drill.yml", "ponto-production-baseline.yml", "ponto-production-slo.yml"].includes(workflow)) {
    return normalizeResourceKey(`release:ponto`);
  }
  if (workflow === "module-availability.yml" && inputs.module === "timekeeping") return normalizeResourceKey("release:ponto");
  return "";
}

function localCommitAvailable(commit) {
  try {
    execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], { cwd: path.resolve(import.meta.dirname, "../.."), stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function ensureCommitAvailable(commit) {
  if (localCommitAvailable(commit)) return;
  execFileSync("git", ["fetch", "--no-tags", "origin", commit], { cwd: path.resolve(import.meta.dirname, "../.."), stdio: "ignore" });
  if (!localCommitAvailable(commit)) throw new Error("current main commit could not be fetched for dependency-closure attestation");
}

function pontoDependencyClosureDigest(sourceCommit) {
  return dependencyClosureForSource({ module: "ponto", sourceCommit }).digest;
}

function globalCoordinationRequired() {
  const value = String(process.env.SKINCOS_GLOBAL_COORDINATION_REQUIRED || "").trim().toLowerCase();
  if (value && value !== "true" && value !== "false") throw new Error("SKINCOS_GLOBAL_COORDINATION_REQUIRED must be true or false");
  return value === "true";
}

function globalCoordinationOwner({ repository, correlation, workflow, stage, actor, runId }) {
  return {
    provider: "github",
    missionId: `github:${repository}:${correlation}`,
    threadId: `${workflow}:${correlation}:${stage || "preview"}`,
    actor: actor || "github-actions",
    runId,
  };
}

function sourceTreeForCommit(commit) {
  return execFileSync("git", ["rev-parse", `${commit}^{tree}`], {
    cwd: path.resolve(import.meta.dirname, "../.."),
    encoding: "utf8",
  }).trim().toLowerCase();
}

async function acquireGlobalDispatchLease({ resourceKey, workflow, inputs, repository, correlation, stage, actor, runId, sourceCommit, dependencyClosureDigest }) {
  if (!globalCoordinationRequired()) return null;
  if (!resourceKey) throw new Error(`global coordination resource is undefined for ${workflow}`);
  if (resourceKey === "release:ponto" && compositeCoordinationProofFile()) return null;
  const url = String(process.env.SKINCOS_GLOBAL_COORDINATOR_URL || "").trim();
  const secret = String(process.env.SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET || "").trim();
  if (!url || !secret) throw new Error("global coordination authority custody is unavailable");
  const owner = globalCoordinationOwner({ repository, correlation, workflow, stage, actor, runId });
  const intent = {
    module: "ponto",
    workflow,
    sourceCommit,
    sourceTree: sourceTreeForCommit(sourceCommit),
    dependencyClosureDigest,
    inputs,
  };
  const idempotencyKey = `ponto:${correlation}:${workflow}:${resourceKey}:${stage || "preview"}`;
  const request = buildLeaseRequest({
    operation: "mutation",
    resource: resourceKey,
    owner,
    intent,
    idempotencyKey,
    ttlMs: 900_000,
  });
  const result = await acquireGlobalLease({ request, url });
  if (result.passed !== true || !result.lease) {
    throw new Error(`global coordination lease acquisition failed: ${result.reason || "unknown"}`);
  }
  return {
    proof: proofForLease(result.lease),
    url,
    lastRenewedAt: Date.now(),
  };
}

async function revalidateGlobalDispatchLease(lease, { resourceKey, observedDependencyClosureDigest }) {
  if (!lease) return;
  if (Date.now() - lease.lastRenewedAt >= 5 * 60 * 1000) {
    const renewed = await renewGlobalLease({ proof: lease.proof, ttlMs: 900_000, url: lease.url });
    if (renewed.passed !== true || !renewed.lease) throw new Error(`global coordination lease renewal failed: ${renewed.reason || "unknown"}`);
    lease.proof = proofForLease(renewed.lease);
    lease.lastRenewedAt = Date.now();
  }
  const checked = await checkGlobalLease({
    proof: lease.proof,
    url: lease.url,
    authorization: {
      expectedResource: resourceKey,
      expectedIntentDigest: lease.proof.intentDigest,
      observedDependencyClosureDigest,
    },
  });
  if (checked.passed !== true) throw new Error(`global coordination mutation authorization failed: ${checked.reason || "unknown"}`);
}

async function releaseGlobalDispatchLease(lease) {
  if (!lease) return;
  const released = await releaseGlobalLease({ proof: lease.proof, url: lease.url });
  if (released.passed !== true) throw new Error(`global coordination lease release failed: ${released.reason || "unknown"}`);
}

function compositeCoordinationProofFile() {
  const value = String(process.env.PONTO_ORCHESTRATOR_COORDINATION_PROOF_FILE || "").trim();
  return value || null;
}

function writeCompositeCoordinationProof(file, lease) {
  const resolved = path.resolve(file);
  const repositoryRoot = path.resolve(import.meta.dirname, "../..");
  if (resolved === repositoryRoot || resolved.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new Error("Ponto composite coordination proof must remain outside the checkout");
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  const temporary = `${resolved}.tmp.${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(proofForLease(lease), null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, resolved);
}

async function revalidatePontoCompositeLease({ observedDependencyClosureDigest }) {
  if (!globalCoordinationRequired()) return false;
  const proofFile = compositeCoordinationProofFile();
  if (!proofFile) return false;
  const url = String(process.env.SKINCOS_GLOBAL_COORDINATOR_URL || "").trim();
  if (!url || !String(process.env.SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET || "").trim()) {
    throw new Error("global coordination authority custody is unavailable");
  }
  const proof = JSON.parse(fs.readFileSync(proofFile, "utf8"));
  if (proof.resource !== "release:ponto") throw new Error("Ponto composite proof resource is invalid");
  const renewed = await renewGlobalLease({ proof, ttlMs: 900_000, url });
  if (renewed.passed !== true || !renewed.lease) {
    throw new Error(`Ponto composite lease renewal failed: ${renewed.reason || "unknown"}`);
  }
  const renewedProof = proofForLease(renewed.lease);
  writeCompositeCoordinationProof(proofFile, renewed.lease);
  const checked = await checkGlobalLease({
    proof: renewedProof,
    url,
    authorization: {
      expectedResource: "release:ponto",
      expectedIntentDigest: renewedProof.intentDigest,
      observedDependencyClosureDigest,
    },
  });
  if (checked.passed !== true) {
    throw new Error(`Ponto composite coordination authorization failed: ${checked.reason || "unknown"}`);
  }
  return true;
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
const workflowSourceSha = String(process.env.GITHUB_SHA || "").trim().toLowerCase();
const configuredReleaseSha = String(process.env.RELEASE_SHA || "").trim().toLowerCase();
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
const {
  releaseSha: orchestratorHeadSha,
  workflowSha: coordinatorWorkflowSha,
} = resolvePontoCoordinatorIdentity({
  releaseSha: configuredReleaseSha,
  workflowSha: workflowSourceSha,
});
if (!Number.isFinite(configuredTimeoutMs) || configuredTimeoutMs < 5 * 60 * 1000 || configuredTimeoutMs > 90 * 60 * 1000) {
  throw new Error("PONTO_DISPATCH_TIMEOUT_MS must be between 5 and 90 minutes");
}
if (!token || !repository.includes("/")) {
  throw new Error("GH_TOKEN and GITHUB_REPOSITORY are required for immutable Ponto child dispatch");
}
try {
  assertPontoSourceClosureUnchanged(orchestratorHeadSha, coordinatorWorkflowSha);
} catch {
  throw new Error("Ponto coordinator workflow source is outside the immutable release dependency closure");
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

function immutablePontoReleaseIdentity(sourceCommit) {
  const file = String(process.env.PONTO_RELEASE_IDENTITY_FILE || "").trim();
  if (!file) throw new Error("Ponto child dispatch requires the immutable release identity file");
  const releaseTag = releaseTagFor("ponto", sourceCommit);
  const releaseRef = releaseRefFor("ponto", sourceCommit);
  let tagTarget;
  try {
    tagTarget = execFileSync("git", ["rev-parse", `${releaseRef}^{commit}`], {
      cwd: path.resolve(import.meta.dirname, "../.."),
      encoding: "utf8",
    }).trim().toLowerCase();
  } catch {
    throw new Error("immutable Ponto release ref is unavailable in the coordinator checkout");
  }
  const identity = readAndVerifyReleaseIdentity(file, {
    module: "ponto",
    sourceCommit,
    sourceTree: sourceTreeForCommit(sourceCommit),
    dependencyClosureDigest: pontoDependencyClosureDigest(sourceCommit),
    expectedReleaseTag: releaseTag,
    expectedReleaseRef: releaseRef,
    tagTarget,
  });
  const expectedDigest = String(process.env.PONTO_RELEASE_IDENTITY_DIGEST || "").trim().toLowerCase();
  if (!expectedDigest || expectedDigest !== identity.releaseIdentityDigest) {
    throw new Error("Ponto release identity digest is absent or differs from the immutable identity");
  }
  return { identity, releaseTag, releaseRef, file };
}

async function verifyRemotePontoReleaseRef({ repository, releaseTag, sourceCommit, request }) {
  const remote = await request(releaseTagApiPath(repository, releaseTag));
  if (
    remote?.ref !== `refs/tags/${releaseTag}`
    || remote?.object?.type !== "commit"
    || String(remote?.object?.sha || "").trim().toLowerCase() !== sourceCommit
  ) {
    throw new Error("remote immutable Ponto release ref does not point to the release SHA");
  }
}

const releaseIdentity = immutablePontoReleaseIdentity(orchestratorHeadSha);
await verifyRemotePontoReleaseRef({
  repository,
  releaseTag: releaseIdentity.releaseTag,
  sourceCommit: orchestratorHeadSha,
  request,
});

const cancelActiveChildBestEffort = async (candidate) => {
  if (!candidate || candidate.status === "completed") return;
  try {
    await request(`/repos/${repository}/actions/runs/${candidate.id}/cancel`, { method: "POST" });
  } catch {
    // The coordinator still fails closed; a missing cancellation response is
    // recorded by the failed parent run and never authorizes another mutation.
  }
};

const currentMain = await request(`/repos/${repository}/commits/main`);
const currentMainSha = String(currentMain?.sha || "").trim().toLowerCase();
assertPontoReleaseIsCurrentMain(orchestratorHeadSha, currentMainSha);
ensureCommitAvailable(currentMainSha);
await revalidatePontoCompositeLease({
  observedDependencyClosureDigest: pontoDependencyClosureDigest(orchestratorHeadSha),
});

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
  if (!["staging", "bootstrap", "pilot", "canary", "production", "rollback"].includes(orchestratorStage)) {
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
const pathMatchesRef = (actual, expected, ref) => actual === expected || actual === `${expected}@${ref}`;
const pathMatchesMainRef = (actual, expected) => pathMatchesRef(actual, expected, "refs/heads/main");
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
    || String(parentRun?.head_sha || "").trim().toLowerCase() !== coordinatorWorkflowSha
    || String(parentRun?.repository?.id || "") !== repositoryId
    || parentRun?.repository?.full_name !== repository
    || parentRun?.head_repository?.full_name !== repository
    || String(parentRun?.head_repository?.id || "") !== repositoryId
    || parentRun?.name !== `Ponto ${process.env.STAGE} ${orchestratorHeadSha} orchestrator=${correlation}`
    || parentRun?.display_title !== `Ponto ${process.env.STAGE} ${orchestratorHeadSha} orchestrator=${correlation}`
  ) throw new Error("active Ponto coordinator cannot issue a child-bound capability");
}
const globalResourceKey = globalResourceFor(workflow, normalizedIntent || inputs);
const globalDispatchLease = await acquireGlobalDispatchLease({
  resourceKey: globalResourceKey,
  workflow,
  inputs: normalizedIntent || inputs,
  repository,
  correlation,
  stage: String(process.env.STAGE || inputs.stage || inputs.target || "preview").trim().toLowerCase(),
  actor: String(process.env.GITHUB_ACTOR || "github-actions").trim(),
  runId: issuerRunId,
  sourceCommit: orchestratorHeadSha,
  dependencyClosureDigest: pontoDependencyClosureDigest(orchestratorHeadSha),
});
let globalDispatchLeaseReleased = false;
let compositeLeaseLastRenewedAt = Date.now();
try {
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
  headBranch: releaseIdentity.releaseTag,
  headSha: "",
  repository,
  url: "",
  dispatchRequestedAt,
  orchestratorRunId: correlation,
  dispatchNonce,
  leaseKey,
  resourceKey: globalResourceKey,
  lockScope: globalResourceKey
    ? lockScopeFor(globalResourceKey)
    : "",
  intentDigest,
  globalCoordination: globalDispatchLease ? {
    required: true,
    resourceKey: globalResourceKey,
    lockScope: lockScopeFor(globalResourceKey),
    fencingToken: globalDispatchLease.proof.fencingToken,
  } : { required: false },
  releaseRef: releaseIdentity.releaseRef,
  releaseTag: releaseIdentity.releaseTag,
  releaseIdentityDigest: releaseIdentity.identity.releaseIdentityDigest,
}, null, 2)}\n`, { mode: 0o600 });
  const dispatchMain = await request(`/repos/${repository}/commits/main`);
  const dispatchMainSha = String(dispatchMain?.sha || "").trim().toLowerCase();
  assertPontoReleaseIsCurrentMain(orchestratorHeadSha, dispatchMainSha);
  ensureCommitAvailable(dispatchMainSha);
  const dispatchClosureDigest = pontoDependencyClosureDigest(orchestratorHeadSha);
await revalidatePontoCompositeLease({ observedDependencyClosureDigest: dispatchClosureDigest });
compositeLeaseLastRenewedAt = Date.now();
await revalidateGlobalDispatchLease(globalDispatchLease, {
  resourceKey: globalResourceKey,
  observedDependencyClosureDigest: dispatchClosureDigest,
});
await verifyRemotePontoReleaseRef({
  repository,
  releaseTag: releaseIdentity.releaseTag,
  sourceCommit: orchestratorHeadSha,
  request,
});
await request(`/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    ref: releaseIdentity.releaseTag,
    inputs: Object.fromEntries(Object.entries(normalizedIntent || inputs).map(([name, value]) => [
      name,
      typeof value === "boolean" ? (value ? "true" : "false") : String(value),
    ])),
  }),
});
await releaseGlobalDispatchLease(globalDispatchLease);
globalDispatchLeaseReleased = true;

let run;
let persistedRunId = "";
let capabilityIssued = false;
let capabilityCheckId = 0;
let capabilityCheckAppId = 0;
while (Date.now() - startedAt < timeoutMs) {
  if (compositeCoordinationProofFile() && Date.now() - compositeLeaseLastRenewedAt >= 5 * 60 * 1000) {
    try {
      const observedMain = await request(`/repos/${repository}/commits/main`);
      const observedMainSha = String(observedMain?.sha || "").trim().toLowerCase();
      assertPontoReleaseIsCurrentMain(orchestratorHeadSha, observedMainSha);
      ensureCommitAvailable(observedMainSha);
      const observedClosureDigest = pontoDependencyClosureDigest(orchestratorHeadSha);
      await revalidatePontoCompositeLease({ observedDependencyClosureDigest: observedClosureDigest });
      compositeLeaseLastRenewedAt = Date.now();
    } catch (coordinationError) {
      await cancelActiveChildBestEffort(run);
      throw coordinationError;
    }
  }
  const payload = await request(`/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/runs?event=workflow_dispatch&per_page=100`);
  const matches = (payload.workflow_runs || [])
    .filter((item) => matchesDispatchedRun(item, {
      workflowId: workflowMetadata.id,
      expectedPath,
      expectedHeadBranch: releaseIdentity.releaseTag,
      orchestratorHeadSha,
      correlation,
      dispatchRequestedAt,
      expectedDisplayTitle: leaseKey
        ? expectedGovernedRunName(expectedPath, normalizedIntent)
        : undefined,
      dispatchNonce: leaseKey ? dispatchNonce : undefined,
      // The run must be created from the immutable tag and resolve to the
      // exact release SHA. Main drift is evaluated separately by closure.
      headShaMatches: (headSha) => String(headSha || "").trim().toLowerCase() === orchestratorHeadSha,
    }));
  if (matches.length > 1) {
    throw new Error(`dispatched ${workflow} correlation is ambiguous`);
  }
  run = matches[0];
  if (run && leaseKey && !capabilityIssued) {
    run = await request(`/repos/${repository}/actions/runs/${run.id}`);
    const childRunId = String(run.id);
    const expectedDisplayTitle = expectedGovernedRunName(expectedPath, normalizedIntent);
    const childHeadSha = String(run.head_sha || "").trim().toLowerCase();
    try {
      assertPontoSourceClosureUnchanged(orchestratorHeadSha, childHeadSha);
    } catch {
      throw new Error("dispatched Ponto child source closure differs from the immutable release");
    }
    if (
      run.workflow_id !== workflowMetadata.id
      || !pathMatchesRef(run.path, expectedPath, releaseIdentity.releaseRef)
      || run.run_attempt !== 1
      || run.status === "completed"
      || run.conclusion != null
      || run.event !== "workflow_dispatch"
      || run.head_branch !== releaseIdentity.releaseTag
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
      releaseRef: releaseIdentity.releaseRef,
      releaseTag: releaseIdentity.releaseTag,
      releaseIdentityDigest: releaseIdentity.identity.releaseIdentityDigest,
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
      releaseRef: releaseIdentity.releaseRef,
      releaseTag: releaseIdentity.releaseTag,
      releaseIdentityDigest: releaseIdentity.identity.releaseIdentityDigest,
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
  || !pathMatchesRef(run.path, expectedPath, releaseIdentity.releaseRef)
  || run.run_attempt !== 1
  || run.event !== "workflow_dispatch"
  || run.head_branch !== releaseIdentity.releaseTag
  || String(run.head_sha || "").trim().toLowerCase() !== orchestratorHeadSha
  || run.repository?.full_name !== repository
  || run.head_repository?.full_name !== repository
) {
  throw new Error(`${workflow} run ${run.id} failed provenance or success checks`);
}
try {
  assertPontoSourceClosureUnchanged(orchestratorHeadSha, String(run.head_sha || "").trim().toLowerCase());
} catch {
  throw new Error(`${workflow} run ${run.id} executed outside the immutable Ponto dependency closure`);
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
  releaseRef: releaseIdentity.releaseRef,
  releaseTag: releaseIdentity.releaseTag,
  releaseIdentityDigest: releaseIdentity.identity.releaseIdentityDigest,
  resourceKey: globalResourceKey,
  lockScope: globalResourceKey ? lockScopeFor(globalResourceKey) : "",
  globalCoordination: globalDispatchLease ? {
    required: true,
    fencingToken: globalDispatchLease.proof.fencingToken,
  } : { required: false },
};
fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, `${JSON.stringify(sanitized, null, 2)}\n`, { mode: 0o600 });
if (run.conclusion !== "success") {
  throw new Error(`${workflow} run ${run.id} completed with ${run.conclusion || "unknown"}`);
}
if (output) fs.appendFileSync(output, `run_id=${run.id}\nrun_url=${run.html_url}\n`);
process.stdout.write(`${workflow} completed successfully as run ${run.id}.\n`);
} finally {
  if (!globalDispatchLeaseReleased) await releaseGlobalDispatchLease(globalDispatchLease);
}
}

const invokedAsScript = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsScript) await main();
