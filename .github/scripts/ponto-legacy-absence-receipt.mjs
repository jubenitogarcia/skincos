#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SHA1 = /^[0-9a-f]{40}$/;
const SERVICE_PID = /^[1-9][0-9]{0,8}$/;
const POSITIVE_ID = /^[1-9][0-9]{0,19}$/;
const KEY_ID = /^[a-z][a-z0-9-]{1,63}$/;
const BASE64URL_SIGNATURE = /^[A-Za-z0-9_-]{86}$/;
const ISO_UTC_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ABSENCE_IDS = ["ponto-store-v2", "ponto-audit-v1"];
const ATTESTATION_DIGEST_FIELDS = [
  "schemaVersion",
  "attestationId",
  "authorizationId",
  "policySha256",
  "sourceSha",
  "workflowRunId",
  "runAttempt",
  "attestedAt",
  "sourceFileCount",
  "absences",
  "service",
  "release",
  "credentialsIncluded",
  "piiIncluded",
];

function fail(code) {
  throw new Error(`PONTO_LEGACY_ABSENCE_RECEIPT_${code}`);
}

function exact(value, keys, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code);
  return value;
}

function lowerHex(value, pattern, code) {
  if (typeof value !== "string" || !pattern.test(value)) fail(code);
  return value;
}

function exactUtc(value, code) {
  try {
    if (typeof value !== "string" || !ISO_UTC_MILLIS.test(value) || new Date(value).toISOString() !== value) {
      fail(code);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("PONTO_LEGACY_ABSENCE_RECEIPT_")) throw error;
    fail(code);
  }
  return value;
}

function absence(value) {
  exact(value, ["id", "absent"], "ABSENCE_FIELDS_INVALID");
  if (!ABSENCE_IDS.includes(value.id) || value.absent !== true) fail("ABSENCE_INVALID");
  return { id: value.id, absent: true };
}

function service(value) {
  exact(value, ["unit", "pid", "runtimeMode"], "SERVICE_FIELDS_INVALID");
  if (value.unit !== "crm.service") fail("SERVICE_UNIT_INVALID");
  if (!Number.isSafeInteger(value.pid) || !SERVICE_PID.test(String(value.pid)) || value.pid > 4_194_304) {
    fail("SERVICE_PID_INVALID");
  }
  if (value.runtimeMode !== "disabled") fail("SERVICE_RUNTIME_MODE_INVALID");
  return { unit: value.unit, pid: value.pid, runtimeMode: value.runtimeMode };
}

function release(value, sourceSha) {
  exact(value, ["sourceSha", "entrypointSha256", "artifactSha256", "metadataSha256"], "RELEASE_FIELDS_INVALID");
  if (value.sourceSha !== sourceSha || !SHA1.test(value.sourceSha)) fail("RELEASE_SOURCE_SHA_INVALID");
  return {
    sourceSha: value.sourceSha,
    entrypointSha256: lowerHex(value.entrypointSha256, SHA256, "RELEASE_ENTRYPOINT_SHA256_INVALID"),
    artifactSha256: lowerHex(value.artifactSha256, SHA256, "RELEASE_ARTIFACT_SHA256_INVALID"),
    metadataSha256: lowerHex(value.metadataSha256, SHA256, "RELEASE_METADATA_SHA256_INVALID"),
  };
}

function attestationSha256(value) {
  const canonical = JSON.stringify(Object.fromEntries(
    ATTESTATION_DIGEST_FIELDS.map((field) => [field, value[field]]),
  ));
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

function receiptVerifier(options = {}) {
  const keyId = options.expectedReceiptSigningKeyId;
  const publicKeyPem = options.expectedReceiptSigningPublicKeyPem;
  if (typeof keyId !== "string" || !KEY_ID.test(keyId)) fail("RECEIPT_SIGNING_KEY_ID_INVALID");
  if (
    typeof publicKeyPem !== "string"
    || publicKeyPem.length < 64
    || publicKeyPem.length > 8192
    || publicKeyPem.includes("\0")
    || publicKeyPem.includes("\r")
  ) fail("RECEIPT_SIGNING_PUBLIC_KEY_INVALID");
  let key;
  try {
    key = crypto.createPublicKey(publicKeyPem);
  } catch {
    fail("RECEIPT_SIGNING_PUBLIC_KEY_INVALID");
  }
  if (key.asymmetricKeyType !== "ed25519") fail("RECEIPT_SIGNING_PUBLIC_KEY_INVALID");
  return { keyId, key };
}

function expectedContext(options = {}) {
  const sourceSha = lowerHex(options.expectedSourceSha, SHA1, "EXPECTED_SOURCE_SHA_INVALID");
  const policySha256 = lowerHex(options.expectedPolicySha256, SHA256, "EXPECTED_POLICY_SHA256_INVALID");
  const workflowRunId = String(options.expectedWorkflowRunId || "");
  if (!POSITIVE_ID.test(workflowRunId)) fail("EXPECTED_WORKFLOW_RUN_ID_INVALID");
  if (options.expectedRunAttempt !== 1) fail("EXPECTED_RUN_ATTEMPT_INVALID");
  return { sourceSha, policySha256, workflowRunId, runAttempt: 1 };
}

function receiptSignature(value, canonical, verifier) {
  exact(value, ["algorithm", "keyId", "valueBase64url"], "RECEIPT_SIGNATURE_FIELDS_INVALID");
  if (
    value.algorithm !== "Ed25519"
    || value.keyId !== verifier.keyId
    || typeof value.valueBase64url !== "string"
    || !BASE64URL_SIGNATURE.test(value.valueBase64url)
  ) fail("RECEIPT_SIGNATURE_INVALID");
  const raw = Buffer.from(value.valueBase64url, "base64url");
  try {
    if (raw.length !== 64 || !crypto.verify(null, Buffer.from(canonical, "utf8"), verifier.key, raw)) {
      fail("RECEIPT_SIGNATURE_INVALID");
    }
  } finally {
    raw.fill(0);
  }
  return { algorithm: "Ed25519", keyId: value.keyId, valueBase64url: value.valueBase64url };
}

/**
 * The workflow accepts only the small root-helper receipt below. In particular
 * it rejects paths, command lines, environment values, source content and
 * caller-added fields before an Actions artifact can be uploaded.
 */
export function validateLegacyAbsenceReceipt(value, options = {}) {
  const verifier = receiptVerifier(options);
  const expected = expectedContext(options);
  exact(value, [
    "passed",
    "schemaVersion",
    "attestationId",
    "authorizationId",
    "policySha256",
    "sourceSha",
    "workflowRunId",
    "runAttempt",
    "attestedAt",
    "sourceFileCount",
    "absences",
    "service",
    "release",
    "credentialsIncluded",
    "piiIncluded",
    "attestationSha256",
    "receiptSignature",
  ], "FIELDS_INVALID");
  if (value.schemaVersion !== 1 || value.passed !== true) fail("NOT_PASSED");
  if (!UUID.test(value.attestationId) || value.attestationId !== value.authorizationId) fail("ATTESTATION_ID_INVALID");
  const policySha256 = lowerHex(value.policySha256, SHA256, "POLICY_SHA256_INVALID");
  const sourceSha = lowerHex(value.sourceSha, SHA1, "SOURCE_SHA_INVALID");
  const workflowRunId = String(value.workflowRunId || "");
  if (!POSITIVE_ID.test(workflowRunId)) fail("WORKFLOW_RUN_ID_INVALID");
  if (value.runAttempt !== 1) fail("RUN_ATTEMPT_INVALID");
  if (
    policySha256 !== expected.policySha256
    || sourceSha !== expected.sourceSha
    || workflowRunId !== expected.workflowRunId
  ) fail("WORKFLOW_CONTEXT_MISMATCH");
  const attestedAt = exactUtc(value.attestedAt, "ATTESTED_AT_INVALID");
  if (value.sourceFileCount !== 2 || !Array.isArray(value.absences) || value.absences.length !== 2) {
    fail("ABSENCE_CARDINALITY_INVALID");
  }
  const absences = value.absences.map(absence);
  if (absences.some((entry, index) => entry.id !== ABSENCE_IDS[index])) fail("ABSENCE_IDS_INVALID");
  const observedService = service(value.service);
  const observedRelease = release(value.release, sourceSha);
  if (value.credentialsIncluded !== false || value.piiIncluded !== false) fail("PRIVACY_GUARANTEE_INVALID");
  const canonical = {
    schemaVersion: 1,
    attestationId: value.attestationId,
    authorizationId: value.authorizationId,
    policySha256,
    sourceSha,
    workflowRunId,
    runAttempt: 1,
    attestedAt,
    sourceFileCount: 2,
    absences,
    service: observedService,
    release: observedRelease,
    credentialsIncluded: false,
    piiIncluded: false,
  };
  if (lowerHex(value.attestationSha256, SHA256, "ATTESTATION_SHA256_INVALID") !== attestationSha256(canonical)) {
    fail("ATTESTATION_SHA256_INVALID");
  }
  const signature = receiptSignature(value.receiptSignature, JSON.stringify(canonical), verifier);
  return { passed: true, ...canonical, attestationSha256: value.attestationSha256, receiptSignature: signature };
}

export function validateLegacyAbsenceReceiptFile(file, options = {}) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    fail("JSON_INVALID");
  }
  return validateLegacyAbsenceReceipt(value, options);
}

function environmentValidationOptions() {
  return {
    expectedReceiptSigningKeyId: process.env.PONTO_LEGACY_ABSENCE_RECEIPT_SIGNING_KEY_ID,
    expectedReceiptSigningPublicKeyPem: process.env.PONTO_LEGACY_ABSENCE_RECEIPT_SIGNING_PUBLIC_KEY,
    expectedSourceSha: process.env.RELEASE_SHA,
    expectedPolicySha256: process.env.PONTO_LEGACY_ABSENCE_ATTESTATION_POLICY_SHA256,
    expectedWorkflowRunId: process.env.GITHUB_RUN_ID,
    expectedRunAttempt: Number(process.env.GITHUB_RUN_ATTEMPT || "0"),
  };
}

const invokedAsScript = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsScript) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "validate") fail("USAGE_INVALID");
    process.stdout.write(`${JSON.stringify(validateLegacyAbsenceReceiptFile(process.argv[3], environmentValidationOptions()))}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "PONTO_LEGACY_ABSENCE_RECEIPT_INVALID"}\n`);
    process.exitCode = 2;
  }
}
