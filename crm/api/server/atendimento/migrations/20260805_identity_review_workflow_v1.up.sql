-- Applied only by crm/api/scripts/migrate-atendimento-identity-review.mjs.
-- The runner verifies the strict local socket destination and records the
-- migration in crm_atendimento.schema_migrations before the API enables writes.
create table if not exists crm_atendimento.identity_materialization_runs (
    id uuid primary key default gen_random_uuid(),
    mode text not null check (mode in ('confirm','reject','reverse')),
    status text not null check (status in ('applied','not_applicable','blocked')),
    input_fingerprint text not null,
    previous_fingerprint text,
    summary jsonb not null default '{}'::jsonb,
    actor jsonb not null,
    created_at timestamptz not null default now()
);

create table if not exists crm_atendimento.identity_review_decisions (
    id uuid primary key default gen_random_uuid(),
    event_order bigint generated always as identity,
    materialization_run_id uuid references crm_atendimento.identity_materialization_runs(id) on delete restrict,
    review_type text not null,
    source_id text not null,
    target_id text not null,
    decision text not null,
    source_status text not null,
    resulting_status text not null,
    source_version text not null,
    reason text not null,
    actor jsonb not null,
    source_snapshot jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

alter table crm_atendimento.identity_review_decisions
    add column if not exists event_order bigint generated always as identity;

create table if not exists crm_atendimento.identity_member_history (
    id uuid primary key default gen_random_uuid(),
    event_order bigint generated always as identity,
    materialization_run_id uuid not null references crm_atendimento.identity_materialization_runs(id) on delete restrict,
    source_type text not null,
    source_id text not null,
    previous_identity_id uuid references crm_atendimento.global_client_identities(id) on delete restrict,
    next_identity_id uuid references crm_atendimento.global_client_identities(id) on delete restrict,
    change_kind text not null,
    created_at timestamptz not null default now()
);

alter table crm_atendimento.identity_member_history
    add column if not exists event_order bigint generated always as identity;

create table if not exists crm_atendimento.identity_lineage (
    id uuid primary key default gen_random_uuid(),
    materialization_run_id uuid not null references crm_atendimento.identity_materialization_runs(id) on delete restrict,
    predecessor_identity_id uuid not null references crm_atendimento.global_client_identities(id) on delete restrict,
    successor_identity_id uuid not null references crm_atendimento.global_client_identities(id) on delete restrict,
    relation text not null,
    created_at timestamptz not null default now()
);

create or replace function crm_atendimento.prevent_identity_review_ledger_mutation()
returns trigger language plpgsql as $$
begin
    raise exception 'identity review evidence is append-only';
end $$;

create trigger identity_review_decisions_immutable
before update or delete on crm_atendimento.identity_review_decisions
for each row execute function crm_atendimento.prevent_identity_review_ledger_mutation();

create trigger identity_member_history_immutable
before update or delete on crm_atendimento.identity_member_history
for each row execute function crm_atendimento.prevent_identity_review_ledger_mutation();

create trigger identity_lineage_immutable
before update or delete on crm_atendimento.identity_lineage
for each row execute function crm_atendimento.prevent_identity_review_ledger_mutation();

create index if not exists identity_review_decisions_event_order_idx
    on crm_atendimento.identity_review_decisions(review_type, source_id, target_id, event_order desc);
