#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nativeGit, nativeGitWorkspace } from "./codex-native-git-worktree.mjs";

const BASE = path.join(os.homedir(), ".local/share/skincos-native-gates");
const SHA = /^[0-9a-f]{40}$/;

function fileSha256(file) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    while (true) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!count) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally { fs.closeSync(descriptor); }
  return hash.digest("hex");
}

export function verifyNativeScheduledRelease(sha) {
  if (process.platform !== "linux" || !SHA.test(sha)) throw new Error("native scheduled release requires Linux and an exact commit SHA");
  const release = path.join(BASE, "releases", sha);
  const artifact = path.join(BASE, "artifacts", `${sha}.tar`);
  const manifestPath = path.join(BASE, "manifests", `${sha}.json`);
  const manifestStat = fs.lstatSync(manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.uid !== process.getuid() || (manifestStat.mode & 0o777) !== 0o600) {
    throw new Error("native scheduled release manifest custody is invalid");
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1 || manifest.sourceSha !== sha || manifest.releasePath !== release || manifest.artifactPath !== artifact
    || !/^[0-9a-f]{40}$/.test(manifest.tree) || !/^[0-9a-f]{64}$/.test(manifest.archiveSha256)) {
    throw new Error("native scheduled release manifest identity is invalid");
  }
  nativeGitWorkspace(release);
  if (nativeGit(release, "rev-parse", "HEAD") !== sha || nativeGit(release, "rev-parse", "HEAD^{tree}") !== manifest.tree
    || nativeGit(release, "status", "--porcelain", "--untracked-files=normal")) {
    throw new Error("native scheduled release source differs from immutable commit");
  }
  const artifactStat = fs.lstatSync(artifact);
  if (!artifactStat.isFile() || artifactStat.isSymbolicLink() || artifactStat.uid !== process.getuid() || (artifactStat.mode & 0o777) !== 0o400
    || fileSha256(artifact) !== manifest.archiveSha256) {
    throw new Error("native scheduled release archive checksum or custody is invalid");
  }
  return { verified: true, sourceSha: sha, tree: manifest.tree, archiveSha256: manifest.archiveSha256, manifestPath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "--sha") throw new Error("usage: verify-native-scheduled-release --sha <40-char SHA>");
    process.stdout.write(`${JSON.stringify(verifyNativeScheduledRelease(process.argv[3]), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 1;
  }
}
