import { IDENTITY_GRAPH_LOCK_KEY } from './identityReviewWorkflow.js'
import {
    assertIdentityMaterializationDatabase,
    assertIdentityMaterializationDestination,
    CLIENT_IDENTITY_MATERIALIZATION_SCHEMA_MIGRATION_ID,
} from './identityMaterializationSafety.js'
import { ATENDIMENTO_MIGRATION_TARGETS } from './migrationDestination.js'

export { CLIENT_IDENTITY_MATERIALIZATION_SCHEMA_MIGRATION_ID }

const PREREQUISITE_TABLES = [
    'crm_atendimento.attendances',
    'crm_atendimento.units',
    'crm_caixa.customers',
    'crm_caixa.sales',
    'crm_caixa.sale_items',
]

const STATEMENTS = [
    `create extension if not exists pgcrypto`,
    `create schema if not exists crm_atendimento`,
    `create table if not exists crm_atendimento.client_identity_runs (
        id uuid primary key default gen_random_uuid(), mode text not null, summary jsonb not null,
        created_at timestamptz not null default now()
    )`,
    `create table if not exists crm_atendimento.canonical_clients (
        id uuid primary key default gen_random_uuid(), canonical_name text not null, name_key text unique not null,
        attendance_count int not null default 0, created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
    )`,
    `alter table crm_atendimento.canonical_clients add column if not exists merged_into_id uuid
        references crm_atendimento.canonical_clients(id) on delete restrict`,
    `create table if not exists crm_atendimento.client_aliases (
        id uuid primary key default gen_random_uuid(), client_id uuid not null references crm_atendimento.canonical_clients(id) on delete cascade,
        alias_name text not null, alias_key text not null, usage_count int not null default 0,
        source text not null default 'attendance', created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(), unique(client_id, alias_name)
    )`,
    `create table if not exists crm_atendimento.attendance_client_links (
        attendance_id uuid primary key references crm_atendimento.attendances(id) on delete cascade,
        client_id uuid not null references crm_atendimento.canonical_clients(id) on delete restrict,
        original_name text not null, method text not null, confidence numeric(5,4) not null,
        run_id uuid references crm_atendimento.client_identity_runs(id) on delete set null,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    )`,
    `create table if not exists crm_atendimento.client_merge_suggestions (
        id uuid primary key default gen_random_uuid(),
        left_client_id uuid not null references crm_atendimento.canonical_clients(id) on delete cascade,
        right_client_id uuid not null references crm_atendimento.canonical_clients(id) on delete cascade,
        similarity numeric(5,4) not null, evidence jsonb not null default '{}'::jsonb,
        status text not null default 'pending', run_id uuid references crm_atendimento.client_identity_runs(id) on delete set null,
        reviewed_by text, reviewed_at timestamptz, created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(), unique(left_client_id, right_client_id)
    )`,
    `create table if not exists crm_atendimento.client_caixa_links (
        id uuid primary key default gen_random_uuid(), client_id uuid not null references crm_atendimento.canonical_clients(id) on delete cascade,
        caixa_customer_id uuid not null references crm_caixa.customers(id) on delete cascade,
        method text not null, confidence numeric(5,4) not null, evidence jsonb not null default '{}'::jsonb,
        status text not null, run_id uuid references crm_atendimento.client_identity_runs(id) on delete set null,
        reviewed_by text, reviewed_at timestamptz, created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(), unique(client_id, caixa_customer_id)
    )`,
    `create table if not exists crm_atendimento.app_registration_import_runs (
        id uuid primary key default gen_random_uuid(), source_file text not null, summary jsonb not null,
        created_at timestamptz not null default now()
    )`,
    `create table if not exists crm_atendimento.app_client_registrations (
        source_client_id text primary key, source_rows int not null, canonical_name text not null, name_key text not null,
        name_variants jsonb not null default '[]'::jsonb, phone_keys jsonb not null default '[]'::jsonb,
        email_keys jsonb not null default '[]'::jsonb, cpf_keys jsonb not null default '[]'::jsonb,
        unit_slugs jsonb not null default '[]'::jsonb,
        last_run_id uuid references crm_atendimento.app_registration_import_runs(id) on delete set null,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    )`,
    `create table if not exists crm_atendimento.app_registration_caixa_links (
        app_registration_id text not null references crm_atendimento.app_client_registrations(source_client_id) on delete cascade,
        caixa_customer_id uuid not null references crm_caixa.customers(id) on delete restrict,
        method text not null, confidence numeric(5,4) not null, status text not null, evidence jsonb not null default '{}'::jsonb,
        run_id uuid references crm_atendimento.app_registration_import_runs(id) on delete set null,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
        primary key(app_registration_id, caixa_customer_id)
    )`,
    `create table if not exists crm_atendimento.app_registration_attendance_links (
        app_registration_id text not null references crm_atendimento.app_client_registrations(source_client_id) on delete cascade,
        client_id uuid not null references crm_atendimento.canonical_clients(id) on delete restrict,
        method text not null, confidence numeric(5,4) not null, status text not null, evidence jsonb not null default '{}'::jsonb,
        run_id uuid references crm_atendimento.app_registration_import_runs(id) on delete set null,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
        primary key(app_registration_id, client_id)
    )`,
    `create table if not exists crm_atendimento.global_client_identities (
        id uuid primary key default gen_random_uuid(), component_key text not null unique, canonical_name text not null,
        source_types jsonb not null, last_run_id uuid references crm_atendimento.app_registration_import_runs(id) on delete set null,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    )`,
    `create table if not exists crm_atendimento.global_client_identity_members (
        identity_id uuid not null references crm_atendimento.global_client_identities(id) on delete cascade,
        source_type text not null check(source_type in ('app_registration','caixa_customer','attendance_client','lead_profile')),
        source_id text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
        primary key(source_type, source_id)
    )`,
    `alter table crm_atendimento.global_client_identity_members drop constraint if exists global_client_identity_members_source_type_check`,
    `alter table crm_atendimento.global_client_identity_members add constraint global_client_identity_members_source_type_check
        check(source_type in ('app_registration','caixa_customer','attendance_client','lead_profile'))`,
    `create table if not exists crm_atendimento.supplemental_lead_import_runs (
        id uuid primary key default gen_random_uuid(), source_sheet_id text not null, summary jsonb not null,
        created_at timestamptz not null default now()
    )`,
    `create table if not exists crm_atendimento.supplemental_lead_profiles (
        source_profile_id text primary key, source_sheet_id text not null, source_rows jsonb not null,
        canonical_name text not null, name_key text not null, name_variants jsonb not null default '[]'::jsonb,
        phone_keys jsonb not null default '[]'::jsonb, email_keys jsonb not null default '[]'::jsonb,
        unit_slugs jsonb not null default '[]'::jsonb, birthdays jsonb not null default '[]'::jsonb,
        last_run_id uuid references crm_atendimento.supplemental_lead_import_runs(id) on delete set null,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    )`,
    `create table if not exists crm_atendimento.supplemental_lead_profile_app_links (
        source_profile_id text not null references crm_atendimento.supplemental_lead_profiles(source_profile_id) on delete cascade,
        app_registration_id text not null references crm_atendimento.app_client_registrations(source_client_id) on delete restrict,
        method text not null, confidence numeric(5,4) not null, status text not null, evidence jsonb not null default '{}'::jsonb,
        run_id uuid references crm_atendimento.supplemental_lead_import_runs(id) on delete set null,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
        primary key(source_profile_id, app_registration_id)
    )`,
    `create table if not exists crm_atendimento.supplemental_lead_profile_caixa_links (
        source_profile_id text not null references crm_atendimento.supplemental_lead_profiles(source_profile_id) on delete cascade,
        caixa_customer_id uuid not null references crm_caixa.customers(id) on delete restrict,
        method text not null, confidence numeric(5,4) not null, status text not null, evidence jsonb not null default '{}'::jsonb,
        run_id uuid references crm_atendimento.supplemental_lead_import_runs(id) on delete set null,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
        primary key(source_profile_id, caixa_customer_id)
    )`,
    `create table if not exists crm_atendimento.client_spelling_merges (
        source_client_id uuid primary key references crm_atendimento.canonical_clients(id) on delete restrict,
        target_client_id uuid not null references crm_atendimento.canonical_clients(id) on delete restrict,
        caixa_customer_id uuid not null references crm_caixa.customers(id) on delete restrict,
        method text not null, confidence numeric(5,4) not null,
        run_id uuid references crm_atendimento.client_identity_runs(id) on delete set null,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    )`,
    `create index if not exists crm_atendimento_client_aliases_key_idx on crm_atendimento.client_aliases(alias_key)`,
    `create index if not exists crm_atendimento_attendance_client_links_client_idx on crm_atendimento.attendance_client_links(client_id)`,
    `create index if not exists crm_atendimento_client_merge_suggestions_status_idx on crm_atendimento.client_merge_suggestions(status, similarity desc)`,
    `create index if not exists crm_atendimento_client_caixa_links_status_idx on crm_atendimento.client_caixa_links(status, confidence desc)`,
    `create index if not exists crm_atendimento_app_registration_caixa_status_idx on crm_atendimento.app_registration_caixa_links(status, confidence desc)`,
    `create index if not exists crm_atendimento_app_registration_attendance_status_idx on crm_atendimento.app_registration_attendance_links(status, confidence desc)`,
    `create index if not exists supplemental_lead_profile_app_status_idx on crm_atendimento.supplemental_lead_profile_app_links(status, confidence desc)`,
    `create index if not exists supplemental_lead_profile_caixa_status_idx on crm_atendimento.supplemental_lead_profile_caixa_links(status, confidence desc)`,
    `create or replace view crm_atendimento.resolved_attendance_clients as
        select l.attendance_id,l.client_id as source_client_id,coalesce(c.merged_into_id,c.id) as client_id,
            l.original_name,l.method,l.confidence
        from crm_atendimento.attendance_client_links l
        join crm_atendimento.canonical_clients c on c.id=l.client_id`,
    `create or replace view crm_atendimento.resolved_client_caixa_links as
        select coalesce(c.merged_into_id,c.id) as client_id,l.client_id as source_client_id,
            l.caixa_customer_id,l.method,l.confidence,l.status,l.evidence
        from crm_atendimento.client_caixa_links l
        join crm_atendimento.canonical_clients c on c.id=l.client_id`,
]

function migrationError(code) {
    const error = new Error(code)
    error.code = code
    return error
}

async function ensureRegistry(client) {
    await client.query(`create schema if not exists crm_atendimento`)
    await client.query(`create table if not exists crm_atendimento.schema_migrations (
        id text primary key, applied_at timestamptz not null default now(), rolled_back_at timestamptz,
        details jsonb not null default '{}'::jsonb
    )`)
}

async function assertPrerequisites(client) {
    const fields = PREREQUISITE_TABLES.map((table, index) => `to_regclass('${table}') as table_${index}`).join(', ')
    const result = await client.query(`select ${fields}`)
    if (!Object.values(result.rows[0] || {}).every(Boolean)) {
        throw migrationError('CLIENT_IDENTITY_MATERIALIZATION_MIGRATION_PREREQUISITES_MISSING')
    }
}

export function clientIdentityMaterializationMigrationPlan() {
    return {
        id: CLIENT_IDENTITY_MATERIALIZATION_SCHEMA_MIGRATION_ID,
        tables: [
            'client_identity_runs', 'canonical_clients', 'client_aliases', 'attendance_client_links',
            'client_merge_suggestions', 'client_caixa_links', 'app_registration_import_runs',
            'app_client_registrations', 'app_registration_caixa_links', 'app_registration_attendance_links',
            'global_client_identities', 'global_client_identity_members', 'supplemental_lead_import_runs',
            'supplemental_lead_profiles', 'supplemental_lead_profile_app_links',
            'supplemental_lead_profile_caixa_links', 'client_spelling_merges',
        ],
        policy: 'Materializers are data-only after this migration; their target is the private local mirror and each apply requires a matching source checkpoint.',
        rollback: 'Non-destructive: preserves identity source data and marks the schema migration rolled back.',
    }
}

export async function applyClientIdentityMaterializationMigration({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL }) {
    if (!pool) throw migrationError('CLIENT_IDENTITY_MATERIALIZATION_MIGRATION_POOL_REQUIRED')
    try { assertIdentityMaterializationDestination(databaseUrl, target) } catch { throw migrationError('CLIENT_IDENTITY_MATERIALIZATION_MIGRATION_DESTINATION_UNSAFE') }
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin')
        transactionOpen = true
        await client.query(`set local lock_timeout = '3s'`)
        await client.query(`set local statement_timeout = '60s'`)
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [CLIENT_IDENTITY_MATERIALIZATION_SCHEMA_MIGRATION_ID])
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [IDENTITY_GRAPH_LOCK_KEY])
        try { await assertIdentityMaterializationDatabase(client, databaseUrl, target) } catch { throw migrationError('CLIENT_IDENTITY_MATERIALIZATION_MIGRATION_DESTINATION_UNSAFE') }
        await assertPrerequisites(client)
        await ensureRegistry(client)
        for (const sql of STATEMENTS) await client.query(sql)
        const report = { id: CLIENT_IDENTITY_MATERIALIZATION_SCHEMA_MIGRATION_ID, applied: true, statements: STATEMENTS.length }
        await client.query(`insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), null, $2::jsonb)
            on conflict(id) do update set applied_at=excluded.applied_at, rolled_back_at=null, details=excluded.details`,
        [CLIENT_IDENTITY_MATERIALIZATION_SCHEMA_MIGRATION_ID, JSON.stringify(report)])
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

export async function rollbackClientIdentityMaterializationMigration({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL }) {
    if (!pool) throw migrationError('CLIENT_IDENTITY_MATERIALIZATION_MIGRATION_POOL_REQUIRED')
    try { assertIdentityMaterializationDestination(databaseUrl, target) } catch { throw migrationError('CLIENT_IDENTITY_MATERIALIZATION_MIGRATION_DESTINATION_UNSAFE') }
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin')
        transactionOpen = true
        await client.query(`set local lock_timeout = '3s'`)
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [CLIENT_IDENTITY_MATERIALIZATION_SCHEMA_MIGRATION_ID])
        try { await assertIdentityMaterializationDatabase(client, databaseUrl, target) } catch { throw migrationError('CLIENT_IDENTITY_MATERIALIZATION_MIGRATION_DESTINATION_UNSAFE') }
        await ensureRegistry(client)
        await client.query(`insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), now(), '{"rollback":"non-destructive"}'::jsonb)
            on conflict(id) do update set rolled_back_at=now(), details=excluded.details`,
        [CLIENT_IDENTITY_MATERIALIZATION_SCHEMA_MIGRATION_ID])
        await client.query('commit')
        transactionOpen = false
        return { id: CLIENT_IDENTITY_MATERIALIZATION_SCHEMA_MIGRATION_ID, rolledBack: true, destructive: false }
    } catch (error) {
        if (transactionOpen) {
            try { await client.query('rollback') } catch { /* preserve original failure */ }
        }
        throw error
    } finally {
        client.release()
    }
}
