#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  acquireLease,
  authorizeMutation,
  buildIntent,
  canonicalJson,
  checkLease,
  compareDependencyClosure,
  CONTRACT_ID,
  emptyState,
  evaluateLeaseAdmission,
  lockScopeFor,
  normalizeReleaseIdentity,
  normalizeResourceKey,
  releaseLease,
  renewLease,
  revokeLease,
  consumeNonce,
} from "../ops/governance/global-coordination-core.mjs";
import { matchesAny } from "./codex-autonomy-lib.mjs";

export { acquireLease, authorizeMutation, buildIntent, canonicalJson, checkLease, compareDependencyClosure, emptyState, evaluateLeaseAdmission, lockScopeFor, normalizeReleaseIdentity, normalizeResourceKey, releaseLease, renewLease, revokeLease, consumeNonce };
export { CONTRACT_ID };

export const ROOT = path.resolve(import.meta.dirname, "..");
export const POLICY_PATH = path.join(ROOT, "ops", "governance", "global-concurrency-policy.json");
const FULL_SHA = /^[0-9a-f]{40}$/i;
const DIGEST = /^[0-9a-f]{64}$/i;

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function loadGlobalPolicy(file = POLICY_PATH) {
  const policy = JSON.parse(fs.readFileSync(file, "utf8"));
  if (policy?.schemaVersion !== 1 || policy.contractId !== CONTRACT_ID) throw new Error("global concurrency policy contract is invalid");
  if (
    policy.authority?.mode !== "fail-closed"
    || policy.lease?.minimumTtlMs !== 30_000
    || policy.lease?.maximumTtlMs !== 900_000
    || policy.lease?.clockSkewMs !== 30_000
    || policy.lease?.renewBeforeExpiryMs !== 15_000
  ) throw new Error("global concurrency policy safety bounds are invalid");
  return policy;
}

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

export function gitTreeEntries(sourceCommit, root = ROOT) {
  const raw = execFileSync("git", ["ls-tree", "-r", sourceCommit], { cwd: root, encoding: "utf8" });
  return raw.split(/\r?\n/).filter(Boolean).map((line) => {
    const separator = line.indexOf("\t");
    if (separator < 0) throw new Error("git tree entry is malformed");
    const header = line.slice(0, separator).split(/\s+/);
    if (header[1] !== "blob" || !FULL_SHA.test(header[2])) throw new Error("git tree entry is not a blob");
    return { path: line.slice(separator + 1), blob: header[2] };
  });
}

export function dependencyClosureFromTree({ module, sourceCommit, sourceTree, entries, policy = loadGlobalPolicy() }) {
  const normalizedModule = String(module || "").trim().toLowerCase();
  const closure = policy.releaseClosures?.[normalizedModule] || policy.releaseClosures?.default;
  if (!closure || (closure.requiresExplicitClosure && !policy.releaseClosures?.[normalizedModule])) throw new Error(`release dependency closure is not defined for ${normalizedModule || "module"}`);
  if (!FULL_SHA.test(String(sourceCommit || "")) || !FULL_SHA.test(String(sourceTree || ""))) throw new Error("release closure source identity is invalid");
  const paths = new Set((closure.patterns || []).map((value) => String(value).replaceAll("\\", "/")));
  const selected = (entries || []).filter((entry) => {
    const file = String(entry.path || "").replaceAll("\\", "/");
    return (closure.patterns || []).some((pattern) => matchesAny(file, [pattern]))
      || (closure.sharedInputs && (policy.sharedInputs || []).includes(file));
  }).map((entry) => ({ path: String(entry.path).replaceAll("\\", "/"), blob: String(entry.blob).toLowerCase() }));
  if (!selected.length) throw new Error(`release dependency closure for ${normalizedModule} is empty`);
  const inputs = [...new Map(selected.map((entry) => [entry.path, entry])).values()].sort((left, right) => left.path.localeCompare(right.path));
  // The source tree remains part of the immutable release identity, but it is
  // deliberately excluded from the closure digest. Otherwise an unrelated
  // documentation change would invalidate a release whose selected inputs are
  // unchanged.
  const material = { schemaVersion: 1, module: normalizedModule, inputs };
  return {
    schemaVersion: 1,
    module: normalizedModule,
    sourceCommit: sourceCommit.toLowerCase(),
    sourceTree: sourceTree.toLowerCase(),
    inputs,
    dependencyClosurePaths: inputs.map((entry) => entry.path),
    dependencyClosurePatterns: [...(closure.patterns || [])],
    dependencyClosureSharedInputs: closure.sharedInputs === true,
    digest: sha256(canonicalJson(material)),
    material,
  };
}

export function dependencyClosureForSource({ module, sourceCommit = "HEAD", root = ROOT, policy = loadGlobalPolicy() }) {
  const source = git("rev-parse", `${sourceCommit}^{commit}`);
  const sourceTree = git("rev-parse", `${source}^{tree}`);
  return dependencyClosureFromTree({ module, sourceCommit: source, sourceTree, entries: gitTreeEntries(source, root), policy });
}

export function assertDependencyClosureUnchanged(expectedDigest, observedDigest) {
  const result = compareDependencyClosure(expectedDigest, observedDigest);
  if (!result.valid) {
    throw new Error(result.reason === "dependency-closure-changed"
      ? "a relevant dependency-closure input changed after the immutable release was selected"
      : "the current dependency closure could not be proven before mutation");
  }
  return result;
}

export function buildReleaseIdentity({ module, sourceCommit, sourceTree, dependencyClosureDigest, artifacts, predecessor = null }) {
  const identity = normalizeReleaseIdentity({ module, sourceCommit, sourceTree, dependencyClosureDigest, artifacts, predecessor });
  return {
    ...identity,
    identityDigest: sha256(canonicalJson(identity)),
  };
}

export function buildLeaseRequest({ operation, resource, owner, intent, idempotencyKey, ttlMs }) {
  const normalized = buildIntent({ operation, resource, owner, intent, idempotencyKey });
  return {
    ...normalized,
    ttlMs,
    intentDigest: sha256(canonicalJson(normalized)),
  };
}

function statePathFrom(value) {
  const candidate = path.resolve(String(value || process.env.SKINCOS_GLOBAL_COORDINATION_STATE_FILE || ""));
  if (!candidate || candidate === ROOT || candidate.startsWith(`${ROOT}${path.sep}`)) throw new Error("global coordination state must live outside the repository");
  if (candidate === path.parse(candidate).root) throw new Error("global coordination state path is too broad");
  return candidate;
}

function readStateFile(file) {
  if (!fs.existsSync(file)) return emptyState();
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeStateFile(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp.${process.pid}.${crypto.randomBytes(6).toString("hex")}`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function withStateLock(file, callback) {
  const lock = `${file}.lock`;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    fs.mkdirSync(lock, { mode: 0o700 });
  } catch {
    throw new Error("global coordination state lock is held; refusing an unsafe concurrent local mutation");
  }
  try {
    fs.writeFileSync(path.join(lock, "owner.json"), `${JSON.stringify({ pid: process.pid, host: os.hostname(), acquiredAt: new Date().toISOString() })}\n`, { mode: 0o600 });
    return callback();
  } finally {
    fs.rmSync(lock, { recursive: true, force: false });
  }
}

function argument(args, name, fallback = null) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

function requiredArgument(args, name) {
  const value = argument(args, name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function jsonArgument(args, name) {
  return JSON.parse(requiredArgument(args, name));
}

function nowArgument(args) {
  const value = argument(args, "--now", String(Date.now()));
  const now = Number(value);
  if (!Number.isInteger(now) || now < 0) throw new Error("--now must be a non-negative integer epoch in milliseconds");
  return now;
}

function output(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function mutateState(args, operation) {
  const file = statePathFrom(requiredArgument(args, "--state-file"));
  const result = withStateLock(file, () => {
    const current = readStateFile(file);
    const next = operation(current);
    if (next?.state) writeStateFile(file, next.state);
    return next;
  });
  output(result);
  if (result?.accepted === false || result?.valid === false) process.exitCode = 2;
}

async function main(args) {
  const [command] = args;
  if (command === "closure") {
    const result = dependencyClosureForSource({ module: requiredArgument(args, "--module"), sourceCommit: argument(args, "--source", "HEAD") });
    output(result);
    return;
  }
  if (command === "identity") {
    const closure = dependencyClosureForSource({ module: requiredArgument(args, "--module"), sourceCommit: argument(args, "--source", "HEAD") });
    const result = buildReleaseIdentity({
      module: closure.module,
      sourceCommit: closure.sourceCommit,
      sourceTree: closure.sourceTree,
      dependencyClosureDigest: closure.digest,
      artifacts: jsonArgument(args, "--artifacts"),
    });
    output(result);
    return;
  }
  if (command === "acquire") {
    const now = nowArgument(args);
    const owner = jsonArgument(args, "--owner");
    const intent = jsonArgument(args, "--intent");
    const request = buildLeaseRequest({
      operation: requiredArgument(args, "--operation"),
      resource: requiredArgument(args, "--resource"),
      owner,
      intent,
      idempotencyKey: requiredArgument(args, "--idempotency-key"),
      ttlMs: Number(requiredArgument(args, "--ttl-ms")),
    });
    mutateState(args, (state) => acquireLease(state, request, { now, leaseId: argument(args, "--lease-id", crypto.randomUUID()) }));
    return;
  }
  if (["check", "renew", "release", "revoke"].includes(command)) {
    const proof = {
      resource: requiredArgument(args, "--resource"),
      leaseId: requiredArgument(args, "--lease-id"),
      fencingToken: Number(requiredArgument(args, "--fencing-token")),
      intentDigest: requiredArgument(args, "--intent-digest"),
      owner: jsonArgument(args, "--owner"),
    };
    const now = nowArgument(args);
    mutateState(args, (state) => {
      if (command === "check") return checkLease(state, proof, { now });
      if (command === "renew") return renewLease(state, proof, { now, ttlMs: Number(requiredArgument(args, "--ttl-ms")) });
      if (command === "release") return releaseLease(state, proof, { now });
      return revokeLease(state, proof, { now, reason: requiredArgument(args, "--reason") });
    });
    return;
  }
  throw new Error("usage: codex-global-coordinator.mjs closure|identity|acquire|check|renew|release|revoke ...");
}

const invokedAsScript = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsScript) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
