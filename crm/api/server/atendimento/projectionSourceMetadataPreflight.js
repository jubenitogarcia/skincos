import { createHash } from 'node:crypto'

import {
    ATENDIMENTO_CRM_PROJECTION_MAX_ROWS,
    ATENDIMENTO_PROJECTION_EXPORTER_DATABASE,
    preflightAtendimentoProjectionSource,
} from '../../../../integration/atendimento/crm-core-projection-exporter/src/atendimentoProjectionExporter.mjs'
import {
    ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE,
    ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE_SEMANTICS,
    ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE_VERSION,
} from '../../../../integration/atendimento/crm-core-projection-exporter/src/atendimentoConfirmedUnitScopedProjectionSource.mjs'
import {
    ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS,
} from '../../../../shared/crm-auth/atendimentoCrmCoreIdentityMaterializationPolicy.js'

export const ATENDIMENTO_CRM_CORE_PROJECTION_SOURCE_METADATA_PREFLIGHT_CONTRACT = 'skincos/atendimento-crm-core-projection-source-metadata-preflight/v1'

// PostgreSQL treats a comma-delimited privilege list as an any-of predicate.
// Keep one independently checked column for every mutable table privilege so
// a role with only one unintended write capability still fails closed.
export const ATENDIMENTO_CRM_CORE_PROJECTION_SOURCE_FORBIDDEN_WRITE_PRIVILEGES = Object.freeze([
    'INSERT',
    'UPDATE',
    'DELETE',
    'TRUNCATE',
    'REFERENCES',
    'TRIGGER',
])
const FINANCE_SALES_RELATION = 'crm_caixa.sales'
const EXPECTED_DATABASE = ATENDIMENTO_PROJECTION_EXPORTER_DATABASE.database
const EXPECTED_PRINCIPAL = ATENDIMENTO_PROJECTION_EXPORTER_DATABASE.user

const relationColumn = (relation) => relation.replace(/^crm_atendimento\./, '').replace(/[^a-z0-9]+/gi, '_')
const relationMetadataSql = ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS.map((relation) => {
    const column = relationColumn(relation)
    const writeChecks = ATENDIMENTO_CRM_CORE_PROJECTION_SOURCE_FORBIDDEN_WRITE_PRIVILEGES.map((privilege) => `
        coalesce(has_table_privilege(current_user, to_regclass('${relation}'), '${privilege}'), false) as ${column}_${privilege.toLowerCase()}`)
    return `
        to_regclass('${relation}') is not null as ${column}_exists,
        coalesce(has_table_privilege(current_user, to_regclass('${relation}'), 'SELECT'), false) as ${column}_select,${writeChecks.join(',')}`
})

export const ATENDIMENTO_CRM_CORE_PROJECTION_SOURCE_PRIVILEGE_SQL = `SELECT${relationMetadataSql.join(',')},
    coalesce(has_table_privilege(current_user, to_regclass('${FINANCE_SALES_RELATION}'), 'SELECT'), false) as finance_sales_select`

export const ATENDIMENTO_CRM_CORE_PROJECTION_SOURCE_TRANSACTION_SQL = `SELECT
    current_setting('transaction_isolation') as transaction_isolation,
    current_setting('transaction_read_only') as transaction_read_only`

export class AtendimentoProjectionSourceMetadataPreflightError extends Error {
    constructor(code) {
        super(code)
        this.code = code
    }
}

function fail(code) {
    throw new AtendimentoProjectionSourceMetadataPreflightError(code)
}

function exactObject(value, keys, code) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code)
    const actual = Object.keys(value).sort()
    const expected = [...keys].sort()
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code)
    return value
}

function boolean(value, code) {
    if (typeof value !== 'boolean') fail(code)
    return value
}

function text(value, code) {
    const normalized = String(value ?? '').trim()
    if (!normalized) fail(code)
    return normalized
}

function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical)
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    }
    return value
}

function sha256(value) {
    return `sha256:${createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}`
}

function assertCanonicalSource() {
    const source = ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE
    const semantics = ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE_SEMANTICS
    if (
        source?.contract !== 'atendimento/crm-core/unit-scoped-projection-source/v1'
        || semantics?.version !== ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE_VERSION
        || !Array.isArray(semantics?.sourceRelationAllowlist)
        || semantics.sourceRelationAllowlist.length !== ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS.length
        || semantics.sourceRelationAllowlist.some((relation, index) => relation !== ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS[index])
        || !Array.isArray(semantics?.excludedDomains)
        || semantics.excludedDomains.length !== 1
        || semantics.excludedDomains[0] !== 'finance'
    ) {
        fail('ATENDIMENTO_CRM_PROJECTION_SOURCE_METADATA_CONTRACT_INVALID')
    }
    return Object.freeze({ source, semantics })
}

function assertPrivilegeProfile(value) {
    const keys = ['finance_sales_select']
    for (const relation of ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS) {
        const column = relationColumn(relation)
        keys.push(`${column}_exists`, `${column}_select`)
        for (const privilege of ATENDIMENTO_CRM_CORE_PROJECTION_SOURCE_FORBIDDEN_WRITE_PRIVILEGES) {
            keys.push(`${column}_${privilege.toLowerCase()}`)
        }
    }
    const row = exactObject(value, keys, 'ATENDIMENTO_CRM_PROJECTION_SOURCE_METADATA_GRANTS_INVALID')
    if (boolean(row.finance_sales_select, 'ATENDIMENTO_CRM_PROJECTION_SOURCE_METADATA_GRANTS_INVALID')) {
        fail('ATENDIMENTO_CRM_PROJECTION_SOURCE_METADATA_FINANCE_GRANT_FORBIDDEN')
    }
    for (const relation of ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS) {
        const column = relationColumn(relation)
        if (
            !boolean(row[`${column}_exists`], 'ATENDIMENTO_CRM_PROJECTION_SOURCE_METADATA_GRANTS_INVALID')
            || !boolean(row[`${column}_select`], 'ATENDIMENTO_CRM_PROJECTION_SOURCE_METADATA_GRANTS_INVALID')
            || ATENDIMENTO_CRM_CORE_PROJECTION_SOURCE_FORBIDDEN_WRITE_PRIVILEGES.some((privilege) => (
                boolean(row[`${column}_${privilege.toLowerCase()}`], 'ATENDIMENTO_CRM_PROJECTION_SOURCE_METADATA_GRANTS_INVALID')
            ))
        ) {
            fail('ATENDIMENTO_CRM_PROJECTION_SOURCE_METADATA_GRANTS_UNSAFE')
        }
    }
}

function assertTransaction(value) {
    const row = exactObject(value, ['transaction_isolation', 'transaction_read_only'], 'ATENDIMENTO_CRM_PROJECTION_SOURCE_METADATA_TRANSACTION_INVALID')
    const isolation = text(row.transaction_isolation, 'ATENDIMENTO_CRM_PROJECTION_SOURCE_METADATA_TRANSACTION_INVALID').toLowerCase()
    const readOnly = text(row.transaction_read_only, 'ATENDIMENTO_CRM_PROJECTION_SOURCE_METADATA_TRANSACTION_INVALID').toLowerCase()
    if (isolation !== 'repeatable read' || readOnly !== 'on') {
        fail('ATENDIMENTO_CRM_PROJECTION_SOURCE_METADATA_TRANSACTION_UNSAFE')
    }
}

function sanitizedReceipt(preflight, semantics) {
    const identity = preflight?.identity
    if (
        identity?.database !== EXPECTED_DATABASE
        || identity?.currentUser !== EXPECTED_PRINCIPAL
        || identity?.sessionUser !== EXPECTED_PRINCIPAL
        || identity?.readOnly !== 'on'
        || !Number.isSafeInteger(preflight?.rowCount)
        || preflight.rowCount < 0
        || preflight.rowCount > ATENDIMENTO_CRM_PROJECTION_MAX_ROWS
    ) {
        fail('ATENDIMENTO_CRM_PROJECTION_SOURCE_METADATA_RECEIPT_INVALID')
    }
    const source = Object.freeze({
        owner: 'atendimento',
        semantics: ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE_VERSION,
        relationAllowlist: Object.freeze([...ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS]),
        excludedDomains: Object.freeze([...semantics.excludedDomains]),
        profileDigest: sha256({
            semantics: ATENDIMENTO_CONFIRMED_UNIT_SCOPED_PROJECTION_SOURCE_VERSION,
            relationAllowlist: ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS,
            excludedDomains: semantics.excludedDomains,
            countSql: preflight.source.countSql,
        }),
    })
    return Object.freeze({
        contract: ATENDIMENTO_CRM_CORE_PROJECTION_SOURCE_METADATA_PREFLIGHT_CONTRACT,
        status: 'source-metadata-verified',
        source,
        snapshot: Object.freeze({ capturedAt: preflight.capturedAt, rowCount: preflight.rowCount }),
        principal: Object.freeze({ database: EXPECTED_DATABASE, name: EXPECTED_PRINCIPAL, sessionName: EXPECTED_PRINCIPAL }),
        execution: Object.freeze({
            sourceReadExecutionAllowed: false,
            deliveryAllowed: false,
            productionMutationAllowed: false,
            publicRouteMutationAllowed: false,
            legacyPublisherMutationAllowed: false,
        }),
    })
}

/**
 * Inspects only the fixed Atendimento-owned projection source inside one
 * caller-supplied PostgreSQL client. It begins and always rolls back a
 * REPEATABLE READ READ ONLY transaction; it neither exports rows nor changes
 * source, Core, routing, credentials, or runtime state.
 */
export async function preflightAtendimentoProjectionSourceMetadata({ pool } = {}) {
    if (!pool || typeof pool.connect !== 'function') fail('ATENDIMENTO_CRM_PROJECTION_SOURCE_METADATA_POOL_INVALID')
    const { source, semantics } = assertCanonicalSource()
    const client = await pool.connect()
    if (!client || typeof client.query !== 'function' || typeof client.release !== 'function') {
        fail('ATENDIMENTO_CRM_PROJECTION_SOURCE_METADATA_CLIENT_INVALID')
    }
    let transactionOpen = false
    try {
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        transactionOpen = true

        const privileges = await client.query(ATENDIMENTO_CRM_CORE_PROJECTION_SOURCE_PRIVILEGE_SQL)
        assertPrivilegeProfile(privileges?.rows?.[0])

        const transaction = await client.query(ATENDIMENTO_CRM_CORE_PROJECTION_SOURCE_TRANSACTION_SQL)
        assertTransaction(transaction?.rows?.[0])

        const preflight = await preflightAtendimentoProjectionSource(client, {
            maxRows: ATENDIMENTO_CRM_PROJECTION_MAX_ROWS,
            source,
        })
        const receipt = sanitizedReceipt(preflight, semantics)

        await client.query('ROLLBACK')
        transactionOpen = false
        return receipt
    } catch (error) {
        if (transactionOpen) {
            try {
                await client.query('ROLLBACK')
            } catch {
                // The source operation already fails closed. Never substitute a
                // successful receipt when the transaction cannot be closed.
            }
        }
        throw error
    } finally {
        client.release()
    }
}
