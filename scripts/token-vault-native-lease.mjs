#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkGlobalLease,
  proofForLease,
  releaseGlobalLease,
  renewGlobalLease,
} from "./codex-global-coordination-client.mjs";
import {
  acquireWorkflowLease,
  buildWorkflowLeaseRequest,
} from "./codex-global-coordination-workflow.mjs";
import { verifyReadinessEvidence } from "./token-vault-native-readiness.mjs";
import { verifyPreviewEvidence } from "./token-vault-native-preview.mjs";
import { verifyDetachedRelease } from "./token-vault-native-release-identity.mjs";
import { verifySourceObservation } from "./token-vault-native-observe.mjs";

const SHA = /^[0-9a-f]{40}$/;
const TRANSACTION = /^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/;
const RESOURCE = "release:token-vault";

export function assertNativeCustody(env = process.env) {
  const url = String(env.SKINCOS_GLOBAL_COORDINATOR_URL || "");
  if (!/^https:\/\/[^/?#]+(?:\/v1\/leases)?$/.test(url)) throw new Error("native global coordinator HTTPS URL is unavailable");
  const active = String(env.SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY || "");
  const keyId = String(env.SKINCOS_GLOBAL_COORDINATION_KEY_ID || "");
  const legacy = String(env.SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET || "");
  if (active || keyId) {
    if (!active || !keyId || keyId === "legacy-v1") throw new Error("native active coordination custody is incomplete");
  } else if (!legacy) {
    throw new Error("native global coordination custody is unavailable");
  }
  return url;
}

function privateProofFile(value, root) {
  if (!value || !path.isAbsolute(value)) throw new Error("lease proof requires an absolute private path");
  const file = path.resolve(value);
  const lexical = path.relative(root, file);
  if (!lexical.startsWith("..") && !path.isAbsolute(lexical)) throw new Error("lease proof must remain outside the repository");
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if ((fs.statSync(path.dirname(file)).mode & 0o077) !== 0) throw new Error("lease proof directory must be private");
  const resolved = path.relative(fs.realpathSync(root), fs.realpathSync(path.dirname(file)));
  if (!resolved.startsWith("..") && !path.isAbsolute(resolved)) throw new Error("lease proof must remain outside the repository");
  return file;
}

function writeProof(file, lease) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(proofForLease(lease), null, 2)}\n`, { mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, file);
}

function readProof(file) {
  const metadata = fs.statSync(file);
  if ((metadata.mode & 0o077) !== 0) throw new Error("lease proof is not private");
  const proof = JSON.parse(fs.readFileSync(file, "utf8"));
  if (proof?.resource !== RESOURCE || !proof?.leaseId || !proof?.intentDigest) {
    throw new Error("lease proof does not belong to Token Vault");
  }
  return proof;
}

function writeMetadata(file, metadata) {
  fs.writeFileSync(`${file}.meta.json`, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600, flag: "wx" });
}

function readMetadata(file) {
  const metadataFile = `${file}.meta.json`;
  if ((fs.statSync(metadataFile).mode & 0o077) !== 0) throw new Error("lease metadata is not private");
  return JSON.parse(fs.readFileSync(metadataFile, "utf8"));
}

function observation(file, identity) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error("source observation is not private");
  return verifySourceObservation(JSON.parse(fs.readFileSync(file, "utf8")), identity);
}

function argsFor(argv) {
  const [mode, ...rest] = argv;
  if (!["acquire", "check", "renew", "release"].includes(mode)) throw new Error("usage: token-vault-native-lease.mjs acquire|check|renew|release ...");
  const options = { mode };
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!["--source-sha", "--target", "--preview-evidence", "--readiness-evidence", "--observation-file", "--proof-file", "--transaction-id"].includes(key)
      || !value || options[key]) throw new Error("invalid or repeated native lease argument");
    options[key] = value;
  }
  if (!options["--proof-file"]) throw new Error("--proof-file is required");
  if (mode !== "release") {
    if (!SHA.test(String(options["--source-sha"] || "").toLowerCase()) || !["staging", "production"].includes(options["--target"])) {
      throw new Error("full source SHA and staging|production target are required");
    }
  }
  if (mode !== "release" && !options["--observation-file"]) throw new Error("fresh source observation is required");
  if (mode === "acquire" && (!options["--preview-evidence"] || !options["--readiness-evidence"]
    || !TRANSACTION.test(String(options["--transaction-id"] || "")))) {
    throw new Error("acquire requires matching preview/readiness evidence and a stable transaction id");
  }
  return options;
}

async function checkedProof(file, sourceSha, target, root, url, observationFile, forceRenew = false) {
  const proof = readProof(file);
  const { identity } = verifyDetachedRelease({ root, sourceSha });
  observation(observationFile, identity);
  const metadata = readMetadata(file);
  if (metadata.sourceSha !== sourceSha || metadata.target !== target || metadata.intentDigest !== proof.intentDigest
    || metadata.releaseInputDigest !== identity.releaseInputDigest) {
    throw new Error("Token Vault lease metadata differs from the selected release");
  }
  const authorize = async (currentProof) => checkGlobalLease({
    proof: currentProof,
    url,
    authorization: {
      expectedResource: RESOURCE,
      expectedIntentDigest: currentProof.intentDigest,
      observedDependencyClosureDigest: identity.dependencyClosureDigest,
    },
  });
  let result = await authorize(proof);
  if (result?.passed !== true) throw new Error("native Token Vault lease authorization failed");
  const expiresAt = Number(result.lease?.expiresAt);
  if (!Number.isSafeInteger(expiresAt)) throw new Error("native Token Vault lease has no exact expiry");
  if (forceRenew || expiresAt - Date.now() <= 5 * 60_000) {
    const renewed = await renewGlobalLease({ proof, url, ttlMs: 900_000 });
    if (renewed?.passed !== true || !renewed.lease) throw new Error("native Token Vault lease renewal failed");
    writeProof(file, renewed.lease);
    result = await authorize(readProof(file));
    if (result?.passed !== true) throw new Error("native Token Vault renewed lease authorization failed");
  }
  return result;
}

async function main() {
  if (process.platform !== "linux" || process.env.WSL_DISTRO_NAME !== "Ubuntu-24.04") {
    throw new Error("native Token Vault lease must run in Ubuntu-24.04 through the typed WSL boundary");
  }
  const options = argsFor(process.argv.slice(2));
  const root = process.cwd();
  const file = privateProofFile(options["--proof-file"], root);
  const url = assertNativeCustody();
  if (options.mode === "release") {
    const proof = readProof(file);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const result = await releaseGlobalLease({ proof, url });
      if (result?.passed === true) {
        if (result.lease) writeProof(file, result.lease);
        process.stdout.write("Token Vault native release lease relinquished\n");
        return;
      }
      if (attempt === 5) throw new Error("native Token Vault lease release failed after five bounded attempts");
      await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
    }
  }
  const sourceSha = options["--source-sha"].toLowerCase();
  const { identity, closure } = verifyDetachedRelease({ root, sourceSha });
  observation(options["--observation-file"], identity);
  if (options.mode === "check" || options.mode === "renew") {
    await checkedProof(file, sourceSha, options["--target"], root, url, options["--observation-file"], options.mode === "renew");
    process.stdout.write("Token Vault native release lease authorized\n");
    return;
  }
  if (fs.existsSync(file)) throw new Error("lease proof path already exists; use a new transaction identity");
  const preview = verifyPreviewEvidence(JSON.parse(fs.readFileSync(options["--preview-evidence"], "utf8")), {
    sourceSha: identity.sourceSha,
    sourceTree: identity.sourceTree,
    releaseInputDigest: identity.releaseInputDigest,
  });
  const readiness = verifyReadinessEvidence(JSON.parse(fs.readFileSync(options["--readiness-evidence"], "utf8")), {
    target: options["--target"],
    sourceSha: identity.sourceSha,
    sourceTree: identity.sourceTree,
    releaseInputDigest: identity.releaseInputDigest,
    previewEvidenceDigest: preview.evidenceDigest,
  });
  process.env.GLOBAL_COORDINATION_PROVIDER = "codex";
  process.env.GLOBAL_COORDINATION_MISSION_ID = `token-vault-native:${options["--transaction-id"]}`;
  process.env.GLOBAL_COORDINATION_THREAD_ID = process.env.CODEX_THREAD_ID || `token-vault-native:${options["--transaction-id"]}`;
  process.env.GLOBAL_COORDINATION_ACTOR = "admin";
  const { request } = buildWorkflowLeaseRequest({
    resource: RESOURCE,
    module: "token-vault",
    source: sourceSha,
    closure,
    operation: "mutation",
    idempotencyKey: `codex:token-vault:${options["--target"]}:${sourceSha}:${options["--transaction-id"]}`,
    inputs: {
      target: options["--target"],
      previewEvidenceDigest: preview.evidenceDigest,
      readinessEvidenceDigest: readiness.evidenceDigest,
    },
  });
  const acquired = await acquireWorkflowLease({ request, url, maxWaitMs: 0 });
  if (acquired?.passed !== true || !acquired.lease) throw new Error("native Token Vault release lease was not acquired");
  try {
    writeProof(file, acquired.lease);
    writeMetadata(file, { sourceSha, target: options["--target"],
      releaseInputDigest: identity.releaseInputDigest, intentDigest: proofForLease(acquired.lease).intentDigest,
      previewEvidenceDigest: preview.evidenceDigest, readinessEvidenceDigest: readiness.evidenceDigest });
    await checkedProof(file, sourceSha, options["--target"], root, url, options["--observation-file"]);
    process.stdout.write(`Token Vault native release lease acquired: ${RESOURCE}\nProof: ${file}\n`);
  } catch (error) {
    const released = await releaseGlobalLease({ proof: proofForLease(acquired.lease), url });
    if (released?.passed === true && released.lease) writeProof(file, released.lease);
    throw error;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try { await main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
