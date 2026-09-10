#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const SAFE_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const ARTIFACT_IDS = new Set(["ponto-store-v2", "ponto-audit-v1"]);
const ISO_UTC_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SNAPSHOT_DIGEST_FIELDS = [
  "schemaVersion",
  "captureId",
  "authorizationId",
  "policySha256",
  "sourceSha",
  "capturedAt",
  "sourceFileCount",
  "artifacts",
  "credentialsIncluded",
  "piiIncluded",
];

function fail(code) {
  throw new Error(`PONTO_LEGACY_SNAPSHOT_RECEIPT_${code}`);
}

function exact(value, keys, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code);
  return value;
}

function artifact(value) {
  exact(value, ["id", "sha256", "sizeBytes"], "ARTIFACT_FIELDS_INVALID");
  if (!SAFE_ID.test(String(value.id || "")) || !ARTIFACT_IDS.has(String(value.id || ""))) fail("ARTIFACT_ID_INVALID");
  if (!SHA256.test(String(value.sha256 || "").toLowerCase())) fail("ARTIFACT_SHA256_INVALID");
  if (!Number.isSafeInteger(value.sizeBytes) || value.sizeBytes <= 0) fail("ARTIFACT_SIZE_INVALID");
  return {
    id: value.id,
    sha256: value.sha256.toLowerCase(),
    sizeBytes: value.sizeBytes,
  };
}

function snapshotSha256(value) {
  const canonical = JSON.stringify(Object.fromEntries(
    SNAPSHOT_DIGEST_FIELDS.map((field) => [field, value[field]]),
  ));
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/**
 * Accepts only the root helper's intentionally small receipt contract. In
 * particular it rejects paths, source content, exception payloads and any
 * caller-added field before a workflow can upload an Actions artifact.
 */
export function validateLegacySnapshotReceipt(value) {
  exact(value, [
    "passed",
    "schemaVersion",
    "captureId",
    "authorizationId",
    "policySha256",
    "sourceSha",
    "capturedAt",
    "sourceFileCount",
    "artifacts",
    "snapshotSha256",
    "credentialsIncluded",
    "piiIncluded",
  ], "FIELDS_INVALID");
  if (value.schemaVersion !== 1 || value.passed !== true) fail("NOT_PASSED");
  if (!UUID.test(String(value.captureId || "")) || value.captureId !== value.authorizationId) fail("CAPTURE_ID_INVALID");
  if (!SHA256.test(String(value.policySha256 || "").toLowerCase())) fail("POLICY_SHA256_INVALID");
  if (!/^[0-9a-f]{40}$/.test(String(value.sourceSha || "").toLowerCase())) fail("SOURCE_SHA_INVALID");
  let capturedAtValid = false;
  try {
    capturedAtValid = ISO_UTC_MILLIS.test(String(value.capturedAt || "")) && new Date(value.capturedAt).toISOString() === value.capturedAt;
  } catch {}
  if (!capturedAtValid) fail("CAPTURED_AT_INVALID");
  if (value.sourceFileCount !== 2 || !Array.isArray(value.artifacts) || value.artifacts.length !== 2) fail("ARTIFACT_CARDINALITY_INVALID");
  const artifacts = value.artifacts.map(artifact);
  if (
    new Set(artifacts.map((entry) => entry.id)).size !== artifacts.length
    || artifacts.length !== ARTIFACT_IDS.size
    || artifacts.some((entry, index) => entry.id !== ["ponto-store-v2", "ponto-audit-v1"][index])
  ) fail("ARTIFACT_IDS_INVALID");
  if (
    !SHA256.test(String(value.snapshotSha256 || "").toLowerCase())
    || value.snapshotSha256 !== snapshotSha256({
      schemaVersion: 1,
      captureId: value.captureId,
      authorizationId: value.authorizationId,
      policySha256: value.policySha256,
      sourceSha: value.sourceSha,
      capturedAt: value.capturedAt,
      sourceFileCount: 2,
      artifacts,
      credentialsIncluded: false,
      piiIncluded: false,
    })
  ) fail("SNAPSHOT_SHA256_INVALID");
  if (value.credentialsIncluded !== false || value.piiIncluded !== false) fail("PRIVACY_GUARANTEE_INVALID");
  return {
    schemaVersion: 1,
    passed: true,
    captureId: value.captureId.toLowerCase(),
    authorizationId: value.authorizationId.toLowerCase(),
    policySha256: value.policySha256.toLowerCase(),
    sourceSha: value.sourceSha.toLowerCase(),
    capturedAt: value.capturedAt,
    sourceFileCount: 2,
    artifacts,
    snapshotSha256: value.snapshotSha256.toLowerCase(),
    credentialsIncluded: false,
    piiIncluded: false,
  };
}

export function validateLegacySnapshotReceiptFile(file) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    fail("JSON_INVALID");
  }
  return validateLegacySnapshotReceipt(value);
}

const invokedAsScript = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsScript) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "validate") fail("USAGE_INVALID");
    process.stdout.write(`${JSON.stringify(validateLegacySnapshotReceiptFile(process.argv[3]))}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "PONTO_LEGACY_SNAPSHOT_RECEIPT_INVALID"}\n`);
    process.exitCode = 2;
  }
}
