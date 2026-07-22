-- Execute through migrate-atendimento-professional-identity.mjs --rollback.
-- Non-destructive: aliases, canonical links and source-name history are retained
-- so rollback cannot make historic identity ambiguous again.
DROP INDEX CONCURRENTLY IF EXISTS crm_atendimento.crm_atendimento_schedule_professional_period_idx;
DROP INDEX CONCURRENTLY IF EXISTS crm_atendimento.crm_atendimento_professional_aliases_key_idx;
DROP INDEX CONCURRENTLY IF EXISTS crm_atendimento.crm_atendimento_professionals_canonical_idx;
ALTER TABLE crm_atendimento.professionals DROP CONSTRAINT IF EXISTS crm_atendimento_professionals_canonical_fk;
