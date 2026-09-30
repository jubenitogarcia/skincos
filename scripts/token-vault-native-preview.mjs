#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "./codex-autonomy-lib.mjs";

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const REPOSITORY = "jubenitogarcia/skincos";
const WRANGLER_VERSION = "4.120.0";
const REQUIRED_CHECKS = Object.freeze([
  "tokenVaultTests",
  "localD1Migrations",
  "workerDryRun",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requireSha(value, label) {
  const normalized = String(value || "").toLowerCase();
  if (!SHA.test(normalized)) throw new Error(`${label} must be a full commit or tree SHA`);
  return normalized;
}

function requireDigest(value, label) {
  const normalized = String(value || "").toLowerCase();
  if (!DIGEST.test(normalized)) throw new Error(`${label} must be a SHA-256 digest`);
  return normalized;
}

function command(binary, args, { cwd, capture = true } = {}) {
  const result = spawnSync(binary, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = capture ? String(result.stderr || "").trim().slice(0, 600) : "";
    throw new Error(`${binary} ${args[0] || ""} failed (${result.status})${detail ? `: ${detail}` : ""}`);
  }
  return capture ? String(result.stdout || "").trim() : "";
}

function git(args, root) {
  return command("git", args, { cwd: root });
}

function parseArgs(argv) {
  const [mode, ...rest] = argv;
  if (!["preview", "verify"].includes(mode)) {
    throw new Error("usage: token-vault-native-preview.mjs preview|verify --source-sha <sha> [--file <private evidence path>]");
  }
  const options = { mode };
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!["--source-sha", "--file"].includes(key) || !value || options[key]) {
      throw new Error("invalid or repeated Token Vault native preview argument");
    }
    options[key] = value;
  }
  options.sourceSha = requireSha(options["--source-sha"], "source SHA");
  if (mode === "verify" && !options["--file"]) throw new Error("--file is required for verification");
  return options;
}

function assertCanonicalRemote(remote) {
  if (!/^(?:https:\/\/github\.com\/|git@github\.com:)jubenitogarcia\/skincos(?:\.git)?$/.test(remote)) {
    throw new Error("origin is not the canonical SKINCOS repository");
  }
}

export function sourceIdentity(sourceSha, root) {
  const canonicalRoot = fs.realpathSync(root);
  if (fs.realpathSync(git(["rev-parse", "--show-toplevel"], root)) !== canonicalRoot) {
    throw new Error("Token Vault native preview must run from the repository root");
  }
  if (git(["rev-parse", "HEAD"], root) !== sourceSha) {
    throw new Error("checkout HEAD differs from the requested immutable source SHA");
  }
  if (git(["status", "--porcelain=v1", "--untracked-files=normal"], root)) {
    throw new Error("checkout has uncommitted or untracked changes");
  }
  assertCanonicalRemote(git(["remote", "get-url", "origin"], root));
  const remoteMain = git(["ls-remote", "--exit-code", "origin", "refs/heads/main"], root).split(/\s+/)[0]?.toLowerCase();
  requireSha(remoteMain, "remote main SHA");
  try {
    git(["cat-file", "-e", `${remoteMain}^{commit}`], root);
  } catch {
    git(["fetch", "--no-tags", "origin", remoteMain], root);
  }
  if (git(["cat-file", "-t", remoteMain], root) !== "commit") {
    throw new Error("remote main is not available as a verified commit");
  }
  git(["merge-base", "--is-ancestor", sourceSha, remoteMain], root);
  return { sourceSha, sourceTree: requireSha(git(["rev-parse", `${sourceSha}^{tree}`], root), "source tree") };
}

export function releaseInputDigest(sourceSha, root) {
  const output = command("node", [
    "scripts/codex-release-manifest.mjs",
    "--source", sourceSha,
    "--surface", "runtime",
    "--surface", "github-governance",
  ], { cwd: root });
  return requireDigest(JSON.parse(output).releaseInputDigest, "release-input digest");
}

export function buildPreviewEvidence({ sourceSha, sourceTree, releaseInputDigest: inputDigest, createdAt }) {
  const identity = {
    schemaVersion: 1,
    kind: "skincos-token-vault-native-preview",
    producer: "codex-ubuntu-24.04",
    sourceRepository: REPOSITORY,
    sourceSha: requireSha(sourceSha, "source SHA"),
    sourceTree: requireSha(sourceTree, "source tree"),
    releaseInputDigest: requireDigest(inputDigest, "release-input digest"),
    checks: Object.fromEntries(REQUIRED_CHECKS.map((name) => [name, true])),
    wranglerVersion: WRANGLER_VERSION,
    createdAt: String(createdAt || new Date().toISOString()),
  };
  if (!Number.isFinite(Date.parse(identity.createdAt))) throw new Error("preview evidence timestamp is invalid");
  return { ...identity, evidenceDigest: sha256(canonicalJson(identity)) };
}

export function verifyPreviewEvidence(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("preview evidence is invalid");
  const { evidenceDigest, ...identity } = value;
  if (value.schemaVersion !== 1 || value.kind !== "skincos-token-vault-native-preview"
    || value.producer !== "codex-ubuntu-24.04" || value.sourceRepository !== REPOSITORY
    || value.wranglerVersion !== WRANGLER_VERSION
    || !REQUIRED_CHECKS.every((name) => value.checks?.[name] === true)
    || Object.keys(value.checks || {}).length !== REQUIRED_CHECKS.length) {
    throw new Error("preview evidence does not attest the complete native gate");
  }
  requireSha(value.sourceSha, "preview source SHA");
  requireSha(value.sourceTree, "preview source tree");
  requireDigest(value.releaseInputDigest, "preview release-input digest");
  requireDigest(evidenceDigest, "preview evidence digest");
  if (!Number.isFinite(Date.parse(value.createdAt))) throw new Error("preview evidence timestamp is invalid");
  if (sha256(canonicalJson(identity)) !== evidenceDigest) throw new Error("preview evidence digest does not match its contents");
  for (const key of ["sourceSha", "sourceTree", "releaseInputDigest"]) {
    if (value[key] !== expected[key]) throw new Error(`preview evidence ${key} differs from the requested release`);
  }
  return value;
}

function privateEvidencePath(requested, sourceSha, root) {
  const file = path.resolve(requested || path.join(os.homedir(), ".local", "state", "skincos", "token-vault", `${sourceSha}-preview.json`));
  const lexicalRelative = path.relative(root, file);
  if (!lexicalRelative.startsWith("..") && !path.isAbsolute(lexicalRelative)) {
    throw new Error("preview evidence must live outside the repository");
  }
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error("preview evidence directory may not be a symlink");
  if ((fs.statSync(directory).mode & 0o077) !== 0) throw new Error("preview evidence directory must be private to the operator");
  const relative = path.relative(fs.realpathSync(root), fs.realpathSync(directory));
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    throw new Error("preview evidence must live outside the repository");
  }
  if (fs.existsSync(file)) throw new Error("preview evidence already exists; do not overwrite an immutable gate result");
  return file;
}

function runPreviewChecks(root) {
  command("npm", ["--prefix", "platform/security/token-vault", "test"], { cwd: root, capture: false });
  command("npx", ["--yes", `wrangler@${WRANGLER_VERSION}`, "d1", "migrations", "apply", "skincos-token-vault", "--local", "--config", "platform/security/token-vault/wrangler.toml"], { cwd: root, capture: false });
  command("npx", ["--yes", `wrangler@${WRANGLER_VERSION}`, "deploy", "--dry-run", "--keep-vars", "--config", "platform/security/token-vault/wrangler.toml"], { cwd: root, capture: false });
}

function main() {
  if (process.platform !== "linux" || process.env.WSL_DISTRO_NAME !== "Ubuntu-24.04") {
    throw new Error("Token Vault native preview must run in Ubuntu-24.04 through the typed WSL boundary");
  }
  const options = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const source = sourceIdentity(options.sourceSha, root);
  const expected = { ...source, releaseInputDigest: releaseInputDigest(options.sourceSha, root) };
  if (options.mode === "verify") {
    const file = path.resolve(options["--file"]);
    const evidence = verifyPreviewEvidence(JSON.parse(fs.readFileSync(file, "utf8")), expected);
    process.stdout.write(`Token Vault native preview verified: ${evidence.sourceSha} ${evidence.evidenceDigest}\n`);
    return;
  }
  const file = privateEvidencePath(options["--file"], options.sourceSha, root);
  runPreviewChecks(root);
  // The checkout and remote ancestry can change while checks run. Recheck
  // immediately before writing the immutable evidence.
  const afterChecks = sourceIdentity(options.sourceSha, root);
  const currentDigest = releaseInputDigest(options.sourceSha, root);
  if (afterChecks.sourceTree !== expected.sourceTree || currentDigest !== expected.releaseInputDigest) {
    throw new Error("Token Vault release identity changed during preview checks");
  }
  const evidence = buildPreviewEvidence(expected);
  fs.writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  process.stdout.write(`Token Vault native preview passed: ${evidence.sourceSha} ${evidence.evidenceDigest}\nEvidence: ${file}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
