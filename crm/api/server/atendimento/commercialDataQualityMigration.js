import { isStrictLocalMirrorDestination } from './mirror.js'

export const COMMERCIAL_DATA_QUALITY_MIGRATION_ID = '20260805_commercial_data_quality_queue_v1'
export const COMMERCIAL_DATA_QUALITY_MIGRATION_ACTIONS = Object.freeze(['--apply', '--rollback'])

const COMMERCIAL_DATA_QUALITY_FINDINGS_QUEUE_INDEX = 'crm_atendimento_commercial_data_quality_findings_queue_idx'
const COMMERCIAL_DATA_QUALITY_EVENTS_FINDING_INDEX = 'crm_atendimento_commercial_data_quality_events_finding_idx'

const PREREQUISITE_RELATIONS = [
    'crm_atendimento.canonical_clients',
    'crm_atendimento.attendance_client_links',
    'crm_atendimento.attendances',
    'crm_atendimento.global_client_identities',
    'crm_atendimento.global_client_identity_members',
    'crm_atendimento.client_merge_suggestions',
    'crm_atendimento.client_caixa_links',
    'crm_atendimento.app_registration_attendance_links',
    'crm_atendimento.app_registration_caixa_links',
    'crm_atendimento.supplemental_lead_profile_app_links',
    'crm_atendimento.supplemental_lead_profile_caixa_links',
    'crm_atendimento.local_mirror_state',
    'crm_atendimento.import_batches',
    'crm_atendimento.commercial_actions',
    'crm_atendimento.commercial_contact_permissions',
    'crm_atendimento.commercial_contact_permission_events',
    'crm_atendimento.commercial_policy_config',
    'crm_caixa.sale_items',
]

const STATEMENTS = [
    `create extension if not exists pgcrypto`,
    `create table if not exists crm_atendimento.commercial_data_quality_findings (
        id uuid primary key default gen_random_uuid(),
        finding_key text not null unique check (finding_key ~ '^[a-z][a-z0-9_.-]{2,120}$'),
        severity text not null check (severity in ('critical','high','medium','low')),
        status text not null check (status in ('open','acknowledged','in_progress','resolved','suppressed')),
        owner text,
        observed_count integer not null default 0 check (observed_count >= 0),
        metrics jsonb not null default '{}'::jsonb,
        sla_due_at timestamptz,
        first_detected_at timestamptz,
        last_observed_at timestamptz,
        last_evaluated_at timestamptz not null default now(),
        acknowledged_at timestamptz,
        resolved_at timestamptz,
        revision integer not null default 1 check (revision >= 1),
        created_by text not null,
        updated_by text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
    )`,
    `create table if not exists crm_atendimento.commercial_data_quality_finding_events (
        id uuid primary key default gen_random_uuid(),
        event_order bigint generated always as identity,
        finding_id uuid not null references crm_atendimento.commercial_data_quality_findings(id) on delete restrict,
        event_type text not null check (event_type in ('detected','observed','cleared','reopened','assignment_changed','status_changed')),
        previous_status text check (previous_status in ('open','acknowledged','in_progress','resolved','suppressed')),
        status text not null check (status in ('open','acknowledged','in_progress','resolved','suppressed')),
        previous_owner text,
        owner text,
        observed_count integer not null check (observed_count >= 0),
        actor text not null,
        created_at timestamptz not null default now()
    )`,
    `create or replace function crm_atendimento.prevent_commercial_data_quality_event_mutation()
        returns trigger language plpgsql as $$
        begin
            raise exception 'commercial data quality event evidence is append-only';
        end $$`,
    `drop trigger if exists commercial_data_quality_finding_events_immutable
        on crm_atendimento.commercial_data_quality_finding_events`,
    `create trigger commercial_data_quality_finding_events_immutable
        before update or delete on crm_atendimento.commercial_data_quality_finding_events
        for each row execute function crm_atendimento.prevent_commercial_data_quality_event_mutation()`,
    `drop trigger if exists commercial_data_quality_finding_events_no_truncate
        on crm_atendimento.commercial_data_quality_finding_events`,
    `create trigger commercial_data_quality_finding_events_no_truncate
        before truncate on crm_atendimento.commercial_data_quality_finding_events
        for each statement execute function crm_atendimento.prevent_commercial_data_quality_event_mutation()`,
]

export const COMMERCIAL_DATA_QUALITY_INDEXES = Object.freeze([
    Object.freeze({
        name: COMMERCIAL_DATA_QUALITY_FINDINGS_QUEUE_INDEX,
        qualifiedName: `crm_atendimento.${COMMERCIAL_DATA_QUALITY_FINDINGS_QUEUE_INDEX}`,
        // PostgreSQL derives an index schema from its table and therefore does
        // not accept a schema-qualified index name in CREATE INDEX.
        createSql: `create index concurrently if not exists ${COMMERCIAL_DATA_QUALITY_FINDINGS_QUEUE_INDEX}
            on crm_atendimento.commercial_data_quality_findings(status, severity, sla_due_at, updated_at desc)`,
        dropSql: `drop index concurrently if exists crm_atendimento.${COMMERCIAL_DATA_QUALITY_FINDINGS_QUEUE_INDEX}`,
    }),
    Object.freeze({
        name: COMMERCIAL_DATA_QUALITY_EVENTS_FINDING_INDEX,
        qualifiedName: `crm_atendimento.${COMMERCIAL_DATA_QUALITY_EVENTS_FINDING_INDEX}`,
        createSql: `create index concurrently if not exists ${COMMERCIAL_DATA_QUALITY_EVENTS_FINDING_INDEX}
            on crm_atendimento.commercial_data_quality_finding_events(finding_id, event_order desc)`,
        dropSql: `drop index concurrently if exists crm_atendimento.${COMMERCIAL_DATA_QUALITY_EVENTS_FINDING_INDEX}`,
    }),
])

function migrationError(code) {
    const error = new Error(code)
    error.code = code
    return error
}

export function parseCommercialDataQualityMigrationAction(args = []) {
    const values = Array.isArray(args) ? args.map((value) => String(value)) : []
    if (values.length !== 1 || !COMMERCIAL_DATA_QUALITY_MIGRATION_ACTIONS.includes(values[0])) {
        const error = migrationError('COMMERCIAL_DATA_QUALITY_MIGRATION_ACTION_INVALID')
        error.message = 'Use exatamente uma ação: --apply ou --rollback.'
        throw error
    }
    return values[0] === '--apply' ? 'apply' : 'rollback'
}

async function query(client, sql, params = []) {
    return client.query(sql, params)
}

async function assertLocalDestination(client, databaseUrl) {
    if (!isStrictLocalMirrorDestination(databaseUrl)) {
        throw migrationError('COMMERCIAL_DATA_QUALITY_MIGRATION_DESTINATION_UNSAFE')
    }
    const result = await query(client, `select current_database() as database_name, current_user as database_user,
        current_setting('transaction_read_only') as read_only`)
    const row = result.rows[0] || {}
    if (row.database_name !== 'skincos_crm_local' || row.database_user !== 'admin' || String(row.read_only).toLowerCase() === 'on') {
        throw migrationError('COMMERCIAL_DATA_QUALITY_MIGRATION_DESTINATION_UNSAFE')
    }
}

async function assertPrerequisites(client) {
    const columns = PREREQUISITE_RELATIONS
        .map((relation, index) => `to_regclass('${relation}') as relation_${index}`)
        .join(',\n')
    const result = await query(client, `select ${columns}`)
    if (!Object.values(result.rows[0] || {}).every(Boolean)) {
        throw migrationError('COMMERCIAL_DATA_QUALITY_MIGRATION_PREREQUISITES_MISSING')
    }
}

async function ensureRegistry(client) {
    await query(client, `create schema if not exists crm_atendimento`)
    await query(client, `create table if not exists crm_atendimento.schema_migrations (
        id text primary key, applied_at timestamptz not null default now(), rolled_back_at timestamptz,
        details jsonb not null default '{}'::jsonb
    )`)
}

async function readIndexValidity(client, qualifiedName) {
    const result = await query(client, `select index_row.indisvalid
        from pg_catalog.pg_index index_row
        where index_row.indexrelid = to_regclass($1)`, [qualifiedName])
    if (!result.rows[0]) return null
    return result.rows[0].indisvalid === true
}

async function ensureCommercialDataQualityIndex(client, index, report) {
    const before = await readIndexValidity(client, index.qualifiedName)
    if (before === false) {
        await query(client, index.dropSql)
        report.repairedIndexes.push(index.name)
    }
    await query(client, index.createSql)
    if (await readIndexValidity(client, index.qualifiedName) !== true) {
        const error = migrationError('COMMERCIAL_DATA_QUALITY_MIGRATION_INDEX_INVALID')
        error.indexName = index.name
        throw error
    }
    report.indexes.push(index.name)
}

export function commercialDataQualityMigrationPlan() {
    return {
        id: COMMERCIAL_DATA_QUALITY_MIGRATION_ID,
        adds: ['commercial_data_quality_findings', 'commercial_data_quality_finding_events'],
        queuePolicy: 'The queue stores aggregate counts and allowlisted freshness metrics only. It never stores client names, phones, email addresses, source paths, raw evidence or source identifiers.',
        auditPolicy: 'Current finding state is mutable with optimistic revision checks; every detection, recurrence, owner and status transition is appended to an immutable event ledger.',
        rollback: 'Non-destructive: retains findings and event evidence, then records the migration as rolled back.',
    }
}

export async function applyCommercialDataQualityMigration({ pool, databaseUrl }) {
    if (!pool) throw migrationError('COMMERCIAL_DATA_QUALITY_MIGRATION_POOL_REQUIRED')
    if (!isStrictLocalMirrorDestination(databaseUrl)) {
        throw migrationError('COMMERCIAL_DATA_QUALITY_MIGRATION_DESTINATION_UNSAFE')
    }
    const client = await pool.connect()
    const report = {
        id: COMMERCIAL_DATA_QUALITY_MIGRATION_ID,
        applied: false,
        tables: ['commercial_data_quality_findings', 'commercial_data_quality_finding_events'],
        indexes: [],
        repairedIndexes: [],
        appendOnlyTables: ['commercial_data_quality_finding_events'],
    }
    try {
        await query(client, `set lock_timeout = '3s'`)
        await query(client, `set statement_timeout = '60s'`)
        await query(client, `select pg_advisory_lock(hashtext($1))`, [COMMERCIAL_DATA_QUALITY_MIGRATION_ID])
        await assertLocalDestination(client, databaseUrl)
        await assertPrerequisites(client)
        await ensureRegistry(client)
        for (const sql of STATEMENTS) await query(client, sql)
        for (const index of COMMERCIAL_DATA_QUALITY_INDEXES) await ensureCommercialDataQualityIndex(client, index, report)
        report.applied = true
        await query(client, `insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), null, $2::jsonb)
            on conflict(id) do update set applied_at = excluded.applied_at, rolled_back_at = null, details = excluded.details`,
        [COMMERCIAL_DATA_QUALITY_MIGRATION_ID, JSON.stringify(report)])
        return report
    } finally {
        try {
            await query(client, `select pg_advisory_unlock(hashtext($1))`, [COMMERCIAL_DATA_QUALITY_MIGRATION_ID])
        } catch {
            // The connection may already be unusable; preserve the original error.
        }
        client.release()
    }
}

export async function rollbackCommercialDataQualityMigration({ pool, databaseUrl }) {
    if (!pool) throw migrationError('COMMERCIAL_DATA_QUALITY_MIGRATION_POOL_REQUIRED')
    if (!isStrictLocalMirrorDestination(databaseUrl)) {
        throw migrationError('COMMERCIAL_DATA_QUALITY_MIGRATION_DESTINATION_UNSAFE')
    }
    const client = await pool.connect()
    try {
        await query(client, `set lock_timeout = '3s'`)
        await query(client, `select pg_advisory_lock(hashtext($1))`, [COMMERCIAL_DATA_QUALITY_MIGRATION_ID])
        await assertLocalDestination(client, databaseUrl)
        await ensureRegistry(client)
        await query(client, `insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), now(), '{"rollback":"non-destructive","evidenceRetained":true}'::jsonb)
            on conflict(id) do update set rolled_back_at = now(), details = excluded.details`,
        [COMMERCIAL_DATA_QUALITY_MIGRATION_ID])
        return {
            id: COMMERCIAL_DATA_QUALITY_MIGRATION_ID,
            rolledBack: true,
            destructive: false,
            evidenceRetained: true,
        }
    } finally {
        try {
            await query(client, `select pg_advisory_unlock(hashtext($1))`, [COMMERCIAL_DATA_QUALITY_MIGRATION_ID])
        } catch {
            // The connection may already be unusable; preserve the original error.
        }
        client.release()
    }
}
