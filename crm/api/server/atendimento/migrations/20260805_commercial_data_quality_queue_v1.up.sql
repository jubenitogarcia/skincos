-- Execute through migrate-atendimento-commercial-data-quality.mjs --apply.
-- This additive queue persists only aggregate quality metrics; it intentionally
-- excludes client names, phones, emails, raw source evidence and source paths.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS crm_atendimento.commercial_data_quality_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_key text NOT NULL UNIQUE CHECK (finding_key ~ '^[a-z][a-z0-9_.-]{2,120}$'),
  severity text NOT NULL CHECK (severity IN ('critical','high','medium','low')),
  status text NOT NULL CHECK (status IN ('open','acknowledged','in_progress','resolved','suppressed')),
  owner text,
  observed_count integer NOT NULL DEFAULT 0 CHECK (observed_count >= 0),
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  sla_due_at timestamptz,
  first_detected_at timestamptz,
  last_observed_at timestamptz,
  last_evaluated_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_by text NOT NULL,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_atendimento.commercial_data_quality_finding_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_order bigint GENERATED ALWAYS AS IDENTITY,
  finding_id uuid NOT NULL REFERENCES crm_atendimento.commercial_data_quality_findings(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('detected','observed','cleared','reopened','assignment_changed','status_changed')),
  previous_status text CHECK (previous_status IN ('open','acknowledged','in_progress','resolved','suppressed')),
  status text NOT NULL CHECK (status IN ('open','acknowledged','in_progress','resolved','suppressed')),
  previous_owner text,
  owner text,
  observed_count integer NOT NULL CHECK (observed_count >= 0),
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION crm_atendimento.prevent_commercial_data_quality_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'commercial data quality event evidence is append-only';
END $$;

DROP TRIGGER IF EXISTS commercial_data_quality_finding_events_immutable
  ON crm_atendimento.commercial_data_quality_finding_events;
CREATE TRIGGER commercial_data_quality_finding_events_immutable
BEFORE UPDATE OR DELETE ON crm_atendimento.commercial_data_quality_finding_events
FOR EACH ROW EXECUTE FUNCTION crm_atendimento.prevent_commercial_data_quality_event_mutation();

DROP TRIGGER IF EXISTS commercial_data_quality_finding_events_no_truncate
  ON crm_atendimento.commercial_data_quality_finding_events;
CREATE TRIGGER commercial_data_quality_finding_events_no_truncate
BEFORE TRUNCATE ON crm_atendimento.commercial_data_quality_finding_events
FOR EACH STATEMENT EXECUTE FUNCTION crm_atendimento.prevent_commercial_data_quality_event_mutation();

CREATE INDEX CONCURRENTLY IF NOT EXISTS crm_atendimento_commercial_data_quality_findings_queue_idx
  ON crm_atendimento.commercial_data_quality_findings(status, severity, sla_due_at, updated_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS crm_atendimento_commercial_data_quality_events_finding_idx
  ON crm_atendimento.commercial_data_quality_finding_events(finding_id, event_order DESC);
