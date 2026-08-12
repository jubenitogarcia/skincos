import assert from 'node:assert/strict';
import test from 'node:test';

import { computeInfluencerAnalytics } from '../analytics.mjs';
import {
  SCORING_ALGORITHM_VERSION,
  SCORE_THRESHOLDS,
  SCORING_WEIGHTS_VERSION,
  computeInfluencerScore,
} from '../scoring.mjs';
import { GOLDEN_FIXTURES } from './fixtures/analytics-golden-fixtures.mjs';

function analyticsFor(fixture) {
  return computeInfluencerAnalytics(structuredClone(fixture));
}

function scoreFor(fixture, extra = {}) {
  return computeInfluencerScore({ analytics: analyticsFor(fixture), ...extra });
}

function assertFiniteNumbers(value, path = 'result') {
  if (typeof value === 'number') {
    assert.equal(Number.isFinite(value), true, `${path} must be finite`);
  } else if (Array.isArray(value)) {
    value.forEach((child, index) => assertFiniteNumbers(child, `${path}[${index}]`));
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, child]) => assertFiniteNumbers(child, `${path}.${key}`));
  }
}

test('stable creator receives a versioned deterministic score with separate confidence and coverage', () => {
  const result = scoreFor(GOLDEN_FIXTURES.smallStable);

  assert.equal(result.algorithm_version, SCORING_ALGORITHM_VERSION);
  assert.equal(result.weights_version, SCORING_WEIGHTS_VERSION);
  assert.equal(result.evidence_state, 'derived');
  assert.equal(typeof result.overall_score, 'number');
  assert.equal(typeof result.confidence_score, 'number');
  assert.equal(typeof result.data_coverage, 'number');
  assert.equal(result.component_scores.engagement_quality.evidence_state, 'derived');
  assert.equal(result.component_scores.comment_quality.evidence_state, 'unavailable');
  assert.ok(result.confidence_score < 80, 'sparse and stale synthetic history must not look highly confident');
  assert.equal(result.explanations.length, 9);
  assertFiniteNumbers(result);
});

test('large follower count does not dominate normalized quality components', () => {
  const small = scoreFor(GOLDEN_FIXTURES.smallStable);
  const large = scoreFor(GOLDEN_FIXTURES.largeCreator);

  assert.ok(Math.abs(small.component_scores.engagement_quality.score - large.component_scores.engagement_quality.score) < 35);
  assert.equal(large.component_scores.engagement_quality.explanation.inputs.median_engagement_rate !== null, true);
  assert.equal(Object.prototype.hasOwnProperty.call(large, 'followers'), false);
  assertFiniteNumbers(large);
});

test('viral media remains a bounded pattern signal and does not become the whole score', () => {
  const result = scoreFor(GOLDEN_FIXTURES.viralPost);

  assert.ok(result.component_scores.risk.score < 100);
  assert.equal(result.component_scores.risk.explanation.code, 'bounded_pattern_risk_not_fake_followers_claim');
  assert.equal(result.component_scores.risk.explanation.limitations.includes('pattern_signals_are_not_a_fake_followers_determination'), true);
  assert.ok(result.overall_score < 100);
  assertFiniteNumbers(result);
});

test('growth spike is penalized as a bounded anomaly without a fake-follower conclusion', () => {
  const result = scoreFor(GOLDEN_FIXTURES.followerSpike);

  assert.equal(result.component_scores.growth_integrity.evidence_state, 'derived');
  assert.equal(result.component_scores.growth_integrity.explanation.code, 'growth_anomaly_ratio_penalty');
  assert.equal(JSON.stringify(result).includes('fake follower'), false);
  assert.equal(JSON.stringify(result).includes('fake_followers'), true);
  assertFiniteNumbers(result);
});

test('missing views, comments, and short history reduce coverage/confidence without zero filling', () => {
  const result = scoreFor(GOLDEN_FIXTURES.noViews);

  assert.equal(result.component_scores.comment_quality.score, null);
  assert.equal(result.component_scores.commercial_saturation.score, null);
  assert.equal(result.component_scores.brand_fit.score, null);
  assert.ok(result.data_coverage < 100);
  assert.ok(result.confidence_score < 70);
  assert.equal(result.component_scores.content_performance.explanation.inputs.median_views_follower_ratio, null);
  assertFiniteNumbers(result);
});

test('a one-profile, one-post creator receives an objective confidence cap', () => {
  const result = scoreFor(GOLDEN_FIXTURES.fewPosts);

  assert.ok(result.confidence_score <= SCORE_THRESHOLDS.shortHistoryConfidenceCap * 100);
  assert.equal(result.confidence_factors.short_history_gate, SCORE_THRESHOLDS.shortHistoryConfidenceCap);
  assert.ok(result.limitations.includes('confidence_limited_by_history_freshness_provider_or_metric_coverage'));
  assertFiniteNumbers(result);
});

test('missing outlier series remain unavailable instead of entering risk as zero', () => {
  const result = scoreFor(GOLDEN_FIXTURES.irregularEngagement);
  const inputs = result.component_scores.risk.explanation.inputs;

  assert.equal(result.component_scores.risk.evidence_state, 'derived');
  assert.equal(inputs.views_viral_outlier_ratio, null);
  assert.equal(inputs.outlier_penalty, inputs.likes_viral_outlier_ratio * 20);
  assertFiniteNumbers(result);
});

test('structured optional signals retain evidence state, model version, and bounded references', () => {
  const result = scoreFor(GOLDEN_FIXTURES.smallStable, {
    structured_signals: {
      comment_quality: {
        score: 74,
        evidence_state: 'inferred',
        confidence: 0.62,
        evidence_refs: ['comment-sample-001'],
        model_version: 'comments-model/v1',
        sample_size: 50,
      },
      commercial_saturation: {
        score: 38,
        evidence_state: 'derived',
        confidence: 0.8,
        evidence_refs: ['content-analysis-001'],
      },
      brand_fit: {
        score: 82,
        evidence_state: 'derived',
        confidence: 0.9,
        evidence_refs: ['campaign-brief-001'],
      },
    },
  });

  assert.equal(result.component_scores.comment_quality.evidence_state, 'inferred');
  assert.equal(result.component_scores.comment_quality.model_version, 'comments-model/v1');
  assert.equal(result.component_scores.comment_quality.score, 74);
  assert.equal(result.component_scores.brand_fit.score, 82);
  assert.ok(result.data_coverage > scoreFor(GOLDEN_FIXTURES.smallStable).data_coverage);
  assertFiniteNumbers(result);
});

test('same inputs and calculated timestamp are bit-for-bit deterministic', () => {
  const input = { analytics: analyticsFor(GOLDEN_FIXTURES.viralPost) };
  assert.deepEqual(computeInfluencerScore(input), computeInfluencerScore(structuredClone(input)));
});

test('input fingerprint binds confidence and evidence metadata, not only component values', () => {
  const fixture = GOLDEN_FIXTURES.smallStable;
  const base = scoreFor(fixture, {
    structured_signals: {
      comment_quality: {
        score: 74,
        evidence_state: 'inferred',
        confidence: 0.62,
        evidence_refs: ['comment-sample-001'],
        model_version: 'comments-model/v1',
        sample_size: 50,
      },
    },
  });
  const changed = scoreFor(fixture, {
    structured_signals: {
      comment_quality: {
        score: 74,
        evidence_state: 'inferred',
        confidence: 0.21,
        evidence_refs: ['comment-sample-001'],
        model_version: 'comments-model/v1',
        sample_size: 50,
      },
    },
  });

  assert.notEqual(base.input_fingerprint, changed.input_fingerprint);
});

test('input fingerprint binds structured-signal provider provenance', () => {
  const fixture = GOLDEN_FIXTURES.smallStable;
  const base = scoreFor(fixture, {
    structured_signals: {
      comment_quality: {
        score: 74,
        evidence_state: 'derived',
        confidence: 0.62,
        evidence_refs: ['comment-sample-001'],
        providers: ['comments-engine'],
        sample_size: 50,
      },
    },
  });
  const changed = scoreFor(fixture, {
    structured_signals: {
      comment_quality: {
        score: 74,
        evidence_state: 'derived',
        confidence: 0.62,
        evidence_refs: ['comment-sample-001'],
        providers: ['alternate-comments-engine'],
        sample_size: 50,
      },
    },
  });

  assert.notEqual(base.input_fingerprint, changed.input_fingerprint);
});

test('unavailable profile and media provenance cannot satisfy the short-history gate', () => {
  const fixture = structuredClone(GOLDEN_FIXTURES.fewPosts);
  fixture.profileSnapshots = [
    ...fixture.profileSnapshots,
    { ...fixture.profileSnapshots[0], snapshotKey: 'profile-unavailable-1', evidenceState: 'unavailable', followersCount: null, followingCount: null, mediaCount: null },
    { ...fixture.profileSnapshots[0], snapshotKey: 'profile-unavailable-2', evidenceState: 'unavailable', followersCount: null, followingCount: null, mediaCount: null },
  ];
  const result = scoreFor(fixture);

  assert.equal(result.confidence_factors.short_history_gate, SCORE_THRESHOLDS.shortHistoryConfidenceCap);
  assert.ok(result.confidence_score <= SCORE_THRESHOLDS.shortHistoryConfidenceCap * 100);
});

test('unavailable analytics cannot produce an overall score or confidence', () => {
  const analytics = analyticsFor({
    creatorKey: 'creator-unavailable',
    computedAt: '2026-02-01T00:00:00.000Z',
    profileSnapshots: [],
    mediaSnapshots: [],
  });
  const result = computeInfluencerScore({ analytics });

  assert.equal(result.overall_score, null);
  assert.equal(result.confidence_score, 0);
  assert.equal(result.evidence_state, 'unavailable');
  assertFiniteNumbers(result);
});

test('inferred optional signals require closed evidence and model metadata', () => {
  assert.throws(() => scoreFor(GOLDEN_FIXTURES.smallStable, {
    structured_signals: {
      comment_quality: {
        score: 70,
        evidence_state: 'inferred',
        confidence: 0.5,
        evidence_refs: ['comment-sample-001'],
      },
    },
  }), (error) => error.code === 'INFERRED_SIGNAL_MODEL_REQUIRED');
});
