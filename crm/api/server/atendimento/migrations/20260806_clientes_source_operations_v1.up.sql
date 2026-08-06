-- Additive source operations ledger for the Clientes continuous worker.
-- The worker stores only allowlisted aggregate metadata here. It never stores
-- source rows, names, phones, e-mails, tokens or raw provider responses.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS crm_atendimento;

CREATE TABLE IF NOT EXISTS crm_atendimento.clientes_source_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL CHECK (source_id ~ '^[a-z][a-z0-9_.-]{2,120}$'),
  status text NOT NULL CHECK (status IN ('running','complete','partial','incomplete','invalid','failed','dead','skipped')),
  scheduled_at timestamptz NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  idempotency_key text NOT NULL UNIQUE,
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  retries integer NOT NULL DEFAULT 0 CHECK (retries >= 0),
  watermark text,
  fingerprint text,
  snapshot_complete boolean NOT NULL DEFAULT false,
  records_read bigint NOT NULL DEFAULT 0 CHECK (records_read >= 0),
  records_applied bigint NOT NULL DEFAULT 0 CHECK (records_applied >= 0),
  records_skipped bigint NOT NULL DEFAULT 0 CHECK (records_skipped >= 0),
  divergences bigint NOT NULL DEFAULT 0 CHECK (divergences >= 0),
  coverage jsonb NOT NULL DEFAULT '{}'::jsonb,
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_read_at timestamptz,
  last_applied_at timestamptz,
  duration_ms bigint NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{1,80}$'),
  error_message text,
  error_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  backup_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clientes_source_runs_source_started_idx
  ON crm_atendimento.clientes_source_runs(source_id, started_at DESC);
CREATE INDEX IF NOT EXISTS clientes_source_runs_status_idx
  ON crm_atendimento.clientes_source_runs(status, completed_at DESC);

ALTER TABLE crm_atendimento.clientes_source_runs
  ADD COLUMN IF NOT EXISTS error_details jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS crm_atendimento.clientes_source_checkpoints (
  source_id text PRIMARY KEY CHECK (source_id ~ '^[a-z][a-z0-9_.-]{2,120}$'),
  status text NOT NULL CHECK (status IN ('running','complete','partial','incomplete','invalid','failed','dead','skipped')),
  watermark text,
  fingerprint text,
  snapshot_complete boolean NOT NULL DEFAULT false,
  records_read bigint NOT NULL DEFAULT 0 CHECK (records_read >= 0),
  records_applied bigint NOT NULL DEFAULT 0 CHECK (records_applied >= 0),
  records_skipped bigint NOT NULL DEFAULT 0 CHECK (records_skipped >= 0),
  divergences bigint NOT NULL DEFAULT 0 CHECK (divergences >= 0),
  coverage jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_read_at timestamptz,
  last_applied_at timestamptz,
  last_duration_ms bigint NOT NULL DEFAULT 0 CHECK (last_duration_ms >= 0),
  last_error_code text CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{1,80}$'),
  last_error_at timestamptz,
  last_error_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  retries integer NOT NULL DEFAULT 0 CHECK (retries >= 0),
  next_run_at timestamptz,
  backup_ref text,
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clientes_source_checkpoints_next_run_idx
  ON crm_atendimento.clientes_source_checkpoints(next_run_at, status);

ALTER TABLE crm_atendimento.clientes_source_checkpoints
  ADD COLUMN IF NOT EXISTS last_error_details jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS crm_atendimento.clientes_source_dead_letters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL CHECK (source_id ~ '^[a-z][a-z0-9_.-]{2,120}$'),
  run_id uuid NOT NULL REFERENCES crm_atendimento.clientes_source_runs(id) ON DELETE RESTRICT,
  error_code text NOT NULL CHECK (error_code ~ '^[A-Z][A-Z0-9_]{1,80}$'),
  attempts integer NOT NULL CHECK (attempts >= 1),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS clientes_source_dead_letters_open_idx
  ON crm_atendimento.clientes_source_dead_letters(source_id, resolved_at, created_at DESC);

CREATE OR REPLACE FUNCTION crm_atendimento.prevent_clientes_source_dead_letter_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'clientes source dead-letter evidence is append-only';
END $$;

DROP TRIGGER IF EXISTS clientes_source_dead_letters_immutable
  ON crm_atendimento.clientes_source_dead_letters;
CREATE TRIGGER clientes_source_dead_letters_immutable
BEFORE UPDATE OR DELETE ON crm_atendimento.clientes_source_dead_letters
FOR EACH ROW EXECUTE FUNCTION crm_atendimento.prevent_clientes_source_dead_letter_mutation();

DROP TRIGGER IF EXISTS clientes_source_dead_letters_no_truncate
  ON crm_atendimento.clientes_source_dead_letters;
CREATE TRIGGER clientes_source_dead_letters_no_truncate
BEFORE TRUNCATE ON crm_atendimento.clientes_source_dead_letters
FOR EACH STATEMENT EXECUTE FUNCTION crm_atendimento.prevent_clientes_source_dead_letter_mutation();
