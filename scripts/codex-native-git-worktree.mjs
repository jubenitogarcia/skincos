import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SHARED_GIT_ROOT = "/mnt/c/CodexShared/Projetos/skincos/.git";
const NATIVE_RELEASES_ROOT = path.join(os.homedir(), ".local/share/skincos-native-gates/releases");
const SKINCOS_REMOTE = "https://github.com/jubenitogarcia/skincos.git";

function nativeScheduledRelease(worktree, commonGitDir, env) {
  if (!/^[0-9a-f]{40}$/.test(path.basename(worktree))) return false;
  if (path.dirname(worktree) !== NATIVE_RELEASES_ROOT || commonGitDir !== path.join(worktree, ".git")) return false;
  const parent = fs.lstatSync(NATIVE_RELEASES_ROOT);
  const release = fs.lstatSync(worktree);
  if (parent.isSymbolicLink() || release.isSymbolicLink() || parent.uid !== process.getuid() || release.uid !== process.getuid()
    || (parent.mode & 0o777) !== 0o700 || (release.mode & 0o222) !== 0) {
    throw new Error("native scheduled release ownership or immutability is invalid");
  }
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: worktree, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const remote = execFileSync("git", ["remote", "get-url", "origin"], { cwd: worktree, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  if (sha !== path.basename(worktree) || remote !== SKINCOS_REMOTE) {
    throw new Error("native scheduled release identity is invalid");
  }
  env.GIT_OPTIONAL_LOCKS = "0";
  return true;
}

function nativePath(value) {
  const raw = String(value || "").trim().replaceAll("\\", "/");
  const windows = raw.match(/^([A-Za-z]):\/(.+)$/);
  return windows ? `/mnt/${windows[1].toLowerCase()}/${windows[2]}` : raw;
}

export function nativeGitWorkspace(root) {
  const worktree = fs.realpathSync(root);
  const marker = path.join(worktree, ".git");
  const env = { ...process.env };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE"]) delete env[name];
  let commonGitDir;
  if (fs.statSync(marker).isDirectory()) {
    commonGitDir = fs.realpathSync(marker);
  } else {
    const pointer = fs.readFileSync(marker, "utf8").trim().match(/^gitdir:\s*(.+)$/);
    if (!pointer) throw new Error("native Git worktree pointer is invalid");
    const gitDir = fs.realpathSync(path.resolve(worktree, nativePath(pointer[1])));
    commonGitDir = path.dirname(path.dirname(gitDir));
    env.GIT_DIR = gitDir;
    env.GIT_WORK_TREE = worktree;
  }
  if (commonGitDir !== SHARED_GIT_ROOT && !nativeScheduledRelease(worktree, commonGitDir, env)) {
    throw new Error("native merge checkout is outside the approved SKINCOS Git object store");
  }
  return { worktree, commonGitDir, env };
}

export function nativeGit(root, ...args) {
  const workspace = nativeGitWorkspace(root);
  return execFileSync("git", args, {
    cwd: workspace.worktree,
    env: workspace.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
