-- Execute through migrate-atendimento-commercial-contact.mjs --apply.
-- The supplied runner accepts only local skincos_crm_local. Remote application
-- requires the equivalent controlled Postgres release runbook, a checkpoint and
-- verification; this file is intentionally additive.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS crm_atendimento;
CREATE TABLE IF NOT EXISTS crm_atendimento.schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now(),
  rolled_back_at timestamptz,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS crm_atendimento.commercial_contact_permissions (
  identity_id uuid NOT NULL,
  channel text NOT NULL DEFAULT 'whatsapp' CHECK(channel IN ('whatsapp')),
  status text NOT NULL CHECK(status IN ('granted','denied')),
  evidence_source text NOT NULL,
  evidence_reference text NOT NULL,
  expires_at timestamptz,
  recorded_by text NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK(revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(identity_id, channel)
);

CREATE TABLE IF NOT EXISTS crm_atendimento.commercial_contact_permission_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id uuid NOT NULL,
  channel text NOT NULL CHECK(channel IN ('whatsapp')),
  previous_status text CHECK(previous_status IN ('granted','denied')),
  status text NOT NULL CHECK(status IN ('granted','denied')),
  evidence_source text NOT NULL,
  evidence_reference text NOT NULL,
  expires_at timestamptz,
  recorded_by text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE crm_atendimento.commercial_actions ADD COLUMN IF NOT EXISTS contact_channel text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_atendimento_commercial_actions_contact_channel_valid') THEN
    ALTER TABLE crm_atendimento.commercial_actions
      ADD CONSTRAINT crm_atendimento_commercial_actions_contact_channel_valid
      CHECK(contact_channel IS NULL OR contact_channel IN ('whatsapp')) NOT VALID;
  END IF;
END $$;
ALTER TABLE crm_atendimento.commercial_actions
  VALIDATE CONSTRAINT crm_atendimento_commercial_actions_contact_channel_valid;
CREATE INDEX CONCURRENTLY IF NOT EXISTS crm_atendimento_commercial_contact_permissions_status_idx
  ON crm_atendimento.commercial_contact_permissions(channel, status, updated_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS crm_atendimento_commercial_contact_permission_events_identity_idx
  ON crm_atendimento.commercial_contact_permission_events(identity_id, created_at DESC);
