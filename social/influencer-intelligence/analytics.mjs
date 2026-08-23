/**
 * Pure, deterministic analytics over normalized Influencer Intelligence
 * snapshots.
 *
 * This module deliberately owns no provider, persistence, scheduling, network,
 * credential, or runtime boundary. Callers provide immutable-shaped snapshot
 * projections and a canonical computation timestamp. Missing source values are
 * represented as unavailable; observed zeroes remain valid values.
 */

export const ANALYTICS_CONTRACT_VERSION = 'influencer-intelligence/analytics/v1';
export const ANALYTICS_ALGORITHM_VERSION = 'influencer-intelligence-analytics/v1';

const SOURCE_EVIDENCE_STATES = new Set(['observed', 'unavailable']);
const MEDIA_KINDS = new Set(['post', 'reel', 'video', 'short', 'live', 'unknown']);
const VIDEO_KINDS = new Set(['reel', 'video', 'short', 'live']);
const COUNT_FIELDS = Object.freeze([
  'followersCount',
  'followingCount',
  'mediaCount',
  'likesCount',
  'commentsCount',
  'viewsCount',
  'reachCount',
]);
const PERCENTILES = Object.freeze({ p10: 0.1, p25: 0.25, p50: 0.5, p75: 0.75, p90: 0.9 });
const DAY_MS = 24 * 60 * 60 * 1000;
const TRIM_FRACTION = 0.1;

function fail(code, message) {
  const error = new TypeError(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_RECORD', `${label} must be an object`);
  }
}

function requiredString(value, label, pattern = /^[^\s]{1,160}$/) {
  if (typeof value !== 'string' || !value || !pattern.test(value)) {
    fail('INVALID_STRING', `${label} must be a bounded string`);
  }
  return value;
}

function optionalString(value, label, pattern = /^[^\s]{1,160}$/) {
  if (value === undefined || value === null) return null;
  return requiredString(value, label, pattern);
}

function timestamp(value, label, { required = true } = {}) {
  if (value === undefined || value === null) {
    if (!required) return null;
    fail('INVALID_TIMESTAMP', `${label} is required`);
  }
  if (typeof value !== 'string') fail('INVALID_TIMESTAMP', `${label} must be an ISO string`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail('INVALID_TIMESTAMP', `${label} must be parseable`);
  return new Date(parsed).toISOString();
}

function finiteNumber(value, label, { integer = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail('INVALID_NUMBER', `${label} must be a finite non-negative number`);
  }
  if (integer && !Number.isInteger(value)) fail('INVALID_NUMBER', `${label} must be an integer`);
  return value;
}

function normalizeEvidenceState(value, label) {
  if (!SOURCE_EVIDENCE_STATES.has(value)) {
    fail('INVALID_EVIDENCE_STATE', `${label} must be observed or unavailable`);
  }
  return value;
}

function normalizeCount(record, field, label) {
  const recordState = record.evidenceState || 'observed';
  normalizeEvidenceState(recordState, `${label}.evidenceState`);

  let value = record[field];
  let fieldState = recordState;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (!Object.prototype.hasOwnProperty.call(value, 'value')) {
      fail('INVALID_METRIC', `${label}.${field} object must expose value`);
    }
    fieldState = value.evidenceState || fieldState;
    value = value.value;
  }
  normalizeEvidenceState(fieldState, `${label}.${field}.evidenceState`);
  if ((recordState === 'unavailable' || fieldState === 'unavailable') && value !== undefined && value !== null) {
    fail('UNAVAILABLE_HAS_VALUE', `${label}.${field} cannot have a value`);
  }
  if (value === undefined || value === null || fieldState === 'unavailable') {
    return Object.freeze({ value: null, evidenceState: 'unavailable' });
  }
  return Object.freeze({
    value: finiteNumber(value, `${label}.${field}`, { integer: true }),
    evidenceState: 'observed',
  });
}

function normalizeProvider(value, label) {
  return requiredString(value, label, /^[a-z0-9][a-z0-9-]{0,79}$/);
}

function normalizeSnapshotKey(value, label) {
  return requiredString(value, label, /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,159}$/);
}

function normalizeProfileSnapshots(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail('INVALID_SNAPSHOTS', 'profileSnapshots must be an array');
  const keys = new Set();
  return value.map((item, index) => {
    const label = `profileSnapshots[${index}]`;
    assertRecord(item, label);
    const snapshotKey = normalizeSnapshotKey(item.snapshotKey, `${label}.snapshotKey`);
    if (keys.has(snapshotKey)) fail('DUPLICATE_SNAPSHOT_KEY', `${label}.snapshotKey is duplicated`);
    keys.add(snapshotKey);
    const observedAt = timestamp(item.observedAt, `${label}.observedAt`);
    const retrievedAt = timestamp(item.retrievedAt, `${label}.retrievedAt`, { required: false });
    if (retrievedAt && Date.parse(retrievedAt) < Date.parse(observedAt)) {
      fail('INVALID_TIMESTAMP_ORDER', `${label}.retrievedAt must not precede observedAt`);
    }
    const provider = normalizeProvider(item.provider, `${label}.provider`);
    return Object.freeze({
      snapshotKey,
      provider,
      observedAt,
      retrievedAt,
      evidenceState: normalizeEvidenceState(item.evidenceState || 'observed', `${label}.evidenceState`),
      followersCount: normalizeCount(item, 'followersCount', label),
      followingCount: normalizeCount(item, 'followingCount', label),
      mediaCount: normalizeCount(item, 'mediaCount', label),
    });
  });
}

function normalizeMediaSnapshots(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail('INVALID_SNAPSHOTS', 'mediaSnapshots must be an array');
  const keys = new Set();
  return value.map((item, index) => {
    const label = `mediaSnapshots[${index}]`;
    assertRecord(item, label);
    const snapshotKey = normalizeSnapshotKey(item.snapshotKey, `${label}.snapshotKey`);
    if (keys.has(snapshotKey)) fail('DUPLICATE_SNAPSHOT_KEY', `${label}.snapshotKey is duplicated`);
    keys.add(snapshotKey);
    const mediaKey = normalizeSnapshotKey(item.mediaKey, `${label}.mediaKey`);
    const observedAt = timestamp(item.observedAt, `${label}.observedAt`);
    const publishedAt = timestamp(item.publishedAt, `${label}.publishedAt`, { required: false });
    const retrievedAt = timestamp(item.retrievedAt, `${label}.retrievedAt`, { required: false });
    if (retrievedAt && Date.parse(retrievedAt) < Date.parse(observedAt)) {
      fail('INVALID_TIMESTAMP_ORDER', `${label}.retrievedAt must not precede observedAt`);
    }
    const provider = normalizeProvider(item.provider, `${label}.provider`);
    const mediaKind = item.mediaKind || 'unknown';
    if (!MEDIA_KINDS.has(mediaKind)) fail('INVALID_MEDIA_KIND', `${label}.mediaKind is unsupported`);
    return Object.freeze({
      snapshotKey,
      mediaKey,
      provider,
      observedAt,
      publishedAt,
      retrievedAt,
      mediaKind,
      evidenceState: normalizeEvidenceState(item.evidenceState || 'observed', `${label}.evidenceState`),
      likesCount: normalizeCount(item, 'likesCount', label),
      commentsCount: normalizeCount(item, 'commentsCount', label),
      viewsCount: normalizeCount(item, 'viewsCount', label),
      reachCount: normalizeCount(item, 'reachCount', label),
      followersCount: normalizeCount(item, 'followersCount', label),
    });
  });
}

function normalizeInput(input) {
  assertRecord(input, 'input');
  const creatorKey = requiredString(input.creatorKey, 'creatorKey', /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/);
  const computedAt = timestamp(input.computedAt, 'computedAt');
  const profileSnapshots = normalizeProfileSnapshots(input.profileSnapshots);
  const mediaSnapshots = normalizeMediaSnapshots(input.mediaSnapshots);
  const windowStart = timestamp(input.windowStart, 'windowStart', { required: false });
  const windowEnd = timestamp(input.windowEnd, 'windowEnd', { required: false });
  if (windowStart && windowEnd && Date.parse(windowEnd) <= Date.parse(windowStart)) {
    fail('INVALID_WINDOW', 'windowEnd must follow windowStart');
  }
  return Object.freeze({
    creatorKey,
    computedAt,
    windowStart,
    windowEnd,
    profileSnapshots,
    mediaSnapshots,
    followerTierBenchmark: input.followerTierBenchmark || null,
  });
}

function round(value, digits = 12) {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function numericValues(values) {
  return values.filter((value) => typeof value === 'number' && Number.isFinite(value));
}

function sortedNumbers(values) {
  return [...values].sort((left, right) => left - right);
}

function percentile(values, probability) {
  const sorted = sortedNumbers(values);
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function mean(values) {
  const clean = numericValues(values);
  if (clean.length === 0) return null;
  return clean.reduce((total, value) => total + value, 0) / clean.length;
}

function median(values) {
  return percentile(values, 0.5);
}

function standardDeviation(values) {
  const clean = numericValues(values);
  if (clean.length < 2) return null;
  const average = mean(clean);
  return Math.sqrt(clean.reduce((total, value) => total + ((value - average) ** 2), 0) / clean.length);
}

function medianAbsoluteDeviation(values) {
  const clean = numericValues(values);
  if (clean.length === 0) return null;
  const center = median(clean);
  return median(clean.map((value) => Math.abs(value - center)));
}

function trimmedMean(values) {
  const sorted = sortedNumbers(numericValues(values));
  const trimCount = Math.floor(sorted.length * TRIM_FRACTION);
  if (sorted.length < 5 || trimCount < 1 || (trimCount * 2) >= sorted.length) return null;
  const retained = sorted.slice(trimCount, sorted.length - trimCount);
  return mean(retained);
}

function winsorizedMean(values) {
  const sorted = sortedNumbers(numericValues(values));
  if (sorted.length < 2) return null;
  const trimCount = Math.floor(sorted.length * TRIM_FRACTION);
  if (trimCount < 1) return mean(sorted);
  const winsorized = [...sorted];
  const lower = sorted[trimCount];
  const upper = sorted[sorted.length - trimCount - 1];
  for (let index = 0; index < trimCount; index += 1) winsorized[index] = lower;
  for (let index = sorted.length - trimCount; index < sorted.length; index += 1) winsorized[index] = upper;
  return mean(winsorized);
}

function coverage(available, expected) {
  const safeAvailable = Math.max(0, Math.trunc(available));
  const safeExpected = Math.max(1, Math.trunc(expected));
  return Object.freeze({
    availableMetrics: Math.min(safeAvailable, safeExpected),
    expectedMetrics: safeExpected,
    ratio: round(safeAvailable / safeExpected, 12),
  });
}

function unavailableReasonForEmpty(expected) {
  return expected > 0 ? 'no_observed_values' : 'no_input_rows';
}

function summary(values, expected, unit) {
  const clean = numericValues(values);
  const result = {
    evidenceState: clean.length > 0 ? 'derived' : 'unavailable',
    confidence: clean.length > 0 ? coverage(clean.length, expected).ratio : 0,
    coverage: coverage(clean.length, expected),
    unit,
    count: clean.length,
    mean: mean(clean),
    median: median(clean),
    standardDeviation: standardDeviation(clean),
    percentiles: {
      p10: percentile(clean, PERCENTILES.p10),
      p25: percentile(clean, PERCENTILES.p25),
      p50: percentile(clean, PERCENTILES.p50),
      p75: percentile(clean, PERCENTILES.p75),
      p90: percentile(clean, PERCENTILES.p90),
    },
    trimmedMean: trimmedMean(clean),
    winsorizedMean: winsorizedMean(clean),
    iqr: clean.length > 0 ? percentile(clean, 0.75) - percentile(clean, 0.25) : null,
    mad: medianAbsoluteDeviation(clean),
    outlierRatio: null,
    viralOutlierRatio: null,
    unavailableReason: clean.length > 0 ? null : unavailableReasonForEmpty(expected),
    limitations: [],
  };

  if (clean.length < 2) result.limitations.push('standard_deviation_requires_two_values');
  if (clean.length < 5) result.limitations.push('trimmed_mean_requires_at_least_five_values');
  if (clean.length < 3) {
    result.limitations.push('outlier_ratios_require_at_least_three_values');
  } else {
    const q1 = result.percentiles.p25;
    const q3 = result.percentiles.p75;
    const center = result.median;
    const spread = result.iqr;
    const flags = clean.map((value) => (
      spread === 0
        ? value !== center
        : value < (q1 - (1.5 * spread)) || value > (q3 + (1.5 * spread))
    ));
    const viralSpread = Math.max(spread, (result.mad || 0));
    const viralUpper = viralSpread === 0
      ? center
      : Math.max(q3 + (3 * spread), center + (3 * (result.mad || 0)));
    const viralFlags = clean.map((value) => value > viralUpper);
    result.outlierRatio = round(flags.filter(Boolean).length / clean.length, 12);
    result.viralOutlierRatio = round(viralFlags.filter(Boolean).length / clean.length, 12);
  }
  if (clean.length > 0 && result.mean === 0) result.limitations.push('relative_volatility_requires_nonzero_mean');
  if (clean.length > 0 && result.median === 0) result.limitations.push('relative_mad_requires_nonzero_median');
  return result;
}

function scalar(value, expected = 1, available = value === null ? 0 : 1, unavailableReason = null, unit = null) {
  const isAvailable = value !== null && value !== undefined && Number.isFinite(value);
  const result = {
    value: isAvailable ? round(value) : null,
    evidenceState: isAvailable ? 'derived' : 'unavailable',
    confidence: isAvailable ? coverage(available, expected).ratio : 0,
    coverage: coverage(available, expected),
    ...(unit ? { unit } : {}),
    unavailableReason: isAvailable ? null : (unavailableReason || unavailableReasonForEmpty(expected)),
  };
  return result;
}

function uniqueProviders(profiles, media) {
  return [...new Set([...profiles, ...media].map((item) => item.provider))].sort();
}

function sourceProvenance(profiles, media) {
  return [...profiles.map((item) => ({
    provider: item.provider,
    sourceType: 'profile',
    evidenceState: item.evidenceState,
    observedAt: item.observedAt,
    ...(item.retrievedAt ? { retrievedAt: item.retrievedAt } : {}),
    sourceRef: item.snapshotKey,
  })), ...media.map((item) => ({
    provider: item.provider,
    sourceType: 'media',
    evidenceState: item.evidenceState,
    observedAt: item.observedAt,
    ...(item.retrievedAt ? { retrievedAt: item.retrievedAt } : {}),
    sourceRef: item.snapshotKey,
  }))].sort((left, right) => (
    `${left.provider}:${left.sourceType}:${left.observedAt}:${left.sourceRef}`
      .localeCompare(`${right.provider}:${right.sourceType}:${right.observedAt}:${right.sourceRef}`)
  ));
}

function observationForMetric(snapshot, field) {
  const item = snapshot[field];
  return item.value === null ? null : { value: item.value, observedAt: snapshot.observedAt, snapshotKey: snapshot.snapshotKey };
}

function sortedProfileSnapshots(profiles) {
  return [...profiles].sort((left, right) => (
    Date.parse(left.observedAt) - Date.parse(right.observedAt) || left.snapshotKey.localeCompare(right.snapshotKey)
  ));
}

function sortedMediaSnapshots(media) {
  return [...media].sort((left, right) => (
    Date.parse(left.observedAt) - Date.parse(right.observedAt) || left.snapshotKey.localeCompare(right.snapshotKey)
  ));
}

function followerForMedia(media, profiles) {
  if (media.followersCount.value !== null) {
    return { ...observationForMetric(media, 'followersCount'), source: 'media_snapshot' };
  }
  const target = Date.parse(media.observedAt);
  const candidates = sortedProfileSnapshots(profiles)
    .filter((profile) => Date.parse(profile.observedAt) <= target)
    .map((profile) => observationForMetric(profile, 'followersCount'))
    .filter(Boolean);
  if (candidates.length === 0) return null;
  return { ...candidates[candidates.length - 1], source: 'profile_snapshot' };
}

function mediaRows(media, profiles) {
  return media.map((item) => ({
    item,
    followers: followerForMedia(item, profiles),
    engagementRate: null,
    commentLikeRatio: null,
    viewsFollowerRatio: null,
  })).map((row) => {
    const likes = row.item.likesCount.value;
    const comments = row.item.commentsCount.value;
    const views = row.item.viewsCount.value;
    const followers = row.followers?.value ?? null;
    if (likes !== null && comments !== null && followers !== null && followers > 0) {
      row.engagementRate = (likes + comments) / followers;
    }
    if (likes !== null && comments !== null && likes > 0) {
      row.commentLikeRatio = comments / likes;
    }
    if (views !== null && followers !== null && followers > 0) {
      row.viewsFollowerRatio = views / followers;
    }
    return row;
  });
}

function linearTrend(points, expected, unit) {
  const usable = points
    .filter((point) => point && Number.isFinite(point.value) && point.at)
    .map((point) => ({ ...point, time: Date.parse(point.at) / DAY_MS }));
  const result = {
    evidenceState: 'unavailable',
    confidence: 0,
    coverage: coverage(usable.length, expected),
    unit,
    pointCount: usable.length,
    slopePerDay: null,
    intercept: null,
    rSquared: null,
    direction: null,
    unavailableReason: unavailableReasonForEmpty(expected),
    limitations: [],
  };
  if (usable.length < 2) {
    result.limitations.push('trend_requires_two_timestamped_values');
    return result;
  }
  const origin = Math.min(...usable.map((point) => point.time));
  const x = usable.map((point) => point.time - origin);
  const y = usable.map((point) => point.value);
  const xMean = mean(x);
  const yMean = mean(y);
  const denominator = x.reduce((total, value) => total + ((value - xMean) ** 2), 0);
  if (denominator === 0) {
    result.limitations.push('trend_requires_nonzero_time_span');
    result.unavailableReason = 'zero_time_span';
    return result;
  }
  const slope = x.reduce((total, value, index) => total + ((value - xMean) * (y[index] - yMean)), 0) / denominator;
  const intercept = yMean - (slope * xMean);
  const predicted = x.map((value) => intercept + (slope * value));
  const totalSumSquares = y.reduce((total, value) => total + ((value - yMean) ** 2), 0);
  const residualSumSquares = y.reduce((total, value, index) => total + ((value - predicted[index]) ** 2), 0);
  result.evidenceState = 'derived';
  result.confidence = result.coverage.ratio;
  result.slopePerDay = round(slope);
  result.intercept = round(intercept);
  result.rSquared = totalSumSquares === 0 ? null : round(1 - (residualSumSquares / totalSumSquares));
  result.direction = slope > 0 ? 'up' : (slope < 0 ? 'down' : 'flat');
  result.unavailableReason = null;
  if (totalSumSquares === 0) result.limitations.push('r_squared_unavailable_for_constant_series');
  return result;
}

function volatility(values, expected, unit) {
  const statistics = summary(values, expected, unit);
  const result = {
    evidenceState: statistics.evidenceState,
    confidence: statistics.confidence,
    coverage: statistics.coverage,
    unit,
    coefficientOfVariation: null,
    robustMadRatio: null,
    unavailableReason: statistics.unavailableReason,
    limitations: [...statistics.limitations],
  };
  if (statistics.mean !== null && statistics.mean > 0 && statistics.standardDeviation !== null) {
    result.coefficientOfVariation = round(statistics.standardDeviation / statistics.mean);
  }
  if (statistics.median !== null && statistics.median > 0 && statistics.mad !== null) {
    result.robustMadRatio = round(statistics.mad / statistics.median);
  }
  if (statistics.evidenceState === 'derived' && result.coefficientOfVariation === null) {
    result.limitations.push('coefficient_of_variation_unavailable_for_zero_mean_or_short_series');
  }
  if (statistics.evidenceState === 'derived' && result.robustMadRatio === null) {
    result.limitations.push('robust_mad_ratio_unavailable_for_zero_median');
  }
  return result;
}

function latestUniquePublishedMedia(media) {
  const selected = new Map();
  for (const item of [...media].sort((left, right) => (
    Date.parse(left.publishedAt || left.observedAt) - Date.parse(right.publishedAt || right.observedAt)
      || left.snapshotKey.localeCompare(right.snapshotKey)
  ))) {
    if (!item.publishedAt || selected.has(item.mediaKey)) continue;
    selected.set(item.mediaKey, item);
  }
  return [...selected.values()].sort((left, right) => (
    Date.parse(left.publishedAt) - Date.parse(right.publishedAt) || left.mediaKey.localeCompare(right.mediaKey)
  ));
}

function postingCadence(media) {
  const published = latestUniquePublishedMedia(media);
  const intervals = [];
  for (let index = 1; index < published.length; index += 1) {
    const days = (Date.parse(published[index].publishedAt) - Date.parse(published[index - 1].publishedAt)) / DAY_MS;
    if (days > 0) intervals.push(days);
  }
  const intervalSummary = summary(intervals, Math.max(1, published.length - 1), 'days');
  const result = {
    evidenceState: published.length > 0 ? 'derived' : 'unavailable',
    confidence: coverage(published.length, Math.max(1, media.length)).ratio,
    coverage: coverage(published.length, Math.max(1, media.length)),
    publicationCount: published.length,
    postingInterval: intervalSummary,
    postsPerDay: scalar(null, 1, 0, 'insufficient_publication_span', 'posts_per_day'),
    unavailableReason: published.length > 0 ? null : unavailableReasonForEmpty(media.length),
    limitations: [],
  };
  if (published.length < 2) result.limitations.push('posting_interval_requires_two_distinct_publications');
  if (intervals.length < published.length - 1) result.limitations.push('duplicate_or_zero_length_publication_intervals_excluded');
  if (published.length >= 2) {
    const first = Date.parse(published[0].publishedAt);
    const last = Date.parse(published[published.length - 1].publishedAt);
    const spanDays = (last - first) / DAY_MS;
    if (spanDays > 0) {
      result.postsPerDay = scalar(published.length / spanDays, 1, 1, null, 'posts_per_day');
    } else {
      result.limitations.push('posting_frequency_requires_nonzero_publication_span');
    }
  }
  return result;
}

function profileGrowth(profiles) {
  const ordered = sortedProfileSnapshots(profiles);
  const followerValues = ordered.map((item) => item.followersCount.value).filter((value) => value !== null);
  const followingValues = ordered.map((item) => item.followingCount.value).filter((value) => value !== null);
  const mediaValues = ordered.map((item) => item.mediaCount.value).filter((value) => value !== null);
  const followerSummary = summary(followerValues, Math.max(1, ordered.length), 'followers');
  const followingSummary = summary(followingValues, Math.max(1, ordered.length), 'following');
  const mediaSummary = summary(mediaValues, Math.max(1, ordered.length), 'media_count');
  const followerPoints = ordered.map((item) => observationForMetric(item, 'followersCount')).filter(Boolean);
  const intervals = [];
  for (let index = 1; index < followerPoints.length; index += 1) {
    const previous = followerPoints[index - 1];
    const current = followerPoints[index];
    const days = (Date.parse(current.observedAt) - Date.parse(previous.observedAt)) / DAY_MS;
    if (days > 0) {
      intervals.push({
        from: previous,
        to: current,
        days,
        delta: current.value - previous.value,
        velocityPerDay: (current.value - previous.value) / days,
      });
    }
  }
  const first = followerPoints[0] || null;
  const last = followerPoints[followerPoints.length - 1] || null;
  const comparisonAvailable = Boolean(first && last && first.snapshotKey !== last.snapshotKey
    && Date.parse(last.observedAt) > Date.parse(first.observedAt));
  const absoluteDelta = comparisonAvailable
    ? scalar(last.value - first.value, 1, 1, null, 'followers')
    : scalar(null, 1, 0, 'insufficient_distinct_profile_snapshots', 'followers');
  const relativeGrowthRate = comparisonAvailable && first.value > 0
    ? scalar((last.value - first.value) / first.value, 1, 1, null, 'ratio')
    : scalar(null, 1, 0, first ? 'zero_or_missing_initial_followers' : 'insufficient_distinct_profile_snapshots', 'ratio');
  const velocitySummary = summary(intervals.map((item) => item.velocityPerDay), Math.max(1, ordered.length - 1), 'followers_per_day');
  const accelerations = [];
  for (let index = 1; index < intervals.length; index += 1) {
    const previous = intervals[index - 1];
    const current = intervals[index];
    const averageDays = (previous.days + current.days) / 2;
    if (averageDays > 0) {
      accelerations.push((current.velocityPerDay - previous.velocityPerDay) / averageDays);
    }
  }
  const accelerationSummary = summary(accelerations, Math.max(1, intervals.length - 1), 'followers_per_day_squared');
  const result = {
    evidenceState: followerValues.length > 0 ? 'derived' : 'unavailable',
    confidence: followerSummary.confidence,
    coverage: followerSummary.coverage,
    followers: {
      summary: followerSummary,
      first: first ? { value: first.value, observedAt: first.observedAt, snapshotKey: first.snapshotKey } : null,
      last: last ? { value: last.value, observedAt: last.observedAt, snapshotKey: last.snapshotKey } : null,
      absoluteDelta,
      relativeGrowthRate,
      growthVelocity: velocitySummary,
      growthAcceleration: accelerationSummary,
    },
    following: followingSummary,
    mediaCount: mediaSummary,
    unavailableReason: followerValues.length > 0 ? null : unavailableReasonForEmpty(ordered.length),
    limitations: [],
  };
  if (followerPoints.length < ordered.length) result.limitations.push('profile_growth_uses_available_follower_snapshots_only');
  if (intervals.length < Math.max(0, followerPoints.length - 1)) result.limitations.push('non_positive_time_intervals_excluded');
  return result;
}

function categoryPerformance(media, profiles) {
  const rows = mediaRows(media, profiles);
  const likes = summary(media.map((item) => item.likesCount.value).filter((value) => value !== null), Math.max(1, media.length), 'likes');
  const comments = summary(media.map((item) => item.commentsCount.value).filter((value) => value !== null), Math.max(1, media.length), 'comments');
  const views = summary(media.map((item) => item.viewsCount.value).filter((value) => value !== null), Math.max(1, media.length), 'views');
  const reach = summary(media.map((item) => item.reachCount.value).filter((value) => value !== null), Math.max(1, media.length), 'reach');
  const engagementRates = rows.map((row) => row.engagementRate).filter((value) => value !== null);
  const commentLikeRatios = rows.map((row) => row.commentLikeRatio).filter((value) => value !== null);
  const viewsFollowerRatios = rows.map((row) => row.viewsFollowerRatio).filter((value) => value !== null);
  const engagementRate = summary(engagementRates, Math.max(1, media.length), 'ratio');
  const commentLikeRatio = summary(commentLikeRatios, Math.max(1, media.length), 'ratio');
  const viewsFollowerRatio = summary(viewsFollowerRatios, Math.max(1, media.length), 'ratio');
  return {
    evidenceState: media.length > 0 && (likes.count > 0 || comments.count > 0 || views.count > 0 || reach.count > 0) ? 'derived' : 'unavailable',
    confidence: coverage(media.length > 0 ? Math.max(likes.count, comments.count, views.count, reach.count) : 0, Math.max(1, media.length)).ratio,
    coverage: coverage(media.length > 0 ? Math.max(likes.count, comments.count, views.count, reach.count) : 0, Math.max(1, media.length)),
    mediaCount: media.length,
    likes,
    comments,
    views,
    reach,
    engagementRate,
    commentLikeRatio,
    viewsFollowerRatio,
    medianViews: scalar(views.median, views.coverage.expectedMetrics, views.count, views.unavailableReason, 'views'),
    unavailableReason: media.length > 0 ? null : 'no_matching_media',
    limitations: [],
  };
}

function outlierView(statistics) {
  const available = statistics.outlierRatio !== null && statistics.viralOutlierRatio !== null;
  return {
    evidenceState: available ? 'derived' : 'unavailable',
    confidence: available ? statistics.confidence : 0,
    coverage: statistics.coverage,
    count: statistics.count,
    outlierRatio: statistics.outlierRatio,
    viralOutlierRatio: statistics.viralOutlierRatio,
    method: 'tukey_1_5_iqr_and_upper_3_robust_scale',
    unavailableReason: available ? null : 'insufficient_values_for_robust_outlier_detection',
  };
}

function growthAnomalies(profiles) {
  const ordered = sortedProfileSnapshots(profiles);
  const points = ordered.map((item) => observationForMetric(item, 'followersCount')).filter(Boolean);
  const intervals = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const days = (Date.parse(current.observedAt) - Date.parse(previous.observedAt)) / DAY_MS;
    if (days > 0) intervals.push({
      from: previous,
      to: current,
      days,
      delta: current.value - previous.value,
      velocityPerDay: (current.value - previous.value) / days,
    });
  }
  const velocities = intervals.map((interval) => interval.velocityPerDay);
  const result = {
    evidenceState: 'unavailable',
    confidence: 0,
    coverage: coverage(velocities.length, Math.max(1, ordered.length - 1)),
    intervalCount: intervals.length,
    anomalyRatio: null,
    thresholdMethod: null,
    baselineMedian: null,
    mad: null,
    iqr: null,
    anomalies: [],
    unavailableReason: velocities.length < 3 ? 'growth_anomaly_detection_requires_three_intervals' : null,
    limitations: [],
  };
  if (velocities.length < 3) {
    result.limitations.push('growth_anomaly_detection_requires_three_valid_growth_intervals');
    return result;
  }
  const center = median(velocities);
  const mad = medianAbsoluteDeviation(velocities);
  const q1 = percentile(velocities, 0.25);
  const q3 = percentile(velocities, 0.75);
  const iqr = q3 - q1;
  let lower;
  let upper;
  if (mad > 0) {
    lower = center - (3 * mad);
    upper = center + (3 * mad);
    result.thresholdMethod = 'median_plus_or_minus_3_mad';
  } else if (iqr > 0) {
    lower = q1 - (1.5 * iqr);
    upper = q3 + (1.5 * iqr);
    result.thresholdMethod = 'tukey_1_5_iqr';
  } else {
    lower = center;
    upper = center;
    result.thresholdMethod = 'distinct_from_constant_baseline';
  }
  result.evidenceState = 'derived';
  result.confidence = result.coverage.ratio;
  result.baselineMedian = round(center);
  result.mad = round(mad);
  result.iqr = round(iqr);
  result.anomalies = intervals.filter((interval) => interval.velocityPerDay < lower || interval.velocityPerDay > upper).map((interval) => ({
    fromSnapshotKey: interval.from.snapshotKey,
    toSnapshotKey: interval.to.snapshotKey,
    fromObservedAt: interval.from.observedAt,
    toObservedAt: interval.to.observedAt,
    delta: round(interval.delta),
    velocityPerDay: round(interval.velocityPerDay),
    direction: interval.velocityPerDay > upper ? 'spike' : 'drop',
    interpretation: 'growth_pattern_anomaly',
  }));
  result.anomalyRatio = round(result.anomalies.length / intervals.length, 12);
  return result;
}

function normalizeBenchmark(value) {
  if (value === null || value === undefined) {
    return {
      evidenceState: 'unavailable',
      status: 'unavailable',
      source: 'skincos_internal',
      tierKey: null,
      sampleSize: 0,
      metrics: {},
      unavailableReason: 'no_internal_benchmark_dataset',
    };
  }
  assertRecord(value, 'followerTierBenchmark');
  if (value.source !== 'skincos_internal') {
    fail('UNTRUSTED_BENCHMARK_SOURCE', 'followerTierBenchmark must use skincos_internal');
  }
  const status = value.status || 'unavailable';
  if (!['available', 'unavailable'].includes(status)) fail('INVALID_BENCHMARK_STATUS', 'benchmark status is invalid');
  const sampleSize = value.sampleSize === undefined ? 0 : finiteNumber(value.sampleSize, 'followerTierBenchmark.sampleSize', { integer: true });
  const tierKey = optionalString(value.tierKey, 'followerTierBenchmark.tierKey', /^[a-z0-9][a-z0-9._-]{0,79}$/);
  if (status !== 'available' || sampleSize < 1 || !tierKey) {
    return {
      evidenceState: 'unavailable',
      status: 'unavailable',
      source: 'skincos_internal',
      tierKey,
      sampleSize,
      metrics: {},
      unavailableReason: 'insufficient_internal_benchmark_data',
    };
  }
  assertRecord(value.metrics, 'followerTierBenchmark.metrics');
  const metrics = {};
  for (const [key, metric] of Object.entries(value.metrics)) {
    if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(key)) fail('INVALID_BENCHMARK_METRIC', `invalid benchmark metric ${key}`);
    metrics[key] = finiteNumber(metric, `followerTierBenchmark.metrics.${key}`);
  }
  return {
    evidenceState: 'observed',
    status: 'available',
    source: 'skincos_internal',
    tierKey,
    sampleSize,
    metrics,
    unavailableReason: null,
  };
}

function derivedWindow(input) {
  const sourceTimes = [
    ...input.profileSnapshots.map((item) => item.observedAt),
    ...input.mediaSnapshots.map((item) => item.observedAt),
  ].map(Date.parse);
  const start = input.windowStart || (sourceTimes.length > 0 ? new Date(Math.min(...sourceTimes)).toISOString() : null);
  const end = input.windowEnd || (sourceTimes.length > 0 ? new Date(Math.max(...sourceTimes)).toISOString() : null);
  if (!start || !end) {
    return { evidenceState: 'unavailable', start: null, end: null, unavailableReason: 'no_snapshot_timestamps' };
  }
  return { evidenceState: 'derived', start, end, unavailableReason: null };
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export function computeInfluencerAnalytics(input) {
  const normalized = normalizeInput(input);
  const profiles = normalized.profileSnapshots;
  const media = normalized.mediaSnapshots;
  const rows = mediaRows(media, profiles);
  const profile = profileGrowth(profiles);
  const cadence = postingCadence(media);
  const likes = summary(media.map((item) => item.likesCount.value).filter((value) => value !== null), Math.max(1, media.length), 'likes');
  const comments = summary(media.map((item) => item.commentsCount.value).filter((value) => value !== null), Math.max(1, media.length), 'comments');
  const engagementRates = rows.map((row) => row.engagementRate).filter((value) => value !== null);
  const commentLikeRatios = rows.map((row) => row.commentLikeRatio).filter((value) => value !== null);
  const viewsFollowerRatios = rows.map((row) => row.viewsFollowerRatio).filter((value) => value !== null);
  const views = summary(media.map((item) => item.viewsCount.value).filter((value) => value !== null), Math.max(1, media.length), 'views');
  const reach = summary(media.map((item) => item.reachCount.value).filter((value) => value !== null), Math.max(1, media.length), 'reach');
  const engagement = {
    evidenceState: engagementRates.length > 0 ? 'derived' : 'unavailable',
    confidence: coverage(engagementRates.length, Math.max(1, media.length)).ratio,
    coverage: coverage(engagementRates.length, Math.max(1, media.length)),
    engagementRate: summary(engagementRates, Math.max(1, media.length), 'ratio'),
    commentLikeRatio: summary(commentLikeRatios, Math.max(1, media.length), 'ratio'),
    viewsFollowerRatio: summary(viewsFollowerRatios, Math.max(1, media.length), 'ratio'),
    medianViews: scalar(views.median, views.coverage.expectedMetrics, views.count, views.unavailableReason, 'views'),
    unavailableReason: engagementRates.length > 0 ? null : 'no_media_with_complete_engagement_denominator',
    limitations: [],
  };
  if (engagementRates.length < media.length) engagement.limitations.push('engagement_rate_requires_likes_comments_and_positive_followers');
  if (commentLikeRatios.length < media.length) engagement.limitations.push('comment_like_ratio_requires_positive_likes');
  if (viewsFollowerRatios.length < media.length) engagement.limitations.push('views_follower_ratio_requires_views_and_positive_followers');

  const videoMedia = media.filter((item) => VIDEO_KINDS.has(item.mediaKind));
  const videoPerformance = categoryPerformance(videoMedia, profiles);
  const trend = {
    followers: linearTrend(sortedProfileSnapshots(profiles).map((item) => {
      const observation = observationForMetric(item, 'followersCount');
      return observation ? { value: observation.value, at: observation.observedAt } : null;
    }), Math.max(1, profiles.length), 'followers_per_day'),
    likes: linearTrend(media.map((item) => item.likesCount.value === null ? null : { value: item.likesCount.value, at: item.observedAt }), Math.max(1, media.length), 'likes_per_day'),
    comments: linearTrend(media.map((item) => item.commentsCount.value === null ? null : { value: item.commentsCount.value, at: item.observedAt }), Math.max(1, media.length), 'comments_per_day'),
    views: linearTrend(media.map((item) => item.viewsCount.value === null ? null : { value: item.viewsCount.value, at: item.observedAt }), Math.max(1, media.length), 'views_per_day'),
    engagementRate: linearTrend(rows.map((row) => row.engagementRate === null ? null : { value: row.engagementRate, at: row.item.observedAt }), Math.max(1, media.length), 'ratio_per_day'),
  };
  const volatilityResult = {
    followers: volatility(profiles.map((item) => item.followersCount.value).filter((value) => value !== null), Math.max(1, profiles.length), 'followers'),
    likes: volatility(media.map((item) => item.likesCount.value).filter((value) => value !== null), Math.max(1, media.length), 'likes'),
    comments: volatility(media.map((item) => item.commentsCount.value).filter((value) => value !== null), Math.max(1, media.length), 'comments'),
    views: volatility(media.map((item) => item.viewsCount.value).filter((value) => value !== null), Math.max(1, media.length), 'views'),
    engagementRate: volatility(engagementRates, Math.max(1, media.length), 'ratio'),
  };
  const outliers = {
    likes: outlierView(likes),
    comments: outlierView(comments),
    views: outlierView(views),
  };
  const growthAnomalyResult = growthAnomalies(profiles);
  const sourceRows = profiles.length + media.length;
  const coreAvailable = [
    ...profiles.flatMap((item) => [item.followersCount, item.followingCount, item.mediaCount]),
    ...media.flatMap((item) => [item.likesCount, item.commentsCount]),
  ].filter((item) => item.value !== null).length;
  const coreExpected = Math.max(1, (profiles.length * 3) + (media.length * 2));
  const overallCoverage = coverage(coreAvailable, coreExpected);
  const anyDerived = [profile, cadence, engagement, videoPerformance, growthAnomalyResult]
    .some((item) => item.evidenceState === 'derived');
  const limitations = [];
  if (profiles.length === 0 && media.length === 0) limitations.push('no_snapshot_input');
  if (views.evidenceState === 'unavailable') limitations.push('views_unavailable');
  if (reach.evidenceState === 'unavailable') limitations.push('reach_unavailable');
  if (growthAnomalyResult.evidenceState === 'unavailable') limitations.push('growth_anomaly_coverage_limited');
  return deepFreeze({
    contractVersion: ANALYTICS_CONTRACT_VERSION,
    algorithmVersion: ANALYTICS_ALGORITHM_VERSION,
    creatorKey: normalized.creatorKey,
    computedAt: normalized.computedAt,
    window: derivedWindow(normalized),
    evidenceState: anyDerived ? 'derived' : 'unavailable',
    confidence: anyDerived ? overallCoverage.ratio : 0,
    coverage: overallCoverage,
    providers: uniqueProviders(profiles, media),
    provenance: sourceProvenance(profiles, media),
    inputSnapshotKeys: [...profiles, ...media].map((item) => item.snapshotKey).sort(),
    profileGrowth: profile,
    postingCadence: cadence,
    likes,
    comments,
    engagement,
    videoPerformance,
    volatility: volatilityResult,
    trend,
    outliers,
    growthAnomalies: growthAnomalyResult,
    followerTierBenchmark: normalizeBenchmark(normalized.followerTierBenchmark),
    limitations,
  });
}

export const __testing = Object.freeze({
  percentile,
  standardDeviation,
  medianAbsoluteDeviation,
  trimmedMean,
  winsorizedMean,
});
