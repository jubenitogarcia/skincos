import assert from "node:assert/strict";
import test from "node:test";
import { mergePullRequest } from "../codex-global-merge-authority.mjs";
import { assertNativeGateEvidence, nativeChangedPathsDigest, nativeGatePlan } from "../codex-native-merge-contract.mjs";

const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);
const closureDigest = "c".repeat(64);
const changedPaths = ["scripts/codex-native-merge-gate.mjs", "docs/operations/native-merge-authority.md"];
const candidate = {
  repository: "jubenitogarcia/skincos",
  pullNumber: 1809,
  baseSha,
  headSha,
  closure: { digest: closureDigest },
  changedPaths,
};
const now = Date.parse("2026-09-30T15:00:00.000Z");

function evidence(overrides = {}) {
  const classification = { classification_status: "ok", risk: "high", surfaces: ["codex-baseline", "documentation"] };
  return {
    schemaVersion: 1,
    kind: "skincos-native-merge-gate",
    status: "passed",
    repository: candidate.repository,
    pullNumber: String(candidate.pullNumber),
    trustedMainSha: baseSha,
    baseSha,
    headSha,
    closureDigest,
    changedPathsDigest: nativeChangedPathsDigest(changedPaths),
    classification,
    checks: nativeGatePlan(classification),
    validatedAt: "2026-09-30T14:59:00.000Z",
    ...overrides,
  };
}

test("native plan preserves the Actions baseline contracts and adds domain validation when required", () => {
  assert.deepEqual(nativeGatePlan({ classification_status: "ok", risk: "low", surfaces: ["documentation"] }), ["diff-check", "static-parse"]);
  assert.deepEqual(nativeGatePlan(evidence().classification), [
    "diff-check", "static-parse", "baseline-contract", "coordination-contract", "supervisor-contract", "release-manifest-contract",
  ]);
  assert.ok(nativeGatePlan({ classification_status: "ok", risk: "high", surfaces: ["website"] }).includes("affected-domain-validation"));
  assert.throws(() => nativeGatePlan({ classification_status: "failed", risk: "low", surfaces: ["documentation"] }), /not sealed/);
  assert.throws(() => nativeGatePlan({ classification_status: "ok", risk: "critical", surfaces: ["website"] }), /critical/);
});

test("native evidence binds current main, PR head, changed paths and closure", () => {
  assert.equal(assertNativeGateEvidence(evidence(), candidate, now).headSha, headSha);
  assert.throws(() => assertNativeGateEvidence(evidence({ headSha: "d".repeat(40) }), candidate, now), /does not match/);
  assert.throws(() => assertNativeGateEvidence(evidence({ trustedMainSha: "d".repeat(40) }), candidate, now), /does not match/);
  assert.throws(() => assertNativeGateEvidence(evidence({ closureDigest: "d".repeat(64) }), candidate, now), /does not match/);
  assert.throws(() => assertNativeGateEvidence(evidence({ changedPathsDigest: "d".repeat(64) }), candidate, now), /does not match/);
});

test("native evidence fails closed on missing checks, failed result or stale validation", () => {
  assert.throws(() => assertNativeGateEvidence(evidence({ checks: ["diff-check"] }), candidate, now), /complete risk-selected plan/);
  assert.throws(() => assertNativeGateEvidence(evidence({ status: "failed" }), candidate, now), /missing or failed/);
  assert.throws(() => assertNativeGateEvidence(evidence({ validatedAt: "2026-09-30T13:00:00.000Z" }), candidate, now), /expired/);
});

test("merge authority rejects GitHub Actions and missing native evidence before external calls", async () => {
  const original = process.env.GITHUB_ACTIONS;
  try {
    process.env.GITHUB_ACTIONS = "true";
    await assert.rejects(mergePullRequest({ repository: "owner/repo", pullNumber: 1, expectedHeadSha: headSha }), /not an authorized merge executor/);
    delete process.env.GITHUB_ACTIONS;
    await assert.rejects(mergePullRequest({ repository: "owner/repo", pullNumber: 1, expectedHeadSha: headSha }), /in-process validation evidence/);
  } finally {
    if (original === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = original;
  }
});
