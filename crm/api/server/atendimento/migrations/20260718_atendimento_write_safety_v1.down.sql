-- Non-destructive rollback. Execute through migrate-atendimento-write-safety.mjs
-- with --rollback so the same local-database guard and advisory lock are used.
-- Columns and historic values are intentionally retained: dropping them would
-- destroy auditability and make a later forward migration ambiguous.

DROP INDEX CONCURRENTLY IF EXISTS crm_atendimento.crm_atendimento_audit_events_attendance_created_idx;
DROP INDEX CONCURRENTLY IF EXISTS crm_atendimento.crm_atendimento_attendances_active_period_idx;
DROP INDEX CONCURRENTLY IF EXISTS crm_atendimento.crm_atendimento_attendances_unit_consultant_period_idx;
DROP INDEX CONCURRENTLY IF EXISTS crm_atendimento.crm_atendimento_attendances_unit_injector_period_idx;
DROP INDEX CONCURRENTLY IF EXISTS crm_atendimento.crm_atendimento_attendances_unit_period_created_idx;
DROP INDEX CONCURRENTLY IF EXISTS crm_atendimento.crm_atendimento_attendances_idempotency_idx;

ALTER TABLE crm_atendimento.attendances DROP CONSTRAINT IF EXISTS crm_atendimento_attendances_value_formula_version_valid;
ALTER TABLE crm_atendimento.attendances DROP CONSTRAINT IF EXISTS crm_atendimento_attendances_revision_valid;
