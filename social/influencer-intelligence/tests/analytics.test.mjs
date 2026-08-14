import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANALYTICS_ALGORITHM_VERSION,
  computeInfluencerAnalytics,
} from '../analytics.mjs';
import { GOLDEN_FIXTURES } from './fixtures/analytics-golden-fixtures.mjs';

function analyze(fixture) {
  return computeInfluencerAnalytics(structuredClone(fixture));
}

function assertNoNonFinite(value, path = 'result') {
  if (typeof value === 'number') {
    assert.equal(Number.isFinite(value), true, `${path} must be finite`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoNonFinite(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) assertNoNonFinite(child, `${path}.${key}`);
  }
}

test('small stable creator produces complete normalized profile and cadence metrics', () => {
  const result = analyze(GOLDEN_FIXTURES.smallStable);

  assert.equal(result.evidenceState, 'derived');
  assert.equal(result.algorithmVersion, ANALYTICS_ALGORITHM_VERSION);
  assert.equal(result.profileGrowth.followers.absoluteDelta.value, 20);
  assert.equal(result.profileGrowth.followers.relativeGrowthRate.value, 0.02);
  assert.equal(result.postingCadence.publicationCount, 5);
  assert.equal(result.postingCadence.postingInterval.median, 3);
  assert.equal(result.engagement.engagementRate.evidenceState, 'derived');
  assert.equal(result.engagement.engagementRate.count, 5);
  assert.equal(result.engagement.commentLikeRatio.median, 2 / 20);
  assert.equal(result.engagement.medianViews.value, null);
  assert.equal(result.followerTierBenchmark.status, 'unavailable');
  assert.equal(result.window.start, '2026-01-01T00:00:00.000Z');
  assert.equal(result.window.end, '2026-01-15T00:00:00.000Z');
  assertNoNonFinite(result);
});

test('history counts metric-bearing media identities once and excludes follower-only context', () => {
  const fixture = {
    creatorKey: 'creator-history-dedup',
    computedAt: GOLDEN_FIXTURES.smallStable.computedAt,
    profileSnapshots: [],
    mediaSnapshots: Array.from({ length: 4 }, (_, index) => ({
      snapshotKey: `media-snapshot-history-${index + 1}`,
      mediaKey: 'media-history-repeat',
      provider: 'meta-graph',
      observedAt: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      publishedAt: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      likesCount: index === 3 ? 12 : null,
      commentsCount: null,
      followersCount: 1000,
    })),
  };

  const result = analyze(fixture);

  assert.equal(result.history.mediaSnapshotCount, 4);
  assert.equal(result.history.mediaMetricObservationCount, 1);
  assert.equal(result.postingCadence.publicationCount, 1);
  assertNoNonFinite(result);
});

test('follower-only media snapshots do not establish media performance history', () => {
  const fixture = {
    creatorKey: 'creator-history-follower-only',
    computedAt: GOLDEN_FIXTURES.smallStable.computedAt,
    profileSnapshots: [],
    mediaSnapshots: Array.from({ length: 4 }, (_, index) => ({
      snapshotKey: `media-snapshot-follower-only-${index + 1}`,
      mediaKey: `media-follower-only-${index + 1}`,
      provider: 'meta-graph',
      observedAt: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      publishedAt: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      likesCount: null,
      commentsCount: null,
      followersCount: 1000,
    })),
  };

  const result = analyze(fixture);

  assert.equal(result.history.mediaMetricObservationCount, 0);
  assert.equal(result.engagement.evidenceState, 'unavailable');
  assertNoNonFinite(result);
});

test('large creator keeps quality ratios normalized instead of treating follower scale as quality', () => {
  const result = analyze(GOLDEN_FIXTURES.largeCreator);

  assert.equal(result.profileGrowth.followers.first.value, 1000000);
  assert.equal(result.profileGrowth.followers.absoluteDelta.value, 10000);
  assert.ok(result.likes.mean > analyze(GOLDEN_FIXTURES.smallStable).likes.mean);
  assert.ok(Math.abs(result.engagement.engagementRate.median - 0.0208) < 0.002);
  assert.equal(result.profileGrowth.followers.relativeGrowthRate.value, 0.01);
  assertNoNonFinite(result);
});

test('viral post is visible as an outlier while robust summaries retain the regular series', () => {
  const result = analyze(GOLDEN_FIXTURES.viralPost);

  assert.equal(result.likes.median, 15);
  assert.ok(result.likes.mean > result.likes.trimmedMean);
  assert.ok(result.likes.outlierRatio > 0);
  assert.ok(result.likes.viralOutlierRatio > 0);
  assert.ok(result.outliers.likes.viralOutlierRatio > 0);
  assert.ok(result.videoPerformance.views.median > 0);
  assertNoNonFinite(result);
});

test('follower spike is reported as a growth-pattern anomaly, never as a fake-follower fact', () => {
  const result = analyze(GOLDEN_FIXTURES.followerSpike);

  assert.equal(result.growthAnomalies.evidenceState, 'derived');
  assert.ok(result.growthAnomalies.anomalyRatio > 0);
  assert.ok(result.growthAnomalies.anomalies.some((item) => item.direction === 'spike'));
  assert.ok(result.growthAnomalies.anomalies.every((item) => item.interpretation === 'growth_pattern_anomaly'));
  assert.equal(JSON.stringify(result).includes('fake'), false);
  assertNoNonFinite(result);
});

test('incomplete series carries partial coverage and does not impute missing counts', () => {
  const result = analyze(GOLDEN_FIXTURES.incompleteSeries);

  assert.equal(result.profileGrowth.followers.summary.count, 2);
  assert.equal(result.profileGrowth.followers.summary.coverage.availableMetrics, 2);
  assert.equal(result.profileGrowth.followers.summary.coverage.expectedMetrics, 3);
  assert.equal(result.comments.count, 1);
  assert.equal(result.engagement.evidenceState, 'unavailable');
  assert.equal(result.engagement.engagementRate.mean, null);
  assert.equal(result.window.start, '2026-01-01T00:00:00.000Z');
  assertNoNonFinite(result);
});

test('irregular engagement exposes normalized volatility and robust outliers', () => {
  const result = analyze(GOLDEN_FIXTURES.irregularEngagement);

  assert.equal(result.engagement.engagementRate.count, 8);
  assert.ok(result.volatility.engagementRate.coefficientOfVariation > 0.8);
  assert.ok(result.outliers.likes.outlierRatio > 0);
  assertNoNonFinite(result);
});

test('missing views remain unavailable for video performance', () => {
  const result = analyze(GOLDEN_FIXTURES.noViews);

  assert.equal(result.likes.evidenceState, 'derived');
  assert.equal(result.videoPerformance.views.evidenceState, 'unavailable');
  assert.equal(result.videoPerformance.views.median, null);
  assert.equal(result.engagement.medianViews.value, null);
  assert.equal(result.engagement.viewsFollowerRatio.evidenceState, 'unavailable');
  assert.equal(result.limitations.includes('views_unavailable'), true);
  assertNoNonFinite(result);
});

test('few posts do not manufacture a posting interval or an outlier ratio', () => {
  const result = analyze(GOLDEN_FIXTURES.fewPosts);

  assert.equal(result.likes.mean, 5);
  assert.equal(result.postingCadence.postingInterval.evidenceState, 'unavailable');
  assert.equal(result.postingCadence.postingInterval.median, null);
  assert.equal(result.likes.outlierRatio, null);
  assert.equal(result.outliers.likes.evidenceState, 'unavailable');
  assertNoNonFinite(result);
});

test('zero denominators are explicit and observed zero metrics remain zero', () => {
  const result = computeInfluencerAnalytics({
    creatorKey: 'creator-zero-denominator',
    computedAt: '2026-02-01T00:00:00.000Z',
    profileSnapshots: [
      {
        snapshotKey: 'profile-snapshot-zero-001',
        provider: 'meta-graph',
        observedAt: '2026-01-01T00:00:00.000Z',
        followersCount: 0,
        followingCount: 0,
        mediaCount: 0,
      },
      {
        snapshotKey: 'profile-snapshot-zero-002',
        provider: 'meta-graph',
        observedAt: '2026-01-02T00:00:00.000Z',
        followersCount: 0,
        followingCount: 0,
        mediaCount: 0,
      },
    ],
    mediaSnapshots: [{
      snapshotKey: 'media-snapshot-zero-001',
      mediaKey: 'media-zero-001',
      provider: 'meta-graph',
      observedAt: '2026-01-02T00:00:00.000Z',
      publishedAt: '2026-01-02T00:00:00.000Z',
      mediaKind: 'post',
      likesCount: 0,
      commentsCount: 0,
      viewsCount: 0,
    }],
  });

  assert.equal(result.likes.mean, 0);
  assert.equal(result.comments.mean, 0);
  assert.equal(result.engagement.engagementRate.evidenceState, 'unavailable');
  assert.equal(result.engagement.commentLikeRatio.evidenceState, 'unavailable');
  assert.equal(result.engagement.viewsFollowerRatio.evidenceState, 'unavailable');
  assert.equal(result.profileGrowth.followers.relativeGrowthRate.value, null);
  assert.equal(result.profileGrowth.followers.relativeGrowthRate.unavailableReason, 'zero_or_missing_initial_followers');
  assertNoNonFinite(result);
});

test('same snapshots and computation timestamp are bit-for-bit deterministic', () => {
  const first = analyze(GOLDEN_FIXTURES.viralPost);
  const second = analyze(GOLDEN_FIXTURES.viralPost);
  assert.deepEqual(first, second);
});

test('invalid unavailable values are rejected instead of silently coerced', () => {
  assert.throws(() => computeInfluencerAnalytics({
    creatorKey: 'creator-invalid-unavailable',
    computedAt: '2026-02-01T00:00:00.000Z',
    profileSnapshots: [{
      snapshotKey: 'profile-invalid-001',
      provider: 'meta-graph',
      observedAt: '2026-01-01T00:00:00.000Z',
      evidenceState: 'unavailable',
      followersCount: 10,
    }],
  }), (error) => error.code === 'UNAVAILABLE_HAS_VALUE');
});

test('explicit windows exclude observations outside the requested as-of interval', () => {
  const result = computeInfluencerAnalytics({
    ...structuredClone(GOLDEN_FIXTURES.smallStable),
    windowStart: '2026-01-04T00:00:00.000Z',
    windowEnd: '2026-01-10T00:00:00.000Z',
  });

  assert.deepEqual(result.inputSnapshotKeys, [
    'media-snapshot-small-002',
    'media-snapshot-small-003',
    'media-snapshot-small-004',
    'profile-snapshot-small-002',
  ]);
  assert.equal(result.postingCadence.publicationCount, 3);
  assert.equal(result.profileGrowth.followers.first.value, 1010);
  assert.equal(result.profileGrowth.followers.last.value, 1010);
  assert.equal(result.window.start, '2026-01-04T00:00:00.000Z');
  assert.equal(result.window.end, '2026-01-10T00:00:00.000Z');
  assertNoNonFinite(result);
});

test('media with no available metrics remains unavailable with an explicit reason', () => {
  const result = computeInfluencerAnalytics({
    creatorKey: 'creator-no-media-metrics',
    computedAt: '2026-02-01T00:00:00.000Z',
    mediaSnapshots: [{
      snapshotKey: 'media-snapshot-no-metrics-001',
      mediaKey: 'media-no-metrics-001',
      provider: 'meta-graph',
      observedAt: '2026-01-01T00:00:00.000Z',
      publishedAt: '2026-01-01T00:00:00.000Z',
      mediaKind: 'post',
      likesCount: null,
      commentsCount: null,
      viewsCount: null,
      reachCount: null,
    }],
  });

  assert.equal(result.likes.evidenceState, 'unavailable');
  assert.equal(result.videoPerformance.evidenceState, 'unavailable');
  assert.equal(result.videoPerformance.unavailableReason, 'no_matching_media');
  assertNoNonFinite(result);
});

