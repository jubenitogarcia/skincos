-- Applied only by crm/api/scripts/migrate-atendimento-identity-review.mjs.
-- This additive step closes the TRUNCATE gap left by row-level immutable
-- triggers. It does not rewrite or remove historical identity-review evidence.
drop trigger if exists identity_review_decisions_no_truncate on crm_atendimento.identity_review_decisions;
create trigger identity_review_decisions_no_truncate
before truncate on crm_atendimento.identity_review_decisions
for each statement execute function crm_atendimento.prevent_identity_review_ledger_mutation();

drop trigger if exists identity_member_history_no_truncate on crm_atendimento.identity_member_history;
create trigger identity_member_history_no_truncate
before truncate on crm_atendimento.identity_member_history
for each statement execute function crm_atendimento.prevent_identity_review_ledger_mutation();

drop trigger if exists identity_lineage_no_truncate on crm_atendimento.identity_lineage;
create trigger identity_lineage_no_truncate
before truncate on crm_atendimento.identity_lineage
for each statement execute function crm_atendimento.prevent_identity_review_ledger_mutation();

drop trigger if exists identity_source_link_history_no_truncate on crm_atendimento.identity_source_link_history;
create trigger identity_source_link_history_no_truncate
before truncate on crm_atendimento.identity_source_link_history
for each statement execute function crm_atendimento.prevent_identity_review_ledger_mutation();
