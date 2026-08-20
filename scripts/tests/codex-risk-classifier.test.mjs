import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  buildClassificationFallback,
  classifyFiles,
  normalizeChangedFiles,
  parseGitNameStatus,
  validateRiskPolicy,
} from "../codex-autonomy-lib.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const policy = JSON.parse(fs.readFileSync(path.join(root, "ops/codex/risk-policy.json"), "utf8"));
const fixtures = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures/codex-risk-classifier-cases.json"), "utf8"));
const classifier = path.join(root, "scripts/codex-risk-classifier.mjs");

test("the checked-in policy is a valid v2 classifier policy", () => {
  assert.equal(validateRiskPolicy(policy), policy);
  assert.equal(policy.schemaVersion, 2);
  assert.deepEqual(Object.keys(policy.levels).sort(), ["critical", "high", "low", "medium"]);
});

test("fixture matrix produces the canonical report fields", () => {
  for (const fixture of fixtures.cases) {
    const report = classifyFiles(policy, fixture.files);
    for (const [field, expected] of Object.entries(fixture.expect)) {
      if (field === "classified_files") {
        assert.deepEqual(report.pathClassifications.map((entry) => entry.file), expected, fixture.name);
      } else {
        assert.deepEqual(report[field], expected, `${fixture.name}: ${field}`);
      }
    }
    assert.equal(report.affectedSurfaces, report.surfaces, `${fixture.name}: compatibility alias`);
    assert.equal(report.fallback, null, `${fixture.name}: no fallback`);
    assert.equal(report.classification_status, "ok", `${fixture.name}: classification status`);
  }
});

test("empty diff is distinct from an empty or unsafe path", () => {
  const emptyDiff = classifyFiles(policy, []);
  assert.equal(emptyDiff.status, "classified");
  assert.equal(emptyDiff.risk, "low");
  assert.deepEqual(emptyDiff.surfaces, []);
  assert.deepEqual(emptyDiff.languages, []);

  for (const input of [[""], ["../outside.txt"], ["/absolute.txt"], ["C:\\absolute.txt"], ["docs//guide.md"], ["docs/../guide.md"]]) {
    assert.throws(() => classifyFiles(policy, input), /must|contains|repository-relative|ambiguous|indeterminate/);
  }
});

test("normalization is deterministic and preserves both rename/copy sides", () => {
  assert.deepEqual(normalizeChangedFiles(["docs\\guide.md", "./docs/guide.md"]), [
    { status: "M", score: null, paths: ["docs/guide.md"] },
  ]);
  assert.deepEqual(normalizeChangedFiles([{ status: "R100", oldPath: "old\\secret.txt", newPath: "new/secret.txt" }]), [
    { status: "R", score: "100", paths: ["old/secret.txt", "new/secret.txt"] },
  ]);
  assert.deepEqual(normalizeChangedFiles([{ status: "C075", paths: ["source.txt", "copy.txt"] }]), [
    { status: "C", score: "075", paths: ["source.txt", "copy.txt"] },
  ]);
});

test("NUL-delimited Git name-status parsing handles renames and copies", () => {
  const changes = parseGitNameStatus("R100\u0000old.md\u0000new.md\u0000C075\u0000source.ts\u0000copy.ts\u0000M\u0000plain.ts\u0000");
  assert.deepEqual(changes.map((change) => change.status).sort(), ["C", "M", "R"]);
  assert.deepEqual(changes.find((change) => change.status === "R").paths, ["old.md", "new.md"]);
  assert.deepEqual(changes.find((change) => change.status === "C").paths, ["source.ts", "copy.ts"]);
  assert.throws(() => parseGitNameStatus("R100\u0000only-one-side\u0000"), /truncated/);
});

test("malformed policy and change records are rejected before classification", () => {
  const invalidPolicy = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures/codex-risk-policy-invalid.json"), "utf8"));
  assert.throws(() => validateRiskPolicy(invalidPolicy), /level|non-empty/);
  assert.throws(() => classifyFiles(invalidPolicy, ["docs/guide.md"]), /level|non-empty/);
  const malformedPatternPolicy = {
    ...policy,
    classificationRules: policy.classificationRules.map((rule, index) => index === 0 ? { ...rule, patterns: ["**/{critical"] } : rule),
  };
  assert.throws(() => validateRiskPolicy(malformedPatternPolicy), /unbalanced brace/);
  assert.throws(() => normalizeChangedFiles([{ status: "R100", oldPath: "only-old.md" }]), /must identify|indeterminate/);
  assert.throws(() => normalizeChangedFiles([{ status: "Q", path: "unknown.txt" }]), /invalid/);
  assert.throws(() => normalizeChangedFiles(null), /must be an array/);
});

test("workflow, tracking, and dependency changes expose conservative indicators", () => {
  const report = classifyFiles(policy, [
    ".github/workflows/example.yml",
    "ads/meta/tracking.ts",
    "package.json",
  ]);
  assert.equal(report.risk, "high");
  assert.equal(report.dependencies_changed, true);
  assert.equal(report.production_sensitive, true);
  assert.equal(report.security_sensitive, true);
  assert.deepEqual(report.languages, ["json", "typescript", "yaml"]);
  assert.ok(report.surfaces.includes("github-governance"));
});

test("the fallback report is complete, conservative, and sanitized", () => {
  const report = buildClassificationFallback({
    policy,
    code: "unsafe_input",
    reason: "bad\npath\u0000with secret-like text",
  });
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.risk, "critical");
  assert.equal(report.status, "fallback");
  assert.equal(report.classification_status, "failed");
  assert.equal(report.fallback.active, true);
  assert.equal(report.fallback.code, "unsafe_input");
  assert.doesNotMatch(report.fallback.reason, /[\r\n\u0000]/);
  assert.equal(report.production_sensitive, true);
  assert.equal(report.security_sensitive, true);
  assert.equal(report.dependencies_changed, true);
  assert.equal(report.shared_contracts_changed, true);
  assert.deepEqual(report.requiredChecks, policy.levels.critical.requiredChecks);
});

test("CLI emits a critical fallback and exits nonzero for an empty path", () => {
  const result = spawnSync(process.execPath, [classifier, "--file", ""], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.risk, "critical");
  assert.equal(report.status, "fallback");
  assert.equal(report.classification_status, "failed");
  assert.equal(report.fallback.active, true);
  assert.match(result.stderr, /failed closed/);
});

test("CLI emits the same fallback when the policy cannot be validated", () => {
  const invalidPolicy = path.join(root, "scripts/tests/fixtures/codex-risk-policy-invalid.json");
  const result = spawnSync(process.execPath, [classifier, "--policy", invalidPolicy, "--file", "docs/guide.md"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.risk, "critical");
  assert.equal(report.status, "fallback");
  assert.deepEqual(report.requiredChecks, ["diff-check", "focal-validation", "rollback-plan", "exceptional-stop"]);
});
