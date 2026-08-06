import assert from "node:assert/strict";
import test from "node:test";
import { buildValidationPlan } from "../github-actions/validation-plan.mjs";

function outputsFor(...files) {
  return buildValidationPlan(files).outputs;
}

test("documentation-only changes skip application suites", () => {
  const outputs = outputsFor("docs/runbooks/github-governance.md", "README.md");
  for (const [key, value] of Object.entries(outputs)) {
    assert.equal(value, false, `${key} should be false for documentation-only changes`);
  }
});

test("CRM changes keep CRM quality, E2E and CodeQL without unrelated suites", () => {
  const outputs = outputsFor("crm/console/src/App.tsx");
  assert.equal(outputs.run_architecture, true);
  assert.equal(outputs.run_lint, true);
  assert.equal(outputs.run_crm, true);
  assert.equal(outputs.run_e2e, true);
  assert.equal(outputs.run_codeql, true);
  assert.equal(outputs.run_website, false);
  assert.equal(outputs.run_ci_smoke, false);
  assert.equal(outputs.run_security, false);
});

test("website changes keep website quality and CodeQL without CRM E2E", () => {
  const outputs = outputsFor("website/src/pages/Home.tsx");
  assert.equal(outputs.run_lint, true);
  assert.equal(outputs.run_website, true);
  assert.equal(outputs.run_codeql, true);
  assert.equal(outputs.run_crm, false);
  assert.equal(outputs.run_e2e, false);
  assert.equal(outputs.run_ci_smoke, false);
});

test("Orb changes keep core smoke, static validation and CodeQL", () => {
  const outputs = outputsFor("orb/engine/scripts/deploy-workflow.mjs");
  assert.equal(outputs.run_ci_smoke, true);
  assert.equal(outputs.run_lint, true);
  assert.equal(outputs.run_codeql, true);
  assert.equal(outputs.run_crm, false);
  assert.equal(outputs.run_website, false);
  assert.equal(outputs.run_e2e, false);
});

test("Ponto changes retain the governed release validation set", () => {
  const outputs = outputsFor("workforce/timekeeping/src/worker.ts");
  assert.equal(outputs.run_ci_smoke, true);
  assert.equal(outputs.run_lint, true);
  assert.equal(outputs.run_e2e, true);
  assert.equal(outputs.run_security, true);
  assert.equal(outputs.run_codeql, true);
  assert.equal(outputs.run_timekeeping, true);
});

test("workflow changes are handled as governed and security-sensitive", () => {
  const outputs = outputsFor(".github/workflows/ci-smoke.yml");
  assert.equal(outputs.run_architecture, true);
  assert.equal(outputs.run_ci_smoke, true);
  assert.equal(outputs.run_lint, true);
  assert.equal(outputs.run_security, true);
  assert.equal(outputs.run_codeql, true);
  assert.equal(outputs.run_e2e, false);
});

test("a quality workflow change exercises every branch it owns", () => {
  const outputs = outputsFor(".github/workflows/lint-format-static.yml");
  assert.equal(outputs.run_crm, true);
  assert.equal(outputs.run_website, true);
  assert.equal(outputs.run_backend, true);
  assert.equal(outputs.run_python, true);
});

test("an E2E workflow change runs the unified CRM browser suite", () => {
  const outputs = outputsFor(".github/workflows/central-e2e-smoke.yml");
  assert.equal(outputs.run_crm, true);
  assert.equal(outputs.run_e2e, true);
});

test("Codex-only changes keep the Windows continuity job without app suites", () => {
  const outputs = outputsFor(".codex/hooks/stop-gate.py");
  assert.equal(outputs.run_windows_continuity, true);
  assert.equal(outputs.run_ci_smoke, false);
  assert.equal(outputs.run_lint, false);
  assert.equal(outputs.run_security, false);
});

test("unknown executable changes fail closed to the conservative core set", () => {
  const outputs = outputsFor("new-domain/runtime.mjs");
  assert.equal(outputs.run_architecture, true);
  assert.equal(outputs.run_ci_smoke, true);
  assert.equal(outputs.run_lint, true);
  assert.equal(outputs.run_security, true);
  assert.equal(outputs.run_codeql, true);
});
