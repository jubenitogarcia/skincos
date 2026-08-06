import { assertAtendimentoMigrationDestination, isStrictAtendimentoMigrationDestination, ATENDIMENTO_MIGRATION_TARGETS } from './migrationDestination.js'
import { IDENTITY_GRAPH_LOCK_KEY } from './identityReviewWorkflow.js'

export const IDENTITY_CLUSTER_WORKSPACE_MIGRATION_ID = '20260806_identity_cluster_workspace_v1'

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

const STATEMENTS = [
    `create table if not exists crm_atendimento.identity_review_cluster_operations (
        id uuid primary key default gen_random_uuid(),
        operation_key text not null unique,
        cluster_key text not null,
        operation text not null check (operation in ('bulk_confirm','reveal')),
        request_fingerprint text not null,
        status text not null check (status in ('previewed','applied','rejected','blocked')),
        actor jsonb not null default '{}'::jsonb,
        result jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
    )`,
    `create table if not exists crm_atendimento.identity_review_cluster_reveals (
        id uuid primary key default gen_random_uuid(),
        cluster_key text not null,
        cluster_version text not null,
        fields jsonb not null default '[]'::jsonb,
        reason_digest text not null,
        actor jsonb not null default '{}'::jsonb,
        unit_scope jsonb not null default '[]'::jsonb,
        created_at timestamptz not null default now()
    )`,
    `create index if not exists identity_review_cluster_operations_cluster_idx
        on crm_atendimento.identity_review_cluster_operations(cluster_key, created_at desc)`,
    `create index if not exists identity_review_cluster_reveals_cluster_idx
        on crm_atendimento.identity_review_cluster_reveals(cluster_key, created_at desc)`,
    `create or replace function crm_atendimento.prevent_identity_cluster_ledger_mutation()
        returns trigger language plpgsql as $$
        begin
            raise exception 'identity cluster evidence is append-only';
        end $$`,
    `drop trigger if exists identity_review_cluster_operations_immutable on crm_atendimento.identity_review_cluster_operations`,
    `create trigger identity_review_cluster_operations_immutable
        before update or delete or truncate on crm_atendimento.identity_review_cluster_operations
        for each statement execute function crm_atendimento.prevent_identity_cluster_ledger_mutation()`,
    `drop trigger if exists identity_review_cluster_reveals_immutable on crm_atendimento.identity_review_cluster_reveals`,
    `create trigger identity_review_cluster_reveals_immutable
        before update or delete or truncate on crm_atendimento.identity_review_cluster_reveals
        for each statement execute function crm_atendimento.prevent_identity_cluster_ledger_mutation()`,
]

function migrationError(code) {
    const error = new Error(code)
    error.code = code
    return error
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
    const columns = PREREQUISITES.map((table) => `to_regclass('crm_atendimento.${table}') as ${table}`).join(',')
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
        adds: ['identity_review_cluster_operations', 'identity_review_cluster_reveals'],
        privacy: 'Stores only opaque cluster keys, field names, a reason digest, actor identity and aggregate results; raw contact values never enter the operational ledger.',
        ledgerIntegrity: 'Cluster operations and reveal audits reject UPDATE, DELETE and TRUNCATE.',
        access: 'Runtime receives SELECT/INSERT only; no DDL and no destructive grant is required.',
        rollback: 'Non-destructive: marks the migration rolled back and disables cluster writes while retaining evidence.',
    }
}

export async function applyIdentityClusterWorkspaceMigration({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL } = {}) {
    if (!pool) throw migrationError('IDENTITY_CLUSTER_WORKSPACE_MIGRATION_POOL_REQUIRED')
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('IDENTITY_CLUSTER_WORKSPACE_MIGRATION_DESTINATION_UNSAFE')
    const client = await pool.connect()
    let open = false
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
        const role = RUNTIME_ROLES[target]
        if (!role) throw migrationError('IDENTITY_CLUSTER_WORKSPACE_MIGRATION_RUNTIME_ROLE_UNKNOWN')
        await client.query(`grant usage on schema crm_atendimento to ${role}`)
        await client.query(`grant select, insert on table crm_atendimento.identity_review_cluster_operations to ${role}`)
        await client.query(`grant select, insert on table crm_atendimento.identity_review_cluster_reveals to ${role}`)
        const report = { id: IDENTITY_CLUSTER_WORKSPACE_MIGRATION_ID, applied: true, runtimeRole: role, tables: ['identity_review_cluster_operations', 'identity_review_cluster_reveals'] }
        await client.query(`insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values($1,now(),null,$2::jsonb)
            on conflict(id) do update set applied_at=excluded.applied_at, rolled_back_at=null, details=excluded.details`, [IDENTITY_CLUSTER_WORKSPACE_MIGRATION_ID, JSON.stringify(report)])
        await client.query('commit'); open = false
        return report
    } catch (error) {
        if (open) { try { await client.query('rollback') } catch { /* preserve original error */ } }
        throw error
    } finally { client.release() }
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
            values($1,now(),now(),'{"rollback":"non-destructive","workspaceDisabled":true}'::jsonb)
            on conflict(id) do update set rolled_back_at=now(), details=excluded.details`, [IDENTITY_CLUSTER_WORKSPACE_MIGRATION_ID])
        await client.query('commit'); open = false
        return { id: IDENTITY_CLUSTER_WORKSPACE_MIGRATION_ID, rolledBack: true, destructive: false, workspaceDisabled: true }
    } catch (error) {
        if (open) { try { await client.query('rollback') } catch { /* preserve original error */ } }
        throw error
    } finally { client.release() }
}

export function identityClusterWorkspaceMigrationStatements() {
    return [...STATEMENTS]
}
