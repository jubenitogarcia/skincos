#!/usr/bin/env node
import { loadMergeCandidate, githubJson } from "./codex-github-integration-candidate.mjs";
import { evaluateGlobalGate } from "./codex-global-coordination-client.mjs";

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function argument(args, name, fallback = null) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

async function setStatus(repository, sha, state, description) {
  return githubJson(repository, `/statuses/${sha}`, {
    method: "POST",
    body: JSON.stringify({
      state,
      context: "skincos-integration-gate",
      description: String(description).slice(0, 140),
      target_url: `${process.env.GITHUB_SERVER_URL || "https://github.com"}/${repository}/actions/workflows/skincos-integration-gate.yml`,
    }),
  });
}

function isWaitable(result) {
  return ["resource-lease-held", "incompatible-release-lease"].includes(String(result?.reason || ""));
}

export async function runIntegrationGate({ repository, pullNumber, expectedHeadSha, maxWaitMs = 15 * 60_000, pollMs = 15_000 }) {
  if (String(process.env.SKINCOS_GLOBAL_COORDINATION_REQUIRED || "").trim().toLowerCase() !== "true") {
    throw new Error("SKINCOS_GLOBAL_COORDINATION_REQUIRED must be true for the integration gate");
  }
  const candidate = await loadMergeCandidate({ repository, pullNumber, expectedHeadSha });
  await setStatus(repository, candidate.headSha, "pending", "Waiting for compatible global resource ownership before main integration.");
  const deadline = Date.now() + maxWaitMs;
  let lastReason = "";
  while (Date.now() <= deadline) {
    const result = await evaluateGlobalGate({
      request: candidate.request,
      url: requiredEnv("SKINCOS_GLOBAL_COORDINATOR_URL"),
    });
    lastReason = String(result.reason || "unknown");
    if (result.passed === true) {
      await setStatus(repository, candidate.headSha, "success", "No incompatible global release or merge lease is active.");
      return { passed: true, reason: lastReason, changedPaths: candidate.changedPaths };
    }
    if (!isWaitable(result)) {
      throw new Error(`global integration gate failed closed: ${lastReason}`);
    }
    if (Date.now() + pollMs > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`global integration gate remained pending on ${lastReason || "an active global lease"}`);
}

async function main(args) {
  const repository = requiredEnv("GITHUB_REPOSITORY");
  const pullNumber = argument(args, "--pull-number");
  const expectedHeadSha = argument(args, "--expected-head-sha");
  const maxWaitMs = Number(argument(args, "--max-wait-ms", "900000"));
  const pollMs = Number(argument(args, "--poll-ms", "15000"));
  if (!Number.isInteger(maxWaitMs) || maxWaitMs < 15_000 || maxWaitMs > 30 * 60_000) throw new Error("--max-wait-ms is outside the safe bounds");
  if (!Number.isInteger(pollMs) || pollMs < 5_000 || pollMs > 60_000) throw new Error("--poll-ms is outside the safe bounds");
  try {
    const result = await runIntegrationGate({ repository, pullNumber, expectedHeadSha, maxWaitMs, pollMs });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      const candidate = await loadMergeCandidate({ repository, pullNumber, expectedHeadSha });
      await setStatus(repository, candidate.headSha, "failure", message);
    } catch {
      // Preserve the original fail-closed error when the PR itself advanced or
      // GitHub status custody is unavailable.
    }
    throw error;
  }
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
