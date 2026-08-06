import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
    assertAtendimentoMigrationDestination,
    isStrictAtendimentoMigrationDestination,
    ATENDIMENTO_MIGRATION_TARGETS,
} from './migrationDestination.js'

export const COMMERCIAL_CANARY_MIGRATION_ID = '20260806_commercial_canary_identity_selector_v1'
export const COMMERCIAL_CANARY_MIGRATION_ACTIONS = Object.freeze(['--apply', '--rollback'])

const HERE = dirname(fileURLToPath(import.meta.url))
const UP_FILE = resolve(HERE, 'migrations/20260806_commercial_canary_identity_selector_v1.up.sql')

const RUNTIME_ROLES = Object.freeze({
    [ATENDIMENTO_MIGRATION_TARGETS.LOCAL]: 'skincos',
    [ATENDIMENTO_MIGRATION_TARGETS.STAGING]: 'skincos_staging_crm_app',
})

function migrationError(code) {
    const error = new Error(code)
    error.code = code
    return error
}

export function parseCommercialCanaryMigrationAction(args = []) {
    const values = Array.isArray(args) ? args.map(String) : []
    if (values.length !== 1 || !COMMERCIAL_CANARY_MIGRATION_ACTIONS.includes(values[0])) {
        const error = migrationError('COMMERCIAL_CANARY_MIGRATION_ACTION_INVALID')
        error.message = 'Use exatamente uma ação: --apply ou --rollback.'
        throw error
    }
    return values[0] === '--apply' ? 'apply' : 'rollback'
}

async function ensureRegistry(client) {
    await client.query(`create schema if not exists crm_atendimento`)
    await client.query(`create table if not exists crm_atendimento.schema_migrations (
        id text primary key, applied_at timestamptz not null default now(), rolled_back_at timestamptz,
        details jsonb not null default '{}'::jsonb
    )`)
}

async function assertPrerequisites(client) {
    const result = await client.query(`select
        to_regclass('crm_atendimento.global_client_identities') as identities,
        to_regclass('crm_atendimento.global_client_identity_members') as members,
        to_regclass('crm_atendimento.commercial_policy_config') as policy`)
    const row = result.rows[0] || {}
    if (!row.identities || !row.members || !row.policy) throw migrationError('COMMERCIAL_CANARY_MIGRATION_PREREQUISITES_MISSING')
}

async function assertDestination(client, databaseUrl, target) {
    if (!RUNTIME_ROLES[target] || !isStrictAtendimentoMigrationDestination(databaseUrl, target)) {
        throw migrationError('COMMERCIAL_CANARY_MIGRATION_DESTINATION_UNSAFE')
    }
    try {
        await assertAtendimentoMigrationDestination(client, databaseUrl, target)
    } catch {
        throw migrationError('COMMERCIAL_CANARY_MIGRATION_DESTINATION_UNSAFE')
    }
}

async function grantRuntimeAccess(client, target) {
    const role = RUNTIME_ROLES[target]
    const statements = [
        `grant usage on schema crm_atendimento to ${role}`,
        `grant select, insert, update on table crm_atendimento.commercial_canary_cohorts to ${role}`,
        `grant select, insert on table crm_atendimento.commercial_canary_cohort_members to ${role}`,
        `grant select, insert, update on table crm_atendimento.commercial_canary_identity_validations to ${role}`,
        `grant select, insert on table crm_atendimento.commercial_canary_events to ${role}`,
        `grant select, insert on table crm_atendimento.commercial_canary_validation_events to ${role}`,
        `grant usage, select on sequence crm_atendimento.commercial_canary_events_event_order_seq to ${role}`,
        `grant usage, select on sequence crm_atendimento.commercial_canary_validation_events_event_order_seq to ${role}`,
    ]
    for (const sql of statements) await client.query(sql)
    return { role, statements }
}

export function commercialCanaryMigrationPlan() {
    return {
        id: COMMERCIAL_CANARY_MIGRATION_ID,
        adds: [
            'commercial_canary_cohorts',
            'commercial_canary_cohort_members',
            'commercial_canary_identity_validations',
            'commercial_canary_events',
            'commercial_canary_validation_events',
        ],
        authority: 'The active cohort snapshot is the selector authority. The legacy UUID array is not written by this flow and remains only as a compatibility read for pre-migration runtimes.',
        audit: 'Cohort, removal, rollback, emergency-off and identity validation transitions are append-only events with idempotency keys. Event payloads are aggregate-only and reject PII keys.',
        rollback: 'Non-destructive: preserves cohort and validation evidence and records the migration rollback in schema_migrations.',
        runtimeRole: 'The application receives only the minimum SELECT/INSERT/UPDATE privileges required for the selector; DDL remains migration-role-only.',
    }
}

export async function applyCommercialCanaryMigration({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL }) {
    if (!pool) throw migrationError('COMMERCIAL_CANARY_MIGRATION_POOL_REQUIRED')
    const client = await pool.connect()
    const report = { id: COMMERCIAL_CANARY_MIGRATION_ID, applied: false, tables: commercialCanaryMigrationPlan().adds }
    try {
        await client.query(`set lock_timeout = '3s'`)
        await client.query(`set statement_timeout = '60s'`)
        await client.query('begin')
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [COMMERCIAL_CANARY_MIGRATION_ID])
        await assertDestination(client, databaseUrl, target)
        await assertPrerequisites(client)
        await ensureRegistry(client)
        const sql = await readFile(UP_FILE, 'utf8')
        await client.query(sql)
        const grants = await grantRuntimeAccess(client, target)
        await client.query(`insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), null, $2::jsonb)
            on conflict(id) do update set applied_at=excluded.applied_at, rolled_back_at=null, details=excluded.details`,
        [COMMERCIAL_CANARY_MIGRATION_ID, JSON.stringify({ ...commercialCanaryMigrationPlan(), grants })])
        await client.query('commit')
        report.applied = true
        report.runtimeRole = grants.role
        report.runtimeGrants = grants.statements
        return report
    } catch (error) {
        try { await client.query('rollback') } catch { /* preserve original failure */ }
        throw error
    } finally {
        client.release()
    }
}

export async function rollbackCommercialCanaryMigration({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL }) {
    if (!pool) throw migrationError('COMMERCIAL_CANARY_MIGRATION_POOL_REQUIRED')
    const client = await pool.connect()
    try {
        await client.query('begin')
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [COMMERCIAL_CANARY_MIGRATION_ID])
        await assertDestination(client, databaseUrl, target)
        await ensureRegistry(client)
        await client.query(`insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), now(), $2::jsonb)
            on conflict(id) do update set rolled_back_at=now(), details=excluded.details`,
        [COMMERCIAL_CANARY_MIGRATION_ID, JSON.stringify({ ...commercialCanaryMigrationPlan(), rolledBack: true })])
        await client.query('commit')
        return { id: COMMERCIAL_CANARY_MIGRATION_ID, rolledBack: true, nonDestructive: true }
    } catch (error) {
        try { await client.query('rollback') } catch { /* preserve original failure */ }
        throw error
    } finally {
        client.release()
    }
}
