import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const jobSource = (source, name) => {
  const marker = `  ${name}:\n`;
  const start = source.indexOf(marker);
  if (start < 0) return "";
  const remaining = source.slice(start + marker.length);
  const next = /\n  [a-zA-Z0-9_-]+:\n/.exec(remaining);
  return source.slice(start, next ? start + marker.length + next.index : source.length);
};
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
  if (unit.promotion.publisherType === 'coordination-plane') {
    for (const required of [
      'global-coordinator-deployment-guard.mjs',
      'global:global-coordinator-writer',
      'allow_production_bootstrap',
      'environment: ${{ inputs.target }}',
    ]) {
      if (!source.includes(required)) fail(`${unit.id} coordination publisher is missing: ${required}`);
    }
  } else if (unit.promotion.bootstrapOnly === true) {
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
  'workflow run path must equal the canonical publisher workflow',
  'workflow run head_branch must be main',
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
const crmPagesPublisher = read('.github/workflows/deploy-crm-pages.yml');
const coordinator = read('.github/workflows/ponto-progressive-release.yml');
const orchestratorGate = read('.github/workflows/ponto-orchestrator-gate.yml');
const emergencyLatchReset = read('.github/workflows/ponto-emergency-latch-reset.yml');
const emergencyClose = read('.github/workflows/ponto-emergency-close.yml');
const emergencyCloseOnly = jobSource(emergencyClose, 'close');
const emergencyCloseMaterialize = jobSource(emergencyClose, 'materialize');
const emergencyBroker = read('.github/scripts/ponto-emergency-broker.mjs');
const progressivePolicy = JSON.parse(read('.github/governance/progressive-release-policy.json'));
const emergencyIdleAssertion = read('.github/scripts/ponto-assert-idle.mjs');
const recoveryEvidence = read('.github/scripts/ponto-recovery-evidence.mjs');
const automaticRollback = read('.github/scripts/ponto-automatic-rollback.mjs');
const environmentProtection = read('.github/scripts/ponto-environment-protection.mjs');
const productionBaseline = read('.github/workflows/ponto-production-baseline.yml');
const productionSlo = read('.github/workflows/ponto-production-slo.yml');
const productionJourney = read('.github/scripts/ponto-production-journey.mjs');
const productionSloPreflight = read('.github/scripts/ponto-production-slo-preflight.mjs');
const jitCredentialAttestation = read('.github/scripts/ponto-jit-credential-attestation.mjs');
const clinicRunnerAttestation = read('.github/scripts/ponto-clinic-runner-attestation.mjs');
const jitCleanupService = read('ops/runtime/units/skincos-ponto-jit-credential-cleanup.service');
const jitCleanupTimer = read('ops/runtime/units/skincos-ponto-jit-credential-cleanup.timer');
const dispatchWorkflow = read('.github/scripts/ponto-dispatch-workflow.mjs');
const workerCustody = read('.github/workflows/cloudflare-workers-sync-ponto-secrets.yml');
const pagesCustody = read('.github/workflows/cloudflare-pages-sync-ponto.yml');
const timekeepingPublisher = read('.github/workflows/deploy-timekeeping.yml');
const moduleAvailability = read('.github/workflows/module-availability.yml');
const emergencyStop = read('.github/scripts/ponto-emergency-stop.mjs');
const watchdogJournal = read('.github/scripts/ponto-watchdog-journal.mjs');
const wafSecurityWorkflow = read('.github/workflows/ponto-waf-security.yml');
const pagesSecretWriters = [
  '.github/workflows/cloudflare-pages-sync-escala.yml',
  '.github/workflows/cloudflare-pages-sync-meta-ads-report-secret.yml',
  '.github/workflows/cloudflare-sync-integrations-encryption-secret.yml',
];
const trustedGateCheckout = [
  'ref: ${{ github.sha }}',
  'ref: ${{ github.workflow_sha }}',
].some((expression) => orchestratorGate.includes(expression));
const gateCheckoutIndex = orchestratorGate.indexOf('actions/checkout@');
const gateTrustedHeadIndex = orchestratorGate.indexOf('git rev-parse HEAD');
const gateConsumeIndex = orchestratorGate.indexOf('ponto-orchestrator-lease.mjs consume');
if (
  !trustedGateCheckout
  || orchestratorGate.includes('ref: ${{ inputs.release_sha }}')
  || gateCheckoutIndex < 0
  || gateTrustedHeadIndex < 0
  || gateConsumeIndex < 0
  || !(gateCheckoutIndex < gateTrustedHeadIndex && gateTrustedHeadIndex < gateConsumeIndex)
  || !orchestratorGate.includes('assertPontoSourceClosureUnchanged')
  || !orchestratorGate.includes('git rev-parse HEAD)" == "$GITHUB_SHA"')
) {
  fail('Ponto orchestrator capability verification must execute trusted main workflow code and attest the immutable dependency closure');
}
for (const [source, label] of [
  [productionBaseline, 'Ponto production baseline'],
  [productionSlo, 'Ponto production SLO'],
]) {
  if (
    source.includes('ref: ${{ inputs.release_sha }}')
    || !source.includes('ref: ${{ github.sha }}')
    || !source.includes('assertPontoSourceClosureUnchanged')
    || !source.includes('git rev-parse HEAD')
  ) {
    fail(`${label} must prove the trusted main checkout and immutable dependency closure before hydrating production secrets`);
  }
}
const clinicSloStart = productionSlo.indexOf('  consultor-journey:');
const custodyPreparationStart = productionSlo.indexOf('  prepare-clinic-credentials:');
const rollbackSloStart = productionSlo.indexOf('  rollback-observation:');
const clinicSlo = clinicSloStart >= 0 && rollbackSloStart > clinicSloStart
  ? productionSlo.slice(clinicSloStart, rollbackSloStart)
  : '';
const custodyPreparation = custodyPreparationStart >= 0 && clinicSloStart > custodyPreparationStart
  ? productionSlo.slice(custodyPreparationStart, clinicSloStart)
  : '';
if (
  !custodyPreparation.includes('runs-on: [self-hosted, Linux, X64, skincos-native-custody]')
  || !custodyPreparation.includes('ponto-orchestrator-lease.mjs assert-active')
  || !custodyPreparation.includes('Authorize global Ponto JIT custody mutation')
  || !custodyPreparation.includes('skincos-provision-ponto-jit materialize')
  || !custodyPreparation.includes('PONTO_PILOT_LOGIN: ${{ secrets.PONTO_PILOT_LOGIN }}')
  || !custodyPreparation.includes('PONTO_PILOT_PASSWORD: ${{ secrets.PONTO_PILOT_PASSWORD }}')
  || custodyPreparation.indexOf('ponto-orchestrator-lease.mjs assert-active')
    > custodyPreparation.indexOf('secrets.PONTO_PILOT_LOGIN')
) {
  fail('Ponto JIT custody must materialize only after the exact coordinator is revalidated on the isolated custody runner');
}
const runnerInventoryStart = productionSlo.indexOf(
  '      - name: Attest the exact registered clinic runner before hydrating control-plane authority',
);
const runnerInventoryEnd = productionSlo.indexOf(
  '      - name: Attest exact Pages control plane without pilot or root custody',
  runnerInventoryStart,
);
const runnerInventoryStep = runnerInventoryStart >= 0 && runnerInventoryEnd > runnerInventoryStart
  ? productionSlo.slice(runnerInventoryStart, runnerInventoryEnd)
  : '';
if (
  !runnerInventoryStep.includes('GH_TOKEN: ${{ secrets.GH_TOKEN }}')
  || runnerInventoryStep.includes('GH_TOKEN: ${{ github.token }}')
  || !runnerInventoryStep.includes('GH_TOKEN with Administration:read and Variables:read is required')
  || !runnerInventoryStep.includes('actions/runners?per_page=100')
  || !runnerInventoryStep.includes('actions/variables/PONTO_PILOT_RUNNER_LABELS_JSON')
  || !runnerInventoryStep.includes('actions/variables/PONTO_PILOT_RUNNER_ENCRYPTION_PUBLIC_KEY_PEM')
  || !runnerInventoryStep.includes('environments/production/variables?per_page=100')
  || !runnerInventoryStep.includes('Ponto pilot runner repository variables may not be shadowed by the production environment')
  || !runnerInventoryStep.includes('matching.length !== 1')
  || !runnerInventoryStep.includes('runner_labels_json=')
  || !productionSlo.includes("runs-on: ${{ fromJSON(needs.control-plane-preflight.outputs.runner_labels_json || '[\"ponto-unavailable\"]') }}")
  || runnerInventoryStep.includes('CONFIGURED_RUNNER_LABELS_JSON: ${{ vars.')
) {
  fail('Ponto runner inventory must use protected read-only custody and prove the unshadowed repository runs-on selector');
}
for (const forbidden of [
  'secrets.PONTO_PILOT_LOGIN',
  'secrets.PONTO_PILOT_PASSWORD',
  'secrets.CF_ACCESS_CLIENT_ID',
  'secrets.CF_ACCESS_CLIENT_SECRET',
  'secrets.PONTO_PILOT_RUNNER_ENCRYPTION_PRIVATE_KEY_PEM',
  'secrets.PONTO_IDEMPOTENCY_KEY',
  'secrets.PONTO_ROOT_ATTESTATION_KEY_SHARED',
  'PONTO_PILOT_RUNNER_ENCRYPTION_PRIVATE_KEY_PEM:',
]) {
  if (clinicSlo.includes(forbidden)) {
    fail(`Ponto clinic SLO job must not hydrate GitHub or host-global secret custody: ${forbidden}`);
  }
}
for (const required of [
  'PONTO_SLO_PREFLIGHT_ARTIFACT_ID:',
  'PONTO_SLO_PREFLIGHT_ARTIFACT_DIGEST:',
  'persist-credentials: false',
  'merge-multiple: true',
  'ponto-jit-credential-attestation.mjs cleanup',
  'if: ${{ always() }}',
]) {
  if (!clinicSlo.includes(required)) {
    fail(`Ponto clinic SLO job is missing JIT one-shot custody: ${required}`);
  }
}
for (const required of [
  'Type=oneshot',
  'User=root',
  'cleanup-expired',
  'ProtectSystem=strict',
  'NoNewPrivileges=true',
  'ReadWritePaths=/var/lib/skincos/ponto-jit',
]) {
  if (!jitCleanupService.includes(required)) {
    fail(`Ponto JIT credential expiration cleanup service is missing: ${required}`);
  }
}
for (const required of [
  'OnUnitInactiveSec=1min',
  'Persistent=true',
  'Unit=skincos-ponto-jit-credential-cleanup.service',
]) {
  if (!jitCleanupTimer.includes(required)) {
    fail(`Ponto JIT credential expiration cleanup timer is missing: ${required}`);
  }
}
for (const required of [
  'repositoryId',
  'workflowRef',
  'workflowJob',
  'coordinatorRunId',
  'coordinatorIssuerRunId',
  'coordinatorDispatchNonce',
  'workflowRunId',
  'runAttempt',
  'preflightArtifactId',
  'preflightArtifactSha256',
  'runnerId',
  'runnerName',
  'runnerIsolationRef',
  'networkContextCustodyRef',
  'credentialBundleSha256',
  'decryptKeySha256',
  'attestationNonce',
  'expiresAt',
  'Ed25519',
  'metadata.uid !== expectedOwner',
  '(metadata.mode & 0o777) !== 0o600',
  '(metadata.mode & 0o777) !== expectedMode',
  '0o711',
  'O_NOFOLLOW',
  'fs.fstatSync',
  'cleanupJitFiles',
  'skincos-provision-ponto-jit',
]) {
  if (!jitCredentialAttestation.includes(required)) {
    fail(`Ponto JIT supervisor attestation is missing: ${required}`);
  }
}
for (const required of [
  'consumeJitCredentials',
  'runnerEncryptionPrivateKeyPem',
  'crypto.privateDecrypt',
  'rsa-oaep-sha256',
  'releaseProbeCapabilityMatched',
]) {
  if (!productionJourney.includes(required)) {
    fail(`Ponto production journey is missing JIT/delegated capability control: ${required}`);
  }
}
if (
  !productionSloPreflight.includes('crypto.publicEncrypt')
  || !productionSloPreflight.includes('RSA_PKCS1_OAEP_PADDING')
  || !productionSloPreflight.includes('rootKeyIncluded: false')
  || !clinicRunnerAttestation.includes('private key in process environment is forbidden')
) {
  fail('Ponto production SLO must transfer only an RSA-OAEP encrypted delegation and consume the runner decrypt key from an owner-isolated JIT file');
}
for (const target of ['staging', 'production']) {
  const runner = progressivePolicy?.pilotRunner?.[target];
  for (const field of [
    'runnerId',
    'runnerName',
    'runnerIsolationRef',
    'requiredLabels',
    'networkContextCustodyRef',
    'encryptionPublicKeySha256',
    'jitMode',
    'jitAttestationKeyId',
    'jitAttestationPublicKeyPem',
    'jitAttestationFilePath',
    'jitCredentialBundleFilePath',
    'jitDecryptKeyFilePath',
    'jitSupervisorCustodyRef',
    'jitCleanupHookCustodyRef',
  ]) {
    if (!Object.hasOwn(runner || {}, field)) {
      fail(`Ponto ${target} runner policy is missing fail-closed field ${field}`);
    }
  }
}
const wafCustodyIndex = wafSecurityWorkflow.indexOf(
  'Attest split WAF token custody before hydrating write authority',
);
const wafWriteHydrationIndex = wafSecurityWorkflow.indexOf(
  'PONTO_WAF_WRITE_API_TOKEN: ${{ secrets.PONTO_WAF_WRITE_API_TOKEN }}',
);
const wafCustodyBlock = wafSecurityWorkflow.slice(
  wafCustodyIndex,
  wafWriteHydrationIndex,
);
for (const required of [
  'actions/secrets?per_page=100',
  'environments/staging/secrets?per_page=100',
  'environments/production/secrets?per_page=100',
  'orgs/$owner_login/actions/secrets?per_page=100',
  '!repository.has(read)',
  'repository.has(write)',
  'owner.has(read)',
  'owner.has(write)',
  'staging.has(read)',
  'staging.has(write)',
  'production.has(read)',
  '!production.has(write)',
]) {
  if (
    wafCustodyIndex < 0
    || wafWriteHydrationIndex <= wafCustodyIndex
    || !wafCustodyBlock.includes(required)
  ) {
    fail(
      'Standalone Ponto WAF apply must attest repository-read and production-environment-write custody before hydrating write authority',
    );
  }
}
const wafProbeCustodyIndex = wafSecurityWorkflow.indexOf(
  'Attest read-only WAF token custody before hydrating probe authority',
);
const wafReadHydrationIndex = wafSecurityWorkflow.indexOf(
  'PONTO_WAF_READ_API_TOKEN: ${{ secrets.PONTO_WAF_READ_API_TOKEN }}',
);
const wafProbeCustodyBlock = wafSecurityWorkflow.slice(
  wafProbeCustodyIndex,
  wafReadHydrationIndex,
);
for (const required of [
  'actions/secrets?per_page=100',
  'environments/staging/secrets?per_page=100',
  'environments/production/secrets?per_page=100',
  'orgs/$owner_login/actions/secrets?per_page=100',
  '!repository.has(read)',
  'repository.has(write)',
  'owner.has(read)',
  'owner.has(write)',
  'staging.has(read)',
  'staging.has(write)',
  'production.has(read)',
]) {
  if (
    wafProbeCustodyIndex < 0
    || wafReadHydrationIndex <= wafProbeCustodyIndex
    || !wafProbeCustodyBlock.includes(required)
  ) {
    fail(
      'Standalone Ponto WAF probe must attest repository-only read custody before hydrating read authority',
    );
  }
}
for (const {
  workflow,
  leaseKey,
  source,
  minimumNeeds,
} of [
  {
    workflow: 'ponto-production-baseline.yml',
    leaseKey: 'production-baseline',
    source: productionBaseline,
    minimumNeeds: 1,
  },
  {
    workflow: 'ponto-production-slo.yml',
    leaseKey: 'production-slo',
    source: productionSlo,
    minimumNeeds: 2,
  },
]) {
  const needsCount = (source.match(/^\s+needs:\s+orchestrator\s*$/gm) || []).length;
  if (
    !dispatchWorkflow.includes(`workflow === "${workflow}") return "${leaseKey}"`)
    || !source.includes('uses: ./.github/workflows/ponto-orchestrator-gate.yml')
    || !source.includes(`lease_key: ${leaseKey}`)
    || !source.includes('stage: ${{ inputs.orchestrator_stage }}')
    || !source.includes('orchestrator_run_id: ${{ inputs.orchestrator_run_id }}')
    || !source.includes('deployments: read')
    || source.includes('PONTO_ORCHESTRATOR_CAPABILITY_PRIVATE_KEY')
    || !orchestratorGate.includes('ponto-orchestrator-lease.mjs consume-check')
    || !orchestratorGate.includes('PONTO_ORCHESTRATOR_CAPABILITY_PUBLIC_KEYS_JSON')
    || orchestratorGate.includes('environment:')
    || needsCount < minimumNeeds
  ) {
    fail(`${workflow} must consume its own exact check-run single-use coordinator capability before privileged work`);
  }
}
const coordinatorProtectionIndex = Math.max(
  coordinator.indexOf('Attest single-operator Codex governance and protected environment before issuing any capability'),
  coordinator.indexOf('Attest protected selected environment before issuing any capability'),
);
const coordinatorCapabilityIndex = coordinator.indexOf('Verify target-bound asymmetric child capability custody');
const gateProtectionIndex = orchestratorGate.indexOf('Revalidate protected target environment before consuming authority');
const protectedGateConsumeIndex = orchestratorGate.indexOf('Validate, transition, and confirm the exact child-bound coordinator capability');
if (
  coordinatorProtectionIndex < 0
  || coordinatorCapabilityIndex < 0
  || coordinatorProtectionIndex >= coordinatorCapabilityIndex
  || gateProtectionIndex < 0
  || protectedGateConsumeIndex < 0
  || gateProtectionIndex >= protectedGateConsumeIndex
  || !coordinator.includes('ponto-environment-protection.mjs')
  || !orchestratorGate.includes('ponto-environment-protection.mjs')
  || !orchestratorGate.includes('deployment-branch-policies?per_page=100')
  || !orchestratorGate.includes('deployments: read')
  || !environmentProtection.includes('reviewerRules.length !== 0')
  || !environmentProtection.includes('authorizationModel: "single-operator-codex"')
  || !environmentProtection.includes('environment?.can_admins_bypass !== false')
  || !environmentProtection.includes('releaseTagPolicy.type !== "tag"')
  || !environmentProtection.includes('policy?.name === "skincos/release/ponto/*"')
) {
  fail('Ponto coordinator and capability consumers must attest exact live environment protection before authority is issued or consumed');
}
if (
  !coordinator.includes('environment?.can_admins_bypass !== false')
  || !coordinator.includes('protectionRules.length !== 1')
  || !coordinator.includes('protectionRules[0]?.type !== "branch_policy"')
  || coordinator.includes('(environment?.protection_rules || []).length !== 0')
) {
  fail('Ponto emergency broker environments must disable admin bypass and allow exactly the implicit protected-branch rule while rejecting review or delay rules');
}
if (
  !['staging', 'production'].every((target) => {
    const identity = progressivePolicy?.emergencyBrokers?.[target];
    return identity
      && Object.hasOwn(identity, 'url')
      && Object.hasOwn(identity, 'custodyRef')
      && Object.hasOwn(identity, 'responseKeyId')
      && Object.hasOwn(identity, 'responsePublicKeyPem');
  })
  || !coordinator.includes('brokerPolicies = read(".github/governance/progressive-release-policy.json").emergencyBrokers')
  || !coordinator.includes('variables.PONTO_EMERGENCY_CLOSE_BROKER_URL !== brokerPolicy.url')
  || !coordinator.includes('variables.PONTO_EMERGENCY_CLOSE_CUSTODY_REF !== brokerPolicy.custodyRef')
  || !emergencyBroker.includes('url.toString() !== expectedUrl.toString()')
  || !emergencyBroker.includes('createHmac("sha256", config.credential)')
  || !emergencyBroker.includes('verifySignature(')
  || !emergencyBroker.includes('attestation?.responseDigest !== sha256(canonicalJson(unsignedPayload))')
  || !emergencyBroker.includes('canonicalJson(attestation?.requestBinding) !== canonicalJson(requestBinding)')
) {
  fail('Ponto emergency broker must pin exact reviewed target identities and authenticate fresh request and response envelopes before custody is trusted');
}
const baselineSourceGateIndex = productionBaseline.indexOf('Verify immutable source and exact staging predecessor before hydrating secrets');
const baselineBootstrapIndex = productionBaseline.indexOf('Verify exact cataloged production Ponto Core bootstrap predecessor');
if (
  baselineSourceGateIndex < 0
  || baselineBootstrapIndex < 0
  || baselineSourceGateIndex >= baselineBootstrapIndex
) {
  fail('Ponto production baseline must verify exact source/predecessor provenance before using Cloudflare secrets');
}
for (const output of [
  'bootstrap_workflow_run_id',
  'bootstrap_artifact_id',
  'bootstrap_artifact_digest',
  'bootstrap_source_sha',
  'bootstrap_deployment_id',
  'bootstrap_version_id',
  'bootstrap_live_attested',
]) {
  const outputLine = productionBaseline
    .split(/\r?\n/)
    .find((line) => line.includes(`echo "${output}=`));
  if (!outputLine) fail(`Ponto production baseline does not write required core bootstrap output: ${output}`);
}
if (!/^concurrency:\r?\n\s+group:\s+ponto-surface-mutation\r?\n\s+cancel-in-progress:\s+false/m.test(crmPagesPublisher)) {
  fail('CRM Pages mutations must serialize preview, general, and governed Ponto writes with the global surface mutex');
}
for (const workflow of pagesSecretWriters) {
  const source = read(workflow);
  if (
    !/\bpages secret (?:put|delete)\b/.test(source)
    || !/^concurrency:\r?\n\s+group:\s+ponto-surface-mutation\r?\n\s+cancel-in-progress:\s+false/m.test(source)
    || source.includes('deploy-crm-pages-reconcile.yml')
  ) {
    fail(`${workflow} must serialize every CRM Pages secret mutation with the global Ponto surface mutex and never dispatch the retired auxiliary publisher`);
  }
}
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
    'Verify cataloged Ponto Core staging predecessor',
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
  const consumesHistoricalBootstrap = source.includes('ponto-core-bootstrap-evidence.mjs') && source.includes('remoteSnapshot');
  const consumesCatalogedPredecessor = source.includes('ponto-core-staging-precondition.mjs') && source.includes('CORE_STAGING_INCUMBENT_VERSION_ID');
  if (
    gateIndex < 0
    || mutationIndex < 0
    || gateIndex >= mutationIndex
    || (!consumesHistoricalBootstrap && !consumesCatalogedPredecessor)
  ) {
    fail(`${label} must consume and live-reattest the exact bootstrap evidence before mutation`);
  }
}
const rootGateIndex = coordinator.indexOf('Prove selected root separation before any candidate mutation');
const baselineGateIndex = coordinator.indexOf('Resolve and verify the immutable production baseline before pilot mutation');
const stagingPredecessorGateIndex = coordinator.indexOf('Attest cataloged Ponto Core staging predecessor before any candidate mutation');
const coordinatorMutationIndex = coordinator.indexOf('Put Ponto in maintenance before staging or live mutation');
if (
  rootGateIndex < 0
  || baselineGateIndex < 0
  || stagingPredecessorGateIndex < 0
  || coordinatorMutationIndex < 0
  || rootGateIndex >= coordinatorMutationIndex
  || baselineGateIndex >= coordinatorMutationIndex
  || stagingPredecessorGateIndex >= coordinatorMutationIndex
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
  if (
    !source.includes('repositorySecrets.has("PONTO_ROOT_ATTESTATION_KEY_SHARED")')
    || !source.includes('!environmentSecrets.has("PONTO_ROOT_ATTESTATION_KEY_SHARED")')
    || source.includes('!repositorySecrets.has("PONTO_ROOT_ATTESTATION_KEY_SHARED")')
  ) {
    fail(`${label} must require the shared attestation key only in the selected protected environment`);
  }
}
if (
  !coordinator.includes('!stagingSecrets.has("PONTO_ROOT_ATTESTATION_KEY_SHARED")')
  || !coordinator.includes('!productionSecrets.has("PONTO_ROOT_ATTESTATION_KEY_SHARED")')
  || !coordinator.includes('repositorySecrets.has("PONTO_PAGES_ROLLBACK_INTENT_HMAC_KEY")')
  || !coordinator.includes('!stagingSecrets.has("PONTO_PAGES_ROLLBACK_INTENT_HMAC_KEY")')
  || !coordinator.includes('!productionSecrets.has("PONTO_PAGES_ROLLBACK_INTENT_HMAC_KEY")')
) {
  fail('Ponto shared audit and Pages rollback-intent roots must be repository-absent and present in both protected target environments');
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
for (const [source, label] of [
  [pagesCustody, 'Pages custody'],
  [timekeepingPublisher, 'Timekeeping publisher'],
]) {
  if (
    !source.includes('nonce=([0-9a-f]{32})$')
    || !source.includes('run.run_attempt !== 1')
    || !source.includes('String(run.repository?.id || "") !== process.env.GITHUB_REPOSITORY_ID')
    || !source.includes('String(run.head_repository?.id || "") !== process.env.GITHUB_REPOSITORY_ID')
  ) {
    fail(`${label} must accept only the exact nonce-bound first-attempt root-custody predecessor from this repository`);
  }
}
const moduleSetStateStart = moduleAvailability.indexOf('  set-state:');
const moduleEmergencyReconciliationStart = moduleAvailability.indexOf('  emergency-reconciliation:');
const moduleSetState = moduleAvailability.slice(moduleSetStateStart, moduleEmergencyReconciliationStart);
const moduleEmergencyReconciliation = moduleAvailability.slice(moduleEmergencyReconciliationStart);
const liveOpenStep = coordinator.indexOf('      - name: Open the approved live cohort or activate production');
const liveOpenDispatch = coordinator.indexOf(
  'ponto-dispatch-workflow.mjs module-availability.yml',
  liveOpenStep,
);
const liveOpenArtifact = coordinator.indexOf(
  '--name "module-transition-timekeeping-production-$state-$GITHUB_RUN_ID"',
  liveOpenDispatch,
);
const canonicalSloStep = coordinator.indexOf(
  '      - name: Observe external authenticated production SLO',
  liveOpenArtifact,
);
const canonicalSloDispatch = coordinator.indexOf(
  'ponto-dispatch-workflow.mjs ponto-production-slo.yml',
  canonicalSloStep,
);
if (
  moduleSetStateStart < 0
  || moduleEmergencyReconciliationStart < 0
  || moduleSetStateStart >= moduleEmergencyReconciliationStart
  || !moduleSetState.includes('runs-on: ubuntu-latest')
  || !moduleSetState.includes('environment: ${{ inputs.target }}')
  || !moduleSetState.includes("PONTO_PILOT_COHORT_JSON: ${{ inputs.module == 'timekeeping' && inputs.state == 'canary'")
  || !moduleSetState.includes('CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}')
  || !moduleSetState.includes('ponto-cloudflare-resource-identity.mjs')
  || !moduleSetState.includes('ponto-module-propagation.mjs')
  || !moduleSetState.includes('payload.rolloutStage = process.env.TARGET')
  || !moduleSetState.includes('value.state === "active" && value.rolloutStage !== process.env.EXPECTED_TARGET')
  || !moduleSetState.includes('module-transition-${{ inputs.module }}-${{ inputs.target }}-${{ inputs.state }}-')
  || !moduleSetState.includes('${{ runner.temp }}/ponto-resource-identity.json')
  || !/Upload sanitized module transition and propagation evidence[\s\S]*?if: always\(\)[\s\S]*?actions\/upload-artifact@/.test(moduleSetState)
  || moduleSetState.includes('PONTO_PILOT_RUNNER_LABELS_JSON')
  || moduleAvailability.includes('self-hosted')
  || moduleAvailability.includes('PONTO_PILOT_RUNNER_LABELS_JSON')
) {
  fail('Timekeeping control-plane mutation, readback, propagation and artifact evidence must remain in the protected GitHub-hosted environment job');
}
if (
  liveOpenStep < 0
  || liveOpenDispatch < 0
  || liveOpenArtifact < 0
  || canonicalSloStep < 0
  || canonicalSloDispatch < 0
  || !(liveOpenStep < liveOpenDispatch
    && liveOpenDispatch < liveOpenArtifact
    && liveOpenArtifact < canonicalSloStep
    && canonicalSloStep < canonicalSloDispatch)
) {
  fail('Ponto live module opening must finish and export its exact transition artifact before the canonical external authenticated SLO workflow is dispatched');
}
const moduleConcurrencyStart = moduleAvailability.indexOf('concurrency:');
const modulePermissionsStart = moduleAvailability.indexOf('permissions:', moduleConcurrencyStart);
const moduleConcurrency = moduleAvailability.slice(moduleConcurrencyStart, modulePermissionsStart);
if (
  moduleConcurrencyStart < 0
  || modulePermissionsStart < 0
  || !moduleConcurrency.includes("group: ponto-surface-mutation")
  || !moduleConcurrency.includes("cancel-in-progress: false")
) {
  fail('Module control must use the non-cancelling global surface mutex');
}
if (
  moduleSetState.includes('group: ponto-emergency-latch-')
  || moduleEmergencyReconciliation.includes('group: ponto-emergency-latch-')
  || !/  recovery-latch:[\s\S]*?group: ponto-emergency-latch-\$\{\{ inputs\.stage == 'staging' && 'staging' \|\| 'production' \}\}[\s\S]*?cancel-in-progress: false/.test(coordinator)
  || !/  latch:[\s\S]*?group: ponto-emergency-latch-\$\{\{ needs\.context\.outputs\.target \}\}[\s\S]*?cancel-in-progress: false/.test(read('.github/workflows/ponto-release-watchdog.yml'))
  || !/  reset-mutate:[\s\S]*?group: ponto-emergency-latch-\$\{\{ inputs\.target \}\}[\s\S]*?cancel-in-progress: false/.test(emergencyLatchReset)
) {
  fail('Only brief automatic close and governed reset jobs may hold the target latch queue; long module transitions must never delay fail-close');
}
if (
  emergencyCloseOnly.includes('group: ponto-surface-mutation')
  || !/  close:[\s\S]*?group: ponto-emergency-latch-\$\{\{ inputs\.target \}\}[\s\S]*?cancel-in-progress: false/.test(emergencyCloseOnly)
  || !emergencyCloseOnly.includes("github.ref == 'refs/heads/main' && github.run_attempt == 1")
  || !emergencyCloseOnly.includes("format('ponto-emergency-{0}', inputs.target)")
  || !emergencyCloseOnly.includes('ponto-emergency-latch-write.mjs')
  || !emergencyCloseOnly.includes('ponto-emergency-maintenance-write.mjs')
  || !emergencyCloseOnly.includes('ponto-module-propagation.mjs')
  || emergencyCloseOnly.includes('CLOUDFLARE_API_TOKEN')
  || emergencyCloseOnly.includes('CF_ACCESS_CLIENT_ID')
  || emergencyCloseOnly.includes('CF_ACCESS_CLIENT_SECRET')
  || !emergencyCloseMaterialize.includes('group: ponto-surface-mutation')
  || !emergencyCloseMaterialize.includes('ponto-module-control-materialize.mjs')
  || !emergencyCloseMaterialize.includes('CLOUDFLARE_API_TOKEN')
  || !emergencyCloseMaterialize.includes('environment: ${{ inputs.target }}')
  || !emergencyCloseMaterialize.includes('github.run_attempt == 1')
  || !emergencyCloseMaterialize.includes('cancel-in-progress: false')
) {
  fail('Manual Ponto emergency close must serialize on the target latch queue through the close-only broker without waiting on the surface mutex or hydrating broad credentials');
}
for (const [source, label] of [
  [coordinator, 'ordinary recovery latch'],
  [read('.github/workflows/ponto-release-watchdog.yml'), 'watchdog latch'],
  [emergencyLatchReset, 'governed latch reset'],
  [emergencyClose, 'manual emergency close'],
]) {
  if (/group: ponto-emergency-latch-[\s\S]{0,400}?cancel-in-progress: true/.test(source)) {
    fail(`${label} must never let a later dispatch cancel an in-flight latch writer`);
  }
}
const emergencyLatchWriteIndex = moduleAvailability.indexOf('latched: true', moduleAvailability.indexOf('- name: Emergency fail-close before reconciliation'));
const emergencyLatchPutIndex = moduleAvailability.indexOf('kv key put "module-control:timekeeping:emergency-latch"', emergencyLatchWriteIndex);
const emergencyLatchReadbackIndex = moduleAvailability.indexOf('kv key get "module-control:timekeeping:emergency-latch"', emergencyLatchPutIndex);
const emergencyReconciliationIndex = moduleAvailability.indexOf('  emergency-reconciliation:');
if (
  emergencyLatchWriteIndex < 0
  || emergencyLatchPutIndex < 0
  || emergencyLatchReadbackIndex < 0
  || emergencyReconciliationIndex < 0
  || !(emergencyLatchWriteIndex < emergencyLatchPutIndex
    && emergencyLatchPutIndex < emergencyLatchReadbackIndex
    && emergencyLatchReadbackIndex < emergencyReconciliationIndex)
  || !moduleAvailability.includes('value?.latched !== true')
) {
  fail('Manual Ponto emergency stop must persist and read back the separate monotonic latch before coordinator reconciliation');
}
if (
  !moduleAvailability.includes('kv key get "module-control:timekeeping:emergency-latch"')
  || !moduleAvailability.includes('value?.latched !== false')
  || !moduleAvailability.includes('Ponto emergency latch is missing, unreadable, malformed, or active')
  || moduleAvailability.includes('clear_emergency_latch:')
) {
  fail('Timekeeping canary/active transitions must fail closed unless the separate emergency latch is explicitly and validly open');
}
const coordinatorLatchIndex = coordinator.indexOf('Refuse a latched Ponto emergency stop before issuing capabilities');
const coordinatorLeaseIssueIndex = coordinator.indexOf('Verify target-bound asymmetric child capability custody');
if (
  coordinatorLatchIndex < 0
  || coordinatorLeaseIssueIndex < 0
  || coordinatorLatchIndex >= coordinatorLeaseIssueIndex
  || !coordinator.includes('value?.latched !== false')
  || !coordinator.includes('value?.target !== process.env.PONTO_EXPECTED_LATCH_TARGET')
  || !coordinator.includes('PONTO_EXPECTED_LATCH_TARGET="$resource_target"')
  || !coordinator.includes('Ponto emergency latch is missing, unreadable, malformed, or active')
) {
  fail('The Ponto coordinator must fail closed on a missing, malformed, or active separate latch before issuing any child capability');
}
const emergencyJob = moduleAvailability.slice(emergencyReconciliationIndex);
if (
  !emergencyJob.includes('needs: set-state')
  || !/^  emergency-reconciliation:\r?\n(?:.*\r?\n)*?    permissions:\r?\n      actions: write\r?\n      checks: write\r?\n      contents: read/m.test(emergencyJob)
  || !emergencyJob.includes("if: ${{ always() && github.ref == 'refs/heads/main'")
) {
  fail('Ponto emergency reconciliation must always run from main with least-privilege actions/checks write');
}
for (const required of [
  'isBodylessResponseStatus(response.status)',
  'status=${status}&per_page=100&page=${page}',
  'non-terminal ${status} run inventory exceeds the governed discovery bound',
  'authorizeAndInvalidateCapability',
  '/commits/${releaseSha}/check-runs?filter=all',
  'transitionCapabilityDocument',
  'state: "invalidated"',
  'method: "PATCH"',
  '/actions/runs/${record.runId}/cancel',
  '/actions/runs/${record.runId}/force-cancel',
  'isCorrelatedChild(run, {',
  '"completed"',
  'isWithinCoordinatorWindow(run, coordinator.live)',
  'PONTO_ORCHESTRATOR_CAPABILITY_PUBLIC_KEYS_JSON',
  'for (const status of NON_TERMINAL)',
  '/actions/workflows/${specification.id}/runs?event=workflow_dispatch',
  'created=${encodeURIComponent(createdRange)}',
  'const activeCoordinator =',
  'const activeChild =',
  'passed: unresolved.length === 0',
]) {
  if (!emergencyStop.includes(required)) {
    fail(`Ponto emergency reconciliation is missing lease invalidation/cancellation evidence: ${required}`);
  }
}
if (
  emergencyStop.includes('for (const status of [...NON_TERMINAL, "completed"])')
  || emergencyStop.includes('/actions/runs?branch=main')
) {
  fail('Ponto emergency reconciliation must not use a main-branch history filter for child discovery');
}
for (const required of [
  '/actions/runs/${coordinatorRunId}',
  '/actions/workflows/${metadata.id}/runs?event=workflow_dispatch',
  'created=${encodeURIComponent(createdRange)}',
  'canonical-correlated-child-untrusted',
]) {
  if (!watchdogJournal.includes(required)) {
    fail(`Ponto watchdog journal discovery is not lifecycle/workflow bounded: ${required}`);
  }
}
if (watchdogJournal.includes('branch=main')) {
  fail('Ponto watchdog journal must not enumerate workflow-dispatch history by main branch');
}
if (
  emergencyStop.includes('/actions/artifacts/')
  || emergencyStop.includes('method: "DELETE"')
) {
  fail('Ponto emergency reconciliation must invalidate check-run capabilities without deleting artifacts');
}
const emergencyInvalidateIndex = emergencyStop.indexOf('await authorizeAndInvalidateCapability(record)');
const emergencyCoordinatorCancelIndex = emergencyStop.indexOf('await requestCancellation(record, { force: false });');
const emergencyChildCancelIndex = emergencyStop.indexOf('await requestCancellation(record);', emergencyInvalidateIndex);
if (
  emergencyInvalidateIndex < 0
  || emergencyChildCancelIndex < 0
  || emergencyInvalidateIndex >= emergencyChildCancelIndex
  || emergencyCoordinatorCancelIndex >= 0
) {
  fail('Ponto emergency reconciliation must invalidate each unused child check capability before cancellation and must not use the retired coordinator-only cancellation path');
}
const emergencyScriptIndex = emergencyJob.indexOf('node .github/scripts/ponto-emergency-stop.mjs');
const emergencyReassertIndex = emergencyJob.indexOf('- name: Reassert emergency fail-close after reconciliation');
const emergencyUploadIndex = emergencyJob.indexOf('- name: Upload emergency stop and final fail-close evidence');
const emergencyReassert = emergencyJob.slice(emergencyReassertIndex, emergencyUploadIndex);
if (
  emergencyScriptIndex < 0
  || emergencyReassertIndex < 0
  || emergencyUploadIndex < 0
  || emergencyScriptIndex >= emergencyReassertIndex
  || emergencyReassertIndex >= emergencyUploadIndex
  || !/if:\s*always\(\)/.test(emergencyReassert)
  || !emergencyReassert.includes('ponto-cloudflare-resource-identity.mjs')
  || !emergencyReassert.includes('kv key put "module-control:timekeeping:emergency-latch"')
  || !emergencyReassert.includes('kv key get "module-control:timekeeping:emergency-latch"')
  || !emergencyReassert.includes('kv key put "module-control:timekeeping"')
  || !emergencyReassert.includes('kv key get "module-control:timekeeping"')
  || !emergencyReassert.includes('latched: true')
  || !emergencyReassert.includes('PONTO_MODULE_EXPECTED_SOURCE=emergency-latch-active')
  || !emergencyReassert.includes('final emergency fail-close readback differs')
) {
  fail('Ponto emergency stop must always reassert and externally attest the separate persistent latch and maintenance control after reconciliation');
}
for (const required of [
  'group: ponto-surface-mutation',
  'Emergency workflow SHA is not reachable from current main',
  'ponto-emergency-close-$TARGET-$EMERGENCY_RUN_ID',
  'maintenance?.passed !== true',
  'Refuse latch reset while a target coordinator remains non-terminal',
  'node .github/scripts/ponto-assert-idle.mjs',
  'live emergency latch differs from the exact attested stop',
  'state: "maintenance"',
  'priorLatch?.latched !== true',
  'module-control:timekeeping:emergency-latch',
  'PONTO_MODULE_PROPAGATION_REPORT=',
  'ponto-emergency-latch-reset-${{ inputs.target }}-${{ github.run_id }}',
]) {
  if (!emergencyLatchReset.includes(required)) {
    fail(`Ponto emergency latch reset is missing governed fail-closed evidence: ${required}`);
  }
}
for (const required of [
  'ponto-recovery-evidence.mjs',
  'ponto-ordinary-recovery-reconciliation-${{ github.run_id }}',
  'ponto-ordinary-recovery-maintenance-${{ github.run_id }}',
]) {
  if (!coordinator.includes(required)) {
    fail(`Ordinary automatic rollback is missing normalized recovery custody: ${required}`);
  }
}
for (const required of [
  'ponto-child-reconciliation.json',
  'ponto-broker-fail-close.json',
  'emergencyLatchRef',
]) {
  if (!recoveryEvidence.includes(required)) {
    fail(`Recovery evidence normalizer is missing canonical output: ${required}`);
  }
}
const watchdogWorkflow = read('.github/workflows/ponto-release-watchdog.yml');
for (const required of [
  'ponto-recovery-evidence.mjs',
  'ponto-watchdog-reconciliation-${{ needs.context.outputs.coordinator_run_id }}-${{ github.run_id }}',
  'ponto-watchdog-close-${{ needs.context.outputs.coordinator_run_id }}-${{ github.run_id }}',
]) {
  if (!watchdogWorkflow.includes(required)) {
    fail(`Watchdog automatic rollback is missing normalized recovery custody: ${required}`);
  }
}
const rollbackPreconditionIndex = Math.max(
  automaticRollback.indexOf('const preMutationFailClose = readAndAttestBrokerFailClose();'),
  automaticRollback.indexOf('const preMutationFailClose = await readAndAttestBrokerFailClose();'),
);
const rollbackPermissionIndex = automaticRollback.indexOf('const rollbackPermitted =');
const rollbackWorkerMutationIndex = automaticRollback.indexOf('const rollback = spawnSync("npx"');
const rollbackPagesMutationIndex = automaticRollback.indexOf('const rolledBack = await rollbackPagesWithReconciliation');
const rollbackPostconditionIndex = Math.max(
  automaticRollback.indexOf('const postMutationFailClose = readAndAttestBrokerFailClose();'),
  automaticRollback.indexOf('const postMutationFailClose = await readAndAttestBrokerFailClose();'),
);
if (
  rollbackPreconditionIndex < 0
  || rollbackPermissionIndex < 0
  || rollbackWorkerMutationIndex < 0
  || rollbackPagesMutationIndex < 0
  || rollbackPostconditionIndex < 0
  || !(rollbackPreconditionIndex < rollbackPermissionIndex
    && rollbackPermissionIndex < rollbackWorkerMutationIndex
    && rollbackPermissionIndex < rollbackPagesMutationIndex
    && rollbackWorkerMutationIndex < rollbackPostconditionIndex
    && rollbackPagesMutationIndex < rollbackPostconditionIndex)
  || !automaticRollback.includes('&& preMutationFailClose.attestation.passed')
  || !automaticRollback.includes('PONTO_PAGES_ROLLBACK_INTENT_HMAC_KEY')
  || automaticRollback.includes('PONTO_ORCHESTRATOR_LEASE_HMAC_KEY')
  || !coordinator.includes('PONTO_PAGES_ROLLBACK_INTENT_HMAC_KEY: ${{ secrets.PONTO_PAGES_ROLLBACK_INTENT_HMAC_KEY }}')
  || !watchdogWorkflow.includes('PONTO_PAGES_ROLLBACK_INTENT_HMAC_KEY: ${{ secrets.PONTO_PAGES_ROLLBACK_INTENT_HMAC_KEY }}')
) {
  fail('Automatic rollback must attest the exact live broker fail-close before every mutation, re-read it afterward, and use dedicated environment-only Pages intent custody');
}
if (
  emergencyLatchReset.includes('cancel-in-progress: true')
  || !(
    emergencyLatchReset.includes("if: github.ref == 'refs/heads/main'")
    || (
      emergencyLatchReset.includes('Ponto latch reset must execute from main')
      && emergencyLatchReset.includes('needs: source')
    )
  )
  || !emergencyLatchReset.includes('ref: ${{ github.sha }}')
  || !emergencyLatchReset.includes('run?.status !== "completed"')
  || !emergencyLatchReset.includes('run?.conclusion !== "success"')
  || !emergencyLatchReset.includes('run?.run_attempt !== 1')
  || !emergencyLatchReset.includes('artifact?.expired === false')
  || !emergencyLatchReset.includes('priorLatch?.stopRunId !== process.env.EMERGENCY_RUN_ID')
) {
  fail('Ponto latch reset must serialize with emergency stop and consume only exact successful immutable evidence while staying closed');
}
if (
  (emergencyLatchReset.match(/ponto-assert-idle\.mjs/g) || []).length < 2
  || !emergencyIdleAssertion.includes('NON_TERMINAL_STATUSES')
  || !emergencyIdleAssertion.includes('status=${status}&per_page=100&page=${page}')
  || !emergencyIdleAssertion.includes('non-terminal ${status} coordinator inventory exceeds the governed discovery bound')
  || !emergencyIdleAssertion.includes('parseCoordinator(run, {')
) {
  fail('Ponto latch reset must exhaustively prove target coordinator idleness both before and immediately at mutation');
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
