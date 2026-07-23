BEGIN;
-- CRM/Atendimento and Clientes share this PostgreSQL schema today. The outbox
-- remains local to that schema; no other module receives database access.
CREATE TABLE IF NOT EXISTS crm_atendimento.event_outbox (
  id uuid PRIMARY KEY,
  event_type text NOT NULL,
  event_version integer NOT NULL CHECK(event_version = 1),
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  payload_json jsonb NOT NULL,
  correlation_id text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','leased','dispatched','dead-letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  available_at timestamptz NOT NULL,
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error text,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz
);
CREATE INDEX IF NOT EXISTS crm_atendimento_event_outbox_dispatch_idx ON crm_atendimento.event_outbox(status, available_at, created_at);
CREATE INDEX IF NOT EXISTS crm_atendimento_event_outbox_aggregate_idx ON crm_atendimento.event_outbox(aggregate_type, aggregate_id, occurred_at);

CREATE TABLE IF NOT EXISTS crm_atendimento.event_inbox (
  consumer_name text NOT NULL,
  event_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  projection_version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (consumer_name, event_id),
  UNIQUE (idempotency_key)
);

CREATE TABLE IF NOT EXISTS crm_atendimento.event_dead_letters (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL,
  consumer_name text NOT NULL,
  payload_json jsonb NOT NULL,
  attempts integer NOT NULL,
  failed_at timestamptz NOT NULL DEFAULT now(),
  last_error text NOT NULL,
  resolved_at timestamptz,
  resolution_note text
);
CREATE INDEX IF NOT EXISTS crm_atendimento_event_dead_letters_open_idx ON crm_atendimento.event_dead_letters(resolved_at, failed_at);

CREATE TABLE IF NOT EXISTS crm_atendimento.event_reconciliation (
  id uuid PRIMARY KEY,
  producer_module text NOT NULL,
  consumer_name text NOT NULL,
  range_start timestamptz NOT NULL,
  range_end timestamptz NOT NULL,
  source_count integer NOT NULL DEFAULT 0,
  projected_count integer NOT NULL DEFAULT 0,
  status text NOT NULL CHECK(status IN ('pending','matched','mismatch','replayed')),
  details_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
COMMIT;
