import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildSecurityAuditScope } from "./security-secrets-audit-scope.mjs";
import { classifyFiles } from "../../scripts/codex-autonomy-lib.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/security-secrets-audit.yml"), "utf8");
const policy = JSON.parse(fs.readFileSync(path.join(root, "ops/codex/risk-policy.json"), "utf8"));

function reportFor(files, overrides = {}) {
  return { ...classifyFiles(policy, files), ...overrides };
}

function scopeFor(files, { eventName = "pull_request", riskReport = null } = {}) {
  return buildSecurityAuditScope({
    eventName,
    riskReport: riskReport || reportFor(files),
    changedFiles: files,
  });
}

test("workflow keeps PR Gitleaks mandatory and reserves full current-tree scans for main, schedule, dispatch, or broad risk", () => {
  assert.match(workflow, /pull_request:\n\s+branches:\s+\[main\]/);
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /gitleaks\/gitleaks-action@/);
  assert.match(workflow, /gitleaks dir --redact --exit-code=2 --config \.gitleaks\.toml \./);
  assert.doesNotMatch(workflow, /--log-opts="--all"/);
  const gitleaksJob = workflow.split("\n  gitleaks:", 2)[1]?.split("\n  npm-audit:", 1)[0] || "";
  assert.match(gitleaksJob, /git fetch --no-tags --unshallow origin/);
  assert.ok(gitleaksJob.indexOf("git fetch --no-tags --unshallow origin") < gitleaksJob.indexOf("gitleaks/gitleaks-action@"));
  const fullTreeGitleaks = workflow.split("Run full current-tree Gitleaks scan for broad-risk PRs and main", 2)[1] || "";
  assert.match(fullTreeGitleaks, /if:\s+\$\{\{\s*needs\.scope\.outputs\.full_scan\s*==\s*'true'\s*\}\}/);
  assert.doesNotMatch(fullTreeGitleaks, /github\.event_name/);
  assert.match(workflow, /fetch-depth:\s+2/);
  assert.match(workflow, /codex-bounded-diff\.mjs/);
  assert.match(workflow, /git fetch --no-tags --unshallow origin/);
  assert.match(workflow, /needs: scope/);
  assert.match(workflow, /PR diff-aware; full elsewhere/);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/);
  assert.match(workflow, /exit-code: '1'/);
  assert.match(workflow, /Bandit found unresolved HIGH\/HIGH issues/);
  assert.match(workflow, /sys\.exit\(1\)/);
});

test("low-risk documentation does not activate dependency or SAST scans", () => {
  const report = reportFor(["docs/audit-notes.md"]);
  const scope = scopeFor(["docs/audit-notes.md"], { riskReport: report });
  assert.equal(report.risk, "low");
  assert.equal(scope.fullScan, false);
  assert.equal(scope.npmAudit, false);
  assert.equal(scope.trivy, false);
  assert.equal(scope.pipAudit, false);
  assert.equal(scope.bandit, false);
  assert.equal(scope.semgrep, false);
});

test("medium changes scope Semgrep to changed source and do not activate unrelated dependency audits", () => {
  const report = reportFor(["website/src/components/Button.tsx"]);
  const scope = scopeFor(["website/src/components/Button.tsx"], { riskReport: report });
  assert.equal(report.risk, "medium");
  assert.equal(scope.fullScan, false);
  assert.equal(scope.semgrep, true);
  assert.equal(scope.npmAudit, false);
  assert.equal(scope.trivy, false);
  assert.equal(scope.pipAudit, false);
  assert.equal(scope.bandit, false);
});

test("lockfiles and Python manifests activate only their relevant dependency gates", () => {
  const jsScope = scopeFor(["website/package-lock.json"], {
    riskReport: { ...reportFor([]), risk: "medium", security_sensitive: false },
  });
  assert.equal(jsScope.npmAudit, true);
  assert.equal(jsScope.trivy, true);
  assert.equal(jsScope.pipAudit, false);
  assert.equal(jsScope.fullScan, false);

  const pnpmScope = scopeFor(["backend/pnpm-lock.yaml"], {
    riskReport: { ...reportFor([]), risk: "medium", security_sensitive: false },
  });
  assert.equal(pnpmScope.npmAudit, false);
  assert.equal(pnpmScope.trivy, true);
  assert.equal(pnpmScope.fullScan, false);

  const pythonScope = scopeFor(["backend/requirements.txt"], {
    riskReport: { ...reportFor([]), risk: "medium", security_sensitive: false },
  });
  assert.equal(pythonScope.pipAudit, true);
  assert.equal(pythonScope.bandit, false);
  assert.equal(pythonScope.npmAudit, false);
  assert.equal(pythonScope.trivy, false);
});

test("high and critical classifications remain full and blocking-capable", () => {
  for (const risk of ["high", "critical"]) {
    const scope = scopeFor(["docs/change.md"], {
      riskReport: { ...reportFor([]), risk, security_sensitive: true },
    });
    assert.equal(scope.fullScan, true);
    assert.equal(scope.npmAudit, true);
    assert.equal(scope.trivy, true);
    assert.equal(scope.pipAudit, true);
    assert.equal(scope.bandit, true);
    assert.equal(scope.semgrep, true);
  }
});

test("auth, secrets, tracking, workflow, and migration paths force broad security coverage", () => {
  for (const { file, securitySensitive } of [
    { file: "website/src/lib/tracking.ts", securitySensitive: false },
    { file: "crm/api/auth/session.ts", securitySensitive: true },
    { file: "platform/security/token-vault/secret-contract.md", securitySensitive: true },
    { file: ".github/workflows/example.yml", securitySensitive: true },
    { file: "backend/migrations/0001_init.sql", securitySensitive: true },
  ]) {
    const report = reportFor([file]);
    const scope = scopeFor([file], { riskReport: report });
    assert.equal(scope.securitySensitiveChanged, securitySensitive, file);
    assert.equal(scope.fullScan, true, file);
  }
});

test("main, schedule, and dispatch always retain full scans regardless of changed paths", () => {
  for (const eventName of ["push", "schedule", "workflow_dispatch"]) {
    const scope = scopeFor(["docs/guide.md"], {
      eventName,
      riskReport: { ...reportFor([]), risk: "low", security_sensitive: false },
    });
    assert.equal(scope.fullScan, true, eventName);
    assert.equal(scope.semgrep, true, eventName);
    assert.equal(scope.pipAudit, true, eventName);
  }
});

test("security scope consumes the canonical classifier and never reclassifies paths locally", () => {
  const scope = buildSecurityAuditScope({
    eventName: "pull_request",
    riskReport: {
      ...reportFor([]),
      risk: "low",
      security_sensitive: false,
      classification_status: "ok",
    },
    changedFiles: ["ops/custom-auth-guide.txt"],
  });
  assert.equal(scope.securitySensitiveChanged, false);
  assert.equal(scope.fullScan, false);
});

test("missing or failed canonical classification fails closed", () => {
  for (const classificationStatus of [undefined, "failed"]) {
    assert.throws(
      () => buildSecurityAuditScope({
        eventName: "pull_request",
        riskReport: {
          ...reportFor([]),
          risk: "low",
          security_sensitive: false,
          classification_status: classificationStatus,
        },
        changedFiles: ["docs/guide.md"],
      }),
      /classification/i,
    );
  }
});
