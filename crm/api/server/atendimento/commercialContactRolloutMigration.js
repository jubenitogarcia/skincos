import { isStrictLocalMirrorDestination } from './mirror.js'

export const COMMERCIAL_CONTACT_ROLLOUT_MIGRATION_ID = '20260804_commercial_contact_rollout_v1'
const CONTACTED_INDEX_NAME = 'crm_atendimento_commercial_actions_contacted_idx'
const CONTACTED_INDEX_REGCLASS = `crm_atendimento.${CONTACTED_INDEX_NAME}`
// Only `contacted` is explicit, auditable evidence of an outbound contact.
// Other lifecycle states can be reached by an inbound interaction, so turning
// them into contact timestamps would create false commercial attribution.
const LEGACY_CONTACT_STATUSES = ['contacted']

const ROLLOUT_STATEMENTS = [
    `alter table crm_atendimento.commercial_actions add column if not exists contacted_at timestamptz`,
    `alter table crm_atendimento.commercial_policy_config
        add column if not exists commercial_contact_writes_enabled boolean not null default false`,
    `alter table crm_atendimento.commercial_policy_config
        add column if not exists commercial_contact_canary_identity_ids uuid[] not null default '{}'::uuid[]`,
]

const INDEXES = [
    `create index concurrently if not exists ${CONTACTED_INDEX_NAME}
        on crm_atendimento.commercial_actions(identity_id, contacted_at desc)
        where contacted_at is not null`,
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
    if (!isStrictLocalMirrorDestination(databaseUrl)) throw migrationError('COMMERCIAL_CONTACT_ROLLOUT_MIGRATION_DESTINATION_UNSAFE')
    const result = await query(client, `select current_database() as database_name, current_user as database_user,
        current_setting('transaction_read_only') as read_only`)
    const row = result.rows[0] || {}
    if (row.database_name !== 'skincos_crm_local' || row.database_user !== 'admin' || String(row.read_only).toLowerCase() === 'on') {
        throw migrationError('COMMERCIAL_CONTACT_ROLLOUT_MIGRATION_DESTINATION_UNSAFE')
    }
}

async function assertPrerequisites(client) {
    const result = await query(client, `select to_regclass('crm_atendimento.commercial_actions') as actions,
        to_regclass('crm_atendimento.commercial_policy_config') as policy,
        to_regclass('crm_atendimento.commercial_contact_permissions') as permissions,
        to_regclass('crm_atendimento.commercial_contact_permission_events') as permission_events`)
    if (!Object.values(result.rows[0] || {}).every(Boolean)) {
        throw migrationError('COMMERCIAL_CONTACT_ROLLOUT_MIGRATION_PREREQUISITES_MISSING')
    }
}

async function ensureRegistry(client) {
    await query(client, `create schema if not exists crm_atendimento`)
    await query(client, `create table if not exists crm_atendimento.schema_migrations (
        id text primary key, applied_at timestamptz not null default now(), rolled_back_at timestamptz,
        details jsonb not null default '{}'::jsonb
    )`)
}

async function backfillLegacyContactTimestamps(client) {
    // Preserve only existing, explicit contact events. The original lifecycle
    // timestamp is used instead of `now()` so cooldown and metrics retain their
    // real temporal meaning; the registry stores only the aggregate count.
    const result = await query(client, `with updated as (
        update crm_atendimento.commercial_actions
           set contacted_at = coalesce(completed_at, updated_at, created_at)
         where contacted_at is null
           and status = any($1::text[])
         returning id
    ) select count(*)::int as count from updated`, [LEGACY_CONTACT_STATUSES])
    return Number(result.rows[0]?.count || 0)
}

async function contactedIndexStatus(client) {
    const result = await query(client, `select index_meta.indisvalid as valid, index_meta.indisready as ready
        from pg_index index_meta
        where index_meta.indexrelid = to_regclass($1)`, [CONTACTED_INDEX_REGCLASS])
    return result.rows[0] || null
}

async function ensureContactedIndex(client) {
    const existing = await contactedIndexStatus(client)
    if (existing && (existing.valid !== true || existing.ready !== true)) {
        await query(client, `drop index concurrently if exists ${CONTACTED_INDEX_REGCLASS}`)
    }
    await query(client, INDEXES[0])
    const verified = await contactedIndexStatus(client)
    if (!verified || verified.valid !== true || verified.ready !== true) {
        throw migrationError('COMMERCIAL_CONTACT_ROLLOUT_MIGRATION_INDEX_INVALID')
    }
}

export function commercialContactRolloutMigrationPlan() {
    return {
        id: COMMERCIAL_CONTACT_ROLLOUT_MIGRATION_ID,
        adds: ['commercial_actions.contacted_at', 'commercial_policy_config.commercial_contact_writes_enabled', 'commercial_policy_config.commercial_contact_canary_identity_ids'],
        indexes: [...INDEXES],
        legacyContactBackfill: 'Only actions explicitly marked contacted receive contacted_at from their existing lifecycle timestamps.',
        defaultRollout: 'disabled with an empty canary identity allowlist',
        rollback: 'Non-destructive: retains contact timestamps, disables writes and clears the canary allowlist, removes only lookup indexes and marks the migration rolled back.',
    }
}

export async function applyCommercialContactRolloutMigration({ pool, databaseUrl }) {
    if (!pool) throw migrationError('COMMERCIAL_CONTACT_ROLLOUT_MIGRATION_POOL_REQUIRED')
    if (!isStrictLocalMirrorDestination(databaseUrl)) {
        throw migrationError('COMMERCIAL_CONTACT_ROLLOUT_MIGRATION_DESTINATION_UNSAFE')
    }
    const client = await pool.connect()
    const report = { id: COMMERCIAL_CONTACT_ROLLOUT_MIGRATION_ID, applied: false, indexes: [], legacyContactRowsBackfilled: 0 }
    try {
        await query(client, `set lock_timeout = '3s'`)
        await query(client, `set statement_timeout = '60s'`)
        await query(client, `select pg_advisory_lock(hashtext($1))`, [COMMERCIAL_CONTACT_ROLLOUT_MIGRATION_ID])
        await assertLocalDestination(client, databaseUrl)
        await assertPrerequisites(client)
        await ensureRegistry(client)
        for (const sql of ROLLOUT_STATEMENTS) await query(client, sql)
        report.legacyContactRowsBackfilled = await backfillLegacyContactTimestamps(client)
        await ensureContactedIndex(client)
        report.indexes.push(CONTACTED_INDEX_NAME)
        report.applied = true
        await query(client, `insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), null, $2::jsonb)
            on conflict(id) do update set applied_at = excluded.applied_at, rolled_back_at = null, details = excluded.details`,
        [COMMERCIAL_CONTACT_ROLLOUT_MIGRATION_ID, JSON.stringify(report)])
        return report
    } finally {
        try { await query(client, `select pg_advisory_unlock(hashtext($1))`, [COMMERCIAL_CONTACT_ROLLOUT_MIGRATION_ID]) } catch { /* best effort */ }
        client.release()
    }
}

export async function rollbackCommercialContactRolloutMigration({ pool, databaseUrl }) {
    if (!pool) throw migrationError('COMMERCIAL_CONTACT_ROLLOUT_MIGRATION_POOL_REQUIRED')
    if (!isStrictLocalMirrorDestination(databaseUrl)) {
        throw migrationError('COMMERCIAL_CONTACT_ROLLOUT_MIGRATION_DESTINATION_UNSAFE')
    }
    const client = await pool.connect()
    try {
        await query(client, `set lock_timeout = '3s'`)
        await query(client, `select pg_advisory_lock(hashtext($1))`, [COMMERCIAL_CONTACT_ROLLOUT_MIGRATION_ID])
        await assertLocalDestination(client, databaseUrl)
        await query(client, `update crm_atendimento.commercial_policy_config
            set commercial_contact_writes_enabled = false,
                commercial_contact_canary_identity_ids = '{}'::uuid[],
                updated_by = 'commercial-contact-rollout-rollback',
                updated_at = now()
            where singleton = true`)
        await query(client, `drop index concurrently if exists ${CONTACTED_INDEX_REGCLASS}`)
        await query(client, `insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), now(), '{"rollback":"non-destructive","writesDisabled":true}'::jsonb)
            on conflict(id) do update set rolled_back_at = now()`, [COMMERCIAL_CONTACT_ROLLOUT_MIGRATION_ID])
        return { id: COMMERCIAL_CONTACT_ROLLOUT_MIGRATION_ID, rolledBack: true, destructive: false, writesDisabled: true }
    } finally {
        try { await query(client, `select pg_advisory_unlock(hashtext($1))`, [COMMERCIAL_CONTACT_ROLLOUT_MIGRATION_ID]) } catch { /* best effort */ }
        client.release()
    }
}
