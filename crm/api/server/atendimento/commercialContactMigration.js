import { assertAtendimentoMigrationDestination, isStrictAtendimentoMigrationDestination, ATENDIMENTO_MIGRATION_TARGETS } from './migrationDestination.js'

export const COMMERCIAL_CONTACT_MIGRATION_ID = '20260804_commercial_contact_controls_v1'

const COMMERCIAL_CONTACT_RUNTIME_ROLES = Object.freeze({
    [ATENDIMENTO_MIGRATION_TARGETS.LOCAL]: 'skincos',
    [ATENDIMENTO_MIGRATION_TARGETS.STAGING]: 'skincos_staging_crm_app',
    [ATENDIMENTO_MIGRATION_TARGETS.PRODUCTION]: 'skincos_clientes_ro',
})

const CONTACT_TABLES = [
    `create extension if not exists pgcrypto`,
    `create schema if not exists crm_atendimento`,
    `create table if not exists crm_atendimento.commercial_contact_permissions (
        identity_id uuid not null,
        channel text not null default 'whatsapp' check(channel in ('whatsapp')),
        status text not null check(status in ('granted','denied')),
        evidence_source text not null,
        evidence_reference text not null,
        expires_at timestamptz,
        recorded_by text not null,
        revision integer not null default 1 check(revision >= 1),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        primary key(identity_id, channel)
    )`,
    `create table if not exists crm_atendimento.commercial_contact_permission_events (
        id uuid primary key default gen_random_uuid(),
        identity_id uuid not null,
        channel text not null check(channel in ('whatsapp')),
        previous_status text check(previous_status in ('granted','denied')),
        status text not null check(status in ('granted','denied')),
        evidence_source text not null,
        evidence_reference text not null,
        expires_at timestamptz,
        recorded_by text not null,
        reason text,
        created_at timestamptz not null default now()
    )`,
    `alter table crm_atendimento.commercial_actions add column if not exists contact_channel text`,
    `do $$ begin
        if not exists (select 1 from pg_constraint where conname = 'crm_atendimento_commercial_actions_contact_channel_valid') then
            alter table crm_atendimento.commercial_actions add constraint crm_atendimento_commercial_actions_contact_channel_valid
                check(contact_channel is null or contact_channel in ('whatsapp')) not valid;
        end if;
    end $$`,
    `alter table crm_atendimento.commercial_actions validate constraint crm_atendimento_commercial_actions_contact_channel_valid`,
]

const INDEXES = [
    `create index concurrently if not exists crm_atendimento_commercial_contact_permissions_status_idx
        on crm_atendimento.commercial_contact_permissions(channel, status, updated_at desc)`,
    `create index concurrently if not exists crm_atendimento_commercial_contact_permission_events_identity_idx
        on crm_atendimento.commercial_contact_permission_events(identity_id, created_at desc)`,
]

function migrationError(code) {
    const error = new Error(code)
    error.code = code
    return error
}

function runtimeGrantStatements(target) {
    const role = COMMERCIAL_CONTACT_RUNTIME_ROLES[target]
    if (!role) throw migrationError('COMMERCIAL_CONTACT_MIGRATION_RUNTIME_ROLE_UNKNOWN')
    return [
        `grant usage on schema crm_atendimento to ${role}`,
        `grant select on table crm_atendimento.schema_migrations to ${role}`,
        `grant select, insert, update on table crm_atendimento.commercial_contact_permissions to ${role}`,
        `grant select, insert on table crm_atendimento.commercial_contact_permission_events to ${role}`,
    ]
}

async function query(client, sql, params = []) {
    return client.query(sql, params)
}

async function assertLocalDestination(client, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL) {
    try {
        await assertAtendimentoMigrationDestination(client, databaseUrl, target)
    } catch {
        throw migrationError('COMMERCIAL_CONTACT_MIGRATION_DESTINATION_UNSAFE')
    }
}

async function ensureRegistry(client) {
    await query(client, `create schema if not exists crm_atendimento`)
    await query(client, `create table if not exists crm_atendimento.schema_migrations (
        id text primary key, applied_at timestamptz not null default now(), rolled_back_at timestamptz,
        details jsonb not null default '{}'::jsonb
    )`)
}

export function commercialContactMigrationPlan() {
    return {
        id: COMMERCIAL_CONTACT_MIGRATION_ID,
        tables: ['commercial_contact_permissions', 'commercial_contact_permission_events'],
        indexes: [...INDEXES],
        runtimeAccess: 'The dedicated runtime role receives only consent-state SELECT/INSERT/UPDATE and immutable permission-event SELECT/INSERT; DELETE, TRUNCATE and unrelated source access remain denied.',
        rollback: 'Non-destructive: retains permissions and immutable events, removes only lookup indexes and marks the migration rolled back.',
    }
}

export async function applyCommercialContactMigration({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL }) {
    if (!pool) throw migrationError('COMMERCIAL_CONTACT_MIGRATION_POOL_REQUIRED')
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('COMMERCIAL_CONTACT_MIGRATION_DESTINATION_UNSAFE')
    const client = await pool.connect()
    const report = { id: COMMERCIAL_CONTACT_MIGRATION_ID, applied: false, indexes: [] }
    try {
        await query(client, `set lock_timeout = '3s'`)
        await query(client, `set statement_timeout = '60s'`)
        await query(client, `select pg_advisory_lock(hashtext($1))`, [COMMERCIAL_CONTACT_MIGRATION_ID])
        await assertLocalDestination(client, databaseUrl, target)
        await ensureRegistry(client)
        for (const sql of CONTACT_TABLES) await query(client, sql)
        for (const sql of INDEXES) {
            await query(client, sql)
            report.indexes.push(sql.match(/exists\s+([^\s]+)/i)?.[1] || sql)
        }
        const runtimeRole = COMMERCIAL_CONTACT_RUNTIME_ROLES[target]
        const grants = runtimeGrantStatements(target)
        for (const sql of grants) await query(client, sql)
        report.runtimeRole = runtimeRole
        report.runtimeGrants = grants
        report.applied = true
        await query(client, `insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), null, $2::jsonb)
            on conflict(id) do update set applied_at = excluded.applied_at, rolled_back_at = null, details = excluded.details`,
        [COMMERCIAL_CONTACT_MIGRATION_ID, JSON.stringify(report)])
        return report
    } finally {
        try { await query(client, `select pg_advisory_unlock(hashtext($1))`, [COMMERCIAL_CONTACT_MIGRATION_ID]) } catch { /* best effort */ }
        client.release()
    }
}

export async function rollbackCommercialContactMigration({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL }) {
    if (!pool) throw migrationError('COMMERCIAL_CONTACT_MIGRATION_POOL_REQUIRED')
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('COMMERCIAL_CONTACT_MIGRATION_DESTINATION_UNSAFE')
    const client = await pool.connect()
    try {
        await query(client, `set lock_timeout = '3s'`)
        await query(client, `select pg_advisory_lock(hashtext($1))`, [COMMERCIAL_CONTACT_MIGRATION_ID])
        await assertLocalDestination(client, databaseUrl, target)
        await query(client, `drop index concurrently if exists crm_atendimento.crm_atendimento_commercial_contact_permission_events_identity_idx`)
        await query(client, `drop index concurrently if exists crm_atendimento.crm_atendimento_commercial_contact_permissions_status_idx`)
        await query(client, `insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), now(), '{"rollback":"non-destructive"}'::jsonb)
            on conflict(id) do update set rolled_back_at = now()`, [COMMERCIAL_CONTACT_MIGRATION_ID])
        return { id: COMMERCIAL_CONTACT_MIGRATION_ID, rolledBack: true, destructive: false }
    } finally {
        try { await query(client, `select pg_advisory_unlock(hashtext($1))`, [COMMERCIAL_CONTACT_MIGRATION_ID]) } catch { /* best effort */ }
        client.release()
    }
}
