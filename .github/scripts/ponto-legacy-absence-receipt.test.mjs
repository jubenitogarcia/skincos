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
const script = fileURLToPath(new URL("./ponto-legacy-absence-receipt.mjs", import.meta.url));

function valid() {
  const receipt = {
    passed: true,
    schemaVersion: 1,
    attestationId: id,
    authorizationId: id,
    policySha256: sha,
    sourceSha: "b".repeat(40),
    attestedAt: "2026-09-10T07:00:00.000Z",
    sourceFileCount: 2,
    absences: [
      { id: "ponto-store-v2", absent: true },
      { id: "ponto-audit-v1", absent: true },
    ],
    service: { unit: "crm.service", pid: 1234, runtimeMode: "disabled" },
    release: {
      sourceSha: "b".repeat(40),
      entrypointSha256: "c".repeat(64),
      artifactSha256: "d".repeat(64),
    },
    credentialsIncluded: false,
    piiIncluded: false,
  };
  receipt.attestationSha256 = crypto.createHash("sha256").update(JSON.stringify({
    schemaVersion: receipt.schemaVersion,
    attestationId: receipt.attestationId,
    authorizationId: receipt.authorizationId,
    policySha256: receipt.policySha256,
    sourceSha: receipt.sourceSha,
    attestedAt: receipt.attestedAt,
    sourceFileCount: receipt.sourceFileCount,
    absences: receipt.absences,
    service: receipt.service,
    release: receipt.release,
    credentialsIncluded: receipt.credentialsIncluded,
    piiIncluded: receipt.piiIncluded,
  })).digest("hex");
  return receipt;
}

test("accepts and canonicalizes only the root helper's sanitized absence receipt", () => {
  const receipt = validateLegacyAbsenceReceipt(valid());
  assert.deepEqual(receipt.absences.map((entry) => entry.id), ["ponto-store-v2", "ponto-audit-v1"]);
  assert.equal(receipt.service.runtimeMode, "disabled");
  assert.equal(JSON.stringify(receipt).includes("/var/"), false);
});

test("rejects paths, service data, PII-bearing extensions, and incomplete absence guarantees", () => {
  for (const mutation of [
    (value) => { value.path = "/var/lib/skincos-runtime/crm/var/core/ponto_store.v2.json"; },
    (value) => { value.absences[0].path = "/var/private"; },
    (value) => { value.service.runtimeMode = "read-only"; },
    (value) => { value.service.pid = 0; },
    (value) => { value.release.sourceSha = "c".repeat(40); },
    (value) => { value.piiIncluded = true; },
    (value) => { value.attestationSha256 = "f".repeat(64); },
  ]) {
    const value = valid();
    mutation(value);
    assert.throws(() => validateLegacyAbsenceReceipt(value), /PONTO_LEGACY_ABSENCE_RECEIPT_/);
  }
});

test("CLI emits only canonical receipt JSON and fixed errors", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-legacy-absence-receipt-"));
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
