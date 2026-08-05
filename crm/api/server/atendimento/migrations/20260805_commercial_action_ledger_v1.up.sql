-- Execute through migrate-atendimento-commercial-action-ledger.mjs --apply.
-- The runner accepts only the private local skincos_crm_local mirror. This
-- migration is additive: it preserves pre-cutover evidence rather than
-- inventing historical trace IDs or action events.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE crm_atendimento.commercial_contact_permission_events
  ADD COLUMN IF NOT EXISTS trace_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'commercial_permission_events_trace_required'
      AND conrelid = 'crm_atendimento.commercial_contact_permission_events'::regclass
  ) THEN
    ALTER TABLE crm_atendimento.commercial_contact_permission_events
      ADD CONSTRAINT commercial_permission_events_trace_required
      CHECK (trace_id IS NOT NULL) NOT VALID;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS crm_atendimento.commercial_action_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_order bigint GENERATED ALWAYS AS IDENTITY,
  action_id uuid NOT NULL REFERENCES crm_atendimento.commercial_actions(id) ON DELETE RESTRICT,
  identity_id uuid NOT NULL REFERENCES crm_atendimento.global_client_identities(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK(event_type IN ('created','updated')),
  previous_status text CHECK(previous_status IN ('open','contacted','responded','scheduled','won_sale','returned','closed','cancelled')),
  status text NOT NULL CHECK(status IN ('open','contacted','responded','scheduled','won_sale','returned','closed','cancelled')),
  trace_id uuid NOT NULL,
  recorded_by text NOT NULL,
  contact_eligibility_status text CHECK(contact_eligibility_status IN ('eligible','review_required','blocked')),
  contact_eligibility_reason text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION crm_atendimento.prevent_commercial_ledger_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'commercial ledger evidence is append-only';
END $$;

DROP TRIGGER IF EXISTS commercial_contact_permission_events_immutable
  ON crm_atendimento.commercial_contact_permission_events;
CREATE TRIGGER commercial_contact_permission_events_immutable
BEFORE UPDATE OR DELETE ON crm_atendimento.commercial_contact_permission_events
FOR EACH ROW EXECUTE FUNCTION crm_atendimento.prevent_commercial_ledger_mutation();

DROP TRIGGER IF EXISTS commercial_contact_permission_events_no_truncate
  ON crm_atendimento.commercial_contact_permission_events;
CREATE TRIGGER commercial_contact_permission_events_no_truncate
BEFORE TRUNCATE ON crm_atendimento.commercial_contact_permission_events
FOR EACH STATEMENT EXECUTE FUNCTION crm_atendimento.prevent_commercial_ledger_mutation();

DROP TRIGGER IF EXISTS commercial_action_events_immutable
  ON crm_atendimento.commercial_action_events;
CREATE TRIGGER commercial_action_events_immutable
BEFORE UPDATE OR DELETE ON crm_atendimento.commercial_action_events
FOR EACH ROW EXECUTE FUNCTION crm_atendimento.prevent_commercial_ledger_mutation();

DROP TRIGGER IF EXISTS commercial_action_events_no_truncate
  ON crm_atendimento.commercial_action_events;
CREATE TRIGGER commercial_action_events_no_truncate
BEFORE TRUNCATE ON crm_atendimento.commercial_action_events
FOR EACH STATEMENT EXECUTE FUNCTION crm_atendimento.prevent_commercial_ledger_mutation();

CREATE INDEX CONCURRENTLY IF NOT EXISTS crm_atendimento_commercial_permission_events_trace_idx
  ON crm_atendimento.commercial_contact_permission_events(trace_id, created_at DESC)
  WHERE trace_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS crm_atendimento_commercial_action_events_action_idx
  ON crm_atendimento.commercial_action_events(action_id, event_order DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS crm_atendimento_commercial_action_events_trace_idx
  ON crm_atendimento.commercial_action_events(trace_id, event_order DESC);
