#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { classifyFiles, parseGitNameStatus } from "./codex-autonomy-lib.mjs";
import { githubJson, loadMergeCandidate } from "./codex-github-integration-candidate.mjs";
import { mergePullRequest } from "./codex-global-merge-authority.mjs";
import { assertNativeGateEvidence, nativeChangedPathsDigest, nativeGatePlan } from "./codex-native-merge-contract.mjs";
import { createNativeCandidateSnapshot, runInNativeCandidateSandbox } from "./codex-native-merge-sandbox.mjs";
import { nativeGit } from "./codex-native-git-worktree.mjs";
import { persistNativeMergeReceipt } from "./codex-native-merge-receipt.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const FULL_SHA = /^[0-9a-f]{40}$/;

function requiredArgument(args, name) {
  const index = args.indexOf(name);
  const value = index < 0 ? "" : String(args[index + 1] || "").trim();
  if (!value || value.startsWith("--")) throw new Error(`${name} is required`);
  return value;
}

function git(cwd, ...args) {
  return nativeGit(cwd, ...args);
}

function exactSha(value, label) {
  const sha = String(value || "").trim().toLowerCase();
  if (!FULL_SHA.test(sha)) throw new Error(`${label} must be a full commit SHA`);
  return sha;
}

function candidateCheckout(root, expectedHeadSha) {
  const resolved = fs.realpathSync(root);
  if (git(resolved, "rev-parse", "--show-toplevel") !== resolved) {
    throw new Error("native merge candidate path must be the Git worktree root");
  }
  if (git(resolved, "rev-parse", "HEAD") !== expectedHeadSha) {
    throw new Error("native merge candidate checkout is not the exact PR head SHA");
  }
  if (git(resolved, "status", "--porcelain", "--untracked-files=normal")) {
    throw new Error("native merge candidate checkout must be clean");
  }
  return resolved;
}

function command(source, commands, label, executable, args) {
  runInNativeCandidateSandbox({ source, executable, args, label });
  commands.push({ label, executable, args, result: "passed" });
}

function staticParse(root, changedPaths, commands) {
  for (const relative of changedPaths) {
    const absolute = path.resolve(root, relative);
    if (!absolute.startsWith(`${root}${path.sep}`)) throw new Error("native merge changed path escaped candidate checkout");
    if (!fs.existsSync(absolute)) continue;
    const entry = fs.lstatSync(absolute);
    if (entry.isSymbolicLink() || !entry.isFile()) continue;
    if (/\.(?:mjs|cjs|js)$/i.test(relative)) command(root, commands, `syntax ${relative}`, "node", ["--check", relative]);
    if (/\.json$/i.test(relative)) JSON.parse(fs.readFileSync(absolute, "utf8"));
  }
}

function runPlannedCheck(id, { root, baseSha, headSha, changedPaths, commands }) {
  if (id === "diff-check") return command(root, commands, id, "git", ["diff", "--check", `${baseSha}...${headSha}`]);
  if (id === "static-parse") return staticParse(root, changedPaths, commands);
  if (id === "baseline-contract") return command(root, commands, id, "node", ["--test", "scripts/tests/codex-autonomy-baseline.test.mjs"]);
  if (id === "coordination-contract") return command(root, commands, id, "node", ["--test", "scripts/tests/codex-global-coordination.test.mjs", "scripts/tests/codex-global-coordination-client.test.mjs", "ops/cloudflare/global-coordinator/index.test.mjs"]);
  if (id === "supervisor-contract") return command(root, commands, id, "python3", ["-m", "unittest", "discover", "-s", ".codex/hooks/tests", "-p", "test_skincos_supervisor_gate.py", "-v"]);
  if (id === "release-manifest-contract") {
    return command(root, commands, id, "sh", ["-ec", "node scripts/codex-release-manifest.mjs --source \"$1\" --surface codex-baseline --output /tmp/codex-release-manifest.json && test -s /tmp/codex-release-manifest.json", "sh", headSha]);
  }
  if (id === "github-governance-contract") {
    command(root, commands, `${id}:validator`, "node", [".github/scripts/validate-github-governance.mjs"]);
    command(root, commands, `${id}:workflow`, "node", ["--test", ".github/scripts/codex-autonomy-gate-workflow.test.mjs", ".github/scripts/ponto-single-operator-governance.test.mjs"]);
    return;
  }
  if (id === "affected-domain-validation") return command(root, commands, id, "node", ["scripts/verify-changed.mjs", "--base", baseSha, "--head", headSha]);
  throw new Error(`native merge validation plan contains unknown check ${id}`);
}

function ensureLocalChangesMatchGitHub(root, baseSha, headSha, changedPaths, { snapshot = false } = {}) {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  const output = snapshot
    ? execFileSync("git", ["diff", "--name-status", "-z", `${baseSha}...${headSha}`], {
      cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    })
    : nativeGit(root, "diff", "--name-status", "-z", `${baseSha}...${headSha}`);
  const changes = parseGitNameStatus(output);
  const localPaths = [...new Set(changes.flatMap((entry) => entry.paths))].sort();
  if (nativeChangedPathsDigest(localPaths) !== nativeChangedPathsDigest(changedPaths)) {
    throw new Error("native merge local diff paths differ from GitHub PR paths");
  }
  return changes;
}

export async function validateNativeMergeCandidate({ repository, pullNumber, expectedHeadSha, candidateRoot }) {
  if (process.platform !== "linux") throw new Error("native merge validation must run in the isolated Ubuntu/Linux executor");
  const headSha = exactSha(expectedHeadSha, "expected PR head");
  if (git(ROOT, "rev-parse", "--show-toplevel") !== ROOT || git(ROOT, "status", "--porcelain", "--untracked-files=normal")) {
    throw new Error("native merge authority source must be a clean trusted main checkout");
  }
  const trustedMainSha = exactSha(git(ROOT, "rev-parse", "HEAD"), "trusted main");
  const [candidate, main] = await Promise.all([
    loadMergeCandidate({ repository, pullNumber, expectedHeadSha: headSha }),
    githubJson(repository, "/commits/main"),
  ]);
  const baseSha = exactSha(candidate.baseSha, "PR base");
  if (baseSha !== trustedMainSha || exactSha(main?.sha, "remote main") !== baseSha) {
    throw new Error("native merge trusted code is not the exact current main SHA");
  }
  const root = candidateCheckout(candidateRoot, headSha);
  if (git(root, "merge-base", baseSha, headSha) !== baseSha) {
    throw new Error("native merge PR head is not based on current main");
  }
  const changes = ensureLocalChangesMatchGitHub(root, baseSha, headSha, candidate.changedPaths);
  const policy = JSON.parse(fs.readFileSync(path.join(ROOT, "ops/codex/risk-policy.json"), "utf8"));
  const classification = classifyFiles(policy, changes);
  const plan = nativeGatePlan(classification);
  const snapshot = createNativeCandidateSnapshot({ candidateRoot: root, headSha });
  const checks = [];
  const commands = [];
  try {
    ensureLocalChangesMatchGitHub(snapshot.source, baseSha, headSha, candidate.changedPaths, { snapshot: true });
    for (const id of plan) {
      runPlannedCheck(id, { root: snapshot.source, baseSha, headSha, changedPaths: candidate.changedPaths, commands });
      checks.push(id);
    }
  } finally {
    fs.rmSync(snapshot.temporaryRoot, { recursive: true, force: true });
  }
  candidateCheckout(root, headSha);
  if (git(ROOT, "rev-parse", "HEAD") !== trustedMainSha || git(ROOT, "status", "--porcelain", "--untracked-files=normal")) {
    throw new Error("native merge trusted main checkout changed during validation");
  }
  const evidence = {
    schemaVersion: 1,
    kind: "skincos-native-merge-gate",
    status: "passed",
    repository,
    pullNumber: String(pullNumber),
    candidateRoot: root,
    trustedMainSha,
    baseSha,
    headSha,
    closureDigest: candidate.closure.digest,
    changedPathsDigest: nativeChangedPathsDigest(candidate.changedPaths),
    classification,
    checks,
    commands,
    validatedAt: new Date().toISOString(),
  };
  assertNativeGateEvidence(evidence, { repository, pullNumber, ...candidate });
  return { ...evidence, ...persistNativeMergeReceipt(evidence) };
}

function acquireGitHubCliToken() {
  if (process.env.GH_TOKEN) return;
  const result = spawnSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error || result.status !== 0 || !String(result.stdout || "").trim()) {
    throw new Error("GH_TOKEN or an authenticated native gh CLI is required");
  }
  process.env.GH_TOKEN = result.stdout.trim();
}

async function main(args) {
  acquireGitHubCliToken();
  const repository = String(process.env.GITHUB_REPOSITORY || "").trim();
  if (!/^[^/]+\/[^/]+$/.test(repository)) throw new Error("GITHUB_REPOSITORY is required");
  const pullNumber = requiredArgument(args, "--pull-number");
  const expectedHeadSha = requiredArgument(args, "--expected-head-sha");
  const candidateRoot = requiredArgument(args, "--candidate-root");
  const mutation = args.includes("--merge");
  const evidence = await validateNativeMergeCandidate({ repository, pullNumber, expectedHeadSha, candidateRoot });
  if (!mutation) {
    process.stdout.write(`${JSON.stringify({ ...evidence, classification: {
      risk: evidence.classification.risk, surfaces: evidence.classification.surfaces,
    } }, null, 2)}\n`);
    return;
  }
  if (String(process.env.SKINCOS_GLOBAL_COORDINATION_REQUIRED || "").toLowerCase() !== "true") {
    throw new Error("native merge requires active global coordination custody");
  }
  process.env.GLOBAL_COORDINATION_PROVIDER = "codex";
  process.env.GLOBAL_COORDINATION_MISSION_ID ||= `codex:native-merge:${repository}:${pullNumber}`;
  process.env.GLOBAL_COORDINATION_THREAD_ID ||= `native-merge:${process.pid}`;
  process.env.GLOBAL_COORDINATION_ACTOR ||= "admin";
  const result = await mergePullRequest({ repository, pullNumber, expectedHeadSha, nativeEvidence: evidence });
  process.stdout.write(`${JSON.stringify({ ...result, validatedHeadSha: evidence.headSha, validationChecks: evidence.checks }, null, 2)}\n`);
}

const invokedAsScript = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsScript) {
  try { await main(process.argv.slice(2)); }
  catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
