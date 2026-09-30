#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "./codex-autonomy-lib.mjs";
import { dependencyClosureForSource } from "./codex-global-coordinator.mjs";
import { releaseInputDigest, sourceIdentity } from "./token-vault-native-preview.mjs";

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;

function git(args, root) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error || result.status !== 0) throw new Error(`native source observation Git readback failed (${result.status ?? "start"})`);
  return result.stdout.trim();
}

export function buildSourceObservation({ sourceSha, sourceTree, releaseInputDigest: inputDigest,
  selectedClosureDigest, observedMainSha, observedMainClosureDigest, observedAt = new Date().toISOString(), nonce = randomBytes(24).toString("hex") }) {
  if (![sourceSha, sourceTree, observedMainSha].every((value) => SHA.test(String(value || "")))
    || ![inputDigest, selectedClosureDigest, observedMainClosureDigest].every((value) => DIGEST.test(String(value || "")))
    || !/^[0-9a-f]{48}$/.test(nonce) || !Number.isFinite(Date.parse(observedAt))) {
    throw new Error("native source observation identity is invalid");
  }
  const body = { schemaVersion: 1, kind: "skincos-token-vault-native-source-observation",
    sourceSha, sourceTree, releaseInputDigest: inputDigest, selectedClosureDigest,
    observedMainSha, observedMainClosureDigest, observedAt, nonce };
  return { ...body, evidenceDigest: createHash("sha256").update(canonicalJson(body)).digest("hex") };
}

export function verifySourceObservation(observation, identity, { now = Date.now(), maximumAgeMs = 60_000 } = {}) {
  if (!observation || typeof observation !== "object" || Array.isArray(observation)) throw new Error("native source observation is invalid");
  const { evidenceDigest, ...body } = observation;
  if (observation.schemaVersion !== 1 || observation.kind !== "skincos-token-vault-native-source-observation"
    || !DIGEST.test(String(evidenceDigest || ""))
    || createHash("sha256").update(canonicalJson(body)).digest("hex") !== evidenceDigest
    || !SHA.test(observation.observedMainSha) || !/^[0-9a-f]{48}$/.test(observation.nonce)) {
    throw new Error("native source observation digest is invalid");
  }
  const age = now - Date.parse(observation.observedAt);
  if (!Number.isFinite(age) || age < -5_000 || age > maximumAgeMs) {
    throw new Error("native source observation is stale or from the future");
  }
  if (observation.sourceSha !== identity.sourceSha || observation.sourceTree !== identity.sourceTree
    || observation.releaseInputDigest !== identity.releaseInputDigest
    || observation.selectedClosureDigest !== identity.dependencyClosureDigest
    || observation.observedMainClosureDigest !== identity.dependencyClosureDigest) {
    throw new Error("native source observation detected a changed release dependency closure");
  }
  return observation;
}

function privateOutput(file, root) {
  if (!path.isAbsolute(file) || file.startsWith("/mnt/") || file.includes("\\")) {
    throw new Error("native source observation must use a private Ubuntu path");
  }
  const relative = path.relative(root, file);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) throw new Error("native source observation must remain outside the checkout");
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(directory).isSymbolicLink() || (fs.statSync(directory).mode & 0o077) !== 0) {
    throw new Error("native source observation directory must be private");
  }
  if (fs.existsSync(file)) throw new Error("native source observation path already exists");
  return file;
}

function parse(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!["--source-sha", "--file"].includes(key) || !value || options[key]) throw new Error("usage: token-vault-native-observe.mjs --source-sha <sha> --file <private Ubuntu path>");
    options[key] = value;
  }
  if (!SHA.test(String(options["--source-sha"] || "")) || !options["--file"]) throw new Error("source SHA and private output file are required");
  return options;
}

function main() {
  if (process.platform !== "linux" || process.env.WSL_DISTRO_NAME !== "Ubuntu-24.04" || process.getuid() === 0) {
    throw new Error("native source observation must run as the unprivileged Ubuntu operator");
  }
  const options = parse(process.argv.slice(2));
  const root = process.cwd();
  const source = sourceIdentity(options["--source-sha"], root);
  const inputDigest = releaseInputDigest(source.sourceSha, root);
  const selected = dependencyClosureForSource({ module: "token-vault", sourceCommit: source.sourceSha });
  const observedMainSha = git(["ls-remote", "--exit-code", "origin", "refs/heads/main"], root).split(/\s+/)[0]?.toLowerCase();
  if (!SHA.test(String(observedMainSha || ""))) throw new Error("remote main did not return a full SHA");
  try { git(["cat-file", "-e", `${observedMainSha}^{commit}`], root); }
  catch { git(["fetch", "--no-tags", "origin", observedMainSha], root); }
  const current = dependencyClosureForSource({ module: "token-vault", sourceCommit: observedMainSha });
  if (selected.digest !== current.digest) throw new Error("Token Vault dependency closure changed on remote main");
  const file = privateOutput(options["--file"], root);
  const observation = buildSourceObservation({ ...source, releaseInputDigest: inputDigest,
    selectedClosureDigest: selected.digest, observedMainSha, observedMainClosureDigest: current.digest });
  fs.writeFileSync(file, `${JSON.stringify(observation, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  process.stdout.write(`Token Vault source observation passed: ${observation.evidenceDigest}\nEvidence: ${file}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
