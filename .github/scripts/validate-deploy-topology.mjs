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
  if (!unit.id || !unit.promotion || typeof unit.promotion.stagingSupported !== "boolean" || !Array.isArray(unit.resources) || !Array.isArray(unit.publishes) || !Array.isArray(unit.secrets) || !Array.isArray(unit.migrationPaths) || !Array.isArray(unit.environments)) {
    fail("every operational unit needs promotion, publishes, resources, secrets, migrationPaths and environments");
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
  if (!/^permissions:\r?\n\s+actions:\s+read\r?\n\s+contents:\s+read/m.test(source)) fail(`${unit.id} must grant the promotion gate actions: read and contents: read`);
  if (unit.promotion.bootstrapOnly === true) {
    for (const required of [
      'baseline_sha',
      'confirm_staging',
      'confirm_production',
      'ponto-core-baseline-publisher.mjs',
      'environment: staging',
      'environment: production',
      'if: always()',
    ]) {
      if (!source.includes(required)) fail(`${unit.id} bootstrap publisher is missing: ${required}`);
    }
    if (source.includes('promotion-gate.yml')) fail(`${unit.id} bootstrap must not masquerade as a release promotion`);
  } else if (!source.includes("promotion-gate.yml") || !source.includes("release_sha") || !source.includes("staging_run_id")) {
    fail(`${unit.id} must use the immutable promotion gate`);
  }
}

for (const retiredPath of catalog.retiredWorkflowPaths ?? []) {
  if (fs.existsSync(path.join(root, retiredPath))) fail(`retired publisher still exists: ${retiredPath}`);
}

for (const filename of workflowFiles) {
  const relativePath = path.posix.join(".github/workflows", filename);
  const source = read(relativePath);
  if (/:\s*\{[^\r\n}]*\$\{\{/.test(source)) {
    fail(`${relativePath} uses a GitHub expression inside a compact YAML map; use a block mapping so GitHub can parse the workflow.`);
  }
  const publishingLines = source.split(/\r?\n/).filter((line) => publishPattern.test(line) && !/(--local|--dry-run)/i.test(line));
  if (publishingLines.length && !canonicalPaths.has(relativePath)) fail(`non-canonical publisher found: ${relativePath}`);
}

const financeWorkflow = read('.github/workflows/deploy-finance.yml');
for (const required of [
  'finance-production-preflight.mjs',
  'ENABLE_FINANCE_PRODUCTION_DEPLOY',
  'Attest production authorization and remote resources before mutation',
  'Provision or attest Finance service secret before D1 checkpoint',
  'FINANCE_PRODUCTION_WORKER_URL',
  'worker-release-smoke.mjs',
  '--consecutive-successes 2',
]) {
  if (!financeWorkflow.includes(required)) fail(`Finance publisher is missing its production safety gate: ${required}`);
}
const financePreflightIndex = financeWorkflow.indexOf('Attest production authorization and remote resources before mutation');
const financeSecretIndex = financeWorkflow.indexOf('Provision or attest Finance service secret before D1 checkpoint');
const financeCheckpointIndex = financeWorkflow.indexOf('Capture encrypted D1 checkpoint before migrations');
const financeMigrationIndex = financeWorkflow.indexOf('Apply additive Finance migrations');
const financeUploadIndex = financeWorkflow.indexOf('Upload immutable Finance version');
if (
  [financePreflightIndex, financeSecretIndex, financeCheckpointIndex, financeMigrationIndex, financeUploadIndex].some((index) => index < 0) ||
  !(financePreflightIndex < financeSecretIndex &&
    financeSecretIndex < financeCheckpointIndex &&
    financeCheckpointIndex < financeMigrationIndex &&
    financeMigrationIndex < financeUploadIndex)
) {
  fail('Finance production preflight and secret attestation must precede checkpoint, migration and upload');
}
for (const filename of fs.readdirSync(path.join(root, 'finance/migrations')).filter((name) => /^\d{4}_.+\.sql$/.test(name))) {
  const migration = read(path.posix.join('finance/migrations', filename)).replace(/^--.*$/gm, '');
  if (/\bDROP\b/i.test(migration)) fail(`Finance migration violates the additive-only policy: ${filename}`);
}

const pontoBaselinePublisher = read('.github/scripts/ponto-core-baseline-publisher.mjs');
for (const required of [
  'EXPECTED_CHANGED_FILES',
  'baseline_sha is not reachable from origin/main',
  'must have exactly one active version at 100%',
  'workers.dev endpoint is enabled',
  'preview URLs are enabled',
  'public Worker routes',
  'public custom domain',
  'resourceDeletionAttempted: false',
]) {
  if (!pontoBaselinePublisher.includes(required)) fail(`Ponto Core baseline publisher is missing: ${required}`);
}
if (/['"]delete['"]\s*,|wrangler(?:@\S+)?\s+delete|workers\/scripts\/.+method:\s*['"]DELETE['"]/i.test(pontoBaselinePublisher)) {
  fail('Ponto Core baseline publisher must never delete a remote resource during rollback');
}

if (failures.length) {
  for (const message of failures) process.stderr.write(`deploy topology validation failed: ${message}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Deployment topology validation OK.\n");
}
