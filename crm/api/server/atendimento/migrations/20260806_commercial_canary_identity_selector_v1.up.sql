-- Additive, explicitly managed migration for the commercial canary selector.
-- The selector stores immutable cohort snapshots and aggregate audit payloads;
-- it never accepts a hand-maintained UUID allowlist from the UI.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS crm_atendimento.commercial_canary_cohorts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version bigint NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('active', 'removed', 'emergency_off', 'rolled_back')),
  policy_version text NOT NULL CHECK (policy_version ~ '^[a-f0-9]{32}$'),
  cohort_hash text NOT NULL CHECK (cohort_hash ~ '^[a-f0-9]{64}$'),
  justification text NOT NULL CHECK (length(trim(justification)) BETWEEN 10 AND 1000),
  member_count integer NOT NULL DEFAULT 0 CHECK (member_count >= 0),
  created_by text NOT NULL CHECK (length(trim(created_by)) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  emergency_off_at timestamptz,
  UNIQUE(version)
);

CREATE UNIQUE INDEX IF NOT EXISTS commercial_canary_one_active_idx
  ON crm_atendimento.commercial_canary_cohorts(status)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS crm_atendimento.commercial_canary_cohort_members (
  cohort_id uuid NOT NULL REFERENCES crm_atendimento.commercial_canary_cohorts(id) ON DELETE RESTRICT,
  identity_id uuid NOT NULL REFERENCES crm_atendimento.global_client_identities(id) ON DELETE RESTRICT,
  unit_slug text NOT NULL CHECK (length(trim(unit_slug)) BETWEEN 1 AND 80),
  inclusion_reason text NOT NULL CHECK (length(trim(inclusion_reason)) BETWEEN 1 AND 240),
  validation_type text NOT NULL CHECK (validation_type IN ('synthetic', 'explicit_approved')),
  source_freshness text NOT NULL CHECK (source_freshness IN ('healthy', 'preventive', 'stale', 'unknown')),
  identity_quality text NOT NULL,
  eligibility_status text NOT NULL CHECK (eligibility_status IN ('eligible', 'blocked', 'review')),
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cohort_id, identity_id),
  CHECK (NOT (snapshot ?| ARRAY['name','phone','email','display_name','canonical_name']))
);

CREATE INDEX IF NOT EXISTS commercial_canary_cohort_members_identity_idx
  ON crm_atendimento.commercial_canary_cohort_members(identity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS crm_atendimento.commercial_canary_identity_validations (
  identity_id uuid PRIMARY KEY REFERENCES crm_atendimento.global_client_identities(id) ON DELETE RESTRICT,
  validation_type text NOT NULL CHECK (validation_type IN ('synthetic', 'explicit_approved')),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 10 AND 1000),
  approved_by text NOT NULL CHECK (length(trim(approved_by)) BETWEEN 1 AND 160),
  approved_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_atendimento.commercial_canary_events (
  event_order bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  event_type text NOT NULL CHECK (event_type IN ('identity_validated', 'cohort_saved', 'cohort_removed', 'emergency_off', 'rollback')),
  idempotency_key text NOT NULL UNIQUE CHECK (length(trim(idempotency_key)) BETWEEN 1 AND 128),
  cohort_id uuid REFERENCES crm_atendimento.commercial_canary_cohorts(id) ON DELETE RESTRICT,
  previous_cohort_id uuid REFERENCES crm_atendimento.commercial_canary_cohorts(id) ON DELETE RESTRICT,
  policy_version text NOT NULL CHECK (policy_version ~ '^[a-f0-9]{32}$'),
  actor text NOT NULL CHECK (length(trim(actor)) BETWEEN 1 AND 160),
  justification text NOT NULL CHECK (length(trim(justification)) BETWEEN 10 AND 1000),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT (payload ?| ARRAY['name','phone','email','display_name','canonical_name','identityIds','identity_ids']))
);

CREATE OR REPLACE FUNCTION crm_atendimento.prevent_commercial_canary_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'commercial canary evidence is append-only';
END $$;

DROP TRIGGER IF EXISTS commercial_canary_events_immutable
  ON crm_atendimento.commercial_canary_events;
CREATE TRIGGER commercial_canary_events_immutable
BEFORE UPDATE OR DELETE ON crm_atendimento.commercial_canary_events
FOR EACH ROW EXECUTE FUNCTION crm_atendimento.prevent_commercial_canary_event_mutation();

DROP TRIGGER IF EXISTS commercial_canary_events_no_truncate
  ON crm_atendimento.commercial_canary_events;
CREATE TRIGGER commercial_canary_events_no_truncate
BEFORE TRUNCATE ON crm_atendimento.commercial_canary_events
FOR EACH STATEMENT EXECUTE FUNCTION crm_atendimento.prevent_commercial_canary_event_mutation();

CREATE TABLE IF NOT EXISTS crm_atendimento.commercial_canary_validation_events (
  event_order bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  identity_id uuid NOT NULL REFERENCES crm_atendimento.global_client_identities(id) ON DELETE RESTRICT,
  validation_type text NOT NULL CHECK (validation_type IN ('synthetic', 'explicit_approved')),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 10 AND 1000),
  actor text NOT NULL CHECK (length(trim(actor)) BETWEEN 1 AND 160),
  revision integer NOT NULL CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS commercial_canary_validation_events_immutable
  ON crm_atendimento.commercial_canary_validation_events;
CREATE TRIGGER commercial_canary_validation_events_immutable
BEFORE UPDATE OR DELETE ON crm_atendimento.commercial_canary_validation_events
FOR EACH ROW EXECUTE FUNCTION crm_atendimento.prevent_commercial_canary_event_mutation();

DROP TRIGGER IF EXISTS commercial_canary_validation_events_no_truncate
  ON crm_atendimento.commercial_canary_validation_events;
CREATE TRIGGER commercial_canary_validation_events_no_truncate
BEFORE TRUNCATE ON crm_atendimento.commercial_canary_validation_events
FOR EACH STATEMENT EXECUTE FUNCTION crm_atendimento.prevent_commercial_canary_event_mutation();

CREATE INDEX IF NOT EXISTS commercial_canary_events_created_idx
  ON crm_atendimento.commercial_canary_events(created_at DESC, event_order DESC);
CREATE INDEX IF NOT EXISTS commercial_canary_validation_events_identity_idx
  ON crm_atendimento.commercial_canary_validation_events(identity_id, event_order DESC);
