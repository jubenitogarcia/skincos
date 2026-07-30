import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const TARGETS = new Set(["staging", "production"]);

const isPositiveId = (value) =>
  Number.isInteger(Number(value)) && Number(value) > 0;

const reviewerIdentity = (entry) => {
  const type = String(entry?.type || "");
  const reviewer = entry?.reviewer;
  if (!reviewer || !isPositiveId(reviewer.id)) return null;
  if (type === "User" && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(
    String(reviewer.login || ""),
  )) {
    return { type, name: String(reviewer.login) };
  }
  if (type === "Team" && /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,99})$/.test(
    String(reviewer.slug || ""),
  )) {
    return { type, name: String(reviewer.slug) };
  }
  return null;
};

export function validatePontoEnvironmentProtection({
  environment,
  branchPolicies,
  target,
  actor,
}) {
  const selectedTarget = String(target || "").trim().toLowerCase();
  const triggeringActor = String(actor || "").trim().toLowerCase();
  if (!TARGETS.has(selectedTarget) || !triggeringActor) {
    throw new Error("Ponto environment protection identity is invalid");
  }
  if (
    environment?.name !== selectedTarget
    || environment?.deployment_branch_policy?.protected_branches !== false
    || environment?.deployment_branch_policy?.custom_branch_policies !== true
    || environment?.can_admins_bypass !== false
  ) {
    throw new Error(
      "Ponto environment must be main-only and forbid administrator bypass",
    );
  }

  const policies = branchPolicies?.branch_policies;
  if (
    !Array.isArray(policies)
    || branchPolicies?.total_count !== 1
    || policies.length !== 1
    || policies[0]?.name !== "main"
    || !["", "branch"].includes(String(policies[0]?.type || ""))
    || !isPositiveId(policies[0]?.id)
  ) {
    throw new Error("Ponto environment must allow exactly the main branch");
  }

  const reviewerRules = (environment?.protection_rules || [])
    .filter((rule) => rule?.type === "required_reviewers");
  if (
    reviewerRules.length !== 1
    || reviewerRules[0]?.prevent_self_review !== true
  ) {
    throw new Error(
      "Ponto environment must have exactly one required-reviewers rule with self-review prevention",
    );
  }
  const reviewers = (reviewerRules[0]?.reviewers || [])
    .map(reviewerIdentity)
    .filter(Boolean);
  const independentReviewers = reviewers.filter((reviewer) =>
    reviewer.type === "Team"
    || reviewer.name.toLowerCase() !== triggeringActor);
  if (!reviewers.length || !independentReviewers.length) {
    throw new Error(
      "Ponto environment requires an independent deployment reviewer",
    );
  }

  const report = {
    schemaVersion: 1,
    target: selectedTarget,
    mainOnly: true,
    customBranchPolicyCount: 1,
    administratorBypassDisabled: true,
    preventSelfReview: true,
    requiredReviewerRuleCount: 1,
    configuredReviewerCount: reviewers.length,
    independentReviewerCount: independentReviewers.length,
    passed: true,
    credentialsIncluded: false,
    piiIncluded: false,
  };
  return report;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (invokedPath === import.meta.url) {
  const [environmentFile, branchPoliciesFile, reportFile] = process.argv.slice(2);
  if (!environmentFile || !branchPoliciesFile || !reportFile) {
    throw new Error(
      "usage: ponto-environment-protection.mjs <environment.json> <branch-policies.json> <report.json>",
    );
  }
  const report = validatePontoEnvironmentProtection({
    environment: JSON.parse(fs.readFileSync(environmentFile, "utf8")),
    branchPolicies: JSON.parse(fs.readFileSync(branchPoliciesFile, "utf8")),
    target: process.env.PONTO_ENVIRONMENT_TARGET,
    actor: process.env.GITHUB_ACTOR,
  });
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });
  process.stdout.write(`Protected Ponto ${report.target} environment attested.\n`);
}
