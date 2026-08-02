import assert from "node:assert/strict";
import test from "node:test";
import { assessRequiredChecks } from "./ponto-required-checks.mjs";

const policy = { governance: { requiredChecks: ["CI Smoke (Assert)", "Central E2E Smoke"] } };
const pulls = [{
  base: { ref: "main" },
  state: "closed",
  merged_at: "2026-08-02T03:00:30Z",
  merge_commit_sha: "a".repeat(40),
  head: { repo: { full_name: "jubenitogarcia/skincos" } },
}];

const check = (name, conclusion = "success", status = "completed") => ({ name, conclusion, status });

test("passes when the canonical merge and every required check are successful", () => {
  const result = assessRequiredChecks({
    pulls,
    checks: { check_runs: [check("CI Smoke (Assert)"), check("Central E2E Smoke")] },
    policy,
    releaseSha: "A".repeat(40),
    repository: "jubenitogarcia/skincos",
  });
  assert.equal(result.state, "passed");
});

test("keeps the release gate pending while a required check is absent or running", () => {
  const result = assessRequiredChecks({
    pulls,
    checks: { check_runs: [check("CI Smoke (Assert)", "", "in_progress")] },
    policy,
    releaseSha: "a".repeat(40),
    repository: "jubenitogarcia/skincos",
  });
  assert.equal(result.state, "pending");
  assert.deepEqual(result.pending, ["CI Smoke (Assert)", "Central E2E Smoke"]);
});

test("fails closed when a required check is terminally unsuccessful", () => {
  const result = assessRequiredChecks({
    pulls,
    checks: { check_runs: [check("CI Smoke (Assert)", "failure"), check("Central E2E Smoke")] },
    policy,
    releaseSha: "a".repeat(40),
    repository: "jubenitogarcia/skincos",
  });
  assert.equal(result.state, "failed");
  assert.match(result.reason, /CI Smoke \(Assert\)/);
});
