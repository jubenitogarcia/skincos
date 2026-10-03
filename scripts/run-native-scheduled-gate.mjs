#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { verifyNativeScheduledRelease } from "./verify-native-scheduled-release.mjs";
import { stageNativeScheduledRelease } from "./stage-native-scheduled-release.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPTS = Object.freeze({
  architecture: "codex-native-architecture-governance.mjs",
  security: "codex-native-security-audit.mjs",
});

function saveResult(gate, value) {
  const folder = path.join(os.homedir(), ".local/state/skincos-native-scheduled-results");
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(folder);
  if (stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700) throw new Error("scheduled result custody is invalid");
  const temporary = path.join(folder, `.result-${crypto.randomBytes(8).toString("hex")}`);
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, path.join(folder, `latest-${gate}.json`));
}

function main(args) {
  if (process.platform !== "linux") throw new Error("scheduled native gate requires Ubuntu/Linux");
  const [gate, mode] = args;
  if (args.length !== 2 || !Object.hasOwn(SCRIPTS, gate) || !["run", "rehearsal"].includes(mode)) {
    throw new Error("usage: run-native-scheduled-gate <architecture|security> <run|rehearsal>");
  }
  const runId = crypto.randomUUID();
  saveResult(gate, { schemaVersion: 1, runId, gate, mode, status: "started", receiptPath: null, startedAt: new Date().toISOString() });
  const release = fs.realpathSync(ROOT);
  if (!/^[0-9a-f]{40}$/.test(path.basename(release))) {
    throw new Error("scheduled native gate is not running from an exact immutable release");
  }
  const verified = verifyNativeScheduledRelease(path.basename(release));
  const candidate = mode === "run" ? stageNativeScheduledRelease({ canonical: true }) : verified;
  const reports = path.join(os.homedir(), ".local/state", gate === "security" ? "skincos-native-security-audit" : "skincos-native-architecture-receipts");
  fs.mkdirSync(reports, { recursive: true, mode: 0o700 });
  const previous = new Set(fs.readdirSync(reports));
  const script = path.join(release, "scripts", SCRIPTS[gate]);
  const argumentsList = [script, mode, ...(mode === "run" ? ["--candidate", candidate.releasePath] : [])];
  const result = spawnSync(process.execPath, argumentsList, {
    cwd: release, stdio: "inherit", timeout: 3 * 60 * 60_000,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  const generated = fs.readdirSync(reports).filter((name) => !previous.has(name) && name.startsWith(`${candidate.sourceSha}-`));
  const receiptPath = generated.length === 1 ? path.join(reports, generated[0], ...(gate === "security" ? ["receipt.json"] : [])) : null;
  saveResult(gate, { schemaVersion: 1, runId, gate, mode, status: "finished", sourceSha: candidate.sourceSha, trustedCodeSha: verified.sourceSha, receiptPath, exitCode: result.status, completedAt: new Date().toISOString() });
  if (result.error || result.status !== 0) throw new Error(`scheduled ${gate} ${mode} failed (${result.status ?? result.error?.code}); release ${verified.sourceSha}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 1;
  }
}
