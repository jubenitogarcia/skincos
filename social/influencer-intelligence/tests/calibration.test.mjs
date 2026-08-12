import assert from 'node:assert/strict';
import test from 'node:test';

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

