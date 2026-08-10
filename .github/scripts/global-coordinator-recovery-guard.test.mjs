import assert from "node:assert/strict";
import test from "node:test";
import { RECOVERY_CONFIRMATION, RECOVERY_PROTOCOL, classifyRecoveryProbe, evaluateRecoveryIntent } from "./global-coordinator-recovery-guard.mjs";

const candidate = {
  versionId: "11111111-2222-3333-4444-555555555555",
  environment: "production",
  sourceSha: "a".repeat(40),
  protocol: RECOVERY_PROTOCOL,
  recoveryEligible: true,
};
const registry = { schemaVersion: 1, workerName: "skincos-global-coordinator", knownVersions: [candidate] };
const base = {
  target: "production",
  ref: "refs/heads/main",
  runAttempt: 1,
  versionId: candidate.versionId,
  activeVersionId: "99999999-8888-7777-6666-555555555555",
  planeState: "timeout",
  confirmation: RECOVERY_CONFIRMATION,
  registry,
};

test("break-glass accepts only an exact registered version while the normal plane is degraded", () => {
  const result = evaluateRecoveryIntent(base);
  assert.equal(result.allowed, true);
  assert.equal(result.candidate.versionId, candidate.versionId);
});

test("healthy, malformed, ambiguous, or unknown coordination state fails closed", () => {
  for (const planeState of ["healthy", "malformed", "ambiguous"]) {
    assert.equal(evaluateRecoveryIntent({ ...base, planeState }).allowed, false);
  }
  assert.equal(evaluateRecoveryIntent({ ...base, versionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }).allowed, false);
  assert.equal(evaluateRecoveryIntent({ ...base, activeVersionId: candidate.versionId }).allowed, false);
});

test("target, branch, confirmation, and workflow replay guards are mandatory", () => {
  assert.equal(evaluateRecoveryIntent({ ...base, target: "staging" }).allowed, false);
  assert.equal(evaluateRecoveryIntent({ ...base, ref: "refs/heads/codex/recovery" }).allowed, false);
  assert.equal(evaluateRecoveryIntent({ ...base, confirmation: "yes" }).allowed, false);
  assert.equal(evaluateRecoveryIntent({ ...base, runAttempt: 2 }).allowed, false);
});

test("the probe classifier distinguishes healthy readiness from degraded transport", () => {
  assert.equal(classifyRecoveryProbe({ status: 200, body: { ready: true, protocol: RECOVERY_PROTOCOL, contractId: "skincos/global-coordination/v1" } }), "healthy");
  assert.equal(classifyRecoveryProbe({ status: 503, body: {} }), "server-error");
  assert.equal(classifyRecoveryProbe({ error: "timeout" }), "timeout");
  assert.equal(classifyRecoveryProbe({ status: 404, body: {} }), "ambiguous");
  assert.equal(classifyRecoveryProbe({ status: 200, body: { ready: true } }), "malformed");
});
