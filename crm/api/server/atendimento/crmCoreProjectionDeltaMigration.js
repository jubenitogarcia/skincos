import {
    assertAtendimentoMigrationDestination,
    isStrictAtendimentoMigrationDestination,
    ATENDIMENTO_MIGRATION_TARGETS,
} from './migrationDestination.js'
import {
    assertAtendimentoProjectionMembershipRow,
    reconcileAtendimentoProjectionMembershipRows,
    CRM_CORE_PROJECTION_DELTA_OPERATION_REVOKE,
} from './crmCoreProjectionDelta.js'

export const CRM_CORE_PROJECTION_DELTA_MIGRATION_ID = '20260908_crm_core_projection_delta_v1'
export const CRM_CORE_PROJECTION_MEMBERSHIP_RELATION = 'crm_atendimento.crm_core_projection_memberships'
export const CRM_CORE_PROJECTION_OUTBOX_RELATION = 'crm_atendimento.crm_core_projection_outbox'

const RUNTIME_ROLES = Object.freeze({
    [ATENDIMENTO_MIGRATION_TARGETS.LOCAL]: 'skincos',
    [ATENDIMENTO_MIGRATION_TARGETS.STAGING]: 'skincos_staging_crm_app',
    [ATENDIMENTO_MIGRATION_TARGETS.PRODUCTION]: 'crm_core_projection_exporter',
})

const PREREQUISITE_RELATIONS = Object.freeze([
    'crm_atendimento.global_client_identities',
    'crm_atendimento.global_client_identity_members',
    'crm_atendimento.units',
    'crm_atendimento.attendances',
    'crm_atendimento.attendance_client_links',
    'crm_caixa.sales',
    'crm_atendimento.app_client_registrations',
    'crm_atendimento.supplemental_lead_profiles',
])

const UNIT_SLUG_SQL_PATTERN = "^(?!all$|unknown$)[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$"
const UUID_TEXT_PATTERN = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
const READ_ONLY_SQL_FORBIDDEN = /\b(?:alter|call|copy|create|delete|drop|grant|insert|merge|offset|revoke|truncate|update|vacuum)\b/i

/**
 * Canonical membership rule owned by Atendimento.  It deliberately selects
 * only identity UUID, canonical unit slug and an observed timestamp.  The
 * source is used by the reconciler inside a repeatable-read transaction and
 * never emits customer attributes.
 */
export const ATENDIMENTO_PROJECTION_MEMBERSHIP_SOURCE_SQL = `WITH unit_membership_evidence AS (
    SELECT member.identity_id AS identity_id,
        unit.slug AS unit_slug,
        GREATEST(
            member.updated_at,
            COALESCE(attendance_link.updated_at, attendance_link.created_at, member.updated_at),
            COALESCE(attendance.updated_at, attendance.created_at, member.updated_at)
        ) AS observed_at
      FROM crm_atendimento.global_client_identity_members member
      JOIN crm_atendimento.attendance_client_links attendance_link
        ON attendance_link.client_id = CASE
            WHEN member.source_id ~ '${UUID_TEXT_PATTERN}' THEN member.source_id::uuid
            ELSE NULL
        END
      JOIN crm_atendimento.attendances attendance
        ON attendance.id = attendance_link.attendance_id
      JOIN crm_atendimento.units unit ON unit.id = attendance.unit_id
     WHERE member.source_type = 'attendance_client'
       AND member.source_id ~ '${UUID_TEXT_PATTERN}'
       AND attendance.deleted_at IS NULL

    UNION ALL

    SELECT member.identity_id AS identity_id,
        unit.slug AS unit_slug,
        GREATEST(member.updated_at, COALESCE(sale.updated_at, sale.created_at, member.updated_at)) AS observed_at
      FROM crm_atendimento.global_client_identity_members member
      JOIN crm_caixa.sales sale ON sale.customer_id = CASE
          WHEN member.source_id ~ '${UUID_TEXT_PATTERN}' THEN member.source_id::uuid
          ELSE NULL
      END
      JOIN crm_atendimento.units unit ON unit.id = sale.unit_id
     WHERE member.source_type = 'caixa_customer'
       AND member.source_id ~ '${UUID_TEXT_PATTERN}'

    UNION ALL

    SELECT member.identity_id AS identity_id,
        unit.slug AS unit_slug,
        GREATEST(member.updated_at, registration.updated_at, member.updated_at) AS observed_at
      FROM crm_atendimento.global_client_identity_members member
      JOIN crm_atendimento.app_client_registrations registration
        ON registration.source_client_id = member.source_id
      JOIN LATERAL jsonb_array_elements_text(COALESCE(registration.unit_slugs, '[]'::jsonb)) scope(slug)
        ON TRUE
      JOIN crm_atendimento.units unit ON unit.slug = scope.slug
     WHERE member.source_type = 'app_registration'

    UNION ALL

    SELECT member.identity_id AS identity_id,
        unit.slug AS unit_slug,
        GREATEST(member.updated_at, lead.updated_at, member.updated_at) AS observed_at
      FROM crm_atendimento.global_client_identity_members member
      JOIN crm_atendimento.supplemental_lead_profiles lead
        ON lead.source_profile_id = member.source_id
      JOIN LATERAL jsonb_array_elements_text(COALESCE(lead.unit_slugs, '[]'::jsonb)) scope(slug)
        ON TRUE
      JOIN crm_atendimento.units unit ON unit.slug = scope.slug
     WHERE member.source_type = 'lead_profile'
), canonical_memberships AS (
    SELECT identity_id AS identity_id, unit_slug AS unit_slug, max(observed_at) AS observed_at
      FROM unit_membership_evidence
     GROUP BY identity_id, unit_slug
)
SELECT identity_id AS identity_id, unit_slug AS unit_slug, observed_at AS observed_at
  FROM canonical_memberships`

const STATEMENTS = Object.freeze([
    `create schema if not exists crm_atendimento`,
    `create extension if not exists pgcrypto`,
    `create table if not exists ${CRM_CORE_PROJECTION_MEMBERSHIP_RELATION} (
        identity_id uuid not null references crm_atendimento.global_client_identities(id) on delete restrict,
        unit_slug text not null check (unit_slug = lower(unit_slug) and unit_slug ~ '${UNIT_SLUG_SQL_PATTERN}'),
        active boolean not null,
        revision bigint not null default 1 check (revision >= 1),
        observed_at timestamptz not null,
        updated_at timestamptz not null default now(),
        primary key (identity_id, unit_slug)
    )`,
    `create table if not exists ${CRM_CORE_PROJECTION_OUTBOX_RELATION} (
        -- Identity values are monotonic but may be sparse after a rolled-back writer transaction.
        event_order bigint generated always as identity primary key,
        event_id uuid not null default gen_random_uuid() unique,
        identity_id uuid not null references crm_atendimento.global_client_identities(id) on delete restrict,
        unit_slug text not null check (unit_slug = lower(unit_slug) and unit_slug ~ '${UNIT_SLUG_SQL_PATTERN}'),
        revision bigint not null check (revision >= 1),
        operation text not null check (operation in ('upsert', 'revoke')),
        occurred_at timestamptz not null,
        created_at timestamptz not null default now()
    )`,
    `create index if not exists crm_core_projection_memberships_active_idx
        on ${CRM_CORE_PROJECTION_MEMBERSHIP_RELATION}(unit_slug, identity_id)
        where active`,
    `create index if not exists crm_core_projection_outbox_identity_unit_order_idx
        on ${CRM_CORE_PROJECTION_OUTBOX_RELATION}(identity_id, unit_slug, event_order)`,
    `create index if not exists crm_core_projection_outbox_order_idx
        on ${CRM_CORE_PROJECTION_OUTBOX_RELATION}(event_order)`,
    `create or replace function crm_atendimento.prevent_crm_core_projection_outbox_mutation()
        returns trigger language plpgsql as $$
        begin
            raise exception 'crm core projection outbox is append-only';
        end $$`,
    `drop trigger if exists crm_core_projection_outbox_immutable on ${CRM_CORE_PROJECTION_OUTBOX_RELATION}`,
    `create trigger crm_core_projection_outbox_immutable
        before update or delete on ${CRM_CORE_PROJECTION_OUTBOX_RELATION}
        for each row execute function crm_atendimento.prevent_crm_core_projection_outbox_mutation()`,
    `drop trigger if exists crm_core_projection_outbox_no_truncate on ${CRM_CORE_PROJECTION_OUTBOX_RELATION}`,
    `create trigger crm_core_projection_outbox_no_truncate
        before truncate on ${CRM_CORE_PROJECTION_OUTBOX_RELATION}
        for each statement execute function crm_atendimento.prevent_crm_core_projection_outbox_mutation()`,
])

function migrationError(code) {
    const error = new Error(code)
    error.code = code
    return error
}

function readOnlySourceSql(value) {
    const sql = String(value || '').trim()
    if (!sql || sql.length > 64 * 1024 || sql.includes(';') || READ_ONLY_SQL_FORBIDDEN.test(sql) || !/^(?:select|with)\b/i.test(sql)) {
        throw migrationError('CRM_CORE_PROJECTION_DELTA_SOURCE_SQL_UNSAFE')
    }
    for (const alias of ['identity_id', 'unit_slug', 'observed_at']) {
        if (!new RegExp(`\\bas\\s+(?:"${alias}"|${alias})\\b`, 'i').test(sql)) {
            throw migrationError('CRM_CORE_PROJECTION_DELTA_SOURCE_SQL_UNSAFE')
        }
    }
    return sql
}

async function ensureRegistry(client) {
    await client.query(`create schema if not exists crm_atendimento`)
    await client.query(`create table if not exists crm_atendimento.schema_migrations (
        id text primary key, applied_at timestamptz not null default now(), rolled_back_at timestamptz,
        details jsonb not null default '{}'::jsonb
    )`)
}

async function assertPrerequisites(client) {
    const projection = PREREQUISITE_RELATIONS
        .map((relation, index) => `to_regclass('${relation}') is not null as relation_${index}`)
        .join(', ')
    const result = await client.query(`select ${projection}`)
    if (!Object.values(result.rows[0] || {}).every(Boolean)) {
        throw migrationError('CRM_CORE_PROJECTION_DELTA_PREREQUISITES_MISSING')
    }
}

function runtimeGrantStatements(target) {
    const role = RUNTIME_ROLES[target]
    if (!role) throw migrationError('CRM_CORE_PROJECTION_DELTA_RUNTIME_ROLE_UNKNOWN')
    return [
        `grant usage on schema crm_atendimento to ${role}`,
        `grant select (identity_id, unit_slug, active, revision, observed_at, updated_at) on table ${CRM_CORE_PROJECTION_MEMBERSHIP_RELATION} to ${role}`,
        `grant select (event_order, event_id, identity_id, unit_slug, revision, operation, occurred_at, created_at) on table ${CRM_CORE_PROJECTION_OUTBOX_RELATION} to ${role}`,
    ]
}

async function assertDestination(client, databaseUrl, target) {
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) {
        throw migrationError('CRM_CORE_PROJECTION_DELTA_DESTINATION_UNSAFE')
    }
    try {
        return await assertAtendimentoMigrationDestination(client, databaseUrl, target)
    } catch {
        throw migrationError('CRM_CORE_PROJECTION_DELTA_DESTINATION_UNSAFE')
    }
}

export function crmCoreProjectionDeltaMigrationPlan() {
    return {
        id: CRM_CORE_PROJECTION_DELTA_MIGRATION_ID,
        relations: [CRM_CORE_PROJECTION_MEMBERSHIP_RELATION, CRM_CORE_PROJECTION_OUTBOX_RELATION],
        sourceContract: 'atendimento/crm-core/projection-delta/v1',
        membershipPolicy: 'one retained active/tombstoned row per canonical identity/unit; no global, all or unknown fallback',
        eventPolicy: 'append-only upsert/revoke events with monotonic revision and strictly increasing (possibly sparse after rollback) event_order',
        runtimeAccess: 'dedicated exporter receives SELECT on opaque membership and outbox columns only; no customer attributes, DML or DDL',
        reconciliation: 'repeatable-read transaction guarded by pg_advisory_xact_lock; changed/new memberships upsert, removed memberships revoke',
        rollback: 'non-destructive; evidence and tombstones remain retained, only schema registry rollback state is recorded',
    }
}

export async function applyCrmCoreProjectionDeltaMigration({
    pool,
    databaseUrl,
    target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL,
} = {}) {
    if (!pool) throw migrationError('CRM_CORE_PROJECTION_DELTA_POOL_REQUIRED')
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) {
        throw migrationError('CRM_CORE_PROJECTION_DELTA_DESTINATION_UNSAFE')
    }
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin')
        transactionOpen = true
        await client.query(`set local lock_timeout = '3s'`)
        await client.query(`set local statement_timeout = '60s'`)
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [CRM_CORE_PROJECTION_DELTA_MIGRATION_ID])
        const destination = await assertDestination(client, databaseUrl, target)
        await ensureRegistry(client)
        await assertPrerequisites(client)
        for (const statement of STATEMENTS) await client.query(statement)
        const grants = runtimeGrantStatements(target)
        for (const statement of grants) await client.query(statement)
        const report = {
            ...crmCoreProjectionDeltaMigrationPlan(),
            applied: true,
            target,
            database: destination.database,
            runtimeRole: RUNTIME_ROLES[target],
            runtimeGrants: grants,
            appendOnly: true,
        }
        await client.query(`insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), null, $2::jsonb)
            on conflict(id) do update set applied_at = excluded.applied_at, rolled_back_at = null, details = excluded.details`, [
            CRM_CORE_PROJECTION_DELTA_MIGRATION_ID,
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

export async function rollbackCrmCoreProjectionDeltaMigration({
    pool,
    databaseUrl,
    target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL,
} = {}) {
    if (!pool) throw migrationError('CRM_CORE_PROJECTION_DELTA_POOL_REQUIRED')
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) {
        throw migrationError('CRM_CORE_PROJECTION_DELTA_DESTINATION_UNSAFE')
    }
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin')
        transactionOpen = true
        await client.query(`set local lock_timeout = '3s'`)
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [CRM_CORE_PROJECTION_DELTA_MIGRATION_ID])
        await assertDestination(client, databaseUrl, target)
        await ensureRegistry(client)
        await client.query(`insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), now(), '{"rollback":"non-destructive","evidenceRetained":true,"tombstonesRetained":true}'::jsonb)
            on conflict(id) do update set rolled_back_at = now(), details = excluded.details`, [CRM_CORE_PROJECTION_DELTA_MIGRATION_ID])
        await client.query('commit')
        transactionOpen = false
        return {
            id: CRM_CORE_PROJECTION_DELTA_MIGRATION_ID,
            rolledBack: true,
            destructive: false,
            evidenceRetained: true,
            tombstonesRetained: true,
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

async function readCanonicalMemberships(client, sourceSql) {
    const result = await client.query(`select identity_id, unit_slug, observed_at from (${sourceSql}) canonical_delta_source`)
    return (result.rows || []).map(assertAtendimentoProjectionMembershipRow)
}

async function readPersistedMemberships(client) {
    const result = await client.query(`select identity_id, unit_slug, active, revision, observed_at
        from ${CRM_CORE_PROJECTION_MEMBERSHIP_RELATION}`)
    return result.rows || []
}

/**
 * Reconciles one owner-provided canonical snapshot and appends all resulting
 * events atomically.  This function is intentionally opt-in: it has no CLI,
 * environment lookup or production default and therefore cannot drain a real
 * outbox accidentally.
 */
export async function reconcileAtendimentoProjectionDelta({
    pool,
    databaseUrl,
    target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL,
    sourceSql = ATENDIMENTO_PROJECTION_MEMBERSHIP_SOURCE_SQL,
    now = new Date(),
} = {}) {
    if (!pool) throw migrationError('CRM_CORE_PROJECTION_DELTA_POOL_REQUIRED')
    const normalizedSourceSql = readOnlySourceSql(sourceSql)
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) {
        throw migrationError('CRM_CORE_PROJECTION_DELTA_DESTINATION_UNSAFE')
    }
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin isolation level repeatable read')
        transactionOpen = true
        await client.query(`set local lock_timeout = '3s'`)
        await client.query(`set local statement_timeout = '120s'`)
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, ['crm-core-projection-delta:reconcile:v1'])
        await assertDestination(client, databaseUrl, target)
        const current = await readCanonicalMemberships(client, normalizedSourceSql)
        const existing = await readPersistedMemberships(client)
        const plan = reconcileAtendimentoProjectionMembershipRows({ current, existing, observedAt: now })
        let highWatermark = null
        for (const change of plan.changes) {
            await client.query(`insert into ${CRM_CORE_PROJECTION_MEMBERSHIP_RELATION}
                (identity_id, unit_slug, active, revision, observed_at, updated_at)
                values ($1, $2, $3, $4, $5::timestamptz, clock_timestamp())
                on conflict (identity_id, unit_slug) do update set
                    active = excluded.active,
                    revision = excluded.revision,
                    observed_at = excluded.observed_at,
                    updated_at = clock_timestamp()`, [
                change.identityId,
                change.unitSlug,
                change.operation !== CRM_CORE_PROJECTION_DELTA_OPERATION_REVOKE,
                change.revision,
                change.observedAt,
            ])
            const event = await client.query(`insert into ${CRM_CORE_PROJECTION_OUTBOX_RELATION}
                (identity_id, unit_slug, revision, operation, occurred_at)
                values ($1, $2, $3, $4, $5::timestamptz)
                returning event_order`, [
                change.identityId,
                change.unitSlug,
                change.revision,
                change.operation,
                change.observedAt,
            ])
            const eventOrder = Number(event.rows?.[0]?.event_order)
            if (!Number.isSafeInteger(eventOrder) || eventOrder < 1) {
                throw migrationError('CRM_CORE_PROJECTION_DELTA_OUTBOX_WRITE_INVALID')
            }
            highWatermark = eventOrder
        }
        const report = {
            version: 'atendimento/crm-core/projection-delta-reconcile/v1',
            target,
            sourceContract: 'atendimento/crm-core/projection-delta/v1',
            currentCount: plan.currentCount,
            existingCount: plan.existingCount,
            unchangedCount: plan.unchangedCount,
            upsertCount: plan.upsertCount,
            revokeCount: plan.revokeCount,
            outboxEvents: plan.changes.length,
            highWatermark,
            atomic: true,
            pii: false,
        }
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

export const __testables = Object.freeze({
    STATEMENTS,
    PREREQUISITE_RELATIONS,
    RUNTIME_ROLES,
    runtimeGrantStatements,
    readOnlySourceSql,
})
