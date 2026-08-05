import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
    assertIdentityMaterializationApplyCheckpoint,
    assertIdentityMaterializationDatabase,
    assertIdentityMaterializationDestination,
    assertIdentityMaterializationSchemaReady,
    CLIENT_IDENTITY_MATERIALIZATION_SCHEMA_MIGRATION_ID,
    CLIENT_IDENTITY_MATERIALIZATION_TARGET,
    fingerprintIdentityMaterializationSource,
    identityMaterializationCheckpoint,
} from '../identityMaterializationSafety.js'

const LOCAL_SOCKET_URL = 'postgresql:///skincos_crm_local?host=/var/run/postgresql'

test('allows only the dedicated private mirror socket for materialization', () => {
    assert.doesNotThrow(() => assertIdentityMaterializationDestination(LOCAL_SOCKET_URL))
    assert.throws(
        () => assertIdentityMaterializationDestination('postgresql://admin@127.0.0.1:5432/skincos_crm_local'),
        (error) => error?.code === 'IDENTITY_MATERIALIZATION_DESTINATION_UNSAFE',
    )
})

test('checks the connected database identity and an active schema migration', async () => {
    const calls = []
    const client = {
        async query(sql, params = []) {
            calls.push({ sql, params })
            if (/current_database\(\)/i.test(sql)) {
                return { rows: [{ database_name: CLIENT_IDENTITY_MATERIALIZATION_TARGET, database_user: 'admin', read_only: 'off' }] }
            }
            if (/to_regclass\('crm_atendimento\.schema_migrations'\)/i.test(sql)) {
                return { rows: [{ registry: 'crm_atendimento.schema_migrations' }] }
            }
            return { rows: [{ id: CLIENT_IDENTITY_MATERIALIZATION_SCHEMA_MIGRATION_ID }] }
        },
    }

    await assertIdentityMaterializationDatabase(client, LOCAL_SOCKET_URL)
    await assertIdentityMaterializationSchemaReady(client)
    assert.equal(calls.some(({ sql }) => /current_database\(\)/i.test(sql)), true)
    assert.equal(calls.some(({ sql }) => /schema_migrations/i.test(sql)), true)
})

test('refuses materialization when the schema migration is absent', async () => {
    await assert.rejects(
        () => assertIdentityMaterializationSchemaReady({
            async query(sql) {
                if (/to_regclass/i.test(sql)) return { rows: [{ registry: 'crm_atendimento.schema_migrations' }] }
                return { rows: [] }
            },
        }),
        (error) => error?.code === 'IDENTITY_MATERIALIZATION_SCHEMA_MIGRATION_REQUIRED',
    )
})

test('requires an exact checkpoint, confirmation and target confirmation before apply', async () => {
    const sourceFingerprint = fingerprintIdentityMaterializationSource({ source: ['a', 'b'] })
    const directory = await mkdtemp(path.join(tmpdir(), 'skincos-identity-checkpoint-'))
    const checkpointFile = path.join(directory, 'checkpoint.json')
    try {
        await writeFile(checkpointFile, `${JSON.stringify(identityMaterializationCheckpoint({
            operation: 'client_identity_reconciliation', sourceFingerprint,
        }))}\n`)
        const checkpoint = await assertIdentityMaterializationApplyCheckpoint({
            operation: 'client_identity_reconciliation',
            confirmation: 'UNIFICAR',
            targetConfirmation: CLIENT_IDENTITY_MATERIALIZATION_TARGET,
            checkpointFile,
            sourceFingerprint,
        })
        assert.equal(checkpoint.sourceFingerprint, sourceFingerprint)

        await assert.rejects(
            () => assertIdentityMaterializationApplyCheckpoint({
                operation: 'client_identity_reconciliation',
                confirmation: 'UNIFICAR',
                targetConfirmation: 'other',
                checkpointFile,
                sourceFingerprint,
            }),
            (error) => error?.code === 'IDENTITY_MATERIALIZATION_APPLY_TARGET_CONFIRMATION_REQUIRED',
        )
        await assert.rejects(
            () => assertIdentityMaterializationApplyCheckpoint({
                operation: 'client_identity_reconciliation',
                confirmation: 'UNIFICAR',
                targetConfirmation: CLIENT_IDENTITY_MATERIALIZATION_TARGET,
                checkpointFile,
                sourceFingerprint: 'sha256:changed',
            }),
            (error) => error?.code === 'IDENTITY_MATERIALIZATION_CHECKPOINT_MISMATCH',
        )
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})

test('source fingerprints are independent of object-key ordering', () => {
    assert.equal(
        fingerprintIdentityMaterializationSource({ source: { b: 2, a: 1 } }),
        fingerprintIdentityMaterializationSource({ source: { a: 1, b: 2 } }),
    )
})
