import assert from "node:assert/strict";
import test from "node:test";
import {
  validatePontoEnvironmentProtection,
} from "./ponto-environment-protection.mjs";

const setup = () => ({
  target: "production",
  actor: "release-operator",
  environment: {
    name: "production",
    protection_rules: [{
      id: 10,
      type: "required_reviewers",
      reviewers: [{
        type: "User",
        reviewer: { id: 22, login: "independent-reviewer" },
      }],
      prevent_self_review: true,
    }],
    deployment_branch_policy: {
      protected_branches: false,
      custom_branch_policies: true,
    },
    can_admins_bypass: false,
  },
  branchPolicies: {
    total_count: 1,
    branch_policies: [{ id: 44, name: "main", type: "branch" }],
  },
});

test("accepts an exact main-only protected environment with independent review", () => {
  const report = validatePontoEnvironmentProtection(setup());
  assert.equal(report.passed, true);
  assert.equal(report.mainOnly, true);
  assert.equal(report.independentReviewerCount, 1);
  assert.equal(report.credentialsIncluded, false);
  assert.equal(report.piiIncluded, false);
});

test("accepts the official branch-policy response when type is omitted", () => {
  const value = setup();
  delete value.branchPolicies.branch_policies[0].type;
  assert.equal(validatePontoEnvironmentProtection(value).passed, true);
});

test("rejects administrator bypass, missing self-review prevention, or broad branches", () => {
  for (const mutate of [
    (value) => { value.environment.can_admins_bypass = true; },
    (value) => {
      value.environment.protection_rules[0].prevent_self_review = false;
    },
    (value) => {
      value.environment.deployment_branch_policy = {
        protected_branches: true,
        custom_branch_policies: false,
      };
    },
    (value) => {
      value.branchPolicies = {
        total_count: 2,
        branch_policies: [
          { id: 44, name: "main", type: "branch" },
          { id: 45, name: "release/*", type: "branch" },
        ],
      };
    },
    (value) => {
      value.branchPolicies.branch_policies[0].type = "tag";
    },
  ]) {
    const value = setup();
    mutate(value);
    assert.throws(
      () => validatePontoEnvironmentProtection(value),
      /Ponto environment/,
    );
  }
});

test("rejects a reviewer set that cannot independently approve the actor", () => {
  const value = setup();
  value.environment.protection_rules[0].reviewers[0].reviewer.login =
    value.actor;
  assert.throws(
    () => validatePontoEnvironmentProtection(value),
    /independent deployment reviewer/,
  );
});

test("accepts a protected team reviewer with prevent-self-review enabled", () => {
  const value = setup();
  value.environment.protection_rules[0].reviewers = [{
    type: "Team",
    reviewer: { id: 55, slug: "production-reviewers" },
  }];
  const report = validatePontoEnvironmentProtection(value);
  assert.equal(report.independentReviewerCount, 1);
});
