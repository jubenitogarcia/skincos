import { assertNoSensitiveFields } from './contracts.mjs';

export const DATA_MODEL_REPOSITORY_VERSION = 'influencer-intelligence-data-repository/v1';

const KEY_PATTERN = /^[A-Za-z0-9._:-]{1,240}$/;
const SLUG_PATTERN = /^[a-z][a-z0-9._-]{1,79}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const SOURCE_REF_PATTERN = /^[A-Za-z0-9._:/-]{1,240}$/;
const VERSION_PATTERN = /^[a-z][a-z0-9._/-]{0,79}$/;
const SAFE_JSON_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const FORBIDDEN_PERSISTENCE_KEY_PATTERN = /(?:raw|payload|token|secret|password|cookie|session|email|phone|username|caption|biography|profilepicture|contact|authorization)/i;

export class InfluencerIntelligenceRepositoryError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'InfluencerIntelligenceRepositoryError';
    this.code = code;
  }
}

function fail(code, message = code) {
  throw new InfluencerIntelligenceRepositoryError(code, message);
}

function requiredString(value, label, pattern = KEY_PATTERN) {
  if (typeof value !== 'string' || !value.trim()) fail(`${label.toUpperCase()}_REQUIRED`);
  const normalized = value.trim();
  if (!pattern.test(normalized)) fail(`${label.toUpperCase()}_INVALID`);
  return normalized;
}

function optionalString(value, label, pattern = KEY_PATTERN) {
  if (value === undefined || value === null || value === '') return null;
  return requiredString(value, label, pattern);
}

function provider(value) {
  return requiredString(value, 'provider', SLUG_PATTERN).toLowerCase();
}

function version(value, label) {
  return requiredString(value, label, VERSION_PATTERN).toLowerCase();
}

function digest(value, label) {
  const normalized = requiredString(value, label, DIGEST_PATTERN).toLowerCase();
  return normalized;
}

function timestamp(value, label, { required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) fail(`${label.toUpperCase()}_REQUIRED`);
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) fail(`${label.toUpperCase()}_INVALID`);
  return parsed.toISOString();
}

function integer(value, label, { required = false, minimum = 0 } = {}) {
  if (value === undefined || value === null) {
    if (required) fail(`${label.toUpperCase()}_REQUIRED`);
    return null;
  }
  if (!Number.isSafeInteger(value) || value < minimum) fail(`${label.toUpperCase()}_INVALID`);
  return value;
}

function decimal(value, label, { required = false, minimum = null, maximum = null } = {}) {
  if (value === undefined || value === null) {
    if (required) fail(`${label.toUpperCase()}_REQUIRED`);
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${label.toUpperCase()}_INVALID`);
  if (minimum !== null && value < minimum) fail(`${label.toUpperCase()}_INVALID`);
  if (maximum !== null && value > maximum) fail(`${label.toUpperCase()}_INVALID`);
  return value;
}

function normalizeSafeJson(value, label, { maxDepth = 4, maxBytes = 32768 } = {}) {
  const normalized = value === undefined || value === null ? {} : value;
  assertNoSensitiveFields(normalized, label);
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    fail(`${label.toUpperCase()}_OBJECT_REQUIRED`);
  }

  function visit(node, depth, path) {
    if (node === null) return;
    if (depth > maxDepth) fail(`${label.toUpperCase()}_DEPTH_EXCEEDED`);
    if (typeof node === 'number') {
      if (!Number.isFinite(node)) fail(`${label.toUpperCase()}_VALUE_INVALID`);
      return;
    }
    if (typeof node === 'string' || typeof node === 'boolean') return;
    if (Array.isArray(node)) {
      if (node.length > 64) fail(`${label.toUpperCase()}_ARRAY_TOO_LARGE`);
      node.forEach((child, index) => visit(child, depth + 1, `${path}[${index}]`));
      return;
    }
    if (typeof node !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(node))) {
      fail(`${label.toUpperCase()}_VALUE_INVALID`);
    }
    const entries = Object.entries(node);
    if (entries.length > 64) fail(`${label.toUpperCase()}_OBJECT_TOO_LARGE`);
    for (const [key, child] of entries) {
      if (!SAFE_JSON_KEY_PATTERN.test(key) || FORBIDDEN_PERSISTENCE_KEY_PATTERN.test(key)) {
        fail(`${label.toUpperCase()}_KEY_INVALID`);
      }
      visit(child, depth + 1, `${path}.${key}`);
    }
  }

  visit(normalized, 0, label);
  let serialized;
  try {
    serialized = JSON.stringify(normalized);
  } catch {
    fail(`${label.toUpperCase()}_SERIALIZATION_FAILED`);
  }
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) fail(`${label.toUpperCase()}_TOO_LARGE`);
  return normalized;
}

function normalizeStringArray(value, label, { max = 32, pattern = SLUG_PATTERN } = {}) {
  const values = value === undefined || value === null ? [] : value;
  if (!Array.isArray(values) || values.length > max) fail(`${label.toUpperCase()}_INVALID`);
  const normalized = values.map((item) => requiredString(item, label, pattern).toLowerCase());
  if (new Set(normalized).size !== normalized.length) fail(`${label.toUpperCase()}_DUPLICATE`);
  return normalized;
}

function normalizeProvenance(value, label = 'provenance') {
  const provenance = normalizeSafeJson(value, label);
  if (typeof provenance !== 'object' || Array.isArray(provenance)) fail(`${label.toUpperCase()}_OBJECT_REQUIRED`);
  return provenance;
}

function normalizeProvenanceEntries(value, label = 'provenance') {
  assertNoSensitiveFields(value, label);
  if (!Array.isArray(value) || value.length > 64) fail(`${label.toUpperCase()}_ARRAY_REQUIRED`);
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(`${label.toUpperCase()}_ENTRY_INVALID`);
    const entryLabel = `${label}[${index}]`;
    safeInput(entry, entryLabel);
    const observedAt = timestamp(entry.observedAt, `${entryLabel}.observedAt`);
    const retrievedAt = timestamp(entry.retrievedAt, `${entryLabel}.retrievedAt`, { required: false });
    ensureTimestampOrder(observedAt, retrievedAt, entryLabel);
    return {
      provider: provider(entry.provider),
      sourceType: requiredString(entry.sourceType, `${entryLabel}.sourceType`, SLUG_PATTERN),
      evidenceState: requiredString(entry.evidenceState, `${entryLabel}.evidenceState`, /^(observed|derived|inferred|unavailable)$/),
      observedAt,
      ...(retrievedAt ? { retrievedAt } : {}),
      ...(entry.sourceRef ? { sourceRef: requiredString(entry.sourceRef, `${entryLabel}.sourceRef`, SOURCE_REF_PATTERN) } : {}),
    };
  });
}

function ensureTimestampOrder(observedAt, retrievedAt, label) {
  if (observedAt && retrievedAt && new Date(retrievedAt).getTime() < new Date(observedAt).getTime()) {
    fail(`${label.toUpperCase()}_TIMESTAMP_ORDER_INVALID`);
  }
}

function optionalBoolean(value, label) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'boolean') fail(`${label.toUpperCase()}_INVALID`);
  return value;
}

function ensureCoverage(available, expected, label) {
  if (available > expected) fail(`${label.toUpperCase()}_COVERAGE_INVALID`);
}

function ensureAvailableEvidence({ evidenceState, providers, provenance, label }) {
  if (evidenceState === 'unavailable') return;
  if (providers.length === 0) fail(`${label.toUpperCase()}_PROVIDERS_REQUIRED`);
  if (provenance.length === 0) fail(`${label.toUpperCase()}_PROVENANCE_REQUIRED`);
}

function safeInput(value, label) {
  assertNoSensitiveFields(value, label);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_PERSISTENCE_KEY_PATTERN.test(key)) fail(`${label.toUpperCase()}_FIELD_FORBIDDEN`);
    }
  }
}

function requireQueryable(queryable) {
  if (!queryable || typeof queryable.query !== 'function') {
    fail('QUERYABLE_REQUIRED', 'repository requires an injected PostgreSQL queryable');
  }
}

async function insertReturning(queryable, sql, params) {
  const result = await queryable.query(sql, params);
  return result.rows?.[0] || null;
}

async function insertIdempotent(queryable, sql, params) {
  const row = await insertReturning(queryable, sql, params);
  return { inserted: Boolean(row), row };
}

export const SQL = Object.freeze({
  createCollectorRun: `
    insert into influencer_intelligence.collector_run
      (run_key, idempotency_key, provider, mode, status, request_fingerprint, correlation_id, attempt_count, started_at, finished_at)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz)
    on conflict (idempotency_key) do nothing
    returning run_key, idempotency_key, request_fingerprint, status`,
  readCollectorRun: `
    select run_key, idempotency_key, request_fingerprint, status
    from influencer_intelligence.collector_run
    where idempotency_key = $1`,
  updateCollectorRun: `
    update influencer_intelligence.collector_run
    set status = $2, finished_at = $3::timestamptz, updated_at = now()
    where run_key = $1
    returning run_key, status, finished_at`,
  upsertCreatorIdentity: `
    insert into influencer_intelligence.creator_identity
      (identity_key, creator_key, provider, provider_account_digest, identity_state, evidence_state, observed_at, retrieved_at, source_ref, retention_policy_version)
    values ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz, $9, $10)
    on conflict (identity_key) do update
      set identity_state = excluded.identity_state,
          evidence_state = excluded.evidence_state,
          observed_at = excluded.observed_at,
          retrieved_at = excluded.retrieved_at,
          source_ref = excluded.source_ref,
          retention_policy_version = excluded.retention_policy_version,
          updated_at = now()
      where influencer_intelligence.creator_identity.creator_key = excluded.creator_key
        and influencer_intelligence.creator_identity.provider = excluded.provider
        and influencer_intelligence.creator_identity.provider_account_digest = excluded.provider_account_digest
    returning identity_key, creator_key, provider, identity_state, evidence_state`,
  recordEvidence: `
    insert into influencer_intelligence.collector_evidence
      (evidence_key, ingest_key, run_key, creator_key, media_key, provider, source_type, evidence_state, observed_at, retrieved_at, source_ref, evidence_digest, gap_code, retention_policy_version)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz, $11, $12, $13, $14)
    on conflict (ingest_key) do nothing
    returning evidence_key, ingest_key, creator_key, provider, evidence_state`,
  recordProfileSnapshot: `
    insert into influencer_intelligence.creator_profile_snapshot
      (snapshot_key, ingest_key, creator_key, identity_key, evidence_key, provider, provider_adapter_version, contract_version, evidence_state, observed_at, retrieved_at, source_ref, canonical_handle, followers_count, following_count, media_count, is_private, is_verified, normalized_metrics, retention_policy_version)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20)
    on conflict (ingest_key) do nothing
    returning snapshot_key, ingest_key, creator_key, provider, evidence_state, observed_at`,
  upsertMedia: `
    insert into influencer_intelligence.creator_media
      (media_key, creator_key, provider, provider_media_digest, media_kind, published_at, source_ref)
    values ($1, $2, $3, $4, $5, $6::timestamptz, $7)
    on conflict (provider, provider_media_digest) do update
      set source_ref = coalesce(excluded.source_ref, influencer_intelligence.creator_media.source_ref),
          published_at = coalesce(excluded.published_at, influencer_intelligence.creator_media.published_at),
          updated_at = now()
    returning media_key, creator_key, provider, provider_media_digest`,
  recordMediaSnapshot: `
    insert into influencer_intelligence.creator_media_snapshot
      (snapshot_key, ingest_key, media_key, creator_key, evidence_key, provider, provider_adapter_version, contract_version, evidence_state, observed_at, retrieved_at, source_ref, likes_count, comments_count, shares_count, saves_count, views_count, reach_count, impressions_count, normalized_metrics, retention_policy_version)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz, $12, $13, $14, $15, $16, $17, $18, $19, $20::jsonb, $21)
    on conflict (ingest_key) do nothing
    returning snapshot_key, ingest_key, media_key, creator_key, provider, evidence_state, observed_at`,
  recordCommentSample: `
    insert into influencer_intelligence.creator_comment_sample
      (sample_key, ingest_key, creator_key, media_key, evidence_key, provider, provider_adapter_version, evidence_state, observed_at, retrieved_at, source_ref, topic_key, language_code, sentiment_label, safety_label, comment_count, spam_ratio, sentiment_score, aggregate_metrics, model_version, retention_policy_version)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20, $21)
    on conflict (ingest_key) do nothing
    returning sample_key, ingest_key, creator_key, provider, evidence_state, observed_at`,
  recordAnalysis: `
    insert into influencer_intelligence.creator_analysis
      (analysis_key, ingest_key, creator_key, window_start, window_end, evidence_state, confidence, coverage_available, coverage_expected, algorithm_version, model_version, providers, input_fingerprint, provenance, analysis_metrics, computed_at, retention_policy_version)
    values ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7, $8, $9, $10, $11, $12::text[], $13, $14::jsonb, $15::jsonb, $16::timestamptz, $17)
    on conflict (ingest_key) do nothing
    returning analysis_key, ingest_key, creator_key, evidence_state, computed_at`,
  recordScore: `
    insert into influencer_intelligence.creator_score
      (score_key, ingest_key, creator_key, score_kind, score, confidence, coverage_available, coverage_expected, evidence_state, algorithm_version, model_version, providers, input_fingerprint, provenance, computed_at, retention_policy_version)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::text[], $13, $14::jsonb, $15::timestamptz, $16)
    on conflict (ingest_key) do nothing
    returning score_key, ingest_key, creator_key, score_kind, score, evidence_state, computed_at`,
  recordScoreComponent: `
    insert into influencer_intelligence.creator_score_component
      (component_key, ingest_key, score_key, component_name, value, weight, contribution, evidence_state, confidence, algorithm_version, model_version, providers, evidence_refs, provenance, retention_policy_version)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::text[], $13::text[], $14::jsonb, $15)
    on conflict (ingest_key) do nothing
    returning component_key, ingest_key, score_key, component_name, evidence_state`,
  upsertCampaign: `
    insert into influencer_intelligence.campaign
      (campaign_key, campaign_version, status, criteria_version, criteria)
    values ($1, $2, $3, $4, $5::jsonb)
    on conflict (campaign_key, campaign_version) do update
      set status = excluded.status,
          criteria_version = excluded.criteria_version,
          criteria = excluded.criteria,
          updated_at = now()
    returning campaign_key, campaign_version, status`,
  recordCampaignFit: `
    insert into influencer_intelligence.campaign_creator_fit
      (fit_key, ingest_key, campaign_key, campaign_version, creator_key, score, confidence, coverage_available, coverage_expected, evidence_state, algorithm_version, model_version, providers, input_fingerprint, provenance, computed_at, retention_policy_version)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text[], $14, $15::jsonb, $16::timestamptz, $17)
    on conflict (ingest_key) do nothing
    returning fit_key, ingest_key, campaign_key, campaign_version, creator_key, score, evidence_state, computed_at`,
  latestProfileSnapshot: `
    select snapshot_key, ingest_key, creator_key, provider, evidence_state, observed_at, retrieved_at, normalized_metrics
    from influencer_intelligence.creator_profile_snapshot
    where creator_key = $1
    order by observed_at desc, retrieved_at desc, snapshot_key desc
    limit $2`,
  latestScores: `
    select score_key, ingest_key, creator_key, score_kind, score, confidence, coverage_available, coverage_expected, evidence_state, algorithm_version, model_version, providers, provenance, computed_at
    from influencer_intelligence.creator_score
    where creator_key = $1
    order by computed_at desc, score_key desc
    limit $2`,
});

function commonArtifact(input, label) {
  safeInput(input, label);
  const observedAt = timestamp(input.observedAt, 'observedAt');
  const retrievedAt = timestamp(input.retrievedAt, 'retrievedAt');
  ensureTimestampOrder(observedAt, retrievedAt, label);
  return {
    key: requiredString(input[`${label}Key`], `${label}Key`),
    ingestKey: requiredString(input.ingestKey, 'ingestKey'),
    creatorKey: requiredString(input.creatorKey, 'creatorKey'),
    provider: provider(input.provider),
    evidenceState: requiredString(input.evidenceState, 'evidenceState', /^(observed|derived|inferred|unavailable)$/),
    observedAt,
    retrievedAt,
    sourceRef: requiredString(input.sourceRef, 'sourceRef', SOURCE_REF_PATTERN),
    retentionPolicyVersion: version(input.retentionPolicyVersion, 'retentionPolicyVersion'),
  };
}

export function createInfluencerIntelligenceRepository({ queryable }) {
  requireQueryable(queryable);

  return Object.freeze({
    async createCollectorRun(input) {
      safeInput(input, 'collectorRun');
      const values = {
        runKey: requiredString(input.runKey, 'runKey'),
        idempotencyKey: requiredString(input.idempotencyKey, 'idempotencyKey'),
        provider: input.provider === undefined || input.provider === null ? null : provider(input.provider),
        mode: requiredString(input.mode || 'dry-run', 'mode', /^(dry-run|shadow|active)$/),
        status: requiredString(input.status || 'queued', 'status', /^(queued|running|completed|partial|failed|cancelled|unavailable)$/),
        requestFingerprint: digest(input.requestFingerprint, 'requestFingerprint'),
        correlationId: requiredString(input.correlationId, 'correlationId'),
        attemptCount: integer(input.attemptCount ?? 1, 'attemptCount', { required: true, minimum: 1 }),
        startedAt: timestamp(input.startedAt || new Date().toISOString(), 'startedAt'),
        finishedAt: timestamp(input.finishedAt, 'finishedAt', { required: false }),
      };
      ensureTimestampOrder(values.startedAt, values.finishedAt, 'collectorRun');
      const row = await insertReturning(queryable, SQL.createCollectorRun, [
        values.runKey, values.idempotencyKey, values.provider, values.mode, values.status,
        values.requestFingerprint, values.correlationId, values.attemptCount, values.startedAt, values.finishedAt,
      ]);
      if (row) return { inserted: true, row };
      const existing = (await queryable.query(SQL.readCollectorRun, [values.idempotencyKey])).rows?.[0];
      if (!existing) fail('COLLECTOR_RUN_IDEMPOTENCY_LOOKUP_FAILED');
      if (existing.request_fingerprint !== values.requestFingerprint) {
        fail('COLLECTOR_RUN_IDEMPOTENCY_CONFLICT');
      }
      return { inserted: false, row: existing };
    },

    async updateCollectorRun(input) {
      safeInput(input, 'collectorRunUpdate');
      const runKey = requiredString(input.runKey, 'runKey');
      const status = requiredString(input.status, 'status', /^(queued|running|completed|partial|failed|cancelled|unavailable)$/);
      const finishedAt = timestamp(input.finishedAt, 'finishedAt', { required: false });
      const row = await insertReturning(queryable, SQL.updateCollectorRun, [runKey, status, finishedAt]);
      if (!row) fail('COLLECTOR_RUN_NOT_FOUND');
      return row;
    },

    async upsertCreatorIdentity(input) {
      safeInput(input, 'creatorIdentity');
      const identityKey = requiredString(input.identityKey, 'identityKey');
      const creatorKey = requiredString(input.creatorKey, 'creatorKey');
      const identityState = requiredString(input.identityState || 'active', 'identityState', /^(active|revoked|unavailable)$/);
      const evidenceState = requiredString(input.evidenceState || (identityState === 'unavailable' ? 'unavailable' : 'observed'), 'evidenceState', /^(observed|unavailable)$/);
      const observedAt = timestamp(input.observedAt, 'observedAt', { required: evidenceState !== 'unavailable' });
      const retrievedAt = timestamp(input.retrievedAt, 'retrievedAt', { required: false });
      ensureTimestampOrder(observedAt, retrievedAt, 'creatorIdentity');
      const row = await insertReturning(queryable, SQL.upsertCreatorIdentity, [
        identityKey, creatorKey, provider(input.provider), digest(input.providerAccountDigest, 'providerAccountDigest'),
        identityState, evidenceState, observedAt, retrievedAt,
        requiredString(input.sourceRef, 'sourceRef', SOURCE_REF_PATTERN), version(input.retentionPolicyVersion, 'retentionPolicyVersion'),
      ]);
      if (!row) fail('CREATOR_IDENTITY_IDEMPOTENCY_CONFLICT');
      return row;
    },

    async recordCollectorEvidence(input) {
      const common = commonArtifact(input, 'evidence');
      const sourceType = requiredString(input.sourceType, 'sourceType', /^(profile|media|comments-aggregate|insights|synthetic)$/);
      const evidenceDigest = optionalString(input.evidenceDigest, 'evidenceDigest', DIGEST_PATTERN);
      const gapCode = optionalString(input.gapCode, 'gapCode', SLUG_PATTERN);
      const row = await insertReturning(queryable, SQL.recordEvidence, [
        common.key, common.ingestKey, requiredString(input.runKey, 'runKey'), common.creatorKey,
        optionalString(input.mediaKey, 'mediaKey'), common.provider, sourceType, common.evidenceState,
        common.observedAt, common.retrievedAt, common.sourceRef, evidenceDigest, gapCode,
        common.retentionPolicyVersion,
      ]);
      return { inserted: Boolean(row), row };
    },

    async recordProfileSnapshot(input) {
      const common = commonArtifact(input, 'snapshot');
      safeInput(input.normalizedMetrics, 'normalizedMetrics');
      const evidenceState = requiredString(input.evidenceState, 'evidenceState', /^(observed|unavailable)$/);
      const metrics = normalizeSafeJson(input.normalizedMetrics, 'normalizedMetrics');
      const row = await insertReturning(queryable, SQL.recordProfileSnapshot, [
        common.key, common.ingestKey, common.creatorKey, optionalString(input.identityKey, 'identityKey'),
        requiredString(input.evidenceKey, 'evidenceKey'), common.provider, version(input.providerAdapterVersion, 'providerAdapterVersion'),
        version(input.contractVersion, 'contractVersion'), evidenceState, common.observedAt, common.retrievedAt,
        common.sourceRef, optionalString(input.canonicalHandle, 'canonicalHandle', /^[a-z0-9._]{1,30}$/),
        integer(input.followersCount, 'followersCount'), integer(input.followingCount, 'followingCount'), integer(input.mediaCount, 'mediaCount'),
         optionalBoolean(input.isPrivate, 'isPrivate'), optionalBoolean(input.isVerified, 'isVerified'), JSON.stringify(metrics), common.retentionPolicyVersion,
      ]);
      return { inserted: Boolean(row), row };
    },

    async upsertMedia(input) {
      safeInput(input, 'creatorMedia');
      const row = await insertReturning(queryable, SQL.upsertMedia, [
        requiredString(input.mediaKey, 'mediaKey'), requiredString(input.creatorKey, 'creatorKey'), provider(input.provider),
        digest(input.providerMediaDigest, 'providerMediaDigest'),
        requiredString(input.mediaKind || 'unknown', 'mediaKind', /^(post|reel|video|short|live|unknown)$/),
        timestamp(input.publishedAt, 'publishedAt', { required: false }), optionalString(input.sourceRef, 'sourceRef', SOURCE_REF_PATTERN),
      ]);
      if (!row) fail('CREATOR_MEDIA_WRITE_FAILED');
      return row;
    },

    async recordMediaSnapshot(input) {
      const common = commonArtifact(input, 'snapshot');
      const metrics = normalizeSafeJson(input.normalizedMetrics, 'normalizedMetrics');
      const row = await insertReturning(queryable, SQL.recordMediaSnapshot, [
        common.key, common.ingestKey, requiredString(input.mediaKey, 'mediaKey'), common.creatorKey,
        requiredString(input.evidenceKey, 'evidenceKey'), common.provider, version(input.providerAdapterVersion, 'providerAdapterVersion'),
        version(input.contractVersion, 'contractVersion'), requiredString(input.evidenceState, 'evidenceState', /^(observed|unavailable)$/),
        common.observedAt, common.retrievedAt, common.sourceRef,
        integer(input.likesCount, 'likesCount'), integer(input.commentsCount, 'commentsCount'), integer(input.sharesCount, 'sharesCount'),
        integer(input.savesCount, 'savesCount'), integer(input.viewsCount, 'viewsCount'), integer(input.reachCount, 'reachCount'),
        integer(input.impressionsCount, 'impressionsCount'), JSON.stringify(metrics), common.retentionPolicyVersion,
      ]);
      return { inserted: Boolean(row), row };
    },

    async recordCommentSample(input) {
      const common = commonArtifact(input, 'sample');
      const aggregateMetrics = normalizeSafeJson(input.aggregateMetrics, 'aggregateMetrics');
      if (common.evidenceState === 'inferred' && !input.modelVersion) fail('COMMENT_SAMPLE_MODEL_VERSION_REQUIRED');
      if (common.evidenceState === 'unavailable' && (
        input.commentCount !== undefined || input.spamRatio !== undefined || input.sentimentScore !== undefined ||
        Object.keys(aggregateMetrics).length > 0
      )) fail('UNAVAILABLE_COMMENT_SAMPLE_MUST_BE_EMPTY');
      const row = await insertReturning(queryable, SQL.recordCommentSample, [
        common.key, common.ingestKey, common.creatorKey, optionalString(input.mediaKey, 'mediaKey'),
        requiredString(input.evidenceKey, 'evidenceKey'), common.provider, version(input.providerAdapterVersion, 'providerAdapterVersion'),
        common.evidenceState, common.observedAt, common.retrievedAt, common.sourceRef,
        optionalString(input.topicKey, 'topicKey', SLUG_PATTERN), optionalString(input.languageCode, 'languageCode', /^[a-z]{2,12}$/),
        optionalString(input.sentimentLabel, 'sentimentLabel', /^(positive|neutral|negative|mixed|unknown)$/),
        optionalString(input.safetyLabel, 'safetyLabel', /^(safe|flagged|unknown)$/), integer(input.commentCount, 'commentCount'),
        decimal(input.spamRatio, 'spamRatio', { minimum: 0, maximum: 1 }), decimal(input.sentimentScore, 'sentimentScore', { minimum: -1, maximum: 1 }),
        JSON.stringify(aggregateMetrics), optionalString(input.modelVersion, 'modelVersion', VERSION_PATTERN), common.retentionPolicyVersion,
      ]);
      return { inserted: Boolean(row), row };
    },

    async recordAnalysis(input) {
      safeInput(input, 'creatorAnalysis');
      const windowStart = timestamp(input.windowStart, 'windowStart');
      const windowEnd = timestamp(input.windowEnd, 'windowEnd');
      if (new Date(windowEnd).getTime() <= new Date(windowStart).getTime()) fail('ANALYSIS_WINDOW_INVALID');
      const metrics = normalizeSafeJson(input.analysisMetrics, 'analysisMetrics');
      const evidenceState = requiredString(input.evidenceState, 'evidenceState', /^(derived|inferred|unavailable)$/);
      const providers = normalizeStringArray(input.providers, 'providers');
      const provenanceEntries = normalizeProvenanceEntries(input.provenance);
      ensureAvailableEvidence({ evidenceState, providers, provenance: provenanceEntries, label: 'analysis' });
      const confidence = decimal(input.confidence ?? (evidenceState === 'unavailable' ? 0 : undefined), 'confidence', { required: true, minimum: 0, maximum: 1 });
      if (evidenceState === 'inferred' && !input.modelVersion) fail('ANALYSIS_MODEL_VERSION_REQUIRED');
      if (evidenceState === 'unavailable' && (confidence !== 0 || Object.keys(metrics).length > 0)) fail('UNAVAILABLE_ANALYSIS_MUST_BE_EMPTY');
      const coverageAvailable = integer(input.coverageAvailable, 'coverageAvailable', { required: true });
      const coverageExpected = integer(input.coverageExpected, 'coverageExpected', { required: true, minimum: 1 });
      ensureCoverage(coverageAvailable, coverageExpected, 'analysis');
      const row = await insertReturning(queryable, SQL.recordAnalysis, [
         requiredString(input.analysisKey, 'analysisKey'), requiredString(input.ingestKey, 'ingestKey'), requiredString(input.creatorKey, 'creatorKey'),
         windowStart, windowEnd, evidenceState, confidence, coverageAvailable,
         coverageExpected, version(input.algorithmVersion, 'algorithmVersion'),
         optionalString(input.modelVersion, 'modelVersion', VERSION_PATTERN), providers,
         digest(input.inputFingerprint, 'inputFingerprint'), JSON.stringify({ entries: provenanceEntries }), JSON.stringify(metrics),
         timestamp(input.computedAt, 'computedAt'), version(input.retentionPolicyVersion, 'retentionPolicyVersion'),
      ]);
      return { inserted: Boolean(row), row };
    },

    async recordScore(input) {
      safeInput(input, 'creatorScore');
      const scoreKind = requiredString(input.scoreKind, 'scoreKind', /^(influencer|campaign-fit|brand-fit|risk)$/);
      const evidenceState = requiredString(input.evidenceState, 'evidenceState', /^(derived|inferred|unavailable)$/);
      const score = decimal(input.score, 'score', { minimum: 0, maximum: 100 });
      if (evidenceState === 'unavailable' && score !== null) fail('UNAVAILABLE_SCORE_MUST_BE_NULL');
      if (evidenceState !== 'unavailable' && score === null) fail('AVAILABLE_SCORE_REQUIRED');
      const providers = normalizeStringArray(input.providers, 'providers');
      const provenanceEntries = normalizeProvenanceEntries(input.provenance);
      ensureAvailableEvidence({ evidenceState, providers, provenance: provenanceEntries, label: 'score' });
      const confidence = decimal(input.confidence ?? (evidenceState === 'unavailable' ? 0 : undefined), 'confidence', { required: true, minimum: 0, maximum: 1 });
      if (evidenceState === 'unavailable' && confidence !== 0) fail('UNAVAILABLE_SCORE_CONFIDENCE_INVALID');
      const coverageAvailable = integer(input.coverageAvailable, 'coverageAvailable', { required: true });
      const coverageExpected = integer(input.coverageExpected, 'coverageExpected', { required: true, minimum: 1 });
      ensureCoverage(coverageAvailable, coverageExpected, 'score');
      const row = await insertReturning(queryable, SQL.recordScore, [
         requiredString(input.scoreKey, 'scoreKey'), requiredString(input.ingestKey, 'ingestKey'), requiredString(input.creatorKey, 'creatorKey'),
         scoreKind, score, confidence,
         coverageAvailable, coverageExpected,
         evidenceState, version(input.algorithmVersion, 'algorithmVersion'), optionalString(input.modelVersion, 'modelVersion', VERSION_PATTERN),
         providers, digest(input.inputFingerprint, 'inputFingerprint'), { entries: provenanceEntries },
         timestamp(input.computedAt, 'computedAt'), version(input.retentionPolicyVersion, 'retentionPolicyVersion'),
      ].map((value) => (value && typeof value === 'object' && !Array.isArray(value) ? JSON.stringify(value) : value)));
      return { inserted: Boolean(row), row };
    },

    async recordScoreComponent(input) {
      safeInput(input, 'scoreComponent');
      const evidenceState = requiredString(input.evidenceState, 'evidenceState', /^(derived|inferred|unavailable)$/);
      const value = decimal(input.value, 'value');
      const contribution = decimal(input.contribution, 'contribution');
      if (evidenceState === 'unavailable' && (value !== null || contribution !== null)) fail('UNAVAILABLE_COMPONENT_MUST_BE_NULL');
      const providers = normalizeStringArray(input.providers, 'providers');
      const evidenceRefs = normalizeStringArray(input.evidenceRefs, 'evidenceRefs', { max: 64, pattern: KEY_PATTERN });
      if (evidenceState !== 'unavailable' && (providers.length === 0 || evidenceRefs.length === 0)) fail('AVAILABLE_COMPONENT_EVIDENCE_REQUIRED');
      const confidence = decimal(input.confidence ?? (evidenceState === 'unavailable' ? 0 : undefined), 'confidence', { required: true, minimum: 0, maximum: 1 });
      if (evidenceState === 'unavailable' && confidence !== 0) fail('UNAVAILABLE_COMPONENT_CONFIDENCE_INVALID');
      const row = await insertReturning(queryable, SQL.recordScoreComponent, [
         requiredString(input.componentKey, 'componentKey'), requiredString(input.ingestKey, 'ingestKey'), requiredString(input.scoreKey, 'scoreKey'),
         requiredString(input.componentName, 'componentName', SLUG_PATTERN), value, decimal(input.weight, 'weight', { minimum: 0 }), contribution,
         evidenceState, confidence, version(input.algorithmVersion, 'algorithmVersion'),
         optionalString(input.modelVersion, 'modelVersion', VERSION_PATTERN), providers,
         evidenceRefs, normalizeProvenance(input.provenance),
        version(input.retentionPolicyVersion, 'retentionPolicyVersion'),
      ].map((item) => (item && typeof item === 'object' && !Array.isArray(item) ? JSON.stringify(item) : item)));
      return { inserted: Boolean(row), row };
    },

    async upsertCampaign(input) {
      safeInput(input, 'campaign');
      const criteria = normalizeSafeJson(input.criteria, 'criteria');
      const row = await insertReturning(queryable, SQL.upsertCampaign, [
        requiredString(input.campaignKey, 'campaignKey'), integer(input.campaignVersion ?? 1, 'campaignVersion', { required: true, minimum: 1 }),
        requiredString(input.status || 'draft', 'status', /^(draft|active|archived)$/), version(input.criteriaVersion, 'criteriaVersion'), JSON.stringify(criteria),
      ]);
      if (!row) fail('CAMPAIGN_WRITE_FAILED');
      return row;
    },

    async recordCampaignFit(input) {
      safeInput(input, 'campaignCreatorFit');
      const evidenceState = requiredString(input.evidenceState, 'evidenceState', /^(derived|inferred|unavailable)$/);
      const score = decimal(input.score, 'score', { minimum: 0, maximum: 100 });
      if (evidenceState === 'unavailable' && score !== null) fail('UNAVAILABLE_FIT_MUST_BE_NULL');
      if (evidenceState !== 'unavailable' && score === null) fail('AVAILABLE_FIT_REQUIRED');
      const providers = normalizeStringArray(input.providers, 'providers');
      const provenanceEntries = normalizeProvenanceEntries(input.provenance);
      ensureAvailableEvidence({ evidenceState, providers, provenance: provenanceEntries, label: 'campaignFit' });
      const confidence = decimal(input.confidence ?? (evidenceState === 'unavailable' ? 0 : undefined), 'confidence', { required: true, minimum: 0, maximum: 1 });
      if (evidenceState === 'unavailable' && confidence !== 0) fail('UNAVAILABLE_FIT_CONFIDENCE_INVALID');
      const coverageAvailable = integer(input.coverageAvailable, 'coverageAvailable', { required: true });
      const coverageExpected = integer(input.coverageExpected, 'coverageExpected', { required: true, minimum: 1 });
      ensureCoverage(coverageAvailable, coverageExpected, 'campaignFit');
      const row = await insertReturning(queryable, SQL.recordCampaignFit, [
         requiredString(input.fitKey, 'fitKey'), requiredString(input.ingestKey, 'ingestKey'), requiredString(input.campaignKey, 'campaignKey'),
         integer(input.campaignVersion, 'campaignVersion', { required: true, minimum: 1 }), requiredString(input.creatorKey, 'creatorKey'), score,
         confidence, coverageAvailable,
         coverageExpected, evidenceState, version(input.algorithmVersion, 'algorithmVersion'),
         optionalString(input.modelVersion, 'modelVersion', VERSION_PATTERN), providers, digest(input.inputFingerprint, 'inputFingerprint'),
         { entries: provenanceEntries }, timestamp(input.computedAt, 'computedAt'), version(input.retentionPolicyVersion, 'retentionPolicyVersion'),
      ].map((item) => (item && typeof item === 'object' && !Array.isArray(item) ? JSON.stringify(item) : item)));
      return { inserted: Boolean(row), row };
    },

    async latestProfileSnapshot({ creatorKey, limit = 1 }) {
      const normalizedCreatorKey = requiredString(creatorKey, 'creatorKey');
      const normalizedLimit = integer(limit, 'limit', { required: true, minimum: 1 });
      if (normalizedLimit > 100) fail('LIMIT_TOO_LARGE');
      const result = await queryable.query(SQL.latestProfileSnapshot, [normalizedCreatorKey, normalizedLimit]);
      return result.rows || [];
    },

    async latestScores({ creatorKey, limit = 20 }) {
      const normalizedCreatorKey = requiredString(creatorKey, 'creatorKey');
      const normalizedLimit = integer(limit, 'limit', { required: true, minimum: 1 });
      if (normalizedLimit > 100) fail('LIMIT_TOO_LARGE');
      const result = await queryable.query(SQL.latestScores, [normalizedCreatorKey, normalizedLimit]);
      return result.rows || [];
    },
  });
}
