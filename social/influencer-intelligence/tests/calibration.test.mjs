import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CALIBRATION_CALCULATED_AT,
  CALIBRATION_CONTRACT_VERSION,
  CALIBRATION_DATASET_VERSION,
  runInfluencerCalibration,
} from '../calibration.mjs';

const EXPECTED_CASES = [
  'small-stable-baseline',
  'follower-scale-normalization',
  'viral-outlier-resistance',
  'follower-spike-pattern-only',
  'partial-and-missing-metrics',
  'short-history-confidence',
  'irregular-engagement-volatility',
  'zero-denominator-extreme',
  'score-confidence-separation',
  'campaign-fit-separation-and-missing-demographics',
];

function assertNoNonFinite(value, path = 'result') {
  if (typeof value === 'number') {
    assert.equal(Number.isFinite(value), true, `${path} must be finite`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertNoNonFinite(child, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, child]) => assertNoNonFinite(child, `${path}.${key}`));
  }
}

test('calibration suite passes every deterministic policy guardrail', () => {
  const report = runInfluencerCalibration();

  assert.equal(report.contract_version, CALIBRATION_CONTRACT_VERSION);
  assert.equal(report.dataset_version, CALIBRATION_DATASET_VERSION);
  assert.equal(report.calculated_at, CALIBRATION_CALCULATED_AT);
  assert.equal(report.status, 'passed');
  assert.deepEqual(report.cases.map((item) => item.id), EXPECTED_CASES);
  assert.ok(report.cases.every((item) => item.passed));
  assert.deepEqual(report.divergences, []);
  assert.deepEqual(report.adjustments, []);
  assertNoNonFinite(report);
});

test('calibration is bit-for-bit deterministic for a fixed timestamp and dataset', () => {
  const first = runInfluencerCalibration({ calculated_at: '2026-08-12T12:34:56.000Z' });
  const second = runInfluencerCalibration({ calculated_at: '2026-08-12T12:34:56.000Z' });

  assert.deepEqual(first, second);
});

test('calibration records versioned algorithms and does not tune weights or use live providers', () => {
  const report = runInfluencerCalibration();

  assert.equal(report.algorithms.analytics, 'influencer-intelligence-analytics/v1');
  assert.equal(report.algorithms.scoring, 'influencer-intelligence-scoring/v0');
  assert.equal(report.algorithms.scoring_weights, 'influencer-intelligence-scoring-weights/v0');
  assert.equal(report.algorithms.campaign_fit, 'influencer-intelligence-campaign-fit/v1');
  assert.equal(report.algorithms.campaign_fit_weights, 'influencer-intelligence-campaign-fit-weights/v1');
  assert.deepEqual(report.adjustments, []);
  assert.equal(report.limitations.some((item) => item.includes('external public creator data')), true);
  assert.equal(report.limitations.some((item) => item.includes('commercial predictive accuracy')), true);
});

test('committed calibration report matches generated actual values', () => {
  const reportPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'CALIBRATION.md');
  const committedReport = fs.readFileSync(reportPath, 'utf8');
  const report = runInfluencerCalibration();
  const actual = new Map(report.cases.map((item) => [item.id, item.actual_behavior]));
  const tick = '`';
  const contains = (text, label) => assert.equal(committedReport.includes(text), true, label);

  const stable = actual.get('small-stable-baseline');
  contains(`Score ${tick}${stable.overall_score.toFixed(3)}${tick}, confidence ${tick}${stable.confidence_score}${tick}, coverage ${tick}${stable.data_coverage}${tick}`, 'small stable row drifted');
  const scale = actual.get('follower-scale-normalization');
  contains(`Large creator score ${tick}${scale.overall_score.toFixed(3)}${tick} vs small ${tick}57.053${tick}; engagement-quality delta ${tick}${scale.engagement_quality_delta_vs_small.toFixed(3)}${tick}`, 'follower scale row drifted');
  const viral = actual.get('viral-outlier-resistance');
  contains(`Likes mean ${tick}${viral.likes_mean.toFixed(3)}${tick}, median ${tick}${viral.likes_median}${tick}, trimmed mean ${tick}${viral.likes_trimmed_mean.toFixed(3)}${tick}; score delta after removing viral post ${tick}${viral.score_delta_without_viral_post.toFixed(3)}${tick}`, 'viral row drifted');
  const spike = actual.get('follower-spike-pattern-only');
  contains(`Anomaly ratio ${tick}${spike.anomaly_ratio}${tick}; interpretation`, 'spike row drifted');
  const partial = actual.get('partial-and-missing-metrics');
  contains(`No-views coverage ${tick}${partial.no_views.data_coverage}${tick}; incomplete-series coverage ${tick}${partial.incomplete.data_coverage}${tick}`, 'partial row drifted');
  const short = actual.get('short-history-confidence');
  contains(`Confidence ${tick}${short.confidence_score}${tick}, coverage ${tick}${short.data_coverage}${tick}`, 'short history row drifted');
  const irregular = actual.get('irregular-engagement-volatility');
  contains(`Engagement CV ${tick}${irregular.engagement_cv.toFixed(4)}${tick}, likes outlier ratio ${tick}${irregular.likes_outlier_ratio}${tick}`, 'irregular row drifted');
  const zero = actual.get('zero-denominator-extreme');
  contains(`Likes mean ${tick}${zero.likes_mean}${tick}; engagement rate unavailable/null; growth rate unavailable/null`, 'zero denominator row drifted');
  const separation = actual.get('score-confidence-separation');
  contains(`Score ${tick}${separation.overall_score.toFixed(3)}${tick}, confidence ${tick}${separation.confidence_score}${tick}, coverage ${tick}${separation.data_coverage}${tick}`, 'score confidence row drifted');
  const campaign = actual.get('campaign-fit-separation-and-missing-demographics');
  contains(`Good ${tick}${campaign.good.campaign_fit_score.toFixed(3)}/${campaign.good.campaign_fit_confidence.toFixed(3)}/${campaign.good.data_coverage}${tick}; conflict ${tick}${campaign.conflict.campaign_fit_score.toFixed(3)}/${campaign.conflict.campaign_fit_confidence.toFixed(3)}/${campaign.conflict.data_coverage}${tick}`, 'campaign fit row drifted');
});
