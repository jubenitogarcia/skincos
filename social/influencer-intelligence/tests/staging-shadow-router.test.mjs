import assert from 'node:assert/strict';
import test from 'node:test';
import { redactProviderResult, runStagingShadowRouter } from '../staging-shadow-router.mjs';

function result(operation, overrides = {}) {
  return {
    operation,
    status: 'ok',
    provider: 'meta-graph',
    data_classification: 'observed',
    freshness: { max_age_seconds: 3600 },
    limitations: [],
    provider_specific_evidence: {
      adapter_version: 'token-vault-meta-graph-v1',
      source_ref: `meta-graph:${operation}`,
      endpoint_family: 'instagram-graph-read-only',
      fields: ['username'],
      correlation_id: 'ii-shadow-test',
    },
    attempts: [{ provider: 'meta-graph', status: 'ok', retry_count: 0 }],
    data: {},
    ...overrides,
  };
}

test('shadow router runs Meta resolve then profile sequentially and redacts creator data', async () => {
  const calls = [];
  const router = {
    providerOrder: ['meta-graph'],
    async resolve_creator(input) {
      calls.push(['resolve_creator', input]);
      return result('resolve_creator', {
        data: { resolved: true, canonical_handle: 'approved.creator', private_value: 'must-not-escape' },
      });
    },
    async get_profile(input) {
      calls.push(['get_profile', input]);
      return result('get_profile', {
        data: { followers_count: 12345, canonical_handle: 'approved.creator' },
      });
    },
  };

  const summary = await runStagingShadowRouter({
    router,
    canonicalHandle: '@approved.creator',
    correlationId: 'ii-shadow-test',
    now: '2026-08-13T18:00:00.000Z',
  });

  assert.equal(summary.status, 'ok');
  assert.equal(summary.operation_count, 2);
  assert.equal(summary.recorded_transport_attempts, 2);
  assert.deepEqual(calls.map(([operation]) => operation), ['resolve_creator', 'get_profile']);
  assert.equal(calls[1][1].creator_key, 'shadow:approved.creator');
  const encoded = JSON.stringify(summary);
  assert.equal(encoded.includes('approved.creator'), false);
  assert.equal(encoded.includes('12345'), false);
  assert.equal(encoded.includes('private_value'), false);
  assert.deepEqual(summary.provider_order, ['meta-graph']);
});

test('shadow router records unavailable resolution without inventing a profile request', async () => {
  const calls = [];
  const router = {
    providerOrder: ['meta-graph'],
    async resolve_creator(input) {
      calls.push(input);
      return result('resolve_creator', {
        status: 'unavailable',
        data: null,
        limitations: ['permission_gap'],
      });
    },
    async get_profile() {
      throw new Error('get_profile must not run');
    },
  };

  const summary = await runStagingShadowRouter({
    router,
    canonicalHandle: 'approved.creator',
    correlationId: 'ii-shadow-test',
  });

  assert.equal(summary.status, 'unavailable');
  assert.equal(summary.operation_count, 1);
  assert.equal(summary.recorded_transport_attempts, 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(summary.operations[0].limitations, ['permission_gap']);
});

test('shadow router records at most one safe retry for correlated audit bounds', async () => {
  const router = {
    providerOrder: ['meta-graph'],
    async resolve_creator() {
      return result('resolve_creator', {
        status: 'unavailable',
        data: null,
        limitations: ['timeout'],
        attempts: [{ provider: 'meta-graph', status: 'gap', classification: 'retry_exhausted', retry_count: 1 }],
      });
    },
    async get_profile() {
      throw new Error('get_profile must not run');
    },
  };

  const summary = await runStagingShadowRouter({
    router,
    canonicalHandle: 'approved.creator',
    correlationId: 'ii-shadow-retry-test',
  });

  assert.equal(summary.operation_count, 1);
  assert.equal(summary.recorded_transport_attempts, 2);
});

test('shadow runner rejects an injected fallback provider', async () => {
  const router = {
    providerOrder: ['meta-graph', 'instagrapi'],
    async resolve_creator() {},
    async get_profile() {},
  };
  await assert.rejects(
    () => runStagingShadowRouter({ router, canonicalHandle: 'approved.creator' }),
    /only the Meta official provider/,
  );
});

test('redaction preserves only transport provenance needed for evidence', () => {
  const summary = redactProviderResult(result('get_profile', {
    data: { followers_count: 5, secret: 'never-report' },
    credential_ref: 'ig_analytics_001',
    creator_key: 'creator:approved',
    canonical_handle: 'approved.creator',
    provider_specific_evidence: {
      adapter_version: 'token-vault-meta-graph-v1',
      source_ref: 'meta-graph:get_profile:shadow:approved.creator',
      endpoint_family: 'instagram-graph-read-only',
      fields: ['username'],
      correlation_id: 'ii-shadow-test',
    },
  }));
  const encoded = JSON.stringify(summary);
  assert.equal(encoded.includes('never-report'), false);
  assert.equal(encoded.includes('ig_analytics_001'), false);
  assert.equal(encoded.includes('approved.creator'), false);
  assert.equal(encoded.includes('creator:approved'), false);
  assert.equal(encoded.includes('source_ref'), false);
  assert.equal(encoded.includes('shadow:'), false);
  assert.equal(summary.provider, 'meta-graph');
  assert.equal(summary.provider_specific_evidence.correlation_id, 'ii-shadow-test');
});
