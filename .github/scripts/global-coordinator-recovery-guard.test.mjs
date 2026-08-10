import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { RECOVERY_CONFIRMATION, RECOVERY_PROTOCOL, classifyRecoveryProbe, evaluateRecoveryIntent, loadRecoveryRegistry, validateRecoveryRegistry } from "./global-coordinator-recovery-guard.mjs";

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

test("the versioned production registry contains a modern recovery incumbent with deployment provenance", () => {
  const registry = loadRecoveryRegistry();
  const eligible = registry.knownVersions.filter((entry) => entry.recoveryEligible === true);
  assert.ok(eligible.length >= 1);
  assert.ok(eligible.every((entry) => entry.protocol === RECOVERY_PROTOCOL));
  assert.ok(eligible.every((entry) => /^[0-9a-f]{40}$/i.test(entry.sourceSha)));
  assert.ok(eligible.every((entry) => /^[1-9][0-9]{5,}$/.test(String(entry.registeredFromWorkflowRun))));
});

test("the registry rejects duplicate or malformed eligible incumbents before recovery", () => {
  assert.throws(() => validateRecoveryRegistry({
    schemaVersion: 1,
    workerName: "skincos-global-coordinator",
    knownVersions: [{ ...candidate, registeredFromWorkflowRun: "31427360586" }, { ...candidate, registeredFromWorkflowRun: "31427360587" }],
  }), /duplicate version/);
});

test("the recovery workflow keeps production custody and restore scope narrow", () => {
  const workflow = fs.readFileSync(path.resolve(import.meta.dirname, "../workflows/recover-global-coordinator.yml"), "utf8");
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /SKINCOS_GLOBAL_COORDINATION_RECOVERY_SECRET/);
  assert.match(workflow, /versions deploy \"\$\{VERSION_ID\}@100%\"/);
  assert.match(workflow, /recovery-incumbents\.json/);
  assert.doesNotMatch(workflow, /global-coordination-acquire/);
});
