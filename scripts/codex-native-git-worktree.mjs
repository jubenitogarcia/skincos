import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SHARED_GIT_ROOT = "/mnt/c/CodexShared/Projetos/skincos/.git";

function nativePath(value) {
  const raw = String(value || "").trim().replaceAll("\\", "/");
  const windows = raw.match(/^([A-Za-z]):\/(.+)$/);
  return windows ? `/mnt/${windows[1].toLowerCase()}/${windows[2]}` : raw;
}

export function nativeGitWorkspace(root) {
  const worktree = fs.realpathSync(root);
  const marker = path.join(worktree, ".git");
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
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
  if (commonGitDir !== SHARED_GIT_ROOT) {
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
