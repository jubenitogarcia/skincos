import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const failures = [];
const fail = (message) => failures.push(message);
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const readJson = (relativePath) => JSON.parse(read(relativePath));

const codeowners = read(".github/CODEOWNERS");
const owner = "@jubenitogarcia";
const requiredOwnerPaths = fs.readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== ".git")
  .map((entry) => `/${entry.name}/`)
  .sort();

if (!/^\*\s+@jubenitogarcia(?:\s|$)/m.test(codeowners)) fail("CODEOWNERS must retain the default repository owner");
for (const ownerPath of requiredOwnerPaths) {
  const pattern = new RegExp(`^${ownerPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+${owner}(?:\\s|$)`, "m");
  if (!pattern.test(codeowners)) fail(`CODEOWNERS is missing ${ownerPath} -> ${owner}`);
}

const workflowDirectory = path.join(root, ".github/workflows");
for (const filename of fs.readdirSync(workflowDirectory).filter((name) => /\.ya?ml$/i.test(name))) {
  const relativePath = path.posix.join(".github/workflows", filename);
  for (const [index, line] of read(relativePath).split(/\r?\n/).entries()) {
    const match = line.match(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/);
    if (!match) continue;
    const reference = match[1];
    if (reference.startsWith("./")) continue;
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*@[0-9a-f]{40}$/.test(reference)) {
      fail(`${relativePath}:${index + 1} must pin ${reference} to a full 40-character commit SHA`);
    }
  }
}

const ruleset = readJson(".github/governance/rulesets/main-enterprise-baseline.json");
if (ruleset.name !== "main-enterprise-baseline" || ruleset.target !== "branch") {
  fail("main ruleset must declare the canonical name and branch target");
}
if (ruleset.enforcement !== "active" || !ruleset.conditions?.ref_name?.include?.includes("~DEFAULT_BRANCH")) {
  fail("main ruleset must actively target the default branch");
}
for (const requiredRule of ["deletion", "non_fast_forward", "pull_request", "required_status_checks"]) {
  if (!ruleset.rules?.some((rule) => rule.type === requiredRule)) fail(`main ruleset is missing ${requiredRule}`);
}

const environmentBranchPolicy = readJson(".github/governance/environments/main-branch-policy.json");
if (environmentBranchPolicy.name !== "main" || environmentBranchPolicy.type !== "branch") {
  fail("environment branch policy must select exactly the main branch");
}

for (const environmentName of ["staging", "production"]) {
  const environment = readJson(`.github/governance/environments/${environmentName}.json`);
  if (
    environment.wait_timer !== 0
    || environment.prevent_self_review !== true
    || environment.can_admins_bypass !== false
  ) {
    fail(`${environmentName} must require a non-bypassable self-review-safe deployment approval without a wait timer`);
  }
  if (
    environment.reviewers?.length !== 1 ||
    environment.reviewers[0]?.type !== "User" ||
    environment.reviewers[0]?.id !== 199169872
  ) {
    fail(`${environmentName} must preserve the fail-closed deployment reviewer`);
  }
  if (
    environment.deployment_branch_policy?.protected_branches !== false ||
    environment.deployment_branch_policy?.custom_branch_policies !== true
  ) {
    fail(`${environmentName} must use the versioned custom main branch policy`);
  }
}

if (failures.length) {
  for (const message of failures) process.stderr.write(`github governance validation failed: ${message}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("GitHub governance validation OK.\n");
}
