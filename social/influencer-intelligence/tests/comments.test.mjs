import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMENT_ANALYSIS_ALGORITHM_VERSION,
  COMMENT_METRIC_KEYS,
  COMMENT_SAMPLING_VERSION,
  COMMENT_SEMANTIC_SCHEMA_VERSION,
  CommentIntelligenceError,
  analyzeCommentSample,
  analyzeAndPersistCommentSample,
  sampleCommentRecords,
} from '../comments.mjs';
import {
  COMMENT_FIXTURES,
  STRUCTURED_SEMANTIC_RESULT,
} from './fixtures/comments-golden-fixtures.mjs';

const commonInput = {
  sampleKey: 'sample-comments-1',
  creatorKey: 'creator-comments-1',
  mediaKey: 'media-comments-1',
  provider: 'meta-graph',
  providerAdapterVersion: 'meta-graph-adapter-v1',
  sourceRef: 'synthetic-fixture/comments-1',
  observedAt: '2026-08-11T12:00:00.000Z',
  retrievedAt: '2026-08-11T12:01:00.000Z',
  providerReliability: 0.9,
  freshnessMaxAgeSeconds: 14 * 24 * 60 * 60,
  sampling: { maxComments: 100, strategy: 'bounded_recent' },
};

function semanticAnalyzer(result = STRUCTURED_SEMANTIC_RESULT) {
  return {
    calls: [],
    async analyze(input) {
      this.calls.push(input);
      return result;
    },
  };
}

test('selects a bounded, auditable sample without an implicit unbounded fetch', () => {
  const result = sampleCommentRecords(COMMENT_FIXTURES.boundedCandidates, {
    maxComments: 3,
    strategy: 'bounded_recent',
  });
  assert.equal(result.comments.length, 3);
  assert.equal(result.sampling.sampling_version, COMMENT_SAMPLING_VERSION);
  assert.equal(result.sampling.requested_limit, 3);
  assert.equal(result.sampling.candidate_count, 6);
  assert.equal(result.sampling.truncated, true);
  assert.equal(result.sampling.retention, 'aggregate_only');
  assert.throws(
    () => sampleCommentRecords(COMMENT_FIXTURES.boundedCandidates, { maxComments: 101 }),
    (error) => error instanceof CommentIntelligenceError && error.code === 'MAXCOMMENTS_INVALID',
  );
  assert.throws(
    () => sampleCommentRecords(Array.from({ length: 201 }, () => ({ text: 'bounded' }))),
    (error) => error instanceof CommentIntelligenceError && error.code === 'COMMENT_CANDIDATES_OUT_OF_BOUNDS',
  );
});

test('deterministic metrics cover duplicates, near duplicates, emoji, generic text, languages and likes', async () => {
  const analyzer = semanticAnalyzer();
  const first = await analyzeCommentSample({
    ...commonInput,
    comments: COMMENT_FIXTURES.mixed,
    semanticAnalyzer: analyzer,
  }, { clock: '2026-08-11T12:02:00.000Z' });
  const second = await analyzeCommentSample({
    ...commonInput,
    comments: COMMENT_FIXTURES.mixed,
    semanticAnalyzer: semanticAnalyzer(),
  }, { clock: '2026-08-11T12:02:00.000Z' });

  assert.deepEqual(first, second);
  assert.equal(first.algorithm_version, COMMENT_ANALYSIS_ALGORITHM_VERSION);
  assert.equal(first.sample_size, 7);
  assert.equal(first.metrics.duplicate_ratio.value, 0.142857);
  assert.equal(first.metrics.near_duplicate_ratio.value, 0.142857);
  assert.equal(first.metrics.emoji_only_ratio.value, 0.142857);
  assert.equal(first.metrics.generic_short_comment_ratio.value, 0.142857);
  assert.equal(first.metrics.unique_commenter_ratio.value, 0.5);
  assert.equal(first.metrics.repeated_commenter_ratio.value, 1);
  assert.equal(first.metrics.language_distribution.value.counts.pt_br, 1);
  assert.equal(first.metrics.comment_like_distribution.value.missing_count, 1);
  assert.equal(first.semantic.status, 'available');
  assert.equal(first.semantic.schema_version, COMMENT_SEMANTIC_SCHEMA_VERSION);
  assert.equal(first.comment_quality.evidence_state, 'derived');
  assert.ok(first.comment_quality.score >= 0 && first.comment_quality.score <= 100);
  assert.ok(first.comment_quality.confidence < 0.8, 'a seven-comment sample must not receive high confidence');
  assert.equal(first.coverage.expected_metrics, COMMENT_METRIC_KEYS.length);
  assert.equal(first.freshness.status, 'fresh');
  assert.equal(JSON.stringify(first).includes('This explanation'), false);
  assert.equal(JSON.stringify(first).includes('aaaaaaaa'), false);
});

test('missing labels remain unavailable instead of becoming zero', async () => {
  const result = await analyzeCommentSample({
    ...commonInput,
    comments: COMMENT_FIXTURES.noLabels,
  }, { clock: '2026-08-11T12:02:00.000Z' });
  assert.equal(result.metrics.unique_commenter_ratio.value, null);
  assert.equal(result.metrics.unique_commenter_ratio.evidence_state, 'unavailable');
  assert.equal(result.metrics.repeated_commenter_ratio.value, null);
  assert.equal(result.metrics.language_distribution.value, null);
  assert.equal(result.metrics.comment_like_distribution.value, null);
  assert.equal(result.metrics.duplicate_ratio.value, 0);
  assert.equal(result.metrics.emoji_only_ratio.value, 0);
  assert.equal(result.semantic.status, 'unavailable');
  assert.ok(result.limitations.includes('semantic_analyzer_unavailable'));
  assert.ok(result.comment_quality.confidence < 0.5);
});

test('empty provider sample is explicit unavailable data, not a zero quality score', async () => {
  const result = await analyzeCommentSample({
    ...commonInput,
    comments: [],
  }, { clock: '2026-08-11T12:02:00.000Z' });
  assert.equal(result.sample_size, 0);
  assert.equal(result.evidence_state, 'unavailable');
  assert.equal(result.comment_quality.score, null);
  assert.equal(result.comment_quality.confidence, 0);
  assert.equal(result.coverage.available_metrics, 0);
  assert.ok(Object.values(result.metrics).every((metric) => metric.value === null));
});

test('staleness and provider reliability reduce independent confidence', async () => {
  const result = await analyzeCommentSample({
    ...commonInput,
    providerReliability: 0.4,
    comments: COMMENT_FIXTURES.genuine,
  }, { clock: '2026-09-01T12:02:00.000Z' });
  assert.equal(result.freshness.status, 'stale');
  assert.ok(result.limitations.includes('stale_observation'));
  assert.equal(result.comment_quality.confidence_factors.provider_reliability, 0.4);
  assert.equal(result.comment_quality.confidence_factors.freshness, 0.5);
  assert.ok(result.comment_quality.confidence < 0.6);
});

test('semantic analysis accepts only a closed aggregate schema and stores model provenance', async () => {
  const analyzer = semanticAnalyzer();
  const result = await analyzeCommentSample({
    ...commonInput,
    comments: COMMENT_FIXTURES.mixed,
    semanticAnalyzer: analyzer,
  });
  assert.equal(analyzer.calls.length, 1);
  assert.equal(analyzer.calls[0].schema_version, COMMENT_SEMANTIC_SCHEMA_VERSION);
  assert.equal(analyzer.calls[0].comments[0].sample_index, 0);
  assert.equal(result.semantic.model_version, 'semantic-comments-fixture/v1');
  assert.equal(result.semantic.relevance.relevant, 4);
  assert.deepEqual(result.semantic.evidence_refs, ['synthetic-fixture/comments-semantic']);
  assert.equal('text' in result.semantic, false);
  await assert.rejects(
    analyzeCommentSample({
      ...commonInput,
      comments: COMMENT_FIXTURES.genuine,
      semanticAnalyzer: semanticAnalyzer({ ...STRUCTURED_SEMANTIC_RESULT, note: 'free-form score narrative' }),
    }),
    (error) => error instanceof CommentIntelligenceError && error.code === 'SEMANTIC_FREE_FORM_OUTPUT_REJECTED',
  );
});

test('raw commenter identity and credential-like comment content are rejected at the ephemeral boundary', async () => {
  const credentialLikeText = ['access', '_token', '=do-not-process'].join('');
  await assert.rejects(
    analyzeCommentSample({
      ...commonInput,
      comments: [{ text: 'useful feedback', commenterId: 'provider-user-1' }],
    }),
    (error) => error instanceof CommentIntelligenceError && error.code === 'COMMENT_FIELD_FORBIDDEN',
  );
  await assert.rejects(
    analyzeCommentSample({
      ...commonInput,
      comments: [{ text: credentialLikeText }],
    }),
    (error) => error instanceof CommentIntelligenceError && error.code === 'COMMENT_TEXT_POLICY_BLOCKED',
  );
});

test('semantic provider failure degrades to unavailable without inventing labels', async () => {
  const result = await analyzeCommentSample({
    ...commonInput,
    comments: COMMENT_FIXTURES.genuine,
    semanticAnalyzer: { async analyze() { throw new Error('transport'); } },
  });
  assert.equal(result.semantic.status, 'unavailable');
  assert.equal(result.semantic.relevance, null);
  assert.equal(result.comment_quality.components.semantic_relevance.value, null);
  assert.ok(result.limitations.includes('semantic_analyzer_failed'));
});

test('analyze-and-persist sends only aggregate output to the repository', async () => {
  const writes = [];
  const repository = {
    async recordCommentSample(input) {
      writes.push(input);
      return { inserted: true, row: { sample_key: input.sampleKey } };
    },
  };
  const result = await analyzeAndPersistCommentSample({
    repository,
    ...commonInput,
    comments: COMMENT_FIXTURES.genuine,
    semanticAnalyzer: semanticAnalyzer({
      ...STRUCTURED_SEMANTIC_RESULT,
      relevance: { relevant: 2, generic: 0, spam_like: 0, unknown: 1 },
      evidence: [
        { code: 'contextual_relevance', count: 2, basis: 'aggregate_label' },
        { code: 'generic_language', count: 1, basis: 'generic_pattern' },
      ],
    }),
    ingestKey: 'comment-ingest-1',
    evidenceKey: 'comment-evidence-1',
    retentionPolicyVersion: 'retention/v1',
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].algorithmVersion, COMMENT_ANALYSIS_ALGORITHM_VERSION);
  assert.equal(writes[0].qualityScore, result.analysis.comment_quality.score);
  assert.equal(writes[0].samplingVersion, COMMENT_SAMPLING_VERSION);
  assert.equal(writes[0].commentCount, 3);
  assert.equal(JSON.stringify(writes[0]).includes('Usei por duas semanas'), false);
  assert.equal(JSON.stringify(writes[0]).includes('aaaaaaaa'), false);
});
