import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPreviewEvidence,
  verifyPreviewEvidence,
} from "../token-vault-native-preview.mjs";

const source = Object.freeze({
  sourceSha: "a".repeat(40),
  sourceTree: "b".repeat(40),
  releaseInputDigest: "c".repeat(64),
});

test("native Token Vault preview binds the exact source and completed gates", () => {
  const evidence = buildPreviewEvidence({ ...source, createdAt: "2026-09-30T12:00:00.000Z" });
  assert.equal(verifyPreviewEvidence(evidence, source), evidence);
  assert.deepEqual(evidence.checks, {
    tokenVaultTests: true,
    localD1Migrations: true,
    workerDryRun: true,
  });
});

test("native Token Vault preview rejects source drift and tampering", () => {
  const evidence = buildPreviewEvidence(source);
  assert.throws(() => verifyPreviewEvidence(evidence, { ...source, sourceSha: "d".repeat(40) }), /sourceSha differs/);
  assert.throws(() => verifyPreviewEvidence(evidence, { ...source, releaseInputDigest: "d".repeat(64) }), /releaseInputDigest differs/);
  assert.throws(() => verifyPreviewEvidence({ ...evidence, checks: { ...evidence.checks, workerDryRun: false } }, source), /complete native gate/);
  assert.throws(() => verifyPreviewEvidence({ ...evidence, sourceTree: "d".repeat(40) }, source), /digest does not match/);
});

test("native Token Vault preview rejects invalid source identity", () => {
  assert.throws(() => buildPreviewEvidence({ ...source, sourceSha: "short" }), /source SHA/);
  assert.throws(() => buildPreviewEvidence({ ...source, releaseInputDigest: "not-a-digest" }), /release-input digest/);
});
