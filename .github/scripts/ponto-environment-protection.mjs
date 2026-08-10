import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const TARGETS = new Set(["staging", "production"]);
const POLICY_FILE = new URL("../governance/progressive-release-policy.json", import.meta.url);

const loadGovernance = () => {
  try {
    return JSON.parse(fs.readFileSync(POLICY_FILE, "utf8"))?.governance || null;
  } catch {
    return null;
  }
};

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
  governance = loadGovernance(),
}) {
  const selectedTarget = String(target || "").trim().toLowerCase();
  const triggeringActor = String(actor || "").trim().toLowerCase();
  if (!TARGETS.has(selectedTarget) || !triggeringActor) {
    throw new Error("Ponto environment protection identity is invalid");
  }
  if (
    governance?.authorizationModel !== "single-operator-codex"
    || governance?.humanReviewerRequired !== false
    || governance?.mainOnly !== true
    || governance?.canonicalMergedPullRequestRequired !== true
    || governance?.administratorBypassAllowed !== false
    || String(governance?.operatorLogin || "").trim().toLowerCase() !== triggeringActor
  ) {
    throw new Error("Ponto single-operator governance attestation is invalid");
  }
  const environmentPolicy = governance.environmentProtection?.[selectedTarget];
  if (
    !environmentPolicy
    || environmentPolicy.requiredReviewers !== 0
    || environmentPolicy.preventSelfReview !== false
    || environmentPolicy.protectedBranches !== false
    || environmentPolicy.customBranchPolicies !== true
    || environmentPolicy.requiredBranch !== "main"
    || environmentPolicy.releaseTagPolicy !== "skincos/release/ponto/*"
  ) {
    throw new Error("Ponto environment governance does not declare the reviewed single-operator contract");
  }
  if (
    environment?.name !== selectedTarget
    || environment?.deployment_branch_policy?.protected_branches !== false
    || environment?.deployment_branch_policy?.custom_branch_policies !== true
    || environment?.can_admins_bypass !== false
  ) {
    throw new Error(
      "Ponto environment must use the governed root and immutable release namespace, and forbid administrator bypass",
    );
  }

  const policies = branchPolicies?.branch_policies;
  if (!Array.isArray(policies) || branchPolicies?.total_count !== 2 || policies.length !== 2) {
    throw new Error("Ponto environment must allow exactly main and the immutable Ponto release tag namespace");
  }
  const mainPolicy = policies.find((policy) => policy?.name === "main");
  const releaseTagPolicy = policies.find((policy) => policy?.name === "skincos/release/ponto/*");
  if (
    !mainPolicy
    || !["", "branch"].includes(String(mainPolicy.type || ""))
    || !isPositiveId(mainPolicy.id)
    || !releaseTagPolicy
    || releaseTagPolicy.type !== "tag"
    || !isPositiveId(releaseTagPolicy.id)
  ) throw new Error("Ponto environment branch policies are not the governed main plus immutable release namespace");

  const reviewerRules = (environment?.protection_rules || [])
    .filter((rule) => rule?.type === "required_reviewers");
  if (reviewerRules.length !== 0) {
    throw new Error("Ponto single-operator environment must not require a human reviewer");
  }
  const branchRules = (environment?.protection_rules || [])
    .filter((rule) => rule?.type === "branch_policy");
  if (branchRules.length > 1 || (branchRules.length === 1 && !isPositiveId(branchRules[0]?.id))) {
    throw new Error("Ponto environment has an invalid branch-policy protection rule");
  }

  const report = {
    schemaVersion: 1,
    target: selectedTarget,
    mainOnly: true,
    customBranchPolicyCount: 2,
    releaseTagPolicy: "skincos/release/ponto/*",
    administratorBypassDisabled: true,
    authorizationModel: "single-operator-codex",
    operatorLogin: triggeringActor,
    preventSelfReview: false,
    requiredReviewerRuleCount: 0,
    configuredReviewerCount: 0,
    independentReviewerCount: 0,
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
