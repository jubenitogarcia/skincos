import { isStrictLocalMirrorDestination } from './mirror.js'

export const COMMERCIAL_ACTION_LEDGER_MIGRATION_ID = '20260805_commercial_action_ledger_v1'

const PREREQUISITE_TABLES = [
    'commercial_actions',
    'commercial_contact_permission_events',
    'global_client_identities',
]

// This migration preserves all pre-existing commercial evidence. It starts a
// new append-only ledger rather than inferring a false historical timeline
// from mutable action rows.
const STATEMENTS = [
    `create extension if not exists pgcrypto`,
    `alter table crm_atendimento.commercial_contact_permission_events
        add column if not exists trace_id uuid`,
    `do $$ begin
        if not exists (
            select 1 from pg_constraint
            where conname = 'commercial_permission_events_trace_required'
              and conrelid = 'crm_atendimento.commercial_contact_permission_events'::regclass
        ) then
            alter table crm_atendimento.commercial_contact_permission_events
                add constraint commercial_permission_events_trace_required
                check (trace_id is not null) not valid;
        end if;
    end $$`,
    `create table if not exists crm_atendimento.commercial_action_events (
        id uuid primary key default gen_random_uuid(),
        event_order bigint generated always as identity,
        action_id uuid not null references crm_atendimento.commercial_actions(id) on delete restrict,
        identity_id uuid not null references crm_atendimento.global_client_identities(id) on delete restrict,
        event_type text not null check(event_type in ('created','updated')),
        previous_status text check(previous_status in ('open','contacted','responded','scheduled','won_sale','returned','closed','cancelled')),
        status text not null check(status in ('open','contacted','responded','scheduled','won_sale','returned','closed','cancelled')),
        trace_id uuid not null,
        recorded_by text not null,
        contact_eligibility_status text check(contact_eligibility_status in ('eligible','review_required','blocked')),
        contact_eligibility_reason text,
        details jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
    )`,
    `create or replace function crm_atendimento.prevent_commercial_ledger_mutation()
        returns trigger language plpgsql as $$
        begin
            raise exception 'commercial ledger evidence is append-only';
        end $$`,
    `drop trigger if exists commercial_contact_permission_events_immutable
        on crm_atendimento.commercial_contact_permission_events`,
    `create trigger commercial_contact_permission_events_immutable
        before update or delete on crm_atendimento.commercial_contact_permission_events
        for each row execute function crm_atendimento.prevent_commercial_ledger_mutation()`,
    `drop trigger if exists commercial_contact_permission_events_no_truncate
        on crm_atendimento.commercial_contact_permission_events`,
    `create trigger commercial_contact_permission_events_no_truncate
        before truncate on crm_atendimento.commercial_contact_permission_events
        for each statement execute function crm_atendimento.prevent_commercial_ledger_mutation()`,
    `drop trigger if exists commercial_action_events_immutable
        on crm_atendimento.commercial_action_events`,
    `create trigger commercial_action_events_immutable
        before update or delete on crm_atendimento.commercial_action_events
        for each row execute function crm_atendimento.prevent_commercial_ledger_mutation()`,
    `drop trigger if exists commercial_action_events_no_truncate
        on crm_atendimento.commercial_action_events`,
    `create trigger commercial_action_events_no_truncate
        before truncate on crm_atendimento.commercial_action_events
        for each statement execute function crm_atendimento.prevent_commercial_ledger_mutation()`,
]

const INDEXES = [
    {
        name: 'crm_atendimento_commercial_permission_events_trace_idx',
        sql: `create index concurrently if not exists crm_atendimento_commercial_permission_events_trace_idx
            on crm_atendimento.commercial_contact_permission_events(trace_id, created_at desc)
            where trace_id is not null`,
    },
    {
        name: 'crm_atendimento_commercial_action_events_action_idx',
        sql: `create index concurrently if not exists crm_atendimento_commercial_action_events_action_idx
            on crm_atendimento.commercial_action_events(action_id, event_order desc)`,
    },
    {
        name: 'crm_atendimento_commercial_action_events_trace_idx',
        sql: `create index concurrently if not exists crm_atendimento_commercial_action_events_trace_idx
            on crm_atendimento.commercial_action_events(trace_id, event_order desc)`,
    },
]

function migrationError(code) {
    const error = new Error(code)
    error.code = code
    return error
}

async function query(client, sql, params = []) {
    return client.query(sql, params)
}

async function assertLocalDestination(client, databaseUrl) {
    if (!isStrictLocalMirrorDestination(databaseUrl)) {
        throw migrationError('COMMERCIAL_ACTION_LEDGER_MIGRATION_DESTINATION_UNSAFE')
    }
    const result = await query(client, `select current_database() as database_name, current_user as database_user,
        current_setting('transaction_read_only') as read_only`)
    const row = result.rows[0] || {}
    if (row.database_name !== 'skincos_crm_local' || row.database_user !== 'admin' || String(row.read_only).toLowerCase() === 'on') {
        throw migrationError('COMMERCIAL_ACTION_LEDGER_MIGRATION_DESTINATION_UNSAFE')
    }
}

async function assertPrerequisites(client) {
    const columns = PREREQUISITE_TABLES
        .map((table) => `to_regclass('crm_atendimento.` + table + `') as ` + table)
        .join(',\n')
    const result = await query(client, `select ` + columns)
    if (!Object.values(result.rows[0] || {}).every(Boolean)) {
        throw migrationError('COMMERCIAL_ACTION_LEDGER_MIGRATION_PREREQUISITES_MISSING')
    }
}

async function ensureRegistry(client) {
    await query(client, `create schema if not exists crm_atendimento`)
    await query(client, `create table if not exists crm_atendimento.schema_migrations (
        id text primary key, applied_at timestamptz not null default now(), rolled_back_at timestamptz,
        details jsonb not null default '{}'::jsonb
    )`)
}

async function inspectCutover(client) {
    const result = await query(client, `select
        (select count(*)::int
           from crm_atendimento.commercial_contact_permission_events
          where trace_id is null) as permission_events_without_trace,
        (select count(*)::int
           from crm_atendimento.commercial_actions) as preexisting_actions`)
    const row = result.rows[0] || {}
    return {
        permissionEventsWithoutTrace: Number(row.permission_events_without_trace || 0),
        preexistingActions: Number(row.preexisting_actions || 0),
    }
}

async function validatePermissionTraceConstraint(client, permissionEventsWithoutTrace) {
    if (permissionEventsWithoutTrace > 0) return false
    await query(client, `alter table crm_atendimento.commercial_contact_permission_events
        validate constraint commercial_permission_events_trace_required`)
    return true
}

export function commercialActionLedgerMigrationPlan() {
    return {
        id: COMMERCIAL_ACTION_LEDGER_MIGRATION_ID,
        adds: ['commercial_contact_permission_events.trace_id', 'commercial_action_events'],
        appendOnlyTables: ['commercial_contact_permission_events', 'commercial_action_events'],
        tracePolicy: 'Every post-cutover permission event and action ledger event carries one UUID trace_id; legacy evidence remains preserved without synthetic backfill.',
        auditScope: 'The migration leaves crm_atendimento.audit_events mutable and uses trace_id in its payload only for commercial correlation.',
        rollback: 'Non-destructive: retains commercial ledger evidence, trace links and append-only guards, then marks the migration rolled back.',
    }
}

export async function applyCommercialActionLedgerMigration({ pool, databaseUrl }) {
    if (!pool) throw migrationError('COMMERCIAL_ACTION_LEDGER_MIGRATION_POOL_REQUIRED')
    if (!isStrictLocalMirrorDestination(databaseUrl)) {
        throw migrationError('COMMERCIAL_ACTION_LEDGER_MIGRATION_DESTINATION_UNSAFE')
    }
    const client = await pool.connect()
    const report = {
        id: COMMERCIAL_ACTION_LEDGER_MIGRATION_ID,
        applied: false,
        tables: ['commercial_action_events'],
        indexes: [],
        permissionEventsWithoutTrace: 0,
        preexistingActions: 0,
        permissionTraceConstraintValidated: false,
    }
    try {
        await query(client, `set lock_timeout = '3s'`)
        await query(client, `set statement_timeout = '60s'`)
        await query(client, `select pg_advisory_lock(hashtext($1))`, [COMMERCIAL_ACTION_LEDGER_MIGRATION_ID])
        await assertLocalDestination(client, databaseUrl)
        await assertPrerequisites(client)
        await ensureRegistry(client)
        for (const sql of STATEMENTS) await query(client, sql)
        const cutover = await inspectCutover(client)
        report.permissionEventsWithoutTrace = cutover.permissionEventsWithoutTrace
        report.preexistingActions = cutover.preexistingActions
        report.permissionTraceConstraintValidated = await validatePermissionTraceConstraint(client, cutover.permissionEventsWithoutTrace)
        for (const index of INDEXES) {
            await query(client, index.sql)
            report.indexes.push(index.name)
        }
        report.applied = true
        await query(client, `insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), null, $2::jsonb)
            on conflict(id) do update set applied_at = excluded.applied_at, rolled_back_at = null, details = excluded.details`,
        [COMMERCIAL_ACTION_LEDGER_MIGRATION_ID, JSON.stringify(report)])
        return report
    } finally {
        try {
            await query(client, `select pg_advisory_unlock(hashtext($1))`, [COMMERCIAL_ACTION_LEDGER_MIGRATION_ID])
        } catch {
            // The connection may already be unusable; preserve the original error.
        }
        client.release()
    }
}

export async function rollbackCommercialActionLedgerMigration({ pool, databaseUrl }) {
    if (!pool) throw migrationError('COMMERCIAL_ACTION_LEDGER_MIGRATION_POOL_REQUIRED')
    if (!isStrictLocalMirrorDestination(databaseUrl)) {
        throw migrationError('COMMERCIAL_ACTION_LEDGER_MIGRATION_DESTINATION_UNSAFE')
    }
    const client = await pool.connect()
    try {
        await query(client, `set lock_timeout = '3s'`)
        await query(client, `select pg_advisory_lock(hashtext($1))`, [COMMERCIAL_ACTION_LEDGER_MIGRATION_ID])
        await assertLocalDestination(client, databaseUrl)
        await ensureRegistry(client)
        await query(client, `insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), now(), '{"rollback":"non-destructive","ledgerRetained":true}'::jsonb)
            on conflict(id) do update set rolled_back_at = now(), details = excluded.details`,
        [COMMERCIAL_ACTION_LEDGER_MIGRATION_ID])
        return {
            id: COMMERCIAL_ACTION_LEDGER_MIGRATION_ID,
            rolledBack: true,
            destructive: false,
            ledgerRetained: true,
        }
    } finally {
        try {
            await query(client, `select pg_advisory_unlock(hashtext($1))`, [COMMERCIAL_ACTION_LEDGER_MIGRATION_ID])
        } catch {
            // The connection may already be unusable; preserve the original error.
        }
        client.release()
    }
}
