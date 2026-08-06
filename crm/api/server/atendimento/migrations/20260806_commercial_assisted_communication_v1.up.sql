-- Apply only through migrate-atendimento-commercial-assisted-communication.mjs
-- against the private local mirror or isolated staging database.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE crm_atendimento.commercial_actions
  ADD COLUMN IF NOT EXISTS offer_id uuid REFERENCES crm_atendimento.commercial_offers(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS offer_revision integer,
  ADD COLUMN IF NOT EXISTS offer_context_hash text,
  ADD COLUMN IF NOT EXISTS offer_context jsonb,
  ADD COLUMN IF NOT EXISTS offer_unit_slug text,
  ADD COLUMN IF NOT EXISTS offer_validity_end date,
  ADD COLUMN IF NOT EXISTS campaign_key text;

CREATE TABLE IF NOT EXISTS crm_atendimento.commercial_offer_revisions (
  offer_id uuid NOT NULL REFERENCES crm_atendimento.commercial_offers(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision > 0),
  context jsonb NOT NULL,
  context_hash text NOT NULL,
  captured_by text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (offer_id, revision)
);

CREATE TABLE IF NOT EXISTS crm_atendimento.commercial_whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  unit_id uuid REFERENCES crm_atendimento.units(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('draft','approved','disabled')),
  body_template text NOT NULL CHECK (length(body_template) BETWEEN 1 AND 4096),
  offer_required boolean NOT NULL DEFAULT true,
  valid_from timestamptz,
  valid_until timestamptz,
  approved_by text,
  approved_at timestamptz,
  created_by text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(template_key, revision),
  CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until > valid_from),
  CHECK (status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS crm_atendimento.commercial_whatsapp_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 8 AND 180),
  identity_id uuid NOT NULL,
  action_id uuid NOT NULL REFERENCES crm_atendimento.commercial_actions(id) ON DELETE RESTRICT,
  unit_id uuid NOT NULL REFERENCES crm_atendimento.units(id) ON DELETE RESTRICT,
  offer_id uuid NOT NULL REFERENCES crm_atendimento.commercial_offers(id) ON DELETE RESTRICT,
  offer_revision integer NOT NULL CHECK (offer_revision > 0),
  offer_context_hash text NOT NULL,
  template_key text NOT NULL,
  template_revision integer NOT NULL CHECK (template_revision > 0),
  recipient_phone_hash text NOT NULL,
  recipient_masked text NOT NULL,
  status text NOT NULL CHECK (status IN ('confirmed','opened','sent','delivered','read','replied','failed','opted_out','blocked')),
  campaign_key text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS crm_atendimento.commercial_whatsapp_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES crm_atendimento.commercial_whatsapp_attempts(id) ON DELETE RESTRICT,
  provider_event_key text NOT NULL UNIQUE,
  event_type text NOT NULL CHECK (event_type IN ('confirmed','opened','sent','delivered','read','replied','failed','stop')),
  occurred_at timestamptz NOT NULL,
  recorded_by text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE crm_atendimento.commercial_whatsapp_events
  DROP CONSTRAINT IF EXISTS commercial_whatsapp_events_event_type_check,
  ADD CONSTRAINT commercial_whatsapp_events_event_type_check
    CHECK (event_type IN ('confirmed','opened','sent','delivered','read','replied','failed','stop'));

CREATE TABLE IF NOT EXISTS crm_atendimento.commercial_contact_emergency_controls (
  scope_key text PRIMARY KEY,
  unit_id uuid REFERENCES crm_atendimento.units(id) ON DELETE RESTRICT,
  emergency_off boolean NOT NULL DEFAULT false,
  reason text NOT NULL DEFAULT '',
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope_key = 'global' AND unit_id IS NULL) OR (scope_key LIKE 'unit:%' AND unit_id IS NOT NULL))
);

INSERT INTO crm_atendimento.commercial_contact_emergency_controls(scope_key, unit_id, emergency_off, reason, updated_by)
VALUES ('global', NULL, false, 'default fail-closed control; emergency off inactive', 'migration')
ON CONFLICT(scope_key) DO NOTHING;

CREATE INDEX IF NOT EXISTS commercial_offer_revisions_lookup_idx ON crm_atendimento.commercial_offer_revisions(offer_id, revision DESC);
CREATE INDEX IF NOT EXISTS commercial_whatsapp_attempts_identity_idx ON crm_atendimento.commercial_whatsapp_attempts(identity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS commercial_whatsapp_events_attempt_idx ON crm_atendimento.commercial_whatsapp_events(attempt_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS commercial_whatsapp_templates_scope_idx ON crm_atendimento.commercial_whatsapp_templates(unit_id, status, template_key, revision DESC);

CREATE OR REPLACE FUNCTION crm_atendimento.prevent_commercial_assisted_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'commercial assisted communication evidence is append-only';
END $$;

-- The canonical JS runner installs row and TRUNCATE guards and destination
-- specific grants. No provider-send privilege is part of this migration.
