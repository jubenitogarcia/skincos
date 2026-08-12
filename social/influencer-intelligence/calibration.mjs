/**
 * Synthetic calibration harness for the deterministic Influencer Intelligence
 * analytics, scoring, and campaign-fit contracts.
 *
 * The harness is intentionally pure: it consumes golden fixtures, never calls
 * a provider, never persists a result, and never changes production weights.
 * Expectations are behavioral guardrails rather than hand-tuned target scores.
 */

import {
  ANALYTICS_ALGORITHM_VERSION,
  computeInfluencerAnalytics,
} from './analytics.mjs';
import {
  SCORING_ALGORITHM_VERSION,
  SCORING_WEIGHTS_VERSION,
  computeInfluencerScore,
} from './scoring.mjs';
import {
  CAMPAIGN_FIT_ALGORITHM_VERSION,
  CAMPAIGN_FIT_WEIGHTS_VERSION,
  computeCampaignFit,
} from './campaign-fit.mjs';
import {
  CAMPAIGN_FIXTURE,
  COMPETITOR_CONFLICT_CREATOR,
  GOOD_CREATOR,
  HIGH_SATURATION_CREATOR,
  MISSING_DEMOGRAPHICS_CREATOR,
  signal,
} from './tests/fixtures/campaign-fit-golden-fixtures.mjs';
import { CALIBRATION_FIXTURES } from './tests/fixtures/calibration-golden-fixtures.mjs';

export const CALIBRATION_CONTRACT_VERSION = 'influencer-intelligence/calibration/v1';
export const CALIBRATION_DATASET_VERSION = 'influencer-intelligence-calibration-golden/v1';
export const CALIBRATION_CALCULATED_AT = '2026-08-12T12:00:00.000Z';

const SPARSE_SIGNAL_REFS = Object.freeze({
  comment_quality: ['fixture:calibration:sparse-comments'],
  commercial_saturation: ['fixture:calibration:sparse-commercial'],
  brand_fit: ['fixture:calibration:sparse-brand-fit'],
});

// The score contract itself contains policy labels such as
// `not_a_fake_followers_determination`; only an unqualified occurrence is a
// prohibited factual claim in this guard.
const FACTUAL_FAKE_FOLLOWER_PATTERN = /\bfake[-_ ]followers?\b(?![_ ](?:claim|determination)\b)/i;

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function clone(value) {
  return structuredClone(value);
}

function scaleFollowerFixture(fixture, factor) {
  const scaled = clone(fixture);
  scaled.creatorKey = `${scaled.creatorKey}-scale-${factor}`;
  scaled.profileSnapshots = scaled.profileSnapshots.map((snapshot) => ({
    ...snapshot,
    followersCount: snapshot.followersCount === null ? null : snapshot.followersCount * factor,
  }));
  scaled.mediaSnapshots = scaled.mediaSnapshots.map((snapshot) => Object.fromEntries(
    Object.entries(snapshot).map(([key, value]) => (
      ['likesCount', 'commentsCount', 'viewsCount', 'reachCount', 'followersCount'].includes(key)
        && typeof value === 'number'
        ? [key, value * factor]
        : [key, value]
    )),
  ));
  return scaled;
}

function withViewsFixture(fixture) {
  const withViews = clone(fixture);
  withViews.creatorKey = `${withViews.creatorKey}-with-views`;
  withViews.mediaSnapshots = withViews.mediaSnapshots.map((snapshot, index) => ({
    ...snapshot,
    viewsCount: 900 + (index * 50),
    reachCount: 950 + (index * 50),
  }));
  return withViews;
}

function componentScoreDelta(left, right) {
  return Math.max(...Object.keys(left.score.component_scores).map((key) => {
    const leftScore = left.score.component_scores[key].score;
    const rightScore = right.score.component_scores[key].score;
    if (leftScore === null && rightScore === null) return 0;
    if (leftScore === null || rightScore === null) return Infinity;
    return Math.abs(leftScore - rightScore);
  }));
}

function competitorControlCreator() {
  const creator = clone(COMPETITOR_CONFLICT_CREATOR);
  creator.creator_key = 'creator-competitor-control';
  creator.signals.competitors = signal([], { key: 'competitors-control' });
  creator.signals.brands_mentioned = signal([], { key: 'brands-mentioned-control' });
  return creator;
}

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function finiteNumbers(value, path = 'result') {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? [] : [`${path}:non_finite`];
  }
  if (Array.isArray(value)) {
    return value.flatMap((child, index) => finiteNumbers(child, `${path}[${index}]`));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => finiteNumbers(child, `${path}.${key}`));
  }
  return [];
}

function analyze(fixture) {
  const analytics = computeInfluencerAnalytics(clone(fixture));
  const score = computeInfluencerScore({ analytics });
  return { analytics, score };
}

function scoreSummary({ analytics, score }) {
  return {
    overall_score: score.overall_score,
    confidence_score: score.confidence_score,
    data_coverage: score.data_coverage,
    evidence_state: score.evidence_state,
    profile_history_length: analytics.profileGrowth.followers.summary.count,
    media_history_length: analytics.postingCadence.publicationCount,
    component_scores: Object.fromEntries(
      ['engagement_quality', 'growth_integrity', 'content_performance', 'consistency', 'risk', 'profile_integrity']
        .map((key) => [key, score.component_scores[key].score]),
    ),
    limitations: [...score.limitations],
  };
}

function campaignSummary(result) {
  return {
    campaign_fit_score: result.campaign_fit_score,
    campaign_fit_confidence: result.campaign_fit_confidence,
    data_coverage: result.data_coverage,
    evidence_state: result.evidence_state,
    audience_fit: result.campaign_fit_components.audience_fit.evidence_state,
    competitor_conflicts: [...result.competitor_conflicts],
    limitations: [...result.limitations],
  };
}

function sparseSignals() {
  return {
    comment_quality: {
      score: 96,
      evidence_state: 'derived',
      confidence: 0.9,
      sample_size: 1,
      evidence_refs: SPARSE_SIGNAL_REFS.comment_quality,
    },
    commercial_saturation: {
      score: 92,
      evidence_state: 'derived',
      confidence: 0.9,
      evidence_refs: SPARSE_SIGNAL_REFS.commercial_saturation,
    },
    brand_fit: {
      score: 95,
      evidence_state: 'derived',
      confidence: 0.9,
      evidence_refs: SPARSE_SIGNAL_REFS.brand_fit,
    },
  };
}

function makeCase(id, expectedBehavior, actualBehavior, passed, evidenceRefs = []) {
  return {
    id,
    expected_behavior: expectedBehavior,
    actual_behavior: actualBehavior,
    passed: Boolean(passed),
    evidence_refs: [...new Set(evidenceRefs)].slice(0, 64),
  };
}

function validateCalculatedAt(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new TypeError('calculated_at must be a parseable timestamp');
  }
  return new Date(Date.parse(value)).toISOString();
}

function scoreVersionSummary(result) {
  return {
    analytics_algorithm_version: ANALYTICS_ALGORITHM_VERSION,
    scoring_algorithm_version: result.score.algorithm_version,
    scoring_weights_version: result.score.weights_version,
  };
}

function fitVersionSummary(result) {
  return {
    campaign_fit_algorithm_version: result.algorithm_version,
    campaign_fit_weights_version: result.weights_version,
  };
}

export function runInfluencerCalibration({ calculated_at: calculatedAt = CALIBRATION_CALCULATED_AT } = {}) {
  const normalizedCalculatedAt = validateCalculatedAt(calculatedAt);
  const small = analyze(CALIBRATION_FIXTURES.smallStable);
  const large = analyze(CALIBRATION_FIXTURES.largeCreator);
  const scaledSmall = analyze(scaleFollowerFixture(CALIBRATION_FIXTURES.smallStable, 100));
  const viral = analyze(CALIBRATION_FIXTURES.viralPost);
  const viralWithoutLastPost = analyze({
    ...clone(CALIBRATION_FIXTURES.viralPost),
    mediaSnapshots: clone(CALIBRATION_FIXTURES.viralPost.mediaSnapshots).slice(0, -1),
  });
  const spike = analyze(CALIBRATION_FIXTURES.followerSpike);
  const incomplete = analyze(CALIBRATION_FIXTURES.incompleteSeries);
  const irregular = analyze(CALIBRATION_FIXTURES.irregularEngagement);
  const noViews = analyze(CALIBRATION_FIXTURES.noViews);
  const withViews = analyze(withViewsFixture(CALIBRATION_FIXTURES.noViews));
  const fewPosts = analyze(CALIBRATION_FIXTURES.fewPosts);
  const zeroDenominator = analyze(CALIBRATION_FIXTURES.zeroDenominator);
  const sparseHighSignal = {
    analytics: computeInfluencerAnalytics(clone(CALIBRATION_FIXTURES.sparseHighSignal)),
  };
  sparseHighSignal.score = computeInfluencerScore({
    analytics: sparseHighSignal.analytics,
    structured_signals: sparseSignals(),
  });

  const campaignInput = clone(CAMPAIGN_FIXTURE);
  const goodFit = computeCampaignFit({
    campaign: campaignInput,
    creator: clone(GOOD_CREATOR),
    calculated_at: normalizedCalculatedAt,
  });
  const conflictFit = computeCampaignFit({
    campaign: clone(CAMPAIGN_FIXTURE),
    creator: clone(COMPETITOR_CONFLICT_CREATOR),
    calculated_at: normalizedCalculatedAt,
  });
  const missingDemographicsFit = computeCampaignFit({
    campaign: clone(CAMPAIGN_FIXTURE),
    creator: clone(MISSING_DEMOGRAPHICS_CREATOR),
    calculated_at: normalizedCalculatedAt,
  });
  const highSaturationFit = computeCampaignFit({
    campaign: clone(CAMPAIGN_FIXTURE),
    creator: clone(HIGH_SATURATION_CREATOR),
    calculated_at: normalizedCalculatedAt,
  });
  const competitorControlFit = computeCampaignFit({
    campaign: clone(CAMPAIGN_FIXTURE),
    creator: competitorControlCreator(),
    calculated_at: normalizedCalculatedAt,
  });

  const stableFinite = finiteNumbers(small);
  const scaledScoreDelta = Math.abs(small.score.overall_score - scaledSmall.score.overall_score);
  const scaledComponentDelta = componentScoreDelta(small, scaledSmall);
  const viralScoreDelta = Math.abs(viral.score.overall_score - viralWithoutLastPost.score.overall_score);
  const spikeText = JSON.stringify(spike);
  const cases = [
    makeCase(
      'small-stable-baseline',
      'A small stable creator remains scoreable, but sparse history and unavailable optional signals keep confidence below a high-confidence threshold.',
      {
        ...scoreSummary(small),
        score_versions: scoreVersionSummary(small),
      },
      stableFinite.length === 0
        && small.score.evidence_state === 'derived'
        && small.score.overall_score !== null
        && small.score.confidence_score < 80
        && small.score.data_coverage < 100,
      small.score.input_snapshot_keys,
    ),
    makeCase(
      'follower-scale-normalization',
      'A large follower count must not by itself dominate quality; normalized engagement remains comparable and the score has no raw follower shortcut.',
      {
        large_fixture: scoreSummary(large),
        scale_transformed_fixture: scoreSummary(scaledSmall),
        score_delta_vs_scale_transformed: scaledScoreDelta,
        max_component_delta_vs_scale_transformed: scaledComponentDelta,
        raw_follower_field_present: Object.prototype.hasOwnProperty.call(scaledSmall.score, 'followers'),
      },
      scaledScoreDelta <= 0.000001
        && scaledComponentDelta <= 0.000001
        && !Object.prototype.hasOwnProperty.call(scaledSmall.score, 'followers'),
      [...small.score.input_snapshot_keys, ...scaledSmall.score.input_snapshot_keys],
    ),
    makeCase(
      'viral-outlier-resistance',
      'A viral post is visible as an outlier while median/trimmed statistics keep the score within a bounded distance of the same series without that post.',
      {
        ...scoreSummary(viral),
        likes_mean: viral.analytics.likes.mean,
        likes_median: viral.analytics.likes.median,
        likes_trimmed_mean: viral.analytics.likes.trimmedMean,
        likes_outlier_ratio: viral.analytics.outliers.likes.outlierRatio,
        score_delta_without_viral_post: viralScoreDelta,
      },
      viral.analytics.likes.mean > viral.analytics.likes.median
        && viral.analytics.likes.trimmedMean !== null
        && viral.analytics.outliers.likes.viralOutlierRatio > 0
        && viralScoreDelta <= 15,
      viral.score.input_snapshot_keys,
    ),
    makeCase(
      'follower-spike-pattern-only',
      'A suspicious-looking follower spike is a bounded growth-pattern signal, not a factual fake-follower claim.',
      {
        ...scoreSummary(spike),
        anomaly_ratio: spike.analytics.growthAnomalies.anomalyRatio,
        anomaly_interpretations: spike.analytics.growthAnomalies.anomalies.map((item) => item.interpretation),
        contains_factual_fake_follower_phrase: FACTUAL_FAKE_FOLLOWER_PATTERN.test(spikeText),
      },
      spike.analytics.growthAnomalies.anomalyRatio > 0
        && spike.analytics.growthAnomalies.anomalies.length > 0
        && spike.analytics.growthAnomalies.anomalies.every((item) => item.interpretation === 'growth_pattern_anomaly')
        && spike.score.component_scores.growth_integrity.score < 100
        && spike.score.component_scores.risk.score < 100
        && !FACTUAL_FAKE_FOLLOWER_PATTERN.test(spikeText),
      spike.score.input_snapshot_keys,
    ),
    makeCase(
      'partial-and-missing-metrics',
      'Missing views and incomplete engagement remain unavailable/null, reduce coverage, and never become an observed zero.',
      {
        no_views: {
          video_views_state: noViews.analytics.videoPerformance.views.evidenceState,
          video_views_median: noViews.analytics.videoPerformance.views.median,
          views_follower_ratio: noViews.analytics.engagement.viewsFollowerRatio.median,
          views_follower_coverage: noViews.analytics.engagement.viewsFollowerRatio.coverage.ratio,
          data_coverage: noViews.score.data_coverage,
        },
        with_views: {
          video_views_state: withViews.analytics.videoPerformance.views.evidenceState,
          views_follower_coverage: withViews.analytics.engagement.viewsFollowerRatio.coverage.ratio,
          data_coverage: withViews.score.data_coverage,
        },
        incomplete: {
          engagement_state: incomplete.analytics.engagement.evidenceState,
          engagement_rate: incomplete.analytics.engagement.engagementRate.mean,
          data_coverage: incomplete.score.data_coverage,
        },
      },
      noViews.analytics.videoPerformance.views.evidenceState === 'unavailable'
        && noViews.analytics.videoPerformance.views.median === null
        && noViews.analytics.engagement.viewsFollowerRatio.median === null
        && noViews.analytics.engagement.viewsFollowerRatio.coverage.ratio < withViews.analytics.engagement.viewsFollowerRatio.coverage.ratio
        && withViews.analytics.videoPerformance.views.evidenceState === 'derived'
        && incomplete.analytics.engagement.evidenceState === 'unavailable'
        && incomplete.analytics.engagement.engagementRate.mean === null,
      [...noViews.score.input_snapshot_keys, ...incomplete.score.input_snapshot_keys],
    ),
    makeCase(
      'short-history-confidence',
      'Few posts do not manufacture cadence/outlier statistics and confidence is lower than the fuller baseline.',
      {
        ...scoreSummary(fewPosts),
        posting_interval_state: fewPosts.analytics.postingCadence.postingInterval.evidenceState,
        outlier_ratio: fewPosts.analytics.likes.outlierRatio,
        baseline_confidence: small.score.confidence_score,
      },
      fewPosts.analytics.postingCadence.postingInterval.evidenceState === 'unavailable'
        && fewPosts.analytics.postingCadence.postingInterval.median === null
        && fewPosts.analytics.likes.outlierRatio === null
        && fewPosts.score.confidence_score < small.score.confidence_score
        && fewPosts.score.confidence_score < 60,
      fewPosts.score.input_snapshot_keys,
    ),
    makeCase(
      'irregular-engagement-volatility',
      'Irregular engagement produces an explicit robust volatility/outlier signal without non-finite arithmetic.',
      {
        ...scoreSummary(irregular),
        engagement_cv: irregular.analytics.volatility.engagementRate.coefficientOfVariation,
        likes_outlier_ratio: irregular.analytics.outliers.likes.outlierRatio,
        non_finite_paths: finiteNumbers(irregular),
      },
      finiteNumbers(irregular).length === 0
        && irregular.analytics.volatility.engagementRate.coefficientOfVariation > 0.8
        && irregular.analytics.outliers.likes.outlierRatio > 0,
      irregular.score.input_snapshot_keys,
    ),
    makeCase(
      'zero-denominator-extreme',
      'Observed zero counts remain zero, while ratios with zero denominators are unavailable/null rather than divided or silently imputed.',
      {
        likes_mean: zeroDenominator.analytics.likes.mean,
        engagement_rate_state: zeroDenominator.analytics.engagement.engagementRate.evidenceState,
        engagement_rate_mean: zeroDenominator.analytics.engagement.engagementRate.mean,
        follower_growth_rate: zeroDenominator.analytics.profileGrowth.followers.relativeGrowthRate.value,
        non_finite_paths: finiteNumbers(zeroDenominator),
      },
      finiteNumbers(zeroDenominator).length === 0
        && zeroDenominator.analytics.likes.mean === 0
        && zeroDenominator.analytics.engagement.engagementRate.evidenceState === 'unavailable'
        && zeroDenominator.analytics.engagement.engagementRate.mean === null
        && zeroDenominator.analytics.profileGrowth.followers.relativeGrowthRate.value === null,
      zeroDenominator.score.input_snapshot_keys,
    ),
    makeCase(
      'score-confidence-separation',
      'A sparse creator can receive a bounded score from observed signals without receiving high confidence; confidence reflects history, sample size, and coverage.',
      {
        ...scoreSummary(sparseHighSignal),
        confidence_factors: sparseHighSignal.score.confidence_factors,
      },
      sparseHighSignal.score.overall_score !== null
        && sparseHighSignal.score.overall_score > sparseHighSignal.score.confidence_score
        && sparseHighSignal.score.confidence_score < 65
        && sparseHighSignal.score.confidence_factors.media_history_length < 1
        && sparseHighSignal.score.confidence_factors.comment_sample_size < 0.1,
      sparseHighSignal.score.input_snapshot_keys,
    ),
    makeCase(
      'campaign-fit-separation-and-missing-demographics',
      'Campaign Fit is a separate versioned result; competitor conflict lowers fit, missing demographics lower confidence/unavailability, and high saturation is penalized.',
      {
        good: campaignSummary(goodFit),
        conflict: campaignSummary(conflictFit),
        competitor_control: campaignSummary(competitorControlFit),
        missing_demographics: campaignSummary(missingDemographicsFit),
        high_saturation: campaignSummary(highSaturationFit),
        has_overall_score_field: Object.prototype.hasOwnProperty.call(goodFit, 'overall_score'),
        fit_versions: fitVersionSummary(goodFit),
      },
      goodFit.campaign_fit_score > conflictFit.campaign_fit_score
        && conflictFit.campaign_fit_components.competitor_conflict.score === 0
        && conflictFit.campaign_fit_score < competitorControlFit.campaign_fit_score
        && competitorControlFit.campaign_fit_components.competitor_conflict.score === 100
        && missingDemographicsFit.campaign_fit_confidence < goodFit.campaign_fit_confidence
        && missingDemographicsFit.campaign_fit_components.audience_fit.evidence_state === 'unavailable'
        && highSaturationFit.campaign_fit_score < missingDemographicsFit.campaign_fit_score
        && !Object.prototype.hasOwnProperty.call(goodFit, 'overall_score'),
      [
        ...goodFit.provenance.map((item) => item.source_ref),
        ...conflictFit.provenance.map((item) => item.source_ref),
        ...competitorControlFit.provenance.map((item) => item.source_ref),
        ...missingDemographicsFit.provenance.map((item) => item.source_ref),
        ...highSaturationFit.provenance.map((item) => item.source_ref),
      ],
    ),
  ];

  const divergences = cases
    .filter((item) => !item.passed)
    .map((item) => ({
      case_id: item.id,
      expected_behavior: item.expected_behavior,
      actual_behavior: item.actual_behavior,
    }));

  return deepFreeze({
    contract_version: CALIBRATION_CONTRACT_VERSION,
    dataset_version: CALIBRATION_DATASET_VERSION,
    calculated_at: normalizedCalculatedAt,
    algorithms: {
      analytics: ANALYTICS_ALGORITHM_VERSION,
      scoring: SCORING_ALGORITHM_VERSION,
      scoring_weights: SCORING_WEIGHTS_VERSION,
      campaign_fit: CAMPAIGN_FIT_ALGORITHM_VERSION,
      campaign_fit_weights: CAMPAIGN_FIT_WEIGHTS_VERSION,
    },
    status: divergences.length === 0 ? 'passed' : 'diverged',
    cases,
    divergences,
    adjustments: [],
    limitations: [
      'Synthetic fixtures validate deterministic invariants and policy guardrails, not commercial predictive accuracy.',
      'No external public creator data or live provider calls are included in this calibration artifact.',
      'Follower-tier benchmarks remain unavailable until a sufficiently representative internal dataset is approved.',
      'Provider reliability and freshness are exercised by score inputs but require runtime telemetry for population-level calibration.',
    ],
  });
}

export const __testing = Object.freeze({
  finiteNumbers,
  sparseSignals,
  scoreSummary,
  campaignSummary,
  factualFakeFollowerPattern: FACTUAL_FAKE_FOLLOWER_PATTERN,
});
