import assert from 'node:assert/strict';
import test from 'node:test';

import { createInfluencerIntelligenceReadService } from '../runtime/read-service.mjs';

const now = '2026-08-12T12:00:00.000Z';

const profileRow = {
  creator_key: 'creator:one',
  canonical_handle: 'creator.one',
  registry_state: 'candidate',
  monitoring_enabled: false,
  monitoring_interval_hours: null,
  updated_at: now,
  provider: 'meta-graph',
  identity_provider: 'meta-graph',
  observed_at: now,
  retrieved_at: now,
  followers_count: 12_345,
  following_count: 123,
  media_count: 42,
  is_private: false,
  is_verified: false,
  coverage_available: 6,
  coverage_expected: 6,
  freshness_status: 'fresh',
};

function fakeQueryable() {
  const profile = { ...profileRow };
  return {
    async query(sql) {
      if (sql.includes('FROM influencer_intelligence.creator_registry r')) return { rows: [profile] };
      if (sql.includes('FROM influencer_intelligence.creator_profile_snapshot')) return { rows: [{
        snapshot_key: 'snapshot:one', creator_key: 'creator:one', provider: 'meta-graph', evidence_state: 'observed', observed_at: now, retrieved_at: now,
        followers_count: 12_345, following_count: 123, media_count: 42, is_private: false, is_verified: false,
        coverage_available: 5, coverage_expected: 5, freshness_status: 'fresh', freshness_age_seconds: 0,
      }] };
      if (sql.includes('FROM influencer_intelligence.creator_media_snapshot')) return { rows: [{
        snapshot_key: 'media-snapshot:one', media_key: 'media:one', creator_key: 'creator:one', provider: 'meta-graph', evidence_state: 'observed', observed_at: now, retrieved_at: now,
        likes_count: 350, comments_count: 12, shares_count: null, saves_count: null, views_count: null, reach_count: null, impressions_count: null,
        coverage_available: 2, coverage_expected: 7, freshness_status: 'fresh', media_kind: 'reel', published_at: '2026-08-10T12:00:00.000Z',
      }] };
      if (sql.includes('FROM influencer_intelligence.creator_analysis')) return { rows: [{
        analysis_key: 'analysis:one', creator_key: 'creator:one', window_start: '2026-08-01T00:00:00.000Z', window_end: now,
        evidence_state: 'derived', confidence: 0.55, coverage_available: 5, coverage_expected: 8, algorithm_version: 'influencer-intelligence-analytics/v1',
        model_version: null, providers: ['meta-graph'], provenance: { entries: [] }, computed_at: now,
        analysis_metrics: {
          postingCadence: { postsPerDay: { value: 1.5, evidenceState: 'derived', limitations: [] } },
          likes: { median: 350, evidenceState: 'derived', limitations: [] },
          comments: { median: 12, evidenceState: 'derived', limitations: [] },
          engagement: { engagementRate: { median: 0.029, evidenceState: 'derived', limitations: [] }, medianViews: { value: null, evidenceState: 'unavailable', limitations: ['views_unavailable'] } },
          profileGrowth: { followers: { growthVelocity: { median: 20, evidenceState: 'derived' }, growthAcceleration: { value: null, evidenceState: 'unavailable' } } },
          volatility: { engagementRate: { coefficientOfVariation: 0.2, evidenceState: 'derived' } },
          outliers: { likes: { outlierRatio: 0, evidenceState: 'derived' } },
          limitations: ['views_unavailable'],
        },
      }] };
      if (sql.includes('FROM influencer_intelligence.creator_score_component')) return { rows: [{
        component_name: 'engagement_quality', value: 74, weight: 0.2, contribution: 14.8, evidence_state: 'derived', confidence: 0.51,
        algorithm_version: 'influencer-intelligence-scoring/v0', model_version: null, providers: ['meta-graph'], evidence_refs: ['analysis:one'],
      }] };
      if (sql.includes('FROM influencer_intelligence.creator_score')) return { rows: [{
        score_key: 'score:one', creator_key: 'creator:one', score_kind: 'influencer', score: 71, confidence: 0.48,
        coverage_available: 5, coverage_expected: 8, evidence_state: 'derived', algorithm_version: 'influencer-intelligence-scoring/v0',
        model_version: null, providers: ['meta-graph'], provenance: { entries: [] }, computed_at: now, weights_version: 'weights-v0',
      }] };
      throw new Error(`unexpected SQL in fixture: ${sql.slice(0, 80)}`);
    },
  };
}

test('read service assembles CRM dashboard projections from fixed database reads without zero-filling missing metrics', async () => {
  const service = createInfluencerIntelligenceReadService({ queryable: fakeQueryable(), clock: () => Date.parse(now) });
  const result = await service.getCreatorDashboard({ creator_key: 'creator:one' });
  assert.equal(result.data.creator.creatorKey, 'creator:one');
  assert.equal(result.data.profile.followers.value, 12_345);
  assert.equal(result.data.media[0].likes.value, 350);
  assert.equal(result.data.media[0].views.value, null);
  assert.equal(result.data.media[0].views.evidenceState, 'unavailable');
  assert.equal(result.data.score.overallScore, 71);
  assert.equal(result.data.score.confidenceScore, 48);
  assert.equal(result.data.score.dataCoverage, 62.5);
  assert.equal(result.data.analysis.medianViews.value, null);
  assert.equal(result.data.analysis.medianViews.evidenceState, 'unavailable');
  assert.equal(result.data.provenance[0].provider, 'meta-graph');
  assert.equal(result.data.provenance.some((entry) => entry.sourceType === 'score'), true);
});
