#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  acquireGlobalLease,
  buildLegacyLeaseRequest,
  checkGlobalLease,
  probeCoordinatorProtocol,
  proofForLease,
  releaseGlobalLease,
} from "./codex-global-coordination-client.mjs";
import { loadMergeCandidate } from "./codex-github-integration-candidate.mjs";

const FULL_SHA = /^[0-9a-f]{40}$/i;
function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredArgument(args, name) {
  const index = args.indexOf(name);
  const value = index === -1 ? "" : String(args[index + 1] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function apiUrl(repository, suffix = "") {
  return `https://api.github.com/repos/${repository}${suffix}`;
}

async function githubJson(repository, suffix, options = {}, tokenName = "GH_TOKEN") {
  const token = String(process.env[tokenName] || process.env.GH_TOKEN || "").trim();
  if (!token) throw new Error(`${tokenName} is required`);
  const response = await fetch(apiUrl(repository, suffix), {
    ...options,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const raw = await response.text();
  let body;
  try { body = raw ? JSON.parse(raw) : null; } catch { throw new Error(`GitHub API returned invalid JSON (${response.status})`); }
  if (!response.ok) throw new Error(`GitHub API request failed (${response.status}): ${String(body?.message || "unknown error")}`);
  return body;
}

function assertSha(value, label) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!FULL_SHA.test(normalized)) throw new Error(`${label} must be a full SHA`);
  return normalized;
}

const MERGE_METHODS = new Set(["squash"]);

async function setMergeAuthorityStatus(repository, headSha, state, description) {
  return githubJson(repository, `/statuses/${headSha}`, {
    method: "POST",
    body: JSON.stringify({
      state,
      context: "global-merge-authority",
      description: String(description).slice(0, 140),
      target_url: `${process.env.GITHUB_SERVER_URL || "https://github.com"}/${repository}/actions/workflows/global-merge-authority.yml`,
    }),
  }, "SKINCOS_STATUS_TOKEN");
}

function waitableLeaseReason(reason) {
  return ["resource-lease-held", "incompatible-release-lease"].includes(String(reason || ""));
}

export async function acquireMergeLease({ request, url, maxWaitMs = 15 * 60_000, pollMs = 15_000, acquireImpl = acquireGlobalLease }) {
  const deadline = Date.now() + maxWaitMs;
  let lastReason = "";
  while (Date.now() <= deadline) {
    const result = await acquireImpl({ request, url });
    if (result.passed === true && result.lease) return result;
    lastReason = String(result.reason || "unknown");
    if (!waitableLeaseReason(lastReason)) {
      throw new Error(`merge:main lease acquisition failed closed: ${lastReason}`);
    }
    if (Date.now() + pollMs > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`merge:main lease remained unavailable: ${lastReason || "unknown"}`);
}

async function mergePullRequestOnce({ repository, pullNumber, expectedHeadSha, mergeMethod = "squash" }) {
  if (String(process.env.SKINCOS_GLOBAL_COORDINATION_REQUIRED || "").trim().toLowerCase() !== "true") {
    throw new Error("SKINCOS_GLOBAL_COORDINATION_REQUIRED must be true for merge:main");
  }
  const url = requiredEnv("SKINCOS_GLOBAL_COORDINATOR_URL");
  requiredEnv("SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET");
  if (!MERGE_METHODS.has(mergeMethod)) throw new Error(`unsupported merge method: ${mergeMethod}`);
  const candidate = await loadMergeCandidate({ repository, pullNumber, expectedHeadSha });
  const initial = candidate.pull;
  const { headSha, baseSha, request, closure } = candidate;
  const coordinatorProtocol = await probeCoordinatorProtocol({ url });
  // A 404 is the explicit compatibility signal from the pre-readiness Worker;
  // any other unavailable or malformed response fails closed in the probe.
  const coordinationRequest = coordinatorProtocol.protocol === "legacy-v1"
    ? buildLegacyLeaseRequest(request)
    : request;
  // A required global-merge-authority status makes the PR appear blocked until
  // this authority posts its success status. GitHub's merge API remains the
  // final enforcement point for every other required check or review.
  if (initial.draft === true || initial.mergeable_state === "dirty") {
    throw new Error("pull request is not mergeable by its current GitHub state");
  }
  const resource = "merge:main";
  const result = await acquireMergeLease({ request: coordinationRequest, url });
  if (result.passed !== true || !result.lease) throw new Error(`merge:main lease acquisition failed: ${result.reason || "unknown"}`);
  const proof = proofForLease(result.lease);
  let merged;
  let mergeSucceeded = false;
  try {
    const [currentMain, currentPull] = await Promise.all([
      githubJson(repository, "/commits/main"),
      githubJson(repository, `/pulls/${pullNumber}`),
    ]);
    if (assertSha(currentMain?.sha, "current main SHA") !== baseSha) throw new Error("main advanced while merge:main was being acquired");
    if (
      currentPull.state !== "open"
      || currentPull.base?.ref !== "main"
      || assertSha(currentPull.base?.sha, "current pull request base SHA") !== baseSha
      || assertSha(currentPull.head?.sha, "current pull request head SHA") !== headSha
    ) throw new Error("pull request base or head changed before merge mutation");
    const checked = await checkGlobalLease({
      proof,
      url,
      authorization: {
        expectedResource: resource,
        expectedIntentDigest: proof.intentDigest,
        observedDependencyClosureDigest: closure.digest,
        expectedMainSha: baseSha,
      },
    });
    if (checked.passed !== true) throw new Error(`merge:main mutation authorization failed: ${checked.reason || "unknown"}`);
    await setMergeAuthorityStatus(repository, headSha, "success", "merge:main lease and dependency closure authorized");
    const [finalMain, finalPull] = await Promise.all([
      githubJson(repository, "/commits/main"),
      githubJson(repository, `/pulls/${pullNumber}`),
    ]);
    if (assertSha(finalMain?.sha, "final main SHA") !== baseSha) throw new Error("main advanced after merge authorization status");
    if (
      finalPull.state !== "open"
      || finalPull.base?.ref !== "main"
      || assertSha(finalPull.base?.sha, "final pull request base SHA") !== baseSha
      || assertSha(finalPull.head?.sha, "final pull request head SHA") !== headSha
    ) throw new Error("pull request base or head changed after merge authorization status");
    const finalLease = await checkGlobalLease({
      proof,
      url,
      authorization: {
        expectedResource: resource,
        expectedIntentDigest: proof.intentDigest,
        observedDependencyClosureDigest: closure.digest,
        expectedMainSha: baseSha,
      },
    });
    if (finalLease.passed !== true) throw new Error(`merge:main final mutation authorization failed: ${finalLease.reason || "unknown"}`);
    merged = await githubJson(repository, `/pulls/${pullNumber}/merge`, {
      method: "PUT",
      body: JSON.stringify({ sha: headSha, merge_method: mergeMethod }),
    });
    if (merged?.merged !== true) throw new Error(`GitHub did not merge the pull request: ${String(merged?.message || "unknown result")}`);
    mergeSucceeded = true;
    return {
      merged: true,
      pullNumber: String(pullNumber),
      mergeCommitSha: String(merged.sha || ""),
      resource,
      fencingToken: proof.fencingToken,
    };
  } catch (error) {
    if (!mergeSucceeded) {
      try {
        await setMergeAuthorityStatus(repository, headSha, "failure", "merge:main authorization did not complete");
      } catch {
        // Preserve the original failure; the lease release below remains mandatory.
      }
    }
    throw error;
  } finally {
    const released = await releaseGlobalLease({ proof, url });
    if (released.passed !== true) throw new Error(`merge:main lease release failed: ${released.reason || "unknown"}`);
  }
}

function retryableMergeDrift(error) {
  const message = String(error?.message || error || "");
  return [
    "main advanced while merge:main was being acquired",
    "main advanced after merge authorization status",
    "pull request base or head changed before merge mutation",
    "pull request base or head changed after merge authorization status",
  ].includes(message);
}

export async function mergePullRequest({
  repository,
  pullNumber,
  expectedHeadSha,
  mergeMethod = "squash",
  maxAttempts = 3,
  retryDelayMs = 5000,
}) {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw new Error("maxAttempts must be an integer between 1 and 5");
  }
  if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 60_000) {
    throw new Error("retryDelayMs must be an integer between 0 and 60000");
  }
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await mergePullRequestOnce({ repository, pullNumber, expectedHeadSha, mergeMethod });
    } catch (error) {
      lastError = error;
      if (!retryableMergeDrift(error) || attempt === maxAttempts) throw error;
      process.stderr.write(`merge:main observed concurrent base drift; retrying official authority attempt ${attempt + 1}/${maxAttempts}\n`);
      if (retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  throw lastError || new Error("merge:main authority exhausted without a result");
}

async function main(args) {
  const repository = requiredEnv("GITHUB_REPOSITORY");
  const pullNumber = requiredArgument(args, "--pull-number");
  if (!/^[1-9][0-9]*$/.test(pullNumber)) throw new Error("--pull-number must be numeric");
  const result = await mergePullRequest({
    repository,
    pullNumber,
    expectedHeadSha: requiredArgument(args, "--expected-head-sha"),
    mergeMethod: requiredArgument(args, "--merge-method"),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const invokedAsScript = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsScript) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
