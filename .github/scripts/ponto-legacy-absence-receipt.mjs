#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SHA1 = /^[0-9a-f]{40}$/;
const SERVICE_PID = /^[1-9][0-9]{0,8}$/;
const ISO_UTC_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ABSENCE_IDS = ["ponto-store-v2", "ponto-audit-v1"];
const ATTESTATION_DIGEST_FIELDS = [
  "schemaVersion",
  "attestationId",
  "authorizationId",
  "policySha256",
  "sourceSha",
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
  exact(value, ["sourceSha", "entrypointSha256", "artifactSha256"], "RELEASE_FIELDS_INVALID");
  if (value.sourceSha !== sourceSha || !SHA1.test(value.sourceSha)) fail("RELEASE_SOURCE_SHA_INVALID");
  return {
    sourceSha: value.sourceSha,
    entrypointSha256: lowerHex(value.entrypointSha256, SHA256, "RELEASE_ENTRYPOINT_SHA256_INVALID"),
    artifactSha256: lowerHex(value.artifactSha256, SHA256, "RELEASE_ARTIFACT_SHA256_INVALID"),
  };
}

function attestationSha256(value) {
  const canonical = JSON.stringify(Object.fromEntries(
    ATTESTATION_DIGEST_FIELDS.map((field) => [field, value[field]]),
  ));
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/**
 * The workflow accepts only the small root-helper receipt below. In particular
 * it rejects paths, command lines, environment values, source content and
 * caller-added fields before an Actions artifact can be uploaded.
 */
export function validateLegacyAbsenceReceipt(value) {
  exact(value, [
    "passed",
    "schemaVersion",
    "attestationId",
    "authorizationId",
    "policySha256",
    "sourceSha",
    "attestedAt",
    "sourceFileCount",
    "absences",
    "service",
    "release",
    "credentialsIncluded",
    "piiIncluded",
    "attestationSha256",
  ], "FIELDS_INVALID");
  if (value.schemaVersion !== 1 || value.passed !== true) fail("NOT_PASSED");
  if (!UUID.test(value.attestationId) || value.attestationId !== value.authorizationId) fail("ATTESTATION_ID_INVALID");
  const policySha256 = lowerHex(value.policySha256, SHA256, "POLICY_SHA256_INVALID");
  const sourceSha = lowerHex(value.sourceSha, SHA1, "SOURCE_SHA_INVALID");
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
  return { passed: true, ...canonical, attestationSha256: value.attestationSha256 };
}

export function validateLegacyAbsenceReceiptFile(file) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    fail("JSON_INVALID");
  }
  return validateLegacyAbsenceReceipt(value);
}

const invokedAsScript = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsScript) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "validate") fail("USAGE_INVALID");
    process.stdout.write(`${JSON.stringify(validateLegacyAbsenceReceiptFile(process.argv[3]))}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "PONTO_LEGACY_ABSENCE_RECEIPT_INVALID"}\n`);
    process.exitCode = 2;
  }
}
