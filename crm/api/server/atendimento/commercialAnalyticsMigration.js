import {
    assertAtendimentoMigrationDestination,
    ATENDIMENTO_MIGRATION_TARGETS,
    isStrictAtendimentoMigrationDestination,
} from './migrationDestination.js'

export const COMMERCIAL_ANALYTICS_MIGRATION_ID = '20260807_commercial_analytics_v2'

const RUNTIME_ROLES = Object.freeze({
    [ATENDIMENTO_MIGRATION_TARGETS.LOCAL]: 'skincos',
    [ATENDIMENTO_MIGRATION_TARGETS.STAGING]: 'skincos_staging_crm_app',
})

const PREREQUISITES = Object.freeze([
    'crm_atendimento.units',
    'crm_atendimento.global_client_identities',
    'crm_atendimento.commercial_actions',
    'crm_atendimento.commercial_campaigns',
    'crm_atendimento.commercial_campaign_members',
    'crm_atendimento.commercial_data_quality_findings',
    'crm_atendimento.commercial_data_quality_finding_events',
])

function migrationError(code) { const error = new Error(code); error.code = code; return error }

function createTriggerIfMissing(relation, triggerName, triggerSql) {
    return `do $$ begin
        if not exists (select 1 from pg_trigger where tgrelid = '${relation}'::regclass and tgname = '${triggerName}') then
            execute $trigger$${triggerSql}$trigger$;
        end if;
    end $$`
}

function runtimeGrantStatements(target) {
    const role = RUNTIME_ROLES[target]
    if (!role) throw migrationError('COMMERCIAL_ANALYTICS_RUNTIME_ROLE_UNKNOWN')
    const appendOnly = [
        'commercial_attribution_windows', 'commercial_segment_versions',
        'commercial_segment_membership_snapshots', 'commercial_segment_memberships',
        'commercial_analytics_metric_snapshots', 'commercial_analytics_events', 'commercial_analytics_mutations',
        'commercial_experiment_assignments',
    ]
    const mutable = ['commercial_segment_definitions', 'commercial_experiments']
    return [
        `revoke create on schema crm_atendimento from ${role}`,
        ...appendOnly.map((table) => `revoke update, delete, truncate, references, trigger on table crm_atendimento.${table} from ${role}`),
        ...mutable.map((table) => `revoke delete, truncate, references, trigger on table crm_atendimento.${table} from ${role}`),
        `grant usage on schema crm_atendimento to ${role}`,
        ...appendOnly.map((table) => `grant select, insert on table crm_atendimento.${table} to ${role}`),
        ...mutable.map((table) => `grant select, insert, update on table crm_atendimento.${table} to ${role}`),
    ]
}

const STATEMENTS = Object.freeze([
    `create extension if not exists pgcrypto`,
    `create schema if not exists crm_atendimento`,
    `alter table crm_atendimento.commercial_campaigns add column if not exists attribution_window_version text`,
    `create table if not exists crm_atendimento.commercial_attribution_windows (
        id uuid primary key default gen_random_uuid(),
        version text not null unique check (version ~ '^[A-Za-z0-9._-]{1,120}$'),
        response_days integer not null check (response_days between 0 and 730),
        appointment_days integer not null check (appointment_days between 0 and 730),
        attendance_days integer not null check (attendance_days between 0 and 730),
        sale_days integer not null check (sale_days between 0 and 730),
        return_days integer not null check (return_days between 0 and 730),
        effective_from timestamptz not null,
        expires_at timestamptz,
        author_id text not null check (char_length(author_id) between 1 and 160 and author_id !~ '[@]'),
        reason text not null check (char_length(btrim(reason)) between 3 and 1000 and reason !~ '[@]'),
        created_at timestamptz not null default now(),
        check (expires_at is null or expires_at > effective_from)
    )`,
    `create table if not exists crm_atendimento.commercial_segment_definitions (
        id uuid primary key default gen_random_uuid(),
        segment_key text not null unique check (segment_key ~ '^[A-Za-z0-9._-]{1,120}$'),
        current_revision integer not null default 1 check (current_revision >= 1),
        current_status text not null default 'draft' check (current_status in ('draft', 'active', 'disabled')),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
    )`,
    `create table if not exists crm_atendimento.commercial_segment_versions (
        id uuid primary key default gen_random_uuid(),
        segment_id uuid not null references crm_atendimento.commercial_segment_definitions(id) on delete restrict,
        revision integer not null check (revision >= 1),
        criteria jsonb not null default '{}'::jsonb,
        thresholds jsonb not null default '{}'::jsonb,
        percentiles jsonb not null default '{}'::jsonb,
        effective_from timestamptz,
        author_id text not null check (char_length(author_id) between 1 and 160 and author_id !~ '[@]'),
        created_at timestamptz not null default now(),
        unique(segment_id, revision)
    )`,
    `create table if not exists crm_atendimento.commercial_segment_membership_snapshots (
        id uuid primary key default gen_random_uuid(),
        segment_version_id uuid not null references crm_atendimento.commercial_segment_versions(id) on delete restrict,
        unit_id uuid references crm_atendimento.units(id) on delete restrict,
        snapshot_date date not null,
        membership_hash text not null check (membership_hash ~ '^[a-f0-9]{64}$'),
        population integer not null check (population >= 0),
        distribution jsonb not null default '{}'::jsonb,
        metrics jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        unique(segment_version_id, unit_id, snapshot_date, membership_hash)
    )`,
    `create table if not exists crm_atendimento.commercial_segment_memberships (
        snapshot_id uuid not null references crm_atendimento.commercial_segment_membership_snapshots(id) on delete restrict,
        identity_id uuid not null references crm_atendimento.global_client_identities(id) on delete restrict,
        unit_id uuid references crm_atendimento.units(id) on delete restrict,
        bucket_key text check (bucket_key is null or bucket_key ~ '^[A-Za-z0-9._-]{1,120}$'),
        created_at timestamptz not null default now(),
        primary key(snapshot_id, identity_id)
    )`,
    `create table if not exists crm_atendimento.commercial_analytics_metric_snapshots (
        id uuid primary key default gen_random_uuid(),
        source_key text not null check (source_key ~ '^[A-Za-z0-9._-]{1,120}$'),
        finding_key text check (finding_key is null or finding_key ~ '^[A-Za-z0-9._-]{1,160}$'),
        unit_id uuid references crm_atendimento.units(id) on delete restrict,
        bucket_date date not null,
        metrics jsonb not null default '{}'::jsonb,
        metrics_hash text not null check (metrics_hash ~ '^[a-f0-9]{64}$'),
        created_at timestamptz not null default now(),
        unique(source_key, finding_key, unit_id, bucket_date, metrics_hash)
    )`,
    `create table if not exists crm_atendimento.commercial_analytics_events (
        id uuid primary key default gen_random_uuid(),
        event_key text not null unique check (event_key ~ '^[a-f0-9]{64}$'),
        identity_id uuid not null references crm_atendimento.global_client_identities(id) on delete restrict,
        unit_id uuid references crm_atendimento.units(id) on delete restrict,
        campaign_id uuid references crm_atendimento.commercial_campaigns(id) on delete restrict,
        offer_id uuid references crm_atendimento.commercial_offers(id) on delete restrict,
        event_type text not null check (event_type in ('eligible', 'selected', 'action_created', 'contacted', 'delivered', 'responded', 'scheduled', 'attended', 'purchased', 'returned')),
        channel text check (channel is null or channel ~ '^[A-Za-z0-9._-]{1,80}$'),
        owner_id text check (owner_id is null or (char_length(owner_id) between 1 and 160 and owner_id !~ '[@]')),
        policy_version text check (policy_version is null or policy_version ~ '^[A-Za-z0-9._-]{1,120}$'),
        occurred_at timestamptz not null,
        correlation_id uuid,
        created_at timestamptz not null default now(),
        unique(identity_id, event_type, occurred_at, correlation_id)
    )`,
    `create table if not exists crm_atendimento.commercial_analytics_mutations (
        id uuid primary key default gen_random_uuid(),
        actor_id text not null check (char_length(actor_id) between 1 and 160 and actor_id !~ '[@]'),
        operation text not null check (operation in ('attribution_window_create', 'segment_version_create', 'segment_snapshot_create', 'metric_snapshot_record', 'analytics_event_record', 'experiment_create', 'experiment_assign')),
        mutation_key text not null check (mutation_key ~ '^[a-f0-9]{64}$'),
        request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
        response jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        unique(actor_id, operation, mutation_key)
    )`,
    `create table if not exists crm_atendimento.commercial_experiments (
        id uuid primary key default gen_random_uuid(),
        experiment_key text not null unique check (experiment_key ~ '^[A-Za-z0-9._-]{1,120}$'),
        campaign_id uuid references crm_atendimento.commercial_campaigns(id) on delete restrict,
        segment_version_id uuid not null references crm_atendimento.commercial_segment_versions(id) on delete restrict,
        unit_id uuid not null references crm_atendimento.units(id) on delete restrict,
        attribution_window_id uuid not null references crm_atendimento.commercial_attribution_windows(id) on delete restrict,
        seed text not null check (seed ~ '^[A-Za-z0-9._-]{1,120}$'),
        control_group_percent integer not null check (control_group_percent between 1 and 99),
        state text not null default 'draft' check (state in ('draft', 'active', 'completed', 'cancelled')),
        starts_at timestamptz not null,
        ends_at timestamptz not null,
        revision integer not null default 1 check (revision >= 1),
        author_id text not null check (char_length(author_id) between 1 and 160 and author_id !~ '[@]'),
        reason text not null check (char_length(btrim(reason)) between 3 and 1000 and reason !~ '[@]'),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        check (ends_at > starts_at)
    )`,
    `create table if not exists crm_atendimento.commercial_experiment_assignments (
        experiment_id uuid not null references crm_atendimento.commercial_experiments(id) on delete restrict,
        identity_id uuid not null references crm_atendimento.global_client_identities(id) on delete restrict,
        unit_id uuid not null references crm_atendimento.units(id) on delete restrict,
        variant text not null check (variant in ('control', 'treatment', 'excluded')),
        eligible boolean not null,
        exclusion_reason text check (exclusion_reason is null or exclusion_reason ~ '^[A-Za-z0-9._-]{1,120}$'),
        created_at timestamptz not null default now(),
        primary key(experiment_id, identity_id)
    )`,
    `create index if not exists commercial_analytics_metrics_scope_v2_idx on crm_atendimento.commercial_analytics_metric_snapshots(unit_id, bucket_date desc)`,
    `create index if not exists commercial_analytics_events_scope_v2_idx on crm_atendimento.commercial_analytics_events(unit_id, event_type, occurred_at desc)`,
    `create index if not exists commercial_segment_snapshot_scope_v2_idx on crm_atendimento.commercial_segment_membership_snapshots(segment_version_id, unit_id, snapshot_date desc)`,
    `create index if not exists commercial_experiment_assignment_identity_v2_idx on crm_atendimento.commercial_experiment_assignments(identity_id, experiment_id)`,
    `create or replace function crm_atendimento.prevent_commercial_analytics_evidence_mutation_v2()
        returns trigger language plpgsql as $$ begin
            raise exception 'commercial analytics evidence is append-only';
        end $$`,
    ...[
        'commercial_attribution_windows', 'commercial_segment_versions',
        'commercial_segment_membership_snapshots', 'commercial_segment_memberships',
        'commercial_analytics_metric_snapshots', 'commercial_analytics_events', 'commercial_analytics_mutations',
        'commercial_experiment_assignments',
    ].flatMap((table) => [
        createTriggerIfMissing(`crm_atendimento.${table}`, `${table}_v2_immutable`, `create trigger ${table}_v2_immutable before update or delete on crm_atendimento.${table} for each row execute function crm_atendimento.prevent_commercial_analytics_evidence_mutation_v2()`),
        createTriggerIfMissing(`crm_atendimento.${table}`, `${table}_v2_no_truncate`, `create trigger ${table}_v2_no_truncate before truncate on crm_atendimento.${table} for each statement execute function crm_atendimento.prevent_commercial_analytics_evidence_mutation_v2()`),
    ]),
])

const EVIDENCE_TABLES = Object.freeze([
    'commercial_attribution_windows', 'commercial_segment_versions',
    'commercial_segment_membership_snapshots', 'commercial_segment_memberships',
    'commercial_analytics_metric_snapshots', 'commercial_analytics_events', 'commercial_analytics_mutations',
    'commercial_experiment_assignments',
])

function triggerReadinessStatement() {
    const fields = EVIDENCE_TABLES.flatMap((table, index) => [
        `exists(select 1 from pg_trigger where tgrelid = to_regclass('crm_atendimento.${table}') and tgname = '${table}_v2_immutable' and tgenabled = 'O' and tgfoid = to_regprocedure('crm_atendimento.prevent_commercial_analytics_evidence_mutation_v2()')) as immutable_${index}`,
        `exists(select 1 from pg_trigger where tgrelid = to_regclass('crm_atendimento.${table}') and tgname = '${table}_v2_no_truncate' and tgenabled = 'O' and tgfoid = to_regprocedure('crm_atendimento.prevent_commercial_analytics_evidence_mutation_v2()')) as no_truncate_${index}`,
    ])
    return `select ${fields.join(', ')}`
}

async function ensureRegistry(client) {
    await client.query(`create schema if not exists crm_atendimento`)
    await client.query(`create table if not exists crm_atendimento.schema_migrations (id text primary key, applied_at timestamptz not null default now(), rolled_back_at timestamptz, details jsonb not null default '{}'::jsonb)`)
}

async function assertPrerequisites(client) {
    const fields = PREREQUISITES.map((relation, index) => `to_regclass('${relation}') is not null as relation_${index}`).join(', ')
    const result = await client.query(`select ${fields}`)
    if (!Object.values(result.rows[0] || {}).every(Boolean)) throw migrationError('COMMERCIAL_ANALYTICS_PREREQUISITES_MISSING')
}

async function assertDestination(client, databaseUrl, target) {
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('COMMERCIAL_ANALYTICS_DESTINATION_UNSAFE')
    try { return await assertAtendimentoMigrationDestination(client, databaseUrl, target) } catch { throw migrationError('COMMERCIAL_ANALYTICS_DESTINATION_UNSAFE') }
}

export function commercialAnalyticsMigrationPlan() {
    return {
        id: COMMERCIAL_ANALYTICS_MIGRATION_ID,
        adds: ['commercial_attribution_windows', 'commercial_segment_definitions', 'commercial_segment_versions', 'commercial_segment_membership_snapshots', 'commercial_segment_memberships', 'commercial_analytics_metric_snapshots', 'commercial_analytics_events', 'commercial_analytics_mutations', 'commercial_experiments', 'commercial_experiment_assignments'],
        appendOnlyTables: EVIDENCE_TABLES,
        piiPolicy: 'Analytics stores only identity UUIDs for internal joins plus bounded aggregate metrics, hashes, dates, allowlisted codes and opaque actor identifiers. It stores no name, phone, email, message body, raw evidence or provider payload.',
        messagingPolicy: 'Analytics and experiments do not schedule, dispatch or retry messages. Control assignments only block crossover during the configured window.',
        rollback: 'Non-destructive: evidence remains retained; rollback records the migration state without deleting campaigns, members, metrics, assignments or events.',
    }
}

export async function applyCommercialAnalyticsMigration({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL } = {}) {
    if (!pool) throw migrationError('COMMERCIAL_ANALYTICS_POOL_REQUIRED')
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('COMMERCIAL_ANALYTICS_DESTINATION_UNSAFE')
    const client = await pool.connect(); let transactionOpen = false
    try {
        await client.query('begin'); transactionOpen = true
        await client.query(`set local lock_timeout = '3s'`)
        await client.query(`set local statement_timeout = '60s'`)
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [COMMERCIAL_ANALYTICS_MIGRATION_ID])
        const destination = await assertDestination(client, databaseUrl, target)
        await ensureRegistry(client); await assertPrerequisites(client)
        for (const statement of STATEMENTS) await client.query(statement)
        const triggerResult = await client.query(triggerReadinessStatement())
        if (!Object.values(triggerResult.rows[0] || {}).every(Boolean)) throw migrationError('COMMERCIAL_ANALYTICS_APPEND_ONLY_GUARD_MISSING')
        const grants = runtimeGrantStatements(target)
        for (const statement of grants) await client.query(statement)
        const report = { ...commercialAnalyticsMigrationPlan(), applied: true, target, database: destination.database, runtimeRole: RUNTIME_ROLES[target] }
        await client.query(`insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details) values ($1, now(), null, $2::jsonb) on conflict(id) do update set applied_at=excluded.applied_at, rolled_back_at=null, details=excluded.details`, [COMMERCIAL_ANALYTICS_MIGRATION_ID, JSON.stringify(report)])
        await client.query('commit'); transactionOpen = false
        return report
    } catch (error) {
        if (transactionOpen) { try { await client.query('rollback') } catch { /* preserve original */ } }
        throw error
    } finally { client.release() }
}

export async function rollbackCommercialAnalyticsMigration({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL } = {}) {
    if (!pool) throw migrationError('COMMERCIAL_ANALYTICS_POOL_REQUIRED')
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('COMMERCIAL_ANALYTICS_DESTINATION_UNSAFE')
    const client = await pool.connect(); let transactionOpen = false
    try {
        await client.query('begin'); transactionOpen = true
        await client.query(`set local lock_timeout = '3s'`)
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [COMMERCIAL_ANALYTICS_MIGRATION_ID])
        await assertDestination(client, databaseUrl, target); await ensureRegistry(client)
        await client.query(`insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details) values ($1, now(), now(), '{"rollback":"non-destructive","evidenceRetained":true}'::jsonb) on conflict(id) do update set rolled_back_at=now(), details=excluded.details`, [COMMERCIAL_ANALYTICS_MIGRATION_ID])
        await client.query('commit'); transactionOpen = false
        return { id: COMMERCIAL_ANALYTICS_MIGRATION_ID, rolledBack: true, destructive: false, evidenceRetained: true }
    } catch (error) {
        if (transactionOpen) { try { await client.query('rollback') } catch { /* preserve original */ } }
        throw error
    } finally { client.release() }
}

export const __testables = { STATEMENTS, EVIDENCE_TABLES, PREREQUISITES, runtimeGrantStatements, triggerReadinessStatement }
