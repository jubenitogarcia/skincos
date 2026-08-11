-- Reviewed additive artifact for the Influencer Intelligence registry.
-- Apply only through a future controlled PostgreSQL runner after the staging
-- role, destination identity, checkpoint, and verification gates exist.
-- The runner records this id in schema_migrations after the transaction:
-- 20260810_influencer_intelligence_registry_v1.

CREATE SCHEMA IF NOT EXISTS influencer_intelligence;

CREATE TABLE IF NOT EXISTS influencer_intelligence.schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now(),
  rolled_back_at timestamptz,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS influencer_intelligence.creator_registry (
  creator_key text PRIMARY KEY
    CHECK (creator_key ~ '^[A-Za-z0-9._:-]{1,128}$'),
  canonical_handle text
    CHECK (canonical_handle IS NULL OR canonical_handle ~ '^[a-z0-9._]{1,30}$'),
  registry_state text NOT NULL DEFAULT 'candidate'
    CHECK (registry_state IN ('candidate', 'paused', 'unavailable')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS influencer_intelligence.creator_provider_registry (
  creator_key text NOT NULL
    REFERENCES influencer_intelligence.creator_registry(creator_key)
    ON DELETE RESTRICT,
  provider text NOT NULL
    CHECK (provider IN ('meta-graph', 'instagrapi')),
  provider_account_digest text
    CHECK (provider_account_digest IS NULL OR provider_account_digest ~ '^[0-9a-f]{64}$'),
  provider_state text NOT NULL DEFAULT 'unavailable'
    CHECK (provider_state IN ('configured', 'revoked', 'unavailable')),
  evidence_state text NOT NULL DEFAULT 'unavailable'
    CHECK (evidence_state IN ('observed', 'unavailable')),
  last_observed_at timestamptz,
  last_retrieved_at timestamptz,
  source_ref text
    CHECK (source_ref IS NULL OR (char_length(btrim(source_ref)) BETWEEN 1 AND 240 AND source_ref !~ '[?#]')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (creator_key, provider),
  CHECK ((provider_state = 'unavailable') = (provider_account_digest IS NULL)),
  CHECK ((provider_state = 'unavailable') = (evidence_state = 'unavailable')),
  CHECK (provider_state = 'unavailable' OR last_observed_at IS NOT NULL),
  CHECK (last_retrieved_at IS NULL OR (last_observed_at IS NOT NULL AND last_retrieved_at >= last_observed_at))
);

CREATE INDEX IF NOT EXISTS creator_registry_state_idx
  ON influencer_intelligence.creator_registry(registry_state, updated_at DESC);

CREATE INDEX IF NOT EXISTS creator_provider_registry_state_idx
  ON influencer_intelligence.creator_provider_registry(provider, provider_state, updated_at DESC);
