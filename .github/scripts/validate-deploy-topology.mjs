import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const catalog = JSON.parse(read("platform/deploy/operational-units.json"));
const failures = [];
const fail = (message) => failures.push(message);
const workflowDirectory = path.join(root, ".github/workflows");
const workflowFiles = fs.readdirSync(workflowDirectory).filter((name) => /\.ya?ml$/i.test(name));
const canonicalPaths = new Set();
const publishers = new Map();
const publishPattern = /(wrangler(?:@[^\s]+)?\s+(?:pages\s+)?deploy|wrangler[^\n]*\sd1 migrations apply|cloudflare-workers\.sh\s+deploy|appleboy\/ssh-action|npm run deploy(?::[^\s]+)?)/i;

if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.units)) fail("deployment catalog must declare schemaVersion 1 and units");
if (!Array.isArray(catalog.externalPublisherControls)) fail("deployment catalog must declare externalPublisherControls");
for (const control of catalog.externalPublisherControls ?? []) {
  if (!control.id || !control.provider || !control.project || !control.sourceRepository || control.productionDeploymentsEnabled !== false || control.previewDeploymentSetting !== "none") {
    fail("every external publisher control must identify the source and disable automatic production and preview deployment");
  }
}
for (const unit of catalog.units ?? []) {
  if (!unit.id || !Array.isArray(unit.resources) || !Array.isArray(unit.publishes) || !Array.isArray(unit.secrets) || !Array.isArray(unit.migrationPaths) || !Array.isArray(unit.environments)) {
    fail("every operational unit needs id, publishes, resources, secrets, migrationPaths and environments");
    continue;
  }
  for (const resource of unit.publishes) {
    const owner = publishers.get(resource);
    if (owner) fail(`${resource} has more than one publisher: ${owner} and ${unit.id}`);
    publishers.set(resource, unit.id);
  }
  if (!unit.workflow && !unit.canonicalRunbook) fail(`${unit.id} without a GitHub workflow needs a canonical runbook`);
  if (!unit.workflow) continue;
  if (canonicalPaths.has(unit.workflow)) fail(`duplicate canonical workflow ${unit.workflow}`);
  canonicalPaths.add(unit.workflow);
  const sourcePath = path.join(root, unit.workflow);
  if (!fs.existsSync(sourcePath)) {
    fail(`${unit.id} canonical workflow is missing: ${unit.workflow}`);
    continue;
  }
  const source = read(unit.workflow);
  if (!/^\s*workflow_dispatch:/m.test(source)) fail(`${unit.id} must be manually dispatched`);
  if (/^\s{2}(push|schedule|pull_request_target|workflow_run|repository_dispatch):/m.test(source)) fail(`${unit.id} has an automatic publish trigger`);
  if (!/^concurrency:/m.test(source) || !source.includes(unit.concurrencyPrefix)) fail(`${unit.id} must serialize by unit and environment`);
  if (!/^\s+environment:/m.test(source)) fail(`${unit.id} must select a GitHub environment`);
}

for (const retiredPath of catalog.retiredWorkflowPaths ?? []) {
  if (fs.existsSync(path.join(root, retiredPath))) fail(`retired publisher still exists: ${retiredPath}`);
}

for (const filename of workflowFiles) {
  const relativePath = path.posix.join(".github/workflows", filename);
  const source = read(relativePath);
  const publishingLines = source.split(/\r?\n/).filter((line) => publishPattern.test(line) && !/(--local|--dry-run)/i.test(line));
  if (publishingLines.length && !canonicalPaths.has(relativePath)) fail(`non-canonical publisher found: ${relativePath}`);
}

if (failures.length) {
  for (const message of failures) process.stderr.write(`deploy topology validation failed: ${message}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Deployment topology validation OK.\n");
}
