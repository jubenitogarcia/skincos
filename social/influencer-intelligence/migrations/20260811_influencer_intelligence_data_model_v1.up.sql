-- Influencer Intelligence persistent data model v1.
--
-- This migration depends on 20260810_influencer_intelligence_registry_v1. It
-- is an additive, source-controlled artifact: a reviewed destination runner
-- must apply it only after proving database identity, role custody,
-- checkpoint/backup, lock and statement timeouts, and post-apply verification.
-- IDs and ingest keys are supplied by the orchestrator; no extension or
-- provider credential is needed here. PostgreSQL timestamptz stores instants;
-- the migration fixes the session display zone to UTC for deterministic tests.

BEGIN;
SET LOCAL TIME ZONE 'UTC';

DO $$
BEGIN
  IF to_regclass('influencer_intelligence.creator_registry') IS NULL THEN
    RAISE EXCEPTION 'influencer intelligence registry migration is required before data model v1';
  END IF;
END
$$;

-- M1's creator_registry is the canonical creator concept under the existing
-- SKINCOS naming convention. creator_identity is separate so new providers
-- (for example TikTok or YouTube) are not blocked by M1's current provider
-- allowlist while the M1 projection remains backward compatible.
CREATE TABLE IF NOT EXISTS influencer_intelligence.creator_identity (
  identity_key text PRIMARY KEY
    CHECK (identity_key ~ '^[A-Za-z0-9._:-]{1,160}$'),
  creator_key text NOT NULL
    REFERENCES influencer_intelligence.creator_registry(creator_key)
    ON DELETE RESTRICT,
  provider text NOT NULL
    CHECK (provider ~ '^[a-z][a-z0-9._-]{1,63}$'),
  provider_account_digest text NOT NULL
    CHECK (provider_account_digest ~ '^[0-9a-f]{64}$'),
  identity_state text NOT NULL DEFAULT 'active'
    CHECK (identity_state IN ('active', 'revoked', 'unavailable')),
  evidence_state text NOT NULL DEFAULT 'observed'
    CHECK (evidence_state IN ('observed', 'unavailable')),
  observed_at timestamptz,
  retrieved_at timestamptz,
  source_ref text NOT NULL
    CHECK (char_length(btrim(source_ref)) BETWEEN 1 AND 240 AND source_ref !~ '[?#]'),
  retention_policy_version text NOT NULL DEFAULT 'influencer-intelligence-retention/v1'
    CHECK (retention_policy_version ~ '^[a-z][a-z0-9._/-]{0,79}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_account_digest),
  CHECK ((identity_state = 'unavailable') = (evidence_state = 'unavailable')),
  CHECK (evidence_state = 'unavailable' OR observed_at IS NOT NULL),
  CHECK (retrieved_at IS NULL OR (observed_at IS NOT NULL AND retrieved_at >= observed_at))
);

CREATE TABLE IF NOT EXISTS influencer_intelligence.collector_run (
  run_key text PRIMARY KEY
    CHECK (run_key ~ '^[A-Za-z0-9._:-]{1,160}$'),
  idempotency_key text NOT NULL UNIQUE
    CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{1,240}$'),
  provider text
    CHECK (provider IS NULL OR provider ~ '^[a-z][a-z0-9._-]{1,63}$'),
  mode text NOT NULL DEFAULT 'dry-run'
    CHECK (mode IN ('dry-run', 'shadow', 'active')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'partial', 'failed', 'cancelled', 'unavailable')),
  request_fingerprint text NOT NULL
    CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  correlation_id text NOT NULL
    CHECK (correlation_id ~ '^[A-Za-z0-9._:-]{1,160}$'),
  attempt_count integer NOT NULL DEFAULT 1
    CHECK (attempt_count >= 1),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (finished_at IS NULL OR finished_at >= started_at)
);

CREATE TABLE IF NOT EXISTS influencer_intelligence.creator_media (
  media_key text PRIMARY KEY
    CHECK (media_key ~ '^[A-Za-z0-9._:-]{1,160}$'),
  creator_key text NOT NULL
    REFERENCES influencer_intelligence.creator_registry(creator_key)
    ON DELETE RESTRICT,
  provider text NOT NULL
    CHECK (provider ~ '^[a-z][a-z0-9._-]{1,63}$'),
  provider_media_digest text NOT NULL
    CHECK (provider_media_digest ~ '^[0-9a-f]{64}$'),
  media_kind text NOT NULL DEFAULT 'unknown'
    CHECK (media_kind IN ('post', 'reel', 'video', 'short', 'live', 'unknown')),
  published_at timestamptz,
  source_ref text
    CHECK (source_ref IS NULL OR (char_length(btrim(source_ref)) BETWEEN 1 AND 240 AND source_ref !~ '[?#]')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_media_digest)
);

CREATE TABLE IF NOT EXISTS influencer_intelligence.collector_evidence (
  evidence_key text PRIMARY KEY
    CHECK (evidence_key ~ '^[A-Za-z0-9._:-]{1,160}$'),
  ingest_key text NOT NULL UNIQUE
    CHECK (ingest_key ~ '^[A-Za-z0-9._:-]{1,240}$'),
  run_key text NOT NULL
    REFERENCES influencer_intelligence.collector_run(run_key)
    ON DELETE RESTRICT,
  creator_key text NOT NULL
    REFERENCES influencer_intelligence.creator_registry(creator_key)
    ON DELETE RESTRICT,
  media_key text
    REFERENCES influencer_intelligence.creator_media(media_key)
    ON DELETE RESTRICT,
  provider text NOT NULL
    CHECK (provider ~ '^[a-z][a-z0-9._-]{1,63}$'),
  source_type text NOT NULL
    CHECK (source_type IN ('profile', 'media', 'comments-aggregate', 'insights', 'synthetic')),
  evidence_state text NOT NULL
    CHECK (evidence_state IN ('observed', 'derived', 'inferred', 'unavailable')),
  observed_at timestamptz NOT NULL,
  retrieved_at timestamptz NOT NULL,
  source_ref text NOT NULL
    CHECK (char_length(btrim(source_ref)) BETWEEN 1 AND 240 AND source_ref !~ '[?#]'),
  evidence_digest text
    CHECK (evidence_digest IS NULL OR evidence_digest ~ '^[0-9a-f]{64}$'),
  gap_code text
    CHECK (gap_code IS NULL OR gap_code ~ '^[a-z][a-z0-9._-]{0,79}$'),
  retention_policy_version text NOT NULL
    CHECK (retention_policy_version ~ '^[a-z][a-z0-9._/-]{0,79}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (retrieved_at >= observed_at),
  CHECK (evidence_state = 'unavailable' OR evidence_digest IS NOT NULL OR gap_code IS NULL)
);

CREATE TABLE IF NOT EXISTS influencer_intelligence.creator_profile_snapshot (
  snapshot_key text PRIMARY KEY
    CHECK (snapshot_key ~ '^[A-Za-z0-9._:-]{1,160}$'),
  ingest_key text NOT NULL UNIQUE
    CHECK (ingest_key ~ '^[A-Za-z0-9._:-]{1,240}$'),
  creator_key text NOT NULL
    REFERENCES influencer_intelligence.creator_registry(creator_key)
    ON DELETE RESTRICT,
  identity_key text
    REFERENCES influencer_intelligence.creator_identity(identity_key)
    ON DELETE RESTRICT,
  evidence_key text NOT NULL
    REFERENCES influencer_intelligence.collector_evidence(evidence_key)
    ON DELETE RESTRICT,
  provider text NOT NULL
    CHECK (provider ~ '^[a-z][a-z0-9._-]{1,63}$'),
  provider_adapter_version text NOT NULL
    CHECK (provider_adapter_version ~ '^[a-z][a-z0-9._/-]{0,79}$'),
  contract_version text NOT NULL
    CHECK (contract_version ~ '^[a-z][a-z0-9._/-]{0,79}$'),
  evidence_state text NOT NULL
    CHECK (evidence_state IN ('observed', 'unavailable')),
  observed_at timestamptz NOT NULL,
  retrieved_at timestamptz NOT NULL,
  source_ref text NOT NULL
    CHECK (char_length(btrim(source_ref)) BETWEEN 1 AND 240 AND source_ref !~ '[?#]'),
  canonical_handle text
    CHECK (canonical_handle IS NULL OR canonical_handle ~ '^[a-z0-9._]{1,30}$'),
  followers_count bigint CHECK (followers_count IS NULL OR followers_count >= 0),
  following_count bigint CHECK (following_count IS NULL OR following_count >= 0),
  media_count bigint CHECK (media_count IS NULL OR media_count >= 0),
  is_private boolean,
  is_verified boolean,
  normalized_metrics jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(normalized_metrics) = 'object'),
  retention_policy_version text NOT NULL
    CHECK (retention_policy_version ~ '^[a-z][a-z0-9._/-]{0,79}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (retrieved_at >= observed_at),
  CHECK (evidence_state = 'unavailable' OR identity_key IS NOT NULL),
  CHECK (evidence_state <> 'unavailable' OR (
    canonical_handle IS NULL AND followers_count IS NULL AND following_count IS NULL AND
    media_count IS NULL AND is_private IS NULL AND is_verified IS NULL AND normalized_metrics = '{}'::jsonb
  ))
);

CREATE TABLE IF NOT EXISTS influencer_intelligence.creator_media_snapshot (
  snapshot_key text PRIMARY KEY
    CHECK (snapshot_key ~ '^[A-Za-z0-9._:-]{1,160}$'),
  ingest_key text NOT NULL UNIQUE
    CHECK (ingest_key ~ '^[A-Za-z0-9._:-]{1,240}$'),
  media_key text NOT NULL
    REFERENCES influencer_intelligence.creator_media(media_key)
    ON DELETE RESTRICT,
  creator_key text NOT NULL
    REFERENCES influencer_intelligence.creator_registry(creator_key)
    ON DELETE RESTRICT,
  evidence_key text NOT NULL
    REFERENCES influencer_intelligence.collector_evidence(evidence_key)
    ON DELETE RESTRICT,
  provider text NOT NULL
    CHECK (provider ~ '^[a-z][a-z0-9._-]{1,63}$'),
  provider_adapter_version text NOT NULL
    CHECK (provider_adapter_version ~ '^[a-z][a-z0-9._/-]{0,79}$'),
  contract_version text NOT NULL
    CHECK (contract_version ~ '^[a-z][a-z0-9._/-]{0,79}$'),
  evidence_state text NOT NULL
    CHECK (evidence_state IN ('observed', 'unavailable')),
  observed_at timestamptz NOT NULL,
  retrieved_at timestamptz NOT NULL,
  source_ref text NOT NULL
    CHECK (char_length(btrim(source_ref)) BETWEEN 1 AND 240 AND source_ref !~ '[?#]'),
  likes_count bigint CHECK (likes_count IS NULL OR likes_count >= 0),
  comments_count bigint CHECK (comments_count IS NULL OR comments_count >= 0),
  shares_count bigint CHECK (shares_count IS NULL OR shares_count >= 0),
  saves_count bigint CHECK (saves_count IS NULL OR saves_count >= 0),
  views_count bigint CHECK (views_count IS NULL OR views_count >= 0),
  reach_count bigint CHECK (reach_count IS NULL OR reach_count >= 0),
  impressions_count bigint CHECK (impressions_count IS NULL OR impressions_count >= 0),
  normalized_metrics jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(normalized_metrics) = 'object'),
  retention_policy_version text NOT NULL
    CHECK (retention_policy_version ~ '^[a-z][a-z0-9._/-]{0,79}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (retrieved_at >= observed_at),
  CHECK (evidence_state <> 'unavailable' OR (
    likes_count IS NULL AND comments_count IS NULL AND shares_count IS NULL AND
    saves_count IS NULL AND views_count IS NULL AND reach_count IS NULL AND
    impressions_count IS NULL AND normalized_metrics = '{}'::jsonb
  ))
);

CREATE TABLE IF NOT EXISTS influencer_intelligence.creator_comment_sample (
  sample_key text PRIMARY KEY
    CHECK (sample_key ~ '^[A-Za-z0-9._:-]{1,160}$'),
  ingest_key text NOT NULL UNIQUE
    CHECK (ingest_key ~ '^[A-Za-z0-9._:-]{1,240}$'),
  creator_key text NOT NULL
    REFERENCES influencer_intelligence.creator_registry(creator_key)
    ON DELETE RESTRICT,
  media_key text
    REFERENCES influencer_intelligence.creator_media(media_key)
    ON DELETE RESTRICT,
  evidence_key text NOT NULL
    REFERENCES influencer_intelligence.collector_evidence(evidence_key)
    ON DELETE RESTRICT,
  provider text NOT NULL
    CHECK (provider ~ '^[a-z][a-z0-9._-]{1,63}$'),
  provider_adapter_version text NOT NULL
    CHECK (provider_adapter_version ~ '^[a-z][a-z0-9._/-]{0,79}$'),
  evidence_state text NOT NULL
    CHECK (evidence_state IN ('observed', 'derived', 'inferred', 'unavailable')),
  observed_at timestamptz NOT NULL,
  retrieved_at timestamptz NOT NULL,
  source_ref text NOT NULL
    CHECK (char_length(btrim(source_ref)) BETWEEN 1 AND 240 AND source_ref !~ '[?#]'),
  topic_key text CHECK (topic_key IS NULL OR topic_key ~ '^[a-z][a-z0-9._-]{0,79}$'),
  language_code text CHECK (language_code IS NULL OR language_code ~ '^[a-z]{2,12}$'),
  sentiment_label text CHECK (sentiment_label IS NULL OR sentiment_label IN ('positive', 'neutral', 'negative', 'mixed', 'unknown')),
  safety_label text CHECK (safety_label IS NULL OR safety_label IN ('safe', 'flagged', 'unknown')),
  comment_count bigint CHECK (comment_count IS NULL OR comment_count >= 0),
  spam_ratio numeric(5,4) CHECK (spam_ratio IS NULL OR spam_ratio BETWEEN 0 AND 1),
  sentiment_score numeric(6,5) CHECK (sentiment_score IS NULL OR sentiment_score BETWEEN -1 AND 1),
  aggregate_metrics jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(aggregate_metrics) = 'object'),
  model_version text
    CHECK (model_version IS NULL OR model_version ~ '^[a-z][a-z0-9._/-]{0,79}$'),
  retention_policy_version text NOT NULL
    CHECK (retention_policy_version ~ '^[a-z][a-z0-9._/-]{0,79}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (retrieved_at >= observed_at),
  CHECK (evidence_state <> 'inferred' OR model_version IS NOT NULL),
  CHECK (evidence_state <> 'unavailable' OR (
    comment_count IS NULL AND spam_ratio IS NULL AND sentiment_score IS NULL AND aggregate_metrics = '{}'::jsonb
  ))
);

CREATE TABLE IF NOT EXISTS influencer_intelligence.creator_analysis (
  analysis_key text PRIMARY KEY
    CHECK (analysis_key ~ '^[A-Za-z0-9._:-]{1,160}$'),
  ingest_key text NOT NULL UNIQUE
    CHECK (ingest_key ~ '^[A-Za-z0-9._:-]{1,240}$'),
  creator_key text NOT NULL
    REFERENCES influencer_intelligence.creator_registry(creator_key)
    ON DELETE RESTRICT,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  evidence_state text NOT NULL
    CHECK (evidence_state IN ('derived', 'inferred', 'unavailable')),
  confidence numeric(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  coverage_available integer NOT NULL CHECK (coverage_available >= 0),
  coverage_expected integer NOT NULL CHECK (coverage_expected > 0),
  algorithm_version text NOT NULL
    CHECK (algorithm_version ~ '^[a-z][a-z0-9._/-]{0,79}$'),
  model_version text
    CHECK (model_version IS NULL OR model_version ~ '^[a-z][a-z0-9._/-]{0,79}$'),
  providers text[] NOT NULL DEFAULT '{}'::text[],
  input_fingerprint text NOT NULL
    CHECK (input_fingerprint ~ '^[0-9a-f]{64}$'),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(provenance) = 'object'),
  analysis_metrics jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(analysis_metrics) = 'object'),
  computed_at timestamptz NOT NULL,
  retention_policy_version text NOT NULL
    CHECK (retention_policy_version ~ '^[a-z][a-z0-9._/-]{0,79}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (window_end > window_start),
  CHECK (coverage_available <= coverage_expected),
  CHECK (evidence_state = 'unavailable' OR cardinality(providers) > 0),
  CHECK (evidence_state = 'unavailable' OR (provenance ? 'entries' AND jsonb_typeof(provenance->'entries') = 'array' AND jsonb_array_length(provenance->'entries') > 0)),
  CHECK (evidence_state <> 'inferred' OR model_version IS NOT NULL),
  CHECK (evidence_state <> 'unavailable' OR (confidence = 0 AND analysis_metrics = '{}'::jsonb))
);

CREATE TABLE IF NOT EXISTS influencer_intelligence.creator_score (
  score_key text PRIMARY KEY
    CHECK (score_key ~ '^[A-Za-z0-9._:-]{1,160}$'),
  ingest_key text NOT NULL UNIQUE
    CHECK (ingest_key ~ '^[A-Za-z0-9._:-]{1,240}$'),
  creator_key text NOT NULL
    REFERENCES influencer_intelligence.creator_registry(creator_key)
    ON DELETE RESTRICT,
  score_kind text NOT NULL
    CHECK (score_kind IN ('influencer', 'campaign-fit', 'brand-fit', 'risk')),
  score numeric(6,2) CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  confidence numeric(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  coverage_available integer NOT NULL CHECK (coverage_available >= 0),
  coverage_expected integer NOT NULL CHECK (coverage_expected > 0),
  evidence_state text NOT NULL
    CHECK (evidence_state IN ('derived', 'inferred', 'unavailable')),
  algorithm_version text NOT NULL
    CHECK (algorithm_version ~ '^[a-z][a-z0-9._/-]{0,79}$'),
  model_version text
    CHECK (model_version IS NULL OR model_version ~ '^[a-z][a-z0-9._/-]{0,79}$'),
  providers text[] NOT NULL DEFAULT '{}'::text[],
  input_fingerprint text NOT NULL
    CHECK (input_fingerprint ~ '^[0-9a-f]{64}$'),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(provenance) = 'object'),
  computed_at timestamptz NOT NULL,
  retention_policy_version text NOT NULL
    CHECK (retention_policy_version ~ '^[a-z][a-z0-9._/-]{0,79}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (coverage_available <= coverage_expected),
  CHECK (evidence_state = 'unavailable' OR cardinality(providers) > 0),
  CHECK (evidence_state = 'unavailable' OR (provenance ? 'entries' AND jsonb_typeof(provenance->'entries') = 'array' AND jsonb_array_length(provenance->'entries') > 0)),
  CHECK (evidence_state <> 'inferred' OR model_version IS NOT NULL),
  CHECK ((evidence_state = 'unavailable') = (score IS NULL)),
  CHECK (evidence_state <> 'unavailable' OR confidence = 0)
);

CREATE TABLE IF NOT EXISTS influencer_intelligence.creator_score_component (
  component_key text PRIMARY KEY
    CHECK (component_key ~ '^[A-Za-z0-9._:-]{1,160}$'),
  ingest_key text NOT NULL UNIQUE
    CHECK (ingest_key ~ '^[A-Za-z0-9._:-]{1,240}$'),
  score_key text NOT NULL
    REFERENCES influencer_intelligence.creator_score(score_key)
    ON DELETE RESTRICT,
  component_name text NOT NULL
    CHECK (component_name ~ '^[a-z][a-z0-9._-]{0,79}$'),
  value numeric(12,6),
  weight numeric(12,6) CHECK (weight IS NULL OR weight >= 0),
  contribution numeric(12,6),
  evidence_state text NOT NULL
    CHECK (evidence_state IN ('derived', 'inferred', 'unavailable')),
  confidence numeric(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  algorithm_version text NOT NULL
    CHECK (algorithm_version ~ '^[a-z][a-z0-9._/-]{0,79}$'),
  model_version text
    CHECK (model_version IS NULL OR model_version ~ '^[a-z][a-z0-9._/-]{0,79}$'),
  providers text[] NOT NULL DEFAULT '{}'::text[],
  evidence_refs text[] NOT NULL DEFAULT '{}'::text[],
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(provenance) = 'object'),
  retention_policy_version text NOT NULL
    CHECK (retention_policy_version ~ '^[a-z][a-z0-9._/-]{0,79}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (evidence_state <> 'inferred' OR model_version IS NOT NULL),
  CHECK (evidence_state = 'unavailable' OR (cardinality(providers) > 0 AND cardinality(evidence_refs) > 0)),
  CHECK (evidence_state <> 'unavailable' OR (value IS NULL AND contribution IS NULL AND confidence = 0))
);

CREATE TABLE IF NOT EXISTS influencer_intelligence.campaign (
  campaign_key text PRIMARY KEY
    CHECK (campaign_key ~ '^[A-Za-z0-9._:-]{1,160}$'),
  campaign_version integer NOT NULL DEFAULT 1 CHECK (campaign_version >= 1),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'archived')),
  criteria_version text NOT NULL
    CHECK (criteria_version ~ '^[a-z][a-z0-9._/-]{0,79}$'),
  criteria jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(criteria) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_key, campaign_version)
);

CREATE TABLE IF NOT EXISTS influencer_intelligence.campaign_creator_fit (
  fit_key text PRIMARY KEY
    CHECK (fit_key ~ '^[A-Za-z0-9._:-]{1,160}$'),
  ingest_key text NOT NULL UNIQUE
    CHECK (ingest_key ~ '^[A-Za-z0-9._:-]{1,240}$'),
  campaign_key text NOT NULL,
  campaign_version integer NOT NULL CHECK (campaign_version >= 1),
  creator_key text NOT NULL
    REFERENCES influencer_intelligence.creator_registry(creator_key)
    ON DELETE RESTRICT,
  score numeric(6,2) CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  confidence numeric(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  coverage_available integer NOT NULL CHECK (coverage_available >= 0),
  coverage_expected integer NOT NULL CHECK (coverage_expected > 0),
  evidence_state text NOT NULL
    CHECK (evidence_state IN ('derived', 'inferred', 'unavailable')),
  algorithm_version text NOT NULL
    CHECK (algorithm_version ~ '^[a-z][a-z0-9._/-]{0,79}$'),
  model_version text
    CHECK (model_version IS NULL OR model_version ~ '^[a-z][a-z0-9._/-]{0,79}$'),
  providers text[] NOT NULL DEFAULT '{}'::text[],
  input_fingerprint text NOT NULL
    CHECK (input_fingerprint ~ '^[0-9a-f]{64}$'),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(provenance) = 'object'),
  computed_at timestamptz NOT NULL,
  retention_policy_version text NOT NULL
    CHECK (retention_policy_version ~ '^[a-z][a-z0-9._/-]{0,79}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (campaign_key, campaign_version)
    REFERENCES influencer_intelligence.campaign(campaign_key, campaign_version)
    ON DELETE RESTRICT,
  CHECK (coverage_available <= coverage_expected),
  CHECK (evidence_state = 'unavailable' OR cardinality(providers) > 0),
  CHECK (evidence_state = 'unavailable' OR (provenance ? 'entries' AND jsonb_typeof(provenance->'entries') = 'array' AND jsonb_array_length(provenance->'entries') > 0)),
  CHECK (evidence_state <> 'inferred' OR model_version IS NOT NULL),
  CHECK ((evidence_state = 'unavailable') = (score IS NULL)),
  CHECK (evidence_state <> 'unavailable' OR confidence = 0)
);

-- Historical evidence is immutable. A rerun receives a new key/ingest_key and
-- can therefore be compared without rewriting the original observation.
CREATE OR REPLACE FUNCTION influencer_intelligence.prevent_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only evidence', TG_TABLE_NAME;
END;
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'collector_evidence',
    'creator_profile_snapshot',
    'creator_media_snapshot',
    'creator_comment_sample',
    'creator_analysis',
    'creator_score',
    'creator_score_component',
    'campaign_creator_fit'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_trigger trigger_row
      JOIN pg_class relation ON relation.oid = trigger_row.tgrelid
      JOIN pg_namespace namespace_row ON namespace_row.oid = relation.relnamespace
      WHERE trigger_row.tgname = table_name || '_append_only'
        AND relation.relname = table_name
        AND namespace_row.nspname = 'influencer_intelligence'
        AND NOT trigger_row.tgisinternal
    ) THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON influencer_intelligence.%I FOR EACH ROW EXECUTE FUNCTION influencer_intelligence.prevent_append_only_mutation()', table_name || '_append_only', table_name);
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_trigger trigger_row
      JOIN pg_class relation ON relation.oid = trigger_row.tgrelid
      JOIN pg_namespace namespace_row ON namespace_row.oid = relation.relnamespace
      WHERE trigger_row.tgname = table_name || '_no_truncate'
        AND relation.relname = table_name
        AND namespace_row.nspname = 'influencer_intelligence'
        AND NOT trigger_row.tgisinternal
    ) THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON influencer_intelligence.%I FOR EACH STATEMENT EXECUTE FUNCTION influencer_intelligence.prevent_append_only_mutation()', table_name || '_no_truncate', table_name);
    END IF;
  END LOOP;
END
$$;

CREATE INDEX IF NOT EXISTS creator_identity_creator_observed_idx
  ON influencer_intelligence.creator_identity (creator_key, observed_at DESC);
CREATE INDEX IF NOT EXISTS collector_run_status_updated_idx
  ON influencer_intelligence.collector_run (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS collector_evidence_run_created_idx
  ON influencer_intelligence.collector_evidence (run_key, created_at DESC);
CREATE INDEX IF NOT EXISTS collector_evidence_creator_observed_idx
  ON influencer_intelligence.collector_evidence (creator_key, observed_at DESC);
CREATE INDEX IF NOT EXISTS creator_media_creator_published_idx
  ON influencer_intelligence.creator_media (creator_key, published_at DESC);
CREATE INDEX IF NOT EXISTS creator_profile_snapshot_creator_observed_idx
  ON influencer_intelligence.creator_profile_snapshot (creator_key, observed_at DESC);
CREATE INDEX IF NOT EXISTS creator_profile_snapshot_provider_observed_idx
  ON influencer_intelligence.creator_profile_snapshot (provider, observed_at DESC);
CREATE INDEX IF NOT EXISTS creator_media_snapshot_media_observed_idx
  ON influencer_intelligence.creator_media_snapshot (media_key, observed_at DESC);
CREATE INDEX IF NOT EXISTS creator_media_snapshot_creator_observed_idx
  ON influencer_intelligence.creator_media_snapshot (creator_key, observed_at DESC);
CREATE INDEX IF NOT EXISTS creator_comment_sample_creator_observed_idx
  ON influencer_intelligence.creator_comment_sample (creator_key, observed_at DESC);
CREATE INDEX IF NOT EXISTS creator_analysis_creator_computed_idx
  ON influencer_intelligence.creator_analysis (creator_key, computed_at DESC);
CREATE INDEX IF NOT EXISTS creator_score_creator_computed_idx
  ON influencer_intelligence.creator_score (creator_key, computed_at DESC);
CREATE INDEX IF NOT EXISTS creator_score_kind_computed_idx
  ON influencer_intelligence.creator_score (score_kind, computed_at DESC);
CREATE INDEX IF NOT EXISTS creator_score_component_score_idx
  ON influencer_intelligence.creator_score_component (score_key, component_name);
CREATE INDEX IF NOT EXISTS campaign_creator_fit_campaign_computed_idx
  ON influencer_intelligence.campaign_creator_fit (campaign_key, campaign_version, computed_at DESC);
CREATE INDEX IF NOT EXISTS campaign_creator_fit_creator_computed_idx
  ON influencer_intelligence.campaign_creator_fit (creator_key, computed_at DESC);

COMMIT;
