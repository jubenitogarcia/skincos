import { assertAtendimentoMigrationDestination, isStrictAtendimentoMigrationDestination, ATENDIMENTO_MIGRATION_TARGETS } from './migrationDestination.js'
import { COMMERCIAL_ANALYTICS_MIGRATION_ID } from './commercialAnalytics.js'

const RUNTIME_ROLES = Object.freeze({
    [ATENDIMENTO_MIGRATION_TARGETS.LOCAL]: 'skincos',
    [ATENDIMENTO_MIGRATION_TARGETS.STAGING]: 'skincos_staging_crm_app',
})

const PREREQUISITE_RELATIONS = Object.freeze([
    'crm_atendimento.schema_migrations',
    'crm_atendimento.units',
    'crm_atendimento.global_client_identities',
    'crm_atendimento.global_client_identity_members',
    'crm_atendimento.attendance_client_links',
    'crm_atendimento.attendances',
    'crm_atendimento.commercial_actions',
    'crm_atendimento.commercial_campaigns',
    'crm_atendimento.commercial_campaign_members',
    'crm_atendimento.commercial_data_quality_findings',
    'crm_atendimento.commercial_data_quality_finding_events',
    'crm_atendimento.commercial_contact_permissions',
    'crm_atendimento.clientes_source_operation_checkpoints',
    'crm_caixa.sales',
    'crm_caixa.sale_items',
])

function migrationError(code) {
    const error = new Error(code)
    error.code = code
    return error
}

function triggerIfMissing(relation, name, statement) {
    return `do $$ begin
        if not exists (select 1 from pg_trigger where tgrelid='${relation}'::regclass and tgname='${name}') then
            ${statement};
        end if;
    end $$`
}

function runtimeGrantStatements(target) {
    const role = RUNTIME_ROLES[target]
    if (!role) throw migrationError('COMMERCIAL_ANALYTICS_RUNTIME_ROLE_UNKNOWN')
    return [
        `grant usage on schema crm_atendimento to ${role}`,
        `grant usage on schema crm_caixa to ${role}`,
        // Both the Analytics readiness endpoint and the Operations crossover
        // guard read the registry. The runtime role never receives DDL.
        `grant select on table crm_atendimento.schema_migrations to ${role}`,
        `grant select on table crm_atendimento.commercial_data_quality_findings to ${role}`,
        `grant select on table crm_atendimento.commercial_data_quality_finding_events to ${role}`,
        `grant select on table crm_atendimento.clientes_source_operation_checkpoints to ${role}`,
        `grant select on table crm_atendimento.commercial_actions to ${role}`,
        `grant select on table crm_atendimento.commercial_campaigns to ${role}`,
        `grant select on table crm_atendimento.commercial_campaign_members to ${role}`,
        `grant select on table crm_atendimento.commercial_contact_permissions to ${role}`,
        // Segment snapshots consume only aggregate activity from these exact
        // source relations.  Do not substitute a blanket schema grant: the
        // runtime receives neither identities' PII fields nor DDL.
        `grant select on table crm_atendimento.units to ${role}`,
        `grant select on table crm_atendimento.global_client_identity_members to ${role}`,
        `grant select on table crm_atendimento.attendance_client_links to ${role}`,
        `grant select on table crm_atendimento.attendances to ${role}`,
        `grant select on table crm_caixa.sales to ${role}`,
        `grant select on table crm_caixa.sale_items to ${role}`,
        `grant select on table crm_atendimento.commercial_analytics_mutations to ${role}`,
        `grant insert on table crm_atendimento.commercial_analytics_mutations to ${role}`,
        `grant select, insert, update on table crm_atendimento.commercial_segment_definitions to ${role}`,
        `grant select, insert on table crm_atendimento.commercial_segment_versions to ${role}`,
        `grant select, insert on table crm_atendimento.commercial_segment_memberships to ${role}`,
        `grant select, insert, update on table crm_atendimento.commercial_attribution_windows to ${role}`,
        `grant select, insert, update on table crm_atendimento.commercial_experiments to ${role}`,
        // This SELECT is intentionally explicit: Operations checks this table
        // under the shared crossover advisory-lock namespace before every
        // campaign/reassign/rebalance mutation.
        `grant select, insert on table crm_atendimento.commercial_experiment_assignments to ${role}`,
        `grant select, insert on table crm_atendimento.commercial_analytics_events to ${role}`,
        `grant usage, select on sequence crm_atendimento.commercial_analytics_events_event_order_seq to ${role}`,
    ]
}

const STATEMENTS = Object.freeze([
    `create extension if not exists pgcrypto`,
    `create schema if not exists crm_atendimento`,
    `create or replace function crm_atendimento.valid_commercial_segment_criteria(payload jsonb)
        returns boolean language plpgsql immutable as $$
        declare item record;
        begin
            if jsonb_typeof(payload) <> 'object' or payload = '{}'::jsonb then return false; end if;
            for item in select key, value from jsonb_each(payload) loop
                if item.key ~ '[A-Z]' or item.key !~ '^[a-z][a-z0-9_]*$' then return false; end if;
                if lower(item.key) ~ '(email|e_?mail|phone|telefone|whatsapp|name|nome|cpf|address|endereco|contact|contato|pii|alias|raw|evidence|context)' then return false; end if;
                if item.key not in (
                    'minimum_lifetime_sales','minimum_visits','minimum_recency_days','maximum_recency_days',
                    'minimum_lifetime_sales_percentile','minimum_visits_percentile','requires_permission',
                    'requires_phone_correlation','requires_fresh_sources','source_freshness_max_hours',
                    'identity_quality','procedure_ids','sales_classifications'
                ) then return false; end if;
                if item.key in ('requires_permission','requires_phone_correlation','requires_fresh_sources')
                    and jsonb_typeof(item.value) <> 'boolean' then return false; end if;
                if item.key in ('minimum_lifetime_sales','minimum_visits','minimum_recency_days','maximum_recency_days',
                    'minimum_lifetime_sales_percentile','minimum_visits_percentile','source_freshness_max_hours')
                    and jsonb_typeof(item.value) <> 'number' then return false; end if;
                if item.key = 'identity_quality'
                    and (jsonb_typeof(item.value) <> 'string' or item.value #>> '{}' not in ('confirmed_multi_source','unresolved_single_source')) then return false; end if;
                if item.key in ('procedure_ids','sales_classifications') then
                    if jsonb_typeof(item.value) <> 'array' then return false; end if;
                    if exists(select 1 from jsonb_array_elements(item.value) value where jsonb_typeof(value) <> 'string') then return false; end if;
                    if item.key = 'procedure_ids' and exists(select 1 from jsonb_array_elements_text(item.value) value where value !~* '^[a-z0-9][a-z0-9._-]{0,119}$' or value ~* '(email|phone|telefone|whatsapp|name|nome|cpf|contact|contato|pii|alias)') then return false; end if;
                    if item.key = 'sales_classifications' and exists(select 1 from jsonb_array_elements_text(item.value) value where value not in ('mapped','unmapped')) then return false; end if;
                end if;
            end loop;
            if (payload ? 'minimum_recency_days') and (payload ? 'maximum_recency_days')
                and (payload->>'minimum_recency_days')::numeric > (payload->>'maximum_recency_days')::numeric then return false; end if;
            return true;
        end $$`,
    `create table if not exists crm_atendimento.commercial_analytics_mutations (
        id uuid primary key default gen_random_uuid(),
        mutation_key text not null check (mutation_key ~ '^[A-Za-z0-9._:-]{8,240}$'),
        operation text not null check (operation in ('segment_create','segment_version','segment_snapshot','attribution_window_upsert','experiment_create','experiment_state')),
        actor_id text not null check (char_length(actor_id) between 1 and 160 and actor_id !~ '[@]'),
        request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
        response jsonb not null default '{}'::jsonb check (jsonb_typeof(response) = 'object'),
        created_at timestamptz not null default now(),
        unique(mutation_key, operation)
    )`,
    `create table if not exists crm_atendimento.commercial_segment_definitions (
        id uuid primary key default gen_random_uuid(),
        unit_id uuid not null references crm_atendimento.units(id) on delete restrict,
        segment_key text not null check (segment_key ~ '^[a-z][a-z0-9_]{2,80}$'),
        name text not null check (char_length(btrim(name)) between 1 and 120 and name !~ '[@]'),
        criteria jsonb not null check (crm_atendimento.valid_commercial_segment_criteria(criteria)),
        status text not null default 'draft' check (status in ('draft','active','disabled')),
        revision integer not null default 1 check (revision >= 1),
        created_by text not null check (char_length(created_by) between 1 and 160 and created_by !~ '[@]'),
        updated_by text not null check (char_length(updated_by) between 1 and 160 and updated_by !~ '[@]'),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique(unit_id, segment_key)
    )`,
    `create table if not exists crm_atendimento.commercial_segment_versions (
        id uuid primary key default gen_random_uuid(),
        definition_id uuid not null references crm_atendimento.commercial_segment_definitions(id) on delete restrict,
        version integer not null check (version >= 1),
        criteria jsonb not null check (crm_atendimento.valid_commercial_segment_criteria(criteria)),
        criteria_fingerprint text not null check (criteria_fingerprint ~ '^[a-f0-9]{64}$'),
        effective_from timestamptz not null,
        effective_until timestamptz,
        population_count integer not null default 0 check (population_count >= 0),
        distribution jsonb not null default '{}'::jsonb check (jsonb_typeof(distribution) = 'object'),
        snapshot_at timestamptz,
        author text not null check (char_length(author) between 1 and 160 and author !~ '[@]'),
        created_at timestamptz not null default now(),
        check (effective_until is null or effective_until > effective_from),
        unique(definition_id, version)
    )`,
    `create table if not exists crm_atendimento.commercial_segment_memberships (
        id uuid primary key default gen_random_uuid(),
        segment_version_id uuid not null references crm_atendimento.commercial_segment_versions(id) on delete restrict,
        identity_id uuid not null references crm_atendimento.global_client_identities(id) on delete restrict,
        unit_id uuid not null references crm_atendimento.units(id) on delete restrict,
        eligible boolean not null,
        criteria_fingerprint text not null check (criteria_fingerprint ~ '^[a-f0-9]{64}$'),
        snapshot_at timestamptz not null default now(),
        unique(segment_version_id, identity_id)
    )`,
    `create table if not exists crm_atendimento.commercial_attribution_windows (
        id uuid primary key default gen_random_uuid(),
        unit_id uuid not null references crm_atendimento.units(id) on delete restrict,
        window_key text not null check (window_key ~ '^[a-z][a-z0-9_]{2,80}$'),
        revision integer not null check (revision >= 1),
        state text not null default 'active' check (state in ('active','superseded','disabled')),
        starts_at timestamptz not null,
        ends_at timestamptz,
        response_days integer not null check (response_days between 1 and 60),
        scheduled_days integer not null check (scheduled_days between 1 and 120),
        attended_days integer not null check (attended_days between 1 and 180),
        purchased_days integer not null check (purchased_days between 1 and 180),
        returned_days integer not null check (returned_days between 1 and 365),
        created_by text not null check (char_length(created_by) between 1 and 160 and created_by !~ '[@]'),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        check (ends_at is null or ends_at > starts_at),
        unique(unit_id, window_key, revision)
    )`,
    `create table if not exists crm_atendimento.commercial_experiments (
        id uuid primary key default gen_random_uuid(),
        unit_id uuid not null references crm_atendimento.units(id) on delete restrict,
        name text not null check (char_length(btrim(name)) between 1 and 120 and name !~ '[@]'),
        segment_version_id uuid not null references crm_atendimento.commercial_segment_versions(id) on delete restrict,
        attribution_window_id uuid not null references crm_atendimento.commercial_attribution_windows(id) on delete restrict,
        control_group_percent integer not null check (control_group_percent between 1 and 99),
        state text not null default 'draft' check (state in ('draft','active','closed','disabled')),
        revision integer not null default 1 check (revision >= 1),
        starts_at timestamptz not null,
        ends_at timestamptz not null,
        policy_version text not null check (policy_version ~ '^[a-f0-9]{64}$'),
        author text not null check (char_length(author) between 1 and 160 and author !~ '[@]'),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        check (ends_at > starts_at)
    )`,
    `create table if not exists crm_atendimento.commercial_experiment_assignments (
        id uuid primary key default gen_random_uuid(),
        experiment_id uuid not null references crm_atendimento.commercial_experiments(id) on delete restrict,
        identity_id uuid not null references crm_atendimento.global_client_identities(id) on delete restrict,
        unit_id uuid not null references crm_atendimento.units(id) on delete restrict,
        variant text not null check (variant in ('treatment','control','excluded')),
        eligibility_fingerprint text not null check (eligibility_fingerprint ~ '^[a-f0-9]{64}$'),
        assigned_at timestamptz not null default now(),
        unique(experiment_id, identity_id)
    )`,
    `create table if not exists crm_atendimento.commercial_analytics_events (
        id uuid primary key default gen_random_uuid(),
        event_order bigint generated always as identity,
        event_type text not null check (event_type in ('segment_defined','segment_versioned','segment_snapshot','attribution_window_versioned','experiment_created','experiment_assigned','experiment_state_changed')),
        entity_type text not null check (entity_type in ('segment_definition','segment_version','attribution_window','experiment')),
        entity_id uuid not null,
        actor_id text not null check (char_length(actor_id) between 1 and 160 and actor_id !~ '[@]'),
        trace_id uuid not null,
        count_value integer check (count_value is null or count_value >= 0),
        fingerprint text check (fingerprint is null or fingerprint ~ '^[a-f0-9]{64}$'),
        created_at timestamptz not null default now()
    )`,
    `create index if not exists commercial_segment_definitions_unit_idx on crm_atendimento.commercial_segment_definitions(unit_id, updated_at desc)`,
    `create index if not exists commercial_segment_versions_definition_idx on crm_atendimento.commercial_segment_versions(definition_id, version desc)`,
    `create index if not exists commercial_segment_memberships_version_unit_idx on crm_atendimento.commercial_segment_memberships(segment_version_id, unit_id, eligible)`,
    `create index if not exists commercial_attribution_windows_unit_key_idx on crm_atendimento.commercial_attribution_windows(unit_id, window_key, revision desc)`,
    `create index if not exists commercial_experiments_unit_state_idx on crm_atendimento.commercial_experiments(unit_id, state, starts_at, ends_at)`,
    `create index if not exists commercial_experiment_assignments_identity_idx on crm_atendimento.commercial_experiment_assignments(identity_id, unit_id, variant)`,
    `create index if not exists commercial_analytics_events_entity_idx on crm_atendimento.commercial_analytics_events(entity_type, entity_id, event_order desc)`,
    `create or replace function crm_atendimento.prevent_commercial_analytics_ledger_mutation()
        returns trigger language plpgsql as $$ begin
            raise exception 'commercial analytics evidence is append-only';
        end $$`,
    triggerIfMissing('crm_atendimento.commercial_analytics_mutations', 'commercial_analytics_mutations_immutable',
        `create trigger commercial_analytics_mutations_immutable before update or delete on crm_atendimento.commercial_analytics_mutations for each row execute function crm_atendimento.prevent_commercial_analytics_ledger_mutation()`),
    triggerIfMissing('crm_atendimento.commercial_analytics_mutations', 'commercial_analytics_mutations_no_truncate',
        `create trigger commercial_analytics_mutations_no_truncate before truncate on crm_atendimento.commercial_analytics_mutations for each statement execute function crm_atendimento.prevent_commercial_analytics_ledger_mutation()`),
    triggerIfMissing('crm_atendimento.commercial_segment_memberships', 'commercial_segment_memberships_immutable',
        `create trigger commercial_segment_memberships_immutable before update or delete on crm_atendimento.commercial_segment_memberships for each row execute function crm_atendimento.prevent_commercial_analytics_ledger_mutation()`),
    triggerIfMissing('crm_atendimento.commercial_segment_memberships', 'commercial_segment_memberships_no_truncate',
        `create trigger commercial_segment_memberships_no_truncate before truncate on crm_atendimento.commercial_segment_memberships for each statement execute function crm_atendimento.prevent_commercial_analytics_ledger_mutation()`),
    triggerIfMissing('crm_atendimento.commercial_experiment_assignments', 'commercial_experiment_assignments_immutable',
        `create trigger commercial_experiment_assignments_immutable before update or delete on crm_atendimento.commercial_experiment_assignments for each row execute function crm_atendimento.prevent_commercial_analytics_ledger_mutation()`),
    triggerIfMissing('crm_atendimento.commercial_experiment_assignments', 'commercial_experiment_assignments_no_truncate',
        `create trigger commercial_experiment_assignments_no_truncate before truncate on crm_atendimento.commercial_experiment_assignments for each statement execute function crm_atendimento.prevent_commercial_analytics_ledger_mutation()`),
    triggerIfMissing('crm_atendimento.commercial_analytics_events', 'commercial_analytics_events_immutable',
        `create trigger commercial_analytics_events_immutable before update or delete on crm_atendimento.commercial_analytics_events for each row execute function crm_atendimento.prevent_commercial_analytics_ledger_mutation()`),
    triggerIfMissing('crm_atendimento.commercial_analytics_events', 'commercial_analytics_events_no_truncate',
        `create trigger commercial_analytics_events_no_truncate before truncate on crm_atendimento.commercial_analytics_events for each statement execute function crm_atendimento.prevent_commercial_analytics_ledger_mutation()`),
])

async function ensureRegistry(client) {
    await client.query(`create schema if not exists crm_atendimento`)
    await client.query(`create table if not exists crm_atendimento.schema_migrations (
        id text primary key, applied_at timestamptz not null default now(), rolled_back_at timestamptz,
        details jsonb not null default '{}'::jsonb
    )`)
}

async function assertPrerequisites(client) {
    const fields = PREREQUISITE_RELATIONS.map((relation, index) => `to_regclass('${relation}') as relation_${index}`).join(', ')
    const result = await client.query(`select ${fields}`)
    if (!Object.values(result.rows[0] || {}).every(Boolean)) throw migrationError('COMMERCIAL_ANALYTICS_MIGRATION_PREREQUISITES_MISSING')
}

export function commercialAnalyticsMigrationPlan() {
    return {
        id: COMMERCIAL_ANALYTICS_MIGRATION_ID,
        adds: [
            'commercial_analytics_mutations', 'commercial_segment_definitions', 'commercial_segment_versions',
            'commercial_segment_memberships', 'commercial_attribution_windows', 'commercial_experiments',
            'commercial_experiment_assignments', 'commercial_analytics_events',
        ],
        segmentPolicy: 'Only the explicit snake_case criteria DSL is persisted. CamelCase, unknown keys, nested objects and contact-like aliases are rejected in both API validation and PostgreSQL constraints.',
        experimentPolicy: 'Assignments are deterministic, persisted and locked with the shared commercial-experiment-crossover namespace before any read/write decision.',
        attributionDefaults: { responseDays: 7, scheduledDays: 14, attendedDays: 30, purchasedDays: 30, returnedDays: 60 },
        runtimeAccess: 'The runtime role receives SELECT on schema_migrations and analytic read sources, plus only the DML required for append-only evidence and versioned configuration. It receives no DDL.',
        safety: { commercialContactWritesEnabled: false, messagesEnabled: false, consentWritesEnabled: false },
        rollback: 'Non-destructive: analytics evidence, snapshots and assignments remain retained; only the registry row records rollback.',
    }
}

export async function applyCommercialAnalyticsMigration({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL }) {
    if (!pool) throw migrationError('COMMERCIAL_ANALYTICS_MIGRATION_POOL_REQUIRED')
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('COMMERCIAL_ANALYTICS_MIGRATION_DESTINATION_UNSAFE')
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin')
        transactionOpen = true
        await client.query(`set local lock_timeout = '3s'`)
        await client.query(`set local statement_timeout = '60s'`)
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [COMMERCIAL_ANALYTICS_MIGRATION_ID])
        await assertAtendimentoMigrationDestination(client, databaseUrl, target)
        await ensureRegistry(client)
        await assertPrerequisites(client)
        for (const statement of STATEMENTS) await client.query(statement)
        const grants = runtimeGrantStatements(target)
        for (const statement of grants) await client.query(statement)
        const report = {
            ...commercialAnalyticsMigrationPlan(),
            applied: true,
            target,
            runtimeRole: RUNTIME_ROLES[target],
            runtimeGrants: grants,
        }
        await client.query(`insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), null, $2::jsonb)
            on conflict(id) do update set applied_at=excluded.applied_at, rolled_back_at=null, details=excluded.details`,
        [COMMERCIAL_ANALYTICS_MIGRATION_ID, JSON.stringify(report)])
        await client.query('commit')
        transactionOpen = false
        return report
    } catch (error) {
        if (transactionOpen) {
            try { await client.query('rollback') } catch { /* preserve original migration error */ }
        }
        throw error
    } finally {
        client.release()
    }
}

export async function rollbackCommercialAnalyticsMigration({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL }) {
    if (!pool) throw migrationError('COMMERCIAL_ANALYTICS_MIGRATION_POOL_REQUIRED')
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('COMMERCIAL_ANALYTICS_MIGRATION_DESTINATION_UNSAFE')
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin')
        transactionOpen = true
        await client.query(`set local lock_timeout = '3s'`)
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [COMMERCIAL_ANALYTICS_MIGRATION_ID])
        await assertAtendimentoMigrationDestination(client, databaseUrl, target)
        await ensureRegistry(client)
        await client.query(`insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), now(), '{"rollback":"non-destructive","evidenceRetained":true}'::jsonb)
            on conflict(id) do update set rolled_back_at=now(), details=excluded.details`, [COMMERCIAL_ANALYTICS_MIGRATION_ID])
        await client.query('commit')
        transactionOpen = false
        return { id: COMMERCIAL_ANALYTICS_MIGRATION_ID, rolledBack: true, destructive: false, evidenceRetained: true }
    } catch (error) {
        if (transactionOpen) {
            try { await client.query('rollback') } catch { /* preserve original migration error */ }
        }
        throw error
    } finally {
        client.release()
    }
}

export const __testables = { STATEMENTS, runtimeGrantStatements, PREREQUISITE_RELATIONS }
