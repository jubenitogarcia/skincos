import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CAMPAIGN_FIT_ALGORITHM_VERSION,
  CAMPAIGN_FIT_WEIGHTS_VERSION,
  CampaignFitError,
  computeCampaignFit,
  computeAndPersistCampaignFit,
  normalizeCampaignBrief,
  rankCampaignCreators,
} from '../campaign-fit.mjs';
import {
  CAMPAIGN_FIXTURE,
  COMPETITOR_CONFLICT_CREATOR,
  GOOD_CREATOR,
  HIGH_SATURATION_CREATOR,
  INFERRED_CONTENT_CREATOR,
  MEDIUM_GOOD_FIT,
  MISSING_DEMOGRAPHICS_CREATOR,
  unavailable,
} from './fixtures/campaign-fit-golden-fixtures.mjs';

const CALCULATED_AT = '2026-08-12T12:00:00.000Z';

function compute(creator, campaign = CAMPAIGN_FIXTURE) {
  return computeCampaignFit({ campaign, creator, calculated_at: CALCULATED_AT });
}

test('computes a versioned deterministic fit with structured components and provenance', () => {
  const result = compute(GOOD_CREATOR);

  assert.equal(result.contract_version, 'influencer-intelligence/campaign-fit/v1');
  assert.equal(result.algorithm_version, CAMPAIGN_FIT_ALGORITHM_VERSION);
  assert.equal(result.weights_version, CAMPAIGN_FIT_WEIGHTS_VERSION);
  assert.equal(result.campaign_fit_score > 70, true);
  assert.equal(result.campaign_fit_confidence > 50, true);
  assert.equal(result.data_coverage > 70, true);
  assert.equal(result.campaign_fit_components.topic_affinity.score > 0, true);
  assert.equal(result.campaign_fit_components.engagement_quality.score, 84);
  assert.equal(result.provenance.length > 0, true);
  assert.equal(result.providers.includes('meta-graph'), true);
  assert.equal(result.model_version, null);
});

test('same brief, evidence, and timestamp are bit-for-bit deterministic', () => {
  assert.deepEqual(compute(GOOD_CREATOR), compute(structuredClone(GOOD_CREATOR)));
});

test('missing demographics reduce confidence and remain unavailable instead of being inferred', () => {
  const complete = compute(GOOD_CREATOR);
  const missing = compute(MISSING_DEMOGRAPHICS_CREATOR);

  assert.equal(missing.campaign_fit_components.audience_fit.score, null);
  assert.equal(missing.campaign_fit_components.audience_fit.evidence_state, 'unavailable');
  assert.equal(missing.limitations.includes('missing_demographics_reduce_confidence'), true);
  assert.equal(missing.campaign_fit_confidence < complete.campaign_fit_confidence, true);
  assert.equal(missing.campaign_fit_components.audience_fit.explanation.limitations.includes('audience_demographics_unavailable'), true);
  assert.equal(JSON.stringify(missing).includes('inferred_demographics'), false);
});

test('competitor conflicts are explicit and reduce only campaign fit, not overall creator quality', () => {
  const result = compute(COMPETITOR_CONFLICT_CREATOR);

  assert.deepEqual(result.competitor_conflicts, ['competitor-x']);
  assert.equal(result.campaign_fit_components.competitor_conflict.score, 0);
  assert.equal(result.campaign_fit_components.competitor_conflict.explanation.code, 'competitor_conflict_detected');
  assert.equal(Object.hasOwn(result, 'overall_score'), false);
});

test('high commercial saturation is bounded and does not become unavailable or zero-filled', () => {
  const normal = compute(GOOD_CREATOR);
  const saturated = compute(HIGH_SATURATION_CREATOR);

  assert.equal(saturated.campaign_fit_components.commercial_saturation.score < normal.campaign_fit_components.commercial_saturation.score, true);
  assert.equal(saturated.campaign_fit_components.commercial_saturation.score > 0, true);
  assert.equal(saturated.campaign_fit_components.commercial_saturation.evidence_state, 'derived');
});

test('ranking is bounded, deterministic, and score-first only within the supplied campaign', () => {
  const ranked = rankCampaignCreators({ campaign: CAMPAIGN_FIXTURE, creators: [MEDIUM_GOOD_FIT, GOOD_CREATOR], calculated_at: CALCULATED_AT });

  assert.deepEqual(ranked.map((item) => item.rank), [1, 2]);
  assert.equal(ranked[0].creator_key, 'creator-good-fit');
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked.every((item) => Object.hasOwn(item, 'campaign_fit_score')), true);
});

test('inferred evidence stays labeled and carries model version', () => {
  const result = compute(INFERRED_CONTENT_CREATOR);

  assert.equal(result.evidence_state, 'inferred');
  assert.equal(result.data_classification, 'inferred');
  assert.equal(result.model_version, 'content-model/v1');
  assert.equal(result.campaign_fit_components.topic_affinity.evidence_state, 'inferred');
  assert.equal(result.campaign_fit_components.topic_affinity.model_versions[0], 'content-model/v1');
});

test('missing evidence is value-free and an empty evidence set cannot produce a score', () => {
  const noEvidence = {
    creator_key: 'creator-no-evidence',
    signals: {
      topics: unavailable('topics'),
      product_categories: unavailable('product-categories'),
      commercial_saturation: unavailable('commercial-saturation'),
      engagement_quality: unavailable('engagement-quality'),
    },
  };
  const result = compute(noEvidence);

  assert.equal(result.campaign_fit_score, null);
  assert.equal(result.campaign_fit_confidence, 0);
  assert.equal(result.evidence_state, 'unavailable');
  assert.equal(result.campaign_fit_components.engagement_quality.score, null);
  assert.equal(result.campaign_fit_components.engagement_quality.contribution, null);
});

test('brief and evidence boundaries reject raw PII, arbitrary fields, and missing criteria', () => {
  assert.throws(() => normalizeCampaignBrief({ campaign_key: 'campaign-1', email: 'not-allowed@example.test', category: 'skincare' }), (error) => error instanceof CampaignFitError && error.code === 'CAMPAIGN_BRIEF_FIELD_FORBIDDEN');
  assert.throws(() => normalizeCampaignBrief({ campaign_key: 'campaign-1' }), (error) => error instanceof CampaignFitError && error.code === 'CAMPAIGN_BRIEF_HAS_NO_CRITERIA');
  assert.throws(() => computeCampaignFit({ campaign: CAMPAIGN_FIXTURE, creator: { creator_key: 'creator-1', signals: { engagement_quality: { value: 60, evidence_state: 'unavailable', confidence: 0, evidence_refs: [], providers: [] } } }, calculated_at: CALCULATED_AT }), (error) => error instanceof CampaignFitError && error.code === 'ENGAGEMENT_QUALITY_UNAVAILABLE_VALUE_FORBIDDEN');
});

test('persists a new append-only fit envelope with components, weights, and provenance', async () => {
  const calls = [];
  const repository = {
    async upsertCampaign(input) { calls.push(['campaign', input]); return { campaign_key: input.campaignKey }; },
    async recordCampaignFit(input) { calls.push(['fit', input]); return { fit_key: input.fitKey }; },
  };
  const persisted = await computeAndPersistCampaignFit({
    repository,
    campaign: CAMPAIGN_FIXTURE,
    creator: GOOD_CREATOR,
    fit_key: 'fit:campaign-skin-serum-001:creator-good-fit:1',
    ingest_key: 'fit-ingest:campaign-skin-serum-001:creator-good-fit:1',
    retention_policy_version: 'retention/v1',
    calculated_at: CALCULATED_AT,
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[1][1].weightsVersion, CAMPAIGN_FIT_WEIGHTS_VERSION);
  assert.equal(calls[1][1].components.topic_affinity.score > 0, true);
  assert.equal(calls[1][1].coverageExpected > 0, true);
  assert.equal(persisted.persistence.fit.fit_key, 'fit:campaign-skin-serum-001:creator-good-fit:1');
});
