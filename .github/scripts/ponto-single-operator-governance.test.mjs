import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { validatePontoEnvironmentProtection } from "./ponto-environment-protection.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
const policy = readJson(".github/governance/progressive-release-policy.json");
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
      releaseTagPolicy: "skincos/release/ponto/*",
    });
  }
});

test("versioned target environments mirror the single-operator policy", () => {
  const mainBranchPolicy = readJson(".github/governance/environments/main-branch-policy.json");
  const releaseTagPolicy = readJson(".github/governance/environments/ponto-release-tag-policy.json");
  for (const target of ["staging", "production"]) {
    const expected = governance.environmentProtection[target];
    const environment = readJson(`.github/governance/environments/${target}.json`);
    assert.equal(environment.wait_timer, 0);
    assert.equal(environment.prevent_self_review, expected.preventSelfReview);
    assert.equal(environment.can_admins_bypass, governance.administratorBypassAllowed);
    assert.deepEqual(environment.reviewers, []);
    assert.deepEqual(environment.deployment_branch_policy, {
      protected_branches: expected.protectedBranches,
      custom_branch_policies: expected.customBranchPolicies,
    });
    assert.equal(mainBranchPolicy.name, expected.requiredBranch);
    assert.equal(mainBranchPolicy.type, "branch");
    assert.equal(releaseTagPolicy.name, expected.releaseTagPolicy);
    assert.equal(releaseTagPolicy.type, "tag");
  }
});

test("environment attestation accepts main plus immutable release tags without human review", () => {
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
        total_count: 2,
        branch_policies: [
          { id: 12345, name: "main", type: "branch" },
          { id: 12346, name: "skincos/release/ponto/*", type: "tag" },
        ],
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
    branchPolicies: {
      total_count: 2,
      branch_policies: [
        { id: 1, name: "main", type: "branch" },
        { id: 2, name: "skincos/release/ponto/*", type: "tag" },
      ],
    },
  }), /must not require a human reviewer/);
});
