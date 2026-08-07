import {
    assertAtendimentoMigrationDestination,
    ATENDIMENTO_MIGRATION_TARGETS,
    isStrictAtendimentoMigrationDestination,
} from './migrationDestination.js'
import {
    COMMERCIAL_CAMPAIGN_MEMBER_STATES,
    COMMERCIAL_CAMPAIGN_STATES,
    COMMERCIAL_OUTCOME_CODES,
} from './commercialOperations.js'

export const COMMERCIAL_OPERATIONS_MIGRATION_ID = '20260807_commercial_operations_v2'

const RUNTIME_ROLES = Object.freeze({
    [ATENDIMENTO_MIGRATION_TARGETS.LOCAL]: 'skincos',
    [ATENDIMENTO_MIGRATION_TARGETS.STAGING]: 'skincos_staging_crm_app',
})

const PREREQUISITE_RELATIONS = Object.freeze([
    'crm_atendimento.units',
    'crm_atendimento.global_client_identities',
    'crm_atendimento.commercial_actions',
    'crm_atendimento.commercial_action_events',
    'crm_atendimento.commercial_offers',
])

const OUTCOME_SQL = COMMERCIAL_OUTCOME_CODES.map((value) => `'${value}'`).join(', ')
const CAMPAIGN_STATE_SQL = COMMERCIAL_CAMPAIGN_STATES.map((value) => `'${value}'`).join(', ')
const MEMBER_STATE_SQL = COMMERCIAL_CAMPAIGN_MEMBER_STATES.map((value) => `'${value}'`).join(', ')

function migrationError(code) {
    const error = new Error(code)
    error.code = code
    return error
}

function createTriggerIfMissing(relation, triggerName, triggerSql) {
    return `do $$ begin
        if not exists (
            select 1 from pg_trigger
             where tgrelid = '${relation}'::regclass and tgname = '${triggerName}'
        ) then
            execute $trigger$${triggerSql}$trigger$;
        end if;
    end $$`
}

function runtimeGrantStatements(target) {
    const role = RUNTIME_ROLES[target]
    if (!role) throw migrationError('COMMERCIAL_OPERATIONS_RUNTIME_ROLE_UNKNOWN')
    return [
        `revoke create on schema crm_atendimento from ${role}`,
        `revoke delete, truncate, references, trigger on table crm_atendimento.commercial_actions from ${role}`,
        `revoke update, delete, truncate, references, trigger on table crm_atendimento.commercial_action_events from ${role}`,
        `revoke update, delete, truncate, references, trigger on table crm_atendimento.commercial_operation_mutations from ${role}`,
        `revoke delete, truncate, references, trigger on table crm_atendimento.commercial_campaigns from ${role}`,
        `revoke delete, truncate, references, trigger on table crm_atendimento.commercial_campaign_members from ${role}`,
        `revoke update, delete, truncate, references, trigger on table crm_atendimento.commercial_campaign_events from ${role}`,
        `revoke delete, truncate, references, trigger on table crm_atendimento.commercial_owner_absences from ${role}`,
        `grant usage on schema crm_atendimento to ${role}`,
        `grant select, insert, update on table crm_atendimento.commercial_actions to ${role}`,
        `grant select, insert on table crm_atendimento.commercial_action_events to ${role}`,
        `grant select, insert on table crm_atendimento.commercial_operation_mutations to ${role}`,
        `grant select, insert, update on table crm_atendimento.commercial_campaigns to ${role}`,
        `grant select, insert, update on table crm_atendimento.commercial_campaign_members to ${role}`,
        `grant select, insert on table crm_atendimento.commercial_campaign_events to ${role}`,
        `grant select, insert, update on table crm_atendimento.commercial_owner_absences to ${role}`,
        `grant usage, select on sequence crm_atendimento.commercial_campaign_events_event_order_seq to ${role}`,
    ]
}

const STATEMENTS = Object.freeze([
    `create extension if not exists pgcrypto`,
    `create schema if not exists crm_atendimento`,
    `alter table crm_atendimento.commercial_actions add column if not exists revision integer not null default 1`,
    `alter table crm_atendimento.commercial_actions add column if not exists outcome_code text`,
    `alter table crm_atendimento.commercial_actions add column if not exists outcome_recorded_at timestamptz`,
    `alter table crm_atendimento.commercial_actions add column if not exists idempotency_key text`,
    `alter table crm_atendimento.commercial_action_events add column if not exists outcome_code text`,
    `do $$ begin
        if not exists (select 1 from pg_constraint where conrelid = 'crm_atendimento.commercial_actions'::regclass and conname = 'commercial_actions_outcome_code_v2_valid') then
            alter table crm_atendimento.commercial_actions add constraint commercial_actions_outcome_code_v2_valid
                check (outcome_code is null or outcome_code in (${OUTCOME_SQL})) not valid;
        end if;
        if not exists (select 1 from pg_constraint where conrelid = 'crm_atendimento.commercial_action_events'::regclass and conname = 'commercial_action_events_outcome_code_v2_valid') then
            alter table crm_atendimento.commercial_action_events add constraint commercial_action_events_outcome_code_v2_valid
                check (outcome_code is null or outcome_code in (${OUTCOME_SQL})) not valid;
        end if;
    end $$`,
    `create table if not exists crm_atendimento.commercial_operation_mutations (
        id uuid primary key default gen_random_uuid(),
        mutation_key text not null check (mutation_key ~ '^[A-Za-z0-9._:-]{8,240}$'),
        operation text not null check (operation in ('action_create', 'action_update', 'action_reassign', 'campaign_create', 'campaign_update', 'absence_upsert', 'rebalance')),
        actor_id text not null check (char_length(actor_id) between 1 and 160 and actor_id !~ '[@]'),
        request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
        response jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        unique(mutation_key, operation)
    )`,
    `create table if not exists crm_atendimento.commercial_campaigns (
        id uuid primary key default gen_random_uuid(),
        name text not null check (char_length(btrim(name)) between 1 and 160 and name !~ '[@]'),
        revision integer not null default 1 check (revision >= 1),
        segment_key text not null check (segment_key ~ '^[A-Za-z0-9._-]{1,120}$'),
        segment_version text not null check (segment_version ~ '^[A-Za-z0-9._-]{1,120}$'),
        filters_snapshot jsonb not null default '{}'::jsonb,
        context_hash text not null check (context_hash ~ '^[a-f0-9]{64}$'),
        cutoff_at timestamptz not null,
        unit_id uuid not null references crm_atendimento.units(id) on delete restrict,
        owner text not null check (char_length(btrim(owner)) between 1 and 160 and owner !~ '[@]'),
        offer_id uuid references crm_atendimento.commercial_offers(id) on delete restrict,
        assignment_window_start timestamptz not null,
        assignment_window_end timestamptz not null,
        control_group_percent integer not null default 0 check (control_group_percent between 0 and 100),
        state text not null default 'draft' check (state in (${CAMPAIGN_STATE_SQL})),
        author text not null check (char_length(author) between 1 and 160 and author !~ '[@]'),
        reason text not null check (char_length(btrim(reason)) between 3 and 1000 and reason !~ '[@]'),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        check (assignment_window_end >= assignment_window_start)
    )`,
    `create table if not exists crm_atendimento.commercial_campaign_members (
        id uuid primary key default gen_random_uuid(),
        campaign_id uuid not null references crm_atendimento.commercial_campaigns(id) on delete restrict,
        identity_id uuid not null references crm_atendimento.global_client_identities(id) on delete restrict,
        unit_id uuid not null references crm_atendimento.units(id) on delete restrict,
        segment_key text not null check (segment_key ~ '^[A-Za-z0-9._-]{1,120}$'),
        segment_version text not null check (segment_version ~ '^[A-Za-z0-9._-]{1,120}$'),
        cutoff_at timestamptz not null,
        owner text not null check (char_length(btrim(owner)) between 1 and 160 and owner !~ '[@]'),
        offer_id uuid references crm_atendimento.commercial_offers(id) on delete restrict,
        control_group boolean not null default false,
        state text not null check (state in (${MEMBER_STATE_SQL})),
        eligibility_snapshot jsonb not null default '{}'::jsonb,
        action_id uuid references crm_atendimento.commercial_actions(id) on delete restrict,
        revision integer not null default 1 check (revision >= 1),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique(campaign_id, identity_id)
    )`,
    `create table if not exists crm_atendimento.commercial_campaign_events (
        id uuid primary key default gen_random_uuid(),
        event_order bigint generated always as identity,
        campaign_id uuid not null references crm_atendimento.commercial_campaigns(id) on delete restrict,
        member_id uuid references crm_atendimento.commercial_campaign_members(id) on delete restrict,
        event_type text not null check (event_type in ('created', 'state_changed', 'member_added', 'member_assigned', 'member_outcome', 'rebalanced', 'cancelled')),
        actor_id text not null check (char_length(actor_id) between 1 and 160 and actor_id !~ '[@]'),
        trace_id uuid not null,
        payload jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        unique(campaign_id, member_id, event_type, trace_id)
    )`,
    `create table if not exists crm_atendimento.commercial_owner_absences (
        id uuid primary key default gen_random_uuid(),
        owner text not null check (char_length(btrim(owner)) between 1 and 160 and owner !~ '[@]'),
        unit_id uuid not null references crm_atendimento.units(id) on delete restrict,
        absence_type text not null check (absence_type in ('vacation', 'absence', 'leave')),
        starts_at date not null,
        ends_at date not null,
        substitute_owner text check (substitute_owner is null or (char_length(btrim(substitute_owner)) between 1 and 160 and substitute_owner !~ '[@]')),
        reason text not null check (char_length(btrim(reason)) between 3 and 1000 and reason !~ '[@]'),
        revision integer not null default 1 check (revision >= 1),
        created_by text not null check (char_length(created_by) between 1 and 160 and created_by !~ '[@]'),
        updated_by text not null check (char_length(updated_by) between 1 and 160 and updated_by !~ '[@]'),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        check (ends_at >= starts_at),
        unique(owner, unit_id, starts_at, ends_at)
    )`,
    `create unique index if not exists commercial_actions_actor_idempotency_v2_idx
        on crm_atendimento.commercial_actions(created_by, idempotency_key) where idempotency_key is not null`,
    `create index if not exists commercial_actions_owner_due_v2_idx
        on crm_atendimento.commercial_actions(owner, due_date, status)`,
    `create index if not exists commercial_campaigns_state_v2_idx
        on crm_atendimento.commercial_campaigns(unit_id, state, updated_at desc)`,
    `create index if not exists commercial_campaign_members_identity_v2_idx
        on crm_atendimento.commercial_campaign_members(identity_id, state)`,
    `create index if not exists commercial_campaign_events_campaign_v2_idx
        on crm_atendimento.commercial_campaign_events(campaign_id, event_order desc)`,
    `create index if not exists commercial_owner_absences_current_v2_idx
        on crm_atendimento.commercial_owner_absences(unit_id, owner, starts_at, ends_at)`,
    `create or replace function crm_atendimento.prevent_commercial_operations_evidence_mutation_v2()
        returns trigger language plpgsql as $$ begin
            raise exception 'commercial operations evidence is append-only';
        end $$`,
    createTriggerIfMissing('crm_atendimento.commercial_operation_mutations', 'commercial_operation_mutations_v2_immutable', `create trigger commercial_operation_mutations_v2_immutable before update or delete on crm_atendimento.commercial_operation_mutations for each row execute function crm_atendimento.prevent_commercial_operations_evidence_mutation_v2()`),
    createTriggerIfMissing('crm_atendimento.commercial_operation_mutations', 'commercial_operation_mutations_v2_no_truncate', `create trigger commercial_operation_mutations_v2_no_truncate before truncate on crm_atendimento.commercial_operation_mutations for each statement execute function crm_atendimento.prevent_commercial_operations_evidence_mutation_v2()`),
    createTriggerIfMissing('crm_atendimento.commercial_campaign_events', 'commercial_campaign_events_v2_immutable', `create trigger commercial_campaign_events_v2_immutable before update or delete on crm_atendimento.commercial_campaign_events for each row execute function crm_atendimento.prevent_commercial_operations_evidence_mutation_v2()`),
    createTriggerIfMissing('crm_atendimento.commercial_campaign_events', 'commercial_campaign_events_v2_no_truncate', `create trigger commercial_campaign_events_v2_no_truncate before truncate on crm_atendimento.commercial_campaign_events for each statement execute function crm_atendimento.prevent_commercial_operations_evidence_mutation_v2()`),
])

function triggerReadinessStatement() {
    const tables = ['commercial_operation_mutations', 'commercial_campaign_events']
    const fields = tables.flatMap((table, index) => [
        `exists(select 1 from pg_trigger where tgrelid = to_regclass('crm_atendimento.${table}') and tgname = '${table}_v2_immutable' and tgenabled = 'O' and tgfoid = to_regprocedure('crm_atendimento.prevent_commercial_operations_evidence_mutation_v2()')) as immutable_${index}`,
        `exists(select 1 from pg_trigger where tgrelid = to_regclass('crm_atendimento.${table}') and tgname = '${table}_v2_no_truncate' and tgenabled = 'O' and tgfoid = to_regprocedure('crm_atendimento.prevent_commercial_operations_evidence_mutation_v2()')) as no_truncate_${index}`,
    ])
    return `select ${fields.join(', ')}`
}

async function ensureRegistry(client) {
    await client.query(`create schema if not exists crm_atendimento`)
    await client.query(`create table if not exists crm_atendimento.schema_migrations (
        id text primary key, applied_at timestamptz not null default now(), rolled_back_at timestamptz,
        details jsonb not null default '{}'::jsonb
    )`)
}

async function assertPrerequisites(client) {
    const projection = PREREQUISITE_RELATIONS.map((relation, index) => `to_regclass('${relation}') is not null as relation_${index}`).join(', ')
    const result = await client.query(`select ${projection}`)
    if (!Object.values(result.rows[0] || {}).every(Boolean)) throw migrationError('COMMERCIAL_OPERATIONS_PREREQUISITES_MISSING')
}

async function assertDestination(client, databaseUrl, target) {
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('COMMERCIAL_OPERATIONS_DESTINATION_UNSAFE')
    try {
        return await assertAtendimentoMigrationDestination(client, databaseUrl, target)
    } catch {
        throw migrationError('COMMERCIAL_OPERATIONS_DESTINATION_UNSAFE')
    }
}

async function assertAppendOnlyTriggers(client) {
    const result = await client.query(triggerReadinessStatement())
    if (!Object.values(result.rows[0] || {}).every(Boolean)) throw migrationError('COMMERCIAL_OPERATIONS_APPEND_ONLY_GUARD_MISSING')
}

export function commercialOperationsMigrationPlan() {
    return {
        id: COMMERCIAL_OPERATIONS_MIGRATION_ID,
        adds: [
            'commercial_actions.revision',
            'commercial_actions.outcome_code',
            'commercial_actions.idempotency_key',
            'commercial_operation_mutations',
            'commercial_campaigns',
            'commercial_campaign_members',
            'commercial_campaign_events',
            'commercial_owner_absences',
        ],
        appendOnlyTables: ['commercial_operation_mutations', 'commercial_campaign_events'],
        piiPolicy: 'Operational records accept only opaque ids, bounded allowlisted codes, aggregate eligibility snapshots and masked presentation contracts. They store no phone, email, message payload or raw customer evidence.',
        messagePolicy: 'Campaign membership and outcomes never dispatch a message. commercialContactWritesEnabled remains a separate, default-false control.',
        rollback: 'Non-destructive: campaigns, actions and append-only evidence are retained; rollback only records the migration state.',
        runtimeAccess: 'The runtime role receives no DDL, DELETE or TRUNCATE access. Evidence and idempotency ledgers are INSERT/SELECT only.',
    }
}

export async function applyCommercialOperationsMigration({
    pool,
    databaseUrl,
    target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL,
} = {}) {
    if (!pool) throw migrationError('COMMERCIAL_OPERATIONS_POOL_REQUIRED')
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('COMMERCIAL_OPERATIONS_DESTINATION_UNSAFE')
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin')
        transactionOpen = true
        await client.query(`set local lock_timeout = '3s'`)
        await client.query(`set local statement_timeout = '60s'`)
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [COMMERCIAL_OPERATIONS_MIGRATION_ID])
        const destination = await assertDestination(client, databaseUrl, target)
        await ensureRegistry(client)
        await assertPrerequisites(client)
        for (const statement of STATEMENTS) await client.query(statement)
        await assertAppendOnlyTriggers(client)
        const grants = runtimeGrantStatements(target)
        for (const statement of grants) await client.query(statement)
        const report = {
            ...commercialOperationsMigrationPlan(),
            applied: true,
            target,
            database: destination.database,
            runtimeRole: RUNTIME_ROLES[target],
            runtimeGrants: grants,
        }
        await client.query(`insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), null, $2::jsonb)
            on conflict(id) do update set applied_at = excluded.applied_at, rolled_back_at = null, details = excluded.details`, [
            COMMERCIAL_OPERATIONS_MIGRATION_ID,
            JSON.stringify(report),
        ])
        await client.query('commit')
        transactionOpen = false
        return report
    } catch (error) {
        if (transactionOpen) {
            try { await client.query('rollback') } catch { /* preserve original failure */ }
        }
        throw error
    } finally {
        client.release()
    }
}

export async function rollbackCommercialOperationsMigration({
    pool,
    databaseUrl,
    target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL,
} = {}) {
    if (!pool) throw migrationError('COMMERCIAL_OPERATIONS_POOL_REQUIRED')
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('COMMERCIAL_OPERATIONS_DESTINATION_UNSAFE')
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin')
        transactionOpen = true
        await client.query(`set local lock_timeout = '3s'`)
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [COMMERCIAL_OPERATIONS_MIGRATION_ID])
        await assertDestination(client, databaseUrl, target)
        await ensureRegistry(client)
        await client.query(`insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), now(), '{"rollback":"non-destructive","evidenceRetained":true}'::jsonb)
            on conflict(id) do update set rolled_back_at = now(), details = excluded.details`, [
            COMMERCIAL_OPERATIONS_MIGRATION_ID,
        ])
        await client.query('commit')
        transactionOpen = false
        return { id: COMMERCIAL_OPERATIONS_MIGRATION_ID, rolledBack: true, destructive: false, evidenceRetained: true }
    } catch (error) {
        if (transactionOpen) {
            try { await client.query('rollback') } catch { /* preserve original failure */ }
        }
        throw error
    } finally {
        client.release()
    }
}

export const __testables = { STATEMENTS, runtimeGrantStatements, triggerReadinessStatement, PREREQUISITE_RELATIONS }
