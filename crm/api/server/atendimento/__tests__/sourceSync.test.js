import assert from 'node:assert/strict'
import test from 'node:test'

import {
    assertAtendimentoSourceSyncSchema,
    assertAtendimentoSourceSyncDatabaseIdentity,
    assertAtendimentoSourceSyncDatabaseUrl,
    assertPrivateSourceCredentialPath,
    atendimentoSourceFingerprint,
    runAtendimentoSourceSync,
} from '../sourceSync.js'

const PRODUCTION_URL = 'postgresql://skincos_clientes_migrator_login:synthetic@127.0.0.1:5432/skincos_clientes_production?sslmode=require&uselibpqcompat=true&application_name=source-sync'
const SOURCE_CREDENTIAL_FILE = '/etc/skincos/google-atendimento-source.json'

function fakePool() {
    const calls = []
    const client = {
        async query(sql, params) {
            calls.push({ sql, params })
            if (sql.includes('current_database')) {
                return { rows: [{ database_name: 'skincos_clientes_production', current_user: 'skincos_clientes_migrator_login', session_user: 'skincos_clientes_migrator_login', transaction_read_only: 'off' }] }
            }
            return { rows: [{ acquired: true }] }
        },
        release() {},
    }
    return {
        calls,
        async connect() { return client },
        async query(sql) {
            calls.push({ sql, params: [] })
            if (sql.includes('select summary')) return { rows: [] }
            if (sql.includes('count(*)')) return { rows: [{ total: 0 }] }
            return { rows: [] }
        },
    }
}

function syntheticSnapshot() {
    return {
        spreadsheetId: 'synthetic-sheet-id',
        tabs: ['Novo Hamburgo', 'BarraShoppingSul'],
        records: [{
            date: '2026-08-18',
            unitSlug: 'novo-hamburgo',
            unitName: 'Novo Hamburgo',
            clientName: 'synthetic-client',
            procedureName: 'synthetic-procedure',
            code: '#0001',
            quantity: 1,
            sourceSheetId: 'synthetic-sheet-id',
            sourceTab: 'Novo Hamburgo',
            sourceRow: 3,
        }],
        cache: { professionals: [], procedures: [], procedureCodes: [], schedules: [] },
    }
}

test('accepts only the dedicated migrator database contract', () => {
    assert.deepEqual(assertAtendimentoSourceSyncDatabaseUrl(PRODUCTION_URL, 'production'), {
        target: 'production', database: 'skincos_clientes_production', user: 'skincos_clientes_migrator_login',
    })
    assert.throws(
        () => assertAtendimentoSourceSyncDatabaseUrl('postgresql://skincos_clientes_ro:synthetic@127.0.0.1:5432/skincos_clientes_production?sslmode=require', 'production'),
        { code: 'ATENDIMENTO_SOURCE_SYNC_DATABASE_URL_UNSAFE' },
    )
    assert.throws(() => assertPrivateSourceCredentialPath('/tmp/google-sa.json'), { code: 'ATENDIMENTO_SOURCE_SYNC_SOURCE_CREDENTIAL_UNSAFE' })
})

test('rejects a read-only or mismatched production identity before source work', () => {
    assert.deepEqual(assertAtendimentoSourceSyncDatabaseIdentity({
        database_name: 'skincos_clientes_production',
        current_user: 'skincos_clientes_migrator_login',
        session_user: 'skincos_clientes_migrator_login',
        transaction_read_only: 'off',
    }, 'production').database, 'skincos_clientes_production')
    assert.throws(() => assertAtendimentoSourceSyncDatabaseIdentity({
        database_name: 'skincos_clientes_production',
        current_user: 'skincos_clientes_ro',
        session_user: 'skincos_clientes_ro',
        transaction_read_only: 'on',
    }, 'production'), { code: 'ATENDIMENTO_SOURCE_SYNC_DATABASE_IDENTITY_UNSAFE' })
})

test('fails closed when the dedicated schema is not ready', async () => {
    await assert.rejects(
        () => assertAtendimentoSourceSyncSchema({
            async query() {
                return { rows: [{ relation: 'crm_atendimento.attendances', resolved: null }] }
            },
        }),
        { code: 'ATENDIMENTO_SOURCE_SYNC_SCHEMA_NOT_READY' },
    )
})

test('dry-run validates the source without creating a backup or writing attendance rows', async () => {
    const pool = fakePool()
    const snapshot = syntheticSnapshot()
    const calls = []
    const report = await runAtendimentoSourceSync({
        pool,
        databaseUrl: PRODUCTION_URL,
        target: 'production',
        action: 'dry-run',
        sourceReader: async () => snapshot,
        storeFactory: () => ({
            async importRecords(input) {
                calls.push(input)
                return { dryRun: input.dryRun, records: input.records.length, inserted: 0, updated: 0, skipped: 0 }
            },
        }),
        backupFactory: async () => { throw new Error('backup must not run during dry-run') },
        checkpointReader: async () => false,
        schemaReader: async () => {},
        serviceAccountFile: SOURCE_CREDENTIAL_FILE,
    })
    assert.equal(report.ok, true)
    assert.equal(report.dryRun, true)
    assert.equal(report.records, 1)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].dryRun, true)
    assert.match(report.sourceFingerprint, /^sha256:[a-f0-9]{64}$/)
    assert.doesNotMatch(JSON.stringify(report), /synthetic-client/)
})

test('apply requires confirmation, backups first, and writes only after the source validation', async () => {
    const pool = fakePool()
    const snapshot = syntheticSnapshot()
    const order = []
    const report = await runAtendimentoSourceSync({
        pool,
        databaseUrl: PRODUCTION_URL,
        target: 'production',
        action: 'apply',
        applyConfirmed: true,
        sourceReader: async () => snapshot,
        storeFactory: () => ({
            async importRecords(input) {
                order.push(input.dryRun ? 'validate' : 'apply')
                return { dryRun: input.dryRun, records: input.records.length, inserted: input.dryRun ? 0 : 1, updated: 0, skipped: 0, importBatchId: input.dryRun ? null : 'batch-synthetic' }
            },
        }),
        backupFactory: async () => {
            order.push('backup')
            return { reference: 'atendimento-source-production-synthetic', manifestHash: 'sha256:' + 'a'.repeat(64), private: true, restorable: true }
        },
        checkpointReader: async () => false,
        schemaReader: async () => {},
        serviceAccountFile: SOURCE_CREDENTIAL_FILE,
    })
    assert.deepEqual(order, ['validate', 'backup', 'apply'])
    assert.equal(report.dryRun, false)
    assert.equal(report.importBatchId, 'batch-synthetic')
    assert.equal(report.backupReference, 'atendimento-source-production-synthetic')
})

test('does not treat a repeated source fingerprint as a new import', async () => {
    const pool = fakePool()
    const snapshot = syntheticSnapshot()
    let writes = 0
    const fingerprint = atendimentoSourceFingerprint(snapshot)
    const report = await runAtendimentoSourceSync({
        pool,
        databaseUrl: PRODUCTION_URL,
        target: 'production',
        action: 'apply',
        applyConfirmed: true,
        sourceReader: async () => snapshot,
        storeFactory: () => ({ async importRecords() { writes += 1; return {} } }),
        backupFactory: async () => { throw new Error('unchanged source must not be backed up') },
        checkpointReader: async (_pool, value) => value === fingerprint,
        schemaReader: async () => {},
        serviceAccountFile: SOURCE_CREDENTIAL_FILE,
    })
    assert.equal(report.skipped, true)
    assert.equal(writes, 1)
})
