import { createHash } from 'node:crypto'

import { IDENTITY_GRAPH_LOCK_KEY } from '../../../../shared/crm-auth/identityGraphLock.js'
import {
    ATENDIMENTO_CRM_CORE_ATTENDANCE_LINKS_RELATION,
    ATENDIMENTO_CRM_CORE_IDENTITIES_RELATION,
    ATENDIMENTO_CRM_CORE_IDENTITY_CLIENTS_RELATION,
    ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_CONTRACT,
    ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_RUNS_RELATION,
    ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_WRITER_CONTRACT,
    ATENDIMENTO_CRM_CORE_IDENTITY_MEMBERS_RELATION,
    ATENDIMENTO_CRM_CORE_IDENTITY_RECONCILIATION_POLICY,
} from '../../../../shared/crm-auth/atendimentoCrmCoreIdentityMaterializationPolicy.js'
import { ATENDIMENTO_MIGRATION_TARGETS, isStrictAtendimentoMigrationDestination } from './migrationDestination.js'
import {
    assertAtendimentoCrmCoreIdentityMaterializationRuntimePreflight,
    atendimentoCrmCoreIdentityComponentKey,
    inspectAtendimentoCrmCoreIdentityMaterializationPreflight,
    normalizeAtendimentoCrmCoreIdentityLinks,
    reconcileAtendimentoCrmCoreIdentityLinks,
} from './crmCoreIdentityMaterializationMigration.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/
const WRITER_LOCK_NAMESPACE = 'crm-core-identity-materialization:writer:v1'

function isLoopbackHost(host) {
    const value = String(host || '').trim().toLowerCase()
    return value === '127.0.0.1' || value === 'localhost' || value === '::1'
}

function isStrictWriterDestination(databaseUrl, target) {
    if (target === ATENDIMENTO_MIGRATION_TARGETS.LOCAL) {
        return isStrictAtendimentoMigrationDestination(databaseUrl, target)
    }
    if (![ATENDIMENTO_MIGRATION_TARGETS.STAGING, ATENDIMENTO_MIGRATION_TARGETS.PRODUCTION].includes(target)) return false
    const database = target === ATENDIMENTO_MIGRATION_TARGETS.STAGING
        ? 'skincos_staging'
        : 'skincos_clientes_production'
    try {
        const url = new URL(String(databaseUrl || '').trim())
        const query = new URLSearchParams(url.search)
        const allowedQueryKeys = new Set(['sslmode', 'uselibpqcompat', 'application_name'])
        for (const key of query.keys()) if (!allowedQueryKeys.has(key)) return false
        return url.protocol === 'postgresql:'
            && isLoopbackHost(url.hostname)
            && (url.port || '5432') === '5432'
            && decodeURIComponent(url.username || '') === ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_WRITER_CONTRACT.databaseRole
            && Boolean(url.password)
            && url.pathname === `/${database}`
            && query.get('sslmode') === 'require'
            && query.get('uselibpqcompat') === 'true'
    } catch {
        return false
    }
}

function writerError(code) {
    const error = new Error(code)
    error.code = code
    return error
}

function normalizedUuid(value, code = 'ATENDIMENTO_CRM_CORE_IDENTITY_WRITER_UUID_REQUIRED') {
    const normalized = String(value || '').trim().toLowerCase()
    if (!UUID_PATTERN.test(normalized)) throw writerError(code)
    return normalized
}

function exactKeys(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const actual = Object.keys(value).sort()
    const expected = [...keys].sort()
    return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function canonicalize(value) {
    if (value instanceof Date) return value.toISOString()
    if (Array.isArray(value)) return value.map(canonicalize)
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
    }
    return value
}

function digest(value) {
    return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`
}

function normalizeWriterInput(value = {}) {
    if (!exactKeys(value, ['runId', 'links'])) {
        throw writerError('ATENDIMENTO_CRM_CORE_IDENTITY_WRITER_INPUT_INVALID')
    }
    const { runId, links } = value
    const normalizedLinks = normalizeAtendimentoCrmCoreIdentityLinks(links)
    if (normalizedLinks.length === 0) {
        throw writerError('ATENDIMENTO_CRM_CORE_IDENTITY_WRITER_LINKS_REQUIRED')
    }
    return Object.freeze({
        runId: normalizedUuid(runId, 'ATENDIMENTO_CRM_CORE_IDENTITY_WRITER_RUN_ID_REQUIRED'),
        links: normalizedLinks,
    })
}

function inputDigest(links) {
    return digest({
        contract: ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_CONTRACT,
        writerContract: ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_WRITER_CONTRACT.version,
        links,
    })
}

function outputDigest(plan) {
    return digest({
        policyVersion: plan.policyVersion,
        confirmedLinks: plan.confirmedLinks,
        identityComponents: plan.identityComponents,
        excludedAttendanceIds: plan.excludedAttendanceIds,
    })
}

async function assertWriterIdentity(client, target) {
    const result = await client.query('select current_user as current_user, session_user as session_user')
    const currentUser = String(result.rows?.[0]?.current_user || '').trim()
    const sessionUser = String(result.rows?.[0]?.session_user || '').trim()
    if (!currentUser || !sessionUser || currentUser !== sessionUser) {
        throw writerError('ATENDIMENTO_CRM_CORE_IDENTITY_WRITER_IDENTITY_INVALID')
    }
    if (target !== ATENDIMENTO_MIGRATION_TARGETS.LOCAL
        && (currentUser !== ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_WRITER_CONTRACT.databaseRole
            || sessionUser !== ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_WRITER_CONTRACT.databaseRole)) {
        throw writerError('ATENDIMENTO_CRM_CORE_IDENTITY_WRITER_IDENTITY_INVALID')
    }
    return currentUser
}

async function assertWriterDestination(client, databaseUrl, target) {
    if (!isStrictWriterDestination(databaseUrl, target)) {
        throw writerError('ATENDIMENTO_CRM_CORE_IDENTITY_WRITER_DESTINATION_UNSAFE')
    }
    const result = await client.query(`select current_database() as database_name, current_user as database_user,
        session_user as session_user, current_setting('transaction_read_only') as read_only`)
    const row = result.rows?.[0] || {}
    const expectedDatabase = target === ATENDIMENTO_MIGRATION_TARGETS.STAGING
        ? 'skincos_staging'
        : target === ATENDIMENTO_MIGRATION_TARGETS.PRODUCTION
            ? 'skincos_clientes_production'
            : 'skincos_crm_local'
    const expectedUser = target === ATENDIMENTO_MIGRATION_TARGETS.LOCAL
        ? 'admin'
        : ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_WRITER_CONTRACT.databaseRole
    if (row.database_name !== expectedDatabase
        || row.database_user !== expectedUser
        || row.session_user !== expectedUser
        || String(row.read_only || '').toLowerCase() === 'on') {
        throw writerError('ATENDIMENTO_CRM_CORE_IDENTITY_WRITER_DESTINATION_UNSAFE')
    }
    return Object.freeze({ database: expectedDatabase, user: expectedUser, target })
}

async function readExistingRun(client, runId) {
    const result = await client.query(`select id::text as run_id, writer_contract, policy_version, input_digest, output_digest,
        status, confirmed_link_count, identity_count
        from ${ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_RUNS_RELATION}
        where id = $1::uuid
        for update`, [runId])
    return result.rows?.[0] || null
}

function existingRunReport(row, request, requestedInputDigest) {
    if (row.writer_contract !== ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_WRITER_CONTRACT.version
        || row.policy_version !== ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_CONTRACT
        || row.input_digest !== requestedInputDigest
        || row.status !== 'applied'
        || !SHA256_PATTERN.test(String(row.output_digest || '').toLowerCase())
        || !Number.isSafeInteger(Number(row.confirmed_link_count))
        || Number(row.confirmed_link_count) < 0
        || !Number.isSafeInteger(Number(row.identity_count))
        || Number(row.identity_count) < 0) {
        throw writerError('ATENDIMENTO_CRM_CORE_IDENTITY_WRITER_RUN_REUSE_CONFLICT')
    }
    return Object.freeze({
        runId: request.runId,
        inputDigest: requestedInputDigest,
        outputDigest: String(row.output_digest).toLowerCase(),
        confirmedLinkCount: Number(row.confirmed_link_count),
        identityCount: Number(row.identity_count),
        applied: true,
        idempotent: true,
    })
}

async function readPersistedLinks(client, links) {
    const attendanceIds = links.map((link) => link.attendanceId)
    const result = await client.query(`select attendance_id::text as "attendanceId",
            canonical_client_id::text as "canonicalClientId", status, method,
            evidence_digest as "evidenceDigest", source_revision as "sourceRevision"
        from ${ATENDIMENTO_CRM_CORE_ATTENDANCE_LINKS_RELATION}
        where attendance_id = any($1::uuid[])
        order by attendance_id asc
        for update`, [attendanceIds])
    return result.rows || []
}

async function insertIdentityClient(client, canonicalClientId) {
    const result = await client.query(`insert into ${ATENDIMENTO_CRM_CORE_IDENTITY_CLIENTS_RELATION}(id)
        values ($1::uuid)
        on conflict (id) do nothing`, [canonicalClientId])
    if (!Number.isSafeInteger(result.rowCount) || result.rowCount < 0 || result.rowCount > 1) {
        throw writerError('ATENDIMENTO_CRM_CORE_IDENTITY_WRITER_CLIENT_WRITE_INVALID')
    }
}

async function upsertLink(client, link) {
    const result = await client.query(`insert into ${ATENDIMENTO_CRM_CORE_ATTENDANCE_LINKS_RELATION}
            (attendance_id, canonical_client_id, status, method, evidence_digest, source_revision)
        values ($1::uuid, $2::uuid, $3, $4, $5, $6)
        on conflict (attendance_id) do update set
            canonical_client_id = excluded.canonical_client_id,
            status = excluded.status,
            method = excluded.method,
            evidence_digest = excluded.evidence_digest,
            source_revision = excluded.source_revision,
            updated_at = clock_timestamp()
        where ${ATENDIMENTO_CRM_CORE_ATTENDANCE_LINKS_RELATION}.source_revision <= excluded.source_revision
        returning attendance_id::text as attendance_id`, [
        link.attendanceId,
        link.canonicalClientId,
        link.status,
        link.method,
        link.evidenceDigest,
        link.sourceRevision,
    ])
    if (result.rowCount !== 1 || String(result.rows?.[0]?.attendance_id || '').toLowerCase() !== link.attendanceId) {
        throw writerError('ATENDIMENTO_CRM_CORE_IDENTITY_WRITER_LINK_WRITE_INVALID')
    }
}

async function upsertIdentity(client, component) {
    const result = await client.query(`insert into ${ATENDIMENTO_CRM_CORE_IDENTITIES_RELATION}
            (canonical_client_id, component_key, policy_version)
        values ($1::uuid, $2, $3)
        on conflict (canonical_client_id) do update set
            updated_at = clock_timestamp()
        where ${ATENDIMENTO_CRM_CORE_IDENTITIES_RELATION}.component_key = excluded.component_key
          and ${ATENDIMENTO_CRM_CORE_IDENTITIES_RELATION}.state = 'active'
        returning id::text as identity_id, canonical_client_id::text as canonical_client_id`, [
        component.sourceId,
        atendimentoCrmCoreIdentityComponentKey(component.sourceId),
        ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_CONTRACT,
    ])
    const identityId = String(result.rows?.[0]?.identity_id || '').toLowerCase()
    const canonicalClientId = String(result.rows?.[0]?.canonical_client_id || '').toLowerCase()
    if (result.rowCount !== 1 || !UUID_PATTERN.test(identityId) || canonicalClientId !== component.sourceId) {
        throw writerError('ATENDIMENTO_CRM_CORE_IDENTITY_WRITER_IDENTITY_WRITE_INVALID')
    }
    return identityId
}

async function upsertIdentityMember(client, { identityId, sourceId }) {
    const result = await client.query(`insert into ${ATENDIMENTO_CRM_CORE_IDENTITY_MEMBERS_RELATION}
            (identity_id, source_type, source_id)
        values ($1::uuid, $2, $3::uuid)
        on conflict (source_type, source_id) do update set
            updated_at = clock_timestamp()
        where ${ATENDIMENTO_CRM_CORE_IDENTITY_MEMBERS_RELATION}.identity_id = excluded.identity_id
        returning identity_id::text as identity_id, source_id::text as source_id`, [
        identityId,
        ATENDIMENTO_CRM_CORE_IDENTITY_RECONCILIATION_POLICY.sourceType,
        sourceId,
    ])
    if (result.rowCount !== 1
        || String(result.rows?.[0]?.identity_id || '').toLowerCase() !== identityId
        || String(result.rows?.[0]?.source_id || '').toLowerCase() !== sourceId) {
        throw writerError('ATENDIMENTO_CRM_CORE_IDENTITY_WRITER_MEMBER_WRITE_INVALID')
    }
}

async function appendRunLedger(client, { request, requestedInputDigest, requestedOutputDigest, plan }) {
    const result = await client.query(`insert into ${ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_RUNS_RELATION}
            (id, writer_contract, policy_version, input_digest, output_digest, status, confirmed_link_count, identity_count)
        values ($1::uuid, $2, $3, $4, $5, 'applied', $6, $7)
        returning id::text as run_id`, [
        request.runId,
        ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_WRITER_CONTRACT.version,
        ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_CONTRACT,
        requestedInputDigest,
        requestedOutputDigest,
        plan.confirmedLinks.length,
        plan.identityComponents.length,
    ])
    if (result.rowCount !== 1 || String(result.rows?.[0]?.run_id || '').toLowerCase() !== request.runId) {
        throw writerError('ATENDIMENTO_CRM_CORE_IDENTITY_WRITER_LEDGER_WRITE_INVALID')
    }
}

/**
 * Explicit, opt-in source materialization for a future custody workflow.
 *
 * This module has no CLI, scheduler, route registration, environment lookup,
 * or default invocation. It accepts only an explicit UUID run id and explicit
 * UUID links; it never reads or derives a client name. Production and staging
 * require a separately provisioned, least-privilege DB principal.
 */
export async function materializeAtendimentoCrmCoreIdentityLinks({
    pool,
    databaseUrl,
    target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL,
    runId,
    links,
} = {}) {
    if (!pool) throw writerError('ATENDIMENTO_CRM_CORE_IDENTITY_WRITER_POOL_REQUIRED')
    if (!isStrictWriterDestination(databaseUrl, target)) {
        throw writerError('ATENDIMENTO_CRM_CORE_IDENTITY_WRITER_DESTINATION_UNSAFE')
    }
    const request = normalizeWriterInput({ runId, links })
    const requestedInputDigest = inputDigest(request.links)
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin isolation level repeatable read')
        transactionOpen = true
        await client.query(`set local lock_timeout = '3s'`)
        await client.query(`set local statement_timeout = '60s'`)
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [IDENTITY_GRAPH_LOCK_KEY])
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`${WRITER_LOCK_NAMESPACE}:${request.runId}`])
        await assertWriterDestination(client, databaseUrl, target)
        const preflight = await inspectAtendimentoCrmCoreIdentityMaterializationPreflight(client)
        assertAtendimentoCrmCoreIdentityMaterializationRuntimePreflight(preflight)
        await assertWriterIdentity(client, target)
        const existing = await readExistingRun(client, request.runId)
        if (existing) {
            const report = existingRunReport(existing, request, requestedInputDigest)
            await client.query('commit')
            transactionOpen = false
            return report
        }
        const persistedLinks = await readPersistedLinks(client, request.links)
        const plan = reconcileAtendimentoCrmCoreIdentityLinks({ links: request.links, persistedLinks })
        for (const canonicalClientId of new Set(request.links.map((link) => link.canonicalClientId))) {
            await insertIdentityClient(client, canonicalClientId)
        }
        for (const link of request.links) await upsertLink(client, link)
        for (const component of plan.identityComponents) {
            const identityId = await upsertIdentity(client, component)
            await upsertIdentityMember(client, { identityId, sourceId: component.sourceId })
        }
        const requestedOutputDigest = outputDigest(plan)
        await appendRunLedger(client, { request, requestedInputDigest, requestedOutputDigest, plan })
        await client.query('commit')
        transactionOpen = false
        return Object.freeze({
            runId: request.runId,
            inputDigest: requestedInputDigest,
            outputDigest: requestedOutputDigest,
            confirmedLinkCount: plan.confirmedLinks.length,
            identityCount: plan.identityComponents.length,
            applied: true,
            idempotent: false,
        })
    } catch (error) {
        if (transactionOpen) {
            try { await client.query('rollback') } catch { /* preserve the materialization error */ }
        }
        throw error
    } finally {
        client.release()
    }
}

export const __testables = Object.freeze({
    normalizeWriterInput,
    inputDigest,
    outputDigest,
})
