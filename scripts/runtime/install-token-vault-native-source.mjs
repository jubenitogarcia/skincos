#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { dependencyClosureForSource } from "../codex-global-coordinator.mjs";
import {
  materializeVerifiedGitSourceArchive,
  validateGitSourceArchive,
  validateMaterializedGitTree,
} from "./messaging-whatsapp-release-contract.mjs";
import { verifyTokenVaultReleaseAttestation } from "./token-vault-native-release-attestation.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const RELEASE_BASE = "/opt/skincos/releases";
const OPERATOR_STATE = path.join(os.homedir(), ".local/state/skincos/token-vault");
const FULL_SHA = /^[0-9a-f]{40}$/;
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_METADATA_BYTES = 8 * 1024 * 1024;
const CANONICAL_REMOTE = /^(?:https:\/\/github\.com\/|git@github\.com:)jubenitogarcia\/skincos(?:\.git)?$/;

function run(binary, args, { cwd = ROOT, input, maxBuffer = 1024 * 1024, allowFailure = false } = {}) {
  const result = spawnSync(binary, args, {
    cwd, input, encoding: "utf8", stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"], maxBuffer,
  });
  if (result.error || (!allowFailure && result.status !== 0)) {
    throw new Error(`${path.basename(binary)} ${args[0] || ""} failed (${result.status ?? "start"})`);
  }
  return result;
}

function git(args) {
  return run("/usr/bin/git", args).stdout.trim();
}

function sudo(args, options) {
  return run("/usr/bin/sudo", ["-n", ...args], options);
}

function regularNativeFile(file, label, maximum) {
  if (!path.isAbsolute(file) || file.startsWith("/mnt/") || file === "/mnt" || file.includes("\\")) {
    throw new Error(`${label} must use native Linux storage`);
  }
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum
    || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) {
    throw new Error(`${label} is not a private bounded regular file`);
  }
  return file;
}

function sha256Stable(file, maximum) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.size > maximum) throw new Error("native source artifact is not a bounded regular file");
    const hash = crypto.createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let offset = 0;
    while (offset < before.size) {
      const count = fs.readSync(fd, buffer, 0, Math.min(buffer.length, before.size - offset), offset);
      if (count < 1) throw new Error("native source artifact changed while hashing");
      hash.update(buffer.subarray(0, count));
      offset += count;
    }
    const after = fs.fstatSync(fd);
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size) {
      throw new Error("native source artifact changed while hashing");
    }
    return hash.digest("hex");
  } finally {
    fs.closeSync(fd);
  }
}

function nativeCandidate(directory, sourceSha) {
  if (!path.isAbsolute(directory) || directory.startsWith("/mnt/") || directory.includes("\\")
    || path.basename(directory) !== `release-source-${sourceSha}`) {
    throw new Error("candidate must be a native release-source-SHA directory");
  }
  const requested = path.resolve(directory);
  const stat = fs.lstatSync(requested);
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(requested) !== requested
    || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()) {
    throw new Error("candidate directory is not a private operator directory");
  }
  if (fs.existsSync(path.join(requested, ".git"))) throw new Error("candidate may not be a checkout");
  return requested;
}

export function inspectTokenVaultNativeCandidate({ candidateDirectory, sourceSha }) {
  if (!FULL_SHA.test(String(sourceSha || ""))) throw new Error("source SHA is invalid");
  const candidate = nativeCandidate(candidateDirectory, sourceSha);
  const archiveFile = regularNativeFile(path.join(candidate, "source.tar.gz"), "source archive", MAX_ARCHIVE_BYTES);
  const identityFile = regularNativeFile(path.join(candidate, "identity.json"), "source identity", MAX_METADATA_BYTES);
  const closureFile = regularNativeFile(path.join(candidate, "closure.json"), "source closure", MAX_METADATA_BYTES);
  const identity = verifyTokenVaultReleaseAttestation({ identityFile, closureFile, expectedSha: sourceSha });
  const archiveDigest = sha256Stable(archiveFile, MAX_ARCHIVE_BYTES);
  if (archiveDigest !== identity.sourceArchiveSha256) throw new Error("source archive checksum differs from its identity");
  const entries = validateGitSourceArchive({
    archiveFile,
    sourceCommit: sourceSha,
    sourceTree: identity.sourceTree,
  });
  if (entries.has(".skincos-token-vault-release-identity.json")
    || entries.has(".skincos-global-coordination-token-vault.json")) {
    throw new Error("source archive contains a reserved detached attestation path");
  }
  const closure = JSON.parse(fs.readFileSync(closureFile, "utf8"));
  const seen = new Set();
  for (const entry of closure.material.inputs) {
    const file = String(entry?.path || "");
    const blob = String(entry?.blob || "");
    if (!file || file.startsWith("/") || file.split("/").some((part) => !part || part === "." || part === "..")
      || !FULL_SHA.test(blob) || seen.has(file) || entries.get(file) !== blob) {
      throw new Error("source closure input differs from the verified Git archive");
    }
    seen.add(file);
  }
  return {
    candidate,
    archiveFile,
    identityFile,
    closureFile,
    sourceSha,
    ...identity,
    archiveDigest,
    identityDigest: sha256Stable(identityFile, MAX_METADATA_BYTES),
    closureFileDigest: sha256Stable(closureFile, MAX_METADATA_BYTES),
  };
}

function verifyCanonicalCheckout(candidate) {
  if (fs.realpathSync(git(["rev-parse", "--show-toplevel"])) !== fs.realpathSync(ROOT)
    || git(["rev-parse", "HEAD"]) !== candidate.sourceSha
    || git(["status", "--porcelain=v1", "--untracked-files=normal"])) {
    throw new Error("installer checkout must be clean and pinned to the source SHA");
  }
  if (!CANONICAL_REMOTE.test(git(["remote", "get-url", "origin"]))) {
    throw new Error("installer checkout origin is not the canonical SKINCOS repository");
  }
  const observedMain = git(["ls-remote", "--exit-code", "origin", "refs/heads/main"]).split(/\s+/)[0];
  if (observedMain !== candidate.sourceSha || git(["rev-parse", `${candidate.sourceSha}^{tree}`]) !== candidate.sourceTree) {
    throw new Error("candidate is not the exact current main tree");
  }
  const expectedClosure = dependencyClosureForSource({ module: "token-vault", sourceCommit: candidate.sourceSha });
  if (expectedClosure.digest !== candidate.dependencyClosureDigest) {
    throw new Error("candidate Token Vault closure differs from the selected source");
  }
  const manifest = JSON.parse(run("/usr/bin/node", [
    "scripts/codex-release-manifest.mjs", "--source", candidate.sourceSha,
    "--surface", "runtime", "--surface", "github-governance",
  ], { maxBuffer: 8 * 1024 * 1024 }).stdout);
  if (manifest.releaseInputDigest !== candidate.releaseInputDigest) {
    throw new Error("candidate release-input digest differs from the selected source");
  }
}

function sudoSha256(file) {
  const output = sudo(["/usr/bin/sha256sum", "--", file]).stdout;
  const match = /^([0-9a-f]{64})  /.exec(output);
  if (!match) throw new Error("root-owned source checksum readback is invalid");
  return match[1];
}

function sudoStat(file) {
  return sudo(["/usr/bin/stat", "-c", "%U:%G:%a:%d", "--", file]).stdout.trim();
}

function assertRootMetadata(file, { group = "admin", mode }) {
  const observed = sudoStat(file).split(":");
  if (observed.length !== 4 || observed[0] !== "root" || observed[1] !== group || observed[2] !== mode) {
    throw new Error(`installed native source metadata is invalid: ${file}`);
  }
}

function privateOperatorState() {
  fs.mkdirSync(OPERATOR_STATE, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(OPERATOR_STATE);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid()
    || (stat.mode & 0o077) !== 0 || fs.realpathSync(OPERATOR_STATE) !== OPERATOR_STATE
    || !OPERATOR_STATE.startsWith("/home/admin/")) {
    throw new Error("operator Token Vault state is not private native storage");
  }
  return OPERATOR_STATE;
}

function storeAclCheckpoint(sourceSha, previousAcl) {
  const file = path.join(privateOperatorState(), `release-parent-acl-before-${sourceSha}.txt`);
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, "utf8") !== previousAcl) {
      throw new Error("existing ACL rollback checkpoint differs from the current release parent");
    }
  } else {
    fs.writeFileSync(file, previousAcl, { flag: "wx", mode: 0o600 });
  }
  return file;
}

function assertStagePath(stage, sourceSha) {
  if (!new RegExp(`^/var/tmp/skincos-token-vault-install-${sourceSha}\\.[A-Za-z0-9]{6}$`).test(stage)) {
    throw new Error("native source installation stage path is invalid");
  }
  return stage;
}

function install(candidate) {
  const finalRoot = `${RELEASE_BASE}/${candidate.sourceSha}`;
  const base = sudoStat(RELEASE_BASE).split(":");
  if (base[0] !== "root" || base[1] !== "skincos" || base[2] !== "750") {
    throw new Error("native release parent metadata is invalid");
  }
  const stageDevice = sudoStat("/var/tmp").split(":")[3];
  if (base[3] !== stageDevice) throw new Error("native stage and release parent must share one filesystem");
  const existing = sudo(["/usr/bin/test", "-e", finalRoot], { allowFailure: true }).status;
  if (existing !== 1) {
    if (existing !== 0) throw new Error("native source release existence check failed");
    throw new Error("immutable source release already exists; it will not be overwritten");
  }

  const stage = assertStagePath(sudo([
    "/usr/bin/mktemp", "-d", `/var/tmp/skincos-token-vault-install-${candidate.sourceSha}.XXXXXX`,
  ]).stdout.trim(), candidate.sourceSha);
  const stagedSource = path.join(stage, "source");
  let extractionStage = null;
  let published = false;
  let aclChanged = false;
  let previousAcl = "";
  let aclCheckpoint = "";
  try {
    extractionStage = fs.mkdtempSync(`/var/tmp/skincos-token-vault-extract-${candidate.sourceSha}.`);
    sudo(["/usr/bin/install", "-d", "-o", "root", "-g", "admin", "-m", "0750", stage, stagedSource]);
    sudo(["/usr/bin/install", "-o", "root", "-g", "admin", "-m", "0640", candidate.archiveFile, path.join(stage, "source.tar.gz")]);
    sudo(["/usr/bin/install", "-o", "root", "-g", "admin", "-m", "0640", candidate.identityFile, path.join(stage, "identity.snapshot.json")]);
    sudo(["/usr/bin/install", "-o", "root", "-g", "admin", "-m", "0640", candidate.closureFile, path.join(stage, "closure.snapshot.json")]);
    for (const [file, digest] of [
      [path.join(stage, "source.tar.gz"), candidate.archiveDigest],
      [path.join(stage, "identity.snapshot.json"), candidate.identityDigest],
      [path.join(stage, "closure.snapshot.json"), candidate.closureFileDigest],
    ]) {
      if (sudoSha256(file) !== digest) throw new Error("root-owned source snapshot differs from the verified candidate");
    }
    const extracted = materializeVerifiedGitSourceArchive({
      archiveFile: path.join(stage, "source.tar.gz"),
      sourceCommit: candidate.sourceSha,
      sourceTree: candidate.sourceTree,
      stageDirectory: extractionStage,
    });
    sudo(["/usr/bin/cp", "-a", "--no-dereference", "--", `${extracted.sourceRoot}/.`, `${stagedSource}/`]);
    sudo(["/usr/bin/chown", "-hR", "root:admin", stagedSource]);
    sudo(["/usr/bin/chmod", "-R", "g+rX", stagedSource]);
    validateMaterializedGitTree({ sourceRoot: stagedSource, sourceTree: candidate.sourceTree });
    sudo(["/usr/bin/chmod", "-R", "o-rwx,g-w", stagedSource]);
    sudo([
      "/usr/bin/install", "-o", "root", "-g", "admin", "-m", "0640",
      path.join(stage, "identity.snapshot.json"),
      path.join(stagedSource, ".skincos-token-vault-release-identity.json"),
    ]);
    sudo([
      "/usr/bin/install", "-o", "root", "-g", "admin", "-m", "0640",
      path.join(stage, "closure.snapshot.json"),
      path.join(stagedSource, ".skincos-global-coordination-token-vault.json"),
    ]);
    sudo(["/usr/bin/rm", "--", path.join(stage, "identity.snapshot.json"), path.join(stage, "closure.snapshot.json")]);
    assertRootMetadata(stage, { mode: "750" });
    assertRootMetadata(stagedSource, { mode: "750" });
    assertRootMetadata(path.join(stage, "source.tar.gz"), { mode: "640" });
    assertRootMetadata(path.join(stagedSource, ".skincos-token-vault-release-identity.json"), { mode: "640" });
    assertRootMetadata(path.join(stagedSource, ".skincos-global-coordination-token-vault.json"), { mode: "640" });
    assertRootMetadata(path.join(stagedSource, "scripts/runtime/token-vault-native-lease-custody.sh"), { mode: "750" });
    const freshMain = git(["ls-remote", "--exit-code", "origin", "refs/heads/main"]).split(/\s+/)[0];
    if (freshMain !== candidate.sourceSha) throw new Error("remote main changed before native source publication");

    previousAcl = sudo(["/usr/bin/getfacl", "-p", RELEASE_BASE], { maxBuffer: 64 * 1024 }).stdout;
    aclCheckpoint = storeAclCheckpoint(candidate.sourceSha, previousAcl);
    sudo(["/usr/bin/setfacl", "-m", "u:admin:--x", RELEASE_BASE]);
    aclChanged = true;
    const newAcl = sudo(["/usr/bin/getfacl", "-cp", RELEASE_BASE], { maxBuffer: 64 * 1024 }).stdout;
    if (!/^user:admin:--x$/m.test(newAcl)) throw new Error("native release parent ACL readback failed");
    sudo(["/usr/bin/mv", "--no-clobber", "-T", "--", stage, finalRoot]);
    if (sudo(["/usr/bin/test", "-e", stage], { allowFailure: true }).status === 0) {
      throw new Error("native source release destination was occupied during atomic promotion");
    }
    published = true;
    for (const [file, digest] of [
      [path.join(finalRoot, "source.tar.gz"), candidate.archiveDigest],
      [path.join(finalRoot, "source/.skincos-token-vault-release-identity.json"), candidate.identityDigest],
      [path.join(finalRoot, "source/.skincos-global-coordination-token-vault.json"), candidate.closureFileDigest],
    ]) {
      if (sudoSha256(file) !== digest) throw new Error("published native source readback differs from its candidate");
    }
    assertRootMetadata(finalRoot, { mode: "750" });
    assertRootMetadata(path.join(finalRoot, "source"), { mode: "750" });
    assertRootMetadata(path.join(finalRoot, "source.tar.gz"), { mode: "640" });
    fs.accessSync(path.join(finalRoot, "source/scripts/runtime/token-vault-native-lease-custody.sh"), fs.constants.R_OK);
    return { releaseRoot: path.join(finalRoot, "source"), archiveDigest: candidate.archiveDigest, aclCheckpoint };
  } catch (error) {
    if (aclChanged && !published) {
      sudo(["/usr/bin/setfacl", "--restore=-"], { input: previousAcl });
    }
    throw error;
  } finally {
    if (extractionStage?.startsWith(`/var/tmp/skincos-token-vault-extract-${candidate.sourceSha}.`)) {
      fs.rmSync(extractionStage, { recursive: true, force: true });
    }
    if (!published && sudo(["/usr/bin/test", "-e", stage], { allowFailure: true }).status === 0) {
      assertStagePath(stage, candidate.sourceSha);
      sudo(["/usr/bin/rm", "-rf", "--", stage]);
    }
  }
}

function optionsFor(argv) {
  const options = { apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--apply" && !options.apply) { options.apply = true; continue; }
    const value = argv[++index];
    if (!["--candidate", "--source-sha"].includes(key) || !value || options[key]) {
      throw new Error("usage: install-token-vault-native-source.mjs --candidate <native dir> --source-sha <SHA> [--apply]");
    }
    options[key] = value;
  }
  if (!options["--candidate"] || !FULL_SHA.test(String(options["--source-sha"] || ""))) {
    throw new Error("native source installer requires candidate directory and full source SHA");
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.platform !== "linux" || process.env.WSL_DISTRO_NAME !== "Ubuntu-24.04" || process.getuid() !== 1000) {
      throw new Error("native source installer must run as unprivileged admin in Ubuntu-24.04");
    }
    const options = optionsFor(process.argv.slice(2));
    const candidate = inspectTokenVaultNativeCandidate({
      candidateDirectory: options["--candidate"], sourceSha: options["--source-sha"],
    });
    verifyCanonicalCheckout(candidate);
    if (options.apply) {
      const result = install(candidate);
      process.stdout.write(`${JSON.stringify({ status: "installed", sourceSha: candidate.sourceSha, ...result })}\n`);
    } else {
      process.stdout.write(`${JSON.stringify({ status: "verified", sourceSha: candidate.sourceSha,
        sourceTree: candidate.sourceTree, releaseInputDigest: candidate.releaseInputDigest,
        archiveDigest: candidate.archiveDigest })}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
