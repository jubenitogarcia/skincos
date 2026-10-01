#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CRM_CORE_STAGING_READBACK_CUSTODY_CONTRACT = "skincos/crm-core-staging-readback-receipt-custody/v1";
export const CRM_CORE_STAGING_READBACK_RECEIPT_CONTRACT = "skincos-crm/staging-artifact-readback-receipt/v1";
export const CRM_CORE_STAGING_READBACK_SIGNATURE_CONTRACT = "skincos-crm/staging-artifact-readback-receipt-signature/v1";

const REPOSITORY = "jubenitogarcia/skincos-crm-core";
const REPOSITORY_ID = "1353934107";
const MAIN_REF = "refs/heads/main";
const STAGING_ORIGIN = "https://skincos-crm-core-staging.skincos.workers.dev";
const READBACK_WORKFLOW = ".github/workflows/crm-staging-artifact-readback.yml";
const ARTIFACT_KIND = "bundle-tree-v1";
const MAX_RECEIPT_BYTES = 64 * 1024;
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const RUN_ID = /^[1-9][0-9]{0,19}$/;
const KEY_ID = /^crm-core-staging-readback-[A-Za-z0-9._-]{1,120}$/;
const BASE64URL_SIGNATURE = /^[A-Za-z0-9_-]{86}$/;
const BASE64URL_ED25519_X = /^[A-Za-z0-9_-]{43}$/;
const FORBIDDEN_KEYS = new Set([
  "authorization", "cookie", "credential", "email", "jws", "mobile", "password",
  "privatekey", "private_key", "rawbody", "raw_body", "secret", "session", "token",
]);
const EXPECTED_CHECKS = Object.freeze([
  "artifact-identity",
  "health",
  "readiness",
  "public-health",
  "public-readiness",
  "modules-read-only",
  "projection-route-auth-required",
  "internal-route-rejected",
  "inventory-fallback-rejected",
  "unknown-route-rejected",
  "write-surface-blocked",
  "cors-origin-rejected",
  "backfill-ingestion-disabled",
  "session-requires-verified-identity",
]);
const VALIDATED_POLICY = Symbol("validated-crm-core-staging-readback-custody-policy");

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_POLICY_FILE = path.resolve(scriptDirectory, "..", "governance", "crm-core-staging-readback-receipt-custody.json");

function fail(code) {
  throw new Error(`CRM_CORE_STAGING_READBACK_CUSTODY_${code}`);
}

function plainRecord(value, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(code);
  return value;
}

function exactKeys(value, expected, code) {
  const actual = Object.keys(plainRecord(value, code)).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) fail(code);
  return value;
}

function normalized(value, pattern, code, { lowerCase = false } = {}) {
  const text = String(value || "").trim();
  const result = lowerCase ? text.toLowerCase() : text;
  if (!pattern.test(result)) fail(code);
  return result;
}

function sourceSha(value, code) {
  return normalized(value, SHA, code, { lowerCase: true });
}

function digest(value, code) {
  return normalized(value, DIGEST, code, { lowerCase: true });
}

function runId(value, code) {
  return normalized(value, RUN_ID, code);
}

function keyId(value, code) {
  return normalized(value, KEY_ID, code);
}

function canonicalValue(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail("CANONICAL_VALUE_INVALID");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  const record = plainRecord(value, "CANONICAL_VALUE_INVALID");
  return `{${Object.keys(record).sort().map((name) => `${JSON.stringify(name)}:${canonicalValue(record[name])}`).join(",")}}`;
}

export function canonicalCrmCoreStagingReadbackReceiptJson(value) {
  return canonicalValue(value);
}

function canonicalDigest(value) {
  return `sha256:${crypto.createHash("sha256").update(canonicalCrmCoreStagingReadbackReceiptJson(value), "utf8").digest("hex")}`;
}

function assertNoSensitiveKeys(value, label = "value") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSensitiveKeys(entry, `${label}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [name, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(name.toLowerCase())) fail(`SENSITIVE_KEY:${label}.${name}`);
    assertNoSensitiveKeys(entry, `${label}.${name}`);
  }
}

function exactStrings(value, expected, code) {
  if (!Array.isArray(value) || value.length !== expected.length
    || value.some((entry, index) => entry !== expected[index])) fail(code);
  return Object.freeze([...value]);
}

function publicJwk(value, code) {
  exactKeys(value, ["crv", "kty", "x"], code);
  if (value.kty !== "OKP" || value.crv !== "Ed25519" || typeof value.x !== "string" || !BASE64URL_ED25519_X.test(value.x)) {
    fail(code);
  }
  return Object.freeze({ kty: "OKP", crv: "Ed25519", x: value.x });
}

function verifierForJwk(value, code) {
  const jwk = publicJwk(value, code);
  let verifier;
  try {
    verifier = crypto.createPublicKey({ key: jwk, format: "jwk" });
  } catch {
    fail(code);
  }
  if (verifier.asymmetricKeyType !== "ed25519") fail(code);
  return Object.freeze({ jwk, verifier });
}

export function publicKeyFingerprint(value) {
  return canonicalDigest(publicJwk(value, "PUBLIC_KEY_INVALID"));
}

function assertPolicySource(value) {
  exactKeys(value, ["ref", "repository", "repositoryId"], "POLICY_SOURCE_INVALID");
  if (value.repository !== REPOSITORY || value.repositoryId !== REPOSITORY_ID || value.ref !== MAIN_REF) {
    fail("POLICY_SOURCE_INVALID");
  }
  return Object.freeze({ repository: REPOSITORY, repositoryId: REPOSITORY_ID, ref: MAIN_REF });
}

function assertPolicyReceipt(value) {
  exactKeys(value, ["artifactKind", "checks", "contract", "environment", "origin", "signatureContract", "workflow"], "POLICY_RECEIPT_INVALID");
  if (
    value.contract !== CRM_CORE_STAGING_READBACK_RECEIPT_CONTRACT
    || value.signatureContract !== CRM_CORE_STAGING_READBACK_SIGNATURE_CONTRACT
    || value.environment !== "staging"
    || value.artifactKind !== ARTIFACT_KIND
    || value.origin !== STAGING_ORIGIN
    || value.workflow !== READBACK_WORKFLOW
  ) fail("POLICY_RECEIPT_INVALID");
  return Object.freeze({
    contract: CRM_CORE_STAGING_READBACK_RECEIPT_CONTRACT,
    signatureContract: CRM_CORE_STAGING_READBACK_SIGNATURE_CONTRACT,
    environment: "staging",
    artifactKind: ARTIFACT_KIND,
    origin: STAGING_ORIGIN,
    workflow: READBACK_WORKFLOW,
    checks: exactStrings(value.checks, EXPECTED_CHECKS, "POLICY_RECEIPT_INVALID"),
  });
}

function assertAuthority(value) {
  exactKeys(value, ["deploymentAuthorized", "domainChangeAuthorized", "productionAuthorized"], "POLICY_AUTHORITY_INVALID");
  if (value.deploymentAuthorized !== false || value.productionAuthorized !== false || value.domainChangeAuthorized !== false) {
    fail("POLICY_AUTHORITY_INVALID");
  }
  return Object.freeze({ deploymentAuthorized: false, productionAuthorized: false, domainChangeAuthorized: false });
}

function assertKeyRing(value, state) {
  exactKeys(value, ["acceptedKeyIds", "activeKeyId", "publicKeys"], "POLICY_KEY_RING_INVALID");
  const keys = plainRecord(value.publicKeys, "POLICY_KEY_RING_INVALID");
  const entries = Object.entries(keys);
  const accepted = value.acceptedKeyIds;
  if (!Array.isArray(accepted) || new Set(accepted).size !== accepted.length || accepted.some((entry) => typeof entry !== "string")) {
    fail("POLICY_KEY_RING_INVALID");
  }
  if (state === "public-key-pinning-pending") {
    if (value.activeKeyId !== null || accepted.length !== 0 || entries.length !== 0) fail("POLICY_KEY_RING_PENDING_INVALID");
    return Object.freeze({ state, activeKeyId: null, acceptedKeyIds: Object.freeze([]), publicKeys: Object.freeze({}) });
  }
  if (state !== "active" || entries.length < 1 || entries.length > 4) fail("POLICY_KEY_RING_INVALID");
  const activeKeyId = keyId(value.activeKeyId, "POLICY_KEY_RING_INVALID");
  const normalizedAccepted = accepted.map((entry) => keyId(entry, "POLICY_KEY_RING_INVALID"));
  if (normalizedAccepted[0] !== activeKeyId || normalizedAccepted.length !== entries.length) fail("POLICY_KEY_RING_INVALID");
  const publicKeys = Object.freeze(Object.fromEntries(entries.map(([name, entry]) => [
    keyId(name, "POLICY_KEY_RING_INVALID"),
    verifierForJwk(entry, "POLICY_PUBLIC_KEY_INVALID"),
  ])));
  if (new Set(normalizedAccepted).size !== normalizedAccepted.length
    || normalizedAccepted.some((entry) => !Object.hasOwn(publicKeys, entry))) fail("POLICY_KEY_RING_INVALID");
  return Object.freeze({
    state,
    activeKeyId,
    acceptedKeyIds: Object.freeze([...normalizedAccepted]),
    publicKeys,
  });
}

export function assertCrmCoreStagingReadbackCustodyPolicy(value) {
  if (value && value[VALIDATED_POLICY] === true) return value;
  exactKeys(value, ["authority", "contract", "keyRing", "prohibitions", "receipt", "source", "state"], "POLICY_INVALID");
  if (value.contract !== CRM_CORE_STAGING_READBACK_CUSTODY_CONTRACT
    || !["public-key-pinning-pending", "active"].includes(value.state)) fail("POLICY_INVALID");
  if (!Array.isArray(value.prohibitions) || value.prohibitions.length !== 4
    || value.prohibitions.some((entry) => typeof entry !== "string" || !entry.trim())) fail("POLICY_INVALID");
  assertNoSensitiveKeys(value, "policy");
  return Object.freeze({
    [VALIDATED_POLICY]: true,
    contract: CRM_CORE_STAGING_READBACK_CUSTODY_CONTRACT,
    state: value.state,
    source: assertPolicySource(value.source),
    receipt: assertPolicyReceipt(value.receipt),
    authority: assertAuthority(value.authority),
    keyRing: assertKeyRing(value.keyRing, value.state),
  });
}

function parseJsonFile(filename, code) {
  let raw;
  try {
    raw = fs.readFileSync(path.resolve(filename), "utf8");
  } catch {
    fail(code);
  }
  if (Buffer.byteLength(raw, "utf8") < 2 || Buffer.byteLength(raw, "utf8") > MAX_RECEIPT_BYTES) fail(code);
  try {
    return JSON.parse(raw);
  } catch {
    fail(code);
  }
}

export function readCrmCoreStagingReadbackCustodyPolicy(filename = DEFAULT_POLICY_FILE) {
  return assertCrmCoreStagingReadbackCustodyPolicy(parseJsonFile(filename, "POLICY_READ_FAILED"));
}

export function createCrmCoreStagingReadbackSigningInput(statement, signature) {
  return Object.freeze({
    contract: signature.contract,
    keyId: signature.keyId,
    publicKeyFingerprint: signature.publicKeyFingerprint,
    statement,
  });
}

function assertStatement(value, policy) {
  exactKeys(value, ["artifact", "authority", "contract", "environment", "readback", "receiptId", "source", "state"], "RECEIPT_STATEMENT_INVALID");
  if (value.contract !== policy.receipt.contract || value.state !== "verified" || value.environment !== policy.receipt.environment) {
    fail("RECEIPT_STATEMENT_INVALID");
  }
  exactKeys(value.source, ["ref", "repository", "repositoryId", "sha"], "RECEIPT_SOURCE_INVALID");
  if (value.source.repository !== policy.source.repository || value.source.repositoryId !== policy.source.repositoryId || value.source.ref !== policy.source.ref) {
    fail("RECEIPT_SOURCE_INVALID");
  }
  const sha = sourceSha(value.source.sha, "RECEIPT_SOURCE_INVALID");
  exactKeys(value.artifact, ["digest", "kind", "runId"], "RECEIPT_ARTIFACT_INVALID");
  if (value.artifact.kind !== policy.receipt.artifactKind) fail("RECEIPT_ARTIFACT_INVALID");
  const artifactDigest = digest(value.artifact.digest, "RECEIPT_ARTIFACT_INVALID");
  const artifactRunId = runId(value.artifact.runId, "RECEIPT_ARTIFACT_INVALID");
  exactKeys(value.readback, ["checks", "origin", "runId", "workflow"], "RECEIPT_READBACK_INVALID");
  if (value.readback.origin !== policy.receipt.origin || value.readback.workflow !== policy.receipt.workflow) {
    fail("RECEIPT_READBACK_INVALID");
  }
  const checks = exactStrings(value.readback.checks, policy.receipt.checks, "RECEIPT_READBACK_INVALID");
  const readbackRunId = runId(value.readback.runId, "RECEIPT_READBACK_INVALID");
  exactKeys(value.authority, ["deploymentAuthorized", "domainChangeAuthorized", "productionAuthorized"], "RECEIPT_AUTHORITY_INVALID");
  if (
    value.authority.deploymentAuthorized !== policy.authority.deploymentAuthorized
    || value.authority.productionAuthorized !== policy.authority.productionAuthorized
    || value.authority.domainChangeAuthorized !== policy.authority.domainChangeAuthorized
  ) fail("RECEIPT_AUTHORITY_INVALID");
  const receiptId = String(value.receiptId || "");
  if (receiptId !== `crm-core-staging-readback-${sha}-${artifactRunId}-${readbackRunId}`) fail("RECEIPT_ID_INVALID");
  return Object.freeze({
    contract: policy.receipt.contract,
    receiptId,
    state: "verified",
    environment: "staging",
    source: Object.freeze({ repository: REPOSITORY, repositoryId: REPOSITORY_ID, ref: MAIN_REF, sha }),
    artifact: Object.freeze({ kind: ARTIFACT_KIND, digest: artifactDigest, runId: artifactRunId }),
    readback: Object.freeze({ workflow: READBACK_WORKFLOW, origin: STAGING_ORIGIN, runId: readbackRunId, checks }),
    authority: policy.authority,
  });
}

function assertSignature(value, statement) {
  exactKeys(value, ["algorithm", "contract", "keyId", "publicKeyFingerprint", "signedStatementDigest", "value"], "RECEIPT_SIGNATURE_INVALID");
  if (value.contract !== CRM_CORE_STAGING_READBACK_SIGNATURE_CONTRACT || value.algorithm !== "Ed25519") fail("RECEIPT_SIGNATURE_INVALID");
  const normalizedKeyId = keyId(value.keyId, "RECEIPT_SIGNATURE_INVALID");
  const fingerprint = digest(value.publicKeyFingerprint, "RECEIPT_SIGNATURE_INVALID");
  const signedStatementDigest = digest(value.signedStatementDigest, "RECEIPT_SIGNATURE_INVALID");
  if (signedStatementDigest !== canonicalDigest(statement)
    || typeof value.value !== "string" || !BASE64URL_SIGNATURE.test(value.value)) fail("RECEIPT_SIGNATURE_INVALID");
  const bytes = Buffer.from(value.value, "base64url");
  if (bytes.length !== 64) fail("RECEIPT_SIGNATURE_INVALID");
  return Object.freeze({
    contract: CRM_CORE_STAGING_READBACK_SIGNATURE_CONTRACT,
    algorithm: "Ed25519",
    keyId: normalizedKeyId,
    publicKeyFingerprint: fingerprint,
    signedStatementDigest,
    value: value.value,
  });
}

function assertReceipt(value, policy) {
  exactKeys(value, ["signature", "statement"], "RECEIPT_INVALID");
  assertNoSensitiveKeys(value, "receipt");
  const statement = assertStatement(value.statement, policy);
  const signature = assertSignature(value.signature, statement);
  return Object.freeze({ statement, signature });
}

function expectedBindings(options) {
  return Object.freeze({
    sourceSha: sourceSha(options.expectedSourceSha, "EXPECTED_SOURCE_SHA_INVALID"),
    artifactDigest: digest(options.expectedArtifactDigest, "EXPECTED_ARTIFACT_DIGEST_INVALID"),
    artifactRunId: runId(options.expectedArtifactRunId, "EXPECTED_ARTIFACT_RUN_ID_INVALID"),
    readbackDigest: digest(options.expectedReadbackDigest, "EXPECTED_READBACK_DIGEST_INVALID"),
    readbackRunId: runId(options.expectedReadbackRunId, "EXPECTED_READBACK_RUN_ID_INVALID"),
  });
}

/**
 * Verifies a Core-owned, sanitized staging readback receipt against this
 * repository's reviewed public-key policy and all immutable handoff bindings.
 * It does not authorize a deploy, a domain mutation, data movement, or legacy
 * retirement; consumers must still apply their own domain gates.
 */
export function verifyCrmCoreStagingReadbackReceipt(receipt, options = {}) {
  const policy = assertCrmCoreStagingReadbackCustodyPolicy(options.policy);
  const expected = expectedBindings(options);
  if (policy.state !== "active") fail("KEY_PINNING_PENDING");
  const parsed = assertReceipt(receipt, policy);
  const verifier = policy.keyRing.publicKeys[parsed.signature.keyId];
  if (!verifier || !policy.keyRing.acceptedKeyIds.includes(parsed.signature.keyId)) fail("KEY_ID_NOT_PINNED");
  if (publicKeyFingerprint(verifier.jwk) !== parsed.signature.publicKeyFingerprint) fail("PUBLIC_KEY_FINGERPRINT_MISMATCH");
  const signatureBytes = Buffer.from(parsed.signature.value, "base64url");
  try {
    if (!crypto.verify(
      null,
      Buffer.from(canonicalCrmCoreStagingReadbackReceiptJson(
        createCrmCoreStagingReadbackSigningInput(parsed.statement, parsed.signature),
      ), "utf8"),
      verifier.verifier,
      signatureBytes,
    )) fail("SIGNATURE_MISMATCH");
  } finally {
    signatureBytes.fill(0);
  }
  if (parsed.statement.source.sha !== expected.sourceSha) fail("SOURCE_SHA_MISMATCH");
  if (parsed.statement.artifact.digest !== expected.artifactDigest) fail("ARTIFACT_DIGEST_MISMATCH");
  if (parsed.statement.artifact.runId !== expected.artifactRunId) fail("ARTIFACT_RUN_ID_MISMATCH");
  if (parsed.statement.readback.runId !== expected.readbackRunId) fail("READBACK_RUN_ID_MISMATCH");
  if (parsed.signature.signedStatementDigest !== expected.readbackDigest) fail("READBACK_DIGEST_MISMATCH");
  return Object.freeze({
    ok: true,
    contract: parsed.statement.contract,
    receiptId: parsed.statement.receiptId,
    coreReleaseSha: parsed.statement.source.sha,
    coreArtifactDigest: parsed.statement.artifact.digest,
    coreArtifactRunId: parsed.statement.artifact.runId,
    coreReadbackDigest: parsed.signature.signedStatementDigest,
    coreReadbackRunId: parsed.statement.readback.runId,
    keyId: parsed.signature.keyId,
  });
}

export function verifyCrmCoreStagingReadbackReceiptFile(filename, options = {}) {
  return verifyCrmCoreStagingReadbackReceipt(parseJsonFile(filename, "RECEIPT_READ_FAILED"), options);
}

function parseArguments(argv) {
  const values = new Map();
  const allowed = new Set([
    "--receipt",
    "--policy",
    "--expected-source-sha",
    "--expected-artifact-digest",
    "--expected-artifact-run-id",
    "--expected-readback-digest",
    "--expected-readback-run-id",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!allowed.has(name) || values.has(name)) fail("ARGUMENTS_INVALID");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail("ARGUMENTS_INVALID");
    values.set(name, value);
    index += 1;
  }
  for (const required of [
    "--receipt",
    "--expected-source-sha",
    "--expected-artifact-digest",
    "--expected-artifact-run-id",
    "--expected-readback-digest",
    "--expected-readback-run-id",
  ]) {
    if (!values.has(required)) fail("ARGUMENTS_INVALID");
  }
  return values;
}

function main() {
  const [command, ...argv] = process.argv.slice(2);
  if (command !== "verify") fail("COMMAND_INVALID");
  const args = parseArguments(argv);
  const policy = readCrmCoreStagingReadbackCustodyPolicy(args.get("--policy") || DEFAULT_POLICY_FILE);
  const summary = verifyCrmCoreStagingReadbackReceiptFile(args.get("--receipt"), {
    policy,
    expectedSourceSha: args.get("--expected-source-sha"),
    expectedArtifactDigest: args.get("--expected-artifact-digest"),
    expectedArtifactRunId: args.get("--expected-artifact-run-id"),
    expectedReadbackDigest: args.get("--expected-readback-digest"),
    expectedReadbackRunId: args.get("--expected-readback-run-id"),
  });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "CRM_CORE_STAGING_READBACK_CUSTODY_INVALID"}\n`);
    process.exitCode = 2;
  }
}
