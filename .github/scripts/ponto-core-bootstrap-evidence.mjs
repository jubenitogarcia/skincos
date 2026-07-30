import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID_PATTERN = /^[1-9][0-9]*$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const EXPECTED_WORKFLOW_PATH = '.github/workflows/ponto-core-baseline-publisher.yml';
const EXPECTED_CHANGED_FILES = Object.freeze([
  'api/src/router.js',
  'api/test/gateway.test.mjs',
  'api/workers/ponto.js',
  'api/wrangler.ponto.toml',
]);
const EXPECTED_TARGETS = Object.freeze({
  staging: Object.freeze({
    worker: 'skincos-ponto-core-staging',
    timekeepingService: 'skincos-timekeeping-staging',
  }),
  production: Object.freeze({
    worker: 'skincos-ponto-core',
    timekeepingService: 'skincos-timekeeping',
  }),
});
const DEFAULT_CATALOG_PATH = fileURLToPath(
  new URL('../../platform/deploy/operational-units.json', import.meta.url),
);

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function requireObject(value, name) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value), `${name} must be an object`);
  return value;
}

function requireExactKeys(value, expected, name) {
  requireObject(value, name);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  requireValue(
    JSON.stringify(actual) === JSON.stringify(wanted),
    `${name} keys must be exactly: ${wanted.join(', ')}`,
  );
}

function canonicalId(value, name) {
  const normalized = String(value ?? '');
  requireValue(ID_PATTERN.test(normalized), `${name} must be a positive decimal id`);
  return normalized;
}

function requireSha(value, name) {
  requireValue(SHA_PATTERN.test(String(value ?? '')), `${name} must be a full lowercase commit SHA`);
  return value;
}

function requireDigest(value, name) {
  requireValue(DIGEST_PATTERN.test(String(value ?? '')), `${name} must be a lowercase sha256 digest`);
  return value;
}

function requireUuid(value, name) {
  requireValue(UUID_PATTERN.test(String(value ?? '')), `${name} must be a UUID`);
  return value;
}

function requireExactArray(actual, expected, name) {
  requireValue(Array.isArray(actual), `${name} must be an array`);
  requireValue(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${name} does not match the immutable baseline`,
  );
}

function findCatalogUnit(catalog) {
  requireObject(catalog, 'catalog');
  requireValue(catalog.schemaVersion === 1, 'catalog schemaVersion must be 1');
  requireValue(Array.isArray(catalog.units), 'catalog.units must be an array');
  const matches = catalog.units.filter((unit) => unit?.id === 'ponto-core-baseline');
  requireValue(matches.length === 1, 'catalog must contain exactly one ponto-core-baseline unit');
  return matches[0];
}

function validateCatalog(catalog, target, repositoryOverride) {
  const expectedTarget = EXPECTED_TARGETS[target];
  requireValue(expectedTarget, 'target must be staging or production');

  const unit = findCatalogUnit(catalog);
  const promotion = requireObject(unit.promotion, 'ponto-core-baseline.promotion');
  requireValue(promotion.bootstrapOnly === true, 'ponto-core-baseline must remain bootstrap-only');
  requireValue(
    Number.isInteger(promotion.immutableSourcePr) && promotion.immutableSourcePr === 912,
    'ponto-core-baseline immutableSourcePr must be 912',
  );

  const bootstrap = requireObject(
    promotion.bootstrapEvidence,
    'ponto-core-baseline.promotion.bootstrapEvidence',
  );
  requireValue(
    bootstrap.state === 'published-and-attested',
    'bootstrap evidence state must be published-and-attested',
  );
  requireValue(
    REPOSITORY_PATTERN.test(String(bootstrap.repository ?? '')),
    'bootstrap repository is malformed',
  );
  const expectedRepository = repositoryOverride || bootstrap.repository;
  requireValue(
    REPOSITORY_PATTERN.test(String(expectedRepository ?? '')),
    'expected GitHub repository is malformed',
  );
  requireValue(
    bootstrap.repository === expectedRepository,
    'catalog repository differs from GITHUB_REPOSITORY',
  );
  requireSha(bootstrap.sourceSha, 'bootstrap sourceSha');
  canonicalId(bootstrap.workflowRunId, 'bootstrap workflowRunId');
  requireSha(bootstrap.workflowControlSha, 'bootstrap workflowControlSha');
  requireValue(
    bootstrap.workflowPath === EXPECTED_WORKFLOW_PATH,
    `bootstrap workflowPath must be ${EXPECTED_WORKFLOW_PATH}`,
  );
  requireValue(bootstrap.runAttempt === 1, 'bootstrap runAttempt must be 1');

  const artifacts = requireObject(bootstrap.artifacts, 'bootstrap artifacts');
  const validationArtifact = requireObject(artifacts.validation, 'bootstrap validation artifact');
  canonicalId(validationArtifact.id, 'bootstrap validation artifact id');
  requireValue(
    validationArtifact.name === `ponto-core-baseline-validation-${bootstrap.sourceSha}`,
    'bootstrap validation artifact name is not source-bound',
  );
  requireDigest(validationArtifact.digest, 'bootstrap validation artifact digest');

  const selectedArtifact = requireObject(artifacts[target], `bootstrap ${target} artifact`);
  canonicalId(selectedArtifact.id, `bootstrap ${target} artifact id`);
  requireValue(
    selectedArtifact.name === `ponto-core-baseline-${target}-${bootstrap.sourceSha}`,
    `bootstrap ${target} artifact name is not source-bound`,
  );
  requireDigest(selectedArtifact.digest, `bootstrap ${target} artifact digest`);
  requireValue(
    selectedArtifact.worker === expectedTarget.worker,
    `bootstrap ${target} worker does not match the private target`,
  );
  requireUuid(selectedArtifact.deploymentId, `bootstrap ${target} deploymentId`);
  requireUuid(selectedArtifact.versionId, `bootstrap ${target} versionId`);

  return { bootstrap, selectedArtifact, expectedRepository, expectedTarget };
}

function validateRun(run, bootstrap, expectedRepository) {
  requireObject(run, 'workflow run');
  const runId = canonicalId(run.id, 'workflow run id');
  requireValue(runId === String(bootstrap.workflowRunId), 'workflow run id differs from catalog');
  requireValue(
    run.path === `${bootstrap.workflowPath}@refs/heads/main`,
    'workflow run path must be pinned to the publisher on refs/heads/main',
  );
  requireValue(run.head_sha === bootstrap.workflowControlSha, 'workflow run head_sha differs');
  requireValue(run.head_branch === 'main', 'workflow run head_branch must be main');
  requireValue(run.event === 'workflow_dispatch', 'workflow run event must be workflow_dispatch');
  requireValue(run.status === 'completed', 'workflow run must be completed');
  requireValue(run.conclusion === 'success', 'workflow run conclusion must be success');
  requireValue(run.run_attempt === 1, 'workflow run attempt must be 1');
  requireValue(run.run_attempt === bootstrap.runAttempt, 'workflow run attempt differs from catalog');
  requireValue(
    run.repository?.full_name === expectedRepository,
    'workflow run repository differs from the approved repository',
  );
  requireValue(
    run.head_repository?.full_name === expectedRepository,
    'workflow run head repository differs from the approved repository',
  );
  return runId;
}

function validateArtifact(artifact, bootstrap, selectedArtifact, runId, now) {
  requireObject(artifact, 'artifact');
  const artifactId = canonicalId(artifact.id, 'artifact id');
  requireValue(artifactId === String(selectedArtifact.id), 'artifact id differs from catalog');
  requireValue(artifact.name === selectedArtifact.name, 'artifact name differs from catalog');
  requireDigest(artifact.digest, 'artifact digest');
  requireValue(artifact.digest === selectedArtifact.digest, 'artifact digest differs from catalog');
  requireValue(artifact.expired === false, 'artifact is marked expired');
  requireValue(
    typeof artifact.expires_at === 'string' && artifact.expires_at.length > 0,
    'artifact expires_at is missing',
  );
  const expiry = Date.parse(artifact.expires_at);
  requireValue(Number.isFinite(expiry), 'artifact expires_at is invalid');
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  requireValue(Number.isFinite(nowMs), 'verification time is invalid');
  requireValue(expiry > nowMs, 'artifact has expired');

  requireObject(artifact.workflow_run, 'artifact workflow_run');
  requireValue(
    canonicalId(artifact.workflow_run.id, 'artifact workflow_run id') === runId,
    'artifact workflow_run id differs',
  );
  requireValue(
    artifact.workflow_run.head_sha === bootstrap.workflowControlSha,
    'artifact workflow_run head_sha differs',
  );
  return artifactId;
}

function validateEvidence(evidence, target, bootstrap, selectedArtifact, expectedTarget) {
  requireObject(evidence, 'evidence');
  requireValue(evidence.schemaVersion === 1, 'evidence schemaVersion must be 1');
  requireValue(evidence.purpose === 'private-ponto-core-rollback-baseline', 'evidence purpose differs');
  requireValue(evidence.result === 'passed', 'evidence result must be passed');
  requireValue(evidence.outcome === 'created-and-attested', 'evidence outcome must be created-and-attested');
  requireValue(evidence.baselineSha === bootstrap.sourceSha, 'evidence baselineSha differs');
  requireValue(
    evidence.workflowControlSha === bootstrap.workflowControlSha,
    'evidence workflowControlSha differs',
  );
  requireValue(evidence.target === target, 'evidence target differs');
  requireValue(evidence.worker === selectedArtifact.worker, 'evidence worker differs from catalog');
  requireValue(evidence.worker === expectedTarget.worker, 'evidence worker differs from target');

  requireExactKeys(evidence.authorization, ['explicitConfirmation'], 'evidence authorization');
  requireValue(
    evidence.authorization.explicitConfirmation === true,
    'bootstrap explicit confirmation was not recorded',
  );
  requireExactKeys(
    evidence.mutation,
    ['attempted', 'performed', 'resourceDeletionAttempted'],
    'evidence mutation',
  );
  requireValue(evidence.mutation.attempted === true, 'bootstrap mutation was not attempted');
  requireValue(evidence.mutation.performed === true, 'bootstrap mutation was not performed');
  requireValue(
    evidence.mutation.resourceDeletionAttempted === false,
    'bootstrap attempted resource deletion',
  );
  requireExactKeys(
    evidence.secrets,
    ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'valuesEmitted'],
    'evidence secrets',
  );
  requireValue(
    evidence.secrets.CLOUDFLARE_API_TOKEN === true &&
      evidence.secrets.CLOUDFLARE_ACCOUNT_ID === true,
    'bootstrap secret presence was not attested',
  );
  requireValue(evidence.secrets.valuesEmitted === false, 'bootstrap evidence emitted secret values');

  const source = requireObject(evidence.source, 'evidence source');
  requireValue(source.baselineSha === bootstrap.sourceSha, 'evidence source baselineSha differs');
  requireValue(source.parentCount === 1, 'evidence source must be a single-parent squash commit');
  requireValue(
    typeof source.subject === 'string' && source.subject.endsWith(`(#${912})`),
    'evidence source is not the PR #912 squash commit',
  );
  requireExactArray(source.changedFiles, EXPECTED_CHANGED_FILES, 'evidence source changedFiles');
  requireExactKeys(
    source.privateSurface,
    ['previewUrls', 'routeDeclarations', 'routeOnly', 'workersDev'],
    'evidence source privateSurface',
  );
  requireValue(source.privateSurface.workersDev === false, 'source enables workers.dev');
  requireValue(source.privateSurface.previewUrls === false, 'source enables preview URLs');
  requireValue(source.privateSurface.routeDeclarations === 0, 'source declares public routes');
  requireValue(source.privateSurface.routeOnly === true, 'source is not route-only');

  requireValue(evidence.after?.exists === true, 'evidence lacks an existing attested Worker');
  const attestation = requireObject(evidence.after.attestation, 'evidence after.attestation');
  requireValue(attestation.worker === expectedTarget.worker, 'attested worker differs');
  requireValue(attestation.target === target, 'attested target differs');
  requireValue(
    attestation.activeDeploymentId === selectedArtifact.deploymentId,
    'attested deployment id differs from catalog',
  );
  requireValue(
    attestation.activeVersionId === selectedArtifact.versionId,
    'attested version id differs from catalog',
  );
  requireExactArray(
    attestation.activeVersions,
    [{ versionId: selectedArtifact.versionId, percentage: 100 }],
    'attested activeVersions',
  );
  requireValue(
    attestation.versionMessage === `ponto-core-baseline:${bootstrap.sourceSha}`,
    'attested version message differs',
  );
  requireValue(attestation.appVersion === bootstrap.sourceSha, 'attested APP_VERSION differs');
  requireValue(attestation.environment === target, 'attested ENVIRONMENT differs');
  requireValue(
    attestation.timekeepingService === expectedTarget.timekeepingService,
    'attested TIMEKEEPING binding differs',
  );
  requireValue(attestation.routeOnly === true, 'attested Worker is not route-only');

  requireExactKeys(
    attestation.exposure,
    [
      'customDomainCount',
      'previewUrlsEnabled',
      'workerRouteCount',
      'workersDevEnabled',
      'zonesInspected',
    ],
    'attested exposure',
  );
  requireValue(attestation.exposure.workerRouteCount === 0, 'attested Worker has public routes');
  requireValue(attestation.exposure.customDomainCount === 0, 'attested Worker has custom domains');
  requireValue(attestation.exposure.zonesInspected === 3, 'attestation did not inspect exactly three zones');
  requireValue(attestation.exposure.workersDevEnabled === false, 'attested Worker enables workers.dev');
  requireValue(
    attestation.exposure.previewUrlsEnabled === false,
    'attested Worker enables preview URLs',
  );
}

export function validatePontoCoreBootstrapEvidence({
  target,
  evidence,
  run,
  artifact,
  catalog,
  repository = process.env.GITHUB_REPOSITORY?.trim() || '',
  now = new Date(),
}) {
  const { bootstrap, selectedArtifact, expectedRepository, expectedTarget } = validateCatalog(
    catalog,
    target,
    repository,
  );
  const runId = validateRun(run, bootstrap, expectedRepository);
  const artifactId = validateArtifact(artifact, bootstrap, selectedArtifact, runId, now);
  validateEvidence(evidence, target, bootstrap, selectedArtifact, expectedTarget);

  return {
    bootstrap_workflow_run_id: runId,
    bootstrap_artifact_id: artifactId,
    bootstrap_artifact_digest: selectedArtifact.digest,
    bootstrap_source_sha: bootstrap.sourceSha,
    bootstrap_deployment_id: selectedArtifact.deploymentId,
    bootstrap_version_id: selectedArtifact.versionId,
    bootstrap_worker: selectedArtifact.worker,
  };
}

function readJson(filename, label) {
  let raw;
  try {
    raw = fs.readFileSync(filename, 'utf8');
  } catch (error) {
    throw new Error(`${label} could not be read: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function writeGitHubOutput(outputs, filename) {
  if (!filename) return;
  const lines = Object.entries(outputs).map(([name, value]) => `${name}=${value}`);
  fs.appendFileSync(filename, `${lines.join('\n')}\n`, 'utf8');
}

export function verifyPontoCoreBootstrapEvidenceFiles({
  target,
  evidencePath,
  runPath,
  artifactPath,
  catalogPath = DEFAULT_CATALOG_PATH,
  repository = process.env.GITHUB_REPOSITORY?.trim() || '',
  now = new Date(),
  outputPath = process.env.GITHUB_OUTPUT,
}) {
  const outputs = validatePontoCoreBootstrapEvidence({
    target,
    evidence: readJson(path.resolve(evidencePath), 'evidence JSON'),
    run: readJson(path.resolve(runPath), 'workflow run JSON'),
    artifact: readJson(path.resolve(artifactPath), 'artifact JSON'),
    catalog: readJson(path.resolve(catalogPath), 'catalog JSON'),
    repository,
    now,
  });
  writeGitHubOutput(outputs, outputPath);
  return outputs;
}

function usage() {
  return (
    'usage: node .github/scripts/ponto-core-bootstrap-evidence.mjs ' +
    'verify <staging|production> <evidence-json> <run-json> <artifact-json> [catalog-path]'
  );
}

function main() {
  const [command, target, evidencePath, runPath, artifactPath, catalogPath] = process.argv.slice(2);
  requireValue(command === 'verify', usage());
  requireValue(
    target && evidencePath && runPath && artifactPath && process.argv.slice(2).length <= 6,
    usage(),
  );
  const outputs = verifyPontoCoreBootstrapEvidenceFiles({
    target,
    evidencePath,
    runPath,
    artifactPath,
    catalogPath,
  });
  process.stdout.write(
    `${JSON.stringify({
      result: 'verified',
      target,
      workflowRunId: outputs.bootstrap_workflow_run_id,
      artifactId: outputs.bootstrap_artifact_id,
      sourceSha: outputs.bootstrap_source_sha,
      worker: outputs.bootstrap_worker,
    })}\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `Ponto Core bootstrap evidence verification failed: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    process.exitCode = 1;
  }
}
