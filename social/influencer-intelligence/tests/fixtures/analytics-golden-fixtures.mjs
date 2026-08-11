const computedAt = '2026-02-01T00:00:00.000Z';

function profile(snapshotKey, observedAt, followersCount, overrides = {}) {
  return {
    snapshotKey,
    provider: 'meta-graph',
    observedAt,
    followersCount,
    followingCount: overrides.followingCount ?? 100,
    mediaCount: overrides.mediaCount ?? 20,
    ...overrides,
  };
}

function media(snapshotKey, publishedAt, {
  mediaKey = snapshotKey.replace('media-snapshot-', 'media-'),
  mediaKind = 'post',
  likesCount,
  commentsCount,
  viewsCount,
  reachCount,
  followersCount,
} = {}) {
  return {
    snapshotKey,
    mediaKey,
    provider: 'meta-graph',
    observedAt: publishedAt,
    publishedAt,
    mediaKind,
    likesCount,
    commentsCount,
    ...(viewsCount === undefined ? {} : { viewsCount }),
    ...(reachCount === undefined ? {} : { reachCount }),
    ...(followersCount === undefined ? {} : { followersCount }),
  };
}

const smallStable = {
  creatorKey: 'creator-small-stable',
  computedAt,
  profileSnapshots: [
    profile('profile-snapshot-small-001', '2026-01-01T00:00:00.000Z', 1000),
    profile('profile-snapshot-small-002', '2026-01-08T00:00:00.000Z', 1010, { followingCount: 101, mediaCount: 22 }),
    profile('profile-snapshot-small-003', '2026-01-15T00:00:00.000Z', 1020, { followingCount: 102, mediaCount: 24 }),
  ],
  mediaSnapshots: [
    media('media-snapshot-small-001', '2026-01-02T00:00:00.000Z', { likesCount: 20, commentsCount: 2 }),
    media('media-snapshot-small-002', '2026-01-04T00:00:00.000Z', { likesCount: 21, commentsCount: 2 }),
    media('media-snapshot-small-003', '2026-01-07T00:00:00.000Z', { likesCount: 19, commentsCount: 2 }),
    media('media-snapshot-small-004', '2026-01-10T00:00:00.000Z', { likesCount: 20, commentsCount: 2 }),
    media('media-snapshot-small-005', '2026-01-13T00:00:00.000Z', { likesCount: 20, commentsCount: 2 }),
  ],
};

const largeCreator = {
  creatorKey: 'creator-large',
  computedAt,
  profileSnapshots: [
    profile('profile-snapshot-large-001', '2026-01-01T00:00:00.000Z', 1000000, { followingCount: 500, mediaCount: 500 }),
    profile('profile-snapshot-large-002', '2026-01-11T00:00:00.000Z', 1010000, { followingCount: 501, mediaCount: 504 }),
  ],
  mediaSnapshots: [
    media('media-snapshot-large-001', '2026-01-02T00:00:00.000Z', { likesCount: 20000, commentsCount: 200 }),
    media('media-snapshot-large-002', '2026-01-04T00:00:00.000Z', { likesCount: 21000, commentsCount: 210 }),
    media('media-snapshot-large-003', '2026-01-07T00:00:00.000Z', { likesCount: 19000, commentsCount: 190 }),
    media('media-snapshot-large-004', '2026-01-10T00:00:00.000Z', { likesCount: 20500, commentsCount: 205 }),
  ],
};

const postValues = [10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 1000];
const viralPost = {
  creatorKey: 'creator-viral-post',
  computedAt,
  profileSnapshots: [
    profile('profile-snapshot-viral-001', '2026-01-01T00:00:00.000Z', 2000),
    profile('profile-snapshot-viral-002', '2026-01-12T00:00:00.000Z', 2100),
  ],
  mediaSnapshots: postValues.map((likesCount, index) => media(
    `media-snapshot-viral-${String(index + 1).padStart(3, '0')}`,
    `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    {
      likesCount,
      commentsCount: likesCount === 1000 ? 50 : 1,
      viewsCount: likesCount === 1000 ? 10000 : 100 + likesCount,
      mediaKind: likesCount === 1000 ? 'reel' : 'post',
    },
  )),
};

const followerSpike = {
  creatorKey: 'creator-follower-spike',
  computedAt,
  profileSnapshots: [
    profile('profile-snapshot-spike-001', '2026-01-01T00:00:00.000Z', 1000),
    profile('profile-snapshot-spike-002', '2026-01-02T00:00:00.000Z', 1010),
    profile('profile-snapshot-spike-003', '2026-01-03T00:00:00.000Z', 1020),
    profile('profile-snapshot-spike-004', '2026-01-04T00:00:00.000Z', 6000),
    profile('profile-snapshot-spike-005', '2026-01-05T00:00:00.000Z', 6030),
  ],
  mediaSnapshots: [],
};

const incompleteSeries = {
  creatorKey: 'creator-incomplete-series',
  computedAt,
  profileSnapshots: [
    profile('profile-snapshot-incomplete-001', '2026-01-01T00:00:00.000Z', 1000),
    profile('profile-snapshot-incomplete-002', '2026-01-08T00:00:00.000Z', null, { followingCount: null }),
    profile('profile-snapshot-incomplete-003', '2026-01-15T00:00:00.000Z', 1100),
  ],
  mediaSnapshots: [
    media('media-snapshot-incomplete-001', '2026-01-02T00:00:00.000Z', { likesCount: 10, commentsCount: null }),
    media('media-snapshot-incomplete-002', '2026-01-09T00:00:00.000Z', { likesCount: null, commentsCount: 2 }),
  ],
};

const irregularEngagement = {
  creatorKey: 'creator-irregular-engagement',
  computedAt,
  profileSnapshots: [
    profile('profile-snapshot-irregular-001', '2026-01-01T00:00:00.000Z', 10000),
  ],
  mediaSnapshots: [0.01, 0.02, 0.03, 0.02, 0.05, 0.04, 0.08, 0.5].map((rate, index) => media(
    `media-snapshot-irregular-${String(index + 1).padStart(3, '0')}`,
    `2026-01-${String(index + 2).padStart(2, '0')}T00:00:00.000Z`,
    { likesCount: Math.round(rate * 10000), commentsCount: Math.round(rate * 1000) },
  )),
};

const noViews = {
  creatorKey: 'creator-no-views',
  computedAt,
  profileSnapshots: [
    profile('profile-snapshot-no-views-001', '2026-01-01T00:00:00.000Z', 3000),
  ],
  mediaSnapshots: [
    media('media-snapshot-no-views-001', '2026-01-02T00:00:00.000Z', { mediaKind: 'reel', likesCount: 30, commentsCount: 3, viewsCount: null, reachCount: null }),
    media('media-snapshot-no-views-002', '2026-01-04T00:00:00.000Z', { mediaKind: 'reel', likesCount: 32, commentsCount: 4, viewsCount: null, reachCount: null }),
  ],
};

const fewPosts = {
  creatorKey: 'creator-few-posts',
  computedAt,
  profileSnapshots: [
    profile('profile-snapshot-few-001', '2026-01-01T00:00:00.000Z', 500),
  ],
  mediaSnapshots: [
    media('media-snapshot-few-001', '2026-01-02T00:00:00.000Z', { likesCount: 5, commentsCount: 1 }),
  ],
};

export const GOLDEN_FIXTURES = Object.freeze({
  smallStable,
  largeCreator,
  viralPost,
  followerSpike,
  incompleteSeries,
  irregularEngagement,
  noViews,
  fewPosts,
});




