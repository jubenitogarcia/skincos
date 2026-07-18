-- Execute with crm/api/scripts/migrate-atendimento-write-safety.mjs --apply.
-- The runner limits the destination to local skincos_crm_local, batches legacy
-- backfills, validates constraints, and runs every index below CONCURRENTLY.

CREATE SCHEMA IF NOT EXISTS crm_atendimento;
CREATE TABLE IF NOT EXISTS crm_atendimento.schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now(),
  rolled_back_at timestamptz,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE crm_atendimento.attendances ADD COLUMN IF NOT EXISTS value_formula_version text;
ALTER TABLE crm_atendimento.attendances ADD COLUMN IF NOT EXISTS revision integer;
ALTER TABLE crm_atendimento.attendances ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE crm_atendimento.attendances ADD COLUMN IF NOT EXISTS created_by text;
ALTER TABLE crm_atendimento.attendances ADD COLUMN IF NOT EXISTS updated_by text;
ALTER TABLE crm_atendimento.attendances ADD COLUMN IF NOT EXISTS created_at timestamptz;
ALTER TABLE crm_atendimento.attendances ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE crm_atendimento.attendances ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE crm_atendimento.attendances ALTER COLUMN revision SET DEFAULT 1;
ALTER TABLE crm_atendimento.attendances ALTER COLUMN value_formula_version SET DEFAULT 'attendance-value/v1';

ALTER TABLE crm_atendimento.audit_events ADD COLUMN IF NOT EXISTS actor jsonb;
ALTER TABLE crm_atendimento.audit_events ADD COLUMN IF NOT EXISTS attendance_id uuid;
ALTER TABLE crm_atendimento.audit_events ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE crm_atendimento.audit_events ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- Historic rows are tagged attendance-value/legacy-imported-v0 by the runner;
-- their stored financial value is never recalculated.
-- Legacy idempotency_key values remain NULL and are excluded from the partial key.

ALTER TABLE crm_atendimento.attendances
  ADD CONSTRAINT crm_atendimento_attendances_revision_valid
  CHECK (revision >= 1) NOT VALID;
ALTER TABLE crm_atendimento.attendances
  ADD CONSTRAINT crm_atendimento_attendances_value_formula_version_valid
  CHECK (value_formula_version IS NOT NULL AND btrim(value_formula_version) <> '') NOT VALID;
ALTER TABLE crm_atendimento.attendances
  VALIDATE CONSTRAINT crm_atendimento_attendances_revision_valid;
ALTER TABLE crm_atendimento.attendances
  VALIDATE CONSTRAINT crm_atendimento_attendances_value_formula_version_valid;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS crm_atendimento_attendances_idempotency_idx
  ON crm_atendimento.attendances(created_by, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND created_by IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS crm_atendimento_attendances_unit_period_created_idx
  ON crm_atendimento.attendances(unit_id, service_date DESC, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS crm_atendimento_attendances_unit_injector_period_idx
  ON crm_atendimento.attendances(unit_id, injector_id, service_date DESC)
  WHERE deleted_at IS NULL AND injector_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS crm_atendimento_attendances_unit_consultant_period_idx
  ON crm_atendimento.attendances(unit_id, consultant_id, service_date DESC)
  WHERE deleted_at IS NULL AND consultant_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS crm_atendimento_attendances_active_period_idx
  ON crm_atendimento.attendances(service_date DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS crm_atendimento_audit_events_attendance_created_idx
  ON crm_atendimento.audit_events(attendance_id, created_at DESC)
  WHERE attendance_id IS NOT NULL;
