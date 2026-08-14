import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import { remoteSnapshot } from './ponto-core-baseline-publisher.mjs';
import { validatePontoCoreBootstrapLive } from './ponto-core-bootstrap-precondition.mjs';

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/i;
const ID_PATTERN = /^[1-9][0-9]*$/;
const REPOSITORY = 'jubenitogarcia/skincos';
const WORKER = 'skincos-ponto-core-staging';
const RELEASE_WORKFLOW = '.github/workflows/ponto-progressive-release.yml';
const DEFAULT_CATALOG = path.resolve('platform/deploy/operational-units.json');
const EVIDENCE_DERIVED_STAGING_INCURBENT = 'evidence-derived-staging-incumbent';
const RECENT_STAGING_RUN_LIMIT = 25;
// The GitHub workflow-runs payload can exceed spawnSync's 1 MiB default in
// an active repository. Keep a bounded allowance so a valid predecessor is
// not discarded before its source-bound evidence can be verified.
const GITHUB_HISTORY_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function jsonFile(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
    maxBuffer: options.maxBuffer ?? GITHUB_HISTORY_MAX_BUFFER_BYTES,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout]
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .join('\n');
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return String(result.stdout || '').trim();
}

function ghJson(pathname) {
  return JSON.parse(run('gh', ['api', pathname]));
}

function repositoryFromEnv() {
  const repository = String(process.env.GITHUB_REPOSITORY || REPOSITORY).trim();
  requireValue(repository === REPOSITORY, 'staging Ponto Core predecessor repository is not canonical');
  return repository;
}

function catalogUnit(catalog) {
  const unit = catalog?.units?.find(entry => entry?.id === 'ponto-core-baseline');
  requireValue(unit, 'ponto-core-baseline catalog unit is missing');
  requireValue(unit.promotion?.bootstrapOnly === true, 'ponto-core-baseline must remain bootstrap-only');
  return unit;
}

export function validateStagingIncumbentCatalog({ catalog, repository = REPOSITORY }) {
  const incumbent = catalogUnit(catalog).promotion?.stagingIncumbent;
  return validateStagingIncumbent({ incumbent, repository, label: 'staging Ponto Core incumbent' });
}

function validateStagingIncumbent({ incumbent, repository, label }) {
  requireValue(incumbent?.state === 'published-and-attested', `${label} is not attested`);
  requireValue(incumbent.repository === repository, `${label} repository differs`);
  requireValue(SHA_PATTERN.test(String(incumbent.sourceSha || '')), `${label} source SHA is invalid`);
  requireValue(ID_PATTERN.test(String(incumbent.workflowRunId || '')), `${label} workflow run is invalid`);
  requireValue(incumbent.workflowPath === RELEASE_WORKFLOW, `${label} workflow path is invalid`);
  requireValue(incumbent.runAttempt === 1, `${label} workflow run attempt must be 1`);
  requireValue(incumbent.decision === 'pass', `${label} decision is not pass`);

  const artifact = incumbent.releaseEvidenceArtifact;
  requireValue(ID_PATTERN.test(String(artifact?.id || '')), `${label} artifact ID is invalid`);
  requireValue(
    artifact.name === `ponto-release-evidence-staging-${incumbent.sourceSha}`,
    `${label} artifact name is not source-bound`,
  );
  requireValue(DIGEST_PATTERN.test(String(artifact.digest || '')), `${label} artifact digest is invalid`);

  const surface = incumbent.surface;
  requireValue(surface?.worker === WORKER, `${label} Worker differs`);
  requireValue(UUID_PATTERN.test(String(surface?.deploymentId || '')), `${label} deployment ID is invalid`);
  requireValue(UUID_PATTERN.test(String(surface?.versionId || '')), `${label} version ID is invalid`);

  return {
    ...incumbent,
    releaseEvidenceArtifact: { ...artifact },
    surface: { ...surface },
  };
}

export function validateStagingCoreIncumbentLive({ live, expected }) {
  requireValue(live?.exists === true, 'cataloged staging Ponto Core incumbent is absent');
  const attestation = live.attestation;
  requireValue(attestation?.worker === WORKER, 'live staging Ponto Core Worker differs');
  requireValue(attestation?.target === 'staging', 'live staging Ponto Core target differs');
  requireValue(attestation.activeVersionId === expected.surface.versionId, 'live staging Ponto Core version differs from the cataloged incumbent');
  requireValue(
    Array.isArray(attestation.activeVersions)
      && attestation.activeVersions.length === 1
      && attestation.activeVersions[0]?.versionId === expected.surface.versionId
      && attestation.activeVersions[0]?.percentage === 100,
    'live staging Ponto Core incumbent must be the only version at 100%',
  );
  requireValue(attestation.versionMessage === `ponto:coreApi:${expected.sourceSha}`, 'live staging Ponto Core release annotation differs');
  requireValue(attestation.appVersion === expected.sourceSha, 'live staging Ponto Core APP_VERSION differs');
  requireValue(
    attestation.exposure?.workerRouteCount === 0
      && attestation.exposure?.customDomainCount === 0
      && attestation.exposure?.workersDevEnabled === false
      && attestation.exposure?.previewUrlsEnabled === false,
    'live staging Ponto Core incumbent is publicly exposed',
  );

  return {
    deploymentId: attestation.activeDeploymentId,
    catalogDeploymentId: expected.surface.deploymentId,
    deploymentDrifted: attestation.activeDeploymentId !== expected.surface.deploymentId,
    versionId: attestation.activeVersionId,
    liveAttestation: attestation,
  };
}

export function validateStagingHistoricalBootstrapLive({ live, expected }) {
  const result = validatePontoCoreBootstrapLive({
    live,
    expectedDeployment: expected.surface.deploymentId,
    expectedVersion: expected.surface.versionId,
    target: 'staging',
  });
  return {
    ...result,
    liveAttestation: live.attestation,
  };
}

function validateRun(run, expected, repository) {
  const workflowSha = String(expected.workflowSha || expected.sourceSha || '').trim().toLowerCase();
  requireValue(String(run?.id || '') === String(expected.workflowRunId), 'staging incumbent workflow run ID differs');
  requireValue(run.path === RELEASE_WORKFLOW, 'staging incumbent workflow path differs');
  requireValue(SHA_PATTERN.test(workflowSha), 'staging incumbent workflow SHA is invalid');
  requireValue(String(run.head_sha || '').trim().toLowerCase() === workflowSha, 'staging incumbent workflow SHA differs');
  requireValue(run.head_branch === 'main', 'staging incumbent workflow branch differs');
  requireValue(run.event === 'workflow_dispatch', 'staging incumbent workflow event differs');
  requireValue(run.status === 'completed' && run.conclusion === 'success', 'staging incumbent workflow did not succeed');
  requireValue(run.run_attempt === expected.runAttempt, 'staging incumbent workflow attempt differs');
  requireValue(run.repository?.full_name === repository, 'staging incumbent workflow repository differs');
  requireValue(run.head_repository?.full_name === repository, 'staging incumbent head repository differs');
}

function validateArtifact(artifact, expected, repository) {
  const selected = expected.releaseEvidenceArtifact;
  const workflowSha = String(expected.workflowSha || expected.sourceSha || '').trim().toLowerCase();
  requireValue(String(artifact?.id || '') === String(selected.id), 'staging incumbent artifact ID differs');
  requireValue(artifact.name === selected.name, 'staging incumbent artifact name differs');
  requireValue(artifact.digest === selected.digest, 'staging incumbent artifact digest differs');
  requireValue(artifact.expired === false, 'staging incumbent artifact is expired');
  requireValue(artifact.workflow_run?.id === Number(expected.workflowRunId), 'staging incumbent artifact workflow run differs');
  requireValue(String(artifact.workflow_run?.head_sha || '').trim().toLowerCase() === workflowSha, 'staging incumbent artifact SHA differs');
  requireValue(artifact.workflow_run?.head_branch === 'main', 'staging incumbent artifact branch differs');
}

function stagingRunTitle(sourceSha, workflowRunId) {
  return `Ponto staging ${sourceSha} orchestrator=${workflowRunId}`;
}

function stagingRunIdentity(run) {
  const match = /^Ponto staging ([0-9a-f]{40}) orchestrator=([1-9][0-9]*)$/i.exec(String(run?.display_title || '').trim());
  if (!match) return null;
  return {
    sourceSha: match[1].toLowerCase(),
    workflowRunId: match[2],
  };
}

export function validateEvidenceDerivedStagingIncumbent({
  run,
  artifact,
  evidence,
  repository = REPOSITORY,
  currentRunId = '',
}) {
  const workflowRunId = String(run?.id || '');
  const workflowSha = String(run?.head_sha || '').trim().toLowerCase();
  const title = stagingRunIdentity(run);
  requireValue(ID_PATTERN.test(workflowRunId), 'evidence-derived staging Ponto Core workflow run is invalid');
  requireValue(SHA_PATTERN.test(workflowSha), 'evidence-derived staging Ponto Core workflow SHA is invalid');
  requireValue(
    title?.workflowRunId === workflowRunId,
    'evidence-derived staging Ponto Core workflow title differs',
  );
  const sourceSha = title.sourceSha;
  requireValue(
    !currentRunId || workflowRunId !== String(currentRunId),
    'current Ponto coordinator cannot attest itself as a staging predecessor',
  );

  const incumbent = validateStagingIncumbent({
    incumbent: {
      state: 'published-and-attested',
      repository,
      sourceSha,
      workflowSha,
      workflowRunId,
      workflowPath: RELEASE_WORKFLOW,
      runAttempt: 1,
      decision: 'pass',
      releaseEvidenceArtifact: {
        id: String(artifact?.id || ''),
        name: artifact?.name,
        digest: artifact?.digest,
      },
      surface: evidenceDerivedSurface({ evidence, workflowRunId, sourceSha }),
    },
    repository,
    label: 'evidence-derived staging Ponto Core incumbent',
  });

  validateRun(run, incumbent, repository);
  validateArtifact(artifact, incumbent, repository);
  return incumbent;
}

function sourceIsReachableFromMain({ repository, sourceSha, ghApi = ghJson }) {
  const comparison = ghApi(`repos/${repository}/compare/${sourceSha}...main`);
  requireValue(
    comparison?.status === 'ahead' || comparison?.status === 'identical',
    'evidence-derived staging Ponto Core source SHA is not reachable from main',
  );
}

function evidenceDerivedSurface({ evidence, workflowRunId, sourceSha }) {
  const core = evidence?.surfaces?.coreApi;
  requireValue(evidence?.decision === 'pass', 'evidence-derived staging Ponto Core release evidence decision is not pass');
  requireValue(String(evidence?.runId || '') === workflowRunId, 'evidence-derived staging Ponto Core evidence run differs');
  requireValue(core?.sourceSha === sourceSha && core.stage === 'staging', 'evidence-derived staging Ponto Core evidence source differs');
  requireValue(UUID_PATTERN.test(String(core?.deploymentId || '')), 'evidence-derived staging Ponto Core evidence deployment is invalid');
  requireValue(UUID_PATTERN.test(String(core?.candidateVersionId || '')), 'evidence-derived staging Ponto Core evidence version is invalid');
  requireValue(core.candidatePercent === 100 && core.incumbentPercent === 0, 'evidence-derived staging Ponto Core evidence traffic differs');
  requireValue(core.candidateTag === `ponto:coreApi:${sourceSha}`, 'evidence-derived staging Ponto Core evidence tag differs');
  return {
    worker: WORKER,
    deploymentId: core.deploymentId,
    versionId: core.candidateVersionId,
  };
}

async function readReleaseEvidenceArtifact({ repository, workflowRunId, artifactName }) {
  const root = await fsTempDirectory('ponto-staging-evidence-derived');
  try {
    run('gh', [
      'run', 'download', workflowRunId,
      '--repo', repository,
      '--name', artifactName,
      '--dir', root,
    ]);
    const evidencePath = findFile(root, 'ponto-release-evidence.json');
    requireValue(evidencePath, 'evidence-derived staging Ponto Core release evidence file is missing');
    return jsonFile(evidencePath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function discoverEvidenceDerivedStagingIncumbents({
  repository,
  currentRunId = String(process.env.GITHUB_RUN_ID || '').trim(),
  ghApi = ghJson,
  readEvidence = readReleaseEvidenceArtifact,
}) {
  const payload = ghApi(`repos/${repository}/actions/workflows/ponto-progressive-release.yml/runs?per_page=100&event=workflow_dispatch&branch=main`);
  const candidates = [];
  const failures = [];

  for (const run of Array.isArray(payload?.workflow_runs) ? payload.workflow_runs : []) {
    if (candidates.length >= RECENT_STAGING_RUN_LIMIT) break;
    const workflowRunId = String(run?.id || '');
    const workflowSha = String(run?.head_sha || '').trim().toLowerCase();
    const title = stagingRunIdentity(run);
    try {
      if (run?.status !== 'completed' || run?.conclusion !== 'success') continue;
      if (!title || title.workflowRunId !== workflowRunId) continue;
      if (currentRunId && workflowRunId === currentRunId) continue;
      requireValue(SHA_PATTERN.test(workflowSha), 'evidence-derived staging Ponto Core workflow SHA is invalid');
      sourceIsReachableFromMain({ repository, sourceSha: title.sourceSha, ghApi });
      sourceIsReachableFromMain({ repository, sourceSha: workflowSha, ghApi });
      const artifactsPayload = ghApi(`repos/${repository}/actions/runs/${workflowRunId}/artifacts?per_page=100`);
      const artifactName = `ponto-release-evidence-staging-${title.sourceSha}`;
      const matches = (Array.isArray(artifactsPayload?.artifacts) ? artifactsPayload.artifacts : [])
        .filter(artifact => artifact?.name === artifactName);
      requireValue(matches.length === 1, 'evidence-derived staging Ponto Core artifact is absent or ambiguous');

      const artifact = matches[0];
      const evidence = await readEvidence({
        repository,
        workflowRunId,
        artifactName,
      });
      const expected = validateEvidenceDerivedStagingIncumbent({
        run,
        artifact,
        evidence,
        repository,
        currentRunId,
      });
      candidates.push(expected);
    } catch (error) {
      failures.push(`${workflowRunId || 'unknown'}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { candidates, failures };
}

function findFile(root, name) {
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const candidate = path.join(root, entry.name);
    if (entry.isFile() && entry.name === name) return candidate;
    if (entry.isDirectory()) {
      const nested = findFile(candidate, name);
      if (nested) return nested;
    }
  }
  return null;
}

async function downloadArtifact({ repository, expected, prefix }) {
  const root = await fsTempDirectory(prefix);
  try {
    const runMetadata = ghJson(`repos/${repository}/actions/runs/${expected.workflowRunId}`);
    const artifact = ghJson(`repos/${repository}/actions/artifacts/${expected.releaseEvidenceArtifact.id}`);
    validateRun(runMetadata, expected, repository);
    validateArtifact(artifact, expected, repository);
    run('gh', [
      'run', 'download', String(expected.workflowRunId),
      '--repo', repository,
      '--name', expected.releaseEvidenceArtifact.name,
      '--dir', root,
    ]);
    return { root, run: runMetadata, artifact };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

async function fsTempDirectory(prefix) {
  const root = path.join(os.tmpdir(), `${prefix}-${process.pid}-${Date.now()}`);
  await mkdir(root, { recursive: true });
  return root;
}

async function verifyIncumbentEvidence({ repository, expected }) {
  const downloaded = await downloadArtifact({ repository, expected, prefix: 'ponto-staging-incumbent' });
  try {
    const evidencePath = findFile(downloaded.root, 'ponto-release-evidence.json');
    requireValue(evidencePath, 'staging incumbent release evidence file is missing');
    run('node', [
      '.github/scripts/ponto-release-evidence.mjs', 'verify', evidencePath,
    ], {
      env: {
        ...process.env,
        PONTO_EXPECTED_STAGE: 'staging',
        PONTO_EXPECTED_SHA: expected.sourceSha,
        PONTO_EXPECTED_REPOSITORY: repository,
      },
    });
    const evidence = jsonFile(evidencePath);
    const core = evidence.surfaces?.coreApi;
    requireValue(evidence.decision === 'pass', 'staging incumbent release evidence decision is not pass');
    requireValue(core?.sourceSha === expected.sourceSha && core.stage === 'staging', 'staging incumbent Core evidence source differs');
    requireValue(core.candidateVersionId === expected.surface.versionId, 'staging incumbent Core evidence version differs');
    requireValue(core.candidatePercent === 100 && core.incumbentPercent === 0, 'staging incumbent Core evidence traffic differs');
    requireValue(core.candidateTag === `ponto:coreApi:${expected.sourceSha}`, 'staging incumbent Core evidence tag differs');
    return {
      kind: 'ponto-release-evidence',
      workflowRunId: expected.workflowRunId,
      artifactId: expected.releaseEvidenceArtifact.id,
      artifactName: expected.releaseEvidenceArtifact.name,
      artifactDigest: expected.releaseEvidenceArtifact.digest,
      sourceSha: expected.sourceSha,
      evidenceRunId: evidence.runId,
      evidenceDigest: createHash('sha256').update(readFileSync(evidencePath)).digest('hex'),
    };
  } finally {
    await rm(downloaded.root, { recursive: true, force: true });
  }
}

async function verifyBootstrapEvidence({ repository, catalogPath }) {
  const catalog = jsonFile(catalogPath);
  const bootstrap = catalogUnit(catalog).promotion.bootstrapEvidence;
  const selected = bootstrap.artifacts.staging;
  const root = await fsTempDirectory('ponto-staging-bootstrap');
  const runPath = path.join(root, 'run.json');
  const artifactPath = path.join(root, 'artifact.json');
  try {
    const runMetadata = ghJson(`repos/${repository}/actions/runs/${bootstrap.workflowRunId}`);
    const artifactMetadata = ghJson(`repos/${repository}/actions/artifacts/${selected.id}`);
    await writeFile(runPath, `${JSON.stringify(runMetadata)}\n`, { mode: 0o600 });
    await writeFile(artifactPath, `${JSON.stringify(artifactMetadata)}\n`, { mode: 0o600 });
    run('gh', [
      'run', 'download', String(bootstrap.workflowRunId),
      '--repo', repository,
      '--name', selected.name,
      '--dir', root,
    ]);
    const evidencePath = findFile(root, 'evidence.json');
    requireValue(evidencePath, 'historical Ponto Core bootstrap evidence file is missing');
    run('node', [
      '.github/scripts/ponto-core-bootstrap-evidence.mjs',
      'verify',
      'staging',
      evidencePath,
      runPath,
      artifactPath,
      catalogPath,
    ], {
      env: { ...process.env, GITHUB_REPOSITORY: repository },
    });
    return {
      kind: 'ponto-core-baseline-evidence',
      workflowRunId: String(bootstrap.workflowRunId),
      artifactId: String(selected.id),
      artifactName: selected.name,
      artifactDigest: selected.digest,
      sourceSha: bootstrap.sourceSha,
      evidenceDigest: createHash('sha256').update(readFileSync(evidencePath)).digest('hex'),
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function resolveStagingCorePrecondition({
  catalog,
  accountId,
  apiToken,
  repository = REPOSITORY,
  catalogPath = DEFAULT_CATALOG,
  fetchImpl = fetch,
  verifyEvidence = true,
  evidenceDerivedIncumbents,
}) {
  const unit = catalogUnit(catalog);
  const incumbent = validateStagingIncumbentCatalog({ catalog, repository });
  const bootstrap = unit.promotion?.bootstrapEvidence;
  requireValue(bootstrap?.repository === repository, 'historical Ponto Core bootstrap repository differs');
  const bootstrapArtifact = bootstrap?.artifacts?.staging;
  requireValue(SHA_PATTERN.test(String(bootstrap?.sourceSha || '')), 'historical Ponto Core bootstrap source SHA is invalid');
  requireValue(UUID_PATTERN.test(String(bootstrapArtifact?.versionId || '')), 'historical Ponto Core bootstrap version ID is invalid');
  requireValue(ID_PATTERN.test(String(bootstrap?.workflowRunId || '')), 'historical Ponto Core bootstrap workflow run is invalid');

  const attempts = [];
  let evidenceDerived = Array.isArray(evidenceDerivedIncumbents) ? evidenceDerivedIncumbents : [];
  if (!Array.isArray(evidenceDerivedIncumbents) && verifyEvidence) {
    try {
      const discovered = await discoverEvidenceDerivedStagingIncumbents({ repository });
      evidenceDerived = discovered.candidates;
      attempts.push(...discovered.failures.map(message => `evidence-derived-staging-incumbent discovery: ${message}`));
    } catch (error) {
      attempts.push(`evidence-derived-staging-incumbent discovery: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const predecessors = [
    ...evidenceDerived.map(expected => ({
      mode: EVIDENCE_DERIVED_STAGING_INCURBENT,
      expected,
      message: `ponto:coreApi:${expected.sourceSha}`,
      artifactVerifier: verifyEvidence ? () => verifyIncumbentEvidence({ repository, expected }) : null,
    })),
    {
      mode: 'staging-incumbent',
      expected: incumbent,
      message: `ponto:coreApi:${incumbent.sourceSha}`,
      artifactVerifier: verifyEvidence ? () => verifyIncumbentEvidence({ repository, expected: incumbent }) : null,
    },
    {
      mode: 'historical-bootstrap',
      expected: {
        sourceSha: bootstrap.sourceSha,
        workflowRunId: String(bootstrap.workflowRunId),
        releaseEvidenceArtifact: {
          id: String(bootstrapArtifact.id),
          name: bootstrapArtifact.name,
          digest: bootstrapArtifact.digest,
        },
        surface: {
          worker: WORKER,
          deploymentId: bootstrapArtifact.deploymentId,
          versionId: bootstrapArtifact.versionId,
        },
      },
      message: `ponto-core-baseline:${bootstrap.sourceSha}`,
      artifactVerifier: verifyEvidence ? () => verifyBootstrapEvidence({ repository, catalogPath }) : null,
    },
  ];

  for (const predecessor of predecessors) {
    try {
      const evidence = predecessor.artifactVerifier ? await predecessor.artifactVerifier() : null;
      const live = await remoteSnapshot({
        accountId,
        apiToken,
        baselineSha: predecessor.expected.sourceSha,
        expectedVersionMessage: predecessor.message,
        expectedAppVersion: predecessor.expected.sourceSha,
        target: 'staging',
        fetchImpl,
      });
      const liveProof = predecessor.mode === 'staging-incumbent'
        ? validateStagingCoreIncumbentLive({ live, expected: predecessor.expected })
        : validateStagingHistoricalBootstrapLive({ live, expected: predecessor.expected });
      return {
        schemaVersion: 1,
        target: 'staging',
        predecessorMode: predecessor.mode,
        workflowRunId: predecessor.expected.workflowRunId,
        artifactId: predecessor.expected.releaseEvidenceArtifact.id,
        artifactDigest: predecessor.expected.releaseEvidenceArtifact.digest,
        sourceSha: predecessor.expected.sourceSha,
        deploymentId: liveProof.deploymentId,
        catalogDeploymentId: liveProof.catalogDeploymentId,
        deploymentDrifted: liveProof.deploymentDrifted,
        versionId: liveProof.versionId,
        catalogVersionId: predecessor.expected.surface.versionId,
        worker: WORKER,
        liveAttested: true,
        liveAttestation: liveProof.liveAttestation,
        releaseEvidence: evidence,
        credentialsIncluded: false,
        piiIncluded: false,
      };
    } catch (error) {
      attempts.push(`${predecessor.mode}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`No governed staging Ponto Core predecessor is live. ${attempts.join(' | ')}`);
}

async function main() {
  const [command, outputPath] = process.argv.slice(2);
  requireValue(command === 'assert' && outputPath, 'usage: node .github/scripts/ponto-core-staging-precondition.mjs assert <output-path>');
  const catalog = JSON.parse(await readFile(DEFAULT_CATALOG, 'utf8'));
  const proof = await resolveStagingCorePrecondition({
    catalog,
    accountId: String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim(),
    apiToken: String(process.env.CLOUDFLARE_API_TOKEN || '').trim(),
    repository: repositoryFromEnv(),
  });
  await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await writeFile(path.resolve(outputPath), `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ result: 'verified', mode: proof.predecessorMode, sourceSha: proof.sourceSha, versionId: proof.versionId })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
