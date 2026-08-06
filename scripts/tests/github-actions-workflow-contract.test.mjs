import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const exists = (relativePath) => fs.existsSync(path.join(root, relativePath));

test("the aggregate gate owns the reusable validation components", () => {
  const gate = read(".github/workflows/codex-autonomy-gate.yml");
  for (const workflow of [
    "architecture-governance.yml",
    "ci-smoke.yml",
    "central-e2e-smoke.yml",
    "lint-format-static.yml",
    "security-secrets-audit.yml",
    "crm-codeql.yml",
    "timekeeping-ci.yml"
  ]) {
    assert.match(gate, new RegExp(`uses: ./\\.github/workflows/${workflow.replace(".", "\\.")}`));
    const component = read(`.github/workflows/${workflow}`);
    assert.match(component, /^\s*workflow_call:/m, `${workflow} must remain callable by the aggregate gate`);
    assert.doesNotMatch(component, /^\s*pull_request:/m, `${workflow} must not duplicate PR-triggered runs`);
  }
});

test("coverage and Escala stay consolidated without losing their controls", () => {
  const lint = read(".github/workflows/lint-format-static.yml");
  const e2e = read(".github/workflows/central-e2e-smoke.yml");
  assert.equal(exists(".github/workflows/test-coverage-quality.yml"), false);
  assert.equal(exists(".github/workflows/escala-ui-e2e.yml"), false);
  assert.match(lint, /npm run test:coverage/);
  assert.match(lint, /pytest tests\/unit --cov=config --cov-fail-under=80/);
  assert.match(e2e, /RUN_ESCALA_E2E_IN_CI: "1"/);
});

test("privileged workflows do not run PR code and retry is bounded", () => {
  const reconcile = read(".github/workflows/codex-keep-prs-mergeable.yml");
  const retry = read(".github/workflows/ci-auto-rerun-transient.yml");
  assert.match(reconcile, /^\s*pull_request_target:/m);
  assert.doesNotMatch(reconcile, /actions\/checkout@/);
  assert.doesNotMatch(reconcile, /secrets\.GH_TOKEN/);
  assert.match(retry, /^\s*workflow_dispatch:/m);
  assert.doesNotMatch(retry, /^\s*workflow_run:/m);
  assert.match(retry, /retryableWorkflows/);
  assert.match(retry, /Refusing retry: .*not an approved validation workflow/);
  assert.match(retry, /run\.run_attempt !== 1/);
});
