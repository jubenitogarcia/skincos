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
const publishPattern = /(wrangler(?:@[^\s]+)?\s+(?:pages\s+)?deploy\b|wrangler[^\n]*\sd1 migrations apply\b|cloudflare-workers\.sh\s+deploy\b|appleboy\/ssh-action|npm run deploy(?::[^\s]+)?\b)/i;

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
    const owners = publishers.get(resource) ?? [];
    owners.push({ id: unit.id, bootstrapOnly: unit.promotion.bootstrapOnly === true });
    publishers.set(resource, owners);
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

for (const [resource, owners] of publishers) {
  if (owners.length <= 1) continue;
  const bootstrapOwners = owners.filter((owner) => owner.bootstrapOnly);
  const releaseOwners = owners.filter((owner) => !owner.bootstrapOnly);
  if (owners.length !== 2 || bootstrapOwners.length !== 1 || releaseOwners.length !== 1) {
    fail(`${resource} has invalid publisher ownership: ${owners.map((owner) => owner.id).join(" and ")}`);
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
const pontoBaselineUnit = catalog.units.find((unit) => unit.id === 'ponto-core-baseline');
const bootstrap = pontoBaselineUnit?.promotion?.bootstrapEvidence;
for (const required of [
  bootstrap?.state === 'published-and-attested',
  /^[0-9a-f]{40}$/.test(String(bootstrap?.sourceSha || '')),
  /^[0-9]+$/.test(String(bootstrap?.workflowRunId || '')),
  /^[0-9a-f]{40}$/.test(String(bootstrap?.workflowControlSha || '')),
  bootstrap?.workflowPath === '.github/workflows/ponto-core-baseline-publisher.yml',
  bootstrap?.runAttempt === 1,
  ['validation', 'staging', 'production'].every((target) =>
    /^[0-9]+$/.test(String(bootstrap?.artifacts?.[target]?.id || '')) &&
    /^sha256:[0-9a-f]{64}$/.test(String(bootstrap?.artifacts?.[target]?.digest || ''))
  ),
  ['staging', 'production'].every((target) =>
    /^[0-9a-f-]{36}$/i.test(String(bootstrap?.artifacts?.[target]?.deploymentId || '')) &&
    /^[0-9a-f-]{36}$/i.test(String(bootstrap?.artifacts?.[target]?.versionId || ''))
  ),
]) {
  if (!required) fail('Ponto Core bootstrap catalog evidence is incomplete or malformed');
}
const bootstrapVerifier = read('.github/scripts/ponto-core-bootstrap-evidence.mjs');
for (const required of [
  'workflow run path must be pinned to the publisher on refs/heads/main',
  'artifact digest differs from catalog',
  'artifact has expired',
  'bootstrap attempted resource deletion',
  'attested Worker has public routes',
  'attested Worker has custom domains',
  'attestation did not inspect exactly three zones',
]) {
  if (!bootstrapVerifier.includes(required)) fail(`Ponto Core bootstrap verifier is missing: ${required}`);
}
const corePublisher = read('.github/workflows/deploy-core-workers.yml');
const coordinator = read('.github/workflows/ponto-progressive-release.yml');
const productionBaseline = read('.github/workflows/ponto-production-baseline.yml');
const workerCustody = read('.github/workflows/cloudflare-workers-sync-ponto-secrets.yml');
const pagesCustody = read('.github/workflows/cloudflare-pages-sync-ponto.yml');
const timekeepingPublisher = read('.github/workflows/deploy-timekeeping.yml');
const moduleAvailability = read('.github/workflows/module-availability.yml');
if (
  !timekeepingPublisher.includes('default: ponto')
  || !timekeepingPublisher.includes('options: [ponto]')
  || !timekeepingPublisher.includes("required: ${{ inputs.target != 'preview' }}")
  || timekeepingPublisher.includes('options: [general, ponto]')
) {
  fail('Mutating Timekeeping releases must be coordinator-only; only preview may be independently dispatched');
}
for (const [source, label, gate, mutation] of [
  [
    corePublisher,
    'Ponto Core staging publisher',
    'Verify exact cataloged Ponto Core staging bootstrap predecessor',
    'Deploy only the selected operational unit',
  ],
  [
    coordinator,
    'Ponto coordinator',
    'Attest exact Ponto Core bootstrap before any candidate mutation',
    'Put Ponto in maintenance before staging or live mutation',
  ],
  [
    productionBaseline,
    'Ponto production baseline',
    'Verify exact cataloged production Ponto Core bootstrap predecessor',
    'Capture exact incumbent control-plane identities and external maintenance health',
  ],
]) {
  const gateIndex = source.indexOf(gate);
  const mutationIndex = source.indexOf(mutation);
  if (
    gateIndex < 0
    || mutationIndex < 0
    || gateIndex >= mutationIndex
    || !source.includes('ponto-core-bootstrap-evidence.mjs')
    || !source.includes('remoteSnapshot')
  ) {
    fail(`${label} must consume and live-reattest the exact bootstrap evidence before mutation`);
  }
}
const rootGateIndex = coordinator.indexOf('Prove selected root separation before any candidate mutation');
const baselineGateIndex = coordinator.indexOf('Resolve and verify the immutable production baseline before pilot mutation');
const coordinatorMutationIndex = coordinator.indexOf('Put Ponto in maintenance before staging or live mutation');
if (
  rootGateIndex < 0
  || baselineGateIndex < 0
  || coordinatorMutationIndex < 0
  || rootGateIndex >= coordinatorMutationIndex
  || baselineGateIndex >= coordinatorMutationIndex
  || !workerCustody.includes('ponto-root-custody.mjs write')
  || !pagesCustody.includes('rootFingerprint')
  || !timekeepingPublisher.includes('ponto-root-custody.mjs write')
) {
  fail('Ponto root separation must be attested across staging and production before mutation');
}
for (const [source, label] of [
  [workerCustody, 'Worker custody'],
  [pagesCustody, 'Pages custody'],
  [timekeepingPublisher, 'Timekeeping publisher'],
]) {
  for (const expression of [
    '${{ secrets.PONTO_ROOT_ATTESTATION_KEY_SHARED }}',
    '${{ vars.PONTO_ROOT_ATTESTATION_KEY_ID }}',
    '${{ vars.PONTO_IDEMPOTENCY_KEY_CUSTODY_REF }}',
  ]) {
    if (!source.includes(expression)) fail(`${label} is missing the exact root-custody binding: ${expression}`);
  }
  if (source.includes('${{ secrets.PONTO_ROOT_ATTESTATION_KEY }}')) {
    fail(`${label} still accepts the retired unscoped root-attestation secret`);
  }
}
for (const [source, label] of [
  [workerCustody, 'Worker custody'],
  [timekeepingPublisher, 'Timekeeping publisher'],
]) {
  if (!source.includes('${{ vars.PONTO_PROFILE_DATA_KEY_CUSTODY_REF }}')) {
    fail(`${label} is missing the profile-root custody reference`);
  }
}
const pagesUnsetIndex = pagesCustody.indexOf('unset PONTO_ROOT_ATTESTATION_KEY_SHARED PONTO_IDEMPOTENCY_KEY');
const pagesCurlIndex = pagesCustody.indexOf('curl --fail --silent --show-error', pagesUnsetIndex);
const pagesNpxIndex = pagesCustody.indexOf('npx --yes wrangler@4.112.0', pagesUnsetIndex);
if (
  !pagesCustody.includes('root_custody_run_id:')
  || !pagesCustody.includes('attestationKeyCommitment')
  || pagesUnsetIndex < 0
  || pagesCurlIndex < 0
  || pagesNpxIndex < 0
  || pagesUnsetIndex >= pagesCurlIndex
  || pagesUnsetIndex >= pagesNpxIndex
) {
  fail('Pages must validate exact keyed custody and unset application/audit roots before every external child command');
}
const timekeepingRootIndex = timekeepingPublisher.indexOf('Compare live root custody immediately before mutation');
const timekeepingMigrationIndex = timekeepingPublisher.indexOf('Apply additive Timekeeping migrations');
const timekeepingUploadIndex = timekeepingPublisher.indexOf('Upload immutable candidate version');
if (
  !timekeepingPublisher.includes('root_custody_run_id:')
  || !timekeepingPublisher.includes('ROOT_CUSTODY_RUN_ID: ${{ inputs.root_custody_run_id }}')
  || timekeepingRootIndex < 0
  || timekeepingMigrationIndex < 0
  || timekeepingUploadIndex < 0
  || timekeepingRootIndex >= timekeepingMigrationIndex
  || timekeepingRootIndex >= timekeepingUploadIndex
  || !coordinator.includes('inputs.root_custody_run_id = process.env.PONTO_ROOT_CUSTODY_RUN_ID;')
) {
  fail('Timekeeping must consume and revalidate the exact coordinator custody run before migration/upload');
}
if (
  !moduleAvailability.includes("runs-on: ${{ inputs.module == 'timekeeping' && contains(fromJSON('[\"canary\",\"active\"]'), inputs.state)")
  || !moduleAvailability.includes("PONTO_PILOT_COHORT_JSON: ${{ inputs.module == 'timekeeping' && inputs.state == 'canary'")
) {
  fail('Timekeeping canary/active transitions must run on the approved self-hosted context and hydrate cohort only for canary');
}
for (const expression of [
  '${{ secrets.PONTO_PILOT_LOGIN }}',
  '${{ secrets.PONTO_PILOT_PASSWORD }}',
  '${{ secrets.PONTO_PILOT_COHORT_JSON }}',
]) {
  if (coordinator.includes(expression)) {
    fail(`Ponto coordinator must not hydrate pilot material on ubuntu-latest: ${expression}`);
  }
}

if (failures.length) {
  for (const message of failures) process.stderr.write(`deploy topology validation failed: ${message}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Deployment topology validation OK.\n");
}
