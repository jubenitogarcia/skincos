import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validatePontoCoreBootstrapEvidence } from './ponto-core-bootstrap-evidence.mjs';

const script = path.resolve(import.meta.dirname, 'ponto-core-bootstrap-evidence.mjs');
const repository = 'jubenitogarcia/skincos';
const sourceSha = '0f3480dce1a170ac0f862fa392a95456af292a88';
const controlSha = 'e50385144408c96fbcf919bbe1f3fdc7da4b9e1d';
const runId = '30512105626';
const validationDigest = `sha256:${'a'.repeat(64)}`;
const targets = {
  staging: {
    artifactId: '8747521765',
    digest: `sha256:${'b'.repeat(64)}`,
    worker: 'skincos-ponto-core-staging',
    deploymentId: 'd88aa85e-a90b-4fd0-b03b-14bf4c6fc248',
    versionId: '0ee7a2fe-deff-4f37-bcda-c35ad54b68f3',
    timekeepingService: 'skincos-timekeeping-staging',
  },
  production: {
    artifactId: '8747532031',
    digest: `sha256:${'c'.repeat(64)}`,
    worker: 'skincos-ponto-core',
    deploymentId: '96aba9e3-fb02-48b4-bc38-ef6a7187328a',
    versionId: '487f3c03-0159-4914-8d79-470fd1ef209d',
    timekeepingService: 'skincos-timekeeping',
  },
};

function fixture(target = 'staging') {
  const selected = targets[target];
  const catalog = {
    schemaVersion: 1,
    units: [
      {
        id: 'ponto-core-baseline',
        promotion: {
          bootstrapOnly: true,
          immutableSourcePr: 912,
          bootstrapEvidence: {
            state: 'published-and-attested',
            repository,
            sourceSha,
            workflowRunId: runId,
            workflowControlSha: controlSha,
            workflowPath: '.github/workflows/ponto-core-baseline-publisher.yml',
            runAttempt: 1,
            artifacts: {
              validation: {
                id: '8747502455',
                name: `ponto-core-baseline-validation-${sourceSha}`,
                digest: validationDigest,
              },
              staging: {
                id: targets.staging.artifactId,
                name: `ponto-core-baseline-staging-${sourceSha}`,
                digest: targets.staging.digest,
                worker: targets.staging.worker,
                deploymentId: targets.staging.deploymentId,
                versionId: targets.staging.versionId,
              },
              production: {
                id: targets.production.artifactId,
                name: `ponto-core-baseline-production-${sourceSha}`,
                digest: targets.production.digest,
                worker: targets.production.worker,
                deploymentId: targets.production.deploymentId,
                versionId: targets.production.versionId,
              },
            },
          },
        },
      },
    ],
  };
  const run = {
    id: Number(runId),
    path: '.github/workflows/ponto-core-baseline-publisher.yml',
    head_sha: controlSha,
    head_branch: 'main',
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'success',
    run_attempt: 1,
    repository: { full_name: repository },
    head_repository: { full_name: repository },
  };
  const artifact = {
    id: Number(selected.artifactId),
    name: `ponto-core-baseline-${target}-${sourceSha}`,
    digest: selected.digest,
    expired: false,
    expires_at: '2099-01-01T00:00:00Z',
    workflow_run: {
      id: Number(runId),
      head_sha: controlSha,
      head_branch: 'main',
    },
  };
  const evidence = {
    schemaVersion: 1,
    result: 'passed',
    purpose: 'private-ponto-core-rollback-baseline',
    outcome: 'created-and-attested',
    baselineSha: sourceSha,
    workflowControlSha: controlSha,
    target,
    worker: selected.worker,
    authorization: { explicitConfirmation: true },
    mutation: {
      attempted: true,
      performed: true,
      resourceDeletionAttempted: false,
    },
    secrets: {
      CLOUDFLARE_API_TOKEN: true,
      CLOUDFLARE_ACCOUNT_ID: true,
      valuesEmitted: false,
    },
    source: {
      baselineSha: sourceSha,
      subject: 'feat(ponto): establish private rollback baseline (#912)',
      parentCount: 1,
      changedFiles: [
        'api/src/router.js',
        'api/test/gateway.test.mjs',
        'api/workers/ponto.js',
        'api/wrangler.ponto.toml',
      ],
      privateSurface: {
        workersDev: false,
        previewUrls: false,
        routeDeclarations: 0,
        routeOnly: true,
      },
    },
    before: { exists: false },
    after: {
      exists: true,
      attestation: {
        worker: selected.worker,
        target,
        activeDeploymentId: selected.deploymentId,
        activeVersionId: selected.versionId,
        activeVersions: [{ versionId: selected.versionId, percentage: 100 }],
        versionMessage: `ponto-core-baseline:${sourceSha}`,
        appVersion: sourceSha,
        environment: target,
        timekeepingService: selected.timekeepingService,
        routeOnly: true,
        exposure: {
          workerRouteCount: 0,
          zonesInspected: 3,
          customDomainCount: 0,
          workersDevEnabled: false,
          previewUrlsEnabled: false,
        },
      },
    },
  };
  return { target, catalog, run, artifact, evidence };
}

function verify(input) {
  return validatePontoCoreBootstrapEvidence({
    ...input,
    repository,
    now: new Date('2026-07-30T12:00:00Z'),
  });
}

test('accepts the exact immutable staging and production bootstrap artifacts', () => {
  for (const target of ['staging', 'production']) {
    const input = fixture(target);
    const selected = targets[target];
    assert.deepEqual(verify(input), {
      bootstrap_workflow_run_id: runId,
      bootstrap_artifact_id: selected.artifactId,
      bootstrap_artifact_digest: selected.digest,
      bootstrap_source_sha: sourceSha,
      bootstrap_deployment_id: selected.deploymentId,
      bootstrap_version_id: selected.versionId,
      bootstrap_worker: selected.worker,
    });
  }
});

const tamperCases = [
  ['catalog schema', (x) => (x.catalog.schemaVersion = 2), /catalog schemaVersion/],
  ['duplicate unit', (x) => x.catalog.units.push(structuredClone(x.catalog.units[0])), /exactly one/],
  ['bootstrap-only', (x) => (x.catalog.units[0].promotion.bootstrapOnly = false), /bootstrap-only/],
  ['source PR', (x) => (x.catalog.units[0].promotion.immutableSourcePr = 911), /immutableSourcePr/],
  [
    'state',
    (x) => (x.catalog.units[0].promotion.bootstrapEvidence.state = 'pending'),
    /published-and-attested/,
  ],
  [
    'catalog repository',
    (x) => (x.catalog.units[0].promotion.bootstrapEvidence.repository = 'attacker/fork'),
    /GITHUB_REPOSITORY/,
  ],
  [
    'source SHA',
    (x) => (x.catalog.units[0].promotion.bootstrapEvidence.sourceSha = 'd'.repeat(40)),
    /artifact name is not source-bound|baselineSha differs/,
  ],
  [
    'workflow run id catalog',
    (x) => (x.catalog.units[0].promotion.bootstrapEvidence.workflowRunId = '30512105627'),
    /workflow run id differs/,
  ],
  [
    'control SHA catalog',
    (x) => (x.catalog.units[0].promotion.bootstrapEvidence.workflowControlSha = 'd'.repeat(40)),
    /head_sha differs/,
  ],
  [
    'workflow path catalog',
    (x) => (x.catalog.units[0].promotion.bootstrapEvidence.workflowPath = '.github/workflows/evil.yml'),
    /workflowPath/,
  ],
  [
    'run attempt catalog',
    (x) => (x.catalog.units[0].promotion.bootstrapEvidence.runAttempt = 2),
    /runAttempt/,
  ],
  [
    'validation artifact id',
    (x) => (x.catalog.units[0].promotion.bootstrapEvidence.artifacts.validation.id = '0'),
    /validation artifact id/,
  ],
  [
    'validation artifact name',
    (x) => (x.catalog.units[0].promotion.bootstrapEvidence.artifacts.validation.name = 'validation'),
    /validation artifact name/,
  ],
  [
    'validation artifact digest',
    (x) => (x.catalog.units[0].promotion.bootstrapEvidence.artifacts.validation.digest = 'sha256:bad'),
    /validation artifact digest/,
  ],
  [
    'target artifact id catalog',
    (x) => (x.catalog.units[0].promotion.bootstrapEvidence.artifacts.staging.id = '8747521766'),
    /artifact id differs/,
  ],
  [
    'target artifact name catalog',
    (x) => (x.catalog.units[0].promotion.bootstrapEvidence.artifacts.staging.name = 'wrong'),
    /artifact name is not source-bound/,
  ],
  [
    'target artifact digest catalog',
    (x) => (x.catalog.units[0].promotion.bootstrapEvidence.artifacts.staging.digest = `sha256:${'d'.repeat(64)}`),
    /artifact digest differs/,
  ],
  [
    'target worker catalog',
    (x) => (x.catalog.units[0].promotion.bootstrapEvidence.artifacts.staging.worker = 'public-worker'),
    /private target/,
  ],
  [
    'target deployment catalog',
    (x) => (x.catalog.units[0].promotion.bootstrapEvidence.artifacts.staging.deploymentId = 'bad'),
    /deploymentId/,
  ],
  [
    'target version catalog',
    (x) => (x.catalog.units[0].promotion.bootstrapEvidence.artifacts.staging.versionId = 'bad'),
    /versionId/,
  ],
  ['run id', (x) => (x.run.id = 30512105627), /run id differs/],
  ['run path', (x) => (x.run.path = '.github/workflows/other.yml'), /path must equal/],
  ['run SHA', (x) => (x.run.head_sha = 'd'.repeat(40)), /head_sha differs/],
  ['run branch', (x) => (x.run.head_branch = 'feature'), /head_branch/],
  ['run event', (x) => (x.run.event = 'push'), /workflow_dispatch/],
  ['run status', (x) => (x.run.status = 'in_progress'), /completed/],
  ['run conclusion', (x) => (x.run.conclusion = 'failure'), /conclusion/],
  ['run attempt', (x) => (x.run.run_attempt = 2), /attempt/],
  ['run repository', (x) => (x.run.repository.full_name = 'attacker/fork'), /run repository/],
  [
    'run head repository',
    (x) => (x.run.head_repository.full_name = 'attacker/fork'),
    /head repository/,
  ],
  ['artifact id', (x) => (x.artifact.id = 8747521766), /artifact id differs/],
  ['artifact name', (x) => (x.artifact.name = 'wrong'), /artifact name differs/],
  ['artifact digest', (x) => (x.artifact.digest = `sha256:${'d'.repeat(64)}`), /digest differs/],
  ['artifact expired flag', (x) => (x.artifact.expired = true), /marked expired/],
  ['artifact expiry missing', (x) => delete x.artifact.expires_at, /expires_at is missing/],
  ['artifact expiry elapsed', (x) => (x.artifact.expires_at = '2026-07-29T00:00:00Z'), /has expired/],
  ['artifact run id', (x) => (x.artifact.workflow_run.id = 30512105627), /workflow_run id differs/],
  ['artifact run SHA', (x) => (x.artifact.workflow_run.head_sha = 'd'.repeat(40)), /workflow_run head_sha/],
  ['evidence schema', (x) => (x.evidence.schemaVersion = 2), /schemaVersion/],
  ['evidence purpose', (x) => (x.evidence.purpose = 'deployment'), /purpose/],
  ['evidence result', (x) => (x.evidence.result = 'failed'), /result/],
  ['evidence outcome', (x) => (x.evidence.outcome = 'idempotent-attestation'), /outcome/],
  ['evidence baseline SHA', (x) => (x.evidence.baselineSha = 'd'.repeat(40)), /baselineSha/],
  ['evidence control SHA', (x) => (x.evidence.workflowControlSha = 'd'.repeat(40)), /workflowControlSha/],
  ['evidence target', (x) => (x.evidence.target = 'production'), /target differs/],
  ['evidence worker', (x) => (x.evidence.worker = 'public-worker'), /worker/],
  [
    'authorization',
    (x) => (x.evidence.authorization.explicitConfirmation = false),
    /explicit confirmation/,
  ],
  ['authorization extra key', (x) => (x.evidence.authorization.actor = 'someone'), /keys must be exactly/],
  ['mutation attempted', (x) => (x.evidence.mutation.attempted = false), /mutation was not attempted/],
  ['mutation performed', (x) => (x.evidence.mutation.performed = false), /mutation was not performed/],
  [
    'resource deletion',
    (x) => (x.evidence.mutation.resourceDeletionAttempted = true),
    /resource deletion/,
  ],
  ['secret token presence', (x) => (x.evidence.secrets.CLOUDFLARE_API_TOKEN = false), /secret presence/],
  ['secret account presence', (x) => (x.evidence.secrets.CLOUDFLARE_ACCOUNT_ID = false), /secret presence/],
  ['secret emission', (x) => (x.evidence.secrets.valuesEmitted = true), /emitted secret values/],
  ['secret value field', (x) => (x.evidence.secrets.tokenValue = 'leak'), /keys must be exactly/],
  ['source SHA evidence', (x) => (x.evidence.source.baselineSha = 'd'.repeat(40)), /source baselineSha/],
  ['source subject', (x) => (x.evidence.source.subject = 'unreviewed commit'), /PR #912/],
  ['source parents', (x) => (x.evidence.source.parentCount = 2), /single-parent/],
  ['source file order', (x) => x.evidence.source.changedFiles.reverse(), /changedFiles/],
  ['source workers.dev', (x) => (x.evidence.source.privateSurface.workersDev = true), /workers.dev/],
  ['source previews', (x) => (x.evidence.source.privateSurface.previewUrls = true), /preview URLs/],
  ['source routes', (x) => (x.evidence.source.privateSurface.routeDeclarations = 1), /public routes/],
  ['source route-only', (x) => (x.evidence.source.privateSurface.routeOnly = false), /route-only/],
  ['after existence', (x) => (x.evidence.after.exists = false), /existing attested Worker/],
  ['attested worker', (x) => (x.evidence.after.attestation.worker = 'wrong'), /attested worker/],
  ['attested target', (x) => (x.evidence.after.attestation.target = 'production'), /attested target/],
  [
    'attested deployment',
    (x) => (x.evidence.after.attestation.activeDeploymentId = targets.production.deploymentId),
    /deployment id/,
  ],
  [
    'attested version',
    (x) => (x.evidence.after.attestation.activeVersionId = targets.production.versionId),
    /version id/,
  ],
  [
    'attested active versions',
    (x) => (x.evidence.after.attestation.activeVersions[0].percentage = 99),
    /activeVersions/,
  ],
  ['version message', (x) => (x.evidence.after.attestation.versionMessage = 'manual'), /version message/],
  ['app version', (x) => (x.evidence.after.attestation.appVersion = 'd'.repeat(40)), /APP_VERSION/],
  ['environment', (x) => (x.evidence.after.attestation.environment = 'production'), /ENVIRONMENT/],
  [
    'timekeeping binding',
    (x) => (x.evidence.after.attestation.timekeepingService = 'skincos-timekeeping'),
    /TIMEKEEPING/,
  ],
  ['attested route-only', (x) => (x.evidence.after.attestation.routeOnly = false), /not route-only/],
  [
    'exposure routes',
    (x) => (x.evidence.after.attestation.exposure.workerRouteCount = 1),
    /public routes/,
  ],
  [
    'exposure domains',
    (x) => (x.evidence.after.attestation.exposure.customDomainCount = 1),
    /custom domains/,
  ],
  [
    'exposure zones',
    (x) => (x.evidence.after.attestation.exposure.zonesInspected = 2),
    /exactly three zones/,
  ],
  [
    'exposure workers.dev',
    (x) => (x.evidence.after.attestation.exposure.workersDevEnabled = true),
    /workers.dev/,
  ],
  [
    'exposure previews',
    (x) => (x.evidence.after.attestation.exposure.previewUrlsEnabled = true),
    /preview URLs/,
  ],
];

test('rejects catalog, run, artifact, source, mutation, secret, and attestation tampering', () => {
  for (const [name, mutate, expected] of tamperCases) {
    const input = fixture();
    mutate(input);
    assert.throws(() => verify(input), expected, name);
  }
});

test('rejects an unsupported target before trusting any input', () => {
  const input = fixture();
  input.target = 'pilot';
  assert.throws(() => verify(input), /target must be staging or production/);
});

test('CLI verifies files and writes only the approved immutable identifiers', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ponto-core-bootstrap-evidence-'));
  try {
    const input = fixture('production');
    const files = {};
    for (const name of ['catalog', 'run', 'artifact', 'evidence']) {
      files[name] = path.join(directory, `${name}.json`);
      fs.writeFileSync(files[name], `${JSON.stringify(input[name], null, 2)}\n`);
    }
    const output = path.join(directory, 'github-output.txt');
    const result = spawnSync(
      process.execPath,
      [
        script,
        'verify',
        'production',
        files.evidence,
        files.run,
        files.artifact,
        files.catalog,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_REPOSITORY: repository,
          GITHUB_OUTPUT: output,
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /"result":"verified"/);
    const lines = fs.readFileSync(output, 'utf8').trim().split(/\r?\n/);
    assert.deepEqual(lines, [
      `bootstrap_workflow_run_id=${runId}`,
      `bootstrap_artifact_id=${targets.production.artifactId}`,
      `bootstrap_artifact_digest=${targets.production.digest}`,
      `bootstrap_source_sha=${sourceSha}`,
      `bootstrap_deployment_id=${targets.production.deploymentId}`,
      `bootstrap_version_id=${targets.production.versionId}`,
      `bootstrap_worker=${targets.production.worker}`,
    ]);
    assert.doesNotMatch(fs.readFileSync(output, 'utf8'), /bootstrap_live_attested/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('CLI fails closed on malformed JSON and does not create outputs', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ponto-core-bootstrap-evidence-json-'));
  try {
    const input = fixture();
    const evidence = path.join(directory, 'evidence.json');
    const run = path.join(directory, 'run.json');
    const artifact = path.join(directory, 'artifact.json');
    const catalog = path.join(directory, 'catalog.json');
    const output = path.join(directory, 'github-output.txt');
    fs.writeFileSync(evidence, '{');
    fs.writeFileSync(run, JSON.stringify(input.run));
    fs.writeFileSync(artifact, JSON.stringify(input.artifact));
    fs.writeFileSync(catalog, JSON.stringify(input.catalog));
    const result = spawnSync(
      process.execPath,
      [script, 'verify', 'staging', evidence, run, artifact, catalog],
      {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_REPOSITORY: repository, GITHUB_OUTPUT: output },
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /evidence JSON is not valid JSON/);
    assert.equal(fs.existsSync(output), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
