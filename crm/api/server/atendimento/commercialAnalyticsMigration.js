import { assertAtendimentoMigrationDestination, isStrictAtendimentoMigrationDestination, ATENDIMENTO_MIGRATION_TARGETS } from './migrationDestination.js'

export const COMMERCIAL_ANALYTICS_MIGRATION_ID = '20260806_commercial_analytics_v1'
export const COMMERCIAL_ANALYTICS_MIGRATION_ACTIONS = Object.freeze(['--apply', '--rollback'])

const RUNTIME_ROLES = Object.freeze({
    [ATENDIMENTO_MIGRATION_TARGETS.LOCAL]: 'skincos',
    [ATENDIMENTO_MIGRATION_TARGETS.STAGING]: 'skincos_staging_crm_app',
})

const PREREQUISITE_RELATIONS = [
    'crm_atendimento.units',
    'crm_atendimento.global_client_identities',
    'crm_atendimento.commercial_actions',
    'crm_atendimento.commercial_data_quality_findings',
    'crm_atendimento.commercial_data_quality_finding_events',
]

const STATEMENTS = [
    `create extension if not exists pgcrypto`,
    `create table if not exists crm_atendimento.commercial_attribution_window_versions (
        version text primary key check (version ~ '^[a-zA-Z0-9_.-]{1,64}$'),
        response_days integer not null check (response_days between 0 and 730),
        appointment_days integer not null check (appointment_days between 0 and 730),
        attendance_days integer not null check (attendance_days between 0 and 730),
        sale_days integer not null check (sale_days between 0 and 730),
        return_days integer not null check (return_days between 0 and 1095),
        effective_from timestamptz not null,
        effective_to timestamptz,
        created_by text not null,
        reason text not null,
        created_at timestamptz not null default now(),
        check (effective_to is null or effective_to > effective_from)
    )`,
    `create table if not exists crm_atendimento.commercial_segment_definitions (
        id uuid primary key default gen_random_uuid(),
        segment_key text not null unique check (segment_key ~ '^[a-z][a-z0-9_.-]{2,100}$'),
        name text not null,
        description text not null default '',
        criteria jsonb not null default '{}'::jsonb,
        created_by text not null,
        updated_by text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
    )`,
    `create table if not exists crm_atendimento.commercial_segment_versions (
        id uuid primary key default gen_random_uuid(),
        definition_id uuid not null references crm_atendimento.commercial_segment_definitions(id) on delete restrict,
        version integer not null check (version > 0),
        criteria jsonb not null default '{}'::jsonb,
        thresholds jsonb not null default '{}'::jsonb,
        percentiles jsonb not null default '{}'::jsonb,
        effective_from timestamptz not null,
        effective_to timestamptz,
        author text not null,
        population integer not null default 0 check (population >= 0),
        distribution jsonb not null default '{}'::jsonb,
        post_metrics jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        unique(definition_id, version),
        check (effective_to is null or effective_to > effective_from)
    )`,
    `create table if not exists crm_atendimento.commercial_segment_membership_snapshots (
        id uuid primary key default gen_random_uuid(),
        segment_version_id uuid not null references crm_atendimento.commercial_segment_versions(id) on delete restrict,
        unit_id uuid references crm_atendimento.units(id) on delete restrict,
        snapshot_date date not null,
        population integer not null default 0 check (population >= 0),
        included integer not null default 0 check (included >= 0),
        distribution jsonb not null default '{}'::jsonb,
        drift jsonb not null default '{}'::jsonb,
        created_by text not null,
        created_at timestamptz not null default now(),
        unique(segment_version_id, unit_id, snapshot_date)
    )`,
    `create table if not exists crm_atendimento.commercial_segment_members (
        snapshot_id uuid not null references crm_atendimento.commercial_segment_membership_snapshots(id) on delete restrict,
        identity_id uuid not null references crm_atendimento.global_client_identities(id) on delete restrict,
        included boolean not null default true,
        reason text not null default '',
        criteria jsonb not null default '{}'::jsonb,
        assigned_at timestamptz not null default now(),
        primary key(snapshot_id, identity_id)
    )`,
    `create table if not exists crm_atendimento.commercial_analytics_experiments (
        id uuid primary key default gen_random_uuid(),
        experiment_key text not null check (experiment_key ~ '^[a-z][a-z0-9_.-]{2,100}$'),
        version integer not null check (version > 0),
        unit_id uuid references crm_atendimento.units(id) on delete restrict,
        segment_version_id uuid references crm_atendimento.commercial_segment_versions(id) on delete restrict,
        policy_version text not null,
        attribution_window_version text not null references crm_atendimento.commercial_attribution_window_versions(version) on delete restrict,
        period_start date not null,
        period_end date not null,
        control_percent numeric(5,2) not null check (control_percent > 0 and control_percent < 100),
        seed text not null check (length(seed) between 8 and 160),
        state text not null default 'draft' check (state in ('draft','running','paused','completed','rolled_back')),
        author text not null,
        reason text not null,
        eligibility_snapshot jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        unique(experiment_key, version),
        check (period_end >= period_start)
    )`,
    `create table if not exists crm_atendimento.commercial_analytics_assignments (
        experiment_id uuid not null references crm_atendimento.commercial_analytics_experiments(id) on delete restrict,
        identity_id uuid not null references crm_atendimento.global_client_identities(id) on delete restrict,
        unit_id uuid references crm_atendimento.units(id) on delete restrict,
        variant text not null check (variant in ('control','treatment','excluded')),
        eligible boolean not null default true,
        eligibility_reason text not null default '',
        eligibility_snapshot jsonb not null default '{}'::jsonb,
        contact_blocked_until timestamptz,
        crossover_detected boolean not null default false,
        assigned_at timestamptz not null default now(),
        primary key(experiment_id, identity_id)
    )`,
    `create table if not exists crm_atendimento.commercial_analytics_events (
        id uuid primary key default gen_random_uuid(),
        idempotency_key text not null unique check (length(idempotency_key) between 8 and 180),
        experiment_id uuid references crm_atendimento.commercial_analytics_experiments(id) on delete restrict,
        identity_id uuid not null references crm_atendimento.global_client_identities(id) on delete restrict,
        unit_id uuid references crm_atendimento.units(id) on delete restrict,
        action_id uuid references crm_atendimento.commercial_actions(id) on delete restrict,
        event_type text not null check (event_type in ('eligible','selected','action_created','contacted','delivered','responded','scheduled','attended','purchased','returned')),
        occurred_at timestamptz not null,
        channel text,
        offer_key text,
        campaign_key text,
        segment_key text,
        policy_version text,
        observed boolean not null default true,
        attributed boolean not null default false,
        incremental boolean not null default false,
        revenue numeric(14,2) check (revenue is null or revenue >= 0),
        source text not null,
        payload jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
    )`,
    `create table if not exists crm_atendimento.commercial_data_quality_metric_snapshots (
        id uuid primary key default gen_random_uuid(),
        bucket_date date not null,
        unit_id uuid references crm_atendimento.units(id) on delete restrict,
        finding_key text,
        source_key text,
        metrics jsonb not null default '{}'::jsonb,
        recorded_at timestamptz not null default now(),
        recorded_by text not null,
        unique(bucket_date, unit_id, finding_key, source_key)
    )`,
    `create index if not exists commercial_analytics_events_lookup_idx
        on crm_atendimento.commercial_analytics_events(unit_id, event_type, occurred_at desc)`,
    `create index if not exists commercial_analytics_assignments_variant_idx
        on crm_atendimento.commercial_analytics_assignments(experiment_id, variant, unit_id)`,
    `create index if not exists commercial_segment_membership_snapshots_lookup_idx
        on crm_atendimento.commercial_segment_membership_snapshots(segment_version_id, unit_id, snapshot_date desc)`,
    `create unique index if not exists commercial_segment_membership_snapshots_scope_uidx
        on crm_atendimento.commercial_segment_membership_snapshots(
            segment_version_id, coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid), snapshot_date)`,
    `create index if not exists commercial_data_quality_metric_snapshots_lookup_idx
        on crm_atendimento.commercial_data_quality_metric_snapshots(unit_id, bucket_date desc, finding_key, source_key)`,
    `create unique index if not exists commercial_data_quality_metric_snapshots_scope_uidx
        on crm_atendimento.commercial_data_quality_metric_snapshots(
            coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid), bucket_date,
            coalesce(finding_key, ''), coalesce(source_key, ''))`,
    `create or replace function crm_atendimento.prevent_commercial_analytics_append_only()
        returns trigger language plpgsql as $$
        begin
            raise exception 'commercial analytics evidence is append-only';
        end $$`,
]

const APPEND_ONLY_TABLES = [
    'commercial_segment_membership_snapshots',
    'commercial_segment_members',
    'commercial_analytics_experiments',
    'commercial_analytics_assignments',
    'commercial_analytics_events',
    'commercial_data_quality_metric_snapshots',
]

for (const table of APPEND_ONLY_TABLES) {
    STATEMENTS.push(`drop trigger if exists ${table}_immutable on crm_atendimento.${table}`)
    STATEMENTS.push(`create trigger ${table}_immutable before update or delete on crm_atendimento.${table}
        for each row execute function crm_atendimento.prevent_commercial_analytics_append_only()`)
    STATEMENTS.push(`drop trigger if exists ${table}_no_truncate on crm_atendimento.${table}`)
    STATEMENTS.push(`create trigger ${table}_no_truncate before truncate on crm_atendimento.${table}
        for each statement execute function crm_atendimento.prevent_commercial_analytics_append_only()`)
}

function migrationError(code) {
    const error = new Error(code)
    error.code = code
    return error
}

function runtimeGrantStatements(target) {
    const role = RUNTIME_ROLES[target]
    if (!role) throw migrationError('COMMERCIAL_ANALYTICS_RUNTIME_ROLE_UNKNOWN')
    return [
        `grant usage on schema crm_atendimento to ${role}`,
        `grant select on table crm_atendimento.commercial_attribution_window_versions to ${role}`,
        `grant select, insert on table crm_atendimento.commercial_segment_definitions to ${role}`,
        `grant select, insert on table crm_atendimento.commercial_segment_versions to ${role}`,
        `grant select, insert on table crm_atendimento.commercial_segment_membership_snapshots to ${role}`,
        `grant select, insert on table crm_atendimento.commercial_segment_members to ${role}`,
        `grant select, insert on table crm_atendimento.commercial_analytics_experiments to ${role}`,
        `grant select, insert on table crm_atendimento.commercial_analytics_assignments to ${role}`,
        `grant select, insert on table crm_atendimento.commercial_analytics_events to ${role}`,
        `grant select, insert on table crm_atendimento.commercial_data_quality_metric_snapshots to ${role}`,
    ]
}

export function parseCommercialAnalyticsMigrationAction(args = []) {
    const values = Array.isArray(args) ? args.map(String) : []
    if (values.length !== 1 || !COMMERCIAL_ANALYTICS_MIGRATION_ACTIONS.includes(values[0])) {
        throw migrationError('COMMERCIAL_ANALYTICS_MIGRATION_ACTION_INVALID')
    }
    return values[0] === '--apply' ? 'apply' : 'rollback'
}

async function assertPrerequisites(client) {
    const columns = PREREQUISITE_RELATIONS.map((relation, index) => `to_regclass('${relation}') as relation_${index}`).join(', ')
    const result = await client.query(`select ${columns}`)
    if (!Object.values(result.rows[0] || {}).every(Boolean)) throw migrationError('COMMERCIAL_ANALYTICS_MIGRATION_PREREQUISITES_MISSING')
}

async function ensureRegistry(client) {
    await client.query(`create schema if not exists crm_atendimento`)
    await client.query(`create table if not exists crm_atendimento.schema_migrations (
        id text primary key, applied_at timestamptz not null default now(), rolled_back_at timestamptz,
        details jsonb not null default '{}'::jsonb
    )`)
}

export function commercialAnalyticsMigrationPlan() {
    return {
        id: COMMERCIAL_ANALYTICS_MIGRATION_ID,
        tables: [
            'commercial_attribution_window_versions', 'commercial_segment_definitions', 'commercial_segment_versions',
            'commercial_segment_membership_snapshots', 'commercial_segment_members', 'commercial_analytics_experiments',
            'commercial_analytics_assignments', 'commercial_analytics_events', 'commercial_data_quality_metric_snapshots',
        ],
        defaults: { version: 'v1', responseDays: 7, appointmentDays: 14, attendanceDays: 60, saleDays: 60, returnDays: 180 },
        runtimeAccess: 'Aggregate analytics reads plus append-only inserts. No runtime UPDATE, DELETE or TRUNCATE grants are issued for evidence tables.',
        privacy: 'No PII columns. Payloads are allowlisted by the API and scrubbed before insert.',
        rollback: 'Non-destructive: preserves analytics evidence and marks the migration rolled back.',
    }
}

export async function applyCommercialAnalyticsMigration({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL }) {
    if (!pool) throw migrationError('COMMERCIAL_ANALYTICS_MIGRATION_POOL_REQUIRED')
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('COMMERCIAL_ANALYTICS_MIGRATION_DESTINATION_UNSAFE')
    const client = await pool.connect()
    try {
        await client.query(`set lock_timeout = '3s'`)
        await client.query(`set statement_timeout = '60s'`)
        await client.query(`select pg_advisory_lock(hashtext($1))`, [COMMERCIAL_ANALYTICS_MIGRATION_ID])
        await assertAtendimentoMigrationDestination(client, databaseUrl, target)
        await assertPrerequisites(client)
        await ensureRegistry(client)
        for (const sql of STATEMENTS) await client.query(sql)
        await client.query(`insert into crm_atendimento.commercial_attribution_window_versions(
            version, response_days, appointment_days, attendance_days, sale_days, return_days,
            effective_from, created_by, reason)
            values ('v1', 7, 14, 60, 60, 180, now(), 'migration', 'Defaults explícitos para primeira medição')
            on conflict(version) do nothing`)
        const grants = runtimeGrantStatements(target)
        for (const sql of grants) await client.query(sql)
        const report = {
            id: COMMERCIAL_ANALYTICS_MIGRATION_ID,
            applied: true,
            tables: commercialAnalyticsMigrationPlan().tables,
            appendOnlyTables: APPEND_ONLY_TABLES,
            runtimeRole: RUNTIME_ROLES[target],
            runtimeGrants: grants,
        }
        await client.query(`insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), null, $2::jsonb)
            on conflict(id) do update set applied_at=excluded.applied_at, rolled_back_at=null, details=excluded.details`,
        [COMMERCIAL_ANALYTICS_MIGRATION_ID, JSON.stringify(report)])
        return report
    } finally {
        try { await client.query(`select pg_advisory_unlock(hashtext($1))`, [COMMERCIAL_ANALYTICS_MIGRATION_ID]) } catch { /* connection cleanup releases the lock */ }
        client.release()
    }
}

export async function rollbackCommercialAnalyticsMigration({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL }) {
    if (!pool) throw migrationError('COMMERCIAL_ANALYTICS_MIGRATION_POOL_REQUIRED')
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('COMMERCIAL_ANALYTICS_MIGRATION_DESTINATION_UNSAFE')
    const client = await pool.connect()
    try {
        await client.query(`set lock_timeout = '3s'`)
        await client.query(`select pg_advisory_lock(hashtext($1))`, [COMMERCIAL_ANALYTICS_MIGRATION_ID])
        await assertAtendimentoMigrationDestination(client, databaseUrl, target)
        await ensureRegistry(client)
        await client.query(`insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), now(), '{"rollback":"non-destructive","evidenceRetained":true}'::jsonb)
            on conflict(id) do update set rolled_back_at=now(), details=excluded.details`, [COMMERCIAL_ANALYTICS_MIGRATION_ID])
        return { id: COMMERCIAL_ANALYTICS_MIGRATION_ID, rolledBack: true, destructive: false, evidenceRetained: true }
    } finally {
        try { await client.query(`select pg_advisory_unlock(hashtext($1))`, [COMMERCIAL_ANALYTICS_MIGRATION_ID]) } catch { /* preserve result */ }
        client.release()
    }
}

export const __testables = { runtimeGrantStatements, assertPrerequisites, APPEND_ONLY_TABLES }
