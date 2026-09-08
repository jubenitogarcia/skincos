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
