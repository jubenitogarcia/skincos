import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildSecurityAuditScope } from "./security-secrets-audit-scope.mjs";
import { classifyFiles } from "../../scripts/codex-autonomy-lib.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/security-secrets-audit.yml"), "utf8");
const policy = JSON.parse(fs.readFileSync(path.join(root, "ops/codex/risk-policy.json"), "utf8"));

test("workflow keeps PR Gitleaks mandatory and reserves full scans for main, schedule, dispatch, or broad risk", () => {
  assert.match(workflow, /pull_request:\n\s+branches:\s+\[main\]/);
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /gitleaks\/gitleaks-action@/);
  assert.match(workflow, /gitleaks git --redact --exit-code=2/);
  assert.match(workflow, /--log-opts="--all"/);
  assert.match(workflow, /fetch-depth:\s+0/);
  assert.match(workflow, /needs: scope/);
  assert.match(workflow, /PR diff-aware; full elsewhere/);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/);
  assert.match(workflow, /exit-code: '1'/);
  assert.match(workflow, /Bandit found unresolved HIGH\/HIGH issues/);
  assert.match(workflow, /sys\.exit\(1\)/);
});

test("low-risk documentation does not activate dependency or SAST scans", () => {
  const report = classifyFiles(policy, ["docs/security-audit-notes.md"]);
  const scope = buildSecurityAuditScope({ eventName: "pull_request", risk: report.risk, changedFiles: report.pathClassifications.map(({ file }) => file) });
  assert.equal(report.risk, "low");
  assert.equal(scope.fullScan, false);
  assert.equal(scope.npmAudit, false);
  assert.equal(scope.trivy, false);
  assert.equal(scope.pipAudit, false);
  assert.equal(scope.bandit, false);
  assert.equal(scope.semgrep, false);
});

test("medium changes scope Semgrep to changed source and do not activate unrelated dependency audits", () => {
  const report = classifyFiles(policy, ["website/src/components/Button.tsx"]);
  const scope = buildSecurityAuditScope({ eventName: "pull_request", risk: report.risk, changedFiles: ["website/src/components/Button.tsx"] });
  assert.equal(report.risk, "medium");
  assert.equal(scope.fullScan, false);
  assert.equal(scope.semgrep, true);
  assert.equal(scope.npmAudit, false);
  assert.equal(scope.trivy, false);
  assert.equal(scope.pipAudit, false);
  assert.equal(scope.bandit, false);
});

test("lockfiles and Python manifests activate only their relevant dependency gates", () => {
  const jsScope = buildSecurityAuditScope({ eventName: "pull_request", risk: "medium", changedFiles: ["website/package-lock.json"] });
  assert.equal(jsScope.npmAudit, true);
  assert.equal(jsScope.trivy, true);
  assert.equal(jsScope.pipAudit, false);
  assert.equal(jsScope.fullScan, false);

  const pnpmScope = buildSecurityAuditScope({ eventName: "pull_request", risk: "medium", changedFiles: ["backend/pnpm-lock.yaml"] });
  assert.equal(pnpmScope.npmAudit, false);
  assert.equal(pnpmScope.trivy, true);
  assert.equal(pnpmScope.fullScan, false);

  const pythonScope = buildSecurityAuditScope({ eventName: "pull_request", risk: "medium", changedFiles: ["backend/requirements.txt"] });
  assert.equal(pythonScope.pipAudit, true);
  assert.equal(pythonScope.bandit, false);
  assert.equal(pythonScope.npmAudit, false);
  assert.equal(pythonScope.trivy, false);
});

test("high and critical classifications remain full and blocking-capable", () => {
  for (const risk of ["high", "critical"]) {
    const scope = buildSecurityAuditScope({ eventName: "pull_request", risk, changedFiles: ["docs/change.md"] });
    assert.equal(scope.fullScan, true);
    assert.equal(scope.npmAudit, true);
    assert.equal(scope.trivy, true);
    assert.equal(scope.pipAudit, true);
    assert.equal(scope.bandit, true);
    assert.equal(scope.semgrep, true);
  }
});

test("auth, secrets, tracking, workflow, and migration paths force broad security coverage", () => {
  for (const file of [
    "website/src/lib/tracking.ts",
    "crm/api/auth/session.ts",
    "platform/security/token-vault/secret-contract.md",
    ".github/workflows/example.yml",
    "backend/migrations/0001_init.sql",
  ]) {
    const scope = buildSecurityAuditScope({ eventName: "pull_request", risk: "medium", changedFiles: [file] });
    assert.equal(scope.sensitivePathChanged, true, file);
    assert.equal(scope.fullScan, true, file);
  }
});

test("main, schedule, and dispatch always retain full scans regardless of changed paths", () => {
  for (const eventName of ["push", "schedule", "workflow_dispatch"]) {
    const scope = buildSecurityAuditScope({ eventName, risk: "low", changedFiles: ["docs/guide.md"] });
    assert.equal(scope.fullScan, true, eventName);
    assert.equal(scope.semgrep, true, eventName);
    assert.equal(scope.pipAudit, true, eventName);
  }
});
