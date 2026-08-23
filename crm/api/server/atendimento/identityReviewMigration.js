import { isStrictLocalMirrorDestination } from './mirror.js'

export const IDENTITY_REVIEW_WORKFLOW_MIGRATION_ID = '20260805_identity_review_workflow_v1'

const PREREQUISITE_TABLES = [
    'client_merge_suggestions',
    'client_caixa_links',
    'app_client_registrations',
    'app_registration_attendance_links',
    'app_registration_caixa_links',
    'supplemental_lead_profiles',
    'supplemental_lead_profile_app_links',
    'supplemental_lead_profile_caixa_links',
    'global_client_identities',
    'global_client_identity_members',
    'commercial_actions',
    'commercial_contact_permissions',
    'commercial_contact_permission_events',
    'commercial_policy_config',
    'audit_events',
]

const STATEMENTS = [
    `create schema if not exists crm_atendimento`,
    `create table if not exists crm_atendimento.identity_materialization_runs (
        id uuid primary key default gen_random_uuid(),
        mode text not null check (mode in ('confirm','reject','reverse')),
        status text not null check (status in ('applied','not_applicable','blocked')),
        input_fingerprint text not null,
        previous_fingerprint text,
        summary jsonb not null default '{}'::jsonb,
        actor jsonb not null,
        created_at timestamptz not null default now()
    )`,
    `create table if not exists crm_atendimento.identity_review_decisions (
        id uuid primary key default gen_random_uuid(),
        event_order bigint generated always as identity,
        materialization_run_id uuid references crm_atendimento.identity_materialization_runs(id) on delete restrict,
        review_type text not null check (review_type in ('attendance_name_merge','attendance_caixa','app_attendance','app_caixa','lead_app','lead_caixa')),
        source_id text not null,
        target_id text not null,
        decision text not null check (decision in ('confirmed','rejected','reversed')),
        source_status text not null,
        resulting_status text not null,
        source_version text not null,
        reason text not null,
        actor jsonb not null,
        source_snapshot jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
    )`,
    `alter table crm_atendimento.identity_review_decisions
        add column if not exists event_order bigint generated always as identity`,
    `create table if not exists crm_atendimento.identity_member_history (
        id uuid primary key default gen_random_uuid(),
        event_order bigint generated always as identity,
        materialization_run_id uuid not null references crm_atendimento.identity_materialization_runs(id) on delete restrict,
        source_type text not null check (source_type in ('attendance_client','caixa_customer','app_registration','lead_profile')),
        source_id text not null,
        previous_identity_id uuid references crm_atendimento.global_client_identities(id) on delete restrict,
        next_identity_id uuid references crm_atendimento.global_client_identities(id) on delete restrict,
        change_kind text not null check (change_kind in ('created','moved','restored')),
        created_at timestamptz not null default now()
    )`,
    // Supports a partial/older v1 application without ever dropping evidence.
    `alter table crm_atendimento.identity_member_history
        add column if not exists event_order bigint generated always as identity`,
    `create table if not exists crm_atendimento.identity_lineage (
        id uuid primary key default gen_random_uuid(),
        materialization_run_id uuid not null references crm_atendimento.identity_materialization_runs(id) on delete restrict,
        predecessor_identity_id uuid not null references crm_atendimento.global_client_identities(id) on delete restrict,
        successor_identity_id uuid not null references crm_atendimento.global_client_identities(id) on delete restrict,
        relation text not null check (relation in ('retained','merged_into','split_from')),
        created_at timestamptz not null default now()
    )`,
    `create index if not exists identity_review_decisions_lookup_idx
        on crm_atendimento.identity_review_decisions(review_type, source_id, target_id, created_at desc)`,
    `create index if not exists identity_review_decisions_event_order_idx
        on crm_atendimento.identity_review_decisions(review_type, source_id, target_id, event_order desc)`,
    `create index if not exists identity_materialization_runs_created_idx
        on crm_atendimento.identity_materialization_runs(created_at desc)`,
    `create index if not exists identity_member_history_run_idx
        on crm_atendimento.identity_member_history(materialization_run_id, source_type, source_id)`,
    `create index if not exists identity_lineage_predecessor_idx
        on crm_atendimento.identity_lineage(predecessor_identity_id, created_at desc)`,
    `create or replace function crm_atendimento.prevent_identity_review_ledger_mutation()
        returns trigger language plpgsql as $$
        begin
            raise exception 'identity review evidence is append-only';
        end $$`,
    `drop trigger if exists identity_review_decisions_immutable on crm_atendimento.identity_review_decisions`,
    `create trigger identity_review_decisions_immutable
        before update or delete on crm_atendimento.identity_review_decisions
        for each row execute function crm_atendimento.prevent_identity_review_ledger_mutation()`,
    `drop trigger if exists identity_member_history_immutable on crm_atendimento.identity_member_history`,
    `create trigger identity_member_history_immutable
        before update or delete on crm_atendimento.identity_member_history
        for each row execute function crm_atendimento.prevent_identity_review_ledger_mutation()`,
    `drop trigger if exists identity_lineage_immutable on crm_atendimento.identity_lineage`,
    `create trigger identity_lineage_immutable
        before update or delete on crm_atendimento.identity_lineage
        for each row execute function crm_atendimento.prevent_identity_review_ledger_mutation()`,
]

function migrationError(code) {
    const error = new Error(code)
    error.code = code
    return error
}

async function assertLocalDestination(client, databaseUrl) {
    if (!isStrictLocalMirrorDestination(databaseUrl)) throw migrationError('IDENTITY_REVIEW_WORKFLOW_MIGRATION_DESTINATION_UNSAFE')
    const result = await client.query(`select current_database() as database_name, current_user as database_user,
        current_setting('transaction_read_only') as read_only`)
    const row = result.rows[0] || {}
    if (row.database_name !== 'skincos_crm_local' || row.database_user !== 'admin' || String(row.read_only).toLowerCase() === 'on') {
        throw migrationError('IDENTITY_REVIEW_WORKFLOW_MIGRATION_DESTINATION_UNSAFE')
    }
}

async function assertPrerequisites(client) {
    const columns = PREREQUISITE_TABLES.map((table) => `to_regclass('crm_atendimento.${table}') as ${table}`).join(',\n')
    const result = await client.query(`select ${columns}`)
    if (!Object.values(result.rows[0] || {}).every(Boolean)) {
        throw migrationError('IDENTITY_REVIEW_WORKFLOW_MIGRATION_PREREQUISITES_MISSING')
    }
    const column = await client.query(`select 1
        from information_schema.columns
        where table_schema='crm_atendimento' and table_name='commercial_policy_config'
          and column_name='commercial_contact_canary_identity_ids'`)
    if (!column.rows[0]) throw migrationError('IDENTITY_REVIEW_WORKFLOW_MIGRATION_PREREQUISITES_MISSING')
}

async function ensureRegistry(client) {
    await client.query(`create table if not exists crm_atendimento.schema_migrations (
        id text primary key, applied_at timestamptz not null default now(), rolled_back_at timestamptz,
        details jsonb not null default '{}'::jsonb
    )`)
}

export function identityReviewWorkflowMigrationPlan() {
    return {
        id: IDENTITY_REVIEW_WORKFLOW_MIGRATION_ID,
        adds: [
            'identity_review_decisions',
            'identity_materialization_runs',
            'identity_member_history',
            'identity_lineage',
        ],
        decisionPolicy: 'Append-only decisions preserve raw matching evidence, source state and an expected source version.',
        materializationPolicy: 'Confirmation reuses a deterministic active identity and fails closed when commercial history would need to move.',
        rollback: 'Non-destructive: preserves decisions, materialization history and lineage, then marks the workflow unavailable.',
    }
}

export async function applyIdentityReviewWorkflowMigration({ pool, databaseUrl }) {
    if (!pool) throw migrationError('IDENTITY_REVIEW_WORKFLOW_MIGRATION_POOL_REQUIRED')
    if (!isStrictLocalMirrorDestination(databaseUrl)) throw migrationError('IDENTITY_REVIEW_WORKFLOW_MIGRATION_DESTINATION_UNSAFE')
    const client = await pool.connect()
    const report = { id: IDENTITY_REVIEW_WORKFLOW_MIGRATION_ID, applied: false, tables: [], indexes: [] }
    let transactionOpen = false
    try {
        await client.query('begin')
        transactionOpen = true
        await client.query(`set local lock_timeout = '3s'`)
        await client.query(`set local statement_timeout = '60s'`)
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [IDENTITY_REVIEW_WORKFLOW_MIGRATION_ID])
        await assertLocalDestination(client, databaseUrl)
        await assertPrerequisites(client)
        await ensureRegistry(client)
        for (const sql of STATEMENTS) await client.query(sql)
        report.tables = ['identity_review_decisions', 'identity_materialization_runs', 'identity_member_history', 'identity_lineage']
        report.indexes = ['identity_review_decisions_lookup_idx', 'identity_review_decisions_event_order_idx', 'identity_materialization_runs_created_idx', 'identity_member_history_run_idx', 'identity_lineage_predecessor_idx']
        report.applied = true
        await client.query(`insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), null, $2::jsonb)
            on conflict(id) do update set applied_at = excluded.applied_at, rolled_back_at = null, details = excluded.details`,
        [IDENTITY_REVIEW_WORKFLOW_MIGRATION_ID, JSON.stringify(report)])
        await client.query('commit')
        transactionOpen = false
        return report
    } catch (error) {
        if (transactionOpen) {
            try { await client.query('rollback') } catch { /* preserve the migration failure */ }
        }
        throw error
    } finally {
        client.release()
    }
}

export async function rollbackIdentityReviewWorkflowMigration({ pool, databaseUrl }) {
    if (!pool) throw migrationError('IDENTITY_REVIEW_WORKFLOW_MIGRATION_POOL_REQUIRED')
    if (!isStrictLocalMirrorDestination(databaseUrl)) throw migrationError('IDENTITY_REVIEW_WORKFLOW_MIGRATION_DESTINATION_UNSAFE')
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin')
        transactionOpen = true
        await client.query(`set local lock_timeout = '3s'`)
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [IDENTITY_REVIEW_WORKFLOW_MIGRATION_ID])
        await assertLocalDestination(client, databaseUrl)
        await ensureRegistry(client)
        await client.query(`insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), now(), '{"rollback":"non-destructive","workflowDisabled":true}'::jsonb)
            on conflict(id) do update set rolled_back_at = now(), details = excluded.details`, [IDENTITY_REVIEW_WORKFLOW_MIGRATION_ID])
        await client.query('commit')
        transactionOpen = false
        return { id: IDENTITY_REVIEW_WORKFLOW_MIGRATION_ID, rolledBack: true, destructive: false, workflowDisabled: true }
    } catch (error) {
        if (transactionOpen) {
            try { await client.query('rollback') } catch { /* preserve the rollback failure */ }
        }
        throw error
    } finally {
        client.release()
    }
}
