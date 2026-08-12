import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONTENT_ANALYSIS_ALGORITHM_VERSION,
  CONTENT_SEMANTIC_SCHEMA_VERSION,
  ContentAnalysisError,
  analyzeAndPersistContentSample,
  analyzeContentSample,
  sampleContentRecords,
} from '../content-analysis.mjs';
import { createInfluencerIntelligenceRepository } from '../repository.mjs';
import {
  CONTENT_GOLDEN_FIXTURES,
  structuredSemanticAnalyzer,
} from './fixtures/content-golden-fixtures.mjs';

function fixture(name) {
  return structuredClone(CONTENT_GOLDEN_FIXTURES[name]);
}

function assertFinite(value, path = 'result') {
  if (typeof value === 'number') {
    assert.equal(Number.isFinite(value), true, `${path} must be finite`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertFinite(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) assertFinite(child, `${path}.${key}`);
  }
}

test('bounded recent sampling is deterministic and never exceeds the configured limit', () => {
  const input = fixture('recentSample');
  const sampled = sampleContentRecords(input.contents, input.sampling);

  assert.equal(sampled.items.length, 2);
  assert.deepEqual(sampled.items.map(({ content_key: key }) => key), [
    'media:content-001',
    'media:content-002',
  ]);
  assert.equal(sampled.sampling.candidate_count, 3);
  assert.equal(sampled.sampling.selected_count, 2);
  assert.equal(sampled.sampling.truncated, true);
  assert.equal(sampled.sampling.retention, 'features_and_evidence_refs_only');
});

test('deterministic baseline extracts bounded features without creating a score', async () => {
  const result = await analyzeContentSample(fixture('recentSample'));

  assert.equal(result.algorithm_version, CONTENT_ANALYSIS_ALGORITHM_VERSION);
  assert.equal(result.model_version, null);
  assert.equal(result.data_classification, 'derived');
  assert.equal(result.features.topics.evidence_state, 'derived');
  assert.ok(result.features.topics.value.includes('skincare'));
  assert.equal(result.features.sponsored_signal.value.counts.present, 1);
  assert.equal(result.features.promotion_coupon_signal.value.counts.present, 1);
  assert.equal(result.features.content_format.evidence_state, 'observed');
  assert.equal(result.features.brands_mentioned.value, null);
  assert.equal('overall_score' in result, false);
  assert.equal('campaign_fit_score' in result, false);
  assert.equal(JSON.stringify(result).includes('"caption":'), false);
  assert.equal(JSON.stringify(result).includes('"transcript":'), false);
  assertFinite(result);
});

test('structured semantic inference is closed, versioned, and separate from scoring', async () => {
  const input = fixture('recentSample');
  input.semantic_analyzer = structuredSemanticAnalyzer();
  const result = await analyzeContentSample(input);

  assert.equal(result.data_classification, 'inferred');
  assert.equal(result.model_version, 'content-semantic-model-v1');
  assert.equal(result.semantic.schema_version, CONTENT_SEMANTIC_SCHEMA_VERSION);
  assert.equal(result.semantic.status, 'available');
  assert.equal(result.features.skincare_affinity.evidence_state, 'inferred');
  assert.equal(result.features.sponsored_signal.value.counts.present, 1);
  assert.equal(result.features.content_format.evidence_state, 'observed');
  assert.ok(result.features.topics.evidence_refs.length > 0);
  assert.equal('overall_score' in result, false);
  assert.equal('weights_version' in result, false);
  assertFinite(result);
});

test('semantic output rejects free-form or unsupported fields', async () => {
  const input = fixture('recentSample');
  input.semantic_analyzer = {
    async analyze() {
      return {
        schema_version: CONTENT_SEMANTIC_SCHEMA_VERSION,
        model_version: 'content-semantic-model-v1',
        confidence: 0.8,
        items: [{
          content_key: 'media:content-001',
          confidence: 0.8,
          topics: ['skincare'],
          rationale: 'free form model explanation',
        }],
      };
    },
  };

  await assert.rejects(
    analyzeContentSample(input),
    (error) => error instanceof ContentAnalysisError && error.code === 'SEMANTIC.ITEMS[0]_FIELD_FORBIDDEN',
  );
});

test('analyzer transport failure does not invent semantic features', async () => {
  const input = fixture('recentSample');
  input.semantic_analyzer = { async analyze() { throw new Error('model unavailable'); } };
  const result = await analyzeContentSample(input);

  assert.equal(result.data_classification, 'derived');
  assert.equal(result.semantic.status, 'unavailable');
  assert.equal(result.semantic.model_version, null);
  assert.ok(result.limitations.includes('semantic_analyzer_failed'));
  assert.equal(result.features.brands_mentioned.value, null);
  assertFinite(result);
});

test('missing text/entity projections remain unavailable rather than empty or zero facts', async () => {
  const result = await analyzeContentSample(fixture('unavailableEntities'));

  assert.equal(result.features.topics.value, null);
  assert.equal(result.features.brands_mentioned.value, null);
  assert.equal(result.features.competitors.value, null);
  assert.equal(result.features.content_format.value, null);
  assert.equal(result.features.topics.evidence_state, 'unavailable');
  assert.ok(result.coverage.available_features < result.coverage.expected_features);
  assert.equal(result.features.sponsored_signal.value, null);
  assert.equal(result.confidence > 0, true);
  assertFinite(result);
});

test('stale and sparse content lowers confidence and exposes freshness', async () => {
  const fresh = await analyzeContentSample(fixture('recentSample'));
  const stale = await analyzeContentSample(fixture('sparseStale'));

  assert.equal(stale.freshness.status, 'stale');
  assert.ok(stale.limitations.includes('stale_observation'));
  assert.ok(stale.confidence < fresh.confidence);
  assert.ok(stale.confidence_factors.sample_size < fresh.confidence_factors.sample_size);
  assertFinite(stale);
});

test('frames are accepted only as bounded references and raw media is rejected', async () => {
  const input = fixture('recentSample');
  input.contents[0].media_binary = 'base64-data';
  await assert.rejects(analyzeContentSample(input), (error) => error.code === 'CONTENT[0]_FIELD_FORBIDDEN');

  const withQuery = fixture('recentSample');
  withQuery.contents[0].frame_evidence[0].frame_ref = 'https://example.test/frame?token=secret';
  await assert.rejects(analyzeContentSample(withQuery), (error) => error.code === 'CONTENT[0].FRAME_EVIDENCE[0].FRAME_REF_INVALID');
});

test('persistence stores only features and evidence references through the existing analysis boundary', async () => {
  let captured;
  const repository = {
    async recordAnalysis(input) {
      captured = input;
      return { inserted: true, row: { analysis_key: input.analysisKey } };
    },
  };
  const result = await analyzeAndPersistContentSample({
    ...fixture('recentSample'),
    repository,
    retentionPolicyVersion: 'influencer-intelligence-retention-v1',
    analysisKey: 'analysis:content:001',
    ingestKey: 'ingest:content:001',
    evidenceKey: 'evidence:content:001',
  });

  assert.equal(result.persistence.inserted, true);
  assert.equal(captured.analysisMetrics.content_features.topics.value.length > 0, true);
  assert.equal(JSON.stringify(captured).includes('"caption":'), false);
  assert.equal(JSON.stringify(captured).includes('"transcript":'), false);
  assert.equal(JSON.stringify(captured).includes('media_binary'), false);
  assert.match(captured.inputFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(captured.modelVersion, null);
  assert.equal(captured.evidenceState, 'derived');
});

test('the real repository boundary accepts the bounded persistence projection', async () => {
  const queries = [];
  const repository = createInfluencerIntelligenceRepository({ queryable: {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: [{ analysis_key: params[0], evidence_state: params[5] }] };
    },
  } });
  const result = await analyzeAndPersistContentSample({
    ...fixture('recentSample'),
    repository,
    retentionPolicyVersion: 'influencer-intelligence-retention-v1',
    analysisKey: 'analysis:content:repository-001',
    ingestKey: 'ingest:content:repository-001',
    evidenceKey: 'evidence:content:repository-001',
  });

  assert.equal(result.persistence.inserted, true);
  assert.equal(queries.length, 1);
  assert.equal(queries[0].params[5], 'derived');
  assert.equal(JSON.stringify(queries[0].params).includes('caption'), false);
});

test('same bounded input produces a bit-for-bit stable projection and fingerprint', async () => {
  const first = await analyzeContentSample(fixture('recentSample'));
  const second = await analyzeContentSample(fixture('recentSample'));
  assert.deepEqual(first, second);
});
