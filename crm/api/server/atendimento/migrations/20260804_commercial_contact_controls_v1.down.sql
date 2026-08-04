-- Non-destructive rollback. Execute through migrate-atendimento-commercial-contact.mjs
-- with --rollback. Permission records and immutable events must be retained.

DROP INDEX CONCURRENTLY IF EXISTS crm_atendimento.crm_atendimento_commercial_contact_permission_events_identity_idx;
DROP INDEX CONCURRENTLY IF EXISTS crm_atendimento.crm_atendimento_commercial_contact_permissions_status_idx;
