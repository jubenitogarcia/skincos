#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { canonicalJson } from "../../ops/governance/global-coordination-core.mjs";

const FULL_SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;

function jsonFile(file) {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("native release attestation must contain an object");
  }
  return parsed;
}

export function verifyTokenVaultReleaseAttestation({ identityFile, closureFile, expectedSha }) {
  if (!FULL_SHA.test(String(expectedSha || ""))) throw new Error("native release SHA is invalid");
  const identity = jsonFile(identityFile);
  const closure = jsonFile(closureFile);
  if (identity.schemaVersion !== 1
    || identity.sourceSha !== expectedSha
    || !FULL_SHA.test(String(identity.sourceTree || ""))
    || !DIGEST.test(String(identity.releaseInputDigest || ""))
    || !DIGEST.test(String(identity.dependencyClosureDigest || ""))
    || !DIGEST.test(String(identity.sourceArchiveSha256 || ""))
    || closure.schemaVersion !== 1
    || closure.module !== "token-vault"
    || closure.sourceCommit !== expectedSha
    || closure.sourceTree !== identity.sourceTree
    || closure.digest !== identity.dependencyClosureDigest
    || closure.material?.schemaVersion !== 1
    || closure.material?.module !== "token-vault"
    || !Array.isArray(closure.material.inputs)
    || crypto.createHash("sha256").update(canonicalJson(closure.material)).digest("hex") !== closure.digest
  ) throw new Error("native release identity and dependency closure do not match");
  return {
    sourceSha: identity.sourceSha,
    sourceTree: identity.sourceTree,
    releaseInputDigest: identity.releaseInputDigest,
    dependencyClosureDigest: identity.dependencyClosureDigest,
    sourceArchiveSha256: identity.sourceArchiveSha256,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [identityFile, closureFile, expectedSha, extra] = process.argv.slice(2);
    if (!identityFile || !closureFile || !expectedSha || extra) throw new Error("native release attestation arguments are invalid");
    verifyTokenVaultReleaseAttestation({ identityFile, closureFile, expectedSha });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 78;
  }
}
