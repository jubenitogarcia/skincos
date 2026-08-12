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

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

const clone = (value) => structuredClone(value);

export const CALIBRATION_FIXTURES = deepFreeze({
  smallStable: clone(GOLDEN_FIXTURES.smallStable),
  largeCreator: clone(GOLDEN_FIXTURES.largeCreator),
  viralPost: clone(GOLDEN_FIXTURES.viralPost),
  followerSpike: clone(GOLDEN_FIXTURES.followerSpike),
  incompleteSeries: clone(GOLDEN_FIXTURES.incompleteSeries),
  irregularEngagement: clone(GOLDEN_FIXTURES.irregularEngagement),
  noViews: clone(GOLDEN_FIXTURES.noViews),
  fewPosts: clone(GOLDEN_FIXTURES.fewPosts),
  zeroDenominator: clone(ZERO_DENOMINATOR),
  sparseHighSignal: clone(SPARSE_HIGH_SIGNAL),
});
