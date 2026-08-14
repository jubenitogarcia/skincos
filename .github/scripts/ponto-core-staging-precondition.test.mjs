import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  discoverEvidenceDerivedStagingIncumbents,
  run,
  resolveStagingCorePrecondition,
  validateEvidenceDerivedStagingIncumbent,
  validateStagingCoreIncumbentLive,
  validateStagingHistoricalBootstrapLive,
  validateStagingIncumbentCatalog,
} from './ponto-core-staging-precondition.mjs';

test('keeps a bounded buffer above the default spawn limit for GitHub run history', () => {
  const characters = 1_100_000;
  const output = run(process.execPath, [
    '-e',
    `process.stdout.write('x'.repeat(${characters}))`,
  ]);
  assert.equal(output.length, characters);
});

const sourceSha = '6daa6eaee7c4c49f047e97944e70ea1aa320ca61';
const deploymentId = '2688c47a-efbb-4b97-98f7-6a1734eac354';
const versionId = 'e71704e3-0d6d-4327-83cf-3121010995b1';
const evidenceDerivedSourceSha = 'd0abd96c8d35f7028150c25d74ca4f5aabe923f8';
const evidenceDerivedDeploymentId = 'e6845b49-0d6d-4327-83cf-3121010995b1';
const evidenceDerivedVersionId = 'b71704e3-0d6d-4327-83cf-3121010995b1';
const evidenceDerivedRun = {
  id: 31662357446,
  path: '.github/workflows/ponto-progressive-release.yml',
  head_sha: evidenceDerivedSourceSha,
  head_branch: 'main',
  event: 'workflow_dispatch',
  status: 'completed',
  conclusion: 'success',
  run_attempt: 1,
  display_title: `Ponto staging ${evidenceDerivedSourceSha} orchestrator=31662357446`,
  repository: { full_name: 'jubenitogarcia/skincos' },
  head_repository: { full_name: 'jubenitogarcia/skincos' },
};
const evidenceDerivedArtifact = {
  id: 9167149830,
  name: `ponto-release-evidence-staging-${evidenceDerivedSourceSha}`,
  digest: 'sha256:2187107cdd6dcd827613be60cc0e6d4204161d5b287c05d39aa7c27869fd932b',
  expired: false,
  workflow_run: {
    id: 31662357446,
    head_sha: evidenceDerivedSourceSha,
    head_branch: 'main',
  },
};
const evidenceDerivedEvidence = {
  decision: 'pass',
  runId: '31662357446',
  surfaces: {
    coreApi: {
      sourceSha: evidenceDerivedSourceSha,
      stage: 'staging',
      deploymentId: evidenceDerivedDeploymentId,
      candidateVersionId: evidenceDerivedVersionId,
      candidatePercent: 100,
      incumbentPercent: 0,
      candidateTag: `ponto:coreApi:${evidenceDerivedSourceSha}`,
    },
  },
};

const attestedIncumbent = {
  sourceSha: 'd0abd96c8d35f7028150c25d74ca4f5aabe923f8',
  workflowRunId: '31662357446',
  releaseEvidenceArtifact: {
    id: '9167149830',
    name: 'ponto-release-evidence-staging-d0abd96c8d35f7028150c25d74ca4f5aabe923f8',
    digest: 'sha256:2187107cdd6dcd827613be60cc0e6d4204161d5b287c05d39aa7c27869fd932b',
  },
  surface: {
    worker: 'skincos-ponto-core-staging',
    deploymentId: '1f22e714-2151-4de9-b149-dae4b23cdd92',
    versionId: 'e6845b49-6c32-4afe-87b8-618c5fdb84cd',
  },
};

function catalog() {
  return {
    units: [{
      id: 'ponto-core-baseline',
      promotion: {
        bootstrapOnly: true,
        bootstrapEvidence: {
          repository: 'jubenitogarcia/skincos',
          sourceSha: '0f3480dce1a170ac0f862fa392a95456af292a88',
          workflowRunId: '30512105626',
          artifacts: {
            staging: {
              id: '8747521765',
              name: 'ponto-core-baseline-staging-0f3480dce1a170ac0f862fa392a95456af292a88',
              digest: 'sha256:382c6e208733c54184e94be0c8169cb266179d692b12e2b64803d4deebb0fab4',
              deploymentId: 'd88aa85e-a90b-4fd0-b03b-14bf4c6fc248',
              versionId: '0ee7a2fe-deff-4f37-bcda-c35ad54b68f3',
            },
          },
        },
        stagingIncumbent: {
          state: 'published-and-attested',
          repository: 'jubenitogarcia/skincos',
          sourceSha,
          workflowRunId: '30966781527',
          workflowPath: '.github/workflows/ponto-progressive-release.yml',
          runAttempt: 1,
          decision: 'pass',
          releaseEvidenceArtifact: {
            id: '8915472652',
            name: `ponto-release-evidence-staging-${sourceSha}`,
            digest: 'sha256:5709bcaa26af8a42a1eb321aa8e0ac15a18207b35e46e475a0b70ccd21103ebb',
          },
          surface: {
            worker: 'skincos-ponto-core-staging',
            deploymentId,
            versionId,
          },
        },
      },
    }],
  };
}

function live(overrides = {}) {
  return {
    exists: true,
    attestation: {
      worker: 'skincos-ponto-core-staging',
      target: 'staging',
      activeDeploymentId: deploymentId,
      activeVersionId: versionId,
      activeVersions: [{ versionId, percentage: 100 }],
      versionMessage: `ponto:coreApi:${sourceSha}`,
      appVersion: sourceSha,
      exposure: {
        workerRouteCount: 0,
        customDomainCount: 0,
        workersDevEnabled: false,
        previewUrlsEnabled: false,
      },
      ...overrides,
    },
  };
}

test('accepts a source-bound staging incumbent catalog entry', () => {
  const expected = validateStagingIncumbentCatalog({ catalog: catalog() });
  assert.equal(expected.sourceSha, sourceSha);
  assert.equal(expected.surface.versionId, versionId);
});

test('pins the repository staging incumbent to the last passed immutable Core release', () => {
  const repositoryCatalog = JSON.parse(readFileSync(
    new URL('../../platform/deploy/operational-units.json', import.meta.url),
    'utf8',
  ));
  const incumbent = validateStagingIncumbentCatalog({ catalog: repositoryCatalog });
  assert.deepEqual(
    {
      sourceSha: incumbent.sourceSha,
      workflowRunId: incumbent.workflowRunId,
      releaseEvidenceArtifact: incumbent.releaseEvidenceArtifact,
      surface: incumbent.surface,
    },
    attestedIncumbent,
  );
});

test('accepts the live incumbent only at 100% and with private exposure', () => {
  const expected = validateStagingIncumbentCatalog({ catalog: catalog() });
  const result = validateStagingCoreIncumbentLive({ live: live(), expected });
  assert.equal(result.versionId, versionId);
  assert.equal(result.deploymentDrifted, false);
});

test('preserves deployment drift tolerance when the exact immutable version remains active', () => {
  const expected = validateStagingIncumbentCatalog({ catalog: catalog() });
  const result = validateStagingCoreIncumbentLive({
    live: live({ activeDeploymentId: 'e71a4483-da7a-4fee-9189-1543b03795a9' }),
    expected,
  });
  assert.equal(result.versionId, versionId);
  assert.equal(result.deploymentDrifted, true);
});

test('rejects a different active version or public exposure', () => {
  const expected = validateStagingIncumbentCatalog({ catalog: catalog() });
  assert.throws(
    () => validateStagingCoreIncumbentLive({
      live: live({ activeVersionId: '11111111-1111-4111-8111-111111111111' }),
      expected,
    }),
    /version differs from the cataloged incumbent/,
  );
  assert.throws(
    () => validateStagingCoreIncumbentLive({
      live: live({ exposure: { workerRouteCount: 1, customDomainCount: 0, workersDevEnabled: false, previewUrlsEnabled: false } }),
      expected,
    }),
    /publicly exposed/,
  );
});

test('historical fallback still requires the exact cataloged immutable version', () => {
  const historicalExpected = {
    surface: {
      deploymentId: 'd88aa85e-a90b-4fd0-b03b-14bf4c6fc248',
      versionId: '0ee7a2fe-deff-4f37-bcda-c35ad54b68f3',
    },
  };
  const historicalLive = live({
    activeDeploymentId: historicalExpected.surface.deploymentId,
    activeVersionId: historicalExpected.surface.versionId,
    activeVersions: [{ versionId: historicalExpected.surface.versionId, percentage: 100 }],
  });
  const result = validateStagingHistoricalBootstrapLive({ live: historicalLive, expected: historicalExpected });
  assert.equal(result.versionId, historicalExpected.surface.versionId);
  assert.equal(result.liveAttestation.activeVersionId, historicalExpected.surface.versionId);
  assert.throws(
    () => validateStagingHistoricalBootstrapLive({
      live: {
        ...historicalLive,
        attestation: {
          ...historicalLive.attestation,
          activeVersionId: versionId,
          activeVersions: [{ versionId, percentage: 100 }],
        },
      },
      expected: historicalExpected,
    }),
    /version differs from the cataloged bootstrap/,
  );
});

test('rejects a missing or unreviewed incumbent evidence entry', () => {
  const value = catalog();
  delete value.units[0].promotion.stagingIncumbent.releaseEvidenceArtifact;
  assert.throws(
    () => validateStagingIncumbentCatalog({ catalog: value }),
    /artifact ID is invalid/,
  );
});

test('derives the active staging predecessor only from terminal source-bound release evidence', () => {
  const incumbent = validateEvidenceDerivedStagingIncumbent({
    run: evidenceDerivedRun,
    artifact: evidenceDerivedArtifact,
    evidence: evidenceDerivedEvidence,
  });
  assert.equal(incumbent.sourceSha, evidenceDerivedSourceSha);
  assert.equal(incumbent.surface.versionId, evidenceDerivedVersionId);
  assert.equal(incumbent.surface.deploymentId, evidenceDerivedDeploymentId);
  assert.throws(
    () => validateEvidenceDerivedStagingIncumbent({
      run: { ...evidenceDerivedRun, display_title: 'Ponto pilot forged' },
      artifact: evidenceDerivedArtifact,
      evidence: evidenceDerivedEvidence,
    }),
    /workflow title differs/,
  );
  assert.throws(
    () => validateEvidenceDerivedStagingIncumbent({
      run: evidenceDerivedRun,
      artifact: evidenceDerivedArtifact,
      evidence: { ...evidenceDerivedEvidence, surfaces: { coreApi: { ...evidenceDerivedEvidence.surfaces.coreApi, candidatePercent: 50 } } },
    }),
    /evidence traffic differs/,
  );
});

test('discovers only a reachable terminal staging release with one exact evidence artifact', async () => {
  const calls = [];
  const discovered = await discoverEvidenceDerivedStagingIncumbents({
    repository: 'jubenitogarcia/skincos',
    ghApi(pathname) {
      calls.push(pathname);
      if (pathname.includes('/actions/workflows/ponto-progressive-release.yml/runs?')) {
        return {
          workflow_runs: [
            { ...evidenceDerivedRun, status: 'completed', conclusion: 'failure' },
            evidenceDerivedRun,
          ],
        };
      }
      if (pathname === `repos/jubenitogarcia/skincos/compare/${evidenceDerivedSourceSha}...main`) {
        return { status: 'ahead' };
      }
      if (pathname === `repos/jubenitogarcia/skincos/actions/runs/${evidenceDerivedRun.id}/artifacts?per_page=100`) {
        return { artifacts: [evidenceDerivedArtifact] };
      }
      throw new Error(`unexpected GitHub API path: ${pathname}`);
    },
    async readEvidence({ workflowRunId, artifactName }) {
      assert.equal(workflowRunId, String(evidenceDerivedRun.id));
      assert.equal(artifactName, evidenceDerivedArtifact.name);
      return evidenceDerivedEvidence;
    },
  });
  assert.equal(discovered.failures.length, 0);
  assert.deepEqual(discovered.candidates.map(candidate => candidate.sourceSha), [evidenceDerivedSourceSha]);
  assert.equal(calls.filter(pathname => pathname.includes('/compare/')).length, 1);
});

test('resolves the cataloged incumbent through the same read-only Cloudflare attestation path', async () => {
  const accountId = 'a'.repeat(32);
  const zoneId = 'b'.repeat(32);
  const versionPath = `/accounts/${accountId}/workers/scripts/skincos-ponto-core-staging/versions/${versionId}`;
  const responses = new Map([
    [`/accounts/${accountId}/workers/scripts`, { value: [{ id: 'skincos-ponto-core-staging' }] }],
    ['/zones', { value: [{ id: zoneId, name: 'example', account: { id: accountId } }], info: { total_count: 1, total_pages: 1 } }],
    [`/zones/${zoneId}/workers/routes`, { value: [] }],
    [`/accounts/${accountId}/workers/domains`, { value: [], info: { total_count: 0, total_pages: 1 } }],
    [`/accounts/${accountId}/workers/scripts/skincos-ponto-core-staging/deployments`, {
      value: {
        deployments: [{
          id: deploymentId,
          created_on: '2026-08-05T01:57:49.300266Z',
          versions: [{ version_id: versionId, percentage: 100 }],
        }],
      },
    }],
    [`/accounts/${accountId}/workers/scripts/skincos-ponto-core-staging/subdomain`, {
      value: { enabled: false, previews_enabled: false },
    }],
    [versionPath, {
      value: {
        id: versionId,
        annotations: { 'workers/message': `ponto:coreApi:${sourceSha}` },
        resources: {
          bindings: [
            { name: 'APP_VERSION', type: 'plain_text', text: sourceSha },
            { name: 'ENVIRONMENT', type: 'plain_text', text: 'staging' },
            { name: 'PONTO_ROUTE_ONLY', type: 'plain_text', text: 'true' },
            { name: 'TIMEKEEPING', type: 'service', service: 'skincos-timekeeping-staging' },
            { name: 'CF_VERSION_METADATA', type: 'version_metadata' },
          ],
        },
      },
    }],
  ]);
  const fetchImpl = async input => {
    const key = new URL(input).pathname.replace(/^\/client\/v4/, '');
    const result = responses.get(key);
    assert.ok(result, `unexpected Cloudflare request: ${key}`);
    return {
      ok: true,
      status: 200,
      async json() {
        return { success: true, result: result.value, result_info: result.info };
      },
    };
  };
  const proof = await resolveStagingCorePrecondition({
    catalog: catalog(),
    accountId,
    apiToken: 'synthetic-token',
    verifyEvidence: false,
    fetchImpl,
  });
  assert.equal(proof.predecessorMode, 'staging-incumbent');
  assert.equal(proof.versionId, versionId);
  assert.equal(proof.credentialsIncluded, false);
  assert.equal(proof.piiIncluded, false);
});
