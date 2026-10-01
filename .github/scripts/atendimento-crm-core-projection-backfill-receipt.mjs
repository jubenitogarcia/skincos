#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const POSITIVE_ID = /^[1-9][0-9]{0,19}$/;
const ISO_UTC_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const KEY_ID = /^[a-z][a-z0-9-]{1,63}$/;
const ED25519_SIGNATURE = /^[A-Za-z0-9_-]{86}$/;
const RECEIPT_FIELDS = Object.freeze([
  "schemaVersion",
  "passed",
  "receiptId",
  "authorizationId",
  "sourceSha",
  "admissionPlanSha256",
  "workflowRunId",
  "runAttempt",
  "target",
  "source",
  "preparation",
  "credentialsIncluded",
  "piiIncluded",
  "rawIdentifiersIncluded",
]);
// The present CRM Core staging receiver admits at most 100 finite batch
// digests. With the fixed 20-event packets below, preparation must stop at
// 2,000 rows rather than silently split a baseline into unsafe subsets.
const MAX_ROWS = 2_000;
const MAX_EVENTS_PER_BATCH = 20;
const MAX_BATCHES = 100;

function fail(code) {
  throw new Error(`ATENDIMENTO_CRM_CORE_BACKFILL_RECEIPT_${code}`);
}

function exact(value, keys, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code);
  return value;
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function uuid(value, code) {
  const normalized = String(value || "").toLowerCase();
  if (!UUID.test(normalized)) fail(code);
  return normalized;
}

function commit(value, code) {
  const normalized = String(value || "").toLowerCase();
  if (!COMMIT.test(normalized)) fail(code);
  return normalized;
}

function sha(value, code) {
  const normalized = String(value || "").toLowerCase();
  if (!SHA.test(normalized)) fail(code);
  return normalized;
}

function digest(value, code) {
  const normalized = String(value || "").toLowerCase();
  if (!SHA256.test(normalized)) fail(code);
  return normalized;
}

function runId(value, code) {
  const normalized = String(value || "");
  if (!POSITIVE_ID.test(normalized)) fail(code);
  return normalized;
}

function timestamp(value, code) {
  const normalized = String(value || "");
  if (!ISO_UTC_MILLIS.test(normalized) || Number.isNaN(new Date(normalized).getTime()) || new Date(normalized).toISOString() !== normalized) {
    fail(code);
  }
  return normalized;
}

function nonNegativeInteger(value, code, maximum) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) fail(code);
  return value;
}

function target(value) {
  exact(value, ["artifactDigest", "artifactRunId", "environment", "readbackDigest", "readbackRunId", "release", "repository", "repositoryId"], "TARGET_FIELDS_INVALID");
  if (
    value.environment !== "staging"
    || value.repository !== "jubenitogarcia/skincos-crm-core"
    || value.repositoryId !== "1353934107"
  ) fail("TARGET_IDENTITY_INVALID");
  return Object.freeze({
    environment: "staging",
    repository: "jubenitogarcia/skincos-crm-core",
    repositoryId: "1353934107",
    release: commit(value.release, "TARGET_RELEASE_INVALID"),
    artifactDigest: digest(value.artifactDigest, "TARGET_ARTIFACT_DIGEST_INVALID"),
    artifactRunId: runId(value.artifactRunId, "TARGET_ARTIFACT_RUN_ID_INVALID"),
    readbackDigest: digest(value.readbackDigest, "TARGET_READBACK_DIGEST_INVALID"),
    readbackRunId: runId(value.readbackRunId, "TARGET_READBACK_RUN_ID_INVALID"),
  });
}

function source(value) {
  exact(value, ["database", "identityGraphCheckpointDigest", "membershipDigest", "principal", "readOnly", "sessionPrincipal"], "SOURCE_FIELDS_INVALID");
  if (
    value.database !== "skincos_clientes_production"
    || value.principal !== "crm_core_projection_exporter"
    || value.sessionPrincipal !== value.principal
    || value.readOnly !== true
  ) fail("SOURCE_IDENTITY_INVALID");
  return Object.freeze({
    database: "skincos_clientes_production",
    principal: "crm_core_projection_exporter",
    sessionPrincipal: "crm_core_projection_exporter",
    readOnly: true,
    identityGraphCheckpointDigest: digest(value.identityGraphCheckpointDigest, "SOURCE_CHECKPOINT_DIGEST_INVALID"),
    membershipDigest: digest(value.membershipDigest, "SOURCE_MEMBERSHIP_DIGEST_INVALID"),
  });
}

function preparation(value) {
  exact(value, ["batchCount", "batchDigests", "capturedAt", "eventCount", "manifestDigest", "packetSetDigest", "rowCount", "state"], "PREPARATION_FIELDS_INVALID");
  const rowCount = nonNegativeInteger(value.rowCount, "ROW_COUNT_INVALID", MAX_ROWS);
  const eventCount = nonNegativeInteger(value.eventCount, "EVENT_COUNT_INVALID", MAX_ROWS);
  const batchCount = nonNegativeInteger(value.batchCount, "BATCH_COUNT_INVALID", MAX_BATCHES);
  if (
    value.state !== "baseline-prepared"
    || rowCount < 1
    || eventCount !== rowCount
    || batchCount !== Math.ceil(rowCount / MAX_EVENTS_PER_BATCH)
    || !Array.isArray(value.batchDigests)
    || value.batchDigests.length !== batchCount
  ) fail("PREPARATION_COUNTS_INVALID");
  const batchDigests = value.batchDigests.map((entry) => digest(entry, "BATCH_DIGEST_INVALID"));
  if (new Set(batchDigests).size !== batchDigests.length) fail("BATCH_DIGESTS_DUPLICATE");
  return Object.freeze({
    state: "baseline-prepared",
    capturedAt: timestamp(value.capturedAt, "CAPTURED_AT_INVALID"),
    rowCount,
    eventCount,
    batchCount,
    batchDigests,
    manifestDigest: digest(value.manifestDigest, "MANIFEST_DIGEST_INVALID"),
    packetSetDigest: digest(value.packetSetDigest, "PACKET_SET_DIGEST_INVALID"),
  });
}

function receiptVerifier(options = {}) {
  const keyId = String(options.expectedReceiptSigningKeyId || "");
  const publicKeyPem = String(options.expectedReceiptSigningPublicKeyPem || "");
  if (!KEY_ID.test(keyId)) fail("RECEIPT_SIGNING_KEY_ID_INVALID");
  if (publicKeyPem.length < 64 || publicKeyPem.length > 8_192 || publicKeyPem.includes("\0") || publicKeyPem.includes("\r")) {
    fail("RECEIPT_SIGNING_PUBLIC_KEY_INVALID");
  }
  let key;
  try {
    key = crypto.createPublicKey(publicKeyPem);
  } catch {
    fail("RECEIPT_SIGNING_PUBLIC_KEY_INVALID");
  }
  if (key.asymmetricKeyType !== "ed25519") fail("RECEIPT_SIGNING_PUBLIC_KEY_INVALID");
  return Object.freeze({ keyId, key });
}

function expectedContext(options = {}) {
  const workflowRunId = runId(options.expectedWorkflowRunId, "EXPECTED_WORKFLOW_RUN_ID_INVALID");
  if (options.expectedRunAttempt !== 1) fail("EXPECTED_RUN_ATTEMPT_INVALID");
  return Object.freeze({ workflowRunId, runAttempt: 1 });
}

function receiptSignature(value, canonicalReceipt, verifier) {
  exact(value, ["algorithm", "keyId", "valueBase64url"], "RECEIPT_SIGNATURE_FIELDS_INVALID");
  if (
    value.algorithm !== "Ed25519"
    || value.keyId !== verifier.keyId
    || !ED25519_SIGNATURE.test(String(value.valueBase64url || ""))
  ) fail("RECEIPT_SIGNATURE_INVALID");
  const signatureBytes = Buffer.from(value.valueBase64url, "base64url");
  try {
    if (signatureBytes.length !== 64 || !crypto.verify(null, Buffer.from(canonicalReceipt, "utf8"), verifier.key, signatureBytes)) {
      fail("RECEIPT_SIGNATURE_INVALID");
    }
  } finally {
    signatureBytes.fill(0);
  }
  return Object.freeze({ algorithm: "Ed25519", keyId: verifier.keyId, valueBase64url: value.valueBase64url });
}

/**
 * Returns deterministic bytes that the root-owned helper must sign with its
 * private receipt key. The receipt schema deliberately excludes any source
 * row, endpoint, credential, path, or opaque packet payload.
 */
export function canonicalAtendimentoCrmCoreProjectionBackfillReceipt(value) {
  return canonicalJson(Object.fromEntries(RECEIPT_FIELDS.map((field) => [field, value[field]])));
}

/**
 * Accepts only an Ed25519-signed, intentionally small receipt emitted by the
 * root-owned staging preparation helper. It rejects paths, endpoint URLs,
 * rows, identifiers, credentials, and unbound target metadata before Actions
 * can upload a finite Core allowlist receipt.
 */
export function validateAtendimentoCrmCoreProjectionBackfillReceipt(value, options = {}) {
  const verifier = receiptVerifier(options);
  const expected = expectedContext(options);
  exact(value, [...RECEIPT_FIELDS, "receiptSignature"], "FIELDS_INVALID");
  if (value.schemaVersion !== 2 || value.passed !== true) fail("NOT_PASSED");
  const receiptId = uuid(value.receiptId, "RECEIPT_ID_INVALID");
  const authorizationId = uuid(value.authorizationId, "AUTHORIZATION_ID_INVALID");
  if (receiptId !== authorizationId) fail("AUTHORIZATION_BINDING_INVALID");
  if (value.credentialsIncluded !== false || value.piiIncluded !== false || value.rawIdentifiersIncluded !== false) {
    fail("PRIVACY_GUARANTEE_INVALID");
  }
  const workflowRunId = runId(value.workflowRunId, "WORKFLOW_RUN_ID_INVALID");
  if (workflowRunId !== expected.workflowRunId || value.runAttempt !== expected.runAttempt) fail("WORKFLOW_CONTEXT_MISMATCH");
  const unsigned = Object.freeze({
    schemaVersion: 2,
    passed: true,
    receiptId,
    authorizationId,
    sourceSha: commit(value.sourceSha, "SOURCE_SHA_INVALID"),
    admissionPlanSha256: sha(value.admissionPlanSha256, "ADMISSION_PLAN_SHA256_INVALID"),
    workflowRunId,
    runAttempt: 1,
    target: target(value.target),
    source: source(value.source),
    preparation: preparation(value.preparation),
    credentialsIncluded: false,
    piiIncluded: false,
    rawIdentifiersIncluded: false,
  });
  return Object.freeze({
    ...unsigned,
    receiptSignature: receiptSignature(
      value.receiptSignature,
      canonicalAtendimentoCrmCoreProjectionBackfillReceipt(unsigned),
      verifier,
    ),
  });
}

export function validateAtendimentoCrmCoreProjectionBackfillReceiptFile(file, options = {}) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    fail("JSON_INVALID");
  }
  return validateAtendimentoCrmCoreProjectionBackfillReceipt(value, options);
}

function environmentValidationOptions() {
  return {
    expectedReceiptSigningKeyId: process.env.ATENDIMENTO_CRM_BACKFILL_CUSTODY_RECEIPT_SIGNING_KEY_ID,
    expectedReceiptSigningPublicKeyPem: process.env.ATENDIMENTO_CRM_BACKFILL_CUSTODY_RECEIPT_SIGNING_PUBLIC_KEY,
    expectedWorkflowRunId: process.env.GITHUB_RUN_ID,
    expectedRunAttempt: Number(process.env.GITHUB_RUN_ATTEMPT || "0"),
  };
}

const invokedAsScript = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsScript) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "validate") fail("USAGE_INVALID");
    process.stdout.write(`${JSON.stringify(validateAtendimentoCrmCoreProjectionBackfillReceiptFile(process.argv[3], environmentValidationOptions()))}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "ATENDIMENTO_CRM_CORE_BACKFILL_RECEIPT_INVALID"}\n`);
    process.exitCode = 2;
  }
}
