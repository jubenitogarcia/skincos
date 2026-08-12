import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  MCP_READONLY_LIMITS,
  MCP_READONLY_TOOLS,
  __testing,
  createFixedWindowRateLimiter,
  createInfluencerIntelligenceMcpGateway,
} from '../mcp-readonly.mjs';

const AUTH = Object.freeze({
  authenticated: true,
  grants: ['module.influencer-intelligence.access'],
  actor_scope: 'synthetic:operator',
  data_scope: 'synthetic:workspace',
});

const NOW = '2026-08-11T12:00:00.000Z';
const OBSERVED = '2026-08-11T11:55:00.000Z';

function provenance(sourceType = 'profile', provider = 'meta-graph') {
  return [{
    provider,
    source_type: sourceType,
    source_ref: `fixture:${sourceType}:creator-1`,
    observed_at: OBSERVED,
    retrieved_at: NOW,
    evidence_state: sourceType === 'score' || sourceType === 'analysis' ? 'derived' : 'observed',
  }];
}

function envelope(data, overrides = {}) {
  return {
    data_classification: 'observed',
    freshness: 'fresh',
    retrieved_at: NOW,
    data,
    confidence_score: 84,
    coverage: { available_metrics: 4, expected_metrics: 5 },
    providers: ['meta-graph'],
    provenance: provenance(overrides.source_type || 'profile'),
    limitations: [],
    ...overrides,
  };
}

function unavailableEnvelope(overrides = {}) {
  return {
    data_classification: 'unavailable',
    freshness: 'unknown',
    retrieved_at: NOW,
    data: null,
    confidence_score: 0,
    coverage: { available_metrics: 0, expected_metrics: 5 },
    providers: [],
    provenance: [],
    limitations: ['analysis_not_computed'],
    ...overrides,
  };
}

function fixtureService(overrides = {}) {
  const calls = [];
  const service = {
    calls,
    async searchCreators(input) { calls.push(['searchCreators', input]); return envelope({ creators: [{ creator_key: 'creator-1', canonical_handle: 'synthetic_creator' }] }, { source_type: 'registry', providers: [], provenance: [] }); },
    async getCreatorProfile(input) { calls.push(['getCreatorProfile', input]); return envelope({ creator_key: input.creator_key, followers_count: 100, following_count: 20, media_count: 10 }); },
    async getCreatorSnapshots(input) { calls.push(['getCreatorSnapshots', input]); return envelope({ snapshots: [{ observed_at: OBSERVED, followers_count: 100 }] }); },
    async getCreatorMedia(input) { calls.push(['getCreatorMedia', input]); return envelope({ media: [{ media_key: 'media-1', likes_count: 10, comments_count: 2 }] }, { source_type: 'media' }); },
    async getCreatorAnalytics(input) { calls.push(['getCreatorAnalytics', input]); return envelope({ creator_key: input.creator_key, engagement: { median: 0.12 } }, { source_type: 'analysis', data_classification: 'derived', confidence_score: 70 }); },
    async getCreatorScore(input) { calls.push(['getCreatorScore', input]); return envelope({ creator_key: input.creator_key, overall_score: 72, confidence_score: 65, data_coverage: 80 }, { source_type: 'score', data_classification: 'derived', confidence_score: 65 }); },
    async compareCreators(input) { calls.push(['compareCreators', input]); return envelope({ creators: input.creator_keys.map((creator_key) => ({ creator_key })) }, { source_type: 'comparison', data_classification: 'derived', confidence_score: 60 }); },
    ...overrides,
  };
  return service;
}

function createHarness({ service = fixtureService(), audit = [], ...options } = {}) {
  return {
    service,
    audit,
    gateway: createInfluencerIntelligenceMcpGateway({
      readService: service,
      audit: async (event) => audit.push(event),
      clock: () => Date.parse(NOW),
      ...options,
    }),
  };
}

async function call(gateway, name, args = {}, context = AUTH, id = 'request-1', requestBytes) {
  return gateway.handleRpc({
    rpc: { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } },
    context,
    requestBytes,
  });
}

function errorCode(response) {
  return response.error?.data?.error_code;
}

test('registers only bounded read-only tools and defers campaign fit', async () => {
  const { gateway } = createHarness();
  const response = await gateway.handleRpc({ rpc: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, context: AUTH });
  const names = response.result.tools.map((tool) => tool.name);
  assert.deepEqual(names, ['search_creators', 'get_creator_profile', 'get_creator_snapshots', 'get_creator_media', 'get_creator_analytics', 'get_creator_score', 'compare_creators']);
  assert.equal(names.includes('get_campaign_fit'), false);
  assert.ok(response.result.tools.every((tool) => tool.inputSchema.additionalProperties === false));
  assert.ok(names.every((name) => !/follow|like|dm|post|publish|scrap|sql|shell/i.test(name)));
});

test('requires authenticated context and the server-side grant', async () => {
  const { gateway, audit } = createHarness();
  const unauthenticated = await call(gateway, 'get_creator_profile', { creator_key: 'creator-1' }, null);
  assert.equal(errorCode(unauthenticated), 'AUTH_REQUIRED');
  const withoutGrant = await call(gateway, 'get_creator_profile', { creator_key: 'creator-1' }, { authenticated: true, grants: [], actor_scope: 'synthetic:operator' });
  assert.equal(errorCode(withoutGrant), 'GRANT_REQUIRED');
  assert.equal(audit.length, 2);
  assert.equal(audit.every((event) => !Object.hasOwn(event, 'authorization')), true);
});

test('rejects arbitrary arguments, provider account material and oversized requests', async () => {
  const { gateway } = createHarness();
  const extra = await call(gateway, 'get_creator_profile', { creator_key: 'creator-1', sql: 'select 1' });
  assert.equal(errorCode(extra), 'INVALID_INPUT');
  const secret = await call(gateway, 'get_creator_profile', { creator_key: 'creator-1', provider_account_id: 'real-id' });
  assert.equal(errorCode(secret), 'INVALID_INPUT');
  const oversized = await call(gateway, 'get_creator_profile', { creator_key: 'creator-1' }, AUTH, 'request-2', MCP_READONLY_LIMITS.maxRequestBytes + 1);
  assert.equal(errorCode(oversized), 'INVALID_INPUT');
});

test('measures request size when the transport does not provide byte metadata', async () => {
  const { gateway } = createHarness();
  const response = await gateway.handleRpc({
    rpc: { jsonrpc: '2.0', id: 'large', method: 'ping', params: { padding: 'x'.repeat(MCP_READONLY_LIMITS.maxRequestBytes) } },
    context: AUTH,
  });

  assert.equal(errorCode(response), 'INVALID_INPUT');
});

test('validates bounded windows, paging and comparison cardinality before the store', async () => {
  const { gateway, service } = createHarness();
  const tooLong = await call(gateway, 'get_creator_snapshots', { creator_key: 'creator-1', window: { start: '2024-01-01T00:00:00.000Z', end: NOW } });
  assert.equal(errorCode(tooLong), 'INVALID_INPUT');
  const duplicate = await call(gateway, 'compare_creators', { creator_keys: ['creator-1', 'creator-1'] });
  assert.equal(errorCode(duplicate), 'INVALID_INPUT');
  const valid = await call(gateway, 'get_creator_snapshots', { creator_key: 'creator-1', window: { start: OBSERVED, end: NOW }, page: 2, page_size: 10 });
  assert.equal(valid.result.structuredContent.data.snapshots[0].followers_count, 100);
  assert.deepEqual(service.calls.at(-1), ['getCreatorSnapshots', { creator_key: 'creator-1', window: { start: OBSERVED, end: NOW }, page: 2, page_size: 10 }]);
});

test('returns provenance, freshness, confidence and coverage without recalculating the score', async () => {
  const { gateway, service } = createHarness();
  const response = await call(gateway, 'get_creator_score', { creator_key: 'creator-1' });
  const content = response.result.structuredContent;
  assert.equal(content.contract_version, 'influencer-intelligence/mcp/v1');
  assert.equal(content.data_classification, 'derived');
  assert.equal(content.freshness, 'fresh');
  assert.equal(content.confidence_score, 65);
  assert.equal(content.data_coverage, 80);
  assert.equal(content.coverage.available_metrics, 4);
  assert.equal(content.provenance[0].source_type, 'score');
  assert.equal(service.calls[0][0], 'getCreatorScore');
  assert.equal(JSON.stringify(content).includes('weights'), false);
});

test('preserves unavailable as null and never substitutes zero metrics', async () => {
  const service = fixtureService({ async getCreatorAnalytics(input) { return unavailableEnvelope(); } });
  const { gateway } = createHarness({ service });
  const response = await call(gateway, 'get_creator_analytics', { creator_key: 'creator-1' });
  const content = response.result.structuredContent;
  assert.equal(content.data, null);
  assert.equal(content.data_classification, 'unavailable');
  assert.equal(content.confidence_score, 0);
  assert.equal(content.data_coverage, 0);
  assert.equal(content.limitations[0], 'analysis_not_computed');
});

test('rejects an unavailable envelope that claims available metrics', async () => {
  const service = fixtureService({
    async getCreatorAnalytics() {
      return unavailableEnvelope({ coverage: { available_metrics: 1, expected_metrics: 5 } });
    },
  });
  const { gateway } = createHarness({ service });
  const response = await call(gateway, 'get_creator_analytics', { creator_key: 'creator-1' });
  assert.equal(errorCode(response), 'INVALID_SERVICE_RESPONSE');
});

test('sanitizes raw payload, PII and credential-like output before returning it', async () => {
  const service = fixtureService({
    async getCreatorProfile() {
      return envelope({ creator_key: 'creator-1', followers_count: 3, email: 'person@example.test', display_name: 'Person Public', location: 'São Paulo', raw_comment_text: 'hello', nested: { access_token: 'Bearer fake-token-value' }, safe: 'kept' });
    },
  });
  const { gateway } = createHarness({ service });
  const response = await call(gateway, 'get_creator_profile', { creator_key: 'creator-1' });
  const data = response.result.structuredContent.data;
  assert.equal(data.safe, 'kept');
  assert.equal(Object.hasOwn(data, 'email'), false);
  assert.equal(Object.hasOwn(data, 'raw_comment_text'), false);
  assert.equal(Object.hasOwn(data, 'display_name'), false);
  assert.equal(Object.hasOwn(data, 'location'), false);
  assert.equal(Object.hasOwn(data.nested, 'access_token'), false);
  assert.equal(JSON.stringify(response).includes('person@example.test'), false);
  assert.equal(JSON.stringify(response).includes('fake-token-value'), false);
});

test('rate limits by opaque actor scope and emits sanitized audit events', async () => {
  const audit = [];
  const { gateway } = createHarness({ audit, rateLimiter: createFixedWindowRateLimiter({ limit: 1, clock: () => Date.parse(NOW) }) });
  const first = await call(gateway, 'get_creator_profile', { creator_key: 'creator-1' }, AUTH, 'one');
  const second = await call(gateway, 'get_creator_profile', { creator_key: 'creator-1' }, AUTH, 'two');
  assert.equal(first.error, undefined);
  assert.equal(errorCode(second), 'RATE_LIMITED');
  assert.equal(audit[1].error_code, 'RATE_LIMITED');
  assert.equal(audit.every((event) => Object.keys(event).every((key) => !/token|cookie|query|creator_key/i.test(key))), true);
});

test('times out a slow internal read and does not expose the service error', async () => {
  const service = fixtureService({ async getCreatorAnalytics() { return new Promise(() => {}); } });
  const { gateway } = createHarness({ service, timeoutMs: 20 });
  const response = await call(gateway, 'get_creator_analytics', { creator_key: 'creator-1' });
  assert.equal(errorCode(response), 'TIMEOUT');
});

test('propagates an already-aborted request without invoking an unbounded read', async () => {
  let called = false;
  const service = fixtureService({
    async getCreatorAnalytics(_input, { signal }) {
      called = true;
      return signal.aborted ? new Promise(() => {}) : envelope({ ok: true });
    },
  });
  const { gateway } = createHarness({ service });
  const signalController = new AbortController();
  signalController.abort();
  const response = await gateway.handleRpc({
    rpc: { jsonrpc: '2.0', id: 'aborted', method: 'tools/call', params: { name: 'get_creator_analytics', arguments: { creator_key: 'creator-1' } } },
    context: AUTH,
    signal: signalController.signal,
  });
  assert.equal(called, true);
  assert.equal(errorCode(response), 'TIMEOUT');
});

test('enforces the sanitized response byte limit', () => {
  assert.throws(() => __testing.assertResponseSize({ data: 'x'.repeat(MCP_READONLY_LIMITS.maxResponseBytes) }), /response exceeds the limit/);
});

test('enforces concurrency without queueing unbounded work', async () => {
  let release;
  const service = fixtureService({
    async getCreatorProfile() { return new Promise((resolve) => { release = () => resolve(envelope({ creator_key: 'creator-1' })); }); },
  });
  const { gateway } = createHarness({ service, maxConcurrentRequests: 1, timeoutMs: 1000 });
  const first = call(gateway, 'get_creator_profile', { creator_key: 'creator-1' }, AUTH, 'first');
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await call(gateway, 'get_creator_profile', { creator_key: 'creator-1' }, AUTH, 'second');
  assert.equal(errorCode(second), 'TOO_MANY_CONCURRENT_REQUESTS');
  release();
  assert.equal((await first).error, undefined);
});

test('audit failure fails closed instead of returning a successful result', async () => {
  const gateway = createInfluencerIntelligenceMcpGateway({ readService: fixtureService(), audit: async () => { throw new Error('disk unavailable'); } });
  const response = await call(gateway, 'get_creator_profile', { creator_key: 'creator-1' });
  assert.equal(errorCode(response), 'AUDIT_UNAVAILABLE');
});

test('MCP adapter has no transport, provider, shell or write surface', async () => {
  const source = await readFile(new URL('../mcp-readonly.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:fetch|spawn|exec|execFile|createServer|listen)\s*\(/i);
  assert.doesNotMatch(source, /\b(?:execute_workflow|follow_creator|like_creator|send_dm|publish_post|scrape_profile|arbitrary_sql)\b/i);
  assert.doesNotMatch(source, /from\s+['"](?:node:)?(?:http|https|net|tls|child_process|pg)['"]/i);
  assert.match(source, /additionalProperties: false/);
  assert.match(source, /AUDIT_UNAVAILABLE/);
});
