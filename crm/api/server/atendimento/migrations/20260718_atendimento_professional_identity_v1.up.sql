-- Execute with migrate-atendimento-professional-identity.mjs --apply.
-- The runner is limited to local skincos_crm_local, links only explicitly
-- confirmed aliases, and never deletes professional rows or historical FKs.
ALTER TABLE crm_atendimento.professionals ADD COLUMN IF NOT EXISTS canonical_id uuid;
ALTER TABLE crm_atendimento.professionals ADD COLUMN IF NOT EXISTS identity_version text NOT NULL DEFAULT 'professional-identity/v1';
ALTER TABLE crm_atendimento.attendances ADD COLUMN IF NOT EXISTS injector_source_name text;
ALTER TABLE crm_atendimento.attendances ADD COLUMN IF NOT EXISTS consultant_source_name text;
ALTER TABLE crm_atendimento.schedule_days ADD COLUMN IF NOT EXISTS professional_id uuid;

CREATE TABLE IF NOT EXISTS crm_atendimento.professional_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid NOT NULL REFERENCES crm_atendimento.professionals(id) ON DELETE RESTRICT,
  alias text NOT NULL,
  alias_key text NOT NULL,
  source text NOT NULL DEFAULT 'roster',
  confidence text NOT NULL DEFAULT 'confirmed',
  active boolean NOT NULL DEFAULT true,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(professional_id, alias_key)
);

CREATE TABLE IF NOT EXISTS crm_atendimento.professional_identity_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  actor jsonb,
  source_professional_id uuid REFERENCES crm_atendimento.professionals(id) ON DELETE RESTRICT,
  canonical_professional_id uuid REFERENCES crm_atendimento.professionals(id) ON DELETE RESTRICT,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The runner backfills canonical_id=id and applies only reviewed alias links.
-- It creates the following indexes CONCURRENTLY outside a transaction:
-- crm_atendimento_professionals_canonical_idx
-- crm_atendimento_professional_aliases_key_idx
-- crm_atendimento_schedule_professional_period_idx
