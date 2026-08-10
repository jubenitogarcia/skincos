#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  dependencyClosureForSource,
} from "./codex-global-coordinator.mjs";
import {
  acquireGlobalLease,
  buildLeaseRequest,
  checkGlobalLease,
  proofForLease,
  releaseGlobalLease,
  renewGlobalLease,
  revokeGlobalLease,
  sha256,
} from "./codex-global-coordination-client.mjs";
import { canonicalJson } from "../ops/governance/global-coordination-core.mjs";

export const ROOT = path.resolve(import.meta.dirname, "..");
const FULL_SHA = /^[0-9a-f]{40}$/i;
const DIGEST = /^[0-9a-f]{64}$/i;

function argument(args, name, fallback = null) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

function requiredArgument(args, name) {
  const value = argument(args, name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function jsonFile(args, name, fallback = null) {
  const value = argument(args, name);
  return value ? JSON.parse(fs.readFileSync(path.resolve(value), "utf8")) : fallback;
}

function safeIdSegment(value, fallback) {
  const normalized = String(value || fallback).trim().replace(/[^A-Za-z0-9._:/-]+/g, "-");
  if (!normalized) throw new Error("global coordination owner identifier is unavailable");
  return normalized.slice(0, 200);
}

function proofPath(args) {
  const value = path.resolve(requiredArgument(args, "--proof-file"));
  if (value === ROOT || value.startsWith(`${ROOT}${path.sep}`) || value === path.parse(value).root) {
    throw new Error("global coordination proof must live outside the repository");
  }
  return value;
}

function sourceFor(args) {
  const source = String(argument(args, "--source", process.env.GITHUB_SHA || "HEAD") || "").trim();
  if (source.toLowerCase() === "head") return "HEAD";
  const normalized = source.toLowerCase();
  if (!FULL_SHA.test(normalized)) throw new Error("global coordination source must be a full commit SHA");
  return normalized;
}

export function closureFromFile(args, { module, source }) {
  const file = argument(args, "--closure-file");
  if (!file) return null;
  const closure = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  const expectedModule = String(module || "").trim().toLowerCase();
  const sourceCommit = String(closure.sourceCommit || "").trim().toLowerCase();
  const sourceTree = String(closure.sourceTree || "").trim().toLowerCase();
  const digest = String(closure.digest || closure.dependencyClosureDigest || "").trim().toLowerCase();
  if (String(closure.module || "").trim().toLowerCase() !== expectedModule) {
    throw new Error("global coordination closure module does not match the requested module");
  }
  if (!FULL_SHA.test(sourceCommit) || !FULL_SHA.test(sourceTree) || !DIGEST.test(digest)) {
    throw new Error("global coordination closure identity is invalid");
  }
  if (source !== "HEAD" && sourceCommit !== source.toLowerCase()) {
    throw new Error("global coordination closure source does not match the requested source");
  }
  if (!closure.material || closure.material.schemaVersion !== 1 || closure.material.module !== expectedModule || !Array.isArray(closure.material.inputs)) {
    throw new Error("global coordination closure material is invalid");
  }
  if (sha256(canonicalJson(closure.material)) !== digest) {
    throw new Error("global coordination closure digest does not match its material");
  }
  return {
    schemaVersion: 1,
    module: expectedModule,
    sourceCommit,
    sourceTree,
    inputs: closure.inputs || closure.material.inputs,
    ...(Array.isArray(closure.dependencyClosurePaths) ? { dependencyClosurePaths: closure.dependencyClosurePaths } : {}),
    ...(Array.isArray(closure.dependencyClosurePatterns) ? { dependencyClosurePatterns: closure.dependencyClosurePatterns } : {}),
    ...(Array.isArray(closure.dependencyClosureSharedInputPaths) ? { dependencyClosureSharedInputPaths: closure.dependencyClosureSharedInputPaths } : {}),
    dependencyClosureSharedInputs: closure.dependencyClosureSharedInputs === true,
    digest,
    material: closure.material,
  };
}

function closureFor(args, { module, source }) {
  return closureFromFile(args, { module, source })
    || dependencyClosureForSource({ module, sourceCommit: source });
}

function repositoryOwner({ resource, args }) {
  const provider = String(process.env.GLOBAL_COORDINATION_PROVIDER || "github").trim().toLowerCase();
  const repository = String(process.env.GITHUB_REPOSITORY || "local/repository").trim();
  const runId = String(process.env.GITHUB_RUN_ID || "local").trim();
  const workflow = String(process.env.GITHUB_WORKFLOW || "codex-local-workflow").trim();
  return {
    provider,
    missionId: safeIdSegment(process.env.GLOBAL_COORDINATION_MISSION_ID || `${provider}:${repository}:${runId}`),
    threadId: safeIdSegment(process.env.GLOBAL_COORDINATION_THREAD_ID || `${workflow}:${runId}:${resource}`),
    actor: safeIdSegment(process.env.GLOBAL_COORDINATION_ACTOR || process.env.GITHUB_ACTOR || "github-actions"),
    ...(process.env.GITHUB_RUN_ID ? { runId } : {}),
  };
}

export function buildWorkflowLeaseRequest({
  resource,
  module,
  source = process.env.GITHUB_SHA || "HEAD",
  operation = "mutation",
  idempotencyKey,
  inputs = null,
  closure: closureOverride = null,
  releaseIdentity = null,
}) {
  const normalizedSource = String(source || "").trim();
  const closure = closureOverride || dependencyClosureForSource({ module, sourceCommit: normalizedSource });
  const owner = repositoryOwner({ resource });
  const normalizedOperation = String(operation).trim().toLowerCase();
  if (["release", "promotion"].includes(normalizedOperation)) {
    if (!releaseIdentity || typeof releaseIdentity !== "object" || Array.isArray(releaseIdentity)) {
      throw new Error("release identity is required");
    }
    if (
      String(releaseIdentity.module || "").trim().toLowerCase() !== String(module || "").trim().toLowerCase()
      || String(releaseIdentity.sourceCommit || "").trim().toLowerCase() !== closure.sourceCommit
      || String(releaseIdentity.sourceTree || "").trim().toLowerCase() !== closure.sourceTree
      || String(releaseIdentity.dependencyClosureDigest || "").trim().toLowerCase() !== closure.digest
    ) {
      throw new Error("release identity does not match the observed dependency closure");
    }
  }
  const exactClosurePaths = closure.dependencyClosurePaths || closure.inputs.map((entry) => entry.path);
  const closurePatterns = [...new Set([
    ...(closure.dependencyClosurePatterns || []),
    ...(closure.dependencyClosureSharedInputPaths || []),
  ])].sort();
  const intent = {
    module: String(module || "").trim().toLowerCase(),
    workflow: String(process.env.GITHUB_WORKFLOW || "codex-local-workflow").trim(),
    event: String(process.env.GITHUB_EVENT_NAME || "workflow_dispatch").trim(),
    sourceCommit: closure.sourceCommit,
    sourceTree: closure.sourceTree,
    dependencyClosureDigest: closure.digest,
    ...(String(module || "").trim().toLowerCase() !== "merge" && exactClosurePaths.length <= 1024
      ? { dependencyClosurePaths: exactClosurePaths }
      : {}),
    dependencyClosurePatterns: closurePatterns,
    dependencyClosureSharedInputs: closure.dependencyClosureSharedInputs === true,
    ...(inputs ? { inputs } : {}),
    ...(["release", "promotion"].includes(normalizedOperation)
      ? { releaseIdentity }
      : {}),
  };
  return {
    request: buildLeaseRequest({
      operation,
      resource,
      owner,
      intent,
      idempotencyKey: idempotencyKey || `${owner.missionId}:${resource}:${operation}`,
      ttlMs: 900_000,
    }),
    closure,
  };
}

function writeProof(file, lease) {
  const proof = proofForLease(lease);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function output(result, file = null) {
  const rendered = `${JSON.stringify(result, null, 2)}\n`;
  if (file) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, rendered, { mode: 0o600 });
  }
  process.stdout.write(rendered);
}

function resultFile(args) {
  const value = argument(args, "--result-file");
  return value ? path.resolve(value) : null;
}

function urlFor(args) {
  return argument(args, "--url", process.env.SKINCOS_GLOBAL_COORDINATOR_URL);
}

async function main(args) {
  const [command] = args;
  if (command === "closure") {
    const module = requiredArgument(args, "--module");
    const source = sourceFor(args);
    const closure = dependencyClosureForSource({ module, sourceCommit: source });
    output(closure, resultFile(args));
    return;
  }
  if (command === "acquire") {
    const resource = requiredArgument(args, "--resource");
    const module = requiredArgument(args, "--module");
    const source = sourceFor(args);
    const closure = closureFor(args, { module, source });
    const operation = argument(args, "--operation", "mutation");
    const { request } = buildWorkflowLeaseRequest({
      resource,
      module,
      source,
      operation,
      idempotencyKey: argument(args, "--idempotency-key"),
      inputs: jsonFile(args, "--inputs-file"),
      closure,
      releaseIdentity: ["release", "promotion"].includes(String(operation).trim().toLowerCase())
        ? jsonFile(args, "--release-identity-file")
        : null,
    });
    const result = await acquireGlobalLease({ request, url: urlFor(args) });
    if (result.passed === true && result.lease) writeProof(proofPath(args), result.lease);
    output(result, resultFile(args));
    if (result.passed !== true) process.exitCode = 2;
    return;
  }

  if (["check", "renew", "release", "revoke"].includes(command)) {
    const proof = JSON.parse(fs.readFileSync(proofPath(args), "utf8"));
    const options = { proof, url: urlFor(args) };
    let result;
    if (command === "check") {
      const source = sourceFor(args);
      const module = requiredArgument(args, "--module");
      const closure = closureFor(args, { module, source });
      const candidateSource = argument(args, "--candidate-source");
      if (candidateSource) {
        const candidate = String(candidateSource).trim().toLowerCase();
        if (!FULL_SHA.test(candidate)) throw new Error("global coordination candidate source must be a full commit SHA");
        const candidateClosure = dependencyClosureForSource({ module, sourceCommit: candidate });
        if (candidateClosure.digest !== closure.digest) {
          throw new Error("a relevant dependency-closure input changed after the immutable release was selected");
        }
      }
      result = await checkGlobalLease({
        ...options,
        authorization: {
          expectedResource: requiredArgument(args, "--resource"),
          expectedIntentDigest: proof.intentDigest,
          observedDependencyClosureDigest: closure.digest,
        },
      });
    }
    if (command === "renew") result = await renewGlobalLease({ ...options, ttlMs: 900_000 });
    if (command === "release") result = await releaseGlobalLease(options);
    if (command === "revoke") result = await revokeGlobalLease({ ...options, reason: requiredArgument(args, "--reason") });
    if (result.passed === true && result.lease && ["renew", "release", "revoke"].includes(command)) writeProof(proofPath(args), result.lease);
    output(result, resultFile(args));
    if (result.passed !== true) process.exitCode = 2;
    return;
  }
  throw new Error("usage: codex-global-coordination-workflow.mjs closure|acquire|check|renew|release|revoke ...");
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
