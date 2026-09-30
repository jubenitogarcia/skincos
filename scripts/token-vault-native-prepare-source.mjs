#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dependencyClosureForSource } from "./codex-global-coordinator.mjs";
import { releaseInputDigest, sourceIdentity, verifyPreviewEvidence } from "./token-vault-native-preview.mjs";

const SHA = /^[0-9a-f]{40}$/;

function argsFor(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!["--source-sha", "--preview-evidence", "--candidate"].includes(key) || !value || options[key]) {
      throw new Error("usage: token-vault-native-prepare-source.mjs --source-sha <sha> --preview-evidence <file> --candidate <native Linux release-source-sha directory>");
    }
    options[key] = value;
  }
  if (!SHA.test(String(options["--source-sha"] || "")) || !options["--preview-evidence"] || !options["--candidate"]) {
    throw new Error("native source candidate requires an exact SHA, preview evidence and private directory");
  }
  return options;
}

function privateCandidate(directory, sourceSha, root) {
  if (!path.isAbsolute(directory) || directory.startsWith("/mnt/") || directory.includes("\\")
    || path.basename(directory) !== `release-source-${sourceSha}`) {
    throw new Error("native source candidate must be a release-source-SHA directory on Ubuntu storage");
  }
  const relative = path.relative(root, directory);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) throw new Error("native source candidate must remain outside the repository");
  const parent = path.dirname(directory);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(parent).isSymbolicLink() || (fs.statSync(parent).mode & 0o077) !== 0) {
    throw new Error("native source candidate parent must be private");
  }
  fs.mkdirSync(directory, { mode: 0o700 });
  if ((fs.statSync(directory).mode & 0o077) !== 0) throw new Error("native source candidate directory must be private");
  return directory;
}

function sha256File(file) {
  const hash = createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const chunk = Buffer.allocUnsafe(1024 * 1024);
    const size = fs.fstatSync(fd).size;
    let position = 0;
    while (position < size) {
      const read = fs.readSync(fd, chunk, 0, Math.min(chunk.length, size - position), position);
      if (read < 1) throw new Error("native source archive changed during hashing");
      hash.update(chunk.subarray(0, read));
      position += read;
    }
    if (fs.fstatSync(fd).size !== size) throw new Error("native source archive changed during hashing");
  } finally { fs.closeSync(fd); }
  return hash.digest("hex");
}

function archiveSource(sourceSha, root, output) {
  const fd = fs.openSync(output, "wx", 0o600);
  try {
    const result = spawnSync("git", ["archive", "--format=tar.gz", `--prefix=skincos-${sourceSha}/`, sourceSha], {
      cwd: root, stdio: ["ignore", fd, "pipe"], encoding: "utf8", maxBuffer: 1024 * 1024,
    });
    fs.fsyncSync(fd);
    if (result.error || result.status !== 0) throw new Error(`native source Git archive failed (${result.status ?? "start"})`);
  } finally { fs.closeSync(fd); }
}

function main() {
  if (process.platform !== "linux" || process.env.WSL_DISTRO_NAME !== "Ubuntu-24.04" || process.getuid() === 0) {
    throw new Error("native source candidate must be built by the unprivileged Ubuntu-24.04 operator");
  }
  const options = argsFor(process.argv.slice(2));
  const root = process.cwd();
  const sourceSha = options["--source-sha"];
  const source = sourceIdentity(sourceSha, root);
  const inputDigest = releaseInputDigest(sourceSha, root);
  verifyPreviewEvidence(JSON.parse(fs.readFileSync(options["--preview-evidence"], "utf8")), {
    ...source, releaseInputDigest: inputDigest,
  });
  const closure = dependencyClosureForSource({ module: "token-vault", sourceCommit: sourceSha });
  if (closure.sourceCommit !== sourceSha || closure.sourceTree !== source.sourceTree) {
    throw new Error("native source closure differs from its selected Git tree");
  }
  const directory = privateCandidate(options["--candidate"], sourceSha, root);
  const archive = path.join(directory, "source.tar.gz");
  archiveSource(sourceSha, root, archive);
  const sourceArchiveSha256 = sha256File(archive);
  const after = sourceIdentity(sourceSha, root);
  if (after.sourceTree !== source.sourceTree || releaseInputDigest(sourceSha, root) !== inputDigest
    || dependencyClosureForSource({ module: "token-vault", sourceCommit: sourceSha }).digest !== closure.digest) {
    throw new Error("native source identity changed while the archive was created");
  }
  const identity = { schemaVersion: 1, sourceSha, sourceTree: source.sourceTree,
    releaseInputDigest: inputDigest, dependencyClosureDigest: closure.digest, sourceArchiveSha256 };
  fs.writeFileSync(path.join(directory, "identity.json"), `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  fs.writeFileSync(path.join(directory, "closure.json"), `${JSON.stringify(closure, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  process.stdout.write(`Token Vault native source candidate prepared: ${sourceSha}\nCandidate: ${directory}\nArchive SHA-256: ${sourceArchiveSha256}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
