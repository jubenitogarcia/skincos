import assert from 'node:assert/strict';
import test from 'node:test';

import { createProviderRouter, ProviderRouterError } from '../provider-router.mjs';
import { createMetaGraphProvider } from '../providers/meta-graph-adapter.mjs';
import { createTokenVaultMetaGraphOperations } from '../transports/token-vault-meta-graph.mjs';
import { createInfluencerIntelligenceProviderRouter } from '../provider-runtime.mjs';

const observedAt = '2026-08-12T10:00:00.000Z';
const retrievedAt = '2026-08-12T10:00:01.000Z';
const API_TOKEN = 'vault-api-token-never-in-result';
const CREDENTIAL_REF = 'ig_analytics_001';

function candidate() {
  return {
    operation: 'get_profile',
    provider: 'meta-graph',
    data: {
      canonical_handle: 'synthetic.creator',
      followers_count: 1000,
      media_count: 10,
    },
    observed_at: observedAt,
    retrieved_at: retrievedAt,
    data_classification: 'observed',
    freshness: { max_age_seconds: 3600 },
    limitations: [],
    provider_specific_evidence: {
      adapter_version: 'token-vault-meta-graph-v1',
      source_ref: 'meta-graph:get_profile',
      fields: ['username', 'followers_count', 'media_count'],
      endpoint_family: 'instagram-graph-read-only',
    },
  };
}

function input() {
  return {
    creatorKey: 'creator:synthetic-001',
    handle: 'synthetic.creator',
    observedAt,
    retrievedAt,
  };
}

test('Token Vault transport sends only the internal credential reference and keeps its API token out of results', async () => {
  let request;
  const operations = createTokenVaultMetaGraphOperations({
    baseUrl: 'https://api-staging.skincos.com.br/internal/token-vault',
    apiToken: API_TOKEN,
    credentialRef: CREDENTIAL_REF,
    fetchImpl: async (url, init) => {
      request = { url: String(url), init, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({
        ok: true,
        result: candidate(),
      }), { status: 200 });
    },
  });
  const meta = createMetaGraphProvider({ operations });
  const router = createProviderRouter({ providers: { 'meta-graph': meta } });
  const result = await router.get_profile(input());

  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.headers.authorization, `Bearer ${API_TOKEN}`);
  assert.equal(request.body.credential_ref, CREDENTIAL_REF);
  assert.equal('token' in result, false);
  assert.equal(JSON.stringify(result).includes(API_TOKEN), false);
  assert.equal(result.provider, 'meta-graph');
  assert.equal(result.data.followers_count, 1000);
});

test('transport rejects SSRF-prone Token Vault endpoints before a request is made', () => {
  assert.throws(() => createTokenVaultMetaGraphOperations({
    baseUrl: 'https://evil.example/internal/token-vault',
    apiToken: API_TOKEN,
    credentialRef: CREDENTIAL_REF,
    fetchImpl: async () => new Response('{}'),
  }), /approved HTTPS endpoint/);
  assert.throws(() => createTokenVaultMetaGraphOperations({
    baseUrl: 'http://api-staging.skincos.com.br/internal/token-vault',
    apiToken: API_TOKEN,
    credentialRef: CREDENTIAL_REF,
    fetchImpl: async () => new Response('{}'),
  }), /approved HTTPS endpoint/);
});

test('router falls back to the existing instagrapi operation set only after an official coverage gap', async () => {
  const calls = [];
  const router = createInfluencerIntelligenceProviderRouter({
    tokenVaultBaseUrl: 'https://api-staging.skincos.com.br/internal/token-vault',
    tokenVaultApiToken: API_TOKEN,
    tokenVaultCredentialRef: CREDENTIAL_REF,
    fetchImpl: async () => {
      calls.push('meta-graph');
      return new Response(JSON.stringify({ ok: false, error: 'coverage_gap' }), { status: 403 });
    },
    instagrapiOperations: {
      readOnly: true,
      writeActions: false,
      get_profile: async () => {
        calls.push('instagrapi');
        return {
          data: {
            canonical_handle: 'synthetic.creator',
            followers_count: 90,
            media_count: 4,
          },
          observed_at: observedAt,
          retrieved_at: retrievedAt,
          provider_specific_evidence: {
            adapter_version: 'existing-instagram-instagrapi-adapter-v1',
            source_ref: 'instagrapi:get_profile',
            fields: ['followers_count', 'media_count'],
            endpoint_family: 'existing-instagram-read-only',
          },
        };
      },
    },
    retryPolicy: { maxAttempts: 1 },
  });
  const result = await router.get_profile(input());
  assert.equal(result.provider, 'instagrapi');
  assert.deepEqual(calls, ['meta-graph', 'instagrapi']);
});

test('rate-limited official transport is retryable but never fallback-eligible', async () => {
  const calls = [];
  const router = createInfluencerIntelligenceProviderRouter({
    tokenVaultBaseUrl: 'https://api-staging.skincos.com.br/internal/token-vault',
    tokenVaultApiToken: API_TOKEN,
    tokenVaultCredentialRef: CREDENTIAL_REF,
    fetchImpl: async () => {
      calls.push('meta-graph');
      return new Response(JSON.stringify({ ok: false, error: 'rate_limited' }), { status: 429 });
    },
    instagrapiOperations: {
      readOnly: true,
      writeActions: false,
      get_profile: async () => {
        calls.push('instagrapi');
        return candidate();
      },
    },
    retryPolicy: { maxAttempts: 1 },
  });
  await assert.rejects(
    router.get_profile(input()),
    (error) => error instanceof ProviderRouterError && error.reasonCode === 'rate_limited' && error.fallbackAllowed === false,
  );
  assert.deepEqual(calls, ['meta-graph']);
});

test('fallback bridge must explicitly declare read-only capability', () => {
  assert.throws(() => createInfluencerIntelligenceProviderRouter({
    tokenVaultBaseUrl: 'https://api-staging.skincos.com.br/internal/token-vault',
    tokenVaultApiToken: API_TOKEN,
    tokenVaultCredentialRef: CREDENTIAL_REF,
    fetchImpl: async () => new Response(JSON.stringify({ ok: false, error: 'coverage_gap' }), { status: 403 }),
    instagrapiOperations: { get_profile: async () => candidate() },
  }), /existing read-only bridge/);
});

test('router retries a safe read-only Token Vault timeout without inventing values', async () => {
  let calls = 0;
  const operations = createTokenVaultMetaGraphOperations({
    baseUrl: 'https://api-staging.skincos.com.br/internal/token-vault',
    apiToken: API_TOKEN,
    credentialRef: CREDENTIAL_REF,
    timeoutMs: 100,
    fetchImpl: async () => {
      calls += 1;
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    },
  });
  const meta = createMetaGraphProvider({ operations });
  const router = createProviderRouter({
    providers: { 'meta-graph': meta },
    timeoutMs: 200,
    retryPolicy: { maxAttempts: 2, baseDelayMs: 0 },
    sleep: async () => {},
  });
  const result = await router.get_profile(input());
  assert.equal(calls, 2);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.data, null);
  assert.equal(result.attempts[0].classification, 'retry_exhausted');
});

test('runtime does not register instagrapi unless an injected existing bridge is supplied', () => {
  const router = createInfluencerIntelligenceProviderRouter({
    tokenVaultBaseUrl: 'https://api-staging.skincos.com.br/internal/token-vault',
    tokenVaultApiToken: API_TOKEN,
    tokenVaultCredentialRef: CREDENTIAL_REF,
    fetchImpl: async () => new Response(JSON.stringify({ ok: false, error: 'coverage_gap' }), { status: 403 }),
  });
  assert.deepEqual(router.providerOrder, ['meta-graph']);
});

test('operation transport preserves explicit provider gaps instead of returning a synthetic profile', async () => {
  const operations = createTokenVaultMetaGraphOperations({
    baseUrl: 'https://api-staging.skincos.com.br/internal/token-vault',
    apiToken: API_TOKEN,
    credentialRef: CREDENTIAL_REF,
    fetchImpl: async () => new Response(JSON.stringify({
      ok: true,
      result: {
        status: 'unavailable',
        provider: 'meta-graph',
        operation: 'get_profile',
        data: null,
        observed_at: observedAt,
        retrieved_at: retrievedAt,
        data_classification: 'observed',
        freshness: { max_age_seconds: 3600 },
        limitations: ['coverage_gap'],
        provider_specific_evidence: {
          adapter_version: 'token-vault-meta-graph-v1',
          source_ref: 'meta-graph:get_profile',
          fields: ['username'],
          endpoint_family: 'instagram-graph-read-only',
        },
      },
    }), { status: 200 }),
  });
  const meta = createMetaGraphProvider({ operations });
  const router = createProviderRouter({ providers: { 'meta-graph': meta } });
  const result = await router.get_profile(input());
  assert.equal(result.status, 'unavailable');
  assert.equal(result.data, null);
  assert.equal(result.limitations.includes('coverage_gap'), true);
  assert.equal(result.provider, null);
});
