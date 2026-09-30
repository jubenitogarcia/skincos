#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildFullArchitectureGovernancePlan } from "../.github/scripts/architecture-governance.mjs";
import { createNativeCandidateSnapshot, runInNativeCandidateSandbox } from "./codex-native-merge-sandbox.mjs";
import { nativeGit } from "./codex-native-git-worktree.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const RECEIPTS = path.join(os.homedir(), ".local/state/skincos-native-architecture-receipts");
const REPOSITORY = "jubenitogarcia/skincos";

function assertPrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700) {
    throw new Error("native architecture private receipt custody is invalid");
  }
  return directory;
}

function trustedMainSha() {
  const result = spawnSync("gh", ["api", `repos/${REPOSITORY}/git/ref/heads/main`, "--jq", ".object.sha"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error("live main SHA is unavailable");
  const sha = String(result.stdout || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("live main SHA is invalid");
  return sha;
}

function installLockedDependencies(source, temporaryRoot) {
  const home = path.join(temporaryRoot, "npm-home");
  fs.mkdirSync(home, { mode: 0o700 });
  const result = spawnSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: source,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024,
    timeout: 15 * 60_000,
    env: {
      PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
      HOME: home,
      npm_config_userconfig: "/dev/null",
      npm_config_cache: path.join(home, "cache"),
      npm_config_update_notifier: "false",
      CI: "1",
    },
  });
  if (result.error || result.status !== 0) throw new Error(`locked native dependency install failed (${result.status ?? result.error?.code})`);
}

export function fullNativeArchitecturePlan() {
  const plan = buildFullArchitectureGovernancePlan("native scheduled architecture governance");
  if (plan.full !== true || plan.failClosed !== true || !Array.isArray(plan.jobs) || plan.jobs.length !== 7) {
    throw new Error("full architecture governance plan is incomplete");
  }
  const commands = plan.jobs.flatMap((job) => (plan.commands[job] || []).map((command) => ({
    job,
    // Preserve every test while bounding Node's process and thread fanout in
    // the native systemd unit. Hosted runners had a smaller CPU allocation.
    command: command.startsWith("node --test ") ? command.replace("node --test ", "node --test --test-concurrency=2 ") : command,
  })));
  if (commands.length < 20 || commands.some(({ command }) => !/^node (?:--test |--check )?/.test(command))) {
    throw new Error("full architecture governance command set is invalid");
  }
  return { jobs: plan.jobs, commands };
}

function persistReceipt(receipt) {
  const directory = assertPrivateDirectory(RECEIPTS);
  const file = path.join(directory, `${receipt.sourceSha}-${Date.now()}.json`);
  fs.writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return file;
}

function run({ requireMain = true } = {}) {
  if (process.platform !== "linux") throw new Error("native architecture governance requires Ubuntu/Linux");
  const plan = fullNativeArchitecturePlan();
  const sha = nativeGit(ROOT, "rev-parse", "HEAD");
  if (nativeGit(ROOT, "status", "--porcelain", "--untracked-files=normal")) throw new Error("native architecture source checkout must be clean");
  if (requireMain && sha !== trustedMainSha()) throw new Error("native architecture source must be the exact live main SHA");
  const sourceTree = nativeGit(ROOT, "rev-parse", `${sha}^{tree}`);
  const snapshot = createNativeCandidateSnapshot({ candidateRoot: ROOT, headSha: sha });
  const receipt = { version: 1, kind: "native-architecture-governance", mode: requireMain ? "live-main" : "rehearsal", sourceSha: sha, sourceTree, startedAt: new Date().toISOString(), jobs: plan.jobs, checks: [], status: "running" };
  try {
    if (plan.jobs.includes("influencer")) installLockedDependencies(snapshot.source, snapshot.temporaryRoot);
    for (const { job, command } of plan.commands) {
      runInNativeCandidateSandbox({ source: snapshot.source, executable: "sh", args: ["-ec", command], label: `${job}: ${command}`, captureFailureOutput: true });
      receipt.checks.push({ job, command, status: "passed" });
    }
    if (nativeGit(ROOT, "rev-parse", "HEAD") !== sha || (requireMain && trustedMainSha() !== sha)) throw new Error("source changed during architecture governance");
    receipt.status = "passed";
    return { status: "passed", sourceSha: sha, checked: receipt.checks.length, receiptPath: persistReceipt({ ...receipt, completedAt: new Date().toISOString() }) };
  } catch (error) {
    receipt.status = "failed";
    receipt.failure = String(error?.message || error).slice(0, 1200);
    receipt.completedAt = new Date().toISOString();
    const receiptPath = persistReceipt(receipt);
    throw new Error(`${receipt.failure}; receipt: ${receiptPath}`);
  } finally {
    if (!/^\/var\/tmp\/skincos-native-gate-[A-Za-z0-9]+$/.test(snapshot.temporaryRoot)) {
      throw new Error("native architecture snapshot cleanup target is invalid");
    }
    fs.rmSync(snapshot.temporaryRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    const mode = process.argv[2];
    if (mode === "plan" && process.argv.length === 3) {
      const plan = fullNativeArchitecturePlan();
      process.stdout.write(`${JSON.stringify({ jobs: plan.jobs, commandCount: plan.commands.length }, null, 2)}\n`);
    } else if (["run", "rehearsal"].includes(mode) && process.argv.length === 3) {
      process.stdout.write(`${JSON.stringify(run({ requireMain: mode === "run" }), null, 2)}\n`);
    } else throw new Error("mode must be plan, rehearsal or run");
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 1;
  }
}
