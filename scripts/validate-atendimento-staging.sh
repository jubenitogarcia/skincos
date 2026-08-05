#!/usr/bin/env bash
set -euo pipefail

sudo -n -u postgres psql --dbname=skincos_staging --set=ON_ERROR_STOP=1 --tuples-only --no-align <<'SQL'
select 'migrations=' || count(*) from crm_atendimento.schema_migrations where rolled_back_at is null;
select 'identities_table=' || (to_regclass('crm_atendimento.global_client_identities') is not null);
select 'review_table=' || (to_regclass('crm_atendimento.identity_review_decisions') is not null);
select 'action_ledger=' || (to_regclass('crm_atendimento.commercial_action_events') is not null);
select 'quality_queue=' || (to_regclass('crm_atendimento.commercial_data_quality_findings') is not null);
select 'contact_writes_enabled=' || commercial_contact_writes_enabled || ':canary_count=' || coalesce(cardinality(commercial_contact_canary_identity_ids), 0)
  from crm_atendimento.commercial_policy_config where singleton = true;
select 'quality_findings=' || count(*) from crm_atendimento.commercial_data_quality_findings;
select 'append_only_triggers=' || count(*)
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='crm_atendimento' and t.tgname in (
   'commercial_contact_permission_events_immutable',
   'commercial_contact_permission_events_no_truncate',
   'commercial_action_events_immutable',
   'commercial_action_events_no_truncate',
   'commercial_data_quality_finding_events_immutable',
   'commercial_data_quality_finding_events_no_truncate',
   'identity_review_decisions_immutable',
   'identity_review_decisions_no_truncate',
   'identity_member_history_immutable',
   'identity_member_history_no_truncate',
   'identity_lineage_immutable',
   'identity_lineage_no_truncate',
   'identity_source_link_history_immutable',
   'identity_source_link_history_no_truncate'
 );
SQL
