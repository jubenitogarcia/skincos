import { createHash } from 'node:crypto'

import {
    assertAtendimentoMigrationDestination,
    ATENDIMENTO_MIGRATION_TARGETS,
    isStrictAtendimentoMigrationDestination,
} from './migrationDestination.js'
import {
    CRM_CORE_PROJECTION_DELTA_OPERATION_REVOKE,
    assertAtendimentoProjectionMembershipRow,
    reconcileAtendimentoProjectionMembershipRows,
} from './crmCoreProjectionDelta.js'
import {
    ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_STATES,
    acceptAtendimentoConfirmedProjectionBaselineV2,
    assertAtendimentoConfirmedProjectionBaselineV2,
    assertAtendimentoConfirmedProjectionBaselineV2Batch,
    createAtendimentoConfirmedProjectionBaselineV2Backfill,
    createAtendimentoConfirmedProjectionBaselineV2Batch,
    createAtendimentoConfirmedProjectionBaselineV2Prepared,
    createAtendimentoConfirmedProjectionBaselineV2Snapshot,
    createAtendimentoConfirmedProjectionBaselineV2Source,
    digestAtendimentoConfirmedProjectionBaselineV2,
    digestAtendimentoConfirmedProjectionBaselineV2Batch,
    markAtendimentoConfirmedProjectionBaselineV2Ready,
} from '../../../../shared/crm-auth/atendimentoConfirmedProjectionBaselineV2.js'
import {
    ATENDIMENTO_CRM_CORE_CONFIRMED_UNIT_MEMBERSHIP_CTE,
    ATENDIMENTO_CRM_CORE_IDENTITY_SOURCE_SEMANTICS_VERSION,
    ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS,
} from '../../../../shared/crm-auth/atendimentoCrmCoreIdentityMaterializationPolicy.js'
import {
    ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_PROFILE,
    assertAtendimentoConfirmedProjectionDeltaV2SourceProfile,
    createAtendimentoConfirmedProjectionDeltaV2BaselineBinding,
    createAtendimentoConfirmedProjectionDeltaV2SourceProfilePin,
    digestAtendimentoConfirmedProjectionDeltaV2SourceProfile,
} from '../../../../shared/crm-auth/atendimentoConfirmedProjectionDeltaV2.js'

export const CONFIRMED_PROJECTION_DELTA_V2_MIGRATION_ID = '20260914_atendimento_crm_core_confirmed_projection_delta_v2'
export const CONFIRMED_PROJECTION_DELTA_V2_MEMBERSHIP_RELATION = 'crm_atendimento.crm_core_confirmed_projection_delta_v2_memberships'
export const CONFIRMED_PROJECTION_DELTA_V2_OUTBOX_RELATION = 'crm_atendimento.crm_core_confirmed_projection_delta_v2_outbox'
export const CONFIRMED_PROJECTION_DELTA_V2_HANDOFF_RELATION = 'crm_atendimento.crm_core_confirmed_projection_delta_v2_handoffs'
export const CONFIRMED_PROJECTION_DELTA_V2_HANDOFF_KEY = 'initial'
export const CONFIRMED_PROJECTION_DELTA_V2_STATE_IDENTITY_RELATION = 'crm_atendimento.crm_core_identities'
export const CONFIRMED_PROJECTION_DELTA_V2_PREREQUISITE_RELATIONS = Object.freeze([
    CONFIRMED_PROJECTION_DELTA_V2_STATE_IDENTITY_RELATION,
    ...ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS,
])

const SOURCE_PROFILE_DIGEST = digestAtendimentoConfirmedProjectionDeltaV2SourceProfile()
const UNIT_SLUG_SQL_PATTERN = "^(?!all$|unknown$)[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$"
const READ_ONLY_SQL_FORBIDDEN = /\b(?:alter|call|copy|create|delete|drop|grant|insert|merge|offset|revoke|truncate|update|vacuum)\b/i
const UUID_TEXT_PATTERN = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
const RUNTIME_ROLES = Object.freeze({
    [ATENDIMENTO_MIGRATION_TARGETS.LOCAL]: 'skincos',
    [ATENDIMENTO_MIGRATION_TARGETS.STAGING]: 'skincos_staging_crm_app',
    [ATENDIMENTO_MIGRATION_TARGETS.PRODUCTION]: 'crm_core_projection_exporter',
})

function migrationError(code) {
    const error = new Error(code)
    error.code = code
    return error
}

function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize)
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
    return value
}

function digest(value) {
    return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`
}

function isSha256(value) {
    return /^sha256:[a-f0-9]{64}$/.test(String(value || '').toLowerCase())
}

function sameTarget(left, right) {
    return left && right && left.environment === right.environment
        && left.release === right.release && left.artifactDigest === right.artifactDigest
}

// This fixed query is the only v2 lifecycle source.  It uses the four
// isolated identity relations and nothing from Caixa, registrations, leads,
// legacy global identities, or mutable importer timestamps.
export const ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_SQL = `${ATENDIMENTO_CRM_CORE_CONFIRMED_UNIT_MEMBERSHIP_CTE}
SELECT identity_id AS identity_id, unit_slug AS unit_slug, observed_at AS observed_at
  FROM canonical_memberships`

function fixedSourceSql(value = ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_SQL) {
    const sql = String(value || '').trim()
    if (!sql || sql.length > 64 * 1024 || sql.includes(';') || READ_ONLY_SQL_FORBIDDEN.test(sql)
        || !/^(?:select|with)\b/i.test(sql)
        || sql !== ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_SQL.trim()) {
        throw migrationError('CONFIRMED_PROJECTION_DELTA_V2_SOURCE_SQL_UNSAFE')
    }
    for (const alias of ['identity_id', 'unit_slug', 'observed_at']) {
        if (!new RegExp(`\\bas\\s+(?:"${alias}"|${alias})\\b`, 'i').test(sql)) {
            throw migrationError('CONFIRMED_PROJECTION_DELTA_V2_SOURCE_SQL_UNSAFE')
        }
    }
    return sql
}

const STATEMENTS = Object.freeze([
    'create schema if not exists crm_atendimento',
    'create extension if not exists pgcrypto',
    `create table if not exists ${CONFIRMED_PROJECTION_DELTA_V2_MEMBERSHIP_RELATION} (
        identity_id uuid not null references ${CONFIRMED_PROJECTION_DELTA_V2_STATE_IDENTITY_RELATION}(id) on delete restrict,
        unit_slug text not null check (unit_slug = lower(unit_slug) and unit_slug ~ '${UNIT_SLUG_SQL_PATTERN}'),
        active boolean not null,
        revision bigint not null default 1 check (revision >= 1),
        observed_at timestamptz not null,
        source_profile_digest text not null check (source_profile_digest = '${SOURCE_PROFILE_DIGEST}'),
        updated_at timestamptz not null default now(),
        primary key (identity_id, unit_slug)
    )`,
    `create table if not exists ${CONFIRMED_PROJECTION_DELTA_V2_OUTBOX_RELATION} (
        event_order bigint generated always as identity primary key,
        event_id uuid not null default gen_random_uuid() unique,
        identity_id uuid not null references ${CONFIRMED_PROJECTION_DELTA_V2_STATE_IDENTITY_RELATION}(id) on delete restrict,
        unit_slug text not null check (unit_slug = lower(unit_slug) and unit_slug ~ '${UNIT_SLUG_SQL_PATTERN}'),
        revision bigint not null check (revision >= 1),
        operation text not null check (operation in ('upsert', 'revoke')),
        occurred_at timestamptz not null,
        source_semantics text not null check (source_semantics = '${ATENDIMENTO_CRM_CORE_IDENTITY_SOURCE_SEMANTICS_VERSION}'),
        source_profile_digest text not null check (source_profile_digest = '${SOURCE_PROFILE_DIGEST}'),
        created_at timestamptz not null default now()
    )`,
    `create index if not exists crm_core_confirmed_projection_delta_v2_memberships_active_idx
        on ${CONFIRMED_PROJECTION_DELTA_V2_MEMBERSHIP_RELATION}(unit_slug, identity_id) where active`,
    `create index if not exists crm_core_confirmed_projection_delta_v2_outbox_order_idx
        on ${CONFIRMED_PROJECTION_DELTA_V2_OUTBOX_RELATION}(event_order)`,
    `create index if not exists crm_core_confirmed_projection_delta_v2_outbox_identity_unit_order_idx
        on ${CONFIRMED_PROJECTION_DELTA_V2_OUTBOX_RELATION}(identity_id, unit_slug, event_order)`,
    `create or replace function crm_atendimento.prevent_crm_core_confirmed_projection_delta_v2_outbox_mutation()
        returns trigger language plpgsql as $$
        begin
            raise exception 'confirmed crm core projection delta v2 outbox is append-only';
        end $$`,
    `drop trigger if exists crm_core_confirmed_projection_delta_v2_outbox_immutable on ${CONFIRMED_PROJECTION_DELTA_V2_OUTBOX_RELATION}`,
    `create trigger crm_core_confirmed_projection_delta_v2_outbox_immutable
        before update or delete on ${CONFIRMED_PROJECTION_DELTA_V2_OUTBOX_RELATION}
        for each row execute function crm_atendimento.prevent_crm_core_confirmed_projection_delta_v2_outbox_mutation()`,
    `drop trigger if exists crm_core_confirmed_projection_delta_v2_outbox_no_truncate on ${CONFIRMED_PROJECTION_DELTA_V2_OUTBOX_RELATION}`,
    `create trigger crm_core_confirmed_projection_delta_v2_outbox_no_truncate
        before truncate on ${CONFIRMED_PROJECTION_DELTA_V2_OUTBOX_RELATION}
        for each statement execute function crm_atendimento.prevent_crm_core_confirmed_projection_delta_v2_outbox_mutation()`,
    `create table if not exists ${CONFIRMED_PROJECTION_DELTA_V2_HANDOFF_RELATION} (
        handoff_key text primary key check (handoff_key = '${CONFIRMED_PROJECTION_DELTA_V2_HANDOFF_KEY}'),
        state text not null check (state in ('baseline-prepared', 'baseline-accepted', 'delta-ready')),
        source_profile_json jsonb not null,
        source_profile_digest text not null check (source_profile_digest = '${SOURCE_PROFILE_DIGEST}'),
        baseline_digest text not null check (baseline_digest ~ '^sha256:[a-f0-9]{64}$'),
        baseline_json jsonb not null,
        baseline_packets_json jsonb not null,
        receipt_status text,
        receipt_count bigint,
        readback_membership_digest text check (readback_membership_digest is null or readback_membership_digest ~ '^sha256:[a-f0-9]{64}$'),
        readback_watermark bigint check (readback_watermark is null or readback_watermark >= 0),
        accepted_at timestamptz,
        ready_at timestamptz,
        updated_at timestamptz not null default now()
    )`,
])

async function ensureRegistry(client) {
    await client.query('create schema if not exists crm_atendimento')
    await client.query(`create table if not exists crm_atendimento.schema_migrations (
        id text primary key, applied_at timestamptz not null default now(), rolled_back_at timestamptz,
        details jsonb not null default '{}'::jsonb
    )`)
}

async function assertPrerequisites(client) {
    const projection = CONFIRMED_PROJECTION_DELTA_V2_PREREQUISITE_RELATIONS
        .map((relation, index) => `to_regclass('${relation}') is not null as relation_${index}`)
        .join(', ')
    const result = await client.query(`select ${projection}`)
    if (!Object.values(result.rows[0] || {}).every(Boolean)) {
        throw migrationError('CONFIRMED_PROJECTION_DELTA_V2_PREREQUISITES_MISSING')
    }
}

function runtimeGrantStatements(target) {
    const role = RUNTIME_ROLES[target]
    if (!role) throw migrationError('CONFIRMED_PROJECTION_DELTA_V2_RUNTIME_ROLE_UNKNOWN')
    return [
        `grant usage on schema crm_atendimento to ${role}`,
        `grant select (identity_id, unit_slug, active, revision, observed_at, source_profile_digest, updated_at) on table ${CONFIRMED_PROJECTION_DELTA_V2_MEMBERSHIP_RELATION} to ${role}`,
        `grant select (event_order, event_id, identity_id, unit_slug, revision, operation, occurred_at, source_semantics, source_profile_digest, created_at) on table ${CONFIRMED_PROJECTION_DELTA_V2_OUTBOX_RELATION} to ${role}`,
    ]
}

async function assertDestination(client, databaseUrl, target) {
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('CONFIRMED_PROJECTION_DELTA_V2_DESTINATION_UNSAFE')
    try {
        return await assertAtendimentoMigrationDestination(client, databaseUrl, target)
    } catch {
        throw migrationError('CONFIRMED_PROJECTION_DELTA_V2_DESTINATION_UNSAFE')
    }
}

export function confirmedProjectionDeltaV2MigrationPlan() {
    return Object.freeze({
        id: CONFIRMED_PROJECTION_DELTA_V2_MIGRATION_ID,
        sourceSemantics: ATENDIMENTO_CRM_CORE_IDENTITY_SOURCE_SEMANTICS_VERSION,
        sourceProfileDigest: SOURCE_PROFILE_DIGEST,
        sourceRelationAllowlist: Object.freeze([...ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS]),
        sourceRelationsOnly: true,
        stateIdentityRelation: CONFIRMED_PROJECTION_DELTA_V2_STATE_IDENTITY_RELATION,
        relations: Object.freeze([CONFIRMED_PROJECTION_DELTA_V2_MEMBERSHIP_RELATION, CONFIRMED_PROJECTION_DELTA_V2_OUTBOX_RELATION, CONFIRMED_PROJECTION_DELTA_V2_HANDOFF_RELATION]),
        eventPolicy: 'append-only v2 upsert/revoke events with a profile pin, monotonic revision and sparse-safe event_order',
        baselinePolicy: 'fixed v5 source, staging-only baseline, opaque packet custody, explicit receipt/readback transition before reconciliation',
        rollback: 'non-destructive; membership rows, tombstones, packets and receipts remain retained',
    })
}

export async function applyConfirmedProjectionDeltaV2Migration({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL } = {}) {
    if (!pool) throw migrationError('CONFIRMED_PROJECTION_DELTA_V2_POOL_REQUIRED')
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('CONFIRMED_PROJECTION_DELTA_V2_DESTINATION_UNSAFE')
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin')
        transactionOpen = true
        await client.query("set local lock_timeout = '3s'")
        await client.query("set local statement_timeout = '60s'")
        await client.query('select pg_advisory_xact_lock(hashtext($1))', [CONFIRMED_PROJECTION_DELTA_V2_MIGRATION_ID])
        const destination = await assertDestination(client, databaseUrl, target)
        await ensureRegistry(client)
        await assertPrerequisites(client)
        for (const statement of STATEMENTS) await client.query(statement)
        const grants = runtimeGrantStatements(target)
        for (const statement of grants) await client.query(statement)
        const report = Object.freeze({ ...confirmedProjectionDeltaV2MigrationPlan(), applied: true, target, database: destination.database, runtimeRole: RUNTIME_ROLES[target], runtimeGrants: grants, appendOnly: true, pii: false })
        await client.query(`insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), null, $2::jsonb)
            on conflict(id) do update set applied_at = excluded.applied_at, rolled_back_at = null, details = excluded.details`, [CONFIRMED_PROJECTION_DELTA_V2_MIGRATION_ID, JSON.stringify(report)])
        await client.query('commit')
        transactionOpen = false
        return report
    } catch (error) {
        if (transactionOpen) {
            try { await client.query('rollback') } catch { /* preserve the primary failure */ }
        }
        throw error
    } finally {
        client.release()
    }
}

export async function rollbackConfirmedProjectionDeltaV2Migration({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL } = {}) {
    if (!pool) throw migrationError('CONFIRMED_PROJECTION_DELTA_V2_POOL_REQUIRED')
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('CONFIRMED_PROJECTION_DELTA_V2_DESTINATION_UNSAFE')
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin')
        transactionOpen = true
        await client.query("set local lock_timeout = '3s'")
        await client.query('select pg_advisory_xact_lock(hashtext($1))', [CONFIRMED_PROJECTION_DELTA_V2_MIGRATION_ID])
        await assertDestination(client, databaseUrl, target)
        await ensureRegistry(client)
        await client.query(`insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), now(), '{"rollback":"non-destructive","evidenceRetained":true,"tombstonesRetained":true}'::jsonb)
            on conflict(id) do update set rolled_back_at = now(), details = excluded.details`, [CONFIRMED_PROJECTION_DELTA_V2_MIGRATION_ID])
        await client.query('commit')
        transactionOpen = false
        return Object.freeze({ id: CONFIRMED_PROJECTION_DELTA_V2_MIGRATION_ID, rolledBack: true, destructive: false, evidenceRetained: true, tombstonesRetained: true })
    } catch (error) {
        if (transactionOpen) {
            try { await client.query('rollback') } catch { /* preserve the primary failure */ }
        }
        throw error
    } finally {
        client.release()
    }
}

async function readCanonicalMemberships(client) {
    const sourceSql = fixedSourceSql()
    const result = await client.query(`select identity_id, unit_slug, observed_at
        from (${sourceSql}) confirmed_projection_delta_v2_source
        order by observed_at asc, identity_id asc, unit_slug asc`)
    return (result.rows || []).map(assertAtendimentoProjectionMembershipRow)
}

async function readExistingMemberships(client) {
    const result = await client.query(`select identity_id, unit_slug, active, revision, observed_at
        from ${CONFIRMED_PROJECTION_DELTA_V2_MEMBERSHIP_RELATION}`)
    return result.rows || []
}

async function readWatermark(client) {
    const result = await client.query(`select coalesce(max(event_order), 0)::bigint as watermark
        from ${CONFIRMED_PROJECTION_DELTA_V2_OUTBOX_RELATION}`)
    const watermark = Number(result.rows?.[0]?.watermark ?? 0)
    if (!Number.isSafeInteger(watermark) || watermark < 0) throw migrationError('CONFIRMED_PROJECTION_DELTA_V2_WATERMARK_INVALID')
    return watermark
}

async function readCapturedAt(client) {
    const result = await client.query('select transaction_timestamp()::timestamptz as captured_at')
    const capturedAt = result.rows?.[0]?.captured_at instanceof Date
        ? result.rows[0].captured_at.toISOString()
        : String(result.rows?.[0]?.captured_at || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(capturedAt) || Number.isNaN(new Date(capturedAt).getTime())) {
        throw migrationError('CONFIRMED_PROJECTION_DELTA_V2_SNAPSHOT_INVALID')
    }
    return capturedAt
}

function assertBaselinePackets({ baseline, packets }) {
    if (!Array.isArray(packets) || packets.length !== baseline.backfill.batches.length) throw migrationError('CONFIRMED_PROJECTION_DELTA_V2_BASELINE_STATE_CONFLICT')
    const seenEventIds = new Set()
    const seenProjectionKeys = new Set()
    for (const [index, packet] of packets.entries()) {
        const descriptor = baseline.backfill.batches[index]
        let normalized
        try {
            normalized = assertAtendimentoConfirmedProjectionBaselineV2Batch(packet)
        } catch {
            throw migrationError('CONFIRMED_PROJECTION_DELTA_V2_BASELINE_STATE_CONFLICT')
        }
        if (normalized.batchId !== descriptor.batchId
            || digestAtendimentoConfirmedProjectionBaselineV2Batch(normalized) !== descriptor.batchDigest
            || normalized.producer.owner !== baseline.source.owner
            || normalized.producer.scope !== baseline.source.scope
            || normalized.producer.keyId !== baseline.source.baselineKeyId
            || normalized.sourceProfile.digest !== baseline.sourceProfile.digest
            || !sameTarget(normalized.target, baseline.target)
            || normalized.sourceSnapshot.capturedAt !== baseline.snapshot.capturedAt
            || normalized.sourceSnapshot.cursorDigest !== descriptor.cursorDigest
            || normalized.events.length !== descriptor.eventCount
            || normalized.integrity.eventCount !== descriptor.eventCount) throw migrationError('CONFIRMED_PROJECTION_DELTA_V2_BASELINE_STATE_CONFLICT')
        for (const event of normalized.events) {
            const projectionKey = `${event?.unitScope?.unitSlug}\u0000${event?.projection?.reference}`
            if (!/^event:[A-Za-z0-9_-]{8,160}$/.test(String(event?.id || ''))
                || !/^projection:[A-Za-z0-9_-]{8,160}$/.test(String(event?.projection?.reference || ''))
                || !/^source:[A-Za-z0-9_-]{8,160}$/.test(String(event?.source?.reference || ''))
                || event?.contractVersion !== 'crm-projection-event/v2'
                || event?.source?.owner !== 'atendimento'
                || event?.operation !== 'upsert'
                || event?.revision !== 1
                || seenEventIds.has(event.id)
                || seenProjectionKeys.has(projectionKey)) throw migrationError('CONFIRMED_PROJECTION_DELTA_V2_BASELINE_STATE_CONFLICT')
            seenEventIds.add(event.id)
            seenProjectionKeys.add(projectionKey)
        }
    }
    if (seenEventIds.size !== baseline.backfill.eventCount || seenProjectionKeys.size !== baseline.backfill.eventCount) throw migrationError('CONFIRMED_PROJECTION_DELTA_V2_BASELINE_STATE_CONFLICT')
    return Object.freeze(packets)
}

function deriveBatches({ rows, capturedAt, source, target, hmacKey }) {
    const packets = []
    const descriptors = []
    const ordered = [...rows].sort((left, right) => left.observedAt.localeCompare(right.observedAt)
        || left.identityId.localeCompare(right.identityId) || left.unitSlug.localeCompare(right.unitSlug))
    for (let offset = 0; offset < ordered.length; offset += 20) {
        const packet = createAtendimentoConfirmedProjectionBaselineV2Batch({
            rows: ordered.slice(offset, offset + 20),
            capturedAt,
            hmacKey,
            keyId: source.baselineKeyId,
            target,
        })
        packets.push(packet)
        descriptors.push({
            batchId: packet.batchId,
            batchDigest: digestAtendimentoConfirmedProjectionBaselineV2Batch(packet),
            capturedAt: packet.sourceSnapshot.capturedAt,
            cursorDigest: packet.sourceSnapshot.cursorDigest,
            fromOrdinal: offset + 1,
            toOrdinal: offset + packet.events.length,
            rowCount: packet.events.length,
            unitSlugs: packet.sourceSnapshot.unitSlugs,
            eventCount: packet.events.length,
        })
    }
    const backfill = createAtendimentoConfirmedProjectionBaselineV2Backfill({
        batches: descriptors,
        rowCount: ordered.length,
        eventCount: ordered.length,
        unitSlugs: [...new Set(ordered.map((row) => row.unitSlug))].sort(),
    })
    return Object.freeze({ backfill, packets: assertBaselinePackets({ baseline: { backfill, source, target, snapshot: { capturedAt } }, packets }) })
}

async function readHandoff(client, { forUpdate = false } = {}) {
    const result = await client.query(`select handoff_key, state, source_profile_json, source_profile_digest, baseline_digest,
        baseline_json, baseline_packets_json, readback_membership_digest, readback_watermark
        from ${CONFIRMED_PROJECTION_DELTA_V2_HANDOFF_RELATION}
        where handoff_key = $1${forUpdate ? ' for update' : ''}`, [CONFIRMED_PROJECTION_DELTA_V2_HANDOFF_KEY])
    return result.rows?.[0] || null
}

function parseJson(value) {
    return typeof value === 'string' ? JSON.parse(value) : value
}

function storedHandoff(row, expectedState) {
    try {
        if (!row || row.handoff_key !== CONFIRMED_PROJECTION_DELTA_V2_HANDOFF_KEY || row.state !== expectedState
            || String(row.source_profile_digest || '').toLowerCase() !== SOURCE_PROFILE_DIGEST) throw new Error('missing handoff')
        const profile = assertAtendimentoConfirmedProjectionDeltaV2SourceProfile(parseJson(row.source_profile_json))
        if (digestAtendimentoConfirmedProjectionDeltaV2SourceProfile(profile) !== SOURCE_PROFILE_DIGEST) throw new Error('profile mismatch')
        const baseline = assertAtendimentoConfirmedProjectionBaselineV2(parseJson(row.baseline_json))
        if (baseline.state !== expectedState || digestAtendimentoConfirmedProjectionBaselineV2(baseline) !== String(row.baseline_digest || '').toLowerCase()) throw new Error('baseline mismatch')
        const packets = assertBaselinePackets({ baseline, packets: parseJson(row.baseline_packets_json) })
        if (expectedState === ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_STATES.READY) {
            const storedWatermark = row.readback_watermark
            if (storedWatermark === null || storedWatermark === undefined
                || !/^\d+$/.test(String(storedWatermark))
                || !Number.isSafeInteger(Number(storedWatermark))
                || baseline.readback?.membershipDigest !== String(row.readback_membership_digest || '').toLowerCase()
                || baseline.readback?.watermark !== Number(storedWatermark)) throw new Error('readback mismatch')
        }
        return Object.freeze({ profile, baseline, packets })
    } catch {
        throw migrationError('CONFIRMED_PROJECTION_DELTA_V2_BASELINE_STATE_CONFLICT')
    }
}

function baselineRowValues(baseline, packets) {
    return [
        CONFIRMED_PROJECTION_DELTA_V2_HANDOFF_KEY,
        baseline.state,
        JSON.stringify(ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_PROFILE),
        SOURCE_PROFILE_DIGEST,
        digestAtendimentoConfirmedProjectionBaselineV2(baseline),
        JSON.stringify(baseline),
        JSON.stringify(packets),
    ]
}

function baselineBinding(baseline, profile = ATENDIMENTO_CONFIRMED_PROJECTION_DELTA_V2_SOURCE_PROFILE) {
    return createAtendimentoConfirmedProjectionDeltaV2BaselineBinding({
        baselineDigest: digestAtendimentoConfirmedProjectionBaselineV2(baseline),
        target: baseline.target,
        sourceProfile: profile,
        identityKeyFingerprint: baseline.source.identityKeyFingerprint,
        deltaKeyId: baseline.source.deltaKeyId,
    })
}

function assertProductionSourceTarget(target) {
    if (target !== ATENDIMENTO_MIGRATION_TARGETS.PRODUCTION) {
        throw migrationError('CONFIRMED_PROJECTION_DELTA_V2_SOURCE_PRODUCTION_ONLY')
    }
}

function assertSuppliedBaselineMatchesStored(value, stored) {
    let supplied
    try {
        supplied = assertAtendimentoConfirmedProjectionBaselineV2(value)
    } catch {
        throw migrationError('CONFIRMED_PROJECTION_DELTA_V2_BASELINE_STATE_CONFLICT')
    }
    if (digestAtendimentoConfirmedProjectionBaselineV2(supplied) !== digestAtendimentoConfirmedProjectionBaselineV2(stored.baseline)) {
        throw migrationError('CONFIRMED_PROJECTION_DELTA_V2_BASELINE_STATE_CONFLICT')
    }
    return supplied
}

export async function prepareConfirmedProjectionDeltaV2Baseline({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.PRODUCTION, targetDescriptor, source: sourceDescriptor, backfillHmacKey } = {}) {
    if (!pool || !targetDescriptor || !sourceDescriptor || typeof backfillHmacKey !== 'string' || !backfillHmacKey.trim()) throw migrationError('CONFIRMED_PROJECTION_DELTA_V2_BASELINE_INPUT_REQUIRED')
    assertProductionSourceTarget(target)
    if (targetDescriptor.environment !== 'staging' || !isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('CONFIRMED_PROJECTION_DELTA_V2_BASELINE_STAGING_ONLY')
    let source
    try {
        source = createAtendimentoConfirmedProjectionBaselineV2Source({ ...sourceDescriptor, identityHmacKey: backfillHmacKey })
    } catch {
        throw migrationError('CONFIRMED_PROJECTION_DELTA_V2_BASELINE_INPUT_REQUIRED')
    }
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin isolation level repeatable read')
        transactionOpen = true
        await client.query("set local lock_timeout = '3s'")
        await client.query("set local statement_timeout = '120s'")
        await client.query('select pg_advisory_xact_lock(hashtext($1))', ['crm-core-confirmed-projection-delta:v2'])
        await assertDestination(client, databaseUrl, target)
        const existingHandoff = await readHandoff(client, { forUpdate: true })
        if (existingHandoff) throw migrationError('CONFIRMED_PROJECTION_DELTA_V2_BASELINE_ALREADY_PREPARED')
        if ((await readExistingMemberships(client)).length > 0 || await readWatermark(client) !== 0) throw migrationError('CONFIRMED_PROJECTION_DELTA_V2_BASELINE_STATE_NOT_EMPTY')
        const rows = await readCanonicalMemberships(client)
        const capturedAt = await readCapturedAt(client)
        const { snapshot } = createAtendimentoConfirmedProjectionBaselineV2Snapshot({ rows, capturedAt, watermark: 0 })
        const derived = deriveBatches({ rows, capturedAt, source, target: targetDescriptor, hmacKey: backfillHmacKey })
        const baseline = createAtendimentoConfirmedProjectionBaselineV2Prepared({ target: targetDescriptor, source, snapshot, backfill: derived.backfill })
        for (const row of rows) {
            await client.query(`insert into ${CONFIRMED_PROJECTION_DELTA_V2_MEMBERSHIP_RELATION}
                (identity_id, unit_slug, active, revision, observed_at, source_profile_digest, updated_at)
                values ($1, $2, true, 1, $3::timestamptz, $4, clock_timestamp())`, [row.identityId, row.unitSlug, row.observedAt, SOURCE_PROFILE_DIGEST])
        }
        await client.query(`insert into ${CONFIRMED_PROJECTION_DELTA_V2_HANDOFF_RELATION}
            (handoff_key, state, source_profile_json, source_profile_digest, baseline_digest, baseline_json, baseline_packets_json)
            values ($1, $2, $3::jsonb, $4, $5, $6::jsonb, $7::jsonb)`, baselineRowValues(baseline, derived.packets))
        await client.query('commit')
        transactionOpen = false
        return Object.freeze({
            baseline: baselineBinding(baseline),
            seededMemberships: snapshot.rowCount,
            batchCount: baseline.backfill.batches.length,
            sourceProfileDigest: SOURCE_PROFILE_DIGEST,
            atomic: true,
            pii: false,
        })
    } catch (error) {
        if (transactionOpen) {
            try { await client.query('rollback') } catch { /* preserve the primary failure */ }
        }
        throw error
    } finally {
        client.release()
    }
}

export async function loadConfirmedProjectionDeltaV2BaselineCustody({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.PRODUCTION } = {}) {
    assertProductionSourceTarget(target)
    if (!pool || !isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('CONFIRMED_PROJECTION_DELTA_V2_DESTINATION_UNSAFE')
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin')
        transactionOpen = true
        await client.query('select pg_advisory_xact_lock(hashtext($1))', ['crm-core-confirmed-projection-delta:v2'])
        await assertDestination(client, databaseUrl, target)
        const stored = storedHandoff(await readHandoff(client, { forUpdate: true }), ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_STATES.PREPARED)
        await client.query('commit')
        transactionOpen = false
        return Object.freeze({ baseline: stored.baseline, packets: stored.packets, binding: baselineBinding(stored.baseline, stored.profile), pii: false })
    } catch (error) {
        if (transactionOpen) {
            try { await client.query('rollback') } catch { /* preserve the primary failure */ }
        }
        throw error
    } finally {
        client.release()
    }
}

export async function acceptConfirmedProjectionDeltaV2Baseline({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.PRODUCTION, baseline, receipt, now = new Date() } = {}) {
    assertProductionSourceTarget(target)
    if (!pool || !isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('CONFIRMED_PROJECTION_DELTA_V2_DESTINATION_UNSAFE')
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin')
        transactionOpen = true
        await client.query('select pg_advisory_xact_lock(hashtext($1))', ['crm-core-confirmed-projection-delta:v2'])
        await assertDestination(client, databaseUrl, target)
        const stored = storedHandoff(await readHandoff(client, { forUpdate: true }), ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_STATES.PREPARED)
        assertSuppliedBaselineMatchesStored(baseline, stored)
        const accepted = acceptAtendimentoConfirmedProjectionBaselineV2(stored.baseline, receipt)
        await client.query(`update ${CONFIRMED_PROJECTION_DELTA_V2_HANDOFF_RELATION}
            set state = $1, baseline_digest = $2, baseline_json = $3::jsonb, receipt_status = $4, receipt_count = $5,
                accepted_at = $6::timestamptz, updated_at = clock_timestamp() where handoff_key = $7`, [accepted.state, digestAtendimentoConfirmedProjectionBaselineV2(accepted), JSON.stringify(accepted), `accepted=${accepted.receipts.filter((entry) => entry.status === 'accepted').length};idempotent=${accepted.receipts.filter((entry) => entry.status === 'idempotent').length}`, accepted.receipts.length, now instanceof Date ? now.toISOString() : String(now), CONFIRMED_PROJECTION_DELTA_V2_HANDOFF_KEY])
        await client.query('commit')
        transactionOpen = false
        return Object.freeze({ baseline: baselineBinding(accepted, stored.profile), atomic: true, pii: false })
    } catch (error) {
        if (transactionOpen) {
            try { await client.query('rollback') } catch { /* preserve the primary failure */ }
        }
        throw error
    } finally {
        client.release()
    }
}

export async function markConfirmedProjectionDeltaV2Ready({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.PRODUCTION, baseline, readback, now = new Date() } = {}) {
    assertProductionSourceTarget(target)
    if (!pool || !isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('CONFIRMED_PROJECTION_DELTA_V2_DESTINATION_UNSAFE')
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin')
        transactionOpen = true
        await client.query('select pg_advisory_xact_lock(hashtext($1))', ['crm-core-confirmed-projection-delta:v2'])
        await assertDestination(client, databaseUrl, target)
        const stored = storedHandoff(await readHandoff(client, { forUpdate: true }), ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_STATES.ACCEPTED)
        assertSuppliedBaselineMatchesStored(baseline, stored)
        const ready = markAtendimentoConfirmedProjectionBaselineV2Ready(stored.baseline, readback)
        await client.query(`update ${CONFIRMED_PROJECTION_DELTA_V2_HANDOFF_RELATION}
            set state = $1, baseline_digest = $2, baseline_json = $3::jsonb, readback_membership_digest = $4,
                readback_watermark = $5, ready_at = $6::timestamptz, updated_at = clock_timestamp() where handoff_key = $7`, [ready.state, digestAtendimentoConfirmedProjectionBaselineV2(ready), JSON.stringify(ready), ready.readback.membershipDigest, ready.readback.watermark, now instanceof Date ? now.toISOString() : String(now), CONFIRMED_PROJECTION_DELTA_V2_HANDOFF_KEY])
        await client.query('commit')
        transactionOpen = false
        return Object.freeze({ baseline: baselineBinding(ready, stored.profile), atomic: true, pii: false })
    } catch (error) {
        if (transactionOpen) {
            try { await client.query('rollback') } catch { /* preserve the primary failure */ }
        }
        throw error
    } finally {
        client.release()
    }
}

export async function reconcileConfirmedProjectionDeltaV2({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.PRODUCTION, now = new Date() } = {}) {
    assertProductionSourceTarget(target)
    if (!pool || !isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('CONFIRMED_PROJECTION_DELTA_V2_DESTINATION_UNSAFE')
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin isolation level repeatable read')
        transactionOpen = true
        await client.query("set local lock_timeout = '3s'")
        await client.query("set local statement_timeout = '120s'")
        await client.query('select pg_advisory_xact_lock(hashtext($1))', ['crm-core-confirmed-projection-delta:v2'])
        await assertDestination(client, databaseUrl, target)
        const handoff = storedHandoff(await readHandoff(client), ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_STATES.READY)
        const current = await readCanonicalMemberships(client)
        const existing = await readExistingMemberships(client)
        const admittedUnits = new Set(handoff.baseline.source.unitAllowlist)
        if (current.some((row) => !admittedUnits.has(row.unitSlug)) || existing.some((row) => !admittedUnits.has(row.unit_slug))) {
            throw migrationError('CONFIRMED_PROJECTION_DELTA_V2_UNIT_SCOPE_UNADMITTED')
        }
        const plan = reconcileAtendimentoProjectionMembershipRows({ current, existing, observedAt: now })
        let highWatermark = null
        for (const change of plan.changes) {
            await client.query(`insert into ${CONFIRMED_PROJECTION_DELTA_V2_MEMBERSHIP_RELATION}
                (identity_id, unit_slug, active, revision, observed_at, source_profile_digest, updated_at)
                values ($1, $2, $3, $4, $5::timestamptz, $6, clock_timestamp())
                on conflict (identity_id, unit_slug) do update set active = excluded.active, revision = excluded.revision,
                    observed_at = excluded.observed_at, source_profile_digest = excluded.source_profile_digest, updated_at = clock_timestamp()`, [change.identityId, change.unitSlug, change.operation !== CRM_CORE_PROJECTION_DELTA_OPERATION_REVOKE, change.revision, change.observedAt, SOURCE_PROFILE_DIGEST])
            const event = await client.query(`insert into ${CONFIRMED_PROJECTION_DELTA_V2_OUTBOX_RELATION}
                (identity_id, unit_slug, revision, operation, occurred_at, source_semantics, source_profile_digest)
                values ($1, $2, $3, $4, $5::timestamptz, $6, $7) returning event_order`, [change.identityId, change.unitSlug, change.revision, change.operation, change.observedAt, ATENDIMENTO_CRM_CORE_IDENTITY_SOURCE_SEMANTICS_VERSION, SOURCE_PROFILE_DIGEST])
            const eventOrder = Number(event.rows?.[0]?.event_order)
            if (!Number.isSafeInteger(eventOrder) || eventOrder < 1) throw migrationError('CONFIRMED_PROJECTION_DELTA_V2_OUTBOX_WRITE_INVALID')
            highWatermark = eventOrder
        }
        await client.query('commit')
        transactionOpen = false
        return Object.freeze({
            version: 'atendimento/crm-core/confirmed-projection-delta-reconcile/v2',
            target,
            sourceSemantics: handoff.profile.semantics,
            sourceProfileDigest: SOURCE_PROFILE_DIGEST,
            currentCount: plan.currentCount,
            existingCount: plan.existingCount,
            unchangedCount: plan.unchangedCount,
            upsertCount: plan.upsertCount,
            revokeCount: plan.revokeCount,
            outboxEvents: plan.changes.length,
            highWatermark,
            atomic: true,
            pii: false,
        })
    } catch (error) {
        if (transactionOpen) {
            try { await client.query('rollback') } catch { /* preserve the primary failure */ }
        }
        throw error
    } finally {
        client.release()
    }
}

export const __testables = Object.freeze({
    STATEMENTS,
    SOURCE_PROFILE_DIGEST,
    fixedSourceSql,
    runtimeGrantStatements,
    assertBaselinePackets,
    deriveBatches,
    storedHandoff,
    digest,
    UUID_TEXT_PATTERN,
})
