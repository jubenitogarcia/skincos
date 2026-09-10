import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  canonicalAtendimentoCrmCoreProjectionBackfillReceipt,
  validateAtendimentoCrmCoreProjectionBackfillReceipt,
} from "./atendimento-crm-core-projection-backfill-receipt.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const workflowRunId = "34519867372";
const receiptKeyId = "atendimento-crm-core-receipt-v1";
const signing = crypto.generateKeyPairSync("ed25519");
const receiptPublicKeyPem = signing.publicKey.export({ type: "spki", format: "pem" });
const digest = (character) => `sha256:${character.repeat(64)}`;
const script = fileURLToPath(new URL("./atendimento-crm-core-projection-backfill-receipt.mjs", import.meta.url));

function validationOptions() {
  return {
    expectedReceiptSigningKeyId: receiptKeyId,
    expectedReceiptSigningPublicKeyPem: receiptPublicKeyPem,
    expectedWorkflowRunId: workflowRunId,
    expectedRunAttempt: 1,
  };
}

function unsigned() {
  return {
    schemaVersion: 2,
    passed: true,
    receiptId: id,
    authorizationId: id,
    sourceSha: "a".repeat(40),
    admissionPlanSha256: "b".repeat(64),
    workflowRunId,
    runAttempt: 1,
    target: {
      environment: "staging",
      repository: "jubenitogarcia/skincos-crm-core",
      repositoryId: "1353934107",
      release: "c".repeat(40),
      artifactDigest: digest("d"),
      artifactRunId: "34519867370",
      readbackDigest: digest("e"),
      readbackRunId: "34519867371",
    },
    source: {
      database: "skincos_clientes_production",
      principal: "crm_core_projection_exporter",
      sessionPrincipal: "crm_core_projection_exporter",
      readOnly: true,
      identityGraphCheckpointDigest: digest("f"),
      membershipDigest: digest("1"),
    },
    preparation: {
      state: "baseline-prepared",
      capturedAt: "2026-09-10T20:00:00.000Z",
      rowCount: 21,
      eventCount: 21,
      batchCount: 2,
      batchDigests: [digest("2"), digest("3")],
      manifestDigest: digest("4"),
      packetSetDigest: digest("5"),
    },
    credentialsIncluded: false,
    piiIncluded: false,
    rawIdentifiersIncluded: false,
  };
}

function valid() {
  const receipt = unsigned();
  receipt.receiptSignature = {
    algorithm: "Ed25519",
    keyId: receiptKeyId,
    valueBase64url: crypto.sign(
      null,
      Buffer.from(canonicalAtendimentoCrmCoreProjectionBackfillReceipt(receipt), "utf8"),
      signing.privateKey,
    ).toString("base64url"),
  };
  return receipt;
}

test("accepts only a signed, bound, staging-only baseline preparation receipt", () => {
  const receipt = validateAtendimentoCrmCoreProjectionBackfillReceipt(valid(), validationOptions());
  assert.equal(receipt.target.environment, "staging");
  assert.equal(receipt.source.readOnly, true);
  assert.equal(receipt.preparation.batchDigests.length, 2);
  assert.equal(receipt.workflowRunId, workflowRunId);
  assert.equal(JSON.stringify(receipt).includes("/var/"), false);
  assert.equal(JSON.stringify(receipt).includes("https://"), false);
});

test("rejects production, raw data extensions, forged workflow context, and any unsigned receipt mutation", () => {
  for (const mutation of [
    (value) => { value.target.environment = "production"; },
    (value) => { value.target.repositoryId = "999"; },
    (value) => { value.source.readOnly = false; },
    (value) => { value.source.row = { email: "person@example.test" }; },
    (value) => { value.rawIdentifiersIncluded = true; },
    (value) => { value.preparation.eventCount = 20; },
    (value) => { value.preparation.batchCount = 1; },
    (value) => { value.preparation.batchDigests.push(value.preparation.batchDigests[0]); },
    (value) => { value.authorizationId = "22222222-2222-4222-8222-222222222222"; },
    (value) => { value.workflowRunId = "999"; },
    (value) => { value.receiptSignature.valueBase64url = "A".repeat(86); },
  ]) {
    const value = valid();
    mutation(value);
    assert.throws(
      () => validateAtendimentoCrmCoreProjectionBackfillReceipt(value, validationOptions()),
      /ATENDIMENTO_CRM_CORE_BACKFILL_RECEIPT_/,
    );
  }
});

test("rejects an empty source because the present Core receiver cannot admit an empty allowlist", () => {
  const receipt = unsigned();
  receipt.preparation = {
    state: "baseline-prepared",
    capturedAt: "2026-09-10T20:00:00.000Z",
    rowCount: 0,
    eventCount: 0,
    batchCount: 0,
    batchDigests: [],
    manifestDigest: digest("4"),
    packetSetDigest: digest("5"),
  };
  receipt.receiptSignature = {
    algorithm: "Ed25519",
    keyId: receiptKeyId,
    valueBase64url: crypto.sign(
      null,
      Buffer.from(canonicalAtendimentoCrmCoreProjectionBackfillReceipt(receipt), "utf8"),
      signing.privateKey,
    ).toString("base64url"),
  };
  assert.throws(
    () => validateAtendimentoCrmCoreProjectionBackfillReceipt(receipt, validationOptions()),
    /ATENDIMENTO_CRM_CORE_BACKFILL_RECEIPT_PREPARATION_COUNTS_INVALID/,
  );
});

test("CLI emits only a verified canonical receipt JSON", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "atendimento-crm-core-backfill-receipt-"));
  const input = path.join(directory, "receipt.json");
  try {
    fs.writeFileSync(input, JSON.stringify(valid()));
    const command = spawnSync(process.execPath, [script, "validate", input], {
      encoding: "utf8",
      env: {
        ...process.env,
        ATENDIMENTO_CRM_BACKFILL_CUSTODY_RECEIPT_SIGNING_KEY_ID: receiptKeyId,
        ATENDIMENTO_CRM_BACKFILL_CUSTODY_RECEIPT_SIGNING_PUBLIC_KEY: receiptPublicKeyPem,
        GITHUB_RUN_ID: workflowRunId,
        GITHUB_RUN_ATTEMPT: "1",
      },
    });
    assert.equal(command.status, 0, command.stderr);
    assert.equal(command.stderr, "");
    assert.equal(command.stdout.includes(directory), false);
    assert.equal(JSON.parse(command.stdout).receiptSignature.keyId, receiptKeyId);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
