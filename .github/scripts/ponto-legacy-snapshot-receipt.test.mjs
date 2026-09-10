import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateLegacySnapshotReceipt } from "./ponto-legacy-snapshot-receipt.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const sha = "a".repeat(64);
const script = fileURLToPath(new URL("./ponto-legacy-snapshot-receipt.mjs", import.meta.url));
const valid = () => {
  const receipt = {
    passed: true,
    schemaVersion: 1,
    captureId: id,
    authorizationId: id,
    policySha256: sha,
    sourceSha: "b".repeat(40),
    capturedAt: "2026-09-10T07:00:00.000Z",
    sourceFileCount: 2,
    artifacts: [
      { id: "ponto-store-v2", sha256: sha, sizeBytes: 12 },
      { id: "ponto-audit-v1", sha256: "b".repeat(64), sizeBytes: 34 },
    ],
    credentialsIncluded: false,
    piiIncluded: false,
  };
  receipt.snapshotSha256 = crypto.createHash("sha256").update(JSON.stringify({
    schemaVersion: receipt.schemaVersion,
    captureId: receipt.captureId,
    authorizationId: receipt.authorizationId,
    policySha256: receipt.policySha256,
    sourceSha: receipt.sourceSha,
    capturedAt: receipt.capturedAt,
    sourceFileCount: receipt.sourceFileCount,
    artifacts: receipt.artifacts,
    credentialsIncluded: receipt.credentialsIncluded,
    piiIncluded: receipt.piiIncluded,
  })).digest("hex");
  return receipt;
};

test("accepts and canonicalizes only the root helper's sanitized receipt", () => {
  const receipt = validateLegacySnapshotReceipt(valid());
  assert.deepEqual(receipt.artifacts.map((entry) => entry.id), ["ponto-store-v2", "ponto-audit-v1"]);
  assert.equal(JSON.stringify(receipt).includes("/var/"), false);
});

test("rejects PII-bearing extensions, paths, and incomplete capture guarantees", () => {
  for (const mutation of [
    (value) => { value.path = "/var/lib/skincos-runtime/crm/var/core/ponto_store.v2.json"; },
    (value) => { value.artifacts[0].content = "person@example.test"; },
    (value) => { value.piiIncluded = true; },
    (value) => { value.authorizationId = "22222222-2222-4222-8222-222222222222"; },
    (value) => { value.snapshotSha256 = "f".repeat(64); },
  ]) {
    const value = valid();
    mutation(value);
    assert.throws(() => validateLegacySnapshotReceipt(value), /PONTO_LEGACY_SNAPSHOT_RECEIPT_/);
  }
});

test("CLI emits only canonical receipt JSON and fixed errors", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-legacy-snapshot-receipt-"));
  const input = path.join(directory, "receipt.json");
  try {
    fs.writeFileSync(input, JSON.stringify(valid()));
    const command = spawnSync(process.execPath, [script, "validate", input], { encoding: "utf8" });
    assert.equal(command.status, 0, command.stderr);
    assert.equal(command.stderr, "");
    assert.equal(command.stdout.includes(directory), false);
    assert.equal(JSON.parse(command.stdout).passed, true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
