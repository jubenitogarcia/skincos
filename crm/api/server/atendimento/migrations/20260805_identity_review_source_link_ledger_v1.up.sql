-- Applied only by crm/api/scripts/migrate-atendimento-identity-review.mjs.
-- This is additive to 20260805_identity_review_workflow_v1 and records the
-- effective automatic source-link topology without rewriting prior evidence.
alter table crm_atendimento.identity_materialization_runs
    add column if not exists event_order bigint generated always as identity;

create table if not exists crm_atendimento.identity_source_link_history (
    id uuid primary key default gen_random_uuid(),
    materialization_run_id uuid not null references crm_atendimento.identity_materialization_runs(id) on delete restrict,
    link_type text not null check (link_type in ('attendance_caixa','app_attendance','app_caixa','lead_app','lead_caixa')),
    source_type text not null check (source_type in ('attendance_client','caixa_customer','app_registration','lead_profile')),
    source_id text not null,
    target_type text not null check (target_type in ('attendance_client','caixa_customer','app_registration','lead_profile')),
    target_id text not null,
    transition text not null check (transition in ('automatic_activated','automatic_deactivated')),
    resulting_status text not null,
    origin text not null,
    created_at timestamptz not null default now()
);

create index if not exists identity_materialization_runs_event_order_idx
    on crm_atendimento.identity_materialization_runs(event_order);
create index if not exists identity_source_link_history_run_idx
    on crm_atendimento.identity_source_link_history(materialization_run_id, source_type, source_id);
create index if not exists identity_source_link_history_target_idx
    on crm_atendimento.identity_source_link_history(target_type, target_id);

drop trigger if exists identity_source_link_history_immutable on crm_atendimento.identity_source_link_history;
create trigger identity_source_link_history_immutable
before update or delete on crm_atendimento.identity_source_link_history
for each row execute function crm_atendimento.prevent_identity_review_ledger_mutation();
