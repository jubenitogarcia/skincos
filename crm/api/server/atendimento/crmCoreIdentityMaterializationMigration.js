import {
    assertAtendimentoMigrationDestination,
    ATENDIMENTO_MIGRATION_TARGETS,
    isStrictAtendimentoMigrationDestination,
} from './migrationDestination.js'
import { IDENTITY_GRAPH_LOCK_KEY } from '../../../../shared/crm-auth/identityGraphLock.js'
import {
    ATENDIMENTO_CRM_CORE_ATTENDANCE_LINKS_RELATION,
    ATENDIMENTO_CRM_CORE_IDENTITIES_RELATION,
    ATENDIMENTO_CRM_CORE_IDENTITY_CLIENTS_RELATION,
    ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_RUNS_RELATION,
    ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_CONTRACT,
    ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_MIGRATION_ID,
    ATENDIMENTO_CRM_CORE_IDENTITY_MEMBERS_RELATION,
    ATENDIMENTO_CRM_CORE_IDENTITY_PREREQUISITE_RELATIONS,
    ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS,
    ATENDIMENTO_CRM_CORE_IDENTITY_RECONCILIATION_POLICY,
    ATENDIMENTO_CRM_CORE_IDENTITY_RELATIONS,
    ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_WRITER_CONTRACT,
    LEGACY_CLIENT_IDENTITY_MATERIALIZATION_MIGRATION_ID,
} from '../../../../shared/crm-auth/atendimentoCrmCoreIdentityMaterializationPolicy.js'

export {
    ATENDIMENTO_CRM_CORE_ATTENDANCE_LINKS_RELATION,
    ATENDIMENTO_CRM_CORE_IDENTITIES_RELATION,
    ATENDIMENTO_CRM_CORE_IDENTITY_CLIENTS_RELATION,
    ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_RUNS_RELATION,
    ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_CONTRACT,
    ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_MIGRATION_ID,
    ATENDIMENTO_CRM_CORE_IDENTITY_MEMBERS_RELATION,
    ATENDIMENTO_CRM_CORE_IDENTITY_PREREQUISITE_RELATIONS,
    ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS,
    ATENDIMENTO_CRM_CORE_IDENTITY_RECONCILIATION_POLICY,
    ATENDIMENTO_CRM_CORE_IDENTITY_RELATIONS,
    ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_WRITER_CONTRACT,
    LEGACY_CLIENT_IDENTITY_MATERIALIZATION_MIGRATION_ID,
} from '../../../../shared/crm-auth/atendimentoCrmCoreIdentityMaterializationPolicy.js'

/**
 * Schema-only foundation for the Atendimento -> CRM Core projection source.
 *
 * The broad 20260805 materializer owns unrelated product surfaces and is not
 * an admissible prerequisite for this projection.  This migration intentionally
 * carries only stable UUID links and opaque evidence digests: it never reads
 * or derives an identity from a client name.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/
const REGISTRY_RELATION = 'crm_atendimento.schema_migrations'

// Relation presence alone is not proof that this isolated schema owns the
// graph: the previous broad materializer used several of the same names with
// an incompatible shape. Keep the expected types explicit so the read-only
// preflight can reject a forged or stale registry receipt as well.
export const ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_COLUMN_CONTRACT = Object.freeze({
    [ATENDIMENTO_CRM_CORE_IDENTITY_CLIENTS_RELATION]: Object.freeze({
        id: 'uuid',
        state: 'text',
        origin: 'text',
    }),
    [ATENDIMENTO_CRM_CORE_ATTENDANCE_LINKS_RELATION]: Object.freeze({
        attendance_id: 'uuid',
        canonical_client_id: 'uuid',
        status: 'text',
        method: 'text',
        evidence_digest: 'text',
        source_revision: 'int4',
    }),
    [ATENDIMENTO_CRM_CORE_IDENTITIES_RELATION]: Object.freeze({
        id: 'uuid',
        canonical_client_id: 'uuid',
        component_key: 'text',
        state: 'text',
        policy_version: 'text',
    }),
    [ATENDIMENTO_CRM_CORE_IDENTITY_MEMBERS_RELATION]: Object.freeze({
        identity_id: 'uuid',
        source_type: 'text',
        source_id: 'uuid',
    }),
    [ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_RUNS_RELATION]: Object.freeze({
        id: 'uuid',
        writer_contract: 'text',
        policy_version: 'text',
        input_digest: 'text',
        output_digest: 'text',
        status: 'text',
        confirmed_link_count: 'int4',
        identity_count: 'int4',
    }),
})

// The composite FK is intentional: a member's `source_id` must be the exact
// canonical client owned by its identity, not merely any valid UUID in the
// isolated client relation. Preflight verifies the database retained both
// constraints, rather than trusting columns or a migration registry row alone.
export const ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_CONSTRAINT_CONTRACT = Object.freeze({
    crm_core_identities_id_canonical_client_key: /unique\s*\(id,\s*canonical_client_id\)/i,
    crm_core_identity_members_identity_source_fk: /foreign\s+key\s*\(identity_id,\s*source_id\)\s+references\s+crm_atendimento\.crm_core_identities\s*\(id,\s*canonical_client_id\)\s+on\s+delete\s+restrict/i,
})

const STATEMENTS = Object.freeze([
    `create extension if not exists pgcrypto`,
    `create schema if not exists crm_atendimento`,
    `create table if not exists ${ATENDIMENTO_CRM_CORE_IDENTITY_CLIENTS_RELATION} (
        id uuid primary key,
        state text not null default 'active' check (state in ('active','retired')),
        origin text not null default '${ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_CONTRACT}',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
    )`,
    `create table if not exists ${ATENDIMENTO_CRM_CORE_ATTENDANCE_LINKS_RELATION} (
        attendance_id uuid primary key references crm_atendimento.attendances(id) on delete restrict,
        canonical_client_id uuid not null references ${ATENDIMENTO_CRM_CORE_IDENTITY_CLIENTS_RELATION}(id) on delete restrict,
        status text not null check (status in ('confirmed','rejected','unresolved')),
        method text not null check (method in ('operator_attested','stable_source_reference','reviewed_reconciliation')),
        evidence_digest text not null check (evidence_digest ~ '^sha256:[a-f0-9]{64}$'),
        source_revision integer not null check (source_revision >= 1),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
    )`,
    `create table if not exists ${ATENDIMENTO_CRM_CORE_IDENTITIES_RELATION} (
        id uuid primary key default gen_random_uuid(),
        canonical_client_id uuid not null unique references ${ATENDIMENTO_CRM_CORE_IDENTITY_CLIENTS_RELATION}(id) on delete restrict,
        component_key text not null unique check (component_key ~ '^attendance-client:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
        state text not null default 'active' check (state in ('active','retired')),
        policy_version text not null default '${ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_CONTRACT}',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint crm_core_identities_id_canonical_client_key unique (id, canonical_client_id)
    )`,
    `create table if not exists ${ATENDIMENTO_CRM_CORE_IDENTITY_MEMBERS_RELATION} (
        identity_id uuid primary key,
        source_type text not null check (source_type = 'attendance_client'),
        source_id uuid not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (source_type, source_id),
        constraint crm_core_identity_members_identity_source_fk foreign key (identity_id, source_id)
            references ${ATENDIMENTO_CRM_CORE_IDENTITIES_RELATION}(id, canonical_client_id) on delete restrict
    )`,
    `create table if not exists ${ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_RUNS_RELATION} (
        id uuid primary key,
        writer_contract text not null check (writer_contract = '${ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_WRITER_CONTRACT.version}'),
        policy_version text not null check (policy_version = '${ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_CONTRACT}'),
        input_digest text not null check (input_digest ~ '^sha256:[a-f0-9]{64}$'),
        output_digest text not null check (output_digest ~ '^sha256:[a-f0-9]{64}$'),
        status text not null check (status in ('prepared','applied','blocked')),
        confirmed_link_count integer not null check (confirmed_link_count >= 0),
        identity_count integer not null check (identity_count >= 0),
        created_at timestamptz not null default now()
    )`,
    `create index if not exists crm_core_attendance_client_links_confirmed_idx
        on ${ATENDIMENTO_CRM_CORE_ATTENDANCE_LINKS_RELATION}(canonical_client_id, attendance_id)
        where status = 'confirmed'`,
    `create index if not exists crm_core_identity_members_identity_idx
        on ${ATENDIMENTO_CRM_CORE_IDENTITY_MEMBERS_RELATION}(identity_id, source_id)`,
    `create index if not exists crm_atendimento_crm_core_identity_materialization_runs_created_idx
        on ${ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_RUNS_RELATION}(created_at desc)`,
    `create or replace function crm_atendimento.prevent_crm_core_identity_materialization_run_mutation()
        returns trigger language plpgsql as $$
        begin
            raise exception 'crm core identity materialization ledger is append-only';
        end $$`,
    `drop trigger if exists crm_core_identity_materialization_runs_immutable on ${ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_RUNS_RELATION}`,
    `create trigger crm_core_identity_materialization_runs_immutable
        before update or delete on ${ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_RUNS_RELATION}
        for each row execute function crm_atendimento.prevent_crm_core_identity_materialization_run_mutation()`,
    `drop trigger if exists crm_core_identity_materialization_runs_no_truncate on ${ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_RUNS_RELATION}`,
    `create trigger crm_core_identity_materialization_runs_no_truncate
        before truncate on ${ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_RUNS_RELATION}
        for each statement execute function crm_atendimento.prevent_crm_core_identity_materialization_run_mutation()`,
])

function migrationError(code) {
    const error = new Error(code)
    error.code = code
    return error
}

function normalizedUuid(value) {
    const normalized = String(value || '').trim().toLowerCase()
    if (!UUID_PATTERN.test(normalized)) throw migrationError('ATENDIMENTO_CRM_CORE_IDENTITY_UUID_REQUIRED')
    return normalized
}

function normalizedDigest(value) {
    const normalized = String(value || '').trim().toLowerCase()
    if (!SHA256_PATTERN.test(normalized)) throw migrationError('ATENDIMENTO_CRM_CORE_IDENTITY_EVIDENCE_DIGEST_REQUIRED')
    return normalized
}

function normalizedRevision(value) {
    const revision = Number(value)
    if (!Number.isSafeInteger(revision) || revision < 1) {
        throw migrationError('ATENDIMENTO_CRM_CORE_IDENTITY_SOURCE_REVISION_REQUIRED')
    }
    return revision
}

function exactKeys(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const actual = Object.keys(value).sort()
    const expected = [...keys].sort()
    return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function normalizeExplicitLink(value) {
    const keys = ['attendanceId', 'canonicalClientId', 'status', 'method', 'evidenceDigest', 'sourceRevision']
    if (!exactKeys(value, keys)) throw migrationError('ATENDIMENTO_CRM_CORE_IDENTITY_LINK_SHAPE_INVALID')
    const status = String(value.status || '').trim()
    if (!['confirmed', 'rejected', 'unresolved'].includes(status)) {
        throw migrationError('ATENDIMENTO_CRM_CORE_IDENTITY_LINK_STATUS_INVALID')
    }
    const method = String(value.method || '').trim()
    if (!ATENDIMENTO_CRM_CORE_IDENTITY_RECONCILIATION_POLICY.approvedLinkMethods.includes(method)) {
        throw migrationError('ATENDIMENTO_CRM_CORE_IDENTITY_LINK_METHOD_INVALID')
    }
    return Object.freeze({
        attendanceId: normalizedUuid(value.attendanceId),
        canonicalClientId: normalizedUuid(value.canonicalClientId),
        status,
        method,
        evidenceDigest: normalizedDigest(value.evidenceDigest),
        sourceRevision: normalizedRevision(value.sourceRevision),
    })
}

function sameLink(left, right) {
    return left.attendanceId === right.attendanceId
        && left.canonicalClientId === right.canonicalClientId
        && left.status === right.status
        && left.method === right.method
        && left.evidenceDigest === right.evidenceDigest
        && left.sourceRevision === right.sourceRevision
}

function stableSortLinks(links) {
    return [...links].sort((left, right) => left.attendanceId.localeCompare(right.attendanceId)
        || left.canonicalClientId.localeCompare(right.canonicalClientId)
        || left.status.localeCompare(right.status)
        || left.method.localeCompare(right.method)
        || left.evidenceDigest.localeCompare(right.evidenceDigest)
        || left.sourceRevision - right.sourceRevision)
}

export function normalizeAtendimentoCrmCoreIdentityLinks(links = []) {
    if (!Array.isArray(links)) {
        throw migrationError('ATENDIMENTO_CRM_CORE_IDENTITY_LINK_COLLECTION_INVALID')
    }
    const normalized = stableSortLinks(links.map(normalizeExplicitLink))
    const attendanceIds = new Set()
    for (const link of normalized) {
        if (attendanceIds.has(link.attendanceId)) {
            throw migrationError('ATENDIMENTO_CRM_CORE_IDENTITY_AMBIGUOUS_LINK')
        }
        attendanceIds.add(link.attendanceId)
    }
    return Object.freeze(normalized)
}

/**
 * Returns the only permitted stable identity component key. The client UUID is
 * created and retained by an explicit reconciliation process; no name or
 * heuristic enters this function.
 */
export function atendimentoCrmCoreIdentityComponentKey(canonicalClientId) {
    return `attendance-client:${normalizedUuid(canonicalClientId)}`
}

/**
 * Normalize a complete explicit-link snapshot into deterministic CRM Core
 * identity components. A caller may not regress any persisted source revision
 * and may not silently change a persisted confirmed link: it must obtain a
 * reviewed reconciliation before writing a new state.
 */
export function reconcileAtendimentoCrmCoreIdentityLinks({ links = [], persistedLinks = [] } = {}) {
    if (!Array.isArray(links) || !Array.isArray(persistedLinks)) {
        throw migrationError('ATENDIMENTO_CRM_CORE_IDENTITY_LINK_COLLECTION_INVALID')
    }
    const desired = normalizeAtendimentoCrmCoreIdentityLinks(links)
    const persisted = stableSortLinks(persistedLinks.map(normalizeExplicitLink))
    const desiredByAttendance = new Map(desired.map((link) => [link.attendanceId, link]))
    const persistedByAttendance = new Map()
    for (const link of persisted) {
        if (persistedByAttendance.has(link.attendanceId)) {
            throw migrationError('ATENDIMENTO_CRM_CORE_IDENTITY_PERSISTED_LINK_AMBIGUOUS')
        }
        persistedByAttendance.set(link.attendanceId, link)
    }
    for (const [attendanceId, persistedLink] of persistedByAttendance) {
        const desiredLink = desiredByAttendance.get(attendanceId)
        if (desiredLink && desiredLink.sourceRevision < persistedLink.sourceRevision) {
            throw migrationError('ATENDIMENTO_CRM_CORE_IDENTITY_STALE_SOURCE_REVISION')
        }
        if (persistedLink.status === 'confirmed'
            && (!desiredLink || desiredLink.status !== 'confirmed' || desiredLink.canonicalClientId !== persistedLink.canonicalClientId)) {
            throw migrationError('ATENDIMENTO_CRM_CORE_IDENTITY_REASSIGNMENT_REVIEW_REQUIRED')
        }
        if (desiredLink && desiredLink.sourceRevision === persistedLink.sourceRevision && !sameLink(desiredLink, persistedLink)) {
            throw migrationError('ATENDIMENTO_CRM_CORE_IDENTITY_SAME_REVISION_RECONCILIATION_REVIEW_REQUIRED')
        }
    }
    const confirmedLinks = desired.filter((link) => link.status === 'confirmed')
    const attendanceIdsByClient = new Map()
    for (const link of confirmedLinks) {
        if (!attendanceIdsByClient.has(link.canonicalClientId)) attendanceIdsByClient.set(link.canonicalClientId, [])
        attendanceIdsByClient.get(link.canonicalClientId).push(link.attendanceId)
    }
    const identityComponents = [...attendanceIdsByClient.entries()]
        .map(([canonicalClientId, attendanceIds]) => Object.freeze({
            componentKey: atendimentoCrmCoreIdentityComponentKey(canonicalClientId),
            sourceType: ATENDIMENTO_CRM_CORE_IDENTITY_RECONCILIATION_POLICY.sourceType,
            sourceId: canonicalClientId,
            attendanceIds: Object.freeze([...attendanceIds].sort()),
        }))
        .sort((left, right) => left.componentKey.localeCompare(right.componentKey))
    return Object.freeze({
        policyVersion: ATENDIMENTO_CRM_CORE_IDENTITY_RECONCILIATION_POLICY.version,
        confirmedLinks: Object.freeze(confirmedLinks),
        identityComponents: Object.freeze(identityComponents),
        excludedAttendanceIds: Object.freeze(desired
            .filter((link) => link.status !== 'confirmed')
            .map((link) => link.attendanceId)
            .sort()),
    })
}

function registryState(rows = []) {
    const active = new Set()
    const recorded = new Set()
    for (const row of rows) {
        const id = String(row?.id || '').trim()
        if (!id) continue
        recorded.add(id)
        if (!row.rolled_back_at) active.add(id)
    }
    return { active, recorded }
}

function relationState(row, relations) {
    return Object.fromEntries(relations.map((relation, index) => [relation, Boolean(row?.[`relation_${index}`])]))
}

function schemaContractState(columnTypes = {}) {
    const mismatches = []
    for (const [relation, columns] of Object.entries(ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_COLUMN_CONTRACT)) {
        const actualColumns = columnTypes[relation] || {}
        for (const [column, type] of Object.entries(columns)) {
            if (actualColumns[column] !== type) mismatches.push(`${relation}.${column}`)
        }
    }
    return Object.freeze({
        ready: mismatches.length === 0,
        missingOrMismatchedColumns: Object.freeze(mismatches),
    })
}

function schemaConstraintState(constraintDefinitions = {}) {
    const mismatches = []
    for (const [constraintName, pattern] of Object.entries(ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_CONSTRAINT_CONTRACT)) {
        const definition = String(constraintDefinitions[constraintName] || '')
        if (!pattern.test(definition)) mismatches.push(constraintName)
    }
    return Object.freeze({
        ready: mismatches.length === 0,
        missingOrMismatchedConstraints: Object.freeze(mismatches),
    })
}

function normalizeColumnTypes(rows = []) {
    const columnTypes = {}
    for (const row of rows) {
        const relation = String(row?.relation || '').trim()
        const column = String(row?.column_name || '').trim()
        const type = String(row?.udt_name || '').trim()
        if (!relation || !column || !type) continue
        if (!columnTypes[relation]) columnTypes[relation] = {}
        columnTypes[relation][column] = type
    }
    return columnTypes
}

export function evaluateAtendimentoCrmCoreIdentityMaterializationPreflight({
    relationPresence = {},
    registryRows = [],
    columnTypes = {},
    constraintDefinitions = {},
} = {}) {
    const requiredRelations = [
        ...ATENDIMENTO_CRM_CORE_IDENTITY_PREREQUISITE_RELATIONS,
        ...ATENDIMENTO_CRM_CORE_IDENTITY_RELATIONS,
    ]
    const relations = Object.fromEntries(requiredRelations.map((relation) => [relation, relationPresence[relation] === true]))
    const prerequisitesReady = ATENDIMENTO_CRM_CORE_IDENTITY_PREREQUISITE_RELATIONS.every((relation) => relations[relation])
    const targetRelationsPresent = ATENDIMENTO_CRM_CORE_IDENTITY_RELATIONS.filter((relation) => relations[relation])
    const targetRelationsAbsent = ATENDIMENTO_CRM_CORE_IDENTITY_RELATIONS.filter((relation) => !relations[relation])
    const migrations = registryState(registryRows)
    const currentMigrationRecorded = migrations.recorded.has(ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_MIGRATION_ID)
    const currentMigrationActive = migrations.active.has(ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_MIGRATION_ID)
    const legacyMigrationActive = migrations.active.has(LEGACY_CLIENT_IDENTITY_MATERIALIZATION_MIGRATION_ID)
    const relationCollision = targetRelationsPresent.length > 0 && !currentMigrationRecorded
    // This source-only branch rewrites the local v1 candidate before any
    // deployment. A target with the old v1 receipt but none of this isolated
    // graph must not be silently repaired under the same registry ID.
    const migrationReceiptCollision = currentMigrationRecorded && targetRelationsPresent.length === 0
    const columnContract = schemaContractState(columnTypes)
    const constraintContract = schemaConstraintState(constraintDefinitions)
    const schemaCompatible = targetRelationsPresent.length === 0 || (columnContract.ready && constraintContract.ready)
    const schemaContractReady = targetRelationsAbsent.length === 0 && columnContract.ready && constraintContract.ready
    return Object.freeze({
        contract: ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_CONTRACT,
        prerequisitesReady,
        currentMigrationRecorded,
        currentMigrationActive,
        legacyMigrationActive,
        relationCollision,
        migrationReceiptCollision,
        schemaCompatible,
        schemaContractReady,
        schemaContractMissingOrMismatchedColumns: columnContract.missingOrMismatchedColumns,
        schemaContractMissingOrMismatchedConstraints: constraintContract.missingOrMismatchedConstraints,
        targetRelationsPresent: Object.freeze(targetRelationsPresent),
        targetRelationsAbsent: Object.freeze(targetRelationsAbsent),
        // Legacy identity state remains observable for audit, but its registry
        // no longer controls this isolated crm_core_* graph.
        applyEligible: prerequisitesReady && !relationCollision && !migrationReceiptCollision && schemaCompatible,
        schemaReady: prerequisitesReady && schemaContractReady,
        runtimeReady: prerequisitesReady && currentMigrationActive && schemaContractReady,
    })
}

function assertApplyPreflight(preflight) {
    if (!preflight.prerequisitesReady) {
        throw migrationError('ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_PREREQUISITES_MISSING')
    }
    if (preflight.relationCollision) {
        throw migrationError('ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_RELATION_COLLISION')
    }
    if (preflight.migrationReceiptCollision) {
        throw migrationError('ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_MIGRATION_RECEIPT_COLLISION')
    }
    if (!preflight.schemaCompatible) {
        throw migrationError('ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_SCHEMA_CONTRACT_INVALID')
    }
}

function assertAtendimentoCrmCoreIdentityMaterializationSchemaPreflight(preflight) {
    if (!preflight.prerequisitesReady) {
        throw migrationError('ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_PREREQUISITES_MISSING')
    }
    if (!preflight.schemaReady) {
        throw migrationError('ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_SCHEMA_INCOMPLETE')
    }
}

export function assertAtendimentoCrmCoreIdentityMaterializationRuntimePreflight(preflight) {
    assertAtendimentoCrmCoreIdentityMaterializationSchemaPreflight(preflight)
    if (!preflight.currentMigrationActive) {
        throw migrationError('ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_RUNTIME_RECEIPT_MISSING')
    }
}

export async function inspectAtendimentoCrmCoreIdentityMaterializationPreflight(client) {
    const relations = [
        ...ATENDIMENTO_CRM_CORE_IDENTITY_PREREQUISITE_RELATIONS,
        ...ATENDIMENTO_CRM_CORE_IDENTITY_RELATIONS,
        REGISTRY_RELATION,
    ]
    const projection = relations.map((_, index) => `to_regclass($${index + 1}) is not null as relation_${index}`).join(', ')
    const relationResult = await client.query(`select ${projection}`, relations)
    const relationPresence = relationState(relationResult.rows[0], relations)
    const registryPresent = relationPresence[REGISTRY_RELATION]
    let registryRows = []
    if (registryPresent) {
        const result = await client.query(`select id, rolled_back_at
            from ${REGISTRY_RELATION}
            where id = any($1::text[])`, [[
            ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_MIGRATION_ID,
            LEGACY_CLIENT_IDENTITY_MATERIALIZATION_MIGRATION_ID,
        ]])
        registryRows = result.rows
    }
    const targetRelationsPresent = ATENDIMENTO_CRM_CORE_IDENTITY_RELATIONS
        .filter((relation) => relationPresence[relation])
    let columnTypes = {}
    let constraintDefinitions = {}
    if (targetRelationsPresent.length > 0) {
        const result = await client.query(`select table_schema || '.' || table_name as relation, column_name, udt_name
            from information_schema.columns
            where table_schema = 'crm_atendimento'
              and table_name = any($1::text[])`, [
            ATENDIMENTO_CRM_CORE_IDENTITY_RELATIONS.map((relation) => relation.split('.')[1]),
        ])
        columnTypes = normalizeColumnTypes(result.rows)
        const constraintResult = await client.query(`select constraint_name, pg_get_constraintdef(constraint_oid) as constraint_definition
            from (
                select constraint_row.oid as constraint_oid, constraint_row.conname as constraint_name
                from pg_constraint constraint_row
                join pg_class relation_row on relation_row.oid = constraint_row.conrelid
                join pg_namespace namespace_row on namespace_row.oid = relation_row.relnamespace
                where namespace_row.nspname = 'crm_atendimento'
                  and relation_row.relname = any($1::text[])
                  and constraint_row.conname = any($2::text[])
            ) constraints`, [
            ATENDIMENTO_CRM_CORE_IDENTITY_RELATIONS.map((relation) => relation.split('.')[1]),
            Object.keys(ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_CONSTRAINT_CONTRACT),
        ])
        constraintDefinitions = Object.fromEntries(constraintResult.rows.map((row) => [
            String(row.constraint_name || ''),
            String(row.constraint_definition || ''),
        ]))
    }
    return evaluateAtendimentoCrmCoreIdentityMaterializationPreflight({
        relationPresence,
        registryRows,
        columnTypes,
        constraintDefinitions,
    })
}

async function ensureRegistry(client) {
    await client.query(`create schema if not exists crm_atendimento`)
    await client.query(`create table if not exists ${REGISTRY_RELATION} (
        id text primary key,
        applied_at timestamptz not null default now(),
        rolled_back_at timestamptz,
        details jsonb not null default '{}'::jsonb
    )`)
}

export async function assertAtendimentoCrmCoreIdentityMaterializationDestination(client, databaseUrl, target) {
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) {
        throw migrationError('ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_DESTINATION_UNSAFE')
    }
    try {
        return await assertAtendimentoMigrationDestination(client, databaseUrl, target)
    } catch {
        throw migrationError('ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_DESTINATION_UNSAFE')
    }
}

export function atendimentoCrmCoreIdentityMaterializationMigrationPlan() {
    return Object.freeze({
        id: ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_MIGRATION_ID,
        contract: ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_CONTRACT,
        prerequisites: ATENDIMENTO_CRM_CORE_IDENTITY_PREREQUISITE_RELATIONS,
        relations: ATENDIMENTO_CRM_CORE_IDENTITY_RELATIONS,
        projectionSourceRelationAllowlist: ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS,
        policy: 'Only approved explicit UUID link methods may create an attendance-client component; names never derive UUIDs or automatic links, ambiguous links remain excluded, link revisions are monotonic, and a reassignment or same-revision evidence conflict requires explicit review.',
        dataMutation: 'schema-only; no customer or attendance row is read, copied, inferred, or backfilled by this migration.',
        runtimeAccess: 'No runtime roles or grants are created by this migration. The dedicated exporter remains governed by its separate custody and least-privilege rollout.',
        projectionDeltaCompatibility: 'The historical 20260908_crm_core_projection_delta_v1 graph remains immutable and legacy-bound. A separate additive delta-v2 migration, custody proof and explicit cutover are required before this isolated crm_core_* graph may feed its projection outbox.',
        rollback: 'Non-destructive: retained schema and any future materialization evidence remain available; only the migration registry is marked rolled back.',
    })
}

export async function preflightAtendimentoCrmCoreIdentityMaterialization({
    pool,
    databaseUrl,
    target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL,
} = {}) {
    if (!pool) throw migrationError('ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_POOL_REQUIRED')
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) {
        throw migrationError('ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_DESTINATION_UNSAFE')
    }
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin read only')
        transactionOpen = true
        const destination = await assertAtendimentoCrmCoreIdentityMaterializationDestination(client, databaseUrl, target)
        const preflight = await inspectAtendimentoCrmCoreIdentityMaterializationPreflight(client)
        await client.query('commit')
        transactionOpen = false
        return Object.freeze({ destination, preflight })
    } catch (error) {
        if (transactionOpen) {
            try { await client.query('rollback') } catch { /* preserve the original preflight error */ }
        }
        throw error
    } finally {
        client.release()
    }
}

export async function applyAtendimentoCrmCoreIdentityMaterializationMigration({
    pool,
    databaseUrl,
    target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL,
} = {}) {
    if (!pool) throw migrationError('ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_POOL_REQUIRED')
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) {
        throw migrationError('ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_DESTINATION_UNSAFE')
    }
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin')
        transactionOpen = true
        await client.query(`set local lock_timeout = '3s'`)
        await client.query(`set local statement_timeout = '60s'`)
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_MIGRATION_ID])
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [IDENTITY_GRAPH_LOCK_KEY])
        const destination = await assertAtendimentoCrmCoreIdentityMaterializationDestination(client, databaseUrl, target)
        await ensureRegistry(client)
        const before = await inspectAtendimentoCrmCoreIdentityMaterializationPreflight(client)
        assertApplyPreflight(before)
        for (const sql of STATEMENTS) await client.query(sql)
        const after = await inspectAtendimentoCrmCoreIdentityMaterializationPreflight(client)
        assertAtendimentoCrmCoreIdentityMaterializationSchemaPreflight(after)
        const report = {
            ...atendimentoCrmCoreIdentityMaterializationMigrationPlan(),
            applied: true,
            target,
            database: destination.database,
            // The registry row is intentionally written last. This is a
            // schema-only check before that receipt exists, not a claim that
            // the runtime admission is already active.
            schemaPreflight: after,
            statements: STATEMENTS.length,
        }
        await client.query(`insert into ${REGISTRY_RELATION}(id, applied_at, rolled_back_at, details)
            values ($1, now(), null, $2::jsonb)
            on conflict(id) do update set applied_at=excluded.applied_at, rolled_back_at=null, details=excluded.details`, [
            ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_MIGRATION_ID,
            JSON.stringify(report),
        ])
        const runtime = await inspectAtendimentoCrmCoreIdentityMaterializationPreflight(client)
        assertAtendimentoCrmCoreIdentityMaterializationRuntimePreflight(runtime)
        await client.query('commit')
        transactionOpen = false
        return report
    } catch (error) {
        if (transactionOpen) {
            try { await client.query('rollback') } catch { /* preserve the original migration error */ }
        }
        throw error
    } finally {
        client.release()
    }
}

export async function rollbackAtendimentoCrmCoreIdentityMaterializationMigration({
    pool,
    databaseUrl,
    target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL,
} = {}) {
    if (!pool) throw migrationError('ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_POOL_REQUIRED')
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) {
        throw migrationError('ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_DESTINATION_UNSAFE')
    }
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin')
        transactionOpen = true
        await client.query(`set local lock_timeout = '3s'`)
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_MIGRATION_ID])
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [IDENTITY_GRAPH_LOCK_KEY])
        await assertAtendimentoCrmCoreIdentityMaterializationDestination(client, databaseUrl, target)
        await ensureRegistry(client)
        await client.query(`insert into ${REGISTRY_RELATION}(id, applied_at, rolled_back_at, details)
            values ($1, now(), now(), $2::jsonb)
            on conflict(id) do update set rolled_back_at=now(), details=excluded.details`, [
            ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_MIGRATION_ID,
            JSON.stringify({ rollback: 'non-destructive', schemaRetained: true }),
        ])
        await client.query('commit')
        transactionOpen = false
        return {
            id: ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_MIGRATION_ID,
            rolledBack: true,
            destructive: false,
            schemaRetained: true,
        }
    } catch (error) {
        if (transactionOpen) {
            try { await client.query('rollback') } catch { /* preserve the original rollback error */ }
        }
        throw error
    } finally {
        client.release()
    }
}

export const __testables = Object.freeze({
    STATEMENTS,
    normalizeExplicitLink,
    inspectAtendimentoCrmCoreIdentityMaterializationPreflight,
})
