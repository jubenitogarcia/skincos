#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { verifyNativeScheduledRelease } from "./verify-native-scheduled-release.mjs";
import { stageNativeScheduledRelease } from "./stage-native-scheduled-release.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPTS = Object.freeze({
  architecture: "codex-native-architecture-governance.mjs",
  security: "codex-native-security-audit.mjs",
});

function main(args) {
  if (process.platform !== "linux") throw new Error("scheduled native gate requires Ubuntu/Linux");
  const [gate, mode] = args;
  if (args.length !== 2 || !Object.hasOwn(SCRIPTS, gate) || !["run", "rehearsal"].includes(mode)) {
    throw new Error("usage: run-native-scheduled-gate <architecture|security> <run|rehearsal>");
  }
  const release = fs.realpathSync(ROOT);
  if (!/^[0-9a-f]{40}$/.test(path.basename(release))) {
    throw new Error("scheduled native gate is not running from an exact immutable release");
  }
  const verified = verifyNativeScheduledRelease(path.basename(release));
  const candidate = mode === "run" ? stageNativeScheduledRelease({ canonical: true }) : verified;
  const script = path.join(release, "scripts", SCRIPTS[gate]);
  const argumentsList = [script, mode, ...(mode === "run" ? ["--candidate", candidate.releasePath] : [])];
  const result = spawnSync(process.execPath, argumentsList, {
    cwd: release, stdio: "inherit", timeout: 3 * 60 * 60_000,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  if (result.error || result.status !== 0) throw new Error(`scheduled ${gate} ${mode} failed (${result.status ?? result.error?.code}); release ${verified.sourceSha}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 1;
  }
}
