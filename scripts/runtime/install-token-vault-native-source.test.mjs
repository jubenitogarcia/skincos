import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { canonicalJson } from "../../ops/governance/global-coordination-core.mjs";
import { inspectTokenVaultNativeCandidate } from "./install-token-vault-native-source.mjs";
import { materializeVerifiedGitSourceArchive } from "./messaging-whatsapp-release-contract.mjs";

function git(root, args, stdoutFd = null) {
  const result = spawnSync("git", args, {
    cwd: root,
    env: Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))),
    encoding: "utf8",
    stdio: ["ignore", stdoutFd ?? "pipe", "pipe"],
  });
  assert.equal(result.status, 0, `git ${args[0]} must succeed`);
  return String(result.stdout || "").trim();
}

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "token-vault-native-source-test-"));
  const repository = path.join(base, "source");
  fs.mkdirSync(repository, { mode: 0o700 });
  git(repository, ["init", "-q"]);
  git(repository, ["config", "user.email", "native-test@example.invalid"]);
  git(repository, ["config", "user.name", "Native Test"]);
  fs.writeFileSync(path.join(repository, "content.txt"), "verified native release\n");
  fs.writeFileSync(path.join(repository, "run.sh"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
  git(repository, ["add", "content.txt", "run.sh"]);
  git(repository, ["-c", "commit.gpgsign=false", "commit", "-qm", "fixture"]);
  const sourceSha = git(repository, ["rev-parse", "HEAD"]);
  const sourceTree = git(repository, ["rev-parse", "HEAD^{tree}"]);
  const blob = git(repository, ["rev-parse", "HEAD:content.txt"]);
  const candidate = path.join(base, `release-source-${sourceSha}`);
  fs.mkdirSync(candidate, { mode: 0o700 });
  const archiveFile = path.join(candidate, "source.tar.gz");
  const descriptor = fs.openSync(archiveFile, "wx", 0o600);
  try {
    git(repository, ["archive", "--format=tar.gz", `--prefix=skincos-${sourceSha}/`, sourceSha], descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  const sourceArchiveSha256 = crypto.createHash("sha256").update(fs.readFileSync(archiveFile)).digest("hex");
  const material = { schemaVersion: 1, module: "token-vault", inputs: [{ path: "content.txt", blob }] };
  const dependencyClosureDigest = crypto.createHash("sha256").update(canonicalJson(material)).digest("hex");
  const identity = {
    schemaVersion: 1,
    sourceSha,
    sourceTree,
    releaseInputDigest: "c".repeat(64),
    dependencyClosureDigest,
    sourceArchiveSha256,
  };
  const closure = {
    schemaVersion: 1,
    module: "token-vault",
    sourceCommit: sourceSha,
    sourceTree,
    digest: dependencyClosureDigest,
    material,
  };
  const save = () => {
    fs.writeFileSync(path.join(candidate, "identity.json"), JSON.stringify(identity), { mode: 0o600 });
    fs.writeFileSync(path.join(candidate, "closure.json"), JSON.stringify(closure), { mode: 0o600 });
  };
  save();
  return { base, candidate, sourceSha, sourceTree, identity, closure, archiveFile, save };
}

test("inspects a native Git archive bound to its commit, tree and closure input", (t) => {
  const current = fixture();
  t.after(() => fs.rmSync(current.base, { recursive: true, force: true }));
  const result = inspectTokenVaultNativeCandidate({ candidateDirectory: current.candidate, sourceSha: current.sourceSha });
  assert.equal(result.sourceTree, current.sourceTree);
  assert.equal(result.archiveDigest, current.identity.sourceArchiveSha256);
  assert.equal(result.dependencyClosureDigest, current.closure.digest);
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "token-vault-extracted-tree-test-"));
  t.after(() => fs.rmSync(stage, { recursive: true, force: true }));
  const extracted = materializeVerifiedGitSourceArchive({
    archiveFile: current.archiveFile,
    sourceCommit: current.sourceSha,
    sourceTree: current.sourceTree,
    stageDirectory: stage,
  });
  assert.equal(fs.readFileSync(path.join(extracted.sourceRoot, "content.txt"), "utf8"), "verified native release\n");
  assert.notEqual(fs.statSync(path.join(extracted.sourceRoot, "run.sh")).mode & 0o111, 0);
});

test("rejects changed archive bytes, forged closure inputs and linked candidates", (t) => {
  const current = fixture();
  t.after(() => fs.rmSync(current.base, { recursive: true, force: true }));
  const input = { candidateDirectory: current.candidate, sourceSha: current.sourceSha };
  current.closure.material.inputs[0].blob = "d".repeat(40);
  const forged = crypto.createHash("sha256").update(canonicalJson(current.closure.material)).digest("hex");
  current.closure.digest = forged;
  current.identity.dependencyClosureDigest = forged;
  current.save();
  assert.throws(() => inspectTokenVaultNativeCandidate(input), /closure input differs/);
  current.closure.material.inputs[0].blob = git(path.join(current.base, "source"), ["rev-parse", "HEAD:content.txt"]);
  current.closure.digest = crypto.createHash("sha256").update(canonicalJson(current.closure.material)).digest("hex");
  current.identity.dependencyClosureDigest = current.closure.digest;
  current.save();
  fs.appendFileSync(current.archiveFile, "changed");
  assert.throws(() => inspectTokenVaultNativeCandidate(input), /checksum differs/);
  const linked = path.join(current.base, `release-source-${current.sourceSha}-link`);
  fs.symlinkSync(current.candidate, linked);
  assert.throws(() => inspectTokenVaultNativeCandidate({ candidateDirectory: linked, sourceSha: current.sourceSha }));
});
