import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DATA_MODEL_REPOSITORY_VERSION,
  InfluencerIntelligenceRepositoryError,
  SQL,
  createInfluencerIntelligenceRepository,
} from '../repository.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.join(here, '..', 'migrations', '20260811_influencer_intelligence_data_model_v1.up.sql');
const snapshotMetadataMigrationPath = path.join(here, '..', 'migrations', '20260811_influencer_intelligence_snapshots_v1.up.sql');
const scoringMigrationPath = path.join(here, '..', 'migrations', '20260811_influencer_intelligence_scoring_v0.up.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');
const snapshotMetadataMigration = fs.readFileSync(snapshotMetadataMigrationPath, 'utf8');
const scoringMigration = fs.readFileSync(scoringMigrationPath, 'utf8');
const digestA = 'a'.repeat(64);
const digestB = 'b'.repeat(64);
const observedAt = '2026-08-11T12:00:00.000Z';
const retrievedAt = '2026-08-11T12:01:00.000Z';

function fakeQueryable(responses = []) {
  const calls = [];
  return {
    calls,
    query: async (text, values) => {
      calls.push({ text, values });
      return responses.length > 0 ? responses.shift() : { rows: [{ ok: true }] };
    },
  };
}

function provenanceEntry(provider = 'tiktok') {
  return {
    provider,
    sourceType: 'profile',
    evidenceState: 'observed',
    observedAt,
    retrievedAt,
    sourceRef: 'synthetic-fixture/profile',
  };
}

function baseScore(overrides = {}) {
  return {
    scoreKey: 'score-1',
    ingestKey: 'score-ingest-1',
    creatorKey: 'creator-1',
    scoreKind: 'influencer',
    score: 82.5,
    confidence: 0.84,
    coverageAvailable: 4,
    coverageExpected: 5,
    evidenceState: 'derived',
    algorithmVersion: 'score/v1',
    modelVersion: null,
    providers: ['tiktok'],
    inputFingerprint: digestA,
    provenance: [provenanceEntry()],
    computedAt: retrievedAt,
    retentionPolicyVersion: 'retention/v1',
    ...overrides,
  };
}

test('defines the complete additive PostgreSQL model with immutable evidence', () => {
  for (const table of [
    'creator_identity',
    'collector_run',
    'creator_media',
    'collector_evidence',
    'creator_profile_snapshot',
    'creator_media_snapshot',
    'creator_comment_sample',
    'creator_analysis',
    'creator_score',
    'creator_score_component',
    'campaign',
    'campaign_creator_fit',
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS influencer_intelligence\\.${table}\\b`), table);
  }
  assert.match(migration, /BEGIN;[\s\S]*SET LOCAL TIME ZONE 'UTC'/);
  assert.match(migration, /COMMIT;\s*$/);
  assert.match(migration, /timestamptz/);
  assert.match(migration, /ingest_key text NOT NULL UNIQUE/);
  assert.match(migration, /prevent_append_only_mutation/);
  assert.match(migration, /BEFORE UPDATE OR DELETE/);
  assert.match(migration, /BEFORE TRUNCATE/);
  assert.match(migration, /creator_key, observed_at DESC/);
  assert.match(migration, /creator_key, computed_at DESC/);
  assert.match(migration, /provider ~ '\^\[a-z\]/);
  assert.doesNotMatch(migration, /DROP\s+(?:TABLE|SCHEMA|COLUMN)/i);
  assert.doesNotMatch(migration, /GRANT\s+PUBLIC/i);
  assert.doesNotMatch(migration, /\b(?:access_token|refresh_token|password|secret|email|phone|caption|biography|raw_text)\b/i);
});

test('defines additive durable coverage and freshness metadata for snapshot collection', () => {
  assert.match(snapshotMetadataMigration, /BEGIN;[\s\S]*SET LOCAL TIME ZONE 'UTC'/);
  assert.match(snapshotMetadataMigration, /ADD COLUMN IF NOT EXISTS coverage_available/);
  assert.match(snapshotMetadataMigration, /ADD COLUMN IF NOT EXISTS coverage_expected/);
  assert.match(snapshotMetadataMigration, /ADD COLUMN IF NOT EXISTS failure_count/);
  assert.match(snapshotMetadataMigration, /freshness_status/);
  assert.match(snapshotMetadataMigration, /freshness_age_seconds/);
  assert.match(snapshotMetadataMigration, /coverage_check/);
  assert.match(snapshotMetadataMigration, /failure_count_check/);
  assert.doesNotMatch(snapshotMetadataMigration, /DROP\s+(?:TABLE|SCHEMA|COLUMN)/i);
  assert.doesNotMatch(snapshotMetadataMigration, /TRUNCATE\s+/i);
  assert.match(snapshotMetadataMigration, /COMMIT;\s*$/);
});

test('defines additive score weights version metadata without destructive DDL', () => {
  assert.match(scoringMigration, /BEGIN;[\s\S]*SET LOCAL TIME ZONE 'UTC'/);
  assert.match(scoringMigration, /ADD COLUMN IF NOT EXISTS weights_version/);
  assert.match(scoringMigration, /creator_score/);
  assert.doesNotMatch(scoringMigration, /DROP\s+(?:TABLE|SCHEMA|COLUMN)/i);
  assert.doesNotMatch(scoringMigration, /TRUNCATE\s+/i);
  assert.match(scoringMigration, /COMMIT;\s*$/);
});

test('repository exposes a parameterized, injected PostgreSQL boundary', async () => {
  const queryable = fakeQueryable([{ rows: [{ run_key: 'run-1' }] }]);
  const repository = createInfluencerIntelligenceRepository({ queryable });
  assert.equal(DATA_MODEL_REPOSITORY_VERSION, 'influencer-intelligence-data-repository/v1');

  const result = await repository.createCollectorRun({
    runKey: 'run-1',
    idempotencyKey: 'collect-1',
    provider: 'tiktok',
    requestFingerprint: digestA,
    correlationId: 'corr-1',
    startedAt: observedAt,
    finishedAt: retrievedAt,
  });

  assert.equal(result.inserted, true);
  assert.equal(queryable.calls.length, 1);
  assert.match(queryable.calls[0].text, /\$1/);
  assert.equal(queryable.calls[0].values[1], 'collect-1');
  assert.equal(queryable.calls[0].values[2], 'tiktok');
  assert.doesNotMatch(queryable.calls[0].text, /tiktok|collect-1/);
  assert.equal(typeof SQL.createCollectorRun, 'string');
});

test('collector run idempotency rejects a changed request fingerprint', async () => {
  const queryable = fakeQueryable([
    { rows: [] },
    { rows: [{ request_fingerprint: digestB, run_key: 'run-existing' }] },
  ]);
  const repository = createInfluencerIntelligenceRepository({ queryable });
  await assert.rejects(
    repository.createCollectorRun({
      runKey: 'run-new',
      idempotencyKey: 'collect-1',
      requestFingerprint: digestA,
      correlationId: 'corr-1',
      startedAt: observedAt,
    }),
    (error) => error instanceof InfluencerIntelligenceRepositoryError && error.code === 'COLLECTOR_RUN_IDEMPOTENCY_CONFLICT',
  );
  assert.equal(queryable.calls.length, 2);
  assert.deepEqual(queryable.calls[1].values, ['collect-1']);
});

test('profile snapshots preserve provenance and reject reversed timestamps or raw fields', async () => {
  const queryable = fakeQueryable([{ rows: [{ snapshot_key: 'snapshot-1' }] }]);
  const repository = createInfluencerIntelligenceRepository({ queryable });
  await repository.recordProfileSnapshot({
    snapshotKey: 'snapshot-1',
    ingestKey: 'profile-ingest-1',
    creatorKey: 'creator-1',
    identityKey: 'identity-1',
    evidenceKey: 'evidence-1',
    provider: 'tiktok',
    providerAdapterVersion: 'adapter/v1',
    contractVersion: 'contract/v1',
    evidenceState: 'observed',
    observedAt,
    retrievedAt,
    sourceRef: 'synthetic-fixture/profile',
    canonicalHandle: 'creator.one',
    followersCount: 1000,
    normalizedMetrics: { engagement_rate: 0.12, nested: { median: 0.08 } },
    isPrivate: false,
    isVerified: true,
    retentionPolicyVersion: 'retention/v1',
  });
  const values = queryable.calls[0].values;
  assert.equal(values[2], 'creator-1');
  assert.equal(values[5], 'tiktok');
  assert.equal(JSON.parse(values[18]).nested.median, 0.08);
  assert.doesNotMatch(queryable.calls[0].text, /creator\.one|1000/);

  await assert.rejects(
    repository.recordProfileSnapshot({
      snapshotKey: 'snapshot-2', ingestKey: 'profile-ingest-2', creatorKey: 'creator-1', identityKey: 'identity-1', evidenceKey: 'evidence-1',
      provider: 'tiktok', providerAdapterVersion: 'adapter/v1', contractVersion: 'contract/v1', evidenceState: 'observed',
      observedAt: retrievedAt, retrievedAt: observedAt, sourceRef: 'synthetic-fixture/profile', retentionPolicyVersion: 'retention/v1',
    }),
    (error) => error.code === 'SNAPSHOT_TIMESTAMP_ORDER_INVALID',
  );
  await assert.rejects(
    repository.recordProfileSnapshot({
      snapshotKey: 'snapshot-3', ingestKey: 'profile-ingest-3', creatorKey: 'creator-1', identityKey: 'identity-1', evidenceKey: 'evidence-1',
      provider: 'tiktok', providerAdapterVersion: 'adapter/v1', contractVersion: 'contract/v1', evidenceState: 'observed',
      observedAt, retrievedAt, sourceRef: 'synthetic-fixture/profile', normalizedMetrics: { caption: 'do not persist' }, retentionPolicyVersion: 'retention/v1',
    }),
    /not permitted|KEY_INVALID|FIELD_FORBIDDEN/,
  );
});

test('media identity reconciliation does not rewrite historical metric snapshots', () => {
  assert.match(SQL.upsertMedia, /on conflict \(media_key\) do update/i);
  assert.match(SQL.recordMediaSnapshot, /on conflict \(ingest_key\) do nothing/i);
  assert.doesNotMatch(SQL.recordMediaSnapshot, /on conflict \(media_key\) do update/i);
});

test('scores accept future provider slugs but require auditable provenance and versions', async () => {
  const queryable = fakeQueryable([{ rows: [{ score_key: 'score-1' }] }]);
  const repository = createInfluencerIntelligenceRepository({ queryable });
  await repository.recordScore(baseScore());
  const call = queryable.calls[0];
  assert.equal(call.values[11][0], 'tiktok');
  const persistedProvenance = JSON.parse(call.values[13]);
  assert.equal(persistedProvenance.entries[0].provider, 'tiktok');
  assert.equal(call.values[9], 'score/v1');
  assert.equal(call.values[12], digestA);

  await assert.rejects(
    repository.recordScore(baseScore({ scoreKey: 'score-2', ingestKey: 'score-ingest-2', providers: [], provenance: [] })),
    (error) => error.code === 'SCORE_PROVIDERS_REQUIRED',
  );
  await assert.rejects(
    repository.recordScore(baseScore({ scoreKey: 'score-3', ingestKey: 'score-ingest-3', evidenceState: 'unavailable', score: 1, providers: [], provenance: [] })),
    (error) => error.code === 'UNAVAILABLE_SCORE_MUST_BE_NULL',
  );
});

test('scoring v0 persistence requires and binds the exact weights version', async () => {
  const queryable = fakeQueryable([{ rows: [{ score_key: 'score-v0' }] }]);
  const repository = createInfluencerIntelligenceRepository({ queryable });
  await repository.recordScore(baseScore({
    scoreKey: 'score-v0',
    ingestKey: 'score-ingest-v0',
    algorithmVersion: 'influencer-intelligence-scoring/v0',
    weightsVersion: 'influencer-intelligence-scoring-weights/v0',
  }));
  assert.equal(queryable.calls[0].values[16], 'influencer-intelligence-scoring-weights/v0');
  await assert.rejects(
    repository.recordScore(baseScore({
      scoreKey: 'score-v0-missing-weights',
      ingestKey: 'score-ingest-v0-missing-weights',
      algorithmVersion: 'influencer-intelligence-scoring/v0',
    })),
    (error) => error.code === 'WEIGHTS_VERSION_REQUIRED',
  );
});

test('analysis and campaign fit enforce coverage, model versions, and bounded reads', async () => {
  const queryable = fakeQueryable([
    { rows: [{ analysis_key: 'analysis-1' }] },
    { rows: [{ fit_key: 'fit-1' }] },
    { rows: [{ score_key: 'score-1' }] },
  ]);
  const repository = createInfluencerIntelligenceRepository({ queryable });
  await repository.recordAnalysis({
    analysisKey: 'analysis-1', ingestKey: 'analysis-ingest-1', creatorKey: 'creator-1', windowStart: '2026-08-01T00:00:00Z', windowEnd: '2026-08-11T00:00:00Z',
    evidenceState: 'derived', confidence: 0.8, coverageAvailable: 4, coverageExpected: 5, algorithmVersion: 'analysis/v1', providers: ['tiktok'],
    provenance: [provenanceEntry()], inputFingerprint: digestA, computedAt: retrievedAt, analysisMetrics: { median_engagement: 0.1 }, retentionPolicyVersion: 'retention/v1',
  });
  await assert.rejects(
    repository.recordAnalysis({
      analysisKey: 'analysis-2', ingestKey: 'analysis-ingest-2', creatorKey: 'creator-1', windowStart: '2026-08-01T00:00:00Z', windowEnd: '2026-08-11T00:00:00Z',
      evidenceState: 'inferred', confidence: 0.5, coverageAvailable: 6, coverageExpected: 5, algorithmVersion: 'analysis/v1', providers: ['tiktok'],
      provenance: [provenanceEntry()], inputFingerprint: digestA, computedAt: retrievedAt, analysisMetrics: {}, retentionPolicyVersion: 'retention/v1',
    }),
    (error) => error.code === 'ANALYSIS_MODEL_VERSION_REQUIRED' || error.code === 'ANALYSIS_COVERAGE_INVALID',
  );
  await repository.recordCampaignFit({
    fitKey: 'fit-1', ingestKey: 'fit-ingest-1', campaignKey: 'campaign-1', campaignVersion: 1, creatorKey: 'creator-1', score: 75,
    confidence: 0.7, coverageAvailable: 3, coverageExpected: 4, evidenceState: 'derived', algorithmVersion: 'fit/v1', providers: ['tiktok'],
    provenance: [provenanceEntry()], inputFingerprint: digestB, computedAt: retrievedAt, retentionPolicyVersion: 'retention/v1',
  });
  const rows = await repository.latestScores({ creatorKey: 'creator-1', limit: 2 });
  assert.deepEqual(rows, [{ score_key: 'score-1' }]);
  assert.deepEqual(queryable.calls.at(-1).values, ['creator-1', 2]);
  await assert.rejects(repository.latestScores({ creatorKey: 'creator-1', limit: 101 }), (error) => error.code === 'LIMIT_TOO_LARGE');
});
