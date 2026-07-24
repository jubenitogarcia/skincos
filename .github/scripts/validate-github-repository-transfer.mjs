import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const plan = JSON.parse(fs.readFileSync(path.join(root, "ops/governance/github-repository-transfer-plan.json"), "utf8"));
const failures = [];
const fail = (message) => failures.push(message);

if (plan.schemaVersion !== 1) fail("transfer plan schemaVersion must be 1");
if (plan.source?.repository !== "jubenitogarcia/skincos" || plan.source?.defaultBranch !== "main") {
  fail("transfer plan must identify the current repository and main branch");
}
if (plan.target?.visibility !== "private" || plan.target?.repository !== "skincos") {
  fail("transfer plan must require the private skincos target repository");
}
if (plan.target?.organization !== null && !/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(plan.target?.organization || "")) {
  fail("target organization must be null until selected or a valid GitHub slug");
}
if (!Array.isArray(plan.target?.selectionRequired) || !plan.target.selectionRequired.includes("two distinct GitHub owner accounts")) {
  fail("transfer plan must require two distinct GitHub owner accounts");
}

const expectedTeams = new Set(["skincos-platform", "skincos-crm", "skincos-finance", "skincos-workforce", "skincos-inventory", "skincos-web", "skincos-security"]);
const declaredTeams = new Set((plan.teamBlueprint || []).map((team) => team.slug));
for (const team of expectedTeams) if (!declaredTeams.has(team)) fail(`transfer plan is missing team ${team}`);
if (declaredTeams.size !== (plan.teamBlueprint || []).length) fail("transfer plan team slugs must be unique");
for (const team of plan.teamBlueprint || []) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(team.slug || "") || !["push", "maintain"].includes(team.permission)) {
    fail(`transfer plan has invalid team ${team.slug || "<missing>"}`);
  }
}

const mappedTeams = new Set();
for (const mapping of plan.codeownersBlueprint || []) {
  if (!declaredTeams.has(mapping.team)) fail(`CODEOWNERS mapping references undeclared team ${mapping.team || "<missing>"}`);
  if (!Array.isArray(mapping.paths) || !mapping.paths.every((entry) => typeof entry === "string" && entry.startsWith("/"))) {
    fail(`CODEOWNERS mapping for ${mapping.team || "<missing>"} must use absolute repository paths`);
  }
  mappedTeams.add(mapping.team);
}
for (const team of expectedTeams) if (!mappedTeams.has(team)) fail(`CODEOWNERS blueprint is missing ${team}`);

const coveredPaths = new Set((plan.codeownersBlueprint || []).flatMap((mapping) => mapping.paths));
const ignoredTopLevelDirectories = new Set([".git", ".codex", "node_modules"]);
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory() || ignoredTopLevelDirectories.has(entry.name)) continue;
  const ownerPath = `/${entry.name}/`;
  if (!coveredPaths.has(ownerPath)) fail(`CODEOWNERS blueprint is missing current path ${ownerPath}`);
}

const forbidden = new Set(plan.scopeGuards?.forbiddenInTransferWindow || []);
for (const operation of ["production deploy", "database migration", "pilot activation", "feature-flag change"]) {
  if (!forbidden.has(operation)) fail(`transfer plan must forbid ${operation} during the transfer window`);
}
if (plan.scopeGuards?.previewMustNotDeploy !== true) fail("transfer plan preview must remain no-deploy");
if (!Array.isArray(plan.requiredPostTransferChecks) || plan.requiredPostTransferChecks.length < 7) {
  fail("transfer plan must declare post-transfer checks");
}

if (failures.length) {
  for (const message of failures) process.stderr.write(`github transfer validation failed: ${message}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("GitHub repository transfer plan validation OK.\n");
}
