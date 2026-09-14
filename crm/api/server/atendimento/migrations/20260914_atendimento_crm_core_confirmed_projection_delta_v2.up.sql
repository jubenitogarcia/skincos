-- v5 confirmed-membership delta state. This is additive and intentionally
-- separate from the legacy global-identity outbox. It contains UUID-only
-- state, opaque handoff packets and profile digests; no customer attributes.

CREATE SCHEMA IF NOT EXISTS crm_atendimento;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS crm_atendimento.crm_core_confirmed_projection_delta_v2_memberships (
  identity_id uuid NOT NULL REFERENCES crm_atendimento.crm_core_identities(id) ON DELETE RESTRICT,
  unit_slug text NOT NULL CHECK (
    unit_slug = lower(unit_slug)
    AND unit_slug ~ '^(?!all$|unknown$)[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$'
  ),
  active boolean NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  observed_at timestamptz NOT NULL,
  source_profile_digest text NOT NULL CHECK (
    source_profile_digest = 'sha256:b32c45bc2a189d44d0236f3782d2d8e8d1cc0c66efef9d2a370f893b7e82b2ce'
  ),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (identity_id, unit_slug)
);

CREATE TABLE IF NOT EXISTS crm_atendimento.crm_core_confirmed_projection_delta_v2_outbox (
  -- Values may be sparse after a rolled-back writer transaction. Exporters
  -- must use a bounded high-watermark/keyset rather than assume contiguity.
  event_order bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  identity_id uuid NOT NULL REFERENCES crm_atendimento.crm_core_identities(id) ON DELETE RESTRICT,
  unit_slug text NOT NULL CHECK (
    unit_slug = lower(unit_slug)
    AND unit_slug ~ '^(?!all$|unknown$)[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$'
  ),
  revision bigint NOT NULL CHECK (revision >= 1),
  operation text NOT NULL CHECK (operation IN ('upsert', 'revoke')),
  occurred_at timestamptz NOT NULL,
  source_semantics text NOT NULL CHECK (
    source_semantics = 'atendimento/crm-core/confirmed-unit-membership-source/v5'
  ),
  source_profile_digest text NOT NULL CHECK (
    source_profile_digest = 'sha256:b32c45bc2a189d44d0236f3782d2d8e8d1cc0c66efef9d2a370f893b7e82b2ce'
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_core_confirmed_projection_delta_v2_memberships_active_idx
  ON crm_atendimento.crm_core_confirmed_projection_delta_v2_memberships(unit_slug, identity_id)
  WHERE active;
CREATE INDEX IF NOT EXISTS crm_core_confirmed_projection_delta_v2_outbox_order_idx
  ON crm_atendimento.crm_core_confirmed_projection_delta_v2_outbox(event_order);
CREATE INDEX IF NOT EXISTS crm_core_confirmed_projection_delta_v2_outbox_identity_unit_order_idx
  ON crm_atendimento.crm_core_confirmed_projection_delta_v2_outbox(identity_id, unit_slug, event_order);

CREATE OR REPLACE FUNCTION crm_atendimento.prevent_crm_core_confirmed_projection_delta_v2_outbox_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'confirmed crm core projection delta v2 outbox is append-only';
END $$;

DROP TRIGGER IF EXISTS crm_core_confirmed_projection_delta_v2_outbox_immutable
  ON crm_atendimento.crm_core_confirmed_projection_delta_v2_outbox;
CREATE TRIGGER crm_core_confirmed_projection_delta_v2_outbox_immutable
  BEFORE UPDATE OR DELETE ON crm_atendimento.crm_core_confirmed_projection_delta_v2_outbox
  FOR EACH ROW EXECUTE FUNCTION crm_atendimento.prevent_crm_core_confirmed_projection_delta_v2_outbox_mutation();
DROP TRIGGER IF EXISTS crm_core_confirmed_projection_delta_v2_outbox_no_truncate
  ON crm_atendimento.crm_core_confirmed_projection_delta_v2_outbox;
CREATE TRIGGER crm_core_confirmed_projection_delta_v2_outbox_no_truncate
  BEFORE TRUNCATE ON crm_atendimento.crm_core_confirmed_projection_delta_v2_outbox
  FOR EACH STATEMENT EXECUTE FUNCTION crm_atendimento.prevent_crm_core_confirmed_projection_delta_v2_outbox_mutation();

-- One sanitized, profile-pinned handoff. The guarded JavaScript migration is
-- the executable authority for state transitions and grants; this companion
-- SQL is auditable DDL only and never starts a backfill or delivery.
CREATE TABLE IF NOT EXISTS crm_atendimento.crm_core_confirmed_projection_delta_v2_handoffs (
  handoff_key text PRIMARY KEY CHECK (handoff_key = 'initial'),
  state text NOT NULL CHECK (state IN ('baseline-prepared', 'baseline-accepted', 'delta-ready')),
  source_profile_json jsonb NOT NULL,
  source_profile_digest text NOT NULL CHECK (
    source_profile_digest = 'sha256:b32c45bc2a189d44d0236f3782d2d8e8d1cc0c66efef9d2a370f893b7e82b2ce'
  ),
  baseline_digest text NOT NULL CHECK (baseline_digest ~ '^sha256:[a-f0-9]{64}$'),
  baseline_json jsonb NOT NULL,
  baseline_packets_json jsonb NOT NULL,
  receipt_status text,
  receipt_count bigint,
  readback_membership_digest text CHECK (
    readback_membership_digest IS NULL OR readback_membership_digest ~ '^sha256:[a-f0-9]{64}$'
  ),
  readback_watermark bigint CHECK (readback_watermark IS NULL OR readback_watermark >= 0),
  accepted_at timestamptz,
  ready_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
