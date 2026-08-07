import assert from 'node:assert/strict';
import test from 'node:test';

import {
  remoteSnapshot,
  validateBaselineSourceFacts,
  validateRemoteBaseline,
} from './ponto-core-baseline-publisher.mjs';

const baselineSha = '0f3480dce1a170ac0f862fa392a95456af292a88';
const changedFiles = [
  'api/src/router.js',
  'api/test/gateway.test.mjs',
  'api/workers/ponto.js',
  'api/wrangler.ponto.toml',
];
const config = `
name = "skincos-ponto-core"
main = "workers/ponto.js"
workers_dev = false
preview_urls = false
PONTO_ROUTE_ONLY = "true"
service = "skincos-timekeeping"

[env.staging]
name = "skincos-ponto-core-staging"
workers_dev = false
preview_urls = false
PONTO_ROUTE_ONLY = "true"
service = "skincos-timekeeping-staging"
`;

function exactRemote(target = 'staging') {
  const staging = target === 'staging';
  const worker = staging ? 'skincos-ponto-core-staging' : 'skincos-ponto-core';
  const timekeeping = staging ? 'skincos-timekeeping-staging' : 'skincos-timekeeping';
  const deploymentId = '11111111-1111-4111-8111-111111111111';
  const versionId = '22222222-2222-4222-8222-222222222222';
  return {
    baselineSha,
    target,
    script: { id: worker },
    routeInventory: { zoneCount: 3, matches: [] },
    deploymentsResult: {
      deployments: [
        {
          id: deploymentId,
          created_on: '2026-07-29T12:00:00.000Z',
          versions: [{ version_id: versionId, percentage: 100 }],
        },
      ],
    },
    subdomain: { enabled: false, previews_enabled: false },
    domainsResult: [],
    version: {
      id: versionId,
      annotations: { 'workers/message': `ponto-core-baseline:${baselineSha}` },
      resources: {
        bindings: [
          { name: 'APP_VERSION', type: 'plain_text', text: baselineSha },
          { name: 'ENVIRONMENT', type: 'plain_text', text: target },
          { name: 'PONTO_ROUTE_ONLY', type: 'plain_text', text: 'true' },
          { name: 'TIMEKEEPING', type: 'service', service: timekeeping },
          { name: 'CF_VERSION_METADATA', type: 'version_metadata' },
        ],
      },
    },
  };
}

test('accepts only the immutable single-parent #912 source delta', () => {
  const result = validateBaselineSourceFacts({
    baselineSha,
    headSha: baselineSha,
    ancestorOfMain: true,
    subject: 'feat(api): add private Ponto core baseline (#912)',
    parentCount: 1,
    changedFiles,
    config,
  });
  assert.equal(result.baselineSha, baselineSha);
  assert.deepEqual(result.changedFiles, [...changedFiles].sort());
  assert.equal(result.privateSurface.workersDev, false);
});

test('rejects a SHA that includes any file outside the #912 baseline', () => {
  assert.throws(
    () =>
      validateBaselineSourceFacts({
        baselineSha,
        headSha: baselineSha,
        ancestorOfMain: true,
        subject: 'feat(api): add private Ponto core baseline (#912)',
        parentCount: 1,
        changedFiles: [...changedFiles, 'api/wrangler.toml'],
        config,
      }),
    /must change only/,
  );
});

test('accepts an immutable published predecessor with a source-bound release annotation', () => {
  const candidateSha = '6daa6eaee7c4c49f047e97944e70ea1aa320ca61';
  const value = exactRemote();
  value.baselineSha = candidateSha;
  value.version.annotations['workers/message'] = `ponto:coreApi:${candidateSha}`;
  value.version.resources.bindings.find(binding => binding.name === 'APP_VERSION').text = candidateSha;
  const result = validateRemoteBaseline({
    ...value,
    expectedVersionMessage: `ponto:coreApi:${candidateSha}`,
    expectedAppVersion: candidateSha,
  });
  assert.equal(result.versionMessage, `ponto:coreApi:${candidateSha}`);
  assert.equal(result.appVersion, candidateSha);
});

test('rejects every ancestor except the exact merged PR 912 squash SHA', () => {
  assert.throws(
    () =>
      validateBaselineSourceFacts({
        baselineSha: 'a'.repeat(40),
        headSha: 'a'.repeat(40),
        ancestorOfMain: true,
        subject: 'feat(api): add private Ponto core baseline (#912)',
        parentCount: 1,
        changedFiles,
        config,
      }),
    /exact merged PR #912 squash SHA/,
  );
});

test('rejects source with a public route declaration', () => {
  assert.throws(
    () =>
      validateBaselineSourceFacts({
        baselineSha,
        headSha: baselineSha,
        ancestorOfMain: true,
        subject: 'feat(api): add private Ponto core baseline (#912)',
        parentCount: 1,
        changedFiles,
        config: `${config}\nroutes = ["api.skincos.com.br/*"]\n`,
      }),
    /must not declare public routes/,
  );
});

test('attests the exact private staging baseline at one version and 100 percent', () => {
  const result = validateRemoteBaseline(exactRemote('staging'));
  assert.equal(result.worker, 'skincos-ponto-core-staging');
  assert.equal(result.activeVersions[0].percentage, 100);
  assert.equal(result.exposure.workerRouteCount, 0);
  assert.equal(result.exposure.customDomainCount, 0);
  assert.equal(result.exposure.zonesInspected, 3);
});

test('attests the exact private production baseline', () => {
  const result = validateRemoteBaseline(exactRemote('production'));
  assert.equal(result.worker, 'skincos-ponto-core');
  assert.equal(result.timekeepingService, 'skincos-timekeeping');
});

test('fails closed when an existing Worker is split across versions', () => {
  const remote = exactRemote();
  remote.deploymentsResult.deployments[0].versions = [
    { version_id: remote.version.id, percentage: 90 },
    { version_id: '33333333-3333-4333-8333-333333333333', percentage: 10 },
  ];
  assert.throws(() => validateRemoteBaseline(remote), /exactly one active version at 100%/);
});

test('fails closed when an existing Worker has a route or public hostname', () => {
  const routed = exactRemote();
  routed.routeInventory.matches = [{ zoneId: 'a'.repeat(32), id: 'route-1', pattern: 'api.example.test/*' }];
  assert.throws(() => validateRemoteBaseline(routed), /public Worker routes/);

  const publicDomain = exactRemote();
  publicDomain.domainsResult = [{ service: publicDomain.script.id, hostname: 'ponto.example.test' }];
  assert.throws(() => validateRemoteBaseline(publicDomain), /public custom domain/);

  const workersDev = exactRemote();
  workersDev.subdomain.enabled = true;
  assert.throws(() => validateRemoteBaseline(workersDev), /workers.dev endpoint is enabled/);
});

test('fails closed when the active deployment or binding is not the baseline SHA', () => {
  const wrongMessage = exactRemote();
  wrongMessage.version.annotations['workers/message'] =
    'ponto-core-baseline:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  assert.throws(() => validateRemoteBaseline(wrongMessage), /not the requested immutable baseline/);

  const wrongBinding = exactRemote();
  wrongBinding.version.resources.bindings.find((entry) => entry.name === 'APP_VERSION').text =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  assert.throws(() => validateRemoteBaseline(wrongBinding), /APP_VERSION does not match/);
});

function cloudflareFetch({ routed = false } = {}) {
  return async (input) => {
    const url = new URL(input);
    let result;
    let result_info;
    if (url.pathname.endsWith('/workers/scripts')) {
      result = [];
    } else if (url.pathname === '/client/v4/zones') {
      result = [
        { id: 'a'.repeat(32), name: 'example.test', account: { id: 'b'.repeat(32) } },
        { id: 'c'.repeat(32), name: 'other.test', account: { id: 'b'.repeat(32) } },
      ];
      result_info = { page: 1, per_page: 100, count: 2, total_count: 2, total_pages: 1 };
    } else if (url.pathname.endsWith(`/zones/${'a'.repeat(32)}/workers/routes`)) {
      result = routed
        ? [{ id: 'route-1', pattern: 'private.example.test/*', script: 'skincos-ponto-core-staging' }]
        : [];
    } else if (url.pathname.endsWith(`/zones/${'c'.repeat(32)}/workers/routes`)) {
      result = [];
    } else if (url.pathname.endsWith('/workers/domains')) {
      result = [];
      result_info = { page: 1, per_page: 100, count: 0, total_count: 0 };
    } else {
      return new Response(JSON.stringify({ success: false, errors: [{ code: 1000 }] }), { status: 404 });
    }
    return new Response(JSON.stringify({ success: true, errors: [], messages: [], result, result_info }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}

test('proves an absent baseline has no route in every account zone before creation', async () => {
  const snapshot = await remoteSnapshot({
    accountId: 'b'.repeat(32),
    apiToken: 'test-token',
    baselineSha,
    target: 'staging',
    fetchImpl: cloudflareFetch(),
  });
  assert.equal(snapshot.exists, false);
  assert.equal(snapshot.exposure.zonesInspected, 2);
  assert.equal(snapshot.exposure.workerRouteCount, 0);
});

test('refuses creation when any account zone already routes to the baseline Worker', async () => {
  await assert.rejects(
    remoteSnapshot({
      accountId: 'b'.repeat(32),
      apiToken: 'test-token',
      baselineSha,
      target: 'staging',
      fetchImpl: cloudflareFetch({ routed: true }),
    }),
    /public Worker routes/,
  );
});
