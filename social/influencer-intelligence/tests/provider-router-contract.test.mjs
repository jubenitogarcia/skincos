import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  createInstagrapiProvider,
} from '../providers/instagrapi-adapter.mjs';
import {
  createMetaGraphProvider,
} from '../providers/meta-graph-adapter.mjs';
import {
  PROVIDER_OPERATIONS,
} from '../providers/provider-contracts.mjs';
import {
  ProviderCollectionError,
  ProviderGapError,
} from '../providers/profile-provider.mjs';
import {
  createProviderRouter,
  ProviderRouterError,
} from '../provider-router.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const observedAt = '2026-08-10T14:00:00.000Z';
const retrievedAt = '2026-08-10T14:00:02.000Z';
const baseRequest = {
  creatorKey: 'creator:synthetic-001',
  handle: '@Synthetic.Creator',
  observedAt,
  retrievedAt,
};

function requestFor(operation) {
  if (operation === 'resolve_creator') {
    return { handle: baseRequest.handle, observedAt, retrievedAt };
  }
  if (operation === 'get_media_metrics') {
    return { ...baseRequest, mediaKeys: ['media:synthetic-001'] };
  }
  return { ...baseRequest };
}

function candidateFor(operation) {
  const data = {
    resolve_creator: {
      resolved: true,
      canonical_handle: 'synthetic.creator',
      match_type: 'canonical_handle',
      confidence: 0.99,
    },
    get_profile: {
      canonical_handle: 'synthetic.creator',
      followers_count: 12000,
      media_count: 42,
      is_private: false,
      is_verified: false,
    },
    get_recent_media: [{
      media_key: 'media:synthetic-001',
      media_kind: 'image',
      published_at: retrievedAt,
      permalink_ref: 'meta-graph:media:synthetic-001',
    }],
    get_media_metrics: [{
      media_key: 'media:synthetic-001',
      likes_count: 10,
      comments_count: 2,
      views_count: 120,
      engagement_rate: 0.1,
    }],
    get_comments_sample: [{
      topic_key: 'product',
      language_code: 'pt',
      sentiment_label: 'positive',
      safety_label: 'safe',
      comment_count: 4,
      sample_size: 4,
      spam_ratio: 0,
      sentiment_score: 0.8,
      model_version: 'comments-v1',
    }],
    get_profile_metrics: {
      followers_count: 12000,
      media_count: 42,
      average_likes: 10,
      average_comments: 2,
      engagement_rate: 0.1,
      posting_frequency: 0.5,
    },
  }[operation];
  return {
    data,
    data_classification: operation === 'get_comments_sample' ? 'derived' : 'observed',
    freshness: { max_age_seconds: 3600 },
    limitations: [],
    provider_specific_evidence: {
      adapter_version: 'fixture-adapter-v1',
      source_ref: `fixture:${operation}:synthetic-001`,
      fields: ['synthetic_projection'],
      endpoint_family: 'read-only-analytics',
    },
  };
}

test('router executes all six typed operations with bounded evidence envelopes', async () => {
  const calls = [];
  const meta = createMetaGraphProvider({
    operations: Object.fromEntries(PROVIDER_OPERATIONS.map((operation) => [
      operation,
      async (request, context) => {
        calls.push({ operation, request, context });
        return candidateFor(operation);
      },
    ])),
  });
  const router = createProviderRouter({ providers: { 'meta-graph': meta } });

  for (const operation of PROVIDER_OPERATIONS) {
    const result = await router[operation](requestFor(operation));
    assert.equal(result.status, 'ok');
    assert.equal(result.provider, 'meta-graph');
    assert.equal(result.operation, operation);
    assert.equal(result.retrieved_at, retrievedAt);
    assert.ok(['observed', 'derived', 'inferred'].includes(result.data_classification));
    assert.ok(['fresh', 'stale', 'unknown'].includes(result.freshness.status));
    assert.ok(Array.isArray(result.limitations));
    assert.equal(result.provider_specific_evidence.provider, 'meta-graph');
    assert.equal(result.provider_specific_evidence.operation, operation);
    assert.equal(result.provider_specific_evidence.adapter_version, 'fixture-adapter-v1');
    assert.equal(result.attempts.length, 1);
    assert.equal(result.attempts[0].status, 'ok');
  }

  assert.equal(calls.length, PROVIDER_OPERATIONS.length);
  assert.equal(calls[0].context.signal instanceof AbortSignal, true);
  assert.deepEqual(calls[0].request.requested_fields, ['username']);
  assert.equal('access_token' in calls[0].request, false);
});

test('Meta is attempted before the existing private provider and only explicit gaps fall back', async () => {
  const calls = [];
  const meta = createMetaGraphProvider({
    operations: {
      get_recent_media: async () => {
        calls.push('meta-graph');
        throw new ProviderGapError('coverage_gap');
      },
    },
  });
  const instagrapi = createInstagrapiProvider({
    operations: {
      get_recent_media: async () => {
        calls.push('instagrapi');
        return candidateFor('get_recent_media');
      },
    },
  });
  const router = createProviderRouter({ providers: { 'meta-graph': meta, instagrapi } });

  const result = await router.get_recent_media(requestFor('get_recent_media'));
  assert.equal(result.provider, 'instagrapi');
  assert.deepEqual(calls, ['meta-graph', 'instagrapi']);
  assert.deepEqual(result.attempts.map(({ provider, status, classification }) => ({
    provider,
    status,
    classification,
  })), [
    { provider: 'meta-graph', status: 'gap', classification: 'coverage_gap' },
    { provider: 'instagrapi', status: 'ok', classification: undefined },
  ]);
});

test('timeout is safely retried once and returns the provider result without inventing data', async () => {
  let calls = 0;
  const sleeps = [];
  const meta = createMetaGraphProvider({
    operations: {
      get_profile: async (_request, context) => {
        calls += 1;
        assert.equal(context.signal.aborted, false);
        if (calls === 1) {
          const error = new Error('synthetic timeout');
          error.code = 'timeout';
          throw error;
        }
        return candidateFor('get_profile');
      },
    },
  });
  const router = createProviderRouter({
    providers: { 'meta-graph': meta },
    timeoutMs: 50,
    retryPolicy: { maxAttempts: 2, baseDelayMs: 0 },
    sleep: async (delay) => sleeps.push(delay),
  });

  const result = await router.get_profile(baseRequest);
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [0]);
  assert.equal(result.data.followers_count, 12000);
  assert.equal(result.attempts[0].retry_count, 1);
});

test('exhausted transient retries become an explicit gap classification', async () => {
  const meta = createMetaGraphProvider({
    operations: {
      get_profile: async () => {
        const error = new Error('synthetic timeout');
        error.code = 'timeout';
        throw error;
      },
    },
  });
  const router = createProviderRouter({
    providers: { 'meta-graph': meta },
    timeoutMs: 50,
    retryPolicy: { maxAttempts: 2, baseDelayMs: 0 },
    sleep: async () => {},
  });

  const result = await router.get_profile(baseRequest);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.data, null);
  assert.equal(result.attempts[0].classification, 'retry_exhausted');
  assert.equal(result.attempts[0].retry_count, 1);
});

test('the router aborts a hung provider call at the configured timeout', async () => {
  let aborted = false;
  const meta = createMetaGraphProvider({
    operations: {
      get_profile: async (_request, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborted = true;
          const error = new Error('aborted by router');
          error.code = 'timeout';
          reject(error);
        }, { once: true });
      }),
    },
  });
  const router = createProviderRouter({
    providers: { 'meta-graph': meta },
    timeoutMs: 5,
    retryPolicy: { maxAttempts: 1 },
  });

  const result = await router.get_profile(baseRequest);
  assert.equal(aborted, true);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.data, null);
  assert.equal(result.attempts[0].classification, 'timeout');
});

test('transient failures open a per-provider/per-operation circuit and skip the open provider', async () => {
  let metaCalls = 0;
  const meta = createMetaGraphProvider({
    operations: {
      get_comments_sample: async () => {
        metaCalls += 1;
        throw new ProviderCollectionError('transport_error');
      },
    },
  });
  const instagrapi = createInstagrapiProvider({
    operations: {
      get_comments_sample: async () => candidateFor('get_comments_sample'),
    },
  });
  const router = createProviderRouter({
    providers: { 'meta-graph': meta, instagrapi },
    circuitBreaker: { failureThreshold: 1, resetAfterMs: 30000 },
    retryPolicy: { maxAttempts: 1 },
  });

  const first = await router.get_comments_sample(baseRequest);
  const second = await router.get_comments_sample(baseRequest);
  assert.equal(first.provider, 'instagrapi');
  assert.equal(second.provider, 'instagrapi');
  assert.equal(metaCalls, 1);
  assert.equal(second.attempts[0].classification, 'circuit_open');
  assert.equal(router.getCircuitState()['meta-graph:get_comments_sample'].failures, 1);
});

test('unsupported operation coverage remains unavailable and never fabricates metric values', async () => {
  const meta = createMetaGraphProvider({ readProfile: async () => ({
    handle: 'synthetic.creator',
    followersCount: 12000,
    mediaCount: 42,
  }) });
  const instagrapi = createInstagrapiProvider({ readProfile: async () => ({}) });
  const router = createProviderRouter({ providers: { 'meta-graph': meta, instagrapi } });

  const result = await router.get_profile_metrics(baseRequest);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.provider, null);
  assert.equal(result.data, null);
  assert.ok(result.limitations.includes('coverage_gap'));
  assert.equal(result.attempts.every(({ status }) => status === 'gap'), true);
});

test('the router keeps the pre-existing collect-only adapter boundary compatible', async () => {
  let legacyContext;
  const legacyMeta = {
    id: 'meta-graph',
    officialFirst: true,
    capabilities: ['profile'],
    collect: async (_input, context) => {
      legacyContext = context;
      return {
      creatorKey: 'creator:synthetic-001',
      handle: 'synthetic.creator',
      provider: 'meta-graph',
      observedAt,
      evidenceState: 'observed',
      provenance: {
        provider: 'meta-graph',
        sourceRef: 'meta-graph:legacy:creator:synthetic-001',
      },
      observations: [
        { key: 'followers_count', value: 12000 },
        { key: 'media_count', value: 42 },
      ],
      };
    },
  };
  const router = createProviderRouter({ providers: { 'meta-graph': legacyMeta } });

  const result = await router.get_profile(baseRequest);
  assert.equal(result.status, 'ok');
  assert.equal(result.provider, 'meta-graph');
  assert.equal(result.data.followers_count, 12000);
  assert.equal(result.data.media_count, 42);
  assert.equal(legacyContext.attempt, 1);
  assert.equal(legacyContext.signal instanceof AbortSignal, true);
});

test('inferred provider data requires model-version evidence before acceptance', async () => {
  const meta = createMetaGraphProvider({
    operations: {
      get_profile: async () => ({
        ...candidateFor('get_profile'),
        data_classification: 'inferred',
      }),
    },
  });
  const router = createProviderRouter({ providers: { 'meta-graph': meta } });

  await assert.rejects(
    router.get_profile(baseRequest),
    (error) => error instanceof ProviderRouterError && error.reasonCode === 'invalid_response',
  );

  const withModel = createMetaGraphProvider({
    operations: {
      get_profile: async () => ({
        ...candidateFor('get_profile'),
        data_classification: 'inferred',
        provider_specific_evidence: {
          ...candidateFor('get_profile').provider_specific_evidence,
          model_version: 'profile-inference/v1',
        },
      }),
    },
  });
  const validRouter = createProviderRouter({ providers: { 'meta-graph': withModel } });
  const result = await validRouter.get_profile(baseRequest);
  assert.equal(result.data_classification, 'inferred');
  assert.equal(result.provider_specific_evidence.model_version, 'profile-inference/v1');
});

test('future external providers require explicit opt-in and still use the same contract', async () => {
  const meta = createMetaGraphProvider({
    operations: {
      get_profile: async () => {
        throw new ProviderGapError('coverage_gap');
      },
    },
  });
  const future = {
    id: 'future-provider',
    officialFirst: false,
    external: true,
    capabilities: ['get_profile'],
    get_profile: async () => candidateFor('get_profile'),
  };

  assert.throws(() => createProviderRouter({
    providers: { 'meta-graph': meta, 'future-provider': future },
    providerOrder: ['meta-graph', 'future-provider'],
  }), (error) => error instanceof ProviderRouterError && error.reasonCode === 'unknown_provider');

  const router = createProviderRouter({
    providers: { 'meta-graph': meta, 'future-provider': future },
    providerOrder: ['meta-graph', 'future-provider'],
    externalProviderConfig: { enabled: true, allowlist: ['future-provider'] },
  });
  const result = await router.get_profile(baseRequest);
  assert.equal(result.provider, 'future-provider');
  assert.equal(result.data.followers_count, 12000);
});

test('credential-like request fields and provider writes are rejected at the boundary', async () => {
  const meta = createMetaGraphProvider({ readProfile: async () => ({}) });
  const router = createProviderRouter({ providers: { 'meta-graph': meta } });
  await assert.rejects(
    router.get_profile({ ...baseRequest, access_token: 'synthetic-secret' }),
    (error) => error instanceof ProviderRouterError && error.reasonCode === 'policy_block',
  );
  for (const operation of ['follow', 'like', 'send_dm', 'post']) {
    assert.equal(typeof router[operation], 'undefined');
  }
});

test('provider implementation remains transport-injected and contains no network or scraper dependency', () => {
  const providerFiles = [
    '../provider-router.mjs',
    '../providers/provider-contracts.mjs',
    '../providers/operation-provider.mjs',
    '../providers/profile-provider.mjs',
    '../providers/meta-graph-adapter.mjs',
    '../providers/instagrapi-adapter.mjs',
  ].map((relativePath) => fs.readFileSync(path.join(here, relativePath), 'utf8')).join('\n');
  assert.doesNotMatch(providerFiles, /\bfetch\s*\(/i);
  assert.doesNotMatch(providerFiles, /from\s+['"]node:(?:http|https|net|tls)['"]/i);
  assert.doesNotMatch(providerFiles, /InstagramModuleSimulator|instaloader/i);
});
