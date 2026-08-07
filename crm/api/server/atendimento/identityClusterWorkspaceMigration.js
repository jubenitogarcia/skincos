import { assertAtendimentoMigrationDestination, isStrictAtendimentoMigrationDestination, ATENDIMENTO_MIGRATION_TARGETS } from './migrationDestination.js'
import { IDENTITY_GRAPH_LOCK_KEY } from './identityReviewWorkflow.js'

export const IDENTITY_CLUSTER_WORKSPACE_MIGRATION_ID = '20260807_identity_cluster_workspace_v2'

const RUNTIME_ROLES = Object.freeze({
    [ATENDIMENTO_MIGRATION_TARGETS.LOCAL]: 'skincos',
    [ATENDIMENTO_MIGRATION_TARGETS.STAGING]: 'skincos_staging_crm_app',
})

const PREREQUISITES = [
    'global_client_identities',
    'global_client_identity_members',
    'identity_review_decisions',
    'identity_materialization_runs',
    'identity_member_history',
    'identity_lineage',
    'identity_source_link_history',
    'commercial_actions',
    'commercial_contact_permissions',
    'commercial_contact_permission_events',
    'audit_events',
]

// There is deliberately no DROP in this migration.  A retry after a partial
// application only adds missing objects; it can never replace a prior ledger
// trigger or discard evidence.
const STATEMENTS = [
    `create table if not exists crm_atendimento.identity_cluster_review_operations (
        id uuid primary key default gen_random_uuid(),
        operation_key text not null unique check (char_length(operation_key) between 8 and 320),
        cluster_key text not null check (cluster_key ~ '^[a-f0-9]{32}$'),
        cluster_version text not null check (cluster_version ~ '^[a-f0-9]{64}$'),
        operation text not null check (operation in ('bulk_confirm')),
        request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
        actor_reference text not null check (actor_reference ~ '^[a-f0-9]{64}$'),
        actor_role text not null check (actor_role in ('GESTOR','ADMIN')),
        unit_scope jsonb not null default '[]'::jsonb,
        result jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
    )`,
    `create table if not exists crm_atendimento.identity_cluster_reveal_events (
        id uuid primary key default gen_random_uuid(),
        cluster_key text not null check (cluster_key ~ '^[a-f0-9]{32}$'),
        cluster_version text not null check (cluster_version ~ '^[a-f0-9]{64}$'),
        fields jsonb not null check (jsonb_typeof(fields) = 'array'),
        reason_digest text not null check (reason_digest ~ '^[a-f0-9]{64}$'),
        actor_reference text not null check (actor_reference ~ '^[a-f0-9]{64}$'),
        actor_role text not null check (actor_role in ('GESTOR','ADMIN')),
        unit_scope jsonb not null default '[]'::jsonb,
        created_at timestamptz not null default now()
    )`,
    `create index if not exists identity_cluster_review_operations_cluster_idx
        on crm_atendimento.identity_cluster_review_operations(cluster_key, created_at desc)`,
    `create index if not exists identity_cluster_reveal_events_cluster_idx
        on crm_atendimento.identity_cluster_reveal_events(cluster_key, created_at desc)`,
    `create or replace function crm_atendimento.prevent_identity_cluster_workspace_ledger_mutation()
        returns trigger language plpgsql as $$
        begin
            raise exception 'identity cluster workspace ledger is append-only';
        end $$`,
    `do $$ begin
        if not exists (select 1 from pg_trigger where tgrelid='crm_atendimento.identity_cluster_review_operations'::regclass
            and tgname='identity_cluster_review_operations_immutable') then
            execute 'create trigger identity_cluster_review_operations_immutable before update or delete on crm_atendimento.identity_cluster_review_operations for each row execute function crm_atendimento.prevent_identity_cluster_workspace_ledger_mutation()';
        end if;
    end $$`,
    `do $$ begin
        if not exists (select 1 from pg_trigger where tgrelid='crm_atendimento.identity_cluster_review_operations'::regclass
            and tgname='identity_cluster_review_operations_no_truncate') then
            execute 'create trigger identity_cluster_review_operations_no_truncate before truncate on crm_atendimento.identity_cluster_review_operations for each statement execute function crm_atendimento.prevent_identity_cluster_workspace_ledger_mutation()';
        end if;
    end $$`,
    `do $$ begin
        if not exists (select 1 from pg_trigger where tgrelid='crm_atendimento.identity_cluster_reveal_events'::regclass
            and tgname='identity_cluster_reveal_events_immutable') then
            execute 'create trigger identity_cluster_reveal_events_immutable before update or delete on crm_atendimento.identity_cluster_reveal_events for each row execute function crm_atendimento.prevent_identity_cluster_workspace_ledger_mutation()';
        end if;
    end $$`,
    `do $$ begin
        if not exists (select 1 from pg_trigger where tgrelid='crm_atendimento.identity_cluster_reveal_events'::regclass
            and tgname='identity_cluster_reveal_events_no_truncate') then
            execute 'create trigger identity_cluster_reveal_events_no_truncate before truncate on crm_atendimento.identity_cluster_reveal_events for each statement execute function crm_atendimento.prevent_identity_cluster_workspace_ledger_mutation()';
        end if;
    end $$`,
]

function migrationError(code) {
    const error = new Error(code)
    error.code = code
    return error
}

function runtimeGrantStatements(target) {
    const role = RUNTIME_ROLES[target]
    if (!role) throw migrationError('IDENTITY_CLUSTER_WORKSPACE_MIGRATION_RUNTIME_ROLE_UNKNOWN')
    return [
        `grant usage on schema crm_atendimento to ${role}`,
        `grant select, insert on table crm_atendimento.identity_cluster_review_operations to ${role}`,
        `grant select, insert on table crm_atendimento.identity_cluster_reveal_events to ${role}`,
    ]
}

async function assertDestination(client, databaseUrl, target) {
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('IDENTITY_CLUSTER_WORKSPACE_MIGRATION_DESTINATION_UNSAFE')
    try {
        await assertAtendimentoMigrationDestination(client, databaseUrl, target)
    } catch {
        throw migrationError('IDENTITY_CLUSTER_WORKSPACE_MIGRATION_DESTINATION_UNSAFE')
    }
}

async function assertPrerequisites(client) {
    const columns = PREREQUISITES.map((table, index) => `to_regclass('crm_atendimento.${table}') as relation_${index}`).join(',')
    const result = await client.query(`select ${columns}`)
    if (!Object.values(result.rows[0] || {}).every(Boolean)) throw migrationError('IDENTITY_CLUSTER_WORKSPACE_MIGRATION_PREREQUISITES_MISSING')
}

async function ensureRegistry(client) {
    await client.query(`create schema if not exists crm_atendimento`)
    await client.query(`create table if not exists crm_atendimento.schema_migrations (
        id text primary key, applied_at timestamptz not null default now(), rolled_back_at timestamptz,
        details jsonb not null default '{}'::jsonb
    )`)
}

export function identityClusterWorkspaceMigrationPlan() {
    return {
        id: IDENTITY_CLUSTER_WORKSPACE_MIGRATION_ID,
        adds: ['identity_cluster_review_operations', 'identity_cluster_reveal_events'],
        privacy: 'Stores opaque cluster keys, HMAC-derived actor references, field names, reason digests and aggregate results only; client contact values never enter the operational ledger.',
        ledgerIntegrity: 'Both cluster ledgers reject UPDATE, DELETE and TRUNCATE without replacing pre-existing triggers.',
        access: 'The runtime role receives SELECT/INSERT only; no runtime DDL, DELETE or UPDATE grant is required.',
        rollback: 'Non-destructive: retains operation and reveal evidence, then records the workspace as unavailable.',
    }
}

export async function applyIdentityClusterWorkspaceMigration({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL } = {}) {
    if (!pool) throw migrationError('IDENTITY_CLUSTER_WORKSPACE_MIGRATION_POOL_REQUIRED')
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('IDENTITY_CLUSTER_WORKSPACE_MIGRATION_DESTINATION_UNSAFE')
    const client = await pool.connect()
    let open = false
    const report = {
        id: IDENTITY_CLUSTER_WORKSPACE_MIGRATION_ID,
        applied: false,
        tables: ['identity_cluster_review_operations', 'identity_cluster_reveal_events'],
        appendOnlyTables: ['identity_cluster_review_operations', 'identity_cluster_reveal_events'],
    }
    try {
        await client.query('begin'); open = true
        await client.query(`set local lock_timeout = '3s'`)
        await client.query(`set local statement_timeout = '60s'`)
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [IDENTITY_CLUSTER_WORKSPACE_MIGRATION_ID])
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [IDENTITY_GRAPH_LOCK_KEY])
        await assertDestination(client, databaseUrl, target)
        await assertPrerequisites(client)
        await ensureRegistry(client)
        for (const sql of STATEMENTS) await client.query(sql)
        report.runtimeRole = RUNTIME_ROLES[target]
        report.runtimeGrants = runtimeGrantStatements(target)
        for (const sql of report.runtimeGrants) await client.query(sql)
        report.applied = true
        await client.query(`insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values($1,now(),null,$2::jsonb)
            on conflict(id) do update set applied_at=excluded.applied_at, rolled_back_at=null, details=excluded.details`, [IDENTITY_CLUSTER_WORKSPACE_MIGRATION_ID, JSON.stringify(report)])
        await client.query('commit'); open = false
        return report
    } catch (error) {
        if (open) {
            try { await client.query('rollback') } catch { /* retain original migration error */ }
        }
        throw error
    } finally {
        client.release()
    }
}

export async function rollbackIdentityClusterWorkspaceMigration({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL } = {}) {
    if (!pool) throw migrationError('IDENTITY_CLUSTER_WORKSPACE_MIGRATION_POOL_REQUIRED')
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('IDENTITY_CLUSTER_WORKSPACE_MIGRATION_DESTINATION_UNSAFE')
    const client = await pool.connect()
    let open = false
    try {
        await client.query('begin'); open = true
        await client.query(`set local lock_timeout = '3s'`)
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [IDENTITY_CLUSTER_WORKSPACE_MIGRATION_ID])
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [IDENTITY_GRAPH_LOCK_KEY])
        await assertDestination(client, databaseUrl, target)
        await ensureRegistry(client)
        await client.query(`insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values($1,now(),now(),$2::jsonb)
            on conflict(id) do update set rolled_back_at=now(), details=excluded.details`, [
            IDENTITY_CLUSTER_WORKSPACE_MIGRATION_ID,
            JSON.stringify({ rollback: 'non-destructive', workspaceDisabled: true, evidenceRetained: true }),
        ])
        await client.query('commit'); open = false
        return { id: IDENTITY_CLUSTER_WORKSPACE_MIGRATION_ID, rolledBack: true, destructive: false, workspaceDisabled: true, evidenceRetained: true }
    } catch (error) {
        if (open) {
            try { await client.query('rollback') } catch { /* retain original migration error */ }
        }
        throw error
    } finally {
        client.release()
    }
}

export function identityClusterWorkspaceMigrationStatements() {
    return [...STATEMENTS]
}
