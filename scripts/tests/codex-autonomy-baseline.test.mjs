import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { buildReleaseManifest, classifyFiles, findReusableEvidence } from "../codex-autonomy-lib.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const policy = JSON.parse(fs.readFileSync(path.join(root, "ops/codex/risk-policy.json"), "utf8"));

test("documentation changes require only low-risk checks", () => {
  const report = classifyFiles(policy, ["docs/guide.md", "TASKS.md"]);
  assert.equal(report.risk, "low");
  assert.ok(report.requiredChecks.includes("static-parse"));
  assert.ok(report.skippedChecks.includes("module-test"));
  assert.deepEqual(report.affectedSurfaces, ["documentation"]);
});

test("a localized website correction does not require unrelated domain tests", () => {
  const report = classifyFiles(policy, ["website/src/components/Header.tsx"]);
  assert.equal(report.risk, "medium");
  assert.ok(report.skippedChecks.includes("unrelated-module-test"));
  assert.deepEqual(report.affectedSurfaces, ["website"]);
});

test("ordinary auth and migration paths are elevated, not exceptional by default", () => {
  const report = classifyFiles(policy, ["crm/api/auth/session.ts", "workforce/timekeeping/migrations/0009_add_column.sql"]);
  assert.equal(report.risk, "high");
  assert.ok(report.requiredChecks.includes("rollback-plan"));
  assert.ok(report.skippedChecks.includes("staging-smoke"));
});

test("exceptional paths are explicit rather than inferred from every workflow or secret", () => {
  const ordinary = classifyFiles(policy, [".github/workflows/codex-autonomy-gate.yml", "ops/codex/risk-policy.json"]);
  assert.equal(ordinary.risk, "high");
  const exceptional = classifyFiles(policy, ["ops/real-data-destructive-migration.md"]);
  assert.equal(exceptional.risk, "critical");
});

test("release input digest ignores unrelated documentation but invalidates relevant input", () => {
  const base = {
    sourceCommit: "a".repeat(40),
    sourceTree: "b".repeat(40),
    surfaces: ["timekeeping"],
    policyPaths: ["ops/codex/risk-policy.json"],
    artifacts: [{ name: "worker", digest: "worker-a" }],
    inputs: [{ path: "workforce/timekeeping/index.ts", blob: "1".repeat(40) }]
  };
  const original = buildReleaseManifest(base);
  const documentationOnly = buildReleaseManifest({ ...base, sourceCommit: "d".repeat(40), sourceTree: "e".repeat(40), inputs: [...base.inputs] });
  const relevantChange = buildReleaseManifest({ ...base, inputs: [{ path: "workforce/timekeeping/index.ts", blob: "2".repeat(40) }] });
  assert.equal(documentationOnly.releaseInputDigest, original.releaseInputDigest);
  assert.equal(documentationOnly.dependencyClosureDigest, original.dependencyClosureDigest);
  assert.notEqual(documentationOnly.releaseIdentityDigest, original.releaseIdentityDigest);
  assert.notEqual(relevantChange.releaseInputDigest, original.releaseInputDigest);
});

test("green evidence is reused only for matching release and artifact digests", () => {
  const manifest = buildReleaseManifest({
    sourceCommit: "a".repeat(40), sourceTree: "b".repeat(40), surfaces: ["website"], policyPaths: [],
    inputs: [{ path: "website/src/index.ts", blob: "c".repeat(40) }], artifacts: [{ name: "pages", digest: "digest-a" }]
  });
  const matching = { status: "green", releaseInputDigest: manifest.releaseInputDigest, artifacts: [{ name: "pages", digest: "digest-a" }] };
  const drifted = { status: "green", releaseInputDigest: manifest.releaseInputDigest, artifacts: [{ name: "pages", digest: "digest-b" }] };
  assert.equal(findReusableEvidence([drifted, matching], manifest), matching);
  assert.equal(findReusableEvidence([drifted], manifest), null);
});
