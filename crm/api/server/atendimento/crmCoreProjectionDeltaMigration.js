import { createHash } from 'node:crypto'

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
import {
    CRM_CORE_PROJECTION_DELTA_BASELINE_STATES,
    assertAtendimentoProjectionDeltaBaseline,
    createAtendimentoProjectionDeltaBaselineSnapshot,
    createAtendimentoProjectionDeltaBaselineBackfill,
    createAtendimentoProjectionDeltaBaselinePrepared,
    acceptAtendimentoProjectionDeltaBaseline,
    markAtendimentoProjectionDeltaReady,
    digestAtendimentoProjectionDeltaBaseline,
} from '../../../../shared/crm-auth/atendimentoProjectionDeltaBaseline.js'

export const CRM_CORE_PROJECTION_DELTA_MIGRATION_ID = '20260908_crm_core_projection_delta_v1'
export const CRM_CORE_PROJECTION_MEMBERSHIP_RELATION = 'crm_atendimento.crm_core_projection_memberships'
export const CRM_CORE_PROJECTION_OUTBOX_RELATION = 'crm_atendimento.crm_core_projection_outbox'
export const CRM_CORE_PROJECTION_BASELINE_HANDOFF_RELATION = 'crm_atendimento.crm_core_projection_delta_handoffs'
export const CRM_CORE_PROJECTION_BASELINE_HANDOFF_KEY = 'initial'

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
const OPAQUE_EVENT_ID_PATTERN = /^event:[A-Za-z0-9_-]{8,160}$/
const OPAQUE_PROJECTION_REFERENCE_PATTERN = /^projection:[A-Za-z0-9_-]{8,160}$/
const OPAQUE_SOURCE_REFERENCE_PATTERN = /^source:[A-Za-z0-9_-]{8,160}$/
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/

function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize)
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
    return value
}

function digestOpaqueBackfillBatch(value) {
    return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`
}

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
    `create table if not exists ${CRM_CORE_PROJECTION_BASELINE_HANDOFF_RELATION} (
        handoff_key text primary key check (handoff_key = '${CRM_CORE_PROJECTION_BASELINE_HANDOFF_KEY}'),
        state text not null check (state in ('${CRM_CORE_PROJECTION_DELTA_BASELINE_STATES.PREPARED}', '${CRM_CORE_PROJECTION_DELTA_BASELINE_STATES.ACCEPTED}', '${CRM_CORE_PROJECTION_DELTA_BASELINE_STATES.READY}')),
        baseline_digest text not null check (baseline_digest ~ '^sha256:[a-f0-9]{64}$'),
        captured_at timestamptz not null,
        cursor_digest text not null check (cursor_digest ~ '^sha256:[a-f0-9]{64}$'),
        membership_digest text not null check (membership_digest ~ '^sha256:[a-f0-9]{64}$'),
        row_count bigint not null check (row_count >= 1),
        unit_slugs jsonb not null,
        watermark bigint not null check (watermark >= 0),
        manifest_digest text not null check (manifest_digest ~ '^sha256:[a-f0-9]{64}$'),
        batch_count bigint not null check (batch_count >= 1),
        event_count bigint not null check (event_count >= 1),
        backfill_key_id text not null,
        delta_key_id text not null,
        target_environment text not null check (target_environment in ('staging', 'production')),
        target_release text not null check (target_release ~ '^[0-9a-f]{40}$'),
        target_artifact_digest text not null check (target_artifact_digest ~ '^sha256:[a-f0-9]{64}$'),
        baseline_json jsonb not null,
        receipt_status text,
        receipt_count bigint,
        accepted_at timestamptz,
        readback_membership_digest text check (readback_membership_digest is null or readback_membership_digest ~ '^sha256:[a-f0-9]{64}$'),
        readback_watermark bigint check (readback_watermark is null or readback_watermark >= 0),
        ready_at timestamptz,
        updated_at timestamptz not null default now()
    )`,
])

function migrationError(code) {
    const error = new Error(code)
    error.code = code
    return error
}

function assertBackfillFactoryBatches({ batches, manifest, source, snapshot, target }) {
    if (!Array.isArray(batches) || batches.length !== manifest.batches.length) {
        throw migrationError('CRM_CORE_PROJECTION_DELTA_BASELINE_BACKFILL_DERIVATION_FAILED')
    }
    const eventIds = new Set()
    const projectionKeys = new Set()
    for (const [index, batch] of batches.entries()) {
        const descriptor = manifest.batches[index]
        if (!batch || typeof batch !== 'object' || Array.isArray(batch)
            || Object.keys(batch).length !== 7
            || !['contract', 'batchId', 'producer', 'sourceSnapshot', 'target', 'events', 'integrity'].every((key) => Object.hasOwn(batch, key))) {
            throw migrationError('CRM_CORE_PROJECTION_DELTA_BASELINE_BACKFILL_DERIVATION_FAILED')
        }
        const producer = batch.producer
        const sourceSnapshot = batch.sourceSnapshot
        const integrity = batch.integrity
        if (batch.contract !== 'skincos-crm/projection-backfill-batch/v2'
            || batch.batchId !== descriptor.batchId
            || digestOpaqueBackfillBatch(batch) !== descriptor.batchDigest
            || !producer || Object.keys(producer).length !== 3
            || producer.owner !== source.owner || producer.scope !== source.scope || producer.keyId !== source.backfillKeyId
            || !sourceSnapshot || Object.keys(sourceSnapshot).length !== 4
            || sourceSnapshot.capturedAt !== snapshot.capturedAt
            || sourceSnapshot.cursorDigest !== descriptor.cursorDigest
            || sourceSnapshot.rowCount !== descriptor.eventCount
            || !Array.isArray(sourceSnapshot.unitSlugs)
            || JSON.stringify([...sourceSnapshot.unitSlugs].sort()) !== JSON.stringify([...descriptor.unitSlugs].sort())
            || !sameTargetDescriptor(batch.target, target)
            || !integrity || Object.keys(integrity).length !== 3
            || integrity.algorithm !== 'sha256' || integrity.eventCount !== descriptor.eventCount
            || !SHA256_PATTERN.test(String(integrity.eventsDigest || '').toLowerCase())
            || !Array.isArray(batch.events) || batch.events.length !== descriptor.eventCount) {
            throw migrationError('CRM_CORE_PROJECTION_DELTA_BASELINE_BACKFILL_DERIVATION_FAILED')
        }
        for (const event of batch.events) {
            if (!event || typeof event !== 'object' || Array.isArray(event)
                || Object.keys(event).length !== 8
                || !['contractVersion', 'id', 'projection', 'source', 'unitScope', 'revision', 'operation', 'occurredAt'].every((key) => Object.hasOwn(event, key))) {
                throw migrationError('CRM_CORE_PROJECTION_DELTA_BASELINE_BACKFILL_DERIVATION_FAILED')
            }
            const projection = event.projection
            const eventSource = event.source
            const unitScope = event.unitScope
            const eventId = String(event.id || '')
            const projectionReference = String(projection?.reference || '')
            const unitSlug = String(unitScope?.unitSlug || '')
            const projectionKey = `${unitSlug}\u0000${projectionReference}`
            if (event.contractVersion !== 'crm-projection-event/v2'
                || !OPAQUE_EVENT_ID_PATTERN.test(eventId)
                || !projection || Object.keys(projection).length !== 2
                || !OPAQUE_PROJECTION_REFERENCE_PATTERN.test(projectionReference)
                || projection.kind !== 'client-reference'
                || !eventSource || Object.keys(eventSource).length !== 2
                || eventSource.owner !== source.owner
                || !OPAQUE_SOURCE_REFERENCE_PATTERN.test(String(eventSource.reference || ''))
                || !unitScope || Object.keys(unitScope).length !== 1
                || !/^(?!all$|unknown$)[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(unitSlug)
                || !descriptor.unitSlugs.includes(unitSlug)
                || event.revision !== 1 || event.operation !== 'upsert'
                || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(String(event.occurredAt || ''))
                || eventIds.has(eventId) || projectionKeys.has(projectionKey)) {
                throw migrationError('CRM_CORE_PROJECTION_DELTA_BASELINE_BACKFILL_DUPLICATE')
            }
            eventIds.add(eventId)
            projectionKeys.add(projectionKey)
        }
    }
    if (eventIds.size !== manifest.eventCount || projectionKeys.size !== manifest.eventCount) {
        throw migrationError('CRM_CORE_PROJECTION_DELTA_BASELINE_BACKFILL_DUPLICATE')
    }
}

function sameTargetDescriptor(left, right) {
    return left && right && left.environment === right.environment
        && left.release === right.release && left.artifactDigest === right.artifactDigest
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
        relations: [CRM_CORE_PROJECTION_MEMBERSHIP_RELATION, CRM_CORE_PROJECTION_OUTBOX_RELATION, CRM_CORE_PROJECTION_BASELINE_HANDOFF_RELATION],
        sourceContract: 'atendimento/crm-core/projection-delta/v1',
        membershipPolicy: 'one retained active/tombstoned row per canonical identity/unit; no global, all or unknown fallback',
        eventPolicy: 'append-only upsert/revoke events with monotonic revision and strictly increasing (possibly sparse after rollback) event_order',
        runtimeAccess: 'dedicated exporter receives SELECT on opaque membership and outbox columns only; no customer attributes, DML or DDL',
        reconciliation: 'repeatable-read transaction guarded by pg_advisory_xact_lock; changed/new memberships upsert, removed memberships revoke',
        baselineHandoff: 'a repeatable-read source transaction derives the paginated manifest from its exact rows, rejects cross-page opaque duplicates, seeds revision 1 and records a durable sanitized baseline document before any reconciler can run; delta delivery remains disabled until every exact backfill receipt and ledger proof advance it to delta-ready',
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

async function readBaselineHandoff(client, { forUpdate = false } = {}) {
    const result = await client.query(`select handoff_key, state, baseline_digest, captured_at, cursor_digest,
        membership_digest, row_count, unit_slugs, watermark, manifest_digest, batch_count, event_count,
        backfill_key_id, delta_key_id, target_environment, target_release,
        target_artifact_digest, baseline_json, receipt_status, receipt_count, accepted_at,
        readback_membership_digest, readback_watermark, ready_at
        from ${CRM_CORE_PROJECTION_BASELINE_HANDOFF_RELATION}
        where handoff_key = $1${forUpdate ? ' for update' : ''}`, [CRM_CORE_PROJECTION_BASELINE_HANDOFF_KEY])
    return result.rows?.[0] || null
}

async function readOutboxWatermark(client) {
    const result = await client.query(`select coalesce(max(event_order), 0)::bigint as watermark from ${CRM_CORE_PROJECTION_OUTBOX_RELATION}`)
    const watermark = Number(result.rows?.[0]?.watermark ?? 0)
    if (!Number.isSafeInteger(watermark) || watermark < 0) throw migrationError('CRM_CORE_PROJECTION_DELTA_WATERMARK_INVALID')
    return watermark
}

async function readTransactionCapturedAt(client, fallback) {
    const result = await client.query('select transaction_timestamp()::timestamptz as captured_at')
    const value = result.rows?.[0]?.captured_at || fallback
    const capturedAt = value instanceof Date ? value.toISOString() : String(value || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(capturedAt) || Number.isNaN(new Date(capturedAt).getTime())) {
        throw migrationError('CRM_CORE_PROJECTION_DELTA_SNAPSHOT_INVALID')
    }
    return capturedAt
}

function assertStoredHandoffMatches(row, baseline, expectedState) {
    let storedBaseline = row?.baseline_json
    try {
        if (typeof storedBaseline === 'string') storedBaseline = JSON.parse(storedBaseline)
        storedBaseline = assertAtendimentoProjectionDeltaBaseline(storedBaseline)
    } catch {
        throw migrationError('CRM_CORE_PROJECTION_DELTA_BASELINE_STATE_CONFLICT')
    }
    if (!row || row.handoff_key !== CRM_CORE_PROJECTION_BASELINE_HANDOFF_KEY || row.state !== expectedState
        || String(row.baseline_digest || '').toLowerCase() !== digestAtendimentoProjectionDeltaBaseline(baseline)
        || digestAtendimentoProjectionDeltaBaseline(storedBaseline) !== digestAtendimentoProjectionDeltaBaseline(baseline)
        || storedBaseline.state !== expectedState) {
        throw migrationError('CRM_CORE_PROJECTION_DELTA_BASELINE_STATE_CONFLICT')
    }
}

async function assertReconcileBaselineReady(client) {
    const handoff = await readBaselineHandoff(client)
    if (!handoff || handoff.state !== CRM_CORE_PROJECTION_DELTA_BASELINE_STATES.READY) {
        throw migrationError('CRM_CORE_PROJECTION_DELTA_BASELINE_NOT_READY')
    }
    if (handoff.baseline_json !== undefined && handoff.baseline_json !== null) {
        try {
            const storedBaseline = assertAtendimentoProjectionDeltaBaseline(typeof handoff.baseline_json === 'string'
                ? JSON.parse(handoff.baseline_json)
                : handoff.baseline_json)
            if (storedBaseline.state !== CRM_CORE_PROJECTION_DELTA_BASELINE_STATES.READY
                || digestAtendimentoProjectionDeltaBaseline(storedBaseline) !== String(handoff.baseline_digest || '').toLowerCase()
                || storedBaseline.readback?.membershipDigest !== String(handoff.readback_membership_digest || '').toLowerCase()
                || storedBaseline.readback?.watermark !== Number(handoff.readback_watermark)) {
                throw new Error('baseline document mismatch')
            }
        } catch {
            throw migrationError('CRM_CORE_PROJECTION_DELTA_BASELINE_STATE_CONFLICT')
        }
    }
    return handoff
}

function baselineRowValues(baseline) {
    return [
        CRM_CORE_PROJECTION_BASELINE_HANDOFF_KEY,
        baseline.state,
        digestAtendimentoProjectionDeltaBaseline(baseline),
        baseline.snapshot.capturedAt,
        baseline.snapshot.cursorDigest,
        baseline.seed.membershipDigest,
        baseline.snapshot.rowCount,
        JSON.stringify(baseline.snapshot.unitSlugs),
        baseline.snapshot.watermark,
        baseline.backfill.manifestDigest,
        baseline.backfill.batches.length,
        baseline.backfill.eventCount,
        baseline.source.backfillKeyId,
        baseline.source.deltaKeyId,
        baseline.target.environment,
        baseline.target.release,
        baseline.target.artifactDigest,
        JSON.stringify(baseline),
    ]
}

/**
 * Captures one canonical source snapshot and seeds revision-1 membership rows
 * in the same repeatable-read transaction. The injected backfillFactory must
 * derive the sanitized manifest and real v2 batches from those exact rows;
 * cross-page opaque identities are checked before the handoff is committed.
 * The handoff row is persisted as baseline-prepared before commit; the
 * reconciler refuses to run until a separately verified Core receipt and
 * readback advance it to delta-ready.
 */
export async function prepareAtendimentoProjectionDeltaBaseline({
    pool,
    databaseUrl,
    target = ATENDIMENTO_MIGRATION_TARGETS.STAGING,
    sourceSql = ATENDIMENTO_PROJECTION_MEMBERSHIP_SOURCE_SQL,
    targetDescriptor,
    source: sourceDescriptor,
    backfillFactory,
    now = new Date(),
} = {}) {
    if (!pool) throw migrationError('CRM_CORE_PROJECTION_DELTA_POOL_REQUIRED')
    if (target === ATENDIMENTO_MIGRATION_TARGETS.PRODUCTION) throw migrationError('CRM_CORE_PROJECTION_DELTA_BASELINE_STAGING_ONLY')
    if (!targetDescriptor || !sourceDescriptor || typeof backfillFactory !== 'function') throw migrationError('CRM_CORE_PROJECTION_DELTA_BASELINE_INPUT_REQUIRED')
    const normalizedSourceSql = readOnlySourceSql(sourceSql)
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('CRM_CORE_PROJECTION_DELTA_DESTINATION_UNSAFE')
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin isolation level repeatable read')
        transactionOpen = true
        await client.query(`set local lock_timeout = '3s'`)
        await client.query(`set local statement_timeout = '120s'`)
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, ['crm-core-projection-delta:reconcile:v1'])
        await assertDestination(client, databaseUrl, target)
        const existingHandoff = await readBaselineHandoff(client, { forUpdate: true })
        if (existingHandoff) throw migrationError('CRM_CORE_PROJECTION_DELTA_BASELINE_ALREADY_PREPARED')
        const existing = await readPersistedMemberships(client)
        if (existing.length > 0) throw migrationError('CRM_CORE_PROJECTION_DELTA_BASELINE_STATE_NOT_EMPTY')
        const watermark = await readOutboxWatermark(client)
        if (watermark !== 0) throw migrationError('CRM_CORE_PROJECTION_DELTA_BASELINE_OUTBOX_NOT_EMPTY')
        const current = await readCanonicalMemberships(client, normalizedSourceSql)
        const capturedAt = await readTransactionCapturedAt(client, now)
        const { snapshot, seed } = createAtendimentoProjectionDeltaBaselineSnapshot({ rows: current, capturedAt, watermark })
        let derivedBackfill
        try {
            const derived = await backfillFactory({
                rows: Object.freeze([...current]),
                snapshot,
                seed,
                capturedAt,
                watermark,
            })
            if (!derived || typeof derived !== 'object' || Array.isArray(derived)
                || Object.keys(derived).length !== 2
                || !Object.hasOwn(derived, 'backfill') || !Object.hasOwn(derived, 'batches')) {
                throw new Error('factory output')
            }
            derivedBackfill = createAtendimentoProjectionDeltaBaselineBackfill(derived.backfill)
            assertBackfillFactoryBatches({ batches: derived.batches, manifest: derivedBackfill, source: sourceDescriptor, snapshot, target: targetDescriptor })
        } catch {
            throw migrationError('CRM_CORE_PROJECTION_DELTA_BASELINE_BACKFILL_DERIVATION_FAILED')
        }
        const prepared = createAtendimentoProjectionDeltaBaselinePrepared({
            target: targetDescriptor,
            source: sourceDescriptor,
            snapshot,
            backfill: derivedBackfill,
            seed,
        })
        for (const row of current) {
            await client.query(`insert into ${CRM_CORE_PROJECTION_MEMBERSHIP_RELATION}
                (identity_id, unit_slug, active, revision, observed_at, updated_at)
                values ($1, $2, true, 1, $3::timestamptz, clock_timestamp())`, [row.identityId, row.unitSlug, row.observedAt])
        }
        await client.query(`insert into ${CRM_CORE_PROJECTION_BASELINE_HANDOFF_RELATION}
            (handoff_key, state, baseline_digest, captured_at, cursor_digest, membership_digest,
             row_count, unit_slugs, watermark, manifest_digest, batch_count, event_count, backfill_key_id,
             delta_key_id, target_environment, target_release, target_artifact_digest, baseline_json)
            values ($1, $2, $3, $4::timestamptz, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb)`, baselineRowValues(prepared))
        await client.query('commit')
        transactionOpen = false
        return Object.freeze({ baseline: prepared, seededMemberships: seed.rowCount, watermark, capturedAt, atomic: true, pii: false })
    } catch (error) {
        if (transactionOpen) { try { await client.query('rollback') } catch { /* preserve original */ } }
        throw error
    } finally { client.release() }
}

export async function acceptAtendimentoProjectionDeltaBaselineInStore({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.STAGING, baseline, receipt: suppliedReceipt, now = new Date() } = {}) {
    if (!pool) throw migrationError('CRM_CORE_PROJECTION_DELTA_POOL_REQUIRED')
    const current = assertAtendimentoProjectionDeltaBaseline(baseline)
    const accepted = acceptAtendimentoProjectionDeltaBaseline(current, suppliedReceipt)
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('CRM_CORE_PROJECTION_DELTA_DESTINATION_UNSAFE')
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin')
        transactionOpen = true
        await client.query(`set local lock_timeout = '3s'`)
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, ['crm-core-projection-delta:reconcile:v1'])
        await assertDestination(client, databaseUrl, target)
        const row = await readBaselineHandoff(client, { forUpdate: true })
        assertStoredHandoffMatches(row, current, CRM_CORE_PROJECTION_DELTA_BASELINE_STATES.PREPARED)
        await client.query(`update ${CRM_CORE_PROJECTION_BASELINE_HANDOFF_RELATION}
            set state = $1, baseline_digest = $2, baseline_json = $3::jsonb, receipt_status = $4, receipt_count = $5, accepted_at = $6::timestamptz, updated_at = clock_timestamp()
            where handoff_key = $7`, [accepted.state, digestAtendimentoProjectionDeltaBaseline(accepted), JSON.stringify(accepted), `accepted=${accepted.receipts.filter((entry) => entry.status === 'accepted').length};idempotent=${accepted.receipts.filter((entry) => entry.status === 'idempotent').length}`, accepted.receipts.length, now instanceof Date ? now.toISOString() : String(now), CRM_CORE_PROJECTION_BASELINE_HANDOFF_KEY])
        await client.query('commit')
        transactionOpen = false
        return Object.freeze({ baseline: accepted, atomic: true, pii: false })
    } catch (error) {
        if (transactionOpen) { try { await client.query('rollback') } catch { /* preserve original */ } }
        throw error
    } finally { client.release() }
}

export async function markAtendimentoProjectionDeltaReadyInStore({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.STAGING, baseline, readback: suppliedReadback, now = new Date() } = {}) {
    if (!pool) throw migrationError('CRM_CORE_PROJECTION_DELTA_POOL_REQUIRED')
    const current = assertAtendimentoProjectionDeltaBaseline(baseline)
    const ready = markAtendimentoProjectionDeltaReady(current, suppliedReadback)
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('CRM_CORE_PROJECTION_DELTA_DESTINATION_UNSAFE')
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin')
        transactionOpen = true
        await client.query(`set local lock_timeout = '3s'`)
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, ['crm-core-projection-delta:reconcile:v1'])
        await assertDestination(client, databaseUrl, target)
        const row = await readBaselineHandoff(client, { forUpdate: true })
        assertStoredHandoffMatches(row, current, CRM_CORE_PROJECTION_DELTA_BASELINE_STATES.ACCEPTED)
        await client.query(`update ${CRM_CORE_PROJECTION_BASELINE_HANDOFF_RELATION}
            set state = $1, baseline_digest = $2, baseline_json = $3::jsonb, readback_membership_digest = $4, readback_watermark = $5,
                ready_at = $6::timestamptz, updated_at = clock_timestamp()
            where handoff_key = $7`, [ready.state, digestAtendimentoProjectionDeltaBaseline(ready), JSON.stringify(ready), ready.readback.membershipDigest, ready.readback.watermark, now instanceof Date ? now.toISOString() : String(now), CRM_CORE_PROJECTION_BASELINE_HANDOFF_KEY])
        await client.query('commit')
        transactionOpen = false
        return Object.freeze({ baseline: ready, atomic: true, pii: false })
    } catch (error) {
        if (transactionOpen) { try { await client.query('rollback') } catch { /* preserve original */ } }
        throw error
    } finally { client.release() }
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
        await assertReconcileBaselineReady(client)
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
    baselineRowValues,
    assertStoredHandoffMatches,
    assertBackfillFactoryBatches,
    digestOpaqueBackfillBatch,
})
