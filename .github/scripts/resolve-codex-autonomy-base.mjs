import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const FULL_SHA = /^[0-9a-f]{40}$/;
const ZERO_SHA = /^0{40}$/;

function runGit(args, { cwd, environment = process.env, allowFailure = false }) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: environment });
  if (result.error) throw new Error(`Unable to run git ${args[0]}`);
  if (result.status !== 0 && !allowFailure) throw new Error(`git ${args[0]} failed`);
  return {
    ok: result.status === 0,
    stdout: result.stdout.trim(),
  };
}

function isCommit(sha, cwd, environment) {
  return runGit(["cat-file", "-e", `${sha}^{commit}`], { cwd, environment, allowFailure: true }).ok;
}

function isAncestor(base, head, cwd, environment) {
  return runGit(["merge-base", "--is-ancestor", base, head], { cwd, environment, allowFailure: true }).ok;
}

function isUsableEventBase(sha, head, cwd, environment) {
  return FULL_SHA.test(sha)
    && !ZERO_SHA.test(sha)
    && isCommit(sha, cwd, environment)
    && isAncestor(sha, head, cwd, environment);
}

export function resolveCodexAutonomyBase({
  eventName,
  headSha,
  prBaseSha = "",
  beforeSha = "",
  manualBaseSha = "",
  cwd = process.cwd(),
  environment = process.env,
}) {
  if (!FULL_SHA.test(headSha)) throw new Error("GITHUB_SHA must be a full commit SHA");

  // Do not rely on checkout's remote-tracking ref: it can be stale after a
  // force-push event even when checkout fetched the complete object history.
  runGit(["fetch", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main"], { cwd, environment });
  if (!isCommit(headSha, cwd, environment)) throw new Error("GITHUB_SHA must identify the checked-out commit");
  if (runGit(["rev-parse", "HEAD"], { cwd, environment }).stdout !== headSha) {
    throw new Error("GITHUB_SHA must match the checked-out commit");
  }

  if (eventName === "workflow_dispatch") {
    if (!FULL_SHA.test(manualBaseSha)) {
      throw new Error("Manual governance base_sha must be a full commit SHA");
    }
    if (!isCommit(manualBaseSha, cwd, environment)) {
      throw new Error("Manual governance base_sha must identify a commit");
    }
    if (!isAncestor(manualBaseSha, headSha, cwd, environment)) {
      throw new Error("Manual governance base_sha must be an ancestor of the checked-out head");
    }
    return manualBaseSha;
  }

  const eventBase = prBaseSha || beforeSha;
  if (isUsableEventBase(eventBase, headSha, cwd, environment)) return eventBase;

  const base = runGit(["merge-base", "origin/main", headSha], { cwd, environment }).stdout;
  if (!FULL_SHA.test(base)) throw new Error("Unable to derive a common base from origin/main and HEAD");
  return base;
}

function main() {
  const output = process.env.GITHUB_OUTPUT;
  if (!output) throw new Error("GITHUB_OUTPUT is required");
  const base = resolveCodexAutonomyBase({
    eventName: process.env.GITHUB_EVENT_NAME,
    headSha: process.env.GITHUB_SHA,
    prBaseSha: process.env.PR_BASE_SHA,
    beforeSha: process.env.BEFORE_SHA,
    manualBaseSha: process.env.MANUAL_BASE_SHA,
  });
  appendFileSync(output, `sha=${base}\n`, "utf8");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`::error::${error.message}\n`);
    process.exitCode = 1;
  }
}
