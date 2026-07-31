import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { validatePontoEnvironmentProtection } from "./ponto-environment-protection.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const policy = JSON.parse(fs.readFileSync(path.join(root, ".github/governance/progressive-release-policy.json"), "utf8"));
const governance = policy.governance;

test("policy declares single-operator Codex without human review", () => {
  assert.equal(governance.authorizationModel, "single-operator-codex");
  assert.equal(governance.humanReviewerRequired, false);
  assert.equal(governance.administratorBypassAllowed, false);
  assert.equal(governance.canonicalMergedPullRequestRequired, true);
  for (const target of ["staging", "production"]) {
    assert.deepEqual(governance.environmentProtection[target], {
      requiredReviewers: 0,
      preventSelfReview: false,
      protectedBranches: false,
      customBranchPolicies: true,
      requiredBranch: "main",
    });
  }
});

test("environment attestation accepts only main-only no-review protection", () => {
  for (const target of ["staging", "production"]) {
    const report = validatePontoEnvironmentProtection({
      target,
      actor: governance.operatorLogin,
      governance,
      environment: {
        name: target,
        can_admins_bypass: false,
        deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
        protection_rules: [{ type: "branch_policy", id: 12345 }],
      },
      branchPolicies: {
        total_count: 1,
        branch_policies: [{ id: 12345, name: "main", type: "branch" }],
      },
    });
    assert.equal(report.passed, true);
    assert.equal(report.requiredReviewerRuleCount, 0);
    assert.equal(report.authorizationModel, "single-operator-codex");
  }
});

test("environment attestation rejects a required reviewer", () => {
  assert.throws(() => validatePontoEnvironmentProtection({
    target: "production",
    actor: governance.operatorLogin,
    governance,
    environment: {
      name: "production",
      can_admins_bypass: false,
      deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
      protection_rules: [{ type: "required_reviewers", prevent_self_review: true, reviewers: [{ type: "User", reviewer: { id: 1, login: governance.operatorLogin } }] }],
    },
    branchPolicies: { total_count: 1, branch_policies: [{ id: 1, name: "main", type: "branch" }] },
  }), /must not require a human reviewer/);
});
