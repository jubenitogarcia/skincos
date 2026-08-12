import { GOLDEN_FIXTURES } from './analytics-golden-fixtures.mjs';

const ZERO_DENOMINATOR = Object.freeze({
  creatorKey: 'creator-calibration-zero-denominator',
  computedAt: '2026-02-01T00:00:00.000Z',
  profileSnapshots: [
    {
      snapshotKey: 'profile-snapshot-calibration-zero-001',
      provider: 'meta-graph',
      observedAt: '2026-01-01T00:00:00.000Z',
      followersCount: 0,
      followingCount: 0,
      mediaCount: 0,
    },
    {
      snapshotKey: 'profile-snapshot-calibration-zero-002',
      provider: 'meta-graph',
      observedAt: '2026-01-02T00:00:00.000Z',
      followersCount: 0,
      followingCount: 0,
      mediaCount: 0,
    },
  ],
  mediaSnapshots: [
    {
      snapshotKey: 'media-snapshot-calibration-zero-001',
      mediaKey: 'media-calibration-zero-001',
      provider: 'meta-graph',
      observedAt: '2026-01-02T00:00:00.000Z',
      publishedAt: '2026-01-02T00:00:00.000Z',
      mediaKind: 'post',
      likesCount: 0,
      commentsCount: 0,
      viewsCount: 0,
      reachCount: 0,
    },
  ],
});

const SPARSE_HIGH_SIGNAL = Object.freeze({
  creatorKey: 'creator-calibration-sparse-high-signal',
  computedAt: '2026-02-01T00:00:00.000Z',
  profileSnapshots: [
    {
      snapshotKey: 'profile-snapshot-calibration-sparse-001',
      provider: 'meta-graph',
      observedAt: '2026-01-31T00:00:00.000Z',
      followersCount: 1000,
      followingCount: 100,
      mediaCount: 1,
    },
  ],
  mediaSnapshots: [
    {
      snapshotKey: 'media-snapshot-calibration-sparse-001',
      mediaKey: 'media-calibration-sparse-001',
      provider: 'meta-graph',
      observedAt: '2026-01-31T00:00:00.000Z',
      publishedAt: '2026-01-31T00:00:00.000Z',
      mediaKind: 'reel',
      likesCount: 300,
      commentsCount: 30,
      viewsCount: 800,
      reachCount: 900,
    },
  ],
});

export const CALIBRATION_FIXTURES = Object.freeze({
  smallStable: GOLDEN_FIXTURES.smallStable,
  largeCreator: GOLDEN_FIXTURES.largeCreator,
  viralPost: GOLDEN_FIXTURES.viralPost,
  followerSpike: GOLDEN_FIXTURES.followerSpike,
  incompleteSeries: GOLDEN_FIXTURES.incompleteSeries,
  irregularEngagement: GOLDEN_FIXTURES.irregularEngagement,
  noViews: GOLDEN_FIXTURES.noViews,
  fewPosts: GOLDEN_FIXTURES.fewPosts,
  zeroDenominator: ZERO_DENOMINATOR,
  sparseHighSignal: SPARSE_HIGH_SIGNAL,
});

