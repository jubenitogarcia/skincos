import assert from 'node:assert/strict'
import test from 'node:test'

import {
    ATENDIMENTO_CRM_CORE_PROJECTION_SOURCE_PRIVILEGE_SQL,
    ATENDIMENTO_CRM_CORE_PROJECTION_SOURCE_TRANSACTION_SQL,
    ATENDIMENTO_CRM_CORE_PROJECTION_SOURCE_FORBIDDEN_WRITE_PRIVILEGES,
    AtendimentoProjectionSourceMetadataPreflightError,
    preflightAtendimentoProjectionSourceMetadata,
} from '../projectionSourceMetadataPreflight.js'
import {
    ATENDIMENTO_PROJECTION_EXPORT_IDENTITY_SQL,
    ATENDIMENTO_PROJECTION_EXPORT_SNAPSHOT_SQL,
} from '../../../../../integration/atendimento/crm-core-projection-exporter/src/atendimentoProjectionExporter.mjs'
import { ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS } from '../../../../../shared/crm-auth/atendimentoCrmCoreIdentityMaterializationPolicy.js'

const relationColumn = (relation) => relation.replace(/^crm_atendimento\./, '').replace(/[^a-z0-9]+/gi, '_')
const sourceMetadata = Object.freeze(Object.fromEntries([
    ...ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS.flatMap((relation) => {
        const column = relationColumn(relation)
        return [
            [`${column}_exists`, true],
            [`${column}_select`, true],
            ...ATENDIMENTO_CRM_CORE_PROJECTION_SOURCE_FORBIDDEN_WRITE_PRIVILEGES.map((privilege) => [`${column}_${privilege.toLowerCase()}`, false]),
        ]
    }),
    ['finance_sales_select', false],
]))

function createPool({ metadata = sourceMetadata, identity, snapshot, count = 3 } = {}) {
    const calls = []
    const client = {
        released: false,
        async query(sql) {
            calls.push(sql)
            if (sql === 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY') return { rows: [] }
            if (sql === 'ROLLBACK') return { rows: [] }
            if (sql === ATENDIMENTO_CRM_CORE_PROJECTION_SOURCE_PRIVILEGE_SQL) return { rows: [metadata] }
            if (sql === ATENDIMENTO_CRM_CORE_PROJECTION_SOURCE_TRANSACTION_SQL) {
                return { rows: [{ transaction_isolation: 'repeatable read', transaction_read_only: 'on' }] }
            }
            if (sql === ATENDIMENTO_PROJECTION_EXPORT_IDENTITY_SQL) {
                return { rows: [identity || {
                    database_name: 'skincos_clientes_production',
                    current_user: 'crm_core_projection_exporter',
                    session_user: 'crm_core_projection_exporter',
                    transaction_read_only: 'on',
                }] }
            }
            if (sql === ATENDIMENTO_PROJECTION_EXPORT_SNAPSHOT_SQL) return { rows: [snapshot || { captured_at: '2026-09-15T12:00:00.000Z' }] }
            if (/count\(\*\)::int as row_count/i.test(sql)) return { rows: [{ row_count: count }] }
            throw new Error(`unexpected query: ${sql}`)
        },
        release() {
            this.released = true
        },
    }
    return { pool: { async connect() { return client } }, client, calls }
}

test('creates only a sanitized receipt from the exact read-only Atendimento source', async () => {
    const { pool, client, calls } = createPool()
    const receipt = await preflightAtendimentoProjectionSourceMetadata({ pool })

    assert.equal(receipt.status, 'source-metadata-verified')
    assert.equal(receipt.snapshot.rowCount, 3)
    assert.equal(receipt.source.owner, 'atendimento')
    assert.deepEqual(receipt.source.excludedDomains, ['finance'])
    assert.match(receipt.source.profileDigest, /^sha256:[0-9a-f]{64}$/)
    assert.deepEqual(receipt.execution, {
        sourceReadExecutionAllowed: false,
        deliveryAllowed: false,
        productionMutationAllowed: false,
        publicRouteMutationAllowed: false,
        legacyPublisherMutationAllowed: false,
    })
    assert.equal(client.released, true)
    assert.equal(calls[0], 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    assert.equal(calls.at(-1), 'ROLLBACK')
    assert.ok(calls.includes(ATENDIMENTO_CRM_CORE_PROJECTION_SOURCE_PRIVILEGE_SQL))
    assert.ok(calls.includes(ATENDIMENTO_CRM_CORE_PROJECTION_SOURCE_TRANSACTION_SQL))
    assert.ok(calls.includes(ATENDIMENTO_PROJECTION_EXPORT_IDENTITY_SQL))
    assert.ok(calls.includes(ATENDIMENTO_PROJECTION_EXPORT_SNAPSHOT_SQL))
    assert.equal(calls.some((sql) => /\bcommit\b/i.test(sql)), false)
    assert.equal(calls.some((sql) => /^\s*(?:insert|update|delete|truncate|alter|create|drop)\b/im.test(sql)), false)
    assert.equal(JSON.stringify(receipt).includes('crm_caixa.sales'), false)
})

test('refuses missing source grants, source write grants, and any Finance read grant', async () => {
    for (const metadata of [
        { ...sourceMetadata, attendances_select: false },
        { ...sourceMetadata, units_update: true },
        { ...sourceMetadata, finance_sales_select: true },
    ]) {
        const { pool, client, calls } = createPool({ metadata })
        await assert.rejects(
            () => preflightAtendimentoProjectionSourceMetadata({ pool }),
            (error) => error instanceof AtendimentoProjectionSourceMetadataPreflightError
                && /ATENDIMENTO_CRM_PROJECTION_SOURCE_METADATA_(?:GRANTS_UNSAFE|FINANCE_GRANT_FORBIDDEN)/.test(error.code),
        )
        assert.equal(client.released, true)
        assert.equal(calls.at(-1), 'ROLLBACK')
    }
})

test('refuses a transaction that is not repeatable-read and read-only before source rows are counted', async () => {
    const { pool, client, calls } = createPool()
    client.query = async (sql) => {
        calls.push(sql)
        if (sql === 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY' || sql === 'ROLLBACK') return { rows: [] }
        if (sql === ATENDIMENTO_CRM_CORE_PROJECTION_SOURCE_PRIVILEGE_SQL) return { rows: [sourceMetadata] }
        if (sql === ATENDIMENTO_CRM_CORE_PROJECTION_SOURCE_TRANSACTION_SQL) {
            return { rows: [{ transaction_isolation: 'read committed', transaction_read_only: 'on' }] }
        }
        throw new Error(`source query must not run: ${sql}`)
    }
    await assert.rejects(
        () => preflightAtendimentoProjectionSourceMetadata({ pool }),
        (error) => error?.code === 'ATENDIMENTO_CRM_PROJECTION_SOURCE_METADATA_TRANSACTION_UNSAFE',
    )
    assert.equal(client.released, true)
    assert.equal(calls.at(-1), 'ROLLBACK')
})
