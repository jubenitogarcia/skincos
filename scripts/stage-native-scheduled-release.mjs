#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { nativeGit, nativeGitWorkspace } from "./codex-native-git-worktree.mjs";
import { publicGitEnvironment, publicMainSha, SKINCOS_PUBLIC_REMOTE } from "./codex-native-scheduled-source.mjs";
import { verifyNativeScheduledRelease } from "./verify-native-scheduled-release.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const BASE = path.join(os.homedir(), ".local/share/skincos-native-gates");
const REMOTE = "https://github.com/jubenitogarcia/skincos.git";
const SHA = /^[0-9a-f]{40}$/;

function privateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700) {
    throw new Error("native scheduled release custody is invalid");
  }
  return directory;
}

function git(cwd, ...args) {
  const env = publicGitEnvironment();
  const result = spawnSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024, timeout: 5 * 60_000 });
  if (result.error || result.status !== 0) throw new Error(`native scheduled release Git command failed: ${args[0]}`);
  return String(result.stdout || "").trim();
}

export function validateReleaseSymlink(sourceRoot, file, target) {
  if (path.isAbsolute(target) || /^[A-Za-z]:/.test(target)) throw new Error("native scheduled release symlink must be relative");
  const lexical = path.resolve(path.dirname(file), target);
  if (lexical !== sourceRoot && !lexical.startsWith(`${sourceRoot}${path.sep}`)) throw new Error("native scheduled release symlink escaped source");
  try {
    const resolved = fs.realpathSync(file);
    if (resolved !== sourceRoot && !resolved.startsWith(`${sourceRoot}${path.sep}`)) throw new Error("native scheduled release symlink resolves outside source");
  } catch (error) {
    if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
    // Tracked example/runtime pointers can be dangling within the snapshot.
  }
}

function seal(root, sourceRoot = root) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const file = path.join(root, entry.name);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) { validateReleaseSymlink(sourceRoot, file, fs.readlinkSync(file)); continue; }
    if (stat.isDirectory()) seal(file, sourceRoot);
    else if (stat.isFile()) fs.chmodSync(file, stat.mode & ~0o222);
    else throw new Error("native scheduled release contains an unsupported file");
  }
  fs.chmodSync(root, fs.statSync(root).mode & ~0o222);
}

function writableDirectories(root) {
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return;
  fs.chmodSync(root, stat.mode | 0o700);
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) if (entry.isDirectory()) writableDirectories(path.join(root, entry.name));
}

function sha256(file) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    while (true) {
      const read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!read) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally { fs.closeSync(descriptor); }
  return hash.digest("hex");
}

export function stageNativeScheduledRelease({ canonical = false } = {}) {
  if (process.platform !== "linux" || process.getuid() === 0) throw new Error("stage native scheduled release as the unprivileged Ubuntu operator");
  const sha = canonical ? publicMainSha() : nativeGit(ROOT, "rev-parse", "HEAD");
  if (!SHA.test(sha) || (!canonical && nativeGit(ROOT, "status", "--porcelain", "--untracked-files=normal"))) {
    throw new Error("native scheduled source must be a clean full SHA checkout");
  }
  const expectedTree = canonical ? null : nativeGit(ROOT, "rev-parse", `${sha}^{tree}`);
  const sourceGitDir = canonical ? SKINCOS_PUBLIC_REMOTE : nativeGitWorkspace(ROOT).commonGitDir;
  const releases = privateDirectory(path.join(privateDirectory(BASE), "releases"));
  const artifacts = privateDirectory(path.join(BASE, "artifacts"));
  const manifests = privateDirectory(path.join(BASE, "manifests"));
  const destination = path.join(releases, sha);
  const archive = path.join(artifacts, `${sha}.tar`);
  const manifest = path.join(manifests, `${sha}.json`);
  if ([destination, archive, manifest].some((file) => fs.existsSync(file))) {
    if (!canonical) throw new Error("native scheduled release already staged; inspect the existing artifact");
    return { ...verifyNativeScheduledRelease(sha), releasePath: destination, activated: false };
  }
  const temporary = fs.mkdtempSync(path.join(releases, ".stage-"));
  const source = path.join(temporary, "source");
  const temporaryArchive = path.join(temporary, "source.tar");
  let promoted = false;
  try {
    git(ROOT, "clone", "--no-hardlinks", "--no-checkout", "--quiet", sourceGitDir, source);
    git(source, "checkout", "--quiet", "--detach", sha);
    git(source, "remote", "set-url", "origin", REMOTE);
    const tree = git(source, "rev-parse", "HEAD^{tree}");
    if (git(source, "rev-parse", "HEAD") !== sha || (expectedTree && tree !== expectedTree) || git(source, "status", "--porcelain") || (canonical && sha !== publicMainSha())) {
      throw new Error("native scheduled release checkout differs from source SHA");
    }
    git(source, "archive", "--format=tar", `--output=${temporaryArchive}`, sha);
    const archiveSha256 = sha256(temporaryArchive);
    fs.renameSync(source, destination);
    // A directory moved across parents needs its write bit to update '..'.
    // Seal only after placing it at its final immutable identity.
    seal(destination);
    fs.renameSync(temporaryArchive, archive);
    fs.chmodSync(archive, 0o400);
    const record = { schemaVersion: 1, repository: REMOTE, sourceSha: sha, tree, archiveSha256, releasePath: destination, artifactPath: archive, stagedAt: new Date().toISOString() };
    fs.writeFileSync(manifest, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    promoted = true;
    return { sourceSha: sha, tree, archiveSha256, manifest, releasePath: destination, artifactPath: archive, activated: false };
  } finally {
    if (!/^\.stage-[A-Za-z0-9]+$/.test(path.basename(temporary)) || path.dirname(temporary) !== releases) {
      throw new Error("native scheduled temporary cleanup target is invalid");
    }
    writableDirectories(temporary);
    fs.rmSync(temporary, { recursive: true, force: true });
    if (!promoted && fs.existsSync(destination)) {
      process.stderr.write(`Native scheduled release was partially staged at ${destination}; activation remains blocked.\n`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    if (process.argv.length !== 2 && !(process.argv.length === 3 && process.argv[2] === "--canonical")) throw new Error("stage-native-scheduled-release accepts only --canonical");
    process.stdout.write(`${JSON.stringify(stageNativeScheduledRelease({ canonical: process.argv[2] === "--canonical" }), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 1;
  }
}
