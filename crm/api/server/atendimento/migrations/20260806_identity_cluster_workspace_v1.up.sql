-- Applied by crm/api/scripts/migrate-atendimento-identity-clusters.mjs.
-- Additive and fail-closed: raw contact values never enter these ledgers.
create table if not exists crm_atendimento.identity_review_cluster_operations (
    id uuid primary key default gen_random_uuid(),
    operation_key text not null unique,
    cluster_key text not null,
    operation text not null check (operation in ('bulk_confirm','reveal')),
    request_fingerprint text not null,
    status text not null check (status in ('previewed','applied','rejected','blocked')),
    actor jsonb not null default '{}'::jsonb,
    result jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create table if not exists crm_atendimento.identity_review_cluster_reveals (
    id uuid primary key default gen_random_uuid(),
    cluster_key text not null,
    cluster_version text not null,
    fields jsonb not null default '[]'::jsonb,
    reason_digest text not null,
    actor jsonb not null default '{}'::jsonb,
    unit_scope jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists identity_review_cluster_operations_cluster_idx
    on crm_atendimento.identity_review_cluster_operations(cluster_key, created_at desc);
create index if not exists identity_review_cluster_reveals_cluster_idx
    on crm_atendimento.identity_review_cluster_reveals(cluster_key, created_at desc);

create or replace function crm_atendimento.prevent_identity_cluster_ledger_mutation()
returns trigger language plpgsql as $$
begin
    raise exception 'identity cluster evidence is append-only';
end $$;

drop trigger if exists identity_review_cluster_operations_immutable on crm_atendimento.identity_review_cluster_operations;
create trigger identity_review_cluster_operations_immutable
before update or delete or truncate on crm_atendimento.identity_review_cluster_operations
for each statement execute function crm_atendimento.prevent_identity_cluster_ledger_mutation();

drop trigger if exists identity_review_cluster_reveals_immutable on crm_atendimento.identity_review_cluster_reveals;
create trigger identity_review_cluster_reveals_immutable
before update or delete or truncate on crm_atendimento.identity_review_cluster_reveals
for each statement execute function crm_atendimento.prevent_identity_cluster_ledger_mutation();
