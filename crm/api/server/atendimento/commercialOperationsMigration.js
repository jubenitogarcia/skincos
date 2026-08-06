import { assertAtendimentoMigrationDestination, isStrictAtendimentoMigrationDestination, ATENDIMENTO_MIGRATION_TARGETS } from './migrationDestination.js'
import { COMMERCIAL_OUTCOME_CODES, COMMERCIAL_CAMPAIGN_MEMBER_STATES, COMMERCIAL_CAMPAIGN_STATES } from './commercialOperations.js'

export const COMMERCIAL_OPERATIONS_MIGRATION_ID = '20260806_commercial_operations_v1'

const RUNTIME_ROLES = Object.freeze({
    [ATENDIMENTO_MIGRATION_TARGETS.LOCAL]: 'skincos',
    [ATENDIMENTO_MIGRATION_TARGETS.STAGING]: 'skincos_staging_crm_app',
})

const PREREQUISITE_TABLES = [
    'units',
    'commercial_actions',
    'commercial_action_events',
    'global_client_identities',
    'commercial_offers',
]

const OUTCOME_SQL = COMMERCIAL_OUTCOME_CODES.map((value) => `'${value}'`).join(',')
const CAMPAIGN_STATES_SQL = COMMERCIAL_CAMPAIGN_STATES.map((value) => `'${value}'`).join(',')
const MEMBER_STATES_SQL = COMMERCIAL_CAMPAIGN_MEMBER_STATES.map((value) => `'${value}'`).join(',')

const STATEMENTS = [
    `create extension if not exists pgcrypto`,
    `alter table crm_atendimento.commercial_actions add column if not exists revision integer not null default 1`,
    `alter table crm_atendimento.commercial_actions add column if not exists outcome_code text`,
    `alter table crm_atendimento.commercial_actions add column if not exists outcome_recorded_at timestamptz`,
    `alter table crm_atendimento.commercial_actions add column if not exists idempotency_key text`,
    `do $$ begin
        if not exists (select 1 from pg_constraint where conname = 'commercial_actions_outcome_code_valid' and conrelid = 'crm_atendimento.commercial_actions'::regclass) then
            alter table crm_atendimento.commercial_actions add constraint commercial_actions_outcome_code_valid check (outcome_code is null or outcome_code in (${OUTCOME_SQL})) not valid;
        end if;
    end $$`,
    `alter table crm_atendimento.commercial_action_events add column if not exists outcome_code text`,
    `do $$ begin
        if not exists (select 1 from pg_constraint where conname = 'commercial_action_events_outcome_code_valid' and conrelid = 'crm_atendimento.commercial_action_events'::regclass) then
            alter table crm_atendimento.commercial_action_events add constraint commercial_action_events_outcome_code_valid check (outcome_code is null or outcome_code in (${OUTCOME_SQL})) not valid;
        end if;
    end $$`,
    `create table if not exists crm_atendimento.commercial_operation_mutations (
        id uuid primary key default gen_random_uuid(),
        mutation_key text not null unique,
        operation text not null check(operation in ('action_create','action_update','action_reassign','campaign_create','campaign_update','absence_upsert','rebalance')),
        actor_id text not null,
        request_fingerprint text not null,
        response jsonb not null,
        created_at timestamptz not null default now()
    )`,
    `create table if not exists crm_atendimento.commercial_campaigns (
        id uuid primary key default gen_random_uuid(),
        name text not null,
        revision integer not null default 1,
        segment_key text not null,
        segment_version text not null,
        filters_snapshot jsonb not null default '{}'::jsonb,
        cutoff_at timestamptz not null,
        unit_id uuid not null references crm_atendimento.units(id) on delete restrict,
        owner text not null,
        offer_id uuid references crm_atendimento.commercial_offers(id) on delete set null,
        assignment_window_start timestamptz not null,
        assignment_window_end timestamptz not null,
        control_group_percent integer not null default 0 check(control_group_percent between 0 and 100),
        state text not null default 'draft' check(state in (${CAMPAIGN_STATES_SQL})),
        author text not null,
        reason text not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        check(assignment_window_end >= assignment_window_start)
    )`,
    `create table if not exists crm_atendimento.commercial_campaign_members (
        id uuid primary key default gen_random_uuid(),
        campaign_id uuid not null references crm_atendimento.commercial_campaigns(id) on delete restrict,
        identity_id uuid not null references crm_atendimento.global_client_identities(id) on delete restrict,
        unit_id uuid not null references crm_atendimento.units(id) on delete restrict,
        segment_key text not null,
        segment_version text not null,
        cutoff_at timestamptz not null,
        owner text not null,
        offer_id uuid references crm_atendimento.commercial_offers(id) on delete set null,
        control_group boolean not null default false,
        state text not null check(state in (${MEMBER_STATES_SQL})),
        eligibility_snapshot jsonb not null default '{}'::jsonb,
        action_id uuid references crm_atendimento.commercial_actions(id) on delete set null,
        revision integer not null default 1,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique(campaign_id, identity_id)
    )`,
    `create table if not exists crm_atendimento.commercial_campaign_events (
        id uuid primary key default gen_random_uuid(),
        event_order bigint generated always as identity,
        campaign_id uuid not null references crm_atendimento.commercial_campaigns(id) on delete restrict,
        member_id uuid references crm_atendimento.commercial_campaign_members(id) on delete restrict,
        event_type text not null check(event_type in ('created','state_changed','member_added','member_assigned','member_outcome','rebalanced','cancelled')),
        actor_id text not null,
        trace_id uuid not null,
        payload jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
    )`,
    `create table if not exists crm_atendimento.commercial_owner_absences (
        id uuid primary key default gen_random_uuid(),
        owner text not null,
        unit_id uuid not null references crm_atendimento.units(id) on delete restrict,
        absence_type text not null check(absence_type in ('vacation','absence','leave')),
        starts_at date not null,
        ends_at date not null,
        substitute_owner text,
        reason text not null,
        revision integer not null default 1,
        created_by text not null,
        updated_by text not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        check(ends_at >= starts_at),
        unique(owner, unit_id, starts_at, ends_at)
    )`,
    `create or replace function crm_atendimento.prevent_commercial_operations_mutation()
        returns trigger language plpgsql as $$ begin raise exception 'commercial operations evidence is append-only'; end $$`,
    `drop trigger if exists commercial_operation_mutations_immutable on crm_atendimento.commercial_operation_mutations`,
    `create trigger commercial_operation_mutations_immutable before update or delete on crm_atendimento.commercial_operation_mutations for each row execute function crm_atendimento.prevent_commercial_operations_mutation()`,
    `drop trigger if exists commercial_operation_mutations_no_truncate on crm_atendimento.commercial_operation_mutations`,
    `create trigger commercial_operation_mutations_no_truncate before truncate on crm_atendimento.commercial_operation_mutations for each statement execute function crm_atendimento.prevent_commercial_operations_mutation()`,
    `drop trigger if exists commercial_campaign_events_immutable on crm_atendimento.commercial_campaign_events`,
    `create trigger commercial_campaign_events_immutable before update or delete on crm_atendimento.commercial_campaign_events for each row execute function crm_atendimento.prevent_commercial_operations_mutation()`,
    `drop trigger if exists commercial_campaign_events_no_truncate on crm_atendimento.commercial_campaign_events`,
    `create trigger commercial_campaign_events_no_truncate before truncate on crm_atendimento.commercial_campaign_events for each statement execute function crm_atendimento.prevent_commercial_operations_mutation()`,
]

const INDEXES = [
    { name: 'crm_atendimento_commercial_actions_idempotency_idx', sql: `create unique index concurrently if not exists crm_atendimento_commercial_actions_idempotency_idx on crm_atendimento.commercial_actions(created_by, idempotency_key) where idempotency_key is not null` },
    { name: 'crm_atendimento_commercial_actions_owner_due_idx', sql: `create index concurrently if not exists crm_atendimento_commercial_actions_owner_due_idx on crm_atendimento.commercial_actions(owner, due_date, status)` },
    { name: 'crm_atendimento_commercial_campaigns_state_idx', sql: `create index concurrently if not exists crm_atendimento_commercial_campaigns_state_idx on crm_atendimento.commercial_campaigns(unit_id, state, updated_at desc)` },
    { name: 'crm_atendimento_commercial_campaign_members_identity_idx', sql: `create index concurrently if not exists crm_atendimento_commercial_campaign_members_identity_idx on crm_atendimento.commercial_campaign_members(identity_id, state)` },
    { name: 'crm_atendimento_commercial_campaign_events_campaign_idx', sql: `create index concurrently if not exists crm_atendimento_commercial_campaign_events_campaign_idx on crm_atendimento.commercial_campaign_events(campaign_id, event_order desc)` },
    { name: 'crm_atendimento_commercial_owner_absences_current_idx', sql: `create index concurrently if not exists crm_atendimento_commercial_owner_absences_current_idx on crm_atendimento.commercial_owner_absences(unit_id, owner, starts_at, ends_at)` },
]

function migrationError(code) {
    const error = new Error(code)
    error.code = code
    return error
}

async function query(client, sql, params = []) { return client.query(sql, params) }

async function assertDestination(client, databaseUrl, target) {
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('COMMERCIAL_OPERATIONS_MIGRATION_DESTINATION_UNSAFE')
    try { await assertAtendimentoMigrationDestination(client, databaseUrl, target) } catch { throw migrationError('COMMERCIAL_OPERATIONS_MIGRATION_DESTINATION_UNSAFE') }
}

async function assertPrerequisites(client) {
    const fields = PREREQUISITE_TABLES.map((table) => `to_regclass('crm_atendimento.${table}') as ${table}`).join(',')
    const result = await query(client, `select ${fields}`)
    if (!Object.values(result.rows[0] || {}).every(Boolean)) throw migrationError('COMMERCIAL_OPERATIONS_MIGRATION_PREREQUISITES_MISSING')
}

export function commercialOperationsMigrationPlan() {
    return {
        id: COMMERCIAL_OPERATIONS_MIGRATION_ID,
        adds: ['commercial_actions.revision', 'commercial_actions.outcome_code', 'commercial_actions.idempotency_key', 'commercial_operation_mutations', 'commercial_campaigns', 'commercial_campaign_members', 'commercial_campaign_events', 'commercial_owner_absences'],
        appendOnlyTables: ['commercial_operation_mutations', 'commercial_campaign_events'],
        runtimeAccess: 'The CRM application role receives scoped SELECT/INSERT/UPDATE on operational rows and INSERT/SELECT on append-only registries; campaign evidence cannot be changed or truncated.',
        outcomeCodes: [...COMMERCIAL_OUTCOME_CODES],
        states: { campaigns: [...COMMERCIAL_CAMPAIGN_STATES], members: [...COMMERCIAL_CAMPAIGN_MEMBER_STATES] },
        rollback: 'Non-destructive: preserves actions, campaigns, outcomes and event evidence, then marks the migration rolled back. No data is deleted.',
    }
}

export async function applyCommercialOperationsMigration({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL }) {
    if (!pool || !isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('COMMERCIAL_OPERATIONS_MIGRATION_DESTINATION_UNSAFE')
    const client = await pool.connect()
    const report = { id: COMMERCIAL_OPERATIONS_MIGRATION_ID, applied: false, indexes: [], tables: ['commercial_operation_mutations', 'commercial_campaigns', 'commercial_campaign_members', 'commercial_campaign_events', 'commercial_owner_absences'] }
    try {
        await query(client, `set lock_timeout = '3s'`)
        await query(client, `set statement_timeout = '60s'`)
        await query(client, `select pg_advisory_lock(hashtext($1))`, [COMMERCIAL_OPERATIONS_MIGRATION_ID])
        await assertDestination(client, databaseUrl, target)
        await assertPrerequisites(client)
        await query(client, `create schema if not exists crm_atendimento`)
        await query(client, `create table if not exists crm_atendimento.schema_migrations (id text primary key, applied_at timestamptz not null default now(), rolled_back_at timestamptz, details jsonb not null default '{}'::jsonb)`)
        for (const statement of STATEMENTS) await query(client, statement)
        for (const index of INDEXES) { await query(client, index.sql); report.indexes.push(index.name) }
        const role = RUNTIME_ROLES[target]
        if (!role) throw migrationError('COMMERCIAL_OPERATIONS_MIGRATION_RUNTIME_ROLE_UNKNOWN')
        const grants = [
            `grant usage on schema crm_atendimento to ${role}`,
            `grant select, insert, update on table crm_atendimento.commercial_actions to ${role}`,
            `grant select, insert on table crm_atendimento.commercial_operation_mutations to ${role}`,
            `grant select, insert, update on table crm_atendimento.commercial_campaigns to ${role}`,
            `grant select, insert, update on table crm_atendimento.commercial_campaign_members to ${role}`,
            `grant select, insert on table crm_atendimento.commercial_campaign_events to ${role}`,
            `grant select, insert, update on table crm_atendimento.commercial_owner_absences to ${role}`,
            `grant usage, select on sequence crm_atendimento.commercial_campaign_events_event_order_seq to ${role}`,
        ]
        for (const grant of grants) await query(client, grant)
        report.runtimeRole = role
        report.applied = true
        await query(client, `insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details) values ($1, now(), null, $2::jsonb) on conflict(id) do update set applied_at=excluded.applied_at, rolled_back_at=null, details=excluded.details`, [COMMERCIAL_OPERATIONS_MIGRATION_ID, JSON.stringify(report)])
        return report
    } finally {
        try { await query(client, `select pg_advisory_unlock(hashtext($1))`, [COMMERCIAL_OPERATIONS_MIGRATION_ID]) } catch { /* preserve the original migration result */ }
        client.release()
    }
}

export async function rollbackCommercialOperationsMigration({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL }) {
    if (!pool || !isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('COMMERCIAL_OPERATIONS_MIGRATION_DESTINATION_UNSAFE')
    const client = await pool.connect()
    try {
        await query(client, `set lock_timeout = '3s'`)
        await query(client, `select pg_advisory_lock(hashtext($1))`, [COMMERCIAL_OPERATIONS_MIGRATION_ID])
        await assertDestination(client, databaseUrl, target)
        await query(client, `update crm_atendimento.schema_migrations set rolled_back_at = now(), details = jsonb_set(coalesce(details,'{}'::jsonb), '{rollback}', 'true'::jsonb) where id = $1`, [COMMERCIAL_OPERATIONS_MIGRATION_ID])
        return { id: COMMERCIAL_OPERATIONS_MIGRATION_ID, rolledBack: true, destructive: false }
    } finally {
        try { await query(client, `select pg_advisory_unlock(hashtext($1))`, [COMMERCIAL_OPERATIONS_MIGRATION_ID]) } catch { /* preserve the original rollback result */ }
        client.release()
    }
}

export const __testables = { STATEMENTS, INDEXES, PREREQUISITE_TABLES, RUNTIME_ROLES }
