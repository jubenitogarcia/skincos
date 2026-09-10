import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateLegacyAbsenceReceipt } from "./ponto-legacy-absence-receipt.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const sha = "a".repeat(64);
const sourceSha = "b".repeat(40);
const workflowRunId = "456";
const receiptKeyId = "ponto-legacy-absence-receipt-v1";
const signing = crypto.generateKeyPairSync("ed25519");
const receiptPublicKeyPem = signing.publicKey.export({ type: "spki", format: "pem" });
const script = fileURLToPath(new URL("./ponto-legacy-absence-receipt.mjs", import.meta.url));

function validationOptions() {
  return {
    expectedReceiptSigningKeyId: receiptKeyId,
    expectedReceiptSigningPublicKeyPem: receiptPublicKeyPem,
    expectedSourceSha: sourceSha,
    expectedPolicySha256: sha,
    expectedWorkflowRunId: workflowRunId,
    expectedRunAttempt: 1,
  };
}

function canonical(receipt) {
  return JSON.stringify({
    schemaVersion: receipt.schemaVersion,
    attestationId: receipt.attestationId,
    authorizationId: receipt.authorizationId,
    policySha256: receipt.policySha256,
    sourceSha: receipt.sourceSha,
    workflowRunId: receipt.workflowRunId,
    runAttempt: receipt.runAttempt,
    attestedAt: receipt.attestedAt,
    sourceFileCount: receipt.sourceFileCount,
    absences: receipt.absences,
    service: receipt.service,
    release: receipt.release,
    credentialsIncluded: receipt.credentialsIncluded,
    piiIncluded: receipt.piiIncluded,
  });
}

function valid() {
  const receipt = {
    passed: true,
    schemaVersion: 1,
    attestationId: id,
    authorizationId: id,
    policySha256: sha,
    sourceSha,
    workflowRunId,
    runAttempt: 1,
    attestedAt: "2026-09-10T07:00:00.000Z",
    sourceFileCount: 2,
    absences: [
      { id: "ponto-store-v2", absent: true },
      { id: "ponto-audit-v1", absent: true },
    ],
    service: { unit: "crm.service", pid: 1234, runtimeMode: "disabled" },
    release: {
      sourceSha,
      entrypointSha256: "c".repeat(64),
      artifactSha256: "d".repeat(64),
      metadataSha256: "e".repeat(64),
    },
    credentialsIncluded: false,
    piiIncluded: false,
  };
  const serialized = canonical(receipt);
  receipt.attestationSha256 = crypto.createHash("sha256").update(serialized).digest("hex");
  receipt.receiptSignature = {
    algorithm: "Ed25519",
    keyId: receiptKeyId,
    valueBase64url: crypto.sign(null, Buffer.from(serialized, "utf8"), signing.privateKey).toString("base64url"),
  };
  return receipt;
}

test("accepts only a root-signed, current-run sanitized absence receipt", () => {
  const receipt = validateLegacyAbsenceReceipt(valid(), validationOptions());
  assert.deepEqual(receipt.absences.map((entry) => entry.id), ["ponto-store-v2", "ponto-audit-v1"]);
  assert.equal(receipt.service.runtimeMode, "disabled");
  assert.equal(JSON.stringify(receipt).includes("/var/"), false);
});

test("rejects paths, tampering, stale-run replays, and incomplete absence guarantees", () => {
  for (const mutation of [
    (value) => { value.path = "/var/lib/skincos-runtime/crm/var/core/ponto_store.v2.json"; },
    (value) => { value.absences[0].path = "/var/private"; },
    (value) => { value.service.runtimeMode = "read-only"; },
    (value) => { value.service.pid = 0; },
    (value) => { value.release.sourceSha = "c".repeat(40); },
    (value) => { value.workflowRunId = "999"; },
    (value) => { value.piiIncluded = true; },
    (value) => { value.attestationSha256 = "f".repeat(64); },
    (value) => { value.receiptSignature.valueBase64url = "A".repeat(86); },
  ]) {
    const value = valid();
    mutation(value);
    assert.throws(
      () => validateLegacyAbsenceReceipt(value, validationOptions()),
      /PONTO_LEGACY_ABSENCE_RECEIPT_/,
    );
  }
});

test("CLI emits only a verified canonical receipt JSON and fixed errors", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-legacy-absence-receipt-"));
  const input = path.join(directory, "receipt.json");
  try {
    fs.writeFileSync(input, JSON.stringify(valid()));
    const command = spawnSync(process.execPath, [script, "validate", input], {
      encoding: "utf8",
      env: {
        ...process.env,
        PONTO_LEGACY_ABSENCE_RECEIPT_SIGNING_KEY_ID: receiptKeyId,
        PONTO_LEGACY_ABSENCE_RECEIPT_SIGNING_PUBLIC_KEY: receiptPublicKeyPem,
        PONTO_LEGACY_ABSENCE_ATTESTATION_POLICY_SHA256: sha,
        RELEASE_SHA: sourceSha,
        GITHUB_RUN_ID: workflowRunId,
        GITHUB_RUN_ATTEMPT: "1",
      },
    });
    assert.equal(command.status, 0, command.stderr);
    assert.equal(command.stderr, "");
    assert.equal(command.stdout.includes(directory), false);
    assert.equal(JSON.parse(command.stdout).passed, true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
