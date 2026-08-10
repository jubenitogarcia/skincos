import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { validatePontoEnvironmentProtection } from "./ponto-environment-protection.mjs";

const governance = JSON.parse(fs.readFileSync(
  new URL("../governance/progressive-release-policy.json", import.meta.url),
  "utf8",
)).governance;

const setup = () => ({
  target: "production",
  actor: governance.operatorLogin,
  governance,
  environment: {
    name: "production",
    protection_rules: [{ id: 10, type: "branch_policy" }],
    deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
    can_admins_bypass: false,
  },
  branchPolicies: {
    total_count: 2,
    branch_policies: [
      { id: 44, name: "main", type: "branch" },
      { id: 45, name: "skincos/release/ponto/*", type: "tag" },
    ],
  },
});

test("accepts the root branch plus immutable release-tag environment under single-operator Codex", () => {
  const report = validatePontoEnvironmentProtection(setup());
  assert.equal(report.passed, true);
  assert.equal(report.mainOnly, true);
  assert.equal(report.customBranchPolicyCount, 2);
  assert.equal(report.authorizationModel, "single-operator-codex");
  assert.equal(report.requiredReviewerRuleCount, 0);
  assert.equal(report.credentialsIncluded, false);
  assert.equal(report.piiIncluded, false);
});

test("accepts the official branch-policy response when type is omitted", () => {
  const value = setup();
  delete value.branchPolicies.branch_policies[0].type;
  assert.equal(validatePontoEnvironmentProtection(value).passed, true);
});

test("rejects administrator bypass, required review, or broad branches", () => {
  for (const mutate of [
    (value) => { value.environment.can_admins_bypass = true; },
    (value) => { value.environment.protection_rules = [{ id: 10, type: "required_reviewers" }]; },
    (value) => { value.environment.deployment_branch_policy = { protected_branches: true, custom_branch_policies: false }; },
    (value) => { value.branchPolicies = { total_count: 2, branch_policies: [{ id: 44, name: "main", type: "branch" }, { id: 45, name: "release/*", type: "branch" }] }; },
    (value) => { value.branchPolicies.branch_policies[0].type = "tag"; },
  ]) {
    const value = setup();
    mutate(value);
    assert.throws(() => validatePontoEnvironmentProtection(value), /Ponto/);
  }
});

test("rejects an actor other than the declared Codex operator", () => {
  const value = setup();
  value.actor = "different-actor";
  assert.throws(() => validatePontoEnvironmentProtection(value), /single-operator governance/);
});
