import { assertAtendimentoMigrationDestination, isStrictAtendimentoMigrationDestination, ATENDIMENTO_MIGRATION_TARGETS } from './migrationDestination.js'
import { IDENTITY_GRAPH_LOCK_KEY } from './identityReviewWorkflow.js'

export const IDENTITY_REVIEW_WORKFLOW_MIGRATION_ID = '20260805_identity_review_workflow_v1'
export const IDENTITY_REVIEW_SOURCE_LINK_LEDGER_MIGRATION_ID = '20260805_identity_review_source_link_ledger_v1'
export const IDENTITY_REVIEW_LEDGER_INTEGRITY_MIGRATION_ID = '20260805_identity_review_ledger_integrity_v1'
export const IDENTITY_REVIEW_WORKFLOW_MIGRATION_IDS = [
    IDENTITY_REVIEW_WORKFLOW_MIGRATION_ID,
    IDENTITY_REVIEW_SOURCE_LINK_LEDGER_MIGRATION_ID,
    IDENTITY_REVIEW_LEDGER_INTEGRITY_MIGRATION_ID,
]

const IDENTITY_REVIEW_RUNTIME_ROLES = Object.freeze({
    [ATENDIMENTO_MIGRATION_TARGETS.LOCAL]: 'skincos',
    [ATENDIMENTO_MIGRATION_TARGETS.STAGING]: 'skincos_staging_crm_app',
})

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

// v2 remains additive so an existing v1 review ledger keeps all of its
// evidence.  Materialization run ordering is shared by member movements and
// accepted automatic source links, avoiding the transaction-start timestamp
// skew that would make an undo dependency ambiguous.
const SOURCE_LINK_LEDGER_STATEMENTS = [
    `alter table crm_atendimento.identity_materialization_runs
        add column if not exists event_order bigint generated always as identity`,
    `create table if not exists crm_atendimento.identity_source_link_history (
        id uuid primary key default gen_random_uuid(),
        materialization_run_id uuid not null references crm_atendimento.identity_materialization_runs(id) on delete restrict,
        link_type text not null check (link_type in ('attendance_caixa','app_attendance','app_caixa','lead_app','lead_caixa')),
        source_type text not null check (source_type in ('attendance_client','caixa_customer','app_registration','lead_profile')),
        source_id text not null,
        target_type text not null check (target_type in ('attendance_client','caixa_customer','app_registration','lead_profile')),
        target_id text not null,
        transition text not null check (transition in ('automatic_activated','automatic_deactivated')),
        resulting_status text not null,
        origin text not null,
        created_at timestamptz not null default now()
    )`,
    `create index if not exists identity_materialization_runs_event_order_idx
        on crm_atendimento.identity_materialization_runs(event_order)`,
    `create index if not exists identity_source_link_history_run_idx
        on crm_atendimento.identity_source_link_history(materialization_run_id, source_type, source_id)`,
    `create index if not exists identity_source_link_history_target_idx
        on crm_atendimento.identity_source_link_history(target_type, target_id)`,
    `drop trigger if exists identity_source_link_history_immutable on crm_atendimento.identity_source_link_history`,
    `create trigger identity_source_link_history_immutable
        before update or delete on crm_atendimento.identity_source_link_history
        for each row execute function crm_atendimento.prevent_identity_review_ledger_mutation()`,
]

// TRUNCATE does not fire row-level UPDATE/DELETE triggers. Keep this as a
// separate tracked migration so an already-applied review workflow becomes
// ready only after its historical evidence receives the same protection as
// the commercial ledgers.
const LEDGER_INTEGRITY_STATEMENTS = [
    `drop trigger if exists identity_review_decisions_no_truncate on crm_atendimento.identity_review_decisions`,
    `create trigger identity_review_decisions_no_truncate
        before truncate on crm_atendimento.identity_review_decisions
        for each statement execute function crm_atendimento.prevent_identity_review_ledger_mutation()`,
    `drop trigger if exists identity_member_history_no_truncate on crm_atendimento.identity_member_history`,
    `create trigger identity_member_history_no_truncate
        before truncate on crm_atendimento.identity_member_history
        for each statement execute function crm_atendimento.prevent_identity_review_ledger_mutation()`,
    `drop trigger if exists identity_lineage_no_truncate on crm_atendimento.identity_lineage`,
    `create trigger identity_lineage_no_truncate
        before truncate on crm_atendimento.identity_lineage
        for each statement execute function crm_atendimento.prevent_identity_review_ledger_mutation()`,
    `drop trigger if exists identity_source_link_history_no_truncate on crm_atendimento.identity_source_link_history`,
    `create trigger identity_source_link_history_no_truncate
        before truncate on crm_atendimento.identity_source_link_history
        for each statement execute function crm_atendimento.prevent_identity_review_ledger_mutation()`,
]

function migrationError(code) {
    const error = new Error(code)
    error.code = code
    return error
}

function runtimeGrantStatements(target) {
    const role = IDENTITY_REVIEW_RUNTIME_ROLES[target]
    if (!role) throw migrationError('IDENTITY_REVIEW_WORKFLOW_MIGRATION_RUNTIME_ROLE_UNKNOWN')
    return [
        `grant usage on schema crm_atendimento to ${role}`,
        `grant select on table crm_atendimento.schema_migrations to ${role}`,
        `grant select, insert on table crm_atendimento.identity_review_decisions to ${role}`,
        `grant select, insert, update on table crm_atendimento.identity_materialization_runs to ${role}`,
        `grant select, insert on table crm_atendimento.identity_member_history to ${role}`,
        `grant select, insert on table crm_atendimento.identity_lineage to ${role}`,
        `grant select, insert on table crm_atendimento.identity_source_link_history to ${role}`,
        `grant usage, select on sequence crm_atendimento.identity_review_decisions_event_order_seq to ${role}`,
        `grant usage, select on sequence crm_atendimento.identity_materialization_runs_event_order_seq to ${role}`,
        `grant usage, select on sequence crm_atendimento.identity_member_history_event_order_seq to ${role}`,
    ]
}

async function assertLocalDestination(client, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL) {
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('IDENTITY_REVIEW_WORKFLOW_MIGRATION_DESTINATION_UNSAFE')
    try {
        await assertAtendimentoMigrationDestination(client, databaseUrl, target)
    } catch {
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

async function sourceLinkLedgerCutoverEventOrder(client) {
    const recorded = await client.query(`select details
        from crm_atendimento.schema_migrations
        where id=$1 and rolled_back_at is null
        for update`, [IDENTITY_REVIEW_SOURCE_LINK_LEDGER_MIGRATION_ID])
    const prior = Number(recorded.rows[0]?.details?.sourceLinkLedgerCutoverRunEventOrder)
    if (Number.isSafeInteger(prior) && prior >= 0) return prior
    const current = await client.query(`select coalesce(max(event_order),0)::bigint as event_order
        from crm_atendimento.identity_materialization_runs`)
    const boundary = Number(current.rows[0]?.event_order || 0)
    if (!Number.isSafeInteger(boundary) || boundary < 0) throw migrationError('IDENTITY_REVIEW_SOURCE_LINK_LEDGER_CUTOVER_INVALID')
    return boundary
}

export function identityReviewWorkflowMigrationPlan() {
    return {
        id: IDENTITY_REVIEW_WORKFLOW_MIGRATION_ID,
        migrationIds: IDENTITY_REVIEW_WORKFLOW_MIGRATION_IDS,
        adds: [
            'identity_review_decisions',
            'identity_materialization_runs',
            'identity_member_history',
            'identity_lineage',
            'identity_source_link_history',
        ],
        decisionPolicy: 'Append-only decisions preserve raw matching evidence, source state and an expected source version.',
        ledgerIntegrityPolicy: 'Every identity-review evidence table rejects UPDATE, DELETE and TRUNCATE through the append-only ledger guard.',
        runtimeAccess: 'The dedicated runtime role receives only review-ledger SELECT/INSERT, materialization-run SELECT/INSERT/UPDATE, and generated event-order sequence access; immutable ledgers remain non-destructible.',
        materializationPolicy: 'Confirmation reuses a deterministic active identity, orders member and automatic-link evidence in one ledger, and fails closed when commercial history would need to move or pre-ledger history is ambiguous.',
        rollback: 'Non-destructive: preserves decisions, materialization history and lineage, then marks the workflow unavailable.',
    }
}

export async function applyIdentityReviewWorkflowMigration({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL }) {
    if (!pool) throw migrationError('IDENTITY_REVIEW_WORKFLOW_MIGRATION_POOL_REQUIRED')
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('IDENTITY_REVIEW_WORKFLOW_MIGRATION_DESTINATION_UNSAFE')
    const client = await pool.connect()
    const report = { id: IDENTITY_REVIEW_WORKFLOW_MIGRATION_ID, migrationIds: IDENTITY_REVIEW_WORKFLOW_MIGRATION_IDS, applied: false, tables: [], indexes: [] }
    let transactionOpen = false
    try {
        await client.query('begin')
        transactionOpen = true
        await client.query(`set local lock_timeout = '3s'`)
        await client.query(`set local statement_timeout = '60s'`)
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [IDENTITY_REVIEW_WORKFLOW_MIGRATION_ID])
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [IDENTITY_REVIEW_SOURCE_LINK_LEDGER_MIGRATION_ID])
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [IDENTITY_REVIEW_LEDGER_INTEGRITY_MIGRATION_ID])
        // Reviewed decisions acquire migration -> graph in this order; source
        // materializers acquire the graph lock.  Joining both guarantees this
        // DDL cannot cross an in-flight projection or commercial rebind.
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [IDENTITY_GRAPH_LOCK_KEY])
        await assertLocalDestination(client, databaseUrl, target)
        await assertPrerequisites(client)
        await ensureRegistry(client)
        for (const sql of STATEMENTS) await client.query(sql)
        for (const sql of SOURCE_LINK_LEDGER_STATEMENTS) await client.query(sql)
        for (const sql of LEDGER_INTEGRITY_STATEMENTS) await client.query(sql)
        const runtimeRole = IDENTITY_REVIEW_RUNTIME_ROLES[target]
        const grants = runtimeGrantStatements(target)
        for (const sql of grants) await client.query(sql)
        report.sourceLinkLedgerCutoverRunEventOrder = await sourceLinkLedgerCutoverEventOrder(client)
        report.runtimeRole = runtimeRole
        report.runtimeGrants = grants
        report.tables = ['identity_review_decisions', 'identity_materialization_runs', 'identity_member_history', 'identity_lineage', 'identity_source_link_history']
        report.indexes = ['identity_review_decisions_lookup_idx', 'identity_review_decisions_event_order_idx', 'identity_materialization_runs_created_idx', 'identity_materialization_runs_event_order_idx', 'identity_member_history_run_idx', 'identity_lineage_predecessor_idx', 'identity_source_link_history_run_idx', 'identity_source_link_history_target_idx']
        report.applied = true
        for (const migrationId of IDENTITY_REVIEW_WORKFLOW_MIGRATION_IDS) {
            await client.query(`insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
                values ($1, now(), null, $2::jsonb)
                on conflict(id) do update set applied_at = excluded.applied_at, rolled_back_at = null, details = excluded.details`,
            [migrationId, JSON.stringify(report)])
        }
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

export async function rollbackIdentityReviewWorkflowMigration({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL }) {
    if (!pool) throw migrationError('IDENTITY_REVIEW_WORKFLOW_MIGRATION_POOL_REQUIRED')
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('IDENTITY_REVIEW_WORKFLOW_MIGRATION_DESTINATION_UNSAFE')
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin')
        transactionOpen = true
        await client.query(`set local lock_timeout = '3s'`)
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [IDENTITY_REVIEW_WORKFLOW_MIGRATION_ID])
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [IDENTITY_REVIEW_SOURCE_LINK_LEDGER_MIGRATION_ID])
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [IDENTITY_REVIEW_LEDGER_INTEGRITY_MIGRATION_ID])
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [IDENTITY_GRAPH_LOCK_KEY])
        await assertLocalDestination(client, databaseUrl, target)
        await ensureRegistry(client)
        for (const migrationId of IDENTITY_REVIEW_WORKFLOW_MIGRATION_IDS) {
            await client.query(`insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
                values ($1, now(), now(), '{"rollback":"non-destructive","workflowDisabled":true}'::jsonb)
                on conflict(id) do update set rolled_back_at = now(), details = excluded.details`, [migrationId])
        }
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
