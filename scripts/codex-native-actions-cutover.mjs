import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { workflowEvents } from "./codex-native-actions-audit.mjs";
import { buildWorkflowLeaseRequest } from "./codex-global-coordination-workflow.mjs";
import { acquireGlobalLease, checkGlobalLease, proofForLease, releaseGlobalLease } from "./codex-global-coordination-client.mjs";

const REPOSITORY = "jubenitogarcia/skincos";
const AUTOMATIC_EVENTS = new Set(["push", "pull_request", "pull_request_target", "status", "check_run", "check_suite", "create", "delete"]);
const PRESERVED_EVENTS = new Set(["workflow_dispatch"]);
const SAFETY_PATHS = new Set([
  ".github/workflows/global-merge-authority.yml",
  ".github/workflows/skincos-integration-gate.yml",
]);
const PRIVATE_ROOT = path.join(os.homedir(), ".local/state/skincos-actions-cutover");

function command(executable, args, { allowEmpty = false } = {}) {
  const result = spawnSync(executable, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || "").trim().split("\n").at(-1) || result.error?.message || "unknown error";
    throw new Error(`${executable} command failed: ${detail}`);
  }
  if (!allowEmpty && !String(result.stdout || "").trim()) throw new Error(`${executable} returned no data`);
  return String(result.stdout || "").trim();
}

function github(endpoint, method = "GET") {
  const output = command("gh", ["api", "--method", method, `repos/${REPOSITORY}${endpoint}`], { allowEmpty: method !== "GET" });
  return output ? JSON.parse(output) : null;
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function fullSha(value) {
  const sha = String(value || "").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("GitHub main SHA is invalid");
  return sha;
}

function privateDir() {
  fs.mkdirSync(PRIVATE_ROOT, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(PRIVATE_ROOT);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700) {
    throw new Error("private cutover directory permissions are unsafe");
  }
  return PRIVATE_ROOT;
}

function privateFile(file) {
  const resolved = path.resolve(file);
  const root = fs.realpathSync(privateDir());
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error("cutover snapshot must stay in the private state directory");
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600) {
    throw new Error("cutover snapshot permissions are unsafe");
  }
  return resolved;
}

function atomicJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  fs.renameSync(tmp, file);
}

function gitFileAt(sha, relative) {
  if (!/^\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/.test(relative)) throw new Error("workflow path is unexpected");
  return command("git", ["show", `${sha}:${relative}`]);
}

function catalog() {
  const workflows = [];
  for (let page = 1; page <= 10; page += 1) {
    const response = github(`/actions/workflows?per_page=100&page=${page}`);
    if (!Array.isArray(response?.workflows)) throw new Error("Actions catalog is unavailable");
    workflows.push(...response.workflows.map(({ id, name, path: workflowPath, state }) => ({ id, name, path: workflowPath, state })));
    if (response.workflows.length < 100) return workflows.sort((a, b) => a.id - b.id);
  }
  throw new Error("Actions catalog exceeded the bounded snapshot");
}

export function classifyWorkflow({ path: workflowPath, state, events, error }) {
  if (state !== "active") return "inactive";
  if (error || !Array.isArray(events) || !events.length) return "unclassified";
  const names = events.map((event) => event.name);
  if (!names.some((name) => AUTOMATIC_EVENTS.has(name))) return "preserve";
  if (SAFETY_PATHS.has(workflowPath)) return "safety-gate";
  if (names.some((name) => !AUTOMATIC_EVENTS.has(name) && !PRESERVED_EVENTS.has(name))) return "mixed-duty";
  return "event-only";
}

function classifyCatalog(workflows, mainSha) {
  return workflows.map((workflow) => {
    let events = null;
    let error = null;
    if (workflow.state === "active") {
      try {
        events = workflowEvents(gitFileAt(mainSha, workflow.path));
      } catch (cause) {
        error = String(cause?.message || cause).slice(0, 160);
      }
    }
    return { ...workflow, events: events?.map(({ name }) => name) || null, classification: classifyWorkflow({ ...workflow, events, error }), error };
  });
}

function rulesets() {
  const list = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = github(`/rulesets?includes_parents=false&per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error("ruleset catalog is unavailable");
    list.push(...batch);
    if (batch.length < 100) return list.map(({ id }) => github(`/rulesets/${id}`)).sort((a, b) => a.id - b.id);
  }
  throw new Error("ruleset catalog exceeded the bounded snapshot");
}

function stateFingerprint({ mainSha, permissions, workflows, rules }) {
  return hash({
    mainSha,
    permissions,
    workflows: workflows.map(({ id, path: workflowPath, state }) => ({ id, path: workflowPath, state })),
    rules,
  });
}

function liveSnapshot() {
  const mainSha = fullSha(github("/git/ref/heads/main")?.object?.sha);
  command("git", ["cat-file", "-e", `${mainSha}^{commit}`], { allowEmpty: true });
  const permissions = github("/actions/permissions");
  if (permissions?.enabled !== true) throw new Error("repository Actions enablement changed");
  const workflows = classifyCatalog(catalog(), mainSha);
  const rules = rulesets();
  const run = github("/actions/runs?per_page=1")?.workflow_runs?.[0];
  const snapshot = { version: 1, repository: REPOSITORY, capturedAt: new Date().toISOString(), mainSha, permissions, workflows, rules, latestRunId: run?.id || null };
  snapshot.fingerprint = stateFingerprint(snapshot);
  return snapshot;
}

function summarize(snapshot) {
  const byClass = {};
  for (const workflow of snapshot.workflows) byClass[workflow.classification] = (byClass[workflow.classification] || 0) + 1;
  return { mainSha: snapshot.mainSha, fingerprint: snapshot.fingerprint, counts: byClass, eventOnlyIds: snapshot.workflows.filter((workflow) => workflow.classification === "event-only").map((workflow) => workflow.id), latestRunId: snapshot.latestRunId, safeToPush: false };
}

function newSnapshot() {
  const snapshot = liveSnapshot();
  const directory = fs.mkdtempSync(path.join(privateDir(), "snapshot-"));
  fs.chmodSync(directory, 0o700);
  const file = path.join(directory, "snapshot.json");
  fs.writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return { file, ...summarize(snapshot) };
}

function loadSnapshot(file, expectedFingerprint) {
  const snapshot = JSON.parse(fs.readFileSync(privateFile(file), "utf8"));
  if (snapshot.version !== 1 || snapshot.repository !== REPOSITORY || snapshot.fingerprint !== expectedFingerprint || stateFingerprint(snapshot) !== expectedFingerprint) {
    throw new Error("snapshot fingerprint or repository does not match");
  }
  return snapshot;
}

function currentStates(ids) {
  return new Map(ids.map((id) => {
    const workflow = github(`/actions/workflows/${id}`);
    return [id, workflow?.state];
  }));
}

async function withMergeLease(snapshot, operation, mutation) {
  if (String(process.env.SKINCOS_GLOBAL_COORDINATION_REQUIRED || "").toLowerCase() !== "true") {
    throw new Error("native Actions cutover requires active global coordination custody");
  }
  process.env.GLOBAL_COORDINATION_PROVIDER = "codex";
  process.env.GLOBAL_COORDINATION_MISSION_ID ||= `codex:actions-cutover:${snapshot.fingerprint}`;
  process.env.GLOBAL_COORDINATION_THREAD_ID ||= `actions-cutover:${process.pid}`;
  process.env.GLOBAL_COORDINATION_ACTOR ||= "admin";
  process.env.GITHUB_REPOSITORY = REPOSITORY;
  const { request, closure } = buildWorkflowLeaseRequest({
    resource: "merge:main", module: "merge", source: snapshot.mainSha,
    operation: "mutation", idempotencyKey: `actions-cutover:${operation}:${snapshot.fingerprint}`,
    inputs: { operation, mainSha: snapshot.mainSha, catalogFingerprint: snapshot.fingerprint },
  });
  const url = process.env.SKINCOS_GLOBAL_COORDINATOR_URL;
  const acquired = await acquireGlobalLease({ request, url });
  if (acquired?.passed !== true || !acquired.lease) throw new Error(`merge:main lease unavailable: ${String(acquired?.reason || "unknown")}`);
  const proof = proofForLease(acquired.lease);
  const check = async () => {
    const result = await checkGlobalLease({
      proof, url,
      authorization: {
        expectedResource: "merge:main",
        expectedIntentDigest: proof.intentDigest,
        observedDependencyClosureDigest: closure.digest,
      },
    });
    if (result?.passed !== true) throw new Error(`merge:main lease check failed: ${String(result?.reason || "unknown")}`);
  };
  try {
    await check();
    return await mutation(check);
  } finally {
    const released = await releaseGlobalLease({ proof, url });
    if (released?.passed !== true) throw new Error(`merge:main lease release failed: ${String(released?.reason || "unknown")}`);
  }
}

async function disableEventOnly(snapshotFile, expectedFingerprint) {
  const snapshot = loadSnapshot(snapshotFile, expectedFingerprint);
  const selected = snapshot.workflows.filter((workflow) => workflow.classification === "event-only");
  if (!selected.length) throw new Error("snapshot has no event-only workflows to disable");
  const now = liveSnapshot();
  if (now.fingerprint !== snapshot.fingerprint) throw new Error("live main, catalog, permissions or rulesets changed after checkpoint");
  const directory = path.dirname(snapshotFile);
  const journalPath = path.join(directory, "journal.json");
  if (fs.existsSync(journalPath)) throw new Error("cutover journal already exists; inspect or restore it first");
  const journal = { version: 1, repository: REPOSITORY, snapshotFingerprint: expectedFingerprint, selected: selected.map(({ id }) => id), startedAt: new Date().toISOString(), changes: [], state: "applying" };
  try {
    const result = await withMergeLease(snapshot, "disable-event-only", async (check) => {
      if (liveSnapshot().fingerprint !== snapshot.fingerprint) throw new Error("live state changed while acquiring merge:main");
      atomicJson(journalPath, journal);
      for (const workflow of selected) {
        await check();
        if (github("/git/ref/heads/main")?.object?.sha?.toLowerCase() !== snapshot.mainSha) throw new Error("main changed during cutover");
        if (github(`/actions/workflows/${workflow.id}`)?.state !== "active") throw new Error(`workflow ${workflow.id} changed during cutover`);
        github(`/actions/workflows/${workflow.id}/disable`, "PUT");
        const state = github(`/actions/workflows/${workflow.id}`)?.state;
        if (state !== "disabled_manually") throw new Error(`workflow ${workflow.id} disable readback failed`);
        journal.changes.push({ id: workflow.id, state });
        atomicJson(journalPath, journal);
      }
      journal.state = "event-only-disabled";
      journal.finishedAt = new Date().toISOString();
      atomicJson(journalPath, journal);
      return { journalPath, disabled: journal.changes.length, remaining: now.workflows.filter((workflow) => ["mixed-duty", "safety-gate", "unclassified"].includes(workflow.classification)).map(({ id, classification }) => ({ id, classification })), safeToPush: false };
    });
    return result;
  } catch (error) {
    if (fs.existsSync(journalPath)) {
      journal.state = "interrupted-needs-restore";
      journal.error = String(error?.message || error).slice(0, 200);
      atomicJson(journalPath, journal);
    }
    throw error;
  }
}

async function restore(snapshotFile, expectedFingerprint) {
  const snapshot = loadSnapshot(snapshotFile, expectedFingerprint);
  if (fullSha(github("/git/ref/heads/main")?.object?.sha) !== snapshot.mainSha) throw new Error("main changed; automatic workflow re-enable is unsafe");
  const journalPath = privateFile(path.join(path.dirname(snapshotFile), "journal.json"));
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  if (journal.version !== 1 || journal.snapshotFingerprint !== expectedFingerprint || journal.repository !== REPOSITORY) throw new Error("cutover journal does not match snapshot");
  const selected = snapshot.workflows.filter((workflow) => workflow.classification === "event-only").map(({ id }) => id);
  if (JSON.stringify(journal.selected) !== JSON.stringify(selected)) throw new Error("cutover journal selected IDs changed");
  const states = currentStates(selected);
  if ([...states.values()].some((state) => !["active", "disabled_manually"].includes(state))) throw new Error("workflow state changed unexpectedly; automatic restore is unsafe");
  await withMergeLease(snapshot, "restore", async (check) => {
    for (const id of selected) {
      if (states.get(id) !== "disabled_manually") continue;
      await check();
      github(`/actions/workflows/${id}/enable`, "PUT");
      if (github(`/actions/workflows/${id}`)?.state !== "active") throw new Error(`workflow ${id} restore readback failed`);
    }
  });
  journal.state = "restored";
  journal.restoredAt = new Date().toISOString();
  atomicJson(journalPath, journal);
  return { restored: selected.length, journalPath };
}

function argumentsForMode(argv) {
  const [mode, ...rest] = argv;
  const options = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    if (!/^--[a-z-]+$/.test(rest[index] || "") || !rest[index + 1]) throw new Error("invalid cutover arguments");
    options.set(rest[index], rest[index + 1]);
  }
  if (!["snapshot", "disable-event-only", "restore"].includes(mode)) throw new Error("mode must be snapshot, disable-event-only or restore");
  if (mode !== "snapshot" && (!options.get("--snapshot") || !/^[0-9a-f]{64}$/.test(options.get("--fingerprint") || ""))) throw new Error("snapshot path and fingerprint are required");
  if (mode === "snapshot" && options.size) throw new Error("snapshot mode takes no options");
  return { mode, options };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    const { mode, options } = argumentsForMode(process.argv.slice(2));
    const result = mode === "snapshot" ? newSnapshot()
      : mode === "disable-event-only" ? await disableEventOnly(options.get("--snapshot"), options.get("--fingerprint"))
        : await restore(options.get("--snapshot"), options.get("--fingerprint"));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 1;
  }
}
