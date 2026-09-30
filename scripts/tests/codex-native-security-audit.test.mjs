import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { scannerJson, weeklySecurityPlan } from "../codex-native-security-audit.mjs";

function isolatedGitEnv() {
  const env = { ...process.env };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE"]) delete env[name];
  return env;
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skincos-security-plan-"));
  for (const file of [
    "requirements.txt", ".gitleaks.toml", ".github/security/pip-audit-vuln-exceptions.csv",
    ".github/security/pip-audit-path-exceptions.csv", ".github/security/bandit-exceptions.csv",
    ".github/security/pip-audit-build-constraints.txt",
  ]) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.endsWith(".csv") ? "# exception policy\n" : "\n");
  }
  const env = isolatedGitEnv();
  execFileSync("git", ["init", "-q", root], { env });
  execFileSync("git", ["-C", root, "add", "."], { env });
  return root;
}

function removeFixture(root) {
  const intendedParent = fs.realpathSync(os.tmpdir());
  const resolved = fs.realpathSync(root);
  if (!resolved.startsWith(`${intendedParent}${path.sep}`) || !path.basename(resolved).startsWith("skincos-security-plan-")) {
    throw new Error("security fixture cleanup target escaped temporary directory");
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

test("weekly native scope requires every scanner and tracked requirements", () => {
  const root = fixture();
  try {
    const plan = weeklySecurityPlan(root, "2026-09-30");
    assert.equal(plan.scope.fullScan, true);
    assert.deepEqual([plan.scope.npmAudit, plan.scope.trivy, plan.scope.pipAudit, plan.scope.bandit, plan.scope.semgrep], [true, true, true, true, true]);
    assert.deepEqual(plan.requirements, ["requirements.txt"]);
    assert.equal(Object.keys(plan.scanners).length, 5);
  } finally { removeFixture(root); }
});

test("expired scanner exception fails before a scan", () => {
  const root = fixture();
  try {
    fs.writeFileSync(path.join(root, ".github/security/bandit-exceptions.csv"), "backend/x.py,B101,2026-09-29,temporary\n");
    assert.throws(() => weeklySecurityPlan(root, "2026-09-30"), /expired security exception/);
  } finally { removeFixture(root); }
});

test("scanner JSON tolerates progress prefix but rejects missing or corrupt reports", () => {
  assert.deepEqual(scannerJson('progress 100%\n{"results": []}\n'), { results: [] });
  assert.throws(() => scannerJson("progress only"), /no JSON object/);
  assert.throws(() => scannerJson('{"results": []} trailing'), SyntaxError);
});

test("synthetic Git fixture never uses inherited worktree or index custody", () => {
  const previous = Object.fromEntries(["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE"].map((name) => [name, process.env[name]]));
  try {
    for (const name of Object.keys(previous)) process.env[name] = "/unavailable/not-the-fixture";
    const root = fixture();
    try { assert.deepEqual(weeklySecurityPlan(root, "2026-09-30").requirements, ["requirements.txt"]); }
    finally { removeFixture(root); }
  } finally {
    for (const [name, value] of Object.entries(previous)) value === undefined ? delete process.env[name] : process.env[name] = value;
  }
});
