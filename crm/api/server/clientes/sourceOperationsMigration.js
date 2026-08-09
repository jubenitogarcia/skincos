import {
    assertAtendimentoMigrationDestination,
    ATENDIMENTO_MIGRATION_TARGETS,
    isStrictAtendimentoMigrationDestination,
} from '../atendimento/migrationDestination.js'

export const CLIENTES_SOURCE_OPERATIONS_MIGRATION_ID = '20260807_clientes_source_operations_v2'

const RUNTIME_ROLES = Object.freeze({
    [ATENDIMENTO_MIGRATION_TARGETS.LOCAL]: 'skincos',
    [ATENDIMENTO_MIGRATION_TARGETS.STAGING]: 'skincos_staging_crm_app',
    [ATENDIMENTO_MIGRATION_TARGETS.PRODUCTION]: 'skincos_clientes_ro',
})

const PREREQUISITE_RELATIONS = Object.freeze([
    'crm_atendimento.commercial_data_quality_findings',
    'crm_atendimento.commercial_data_quality_finding_events',
])

const SOURCE_ID_CHECK = "^[a-z][a-z0-9_.-]{2,120}$"
const EXECUTION_KEY_CHECK = "^[A-Za-z0-9._:-]{1,240}$"
const HASH_CHECK = "^sha256:[a-f0-9]{64}$"
const WATERMARK_CHECK = "^(sha256:[a-f0-9]{64}|[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.+Z-]{8,32})$"
const BACKUP_REFERENCE_CHECK = "^[A-Za-z0-9._:-]{1,240}$"
const ERROR_CODE_CHECK = "^[A-Z][A-Z0-9_]{1,80}$"

function migrationError(code) {
    const error = new Error(code)
    error.code = code
    return error
}

function runtimeGrantStatements(target) {
    const role = RUNTIME_ROLES[target]
    if (!role) throw migrationError('CLIENTES_SOURCE_OPERATIONS_RUNTIME_ROLE_UNKNOWN')
    return [
        `revoke create on schema crm_atendimento from ${role}`,
        `revoke delete, truncate, references, trigger on table crm_atendimento.clientes_source_operation_runs from ${role}`,
        `revoke delete, truncate, references, trigger on table crm_atendimento.clientes_source_operation_checkpoints from ${role}`,
        `revoke update, delete, truncate, references, trigger on table crm_atendimento.clientes_source_operation_backups from ${role}`,
        `revoke update, delete, truncate, references, trigger on table crm_atendimento.clientes_source_operation_events from ${role}`,
        `revoke update, delete, truncate, references, trigger on table crm_atendimento.clientes_source_operation_dead_letters from ${role}`,
        `revoke update, delete, truncate, references, trigger on table crm_atendimento.clientes_source_operation_rollbacks from ${role}`,
        `grant usage on schema crm_atendimento to ${role}`,
        // The operational readiness probe records and verifies the applied
        // migration. Without this read grant, a least-privilege runtime role
        // would fail closed forever after an otherwise valid migration.
        `grant select on table crm_atendimento.schema_migrations to ${role}`,
        `grant select, insert, update on table crm_atendimento.clientes_source_operation_runs to ${role}`,
        `grant select, insert, update on table crm_atendimento.clientes_source_operation_checkpoints to ${role}`,
        `grant select, insert on table crm_atendimento.clientes_source_operation_backups to ${role}`,
        `grant select, insert on table crm_atendimento.clientes_source_operation_events to ${role}`,
        `grant usage, select on sequence crm_atendimento.clientes_source_operation_events_event_order_seq to ${role}`,
        `grant select, insert on table crm_atendimento.clientes_source_operation_dead_letters to ${role}`,
        `grant select, insert on table crm_atendimento.clientes_source_operation_rollbacks to ${role}`,
    ]
}

const STATEMENTS = Object.freeze([
    `create extension if not exists pgcrypto`,
    `create schema if not exists crm_atendimento`,
    `create table if not exists crm_atendimento.clientes_source_operation_runs (
        id uuid primary key default gen_random_uuid(),
        source_id text not null check (source_id ~ '${SOURCE_ID_CHECK}'),
        execution_key text not null check (execution_key ~ '${EXECUTION_KEY_CHECK}'),
        mode text not null check (mode in ('dry-run', 'apply')),
        status text not null check (status in ('reading', 'applying', 'complete', 'partial', 'incomplete', 'invalid', 'unavailable', 'dead', 'skipped')),
        attempt_count integer not null default 1 check (attempt_count >= 1),
        started_at timestamptz not null default now(),
        read_at timestamptz,
        applying_at timestamptz,
        completed_at timestamptz,
        watermark text check (watermark is null or watermark ~ '${WATERMARK_CHECK}'),
        fingerprint text check (fingerprint is null or fingerprint ~ '${HASH_CHECK}'),
        snapshot_complete boolean not null default false,
        proof_kind text check (proof_kind is null or proof_kind in ('aggregate_count', 'partition_count', 'postgres_relation', 'sheet_snapshot')),
        proof_expected_records bigint check (proof_expected_records is null or proof_expected_records >= 0),
        proof_observed_records bigint check (proof_observed_records is null or proof_observed_records >= 0),
        proof_expected_partitions bigint check (proof_expected_partitions is null or proof_expected_partitions >= 0),
        proof_observed_partitions bigint check (proof_observed_partitions is null or proof_observed_partitions >= 0),
        proof_scope_hash text check (proof_scope_hash is null or proof_scope_hash ~ '${HASH_CHECK}'),
        records_read bigint not null default 0 check (records_read >= 0),
        records_applied bigint not null default 0 check (records_applied >= 0),
        records_skipped bigint not null default 0 check (records_skipped >= 0),
        divergences bigint not null default 0 check (divergences >= 0),
        coverage_records_present bigint check (coverage_records_present is null or coverage_records_present >= 0),
        coverage_records_expected bigint check (coverage_records_expected is null or coverage_records_expected >= 0),
        coverage_partitions_present bigint check (coverage_partitions_present is null or coverage_partitions_present >= 0),
        coverage_partitions_expected bigint check (coverage_partitions_expected is null or coverage_partitions_expected >= 0),
        coverage_divergences bigint check (coverage_divergences is null or coverage_divergences >= 0),
        coverage_source_kind text check (coverage_source_kind is null or coverage_source_kind ~ '^[A-Za-z0-9_.-]{1,80}$'),
        coverage_schema_version text check (coverage_schema_version is null or coverage_schema_version ~ '^[A-Za-z0-9_.-]{1,80}$'),
        checkpoint_next_watermark text check (checkpoint_next_watermark is null or checkpoint_next_watermark ~ '${WATERMARK_CHECK}'),
        checkpoint_cursor_hash text check (checkpoint_cursor_hash is null or checkpoint_cursor_hash ~ '${HASH_CHECK}'),
        backup_id uuid,
        error_code text check (error_code is null or error_code ~ '${ERROR_CODE_CHECK}'),
        error_retryable boolean,
        duration_ms bigint not null default 0 check (duration_ms >= 0),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique(source_id, execution_key, mode)
    )`,
    `create table if not exists crm_atendimento.clientes_source_operation_checkpoints (
        source_id text primary key check (source_id ~ '${SOURCE_ID_CHECK}'),
        validated_watermark text check (validated_watermark is null or validated_watermark ~ '${WATERMARK_CHECK}'),
        validated_fingerprint text check (validated_fingerprint is null or validated_fingerprint ~ '${HASH_CHECK}'),
        validated_snapshot_complete boolean not null default false,
        validated_at timestamptz,
        validated_proof_kind text check (validated_proof_kind is null or validated_proof_kind in ('aggregate_count', 'partition_count', 'postgres_relation', 'sheet_snapshot')),
        validated_proof_expected_records bigint check (validated_proof_expected_records is null or validated_proof_expected_records >= 0),
        validated_proof_observed_records bigint check (validated_proof_observed_records is null or validated_proof_observed_records >= 0),
        validated_proof_expected_partitions bigint check (validated_proof_expected_partitions is null or validated_proof_expected_partitions >= 0),
        validated_proof_observed_partitions bigint check (validated_proof_observed_partitions is null or validated_proof_observed_partitions >= 0),
        validated_proof_scope_hash text check (validated_proof_scope_hash is null or validated_proof_scope_hash ~ '${HASH_CHECK}'),
        validated_records_read bigint not null default 0 check (validated_records_read >= 0),
        validated_divergences bigint not null default 0 check (validated_divergences >= 0),
        resume_watermark text check (resume_watermark is null or resume_watermark ~ '${WATERMARK_CHECK}'),
        resume_cursor_hash text check (resume_cursor_hash is null or resume_cursor_hash ~ '${HASH_CHECK}'),
        resume_updated_at timestamptz,
        applied_watermark text check (applied_watermark is null or applied_watermark ~ '${WATERMARK_CHECK}'),
        applied_fingerprint text check (applied_fingerprint is null or applied_fingerprint ~ '${HASH_CHECK}'),
        applied_snapshot_complete boolean not null default false,
        applied_at timestamptz,
        applied_records bigint not null default 0 check (applied_records >= 0),
        last_run_id uuid references crm_atendimento.clientes_source_operation_runs(id) on delete restrict,
        last_status text not null default 'missing' check (last_status in ('missing', 'reading', 'applying', 'complete', 'partial', 'incomplete', 'invalid', 'unavailable', 'dead', 'skipped')),
        last_attempt_at timestamptz,
        last_read_at timestamptz,
        last_duration_ms bigint not null default 0 check (last_duration_ms >= 0),
        last_records_read bigint not null default 0 check (last_records_read >= 0),
        last_records_applied bigint not null default 0 check (last_records_applied >= 0),
        last_records_skipped bigint not null default 0 check (last_records_skipped >= 0),
        last_divergences bigint not null default 0 check (last_divergences >= 0),
        last_error_code text check (last_error_code is null or last_error_code ~ '${ERROR_CODE_CHECK}'),
        last_error_retryable boolean,
        last_error_at timestamptz,
        consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
        retry_count integer not null default 0 check (retry_count >= 0),
        next_run_at timestamptz,
        reconciliation_required boolean not null default false,
        rollback_at timestamptz,
        updated_at timestamptz not null default now()
    )`,
    `create table if not exists crm_atendimento.clientes_source_operation_backups (
        id uuid primary key default gen_random_uuid(),
        source_id text not null check (source_id ~ '${SOURCE_ID_CHECK}'),
        run_id uuid not null unique references crm_atendimento.clientes_source_operation_runs(id) on delete restrict,
        backup_reference text not null unique check (backup_reference ~ '${BACKUP_REFERENCE_CHECK}'),
        manifest_hash text not null check (manifest_hash ~ '${HASH_CHECK}'),
        encrypted boolean not null check (encrypted),
        restorable boolean not null check (restorable),
        created_at timestamptz not null default now()
    )`,
    `do $$
        begin
            if not exists (select 1 from pg_constraint where conrelid = 'crm_atendimento.clientes_source_operation_runs'::regclass and conname = 'clientes_source_operation_runs_backup_fk') then
                alter table crm_atendimento.clientes_source_operation_runs add constraint clientes_source_operation_runs_backup_fk foreign key (backup_id) references crm_atendimento.clientes_source_operation_backups(id) on delete restrict;
            end if;
        end $$`,
    `create table if not exists crm_atendimento.clientes_source_operation_events (
        id uuid primary key default gen_random_uuid(),
        event_order bigint generated always as identity,
        run_id uuid not null references crm_atendimento.clientes_source_operation_runs(id) on delete restrict,
        source_id text not null check (source_id ~ '${SOURCE_ID_CHECK}'),
        execution_key text not null check (execution_key ~ '${EXECUTION_KEY_CHECK}'),
        event_type text not null check (event_type in ('started', 'read_recorded', 'applying', 'completed', 'skipped', 'failed', 'dead_lettered', 'rollback_recorded')),
        status text check (status is null or status in ('reading', 'applying', 'complete', 'partial', 'incomplete', 'invalid', 'unavailable', 'dead', 'skipped')),
        attempt_count integer not null check (attempt_count >= 1),
        error_code text check (error_code is null or error_code ~ '${ERROR_CODE_CHECK}'),
        created_at timestamptz not null default now(),
        unique(run_id, event_type, attempt_count)
    )`,
    `create table if not exists crm_atendimento.clientes_source_operation_dead_letters (
        id uuid primary key default gen_random_uuid(),
        source_id text not null check (source_id ~ '${SOURCE_ID_CHECK}'),
        run_id uuid not null unique references crm_atendimento.clientes_source_operation_runs(id) on delete restrict,
        error_code text not null check (error_code ~ '${ERROR_CODE_CHECK}'),
        attempt_count integer not null check (attempt_count >= 1),
        created_at timestamptz not null default now()
    )`,
    `create table if not exists crm_atendimento.clientes_source_operation_rollbacks (
        id uuid primary key default gen_random_uuid(),
        source_id text not null check (source_id ~ '${SOURCE_ID_CHECK}'),
        backup_id uuid not null references crm_atendimento.clientes_source_operation_backups(id) on delete restrict,
        execution_key text not null check (execution_key ~ '${EXECUTION_KEY_CHECK}'),
        created_at timestamptz not null default now(),
        unique(source_id, execution_key)
    )`,
    `create index if not exists clientes_source_operation_runs_source_started_idx
        on crm_atendimento.clientes_source_operation_runs(source_id, started_at desc)`,
    `create index if not exists clientes_source_operation_runs_recovery_idx
        on crm_atendimento.clientes_source_operation_runs(source_id, status, updated_at desc)
        where status in ('reading', 'applying', 'partial')`,
    `create index if not exists clientes_source_operation_checkpoints_next_run_idx
        on crm_atendimento.clientes_source_operation_checkpoints(next_run_at, source_id)`,
    `create index if not exists clientes_source_operation_events_run_idx
        on crm_atendimento.clientes_source_operation_events(run_id, event_order desc)`,
    `create index if not exists clientes_source_operation_backups_source_idx
        on crm_atendimento.clientes_source_operation_backups(source_id, created_at desc)`,
    `create index if not exists clientes_source_operation_dead_letters_open_idx
        on crm_atendimento.clientes_source_operation_dead_letters(source_id, created_at desc)`,
    `create or replace function crm_atendimento.prevent_clientes_source_operation_evidence_mutation()
        returns trigger language plpgsql as $$
        begin
            raise exception 'clientes source operation evidence is append-only';
        end $$`,
    `do $$
        begin
            if not exists (select 1 from pg_trigger where tgrelid = 'crm_atendimento.clientes_source_operation_events'::regclass and tgname = 'clientes_source_operation_events_immutable') then
                execute 'create trigger clientes_source_operation_events_immutable before update or delete on crm_atendimento.clientes_source_operation_events for each row execute function crm_atendimento.prevent_clientes_source_operation_evidence_mutation()';
            end if;
            if not exists (select 1 from pg_trigger where tgrelid = 'crm_atendimento.clientes_source_operation_events'::regclass and tgname = 'clientes_source_operation_events_no_truncate') then
                execute 'create trigger clientes_source_operation_events_no_truncate before truncate on crm_atendimento.clientes_source_operation_events for each statement execute function crm_atendimento.prevent_clientes_source_operation_evidence_mutation()';
            end if;
            if not exists (select 1 from pg_trigger where tgrelid = 'crm_atendimento.clientes_source_operation_backups'::regclass and tgname = 'clientes_source_operation_backups_immutable') then
                execute 'create trigger clientes_source_operation_backups_immutable before update or delete on crm_atendimento.clientes_source_operation_backups for each row execute function crm_atendimento.prevent_clientes_source_operation_evidence_mutation()';
            end if;
            if not exists (select 1 from pg_trigger where tgrelid = 'crm_atendimento.clientes_source_operation_backups'::regclass and tgname = 'clientes_source_operation_backups_no_truncate') then
                execute 'create trigger clientes_source_operation_backups_no_truncate before truncate on crm_atendimento.clientes_source_operation_backups for each statement execute function crm_atendimento.prevent_clientes_source_operation_evidence_mutation()';
            end if;
            if not exists (select 1 from pg_trigger where tgrelid = 'crm_atendimento.clientes_source_operation_dead_letters'::regclass and tgname = 'clientes_source_operation_dead_letters_immutable') then
                execute 'create trigger clientes_source_operation_dead_letters_immutable before update or delete on crm_atendimento.clientes_source_operation_dead_letters for each row execute function crm_atendimento.prevent_clientes_source_operation_evidence_mutation()';
            end if;
            if not exists (select 1 from pg_trigger where tgrelid = 'crm_atendimento.clientes_source_operation_dead_letters'::regclass and tgname = 'clientes_source_operation_dead_letters_no_truncate') then
                execute 'create trigger clientes_source_operation_dead_letters_no_truncate before truncate on crm_atendimento.clientes_source_operation_dead_letters for each statement execute function crm_atendimento.prevent_clientes_source_operation_evidence_mutation()';
            end if;
            if not exists (select 1 from pg_trigger where tgrelid = 'crm_atendimento.clientes_source_operation_rollbacks'::regclass and tgname = 'clientes_source_operation_rollbacks_immutable') then
                execute 'create trigger clientes_source_operation_rollbacks_immutable before update or delete on crm_atendimento.clientes_source_operation_rollbacks for each row execute function crm_atendimento.prevent_clientes_source_operation_evidence_mutation()';
            end if;
            if not exists (select 1 from pg_trigger where tgrelid = 'crm_atendimento.clientes_source_operation_rollbacks'::regclass and tgname = 'clientes_source_operation_rollbacks_no_truncate') then
                execute 'create trigger clientes_source_operation_rollbacks_no_truncate before truncate on crm_atendimento.clientes_source_operation_rollbacks for each statement execute function crm_atendimento.prevent_clientes_source_operation_evidence_mutation()';
            end if;
        end $$`,
])

function triggerReadinessStatement() {
    const tables = [
        'clientes_source_operation_events',
        'clientes_source_operation_backups',
        'clientes_source_operation_dead_letters',
        'clientes_source_operation_rollbacks',
    ]
    const fields = tables.flatMap((table, index) => [
        `exists(select 1 from pg_trigger where tgrelid = to_regclass('crm_atendimento.${table}') and tgname = '${table}_immutable' and tgenabled = 'O' and tgfoid = to_regprocedure('crm_atendimento.prevent_clientes_source_operation_evidence_mutation()')) as immutable_${index}`,
        `exists(select 1 from pg_trigger where tgrelid = to_regclass('crm_atendimento.${table}') and tgname = '${table}_no_truncate' and tgenabled = 'O' and tgfoid = to_regprocedure('crm_atendimento.prevent_clientes_source_operation_evidence_mutation()')) as no_truncate_${index}`,
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
    const relations = PREREQUISITE_RELATIONS
        .map((relation, index) => `to_regclass('${relation}') is not null as relation_${index}`)
        .join(', ')
    const result = await client.query(`select ${relations}`)
    if (!Object.values(result.rows[0] || {}).every(Boolean)) {
        throw migrationError('CLIENTES_SOURCE_OPERATIONS_PREREQUISITES_MISSING')
    }
}

async function assertAppendOnlyTriggers(client) {
    const result = await client.query(triggerReadinessStatement())
    if (!Object.values(result.rows[0] || {}).every(Boolean)) {
        throw migrationError('CLIENTES_SOURCE_OPERATIONS_APPEND_ONLY_GUARD_MISSING')
    }
}

async function assertDestination(client, databaseUrl, target) {
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) {
        throw migrationError('CLIENTES_SOURCE_OPERATIONS_DESTINATION_UNSAFE')
    }
    try {
        return await assertAtendimentoMigrationDestination(client, databaseUrl, target)
    } catch {
        throw migrationError('CLIENTES_SOURCE_OPERATIONS_DESTINATION_UNSAFE')
    }
}

export function clientesSourceOperationsMigrationPlan() {
    return {
        id: CLIENTES_SOURCE_OPERATIONS_MIGRATION_ID,
        adds: [
            'clientes_source_operation_runs',
            'clientes_source_operation_checkpoints',
            'clientes_source_operation_backups',
            'clientes_source_operation_events',
            'clientes_source_operation_dead_letters',
            'clientes_source_operation_rollbacks',
        ],
        checkpointPolicy: 'Validated and applied snapshots are separate. An incomplete or failed read never replaces a validated checkpoint.',
        piiPolicy: 'The ledger contains only source ids, opaque references, hashes, timestamps, allowlisted codes and aggregate counts. It stores no source rows, names, phones, emails, provider responses, paths or error messages.',
        rollback: 'Non-destructive: source evidence and backups remain immutable; rollback only records the migration as rolled back.',
        runtimeAccess: 'The runtime role receives only SELECT/INSERT/UPDATE on mutable run/checkpoint state and SELECT/INSERT on append-only evidence. It receives no DELETE, TRUNCATE or DDL grant.',
    }
}

export async function applyClientesSourceOperationsMigration({
    pool,
    databaseUrl,
    target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL,
} = {}) {
    if (!pool) throw migrationError('CLIENTES_SOURCE_OPERATIONS_POOL_REQUIRED')
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) {
        throw migrationError('CLIENTES_SOURCE_OPERATIONS_DESTINATION_UNSAFE')
    }
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin')
        transactionOpen = true
        await client.query(`set local lock_timeout = '3s'`)
        await client.query(`set local statement_timeout = '60s'`)
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [CLIENTES_SOURCE_OPERATIONS_MIGRATION_ID])
        const destination = await assertDestination(client, databaseUrl, target)
        await ensureRegistry(client)
        await assertPrerequisites(client)
        for (const statement of STATEMENTS) await client.query(statement)
        await assertAppendOnlyTriggers(client)
        const grants = runtimeGrantStatements(target)
        for (const statement of grants) await client.query(statement)
        const report = {
            ...clientesSourceOperationsMigrationPlan(),
            applied: true,
            target,
            database: destination.database,
            runtimeRole: RUNTIME_ROLES[target],
            runtimeGrants: grants,
            appendOnlyTables: [
                'clientes_source_operation_events',
                'clientes_source_operation_backups',
                'clientes_source_operation_dead_letters',
                'clientes_source_operation_rollbacks',
            ],
        }
        await client.query(`insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), null, $2::jsonb)
            on conflict(id) do update set applied_at = excluded.applied_at, rolled_back_at = null, details = excluded.details`, [
            CLIENTES_SOURCE_OPERATIONS_MIGRATION_ID,
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

export async function rollbackClientesSourceOperationsMigration({
    pool,
    databaseUrl,
    target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL,
} = {}) {
    if (!pool) throw migrationError('CLIENTES_SOURCE_OPERATIONS_POOL_REQUIRED')
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) {
        throw migrationError('CLIENTES_SOURCE_OPERATIONS_DESTINATION_UNSAFE')
    }
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin')
        transactionOpen = true
        await client.query(`set local lock_timeout = '3s'`)
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [CLIENTES_SOURCE_OPERATIONS_MIGRATION_ID])
        await assertDestination(client, databaseUrl, target)
        await ensureRegistry(client)
        await client.query(`insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), now(), '{"rollback":"non-destructive","evidenceRetained":true}'::jsonb)
            on conflict(id) do update set rolled_back_at = now(), details = excluded.details`, [
            CLIENTES_SOURCE_OPERATIONS_MIGRATION_ID,
        ])
        await client.query('commit')
        transactionOpen = false
        return {
            id: CLIENTES_SOURCE_OPERATIONS_MIGRATION_ID,
            rolledBack: true,
            destructive: false,
            evidenceRetained: true,
        }
    } catch (error) {
        if (transactionOpen) {
            try { await client.query('rollback') } catch { /* preserve original failure */ }
        }
        throw error
    } finally {
        client.release()
    }
}

export const __testables = {
    STATEMENTS,
    runtimeGrantStatements,
    triggerReadinessStatement,
}
