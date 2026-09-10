-- Atendimento-owned CRM Core projection delta state.
-- This migration is additive and never copies customer attributes.  The
-- outbox is the sole source of upsert/revoke events and retains tombstones.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS crm_atendimento.crm_core_projection_memberships (
  identity_id uuid NOT NULL REFERENCES crm_atendimento.global_client_identities(id) ON DELETE RESTRICT,
  unit_slug text NOT NULL CHECK (
    unit_slug = lower(unit_slug)
    AND unit_slug ~ '^(?!all$|unknown$)[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$'
  ),
  active boolean NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  observed_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (identity_id, unit_slug)
);

CREATE TABLE IF NOT EXISTS crm_atendimento.crm_core_projection_outbox (
  -- Identity values are monotonic but may be sparse when a writer transaction
  -- rolls back. Consumers must use the high-watermark/keyset, not assume
  -- contiguous values.
  event_order bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  identity_id uuid NOT NULL REFERENCES crm_atendimento.global_client_identities(id) ON DELETE RESTRICT,
  unit_slug text NOT NULL CHECK (
    unit_slug = lower(unit_slug)
    AND unit_slug ~ '^(?!all$|unknown$)[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$'
  ),
  revision bigint NOT NULL CHECK (revision >= 1),
  operation text NOT NULL CHECK (operation IN ('upsert', 'revoke')),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_core_projection_memberships_active_idx
  ON crm_atendimento.crm_core_projection_memberships(unit_slug, identity_id)
  WHERE active;

CREATE INDEX IF NOT EXISTS crm_core_projection_outbox_identity_unit_order_idx
  ON crm_atendimento.crm_core_projection_outbox(identity_id, unit_slug, event_order);

CREATE INDEX IF NOT EXISTS crm_core_projection_outbox_order_idx
  ON crm_atendimento.crm_core_projection_outbox(event_order);

CREATE OR REPLACE FUNCTION crm_atendimento.prevent_crm_core_projection_outbox_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'crm core projection outbox is append-only';
END $$;

DROP TRIGGER IF EXISTS crm_core_projection_outbox_immutable
  ON crm_atendimento.crm_core_projection_outbox;
CREATE TRIGGER crm_core_projection_outbox_immutable
  BEFORE UPDATE OR DELETE ON crm_atendimento.crm_core_projection_outbox
  FOR EACH ROW EXECUTE FUNCTION crm_atendimento.prevent_crm_core_projection_outbox_mutation();

DROP TRIGGER IF EXISTS crm_core_projection_outbox_no_truncate
  ON crm_atendimento.crm_core_projection_outbox;
CREATE TRIGGER crm_core_projection_outbox_no_truncate
  BEFORE TRUNCATE ON crm_atendimento.crm_core_projection_outbox
  FOR EACH STATEMENT EXECUTE FUNCTION crm_atendimento.prevent_crm_core_projection_outbox_mutation();

-- The source owner records the baseline handoff in the same transaction that
-- seeds revision-1 memberships. Reconciliation is blocked until this single
-- row reaches delta-ready after every paginated backfill receipt and ledger
-- readback has been verified.
CREATE TABLE IF NOT EXISTS crm_atendimento.crm_core_projection_delta_handoffs (
  handoff_key text PRIMARY KEY CHECK (handoff_key = 'initial'),
  state text NOT NULL CHECK (state IN ('baseline-prepared', 'baseline-accepted', 'delta-ready')),
  baseline_digest text NOT NULL CHECK (baseline_digest ~ '^sha256:[a-f0-9]{64}$'),
  captured_at timestamptz NOT NULL,
  cursor_digest text NOT NULL CHECK (cursor_digest ~ '^sha256:[a-f0-9]{64}$'),
  membership_digest text NOT NULL CHECK (membership_digest ~ '^sha256:[a-f0-9]{64}$'),
  row_count bigint NOT NULL CHECK (row_count >= 0),
  unit_slugs jsonb NOT NULL,
  watermark bigint NOT NULL CHECK (watermark >= 0),
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^sha256:[a-f0-9]{64}$'),
  batch_count bigint NOT NULL CHECK (batch_count >= 0),
  event_count bigint NOT NULL CHECK (event_count >= 0),
  backfill_key_id text NOT NULL,
  delta_key_id text NOT NULL,
  identity_key_fingerprint text NOT NULL CHECK (identity_key_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  unit_allowlist jsonb NOT NULL,
  target_environment text NOT NULL CHECK (target_environment IN ('staging', 'production')),
  target_release text NOT NULL CHECK (target_release ~ '^[0-9a-f]{40}$'),
  target_artifact_digest text NOT NULL CHECK (target_artifact_digest ~ '^sha256:[a-f0-9]{64}$'),
  -- Complete sanitized baseline/receipt/readback document for durable resume.
  -- The contract contains only opaque identifiers, digests and release pins.
  baseline_json jsonb NOT NULL,
  baseline_packets_json jsonb NOT NULL,
  receipt_status text,
  receipt_count bigint,
  accepted_at timestamptz,
  readback_membership_digest text CHECK (readback_membership_digest IS NULL OR readback_membership_digest ~ '^sha256:[a-f0-9]{64}$'),
  readback_watermark bigint CHECK (readback_watermark IS NULL OR readback_watermark >= 0),
  ready_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A source-only staging schema created by an earlier candidate must fail
-- closed until it has a fully pinned handoff; the runtime validates these
-- fields before custody, state transition, or reconciliation.
ALTER TABLE crm_atendimento.crm_core_projection_delta_handoffs
  ADD COLUMN IF NOT EXISTS identity_key_fingerprint text;
ALTER TABLE crm_atendimento.crm_core_projection_delta_handoffs
  ADD COLUMN IF NOT EXISTS unit_allowlist jsonb;
ALTER TABLE crm_atendimento.crm_core_projection_delta_handoffs
  ADD COLUMN IF NOT EXISTS baseline_packets_json jsonb;
