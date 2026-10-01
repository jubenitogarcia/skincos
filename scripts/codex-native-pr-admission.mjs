#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { REPOSITORY, STATUS_CONTEXTS, exactSha, workflowEvents, latestContexts, statusNeeded } from "./codex-native-pr-admission-contract.mjs";
import { issueInstallationToken } from "./codex-native-github-app.mjs";
import { githubJson } from "./codex-github-integration-candidate.mjs";
import { dependencyClosureFromTree, loadGlobalPolicy } from "./codex-global-coordinator.mjs";
import { buildWorkflowLeaseRequest } from "./codex-global-coordination-workflow.mjs";
import { evaluateGlobalGate } from "./codex-global-coordination-client.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const BLOCKED_EVENTS = new Set(["status", "check_run", "check_suite", "pull_request_target"]);
const WAITABLE = new Set(["resource-lease-held", "incompatible-release-lease"]);

export async function evaluateAdmission({ pullNumber, headSha, mainSha, token, candidateImpl, evaluateImpl, readIdentity, readMain }) {
  let desired;
  try {
    const candidate = await candidateImpl({ pullNumber, headSha, mainSha, token });
    const result = await evaluateImpl(candidate);
    desired = result.passed === true
      ? { state: "success", description: "Exact base/head and dependency closure admitted by the global coordinator." }
      : WAITABLE.has(result.reason)
        ? { state: "pending", description: "Waiting for incompatible global resource ownership to end." }
        : { state: "failure", description: "Global coordination admission failed closed." };
  } catch {
    desired = { state: "failure", description: "PR is not an exact current-main integration candidate or custody is unavailable." };
  }
  const [currentPull, currentMain] = await Promise.all([readIdentity(pullNumber), readMain()]);
  if (currentPull.state !== "open" || currentPull.draft || currentPull.base?.ref !== "main"
    || currentPull.head?.repo?.full_name !== REPOSITORY
    || currentPull.head?.sha !== headSha || currentMain.sha !== mainSha) {
    return { publish: false, reason: "identity-changed", desired };
  }
  if (currentPull.base?.sha !== mainSha) desired = { state: "failure", description: "PR base must be updated to the exact current main before native integration." };
  return { publish: true, desired };
}

export async function pollAdmission({ mainSha, programSha, token, api, candidateImpl, evaluateImpl, appBotLogin, write = false }) {
  const main = exactSha(mainSha, "current main");
  const program = exactSha(programSha, "trusted program");
  const pulls = [];
  for (let page = 1; page <= 5; page += 1) {
    const batch = await api(`/pulls?state=open&base=main&per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error("GitHub PR inventory is invalid");
    pulls.push(...batch);
    if (batch.length < 100) break;
    if (page === 5) throw new Error("GitHub PR inventory exceeds the safe bound");
  }
  const summary = { repository: REPOSITORY, mainSha: main, programSha: program, inspected: 0, published: 0, skipped: 0, passed: 0, pending: 0, failed: 0 };
  for (const pull of pulls) {
    if (pull.draft || pull.head?.repo?.full_name !== REPOSITORY) { summary.skipped += 1; continue; }
    const headSha = exactSha(pull.head?.sha, "PR head");
    const result = await evaluateAdmission({
      pullNumber: pull.number, headSha, mainSha: main, token, candidateImpl, evaluateImpl,
      readIdentity: (number) => api(`/pulls/${number}`), readMain: () => api("/commits/main"),
    });
    summary.inspected += 1;
    if (!result.publish) { summary.skipped += 1; continue; }
    summary[result.desired.state === "success" ? "passed" : result.desired.state === "pending" ? "pending" : "failed"] += 1;
    const current = latestContexts(await api(`/commits/${headSha}/statuses?per_page=100`));
    const target_url = `https://github.com/${REPOSITORY}/blob/${program}/docs/runbooks/native-pr-admission.md`;
    const desired = [
      { context: STATUS_CONTEXTS.merge, state: "failure", description: "Only the native merger may authorize merge after exact SHA, checks and lease revalidation.", target_url },
      { context: STATUS_CONTEXTS.integration, ...result.desired, target_url },
    ];
    for (const status of desired) {
      if (!statusNeeded(current.get(status.context), status, { appBotLogin })) continue;
      if (write) await api(`/statuses/${headSha}`, { method: "POST", body: JSON.stringify(status) });
      summary.published += write ? 1 : 0;
    }
  }
  return summary;
}

function cleanGitEnv() {
  return { PATH: "/usr/bin:/bin", HOME: "/nonexistent", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" };
}

export function coordinationCustody(source) {
  const values = new Map();
  for (const line of String(source).split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) throw new Error("Native coordination custody has unsupported syntax");
    const value = match[2].replace(/^(["'])(.*)\1$/, "$2");
    if (values.has(match[1])) throw new Error("Native coordination custody repeats a field");
    values.set(match[1], value);
  }
  const active = values.get("SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY");
  const keyId = values.get("SKINCOS_GLOBAL_COORDINATION_KEY_ID");
  const secret = active && keyId ? active : values.get("SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET");
  if (!secret || secret.length < 32 || active && !keyId) throw new Error("Native coordination custody is incomplete");
  return { secret, keyId: active ? keyId : "" };
}

export function gitData(root, ...args) {
  return execFileSync("/usr/bin/git", ["-C", root, ...args], { encoding: "utf8", env: cleanGitEnv(), stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 }).trim();
}

export function prepareMainMirror(stateDirectory) {
  if (!stateDirectory || !path.isAbsolute(stateDirectory) || stateDirectory.startsWith("/mnt/")) throw new Error("Native private state directory is invalid");
  const mirror = path.join(stateDirectory, "main.git");
  fs.mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(mirror)) {
    execFileSync("/usr/bin/git", ["init", "--bare", mirror], { env: cleanGitEnv(), stdio: ["ignore", "pipe", "pipe"] });
  }
  if (fs.lstatSync(mirror).isSymbolicLink() || gitData(mirror, "rev-parse", "--is-bare-repository") !== "true") {
    throw new Error("Native PR admission mirror is invalid");
  }
  gitData(mirror, "-c", "http.followRedirects=false", "fetch", "--no-tags", "https://github.com/jubenitogarcia/skincos.git", "+refs/heads/main:refs/heads/main");
  const mainSha = exactSha(gitData(mirror, "rev-parse", "refs/heads/main"), "mirror main");
  const workflows = gitData(mirror, "ls-tree", "-r", "--name-only", mainSha, ".github/workflows").split("\n").filter((file) => /\.ya?ml$/.test(file));
  if (workflows.length < 2) throw new Error("Current main workflow inventory is incomplete");
  for (const file of workflows) {
    const events = workflowEvents(gitData(mirror, "show", `${mainSha}:${file}`));
    if (events.some((event) => BLOCKED_EVENTS.has(event))) throw new Error("Native PR admission writes are disabled while Actions status or PR-target triggers remain on main");
  }
  return { mirror, mainSha };
}

export function readCredential(name, directory = process.env.CREDENTIALS_DIRECTORY) {
  if (!directory || !path.isAbsolute(directory) || !/^[a-z][a-z0-9-]+$/.test(name)) throw new Error("Native service credential custody is unavailable");
  const file = path.join(directory, name);
  const entry = fs.lstatSync(file);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size < 16 || entry.size > 16_384 || entry.mode & 0o007) {
    throw new Error("Native service credential metadata is invalid");
  }
  return fs.readFileSync(file, "utf8").trim();
}

async function main(args) {
  if (process.platform !== "linux" || args.some((arg) => !["--publish", "--preflight"].includes(arg))) throw new Error("Native PR admission requires the Linux service entrypoint");
  const config = JSON.parse(readCredential("github-app-config"));
  if (!/^[a-z0-9-]+\[bot\]$/.test(config.botLogin || "")) throw new Error("GitHub App bot identity is invalid");
  const programSha = exactSha(fs.readFileSync(path.join(ROOT, ".native-pr-admission-source-sha"), "utf8").trim(), "trusted program");
  const { mirror, mainSha } = prepareMainMirror(process.env.STATE_DIRECTORY || "");
  const token = await issueInstallationToken({ ...config, privateKey: readCredential("github-app-key"), profile: "admission" });
  process.env.GITHUB_REPOSITORY = REPOSITORY;
  process.env.GLOBAL_COORDINATION_PROVIDER = "codex";
  process.env.GLOBAL_COORDINATION_ACTOR = config.botLogin;
  process.env.GLOBAL_COORDINATION_MISSION_ID = "codex:native-pr-admission";
  process.env.GLOBAL_COORDINATION_THREAD_ID = `native-pr-admission:${process.pid}`;
  process.env.GITHUB_WORKFLOW = "native-pr-admission";
  process.env.GITHUB_EVENT_NAME = "native_poll";
  const api = (suffix, options) => githubJson(REPOSITORY, suffix, { ...options, redirect: "error", signal: AbortSignal.timeout(30_000) }, token);
  if (exactSha((await api("/commits/main")).sha, "API main") !== mainSha) throw new Error("main changed after the trusted mirror fetch");
  const custody = coordinationCustody(readCredential("global-coordination-env"));
  if (args.includes("--preflight")) {
    process.stdout.write(`${JSON.stringify({ ready: true, programSha, mainSha, credentialProfile: "admission", coordinationCustody: true, coordinatorAdmission: "not-exercised", writes: false })}\n`);
    return;
  }
  // Git only consumes public data above. Secret-bearing coordinator requests run
  // in this trusted process, never in incoming PR code or a spawned scanner.
  if (custody.keyId) {
    process.env.SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY = custody.secret;
    process.env.SKINCOS_GLOBAL_COORDINATION_KEY_ID = custody.keyId;
  } else process.env.SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET = custody.secret;
  process.env.SKINCOS_GLOBAL_COORDINATOR_URL = config.coordinatorUrl;
  const policyBlob = gitData(mirror, "show", `${mainSha}:ops/governance/global-concurrency-policy.json`);
  const policyFile = path.join(process.env.RUNTIME_DIRECTORY, "policy.json");
  fs.writeFileSync(policyFile, policyBlob, { mode: 0o600 });
  const policy = loadGlobalPolicy(policyFile);
  const candidateImpl = async ({ pullNumber, headSha }) => {
    const pull = await api(`/pulls/${pullNumber}`);
    if (pull.state !== "open" || pull.draft || pull.base?.ref !== "main" || pull.head?.repo?.full_name !== REPOSITORY
      || pull.head?.sha !== headSha || pull.base?.sha !== mainSha) throw new Error("PR differs from exact current-main identity");
    const changedPaths = [];
    for (let page = 1; page <= 20; page += 1) {
      const rows = await api(`/pulls/${pullNumber}/files?per_page=100&page=${page}`);
      if (!Array.isArray(rows)) throw new Error("PR changed paths are invalid");
      changedPaths.push(...rows.flatMap((row) => [row.filename, row.previous_filename]).filter(Boolean));
      if (rows.length < 100) break;
      if (page === 20) throw new Error("PR changed paths exceed the safe bound");
    }
    if (!changedPaths.length) throw new Error("PR changed paths are unavailable");
    const entries = gitData(mirror, "ls-tree", "-rz", mainSha).split("\0").filter(Boolean).map((row) => {
      const match = /^[0-9]+ blob ([0-9a-f]{40})\t([\s\S]+)$/.exec(row);
      if (!match) throw new Error("Current-main closure tree has an unsupported entry");
      return { path: match[2], blob: match[1] };
    });
    const closure = dependencyClosureFromTree({ module: "merge", sourceCommit: mainSha,
      sourceTree: gitData(mirror, "rev-parse", `${mainSha}^{tree}`), entries, policy });
    const candidate = buildWorkflowLeaseRequest({ resource: "merge:main", module: "merge", source: mainSha, closure,
      idempotencyKey: `merge:${REPOSITORY}:${pullNumber}:${headSha}`, inputs: { pullNumber: String(pullNumber), expectedHeadSha: headSha, baseSha: mainSha, changedPaths: [...new Set(changedPaths)].sort() } });
    if (Buffer.byteLength(JSON.stringify(candidate.request)) > 256 * 1024) throw new Error("PR coordination request exceeds the safe bound");
    return candidate;
  };
  const summary = await pollAdmission({ mainSha, programSha, token, api, candidateImpl,
    evaluateImpl: ({ request }) => evaluateGlobalGate({ request, url: config.coordinatorUrl }), appBotLogin: config.botLogin, write: args.includes("--publish") });
  fs.writeFileSync(path.join(process.env.STATE_DIRECTORY, "latest.json"), `${JSON.stringify({ ...summary, checkedAt: new Date().toISOString() })}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await main(process.argv.slice(2)); }
  catch { process.stderr.write("Native PR admission failed closed; inspect private service custody and trusted-main readiness.\n"); process.exitCode = 1; }
}
