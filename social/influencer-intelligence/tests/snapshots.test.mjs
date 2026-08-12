import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  MEDIA_METRIC_FIELDS,
  SNAPSHOT_OPERATION_CONTRACT_VERSION,
  SNAPSHOT_RUN_LEASE_SECONDS,
  createSnapshotOperations,
} from '../snapshots.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'snapshots.mjs'), 'utf8');
const observedAt = '2026-08-11T14:00:00.000Z';
const retrievedAt = '2026-08-11T14:00:05.000Z';
const input = {
  creatorKey: 'creator:synthetic-001',
  identityKey: 'identity:synthetic-001',
  canonicalHandle: 'synthetic.creator',
  observedAt,
  retrievedAt,
  bucketSeconds: 3600,
  mode: 'shadow',
};

function evidence(operation, provider = 'meta-graph') {
  const safeOperation = operation.replace(/_/g, '-');
  return {
    adapter_version: 'fixture-adapter-v1',
    source_ref: `${provider}:${safeOperation}:fixture`,
    fields: ['synthetic'],
  };
}

function okResult(operation, data, {
  provider = 'meta-graph',
  attempts = [{ provider, operation, status: 'ok', retry_count: 0 }],
  limitations = [],
  observed = observedAt,
  retrieved = retrievedAt,
} = {}) {
  return {
    contract_version: 'influencer-intelligence/provider-operation/v1',
    operation,
    status: 'ok',
    provider,
    retrieved_at: retrieved,
    data_classification: 'observed',
    freshness: {
      status: 'fresh',
      observed_at: observed,
      retrieved_at: retrieved,
      age_seconds: 5,
      max_age_seconds: 86400,
    },
    limitations,
    provider_specific_evidence: evidence(operation, provider),
    data,
    attempts,
  };
}

function unavailableResult(operation, attempts, limitations = attempts.map((item) => item.classification)) {
  return {
    contract_version: 'influencer-intelligence/provider-operation/v1',
    operation,
    status: 'unavailable',
    provider: null,
    retrieved_at: retrievedAt,
    data_classification: 'observed',
    freshness: {
      status: 'unknown',
      observed_at: null,
      retrieved_at: retrievedAt,
      age_seconds: null,
      max_age_seconds: 86400,
    },
    limitations,
    provider_specific_evidence: {
      adapter_version: 'provider-router/v1',
      source_ref: `router:${operation.replace(/_/g, '-')}:unavailable`,
    },
    data: null,
    attempts,
  };
}

function createRepository() {
  const state = {
    runs: new Map(),
    evidence: new Map(),
    profiles: new Map(),
    mediaIdentity: new Map(),
    mediaSnapshots: new Map(),
    updates: [],
    calls: {
      profile: 0,
      recent: 0,
      metrics: 0,
    },
  };
  return {
    state,
    async createCollectorRun(row) {
      const existing = state.runs.get(row.idempotencyKey);
      if (existing) return { inserted: false, row: existing };
      const stored = { ...row, attemptToken: row.leaseKey, status: row.status };
      state.runs.set(row.idempotencyKey, stored);
      return { inserted: true, row: stored };
    },
    async updateCollectorRun(row) {
      const existing = [...state.runs.values()].find((item) => item.runKey === row.runKey);
      assert.ok(existing, 'collector run must exist before finalization');
      assert.equal(existing.attemptToken, row.leaseKey, 'stale collector attempt must not finalize a reclaimed run');
      Object.assign(existing, row);
      state.updates.push({ ...row });
      return existing;
    },
    async reclaimStaleCollectorRun(row) {
      const existing = state.runs.get(row.idempotencyKey);
      if (!existing) return { reclaimed: false, row: null };
      const staleRunning = existing.status === 'running' && Date.parse(existing.startedAt) <= Date.parse(row.staleBefore);
      const retryableFailure = existing.status === 'failed' && (existing.attemptCount || 1) < row.maxAttempts;
      if (!staleRunning && !retryableFailure) return { reclaimed: false, row: null };
      Object.assign(existing, {
        status: 'running',
        attemptToken: row.leaseKey,
        startedAt: row.startedAt,
        finishedAt: null,
        attemptCount: (existing.attemptCount || 1) + 1,
      });
      return { reclaimed: true, row: existing };
    },
    async recordCollectorEvidence(row) {
      const run = [...state.runs.values()].find((item) => item.runKey === row.runKey);
      assert.equal(run?.attemptToken, row.leaseKey, 'stale collector attempt must not write evidence');
      const existing = state.evidence.get(row.ingestKey);
      if (existing) return { inserted: false, row: existing };
      const stored = { ...row };
      state.evidence.set(row.ingestKey, stored);
      return { inserted: true, row: { evidence_key: row.evidenceKey, ...stored } };
    },
    async recordProfileSnapshot(row) {
      const run = [...state.runs.values()].find((item) => item.runKey === row.runKey);
      assert.equal(run?.attemptToken, row.leaseKey, 'stale collector attempt must not write profile snapshots');
      const existing = state.profiles.get(row.ingestKey);
      if (existing) return { inserted: false, row: existing };
      state.profiles.set(row.ingestKey, { ...row });
      return { inserted: true, row: { snapshot_key: row.snapshotKey, ...row } };
    },
    async upsertMedia(row) {
      const run = [...state.runs.values()].find((item) => item.runKey === row.runKey);
      assert.equal(run?.attemptToken, row.leaseKey, 'stale collector attempt must not rewrite media identity');
      state.mediaIdentity.set(row.mediaKey, { ...row });
      return { ...row };
    },
    async recordMediaSnapshot(row) {
      const run = [...state.runs.values()].find((item) => item.runKey === row.runKey);
      assert.equal(run?.attemptToken, row.leaseKey, 'stale collector attempt must not write media snapshots');
      const existing = state.mediaSnapshots.get(row.ingestKey);
      if (existing) return { inserted: false, row: existing };
      state.mediaSnapshots.set(row.ingestKey, { ...row });
      return { inserted: true, row: { snapshot_key: row.snapshotKey, ...row } };
    },
  };
}

function createRouter({ profile, recent, metrics }) {
  const calls = { profile: 0, recent: 0, metrics: 0 };
  const invoke = (value, key) => {
    calls[key] += 1;
    return typeof value === 'function' ? value(calls[key]) : value;
  };
  return {
    calls,
    get_profile: async () => invoke(profile, 'profile'),
    get_recent_media: async () => invoke(recent, 'recent'),
    get_media_metrics: async () => invoke(metrics, 'metrics'),
  };
}

function service(router, repository = createRepository()) {
  return {
    operations: createSnapshotOperations({
      router,
      repository,
      clock: () => '2026-08-11T14:30:00.000Z',
    }),
    repository,
  };
}

test('first profile collection persists observed metrics, freshness and provenance', async () => {
  const router = createRouter({
    profile: okResult('get_profile', {
      canonical_handle: 'synthetic.creator',
      followers_count: 12000,
      following_count: 0,
      media_count: 42,
      is_private: false,
      is_verified: true,
    }),
  });
  const { operations, repository } = service(router);
  const result = await operations.snapshot_creator(input);

  assert.equal(result.contractVersion, SNAPSHOT_OPERATION_CONTRACT_VERSION);
  assert.equal(result.status, 'completed');
  assert.equal(result.evidenceState, 'observed');
  assert.deepEqual(result.profile, {
    canonicalHandle: 'synthetic.creator',
    followersCount: 12000,
    followingCount: 0,
    mediaCount: 42,
    isPrivate: false,
    isVerified: true,
  });
  assert.deepEqual(result.coverage, { available: 3, expected: 3, missing: [] });
  assert.equal(repository.state.profiles.size, 1);
  assert.equal(repository.state.profiles.values().next().value.coverageAvailable, 3);
  assert.equal(repository.state.profiles.values().next().value.coverageExpected, 3);
  assert.equal(repository.state.profiles.values().next().value.freshnessStatus, 'fresh');
  assert.equal(repository.state.runs.values().next().value.failureCount, 0);
  assert.equal(repository.state.evidence.values().next().value.evidenceState, 'observed');
});

test('repeated collection in the same time bucket is idempotent and does not call the provider again', async () => {
  const router = createRouter({
    profile: okResult('get_profile', { followers_count: 100, following_count: 10, media_count: 3 }),
  });
  const { operations, repository } = service(router);
  const first = await operations.snapshot_creator(input);
  const second = await operations.snapshot_creator({ ...input, retrievedAt: '2026-08-11T14:20:00.000Z' });

  assert.equal(first.status, 'completed');
  assert.equal(second.deduplicated, true);
  assert.equal(router.calls.profile, 1);
  assert.equal(repository.state.profiles.size, 1);
  assert.equal(repository.state.runs.size, 1);
});

test('a stale running collector is reclaimed after the bounded lease, while a live run remains deduplicated', async () => {
  const router = createRouter({
    profile: okResult('get_profile', { followers_count: 100, following_count: 10, media_count: 3 }),
  });
  const repository = createRepository();
  let now = '2026-08-11T14:30:00.000Z';
  const operations = createSnapshotOperations({ router, repository, clock: () => now });
  const first = await operations.snapshot_creator(input);
  const storedRun = repository.state.runs.values().next().value;
  storedRun.status = 'running';
  storedRun.startedAt = new Date(Date.parse(now) - ((SNAPSHOT_RUN_LEASE_SECONDS + 1) * 1000)).toISOString();
  const reclaimed = await operations.snapshot_creator({ ...input, runKey: 'run-retry', retrievedAt: '2026-08-11T14:30:05.000Z' });

  assert.equal(first.status, 'completed');
  assert.equal(reclaimed.status, 'completed');
  assert.equal(reclaimed.collectorRun.reclaimed, true);
  assert.equal(reclaimed.collectorRun.runKey, storedRun.runKey);
  assert.equal(router.calls.profile, 2);
  assert.equal(storedRun.status, 'completed');
});

test('unexpected persistence failure finalizes the collector run as failed for safe retry', async () => {
  const router = createRouter({
    profile: okResult('get_profile', { followers_count: 100, following_count: 10, media_count: 3 }),
  });
  const repository = createRepository();
  const originalRecordProfileSnapshot = repository.recordProfileSnapshot;
  let failOnce = true;
  repository.recordProfileSnapshot = async (row) => {
    if (failOnce) {
      failOnce = false;
      throw new Error('synthetic persistence failure');
    }
    return originalRecordProfileSnapshot(row);
  };
  const { operations } = service(router, repository);

  await assert.rejects(operations.snapshot_creator(input), /synthetic persistence failure/);
  const run = repository.state.runs.values().next().value;
  assert.equal(run.status, 'failed');
  assert.equal(run.failureCount, 1);

  const retry = await operations.snapshot_creator({ ...input, retrievedAt: '2026-08-11T14:30:05.000Z' });
  assert.equal(retry.status, 'completed');
  assert.equal(retry.collectorRun.reclaimed, true);
  assert.equal(run.attemptCount, 2);
  assert.equal(router.calls.profile, 2);
});

test('a superseded worker cannot persist or finalize after a stale run is reclaimed', async () => {
  let releaseOld;
  const router = createRouter({
    profile: (call) => call === 1
      ? new Promise((resolve) => { releaseOld = () => resolve(okResult('get_profile', { followers_count: 100, following_count: 10, media_count: 3 })); })
      : okResult('get_profile', { followers_count: 110, following_count: 10, media_count: 3 }),
  });
  const repository = createRepository();
  const operations = createSnapshotOperations({ router, repository, clock: () => '2026-08-11T14:30:00.000Z' });
  const oldAttempt = operations.snapshot_creator(input);
  await new Promise((resolve) => setImmediate(resolve));
  const storedRun = repository.state.runs.values().next().value;
  storedRun.status = 'running';
  storedRun.startedAt = new Date(Date.parse('2026-08-11T14:30:00.000Z') - ((SNAPSHOT_RUN_LEASE_SECONDS + 1) * 1000)).toISOString();

  const retry = await operations.snapshot_creator({ ...input, retrievedAt: '2026-08-11T14:30:05.000Z' });
  assert.equal(retry.status, 'completed');
  releaseOld();
  await assert.rejects(oldAttempt, /stale collector attempt|lease/i);
});

test('replay identity stays stable when the caller corrects handle or mode in the same bucket', async () => {
  const router = createRouter({
    profile: okResult('get_profile', { followers_count: 100, following_count: 10, media_count: 3 }),
  });
  const { operations, repository } = service(router);
  const first = await operations.snapshot_creator(input);
  const replay = await operations.snapshot_creator({
    ...input,
    canonicalHandle: 'corrected.creator',
    mode: 'active',
    retrievedAt: '2026-08-11T14:20:00.000Z',
  });

  assert.equal(first.status, 'completed');
  assert.equal(replay.deduplicated, true);
  assert.equal(router.calls.profile, 1);
  assert.equal(repository.state.runs.size, 1);
});

test('a later time bucket stores changed metrics without rewriting the first snapshot', async () => {
  const router = createRouter({
    profile: (call) => okResult('get_profile', {
      followers_count: call === 1 ? 100 : 125,
      following_count: 10,
      media_count: 3,
    }, {
      observed: call === 1 ? observedAt : '2026-08-11T15:00:00.000Z',
      retrieved: call === 1 ? retrievedAt : '2026-08-11T15:00:05.000Z',
    }),
  });
  const { operations, repository } = service(router);
  await operations.snapshot_creator(input);
  await operations.snapshot_creator({
    ...input,
    observedAt: '2026-08-11T15:00:00.000Z',
    retrievedAt: '2026-08-11T15:00:05.000Z',
  });

  assert.equal(repository.state.profiles.size, 2);
  const followers = [...repository.state.profiles.values()]
    .sort((left, right) => left.observedAt.localeCompare(right.observedAt))
    .map((row) => row.followersCount);
  assert.deepEqual(followers, [100, 125]);
});

test('controlled fallback and partial profile coverage remain explicit', async () => {
  const router = createRouter({
    profile: okResult('get_profile', {
      canonical_handle: 'fallback.creator',
      followers_count: 800,
      media_count: 8,
    }, {
      provider: 'instagrapi',
      attempts: [
        { provider: 'meta-graph', status: 'gap', classification: 'coverage_gap', retry_count: 0 },
        { provider: 'instagrapi', status: 'ok', retry_count: 0 },
      ],
    }),
  });
  const { operations, repository } = service(router);
  const result = await operations.snapshot_creator({ ...input, canonicalHandle: 'fallback.creator' });

  assert.equal(result.status, 'partial');
  assert.equal(result.provider, 'instagrapi');
  assert.deepEqual(result.coverage.missing, ['following_count']);
  assert.equal(result.profile.followingCount, null);
  assert.equal(result.failures[0].provider, 'meta-graph');
  assert.equal([...repository.state.evidence.values()].some((row) => row.provider === 'meta-graph' && row.evidenceState === 'unavailable'), true);
});

test('timeout and provider exhaustion persist failures and never fabricate profile values', async () => {
  const router = createRouter({
    profile: unavailableResult('get_profile', [
      { provider: 'meta-graph', status: 'gap', classification: 'retry_exhausted', retry_count: 1 },
      { provider: 'instagrapi', status: 'gap', classification: 'timeout', retry_count: 1 },
    ], ['retry_exhausted', 'timeout']),
  });
  const { operations, repository } = service(router);
  const result = await operations.snapshot_creator(input);

  assert.equal(result.status, 'unavailable');
  assert.equal(result.profile.followersCount, null);
  assert.equal(result.profile.followingCount, null);
  assert.equal(result.profile.mediaCount, null);
  assert.equal(repository.state.profiles.size, 2);
  assert.equal([...repository.state.profiles.values()].every((row) => row.evidenceState === 'unavailable'), true);
  assert.equal([...repository.state.profiles.values()].some((row) => row.followersCount === 0), false);
  assert.deepEqual(result.failures.map((item) => item.code), ['retry_exhausted', 'timeout']);
});

test('nonexistent profile is stored as unavailable rather than as an empty profile', async () => {
  const router = createRouter({
    profile: unavailableResult('get_profile', [
      { provider: 'meta-graph', status: 'gap', classification: 'permission_gap', retry_count: 0 },
    ], ['permission_gap']),
  });
  const { operations, repository } = service(router);
  const result = await operations.snapshot_creator(input);

  assert.equal(result.status, 'unavailable');
  assert.equal(result.coverage.available, 0);
  assert.equal(result.coverage.expected, 3);
  assert.equal([...repository.state.profiles.values()][0].normalizedMetrics, undefined);
  assert.equal([...repository.state.profiles.values()][0].followersCount, undefined);
});

test('private profile preserves observed privacy state and leaves unavailable metrics null', async () => {
  const router = createRouter({
    profile: okResult('get_profile', {
      canonical_handle: 'private.creator',
      is_private: true,
    }),
  });
  const { operations, repository } = service(router);
  const result = await operations.snapshot_creator({ ...input, canonicalHandle: 'private.creator' });

  assert.equal(result.status, 'partial');
  assert.equal(result.profile.isPrivate, true);
  assert.equal(result.profile.followersCount, null);
  assert.equal(result.profile.mediaCount, null);
  assert.equal([...repository.state.profiles.values()][0].followersCount, null);
});

test('media snapshots persist publication timestamps and every supplied metric, including explicit zero', async () => {
  const router = createRouter({
    recent: okResult('get_recent_media', [
      { media_key: 'media:001', media_kind: 'reel', published_at: '2026-08-10T12:00:00Z' },
      { media_key: 'media:002', media_kind: 'post', published_at: '2026-08-09T12:00:00Z' },
    ]),
    metrics: okResult('get_media_metrics', [
      {
        media_key: 'media:001', likes_count: 10, comments_count: 2, shares_count: 1,
        saves_count: 3, views_count: 100, reach_count: 80, impressions_count: 120,
      },
      {
        media_key: 'media:002', likes_count: 0, comments_count: 0, shares_count: 0,
        saves_count: 0, views_count: 0, reach_count: 0, impressions_count: 0,
      },
    ]),
  });
  const { operations, repository } = service(router);
  const result = await operations.snapshot_creator_media(input);

  assert.equal(result.status, 'completed');
  assert.equal(result.coverage.mediaRequested, 2);
  assert.equal(result.coverage.metricFieldsAvailable, 2 * MEDIA_METRIC_FIELDS.length);
  assert.equal(repository.state.mediaIdentity.get('media:001').publishedAt, '2026-08-10T12:00:00.000Z');
  assert.equal(repository.state.mediaSnapshots.size, 2);
  assert.equal([...repository.state.mediaSnapshots.values()][0].coverageExpected, MEDIA_METRIC_FIELDS.length);
  assert.equal([...repository.state.mediaSnapshots.values()][0].freshnessStatus, 'fresh');
  const second = result.media.find((item) => item.mediaKey === 'media:002');
  assert.equal(second.metrics.likes_count, 0);
});

test('media collection is idempotent and a later bucket records changed metrics', async () => {
  const router = createRouter({
    recent: (call) => okResult('get_recent_media', [{ media_key: 'media:001', media_kind: 'post', published_at: '2026-08-10T12:00:00Z' }], {
      observed: call === 1 ? observedAt : '2026-08-11T15:00:00.000Z',
      retrieved: call === 1 ? retrievedAt : '2026-08-11T15:00:05.000Z',
    }),
    metrics: (call) => okResult('get_media_metrics', [{
      media_key: 'media:001', likes_count: call === 1 ? 5 : 9, comments_count: 1, shares_count: 0,
      saves_count: 0, views_count: 20, reach_count: 10, impressions_count: 25,
    }], {
      observed: call === 1 ? observedAt : '2026-08-11T15:00:00.000Z',
      retrieved: call === 1 ? retrievedAt : '2026-08-11T15:00:05.000Z',
    }),
  });
  const { operations, repository } = service(router);
  await operations.snapshot_creator_media(input);
  const duplicate = await operations.snapshot_creator_media({ ...input, retrievedAt: '2026-08-11T14:20:00Z' });
  await operations.snapshot_creator_media({ ...input, observedAt: '2026-08-11T15:00:00Z', retrievedAt: '2026-08-11T15:00:05Z' });

  assert.equal(duplicate.deduplicated, true);
  assert.equal(router.calls.recent, 2);
  assert.equal(router.calls.metrics, 2);
  assert.equal(repository.state.mediaSnapshots.size, 2);
  const likes = [...repository.state.mediaSnapshots.values()]
    .sort((left, right) => left.observedAt.localeCompare(right.observedAt))
    .map((row) => row.likesCount);
  assert.deepEqual(likes, [5, 9]);
});

test('unavailable media metrics retain publication data but never turn missing counts into zero', async () => {
  const router = createRouter({
    recent: okResult('get_recent_media', [{ media_key: 'media:001', media_kind: 'reel', published_at: '2026-08-10T12:00:00Z' }]),
    metrics: unavailableResult('get_media_metrics', [
      { provider: 'meta-graph', status: 'gap', classification: 'timeout', retry_count: 1 },
      { provider: 'instagrapi', status: 'gap', classification: 'coverage_gap', retry_count: 0 },
    ], ['timeout', 'coverage_gap']),
  });
  const { operations, repository } = service(router);
  const result = await operations.snapshot_creator_media(input);

  assert.equal(result.status, 'partial');
  assert.equal(result.media[0].evidenceState, 'unavailable');
  assert.equal(result.media[0].metrics.likes_count, null);
  assert.equal(result.media[0].metrics.views_count, null);
  assert.equal(repository.state.mediaIdentity.get('media:001').publishedAt, '2026-08-10T12:00:00.000Z');
  assert.equal([...repository.state.mediaSnapshots.values()].every((row) => row.evidenceState === 'unavailable'), true);
});

test('derived or inferred provider payloads cannot be persisted as observed snapshots', async () => {
  const router = createRouter({
    profile: {
      ...okResult('get_profile', { followers_count: 100 }),
      data_classification: 'inferred',
    },
  });
  const { operations, repository } = service(router);
  const result = await operations.snapshot_creator(input);

  assert.equal(result.status, 'failed');
  assert.equal(result.error.code, 'NON_OBSERVED_SNAPSHOT_NOT_PERSISTABLE');
  assert.equal(repository.state.profiles.size, 1);
  assert.equal([...repository.state.profiles.values()][0].evidenceState, 'unavailable');
});

test('snapshot operations reject credentials and do not contain scheduling or provider transport code', async () => {
  const router = createRouter({ profile: okResult('get_profile', {}) });
  const { operations } = service(router);
  await assert.rejects(
    operations.snapshot_creator({ ...input, access_token: 'synthetic-secret' }),
    (error) => error.code === 'POLICY_BLOCK',
  );
  assert.doesNotMatch(source, /setInterval|setTimeout|\bn8n\b/i);
  assert.doesNotMatch(source, /\bfetch\s*\(|node:(?:http|https|net|tls)/i);
});
