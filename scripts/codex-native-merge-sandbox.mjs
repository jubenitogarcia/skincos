import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { nativeGitWorkspace } from "./codex-native-git-worktree.mjs";

let unitSequence = 0;

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    stdio: options.stdio || "inherit",
    maxBuffer: 64 * 1024,
    timeout: 16 * 60_000,
    cwd: options.cwd,
    env: options.env || { PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin", HOME: "/tmp", GIT_CONFIG_GLOBAL: "/dev/null" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const diagnostic = options.captureFailureOutput
      ? String(result.stderr || result.stdout || "").trim().slice(-4096)
      : "";
    throw new Error(`${options.label || executable} failed (${result.status ?? "signal"})${diagnostic ? `: ${diagnostic}` : ""}`);
  }
  return result;
}

export function createNativeCandidateSnapshot({ candidateRoot, headSha }) {
  if (process.platform !== "linux") throw new Error("native candidate snapshot requires Linux");
  const { commonGitDir } = nativeGitWorkspace(candidateRoot);
  const temporaryRoot = fs.mkdtempSync(path.join("/var/tmp", "skincos-native-gate-"));
  // DynamicUser needs traversal rights. The snapshot contains tracked source,
  // never operator credentials or runtime files.
  fs.chmodSync(temporaryRoot, 0o755);
  const source = path.join(temporaryRoot, "source");
  try {
    run("git", ["clone", "--no-hardlinks", "--no-checkout", "--quiet", commonGitDir, source], { label: "candidate native snapshot" });
    run("git", ["-C", source, "checkout", "--quiet", "--detach", headSha], { label: "candidate exact SHA checkout" });
    return { temporaryRoot, source };
  } catch (error) {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

export function runInNativeCandidateSandbox({ source, executable, args, label, captureFailureOutput = false }) {
  if (process.platform !== "linux") throw new Error("native candidate sandbox requires Linux");
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) throw new Error("native candidate snapshot is unavailable");
  const unit = `skincos-native-gate-${process.pid}-${++unitSequence}`;
  process.stdout.write(`[native-gate] ${label}\n`);
  // systemd gives the candidate a fresh uid, private network and /tmp, no
  // Windows mounts or operator/runtime custody, and a read-only source tree.
  run("sudo", [
    "-n", "systemd-run", "--wait", "--collect", "--pipe", "--quiet", `--unit=${unit}`,
    "-p", "DynamicUser=yes",
    "-p", "PrivateNetwork=yes",
    "-p", "PrivateTmp=yes",
    "-p", "ProtectHome=yes",
    "-p", "ProtectSystem=strict",
    "-p", "InaccessiblePaths=/mnt /etc/skincos /var/lib /var/log /opt/skincos /run/credentials",
    "-p", "NoNewPrivileges=yes",
    "-p", "CapabilityBoundingSet=",
    "-p", "ProtectProc=invisible",
    "-p", "ProtectKernelTunables=yes",
    "-p", "ProtectControlGroups=yes",
    "-p", "ProtectKernelModules=yes",
    "-p", "RestrictSUIDSGID=yes",
    "-p", "LockPersonality=yes",
    "-p", "RuntimeMaxSec=15min",
    "-p", "MemoryMax=2G",
    "-p", "TasksMax=64",
    "-p", `BindReadOnlyPaths=${source}:/run/candidate`,
    "-p", "WorkingDirectory=/run/candidate",
    "/usr/bin/env", "-i", "PATH=/usr/local/bin:/usr/bin:/bin", "HOME=/tmp", "XDG_CONFIG_HOME=/tmp/config", "CI=1",
    "GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_COUNT=1", "GIT_CONFIG_KEY_0=safe.directory", "GIT_CONFIG_VALUE_0=/run/candidate",
    executable, ...args,
  ], { label: `isolated ${label}`, stdio: "pipe", captureFailureOutput });
}
