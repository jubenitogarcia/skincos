import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

const flattenCheckRuns = (checks) => {
  if (Array.isArray(checks)) {
    return checks.flatMap((page) => Array.isArray(page?.check_runs) ? page.check_runs : []);
  }
  return Array.isArray(checks?.check_runs) ? checks.check_runs : [];
};

export function assessRequiredChecks({ pulls, checks, policy, releaseSha, repository }) {
  const sha = String(releaseSha || "").toLowerCase();
  const merged = (Array.isArray(pulls) ? pulls : []).filter((pr) =>
    pr?.base?.ref === "main"
    && pr?.state === "closed"
    && pr?.merged_at
    && String(pr?.merge_commit_sha || "").toLowerCase() === sha
    && String(pr?.head?.repo?.full_name || "") === repository,
  );

  if (merged.length !== 1) {
    return {
      state: "failed",
      reason: "immutable release SHA lacks exactly one canonical merged PR into main",
      mergedCount: merged.length,
    };
  }

  const byName = new Map();
  for (const run of flattenCheckRuns(checks)) {
    const name = String(run?.name || "");
    const current = byName.get(name);
    if (!current || (current.conclusion !== "success" && run.conclusion === "success")) {
      byName.set(name, run);
    }
  }

  const pending = [];
  const failed = [];
  for (const name of policy?.governance?.requiredChecks || []) {
    const run = byName.get(name);
    if (!run || run.status !== "completed") {
      pending.push(name);
    } else if (run.conclusion !== "success") {
      failed.push(`${name} (${run.conclusion || "no conclusion"})`);
    }
  }

  if (failed.length > 0) {
    return {
      state: "failed",
      reason: `required checks failed for immutable release SHA: ${failed.join(", ")}`,
      failed,
      pending,
    };
  }
  if (pending.length > 0) {
    return {
      state: "pending",
      reason: `required checks are not yet terminal for immutable release SHA: ${pending.join(", ")}`,
      pending,
    };
  }
  return { state: "passed", reason: "all required checks are successful for the immutable release SHA" };
}

function main() {
  const [pullsFile, checksFile] = process.argv.slice(2);
  if (!pullsFile || !checksFile) {
    throw new Error("usage: node ponto-required-checks.mjs <merged-pulls.json> <check-runs.json>");
  }

  const result = assessRequiredChecks({
    pulls: readJson(pullsFile),
    checks: readJson(checksFile),
    policy: readJson(path.join(root, ".github/governance/progressive-release-policy.json")),
    releaseSha: process.env.RELEASE_SHA,
    repository: process.env.GITHUB_REPOSITORY,
  });

  if (result.state === "passed") {
    console.log(result.reason);
    return;
  }
  console.error(result.reason);
  process.exitCode = result.state === "pending" ? 2 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
