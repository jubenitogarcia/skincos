#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  acquireGlobalLease,
  buildLeaseRequest,
  checkGlobalLease,
  proofForLease,
  releaseGlobalLease,
  renewGlobalLease,
  revokeGlobalLease,
} from "./codex-global-coordination-client.mjs";

export const ROOT = path.resolve(import.meta.dirname, "..");

function argument(args, name, fallback = null) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

function requiredArgument(args, name) {
  const value = argument(args, name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function jsonFile(args, name) {
  return JSON.parse(fs.readFileSync(path.resolve(requiredArgument(args, name)), "utf8"));
}

function proofPath(args) {
  const value = path.resolve(requiredArgument(args, "--proof-file"));
  if (value === ROOT || value.startsWith(`${ROOT}${path.sep}`) || value === path.parse(value).root) {
    throw new Error("global coordination proof must live outside the repository");
  }
  return value;
}

function writeProof(file, lease) {
  const proof = proofForLease(lease);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function publicLease(lease) {
  if (!lease) return undefined;
  return {
    schemaVersion: lease.schemaVersion,
    contractId: lease.contractId,
    resource: lease.resource,
    lockScope: lease.lockScope,
    leaseId: lease.leaseId,
    fencingToken: lease.fencingToken,
    owner: lease.owner,
    operation: lease.operation,
    idempotencyKey: lease.idempotencyKey,
    intentDigest: lease.intentDigest,
    state: lease.state,
    acquiredAt: lease.acquiredAt,
    renewedAt: lease.renewedAt,
    expiresAt: lease.expiresAt,
    releasedAt: lease.releasedAt,
    revokedAt: lease.revokedAt,
  };
}

function publicResult(result) {
  return {
    accepted: result.accepted,
    valid: result.valid,
    passed: result.passed,
    idempotent: result.idempotent,
    renewed: result.renewed,
    released: result.released,
    revoked: result.revoked,
    reason: result.reason,
    resource: result.resource,
    lockScope: result.lockScope,
    holder: result.holder,
    httpStatus: result.httpStatus,
    lease: publicLease(result.lease),
  };
}

function output(result) {
  process.stdout.write(`${JSON.stringify(publicResult(result), null, 2)}\n`);
}

async function main(args) {
  const [command] = args;
  if (command === "acquire") {
    const request = buildLeaseRequest({
      operation: requiredArgument(args, "--operation"),
      resource: requiredArgument(args, "--resource"),
      owner: jsonFile(args, "--owner-file"),
      intent: jsonFile(args, "--intent-file"),
      idempotencyKey: requiredArgument(args, "--idempotency-key"),
      ttlMs: Number(requiredArgument(args, "--ttl-ms")),
    });
    const result = await acquireGlobalLease({ request, url: argument(args, "--url", process.env.SKINCOS_GLOBAL_COORDINATOR_URL) });
    if (result.passed === true && result.lease) writeProof(proofPath(args), result.lease);
    output(result);
    if (result.passed !== true) process.exitCode = 2;
    return;
  }
  if (["check", "renew", "release", "revoke"].includes(command)) {
    const proof = JSON.parse(fs.readFileSync(proofPath(args), "utf8"));
    const options = { proof, url: argument(args, "--url", process.env.SKINCOS_GLOBAL_COORDINATOR_URL) };
    let result;
    if (command === "check") result = await checkGlobalLease(options);
    if (command === "renew") result = await renewGlobalLease({ ...options, ttlMs: Number(requiredArgument(args, "--ttl-ms")) });
    if (command === "release") result = await releaseGlobalLease(options);
    if (command === "revoke") result = await revokeGlobalLease({ ...options, reason: requiredArgument(args, "--reason") });
    if (result.passed === true && result.lease && ["renew", "release", "revoke"].includes(command)) writeProof(proofPath(args), result.lease);
    output(result);
    if (result.passed !== true) process.exitCode = 2;
    return;
  }
  throw new Error("usage: codex-global-coordination-lease.mjs acquire|check|renew|release|revoke ...");
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
